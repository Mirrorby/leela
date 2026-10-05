export const RATE_LIMITS = { api: 300, create: 20, roll: 120, analysis: 5, analytics: 30 } as const;
type Bucket = keyof typeof RATE_LIMITS;
const WINDOW_MS = 60_000;
const initialized = new WeakMap<D1Database, Promise<void>>();
export const RATE_LIMIT_SCHEMA = `CREATE TABLE IF NOT EXISTS api_rate_limits (
  telegram_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  requests INTEGER NOT NULL,
  PRIMARY KEY (telegram_id, bucket)
)`;

async function ensureSchema(db: D1Database): Promise<void> {
  let pending = initialized.get(db);
  if (!pending) {
    pending = db.batch([
      db.prepare(RATE_LIMIT_SCHEMA),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expiry ON api_rate_limits(window_start)'),
    ]).then(() => {});
    initialized.set(db, pending);
    pending.catch(() => { initialized.delete(db); });
  }
  await pending;
}

/** One atomic conditional upsert across all isolates/devices. At the limit
 * no write occurs; one bounded row per user/bucket replaces each window. */
export async function consumeRateLimit(db: D1Database, telegramId: string, bucket: Bucket, now = Date.now()): Promise<number | null> {
  await ensureSchema(db);
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const row = await db.prepare(`INSERT INTO api_rate_limits (telegram_id, bucket, window_start, requests)
    VALUES (?, ?, ?, 1) ON CONFLICT(telegram_id, bucket) DO UPDATE SET
      window_start = excluded.window_start,
      requests = CASE WHEN api_rate_limits.window_start < excluded.window_start THEN 1 ELSE api_rate_limits.requests + 1 END
    WHERE api_rate_limits.window_start < excluded.window_start OR api_rate_limits.requests < ?
    RETURNING requests`)
    .bind(telegramId, bucket, windowStart, RATE_LIMITS[bucket]).first<{ requests: number }>();
  return row ? null : Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000));
}

export async function cleanExpiredRateLimits(db: D1Database): Promise<void> {
  await ensureSchema(db);
  await db.prepare('DELETE FROM api_rate_limits WHERE window_start < ?').bind(Date.now() - 24 * 60 * WINDOW_MS).run();
}
