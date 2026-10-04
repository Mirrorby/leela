const POLICY = 'one-free-game-v1';
const initialized = new WeakSet<D1Database>();

/** Existing balances started with two free games. Subtract the retired
 * allowance once (2->1, 1->0, 0->0), without touching purchases or history.
 * The marker and adjustment are one D1 transaction; failed rollout retries
 * safely. CREATE IF NOT EXISTS makes deployment independent of manual SQL. */
export async function ensureFreeGamePolicy(db: D1Database): Promise<void> {
  if (initialized.has(db)) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS application_policies (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)').run();
  const applied = await db.prepare('SELECT id FROM application_policies WHERE id = ?').bind(POLICY).first();
  if (!applied) {
    const now = Date.now();
    await db.batch([
      db.prepare('INSERT INTO application_policies (id, applied_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').bind(POLICY, now),
      db.prepare(`UPDATE user_balances SET free_games_remaining = MAX(0, MIN(1, free_games_remaining - 1)),
        version = version + 1, updated_at = ? WHERE changes() = 1 AND free_games_remaining > 0`).bind(now),
    ]);
  }
  initialized.add(db);
}
