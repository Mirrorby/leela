import { FREE_AI_REVIEWS_DEFAULT, FREE_GAMES_DEFAULT, getProduct } from './catalog';
import type { Product } from '../types/payments';

export interface TributeEnv {
  DB: D1Database;
  TRIBUTE_API_KEY?: string;
  /** JSON keyed by Tribute product ID: {"123":{"productId":"game_1","amount":19900,"currency":"RUB"}}. */
  TRIBUTE_PRODUCTS?: string;
}

interface Mapping {
  product: Product;
  amount: number;
  currency: string;
}

interface Purchase {
  purchase_id: number;
  transaction_id: number;
  product_id: number;
  telegram_user_id: number;
  amount: number;
  currency: string;
}

interface PurchaseRow {
  purchase_id: number;
  transaction_id: number;
  tribute_product_id: number;
  telegram_id: string;
  product_id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'successful' | 'refunded';
  granted_games: number;
  granted_ai_reviews: number;
}

const MAX_BODY_BYTES = 64 * 1024;
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseMappings(raw: string): Map<number, Mapping> {
  const config: unknown = JSON.parse(raw);
  if (!record(config)) throw new Error('invalid Tribute product mapping');
  const mappings = new Map<number, Mapping>();
  for (const [id, value] of Object.entries(config)) {
    if (!/^[1-9]\d*$/.test(id) || !positiveInteger(Number(id)) || !record(value)) throw new Error('invalid Tribute product mapping');
    const product = typeof value.productId === 'string' ? getProduct(value.productId) : null;
    // Channel subscriptions and recurring payments need their own integration.
    if (!product || product.isSubscription || !positiveInteger(value.amount) || typeof value.currency !== 'string') {
      throw new Error('invalid Tribute product mapping');
    }
    const currency = value.currency.toUpperCase();
    if (!['RUB', 'EUR', 'USD', 'XTR'].includes(currency)) throw new Error('invalid Tribute currency');
    mappings.set(Number(id), { product, amount: value.amount, currency });
  }
  return mappings;
}

async function readBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function validSignature(body: Uint8Array, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const bytes = Uint8Array.from(signature.match(/../g)!, (pair) => parseInt(pair, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, bytes, body);
}

function parsePurchase(payload: Record<string, unknown>): Purchase | null {
  if (![payload.purchase_id, payload.transaction_id, payload.product_id, payload.telegram_user_id, payload.amount].every(positiveInteger)) return null;
  if (typeof payload.currency !== 'string' || !payload.currency) return null;
  return {
    purchase_id: payload.purchase_id as number,
    transaction_id: payload.transaction_id as number,
    product_id: payload.product_id as number,
    telegram_user_id: payload.telegram_user_id as number,
    amount: payload.amount as number,
    currency: payload.currency.toUpperCase(),
  };
}

async function findPurchase(db: D1Database, id: number): Promise<PurchaseRow | null> {
  return db.prepare('SELECT * FROM tribute_purchases WHERE purchase_id = ?').bind(id).first<PurchaseRow>();
}

function matches(row: PurchaseRow, purchase: Purchase): boolean {
  return row.tribute_product_id === purchase.product_id && row.transaction_id === purchase.transaction_id &&
    row.telegram_id === String(purchase.telegram_user_id) && row.amount === purchase.amount && row.currency === purchase.currency;
}

function insertPurchase(db: D1Database, purchase: Purchase, mapping: Mapping, status: 'pending' | 'refunded', now: number): D1PreparedStatement {
  return db.prepare(`INSERT INTO tribute_purchases
    (purchase_id, transaction_id, tribute_product_id, telegram_id, product_id, amount, currency,
     status, granted_games, granted_ai_reviews, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(purchase_id) DO NOTHING`)
    .bind(purchase.purchase_id, purchase.transaction_id, purchase.product_id, String(purchase.telegram_user_id), mapping.product.id,
      purchase.amount, purchase.currency, status, mapping.product.grant.games, mapping.product.grant.aiReviews, now, now);
}

async function grantPurchase(db: D1Database, purchase: Purchase, mapping: Mapping): Promise<boolean> {
  const now = Date.now();
  const telegramId = String(purchase.telegram_user_id);
  // D1 batch executes all statements in one transaction and rolls back on failure.
  // The pending guard is inside SQL so concurrent deliveries cannot double-grant.
  const results = await db.batch([
    insertPurchase(db, purchase, mapping, 'pending', now),
    db.prepare(`INSERT INTO user_balances
      (telegram_id, free_games_remaining, free_ai_reviews_remaining, paid_games, paid_ai_reviews, version, created_at, updated_at)
      VALUES (?, ?, ?, 0, 0, 1, ?, ?) ON CONFLICT(telegram_id) DO NOTHING`)
      .bind(telegramId, FREE_GAMES_DEFAULT, FREE_AI_REVIEWS_DEFAULT, now, now),
    db.prepare(`UPDATE user_balances SET
      paid_games = paid_games + (SELECT granted_games FROM tribute_purchases WHERE purchase_id = ?),
      paid_ai_reviews = paid_ai_reviews + (SELECT granted_ai_reviews FROM tribute_purchases WHERE purchase_id = ?),
      version = version + 1, updated_at = ?
      WHERE telegram_id = ? AND EXISTS (
        SELECT 1 FROM tribute_purchases WHERE purchase_id = ? AND telegram_id = ? AND status = 'pending')`)
      .bind(purchase.purchase_id, purchase.purchase_id, now, telegramId, purchase.purchase_id, telegramId),
    db.prepare("UPDATE tribute_purchases SET status = 'successful', updated_at = ? WHERE purchase_id = ? AND status = 'pending'")
      .bind(now, purchase.purchase_id),
  ]);
  return (results[2].meta.changes ?? 0) > 0;
}

async function refundPurchase(db: D1Database, purchase: Purchase, row: PurchaseRow | null, mapping?: Mapping): Promise<boolean> {
  const now = Date.now();
  if (!row) {
    // A refund may arrive before the purchase notification. This tombstone stops
    // a delayed purchase from granting access after the money was returned.
    const results = await db.batch([
      insertPurchase(db, purchase, mapping!, 'refunded', now),
      ...refundStatements(db, purchase, now),
    ]);
    return (results[0].meta.changes ?? 0) > 0 || (results[2].meta.changes ?? 0) > 0;
  }
  const results = await db.batch(refundStatements(db, purchase, now));
  return (results[1].meta.changes ?? 0) > 0;
}

function refundStatements(db: D1Database, purchase: Purchase, now: number): D1PreparedStatement[] {
  return [
    db.prepare(`UPDATE user_balances SET
      paid_games = MAX(0, paid_games - (SELECT granted_games FROM tribute_purchases WHERE purchase_id = ?)),
      paid_ai_reviews = MAX(0, paid_ai_reviews - (SELECT granted_ai_reviews FROM tribute_purchases WHERE purchase_id = ?)),
      version = version + 1, updated_at = ?
      WHERE telegram_id = ? AND EXISTS (
        SELECT 1 FROM tribute_purchases WHERE purchase_id = ? AND telegram_id = ? AND status = 'successful')`)
      .bind(purchase.purchase_id, purchase.purchase_id, now, String(purchase.telegram_user_id), purchase.purchase_id, String(purchase.telegram_user_id)),
    db.prepare("UPDATE tribute_purchases SET status = 'refunded', updated_at = ? WHERE purchase_id = ? AND status != 'refunded'")
      .bind(now, purchase.purchase_id),
  ];
}

export async function handleTributeWebhook(request: Request, env: TributeEnv): Promise<Response> {
  const reply = (data: unknown, status = 200) => Response.json(data, { status });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (!env.TRIBUTE_API_KEY || !env.TRIBUTE_PRODUCTS) return reply({ error: 'tribute_not_configured' }, 503);
  try {
    const body = await readBody(request);
    if (!body) return reply({ error: 'body_too_large' }, 413);
    if (!await validSignature(body, request.headers.get('trbt-signature'), env.TRIBUTE_API_KEY)) return reply({ error: 'invalid_signature' }, 401);
    let event: unknown;
    try { event = JSON.parse(new TextDecoder().decode(body)); } catch { return reply({ error: 'invalid_json' }, 400); }
    if (!record(event) || typeof event.name !== 'string') return reply({ error: 'invalid_event' }, 400);
    if (!['new_digital_product', 'digital_product_refunded'].includes(event.name)) return reply({ status: 'ignored' });
    if (!record(event.payload) || !positiveInteger(event.payload.product_id) || !positiveInteger(event.payload.purchase_id)) {
      return reply({ error: 'invalid_purchase' }, 400);
    }
    const row = await findPurchase(env.DB, event.payload.purchase_id);
    // Saved purchases remain refundable even after their mapping is removed.
    const mapping = parseMappings(env.TRIBUTE_PRODUCTS).get(event.payload.product_id);
    if (!row && !mapping) return reply({ status: 'ignored', reason: 'unmapped_product' });
    // Refund payloads may omit the optional Telegram ID. A saved purchase is
    // already authoritative; never infer the identity for a new purchase.
    const fields = event.name === 'digital_product_refunded' && row && event.payload.telegram_user_id == null
      ? { ...event.payload, telegram_user_id: Number(row.telegram_id) }
      : event.payload;
    if (!positiveInteger(fields.telegram_user_id)) return reply({ error: 'telegram_account_required' }, 422);
    const purchase = parsePurchase(fields);
    if (!purchase) return reply({ error: 'invalid_purchase' }, 400);
    if (row && !matches(row, purchase)) return reply({ error: 'purchase_mismatch' }, 409);
    if (row && (row.status === 'refunded' || (row.status === 'successful' && event.name === 'new_digital_product'))) {
      return reply({ status: 'ok', duplicate: true });
    }
    if (!row && mapping && (mapping.amount !== purchase.amount || mapping.currency !== purchase.currency)) {
      return reply({ error: 'price_mismatch' }, 409);
    }
    const applied = event.name === 'digital_product_refunded'
      ? await refundPurchase(env.DB, purchase, row, mapping)
      : await grantPurchase(env.DB, purchase, mapping!);
    return reply({ status: 'ok', duplicate: !applied });
  } catch {
    // Non-2xx makes Tribute retry. Never acknowledge a failed DB operation.
    // Avoid logging raw payment payloads or API keys.
    console.error('Tribute webhook processing failed');
    return reply({ error: 'tribute_processing_failed' }, 500);
  }
}
