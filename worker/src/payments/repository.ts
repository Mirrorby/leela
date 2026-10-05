import type { Entitlements } from '../types/payments';
import { computeEntitlements } from './entitlements';
import { FREE_GAMES_DEFAULT, FREE_AI_REVIEWS_DEFAULT } from './catalog';
import { logAnalyticsEvent } from '../analytics/repository';
import { ensureFreeGamePolicy } from './freeGamePolicy';
import { ensurePaymentEvents } from './paymentEvents';

export interface UserBalanceRow {
  telegram_id: string;
  free_games_remaining: number;
  free_ai_reviews_remaining: number;
  paid_games: number;
  paid_ai_reviews: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface SubscriptionRow {
  id: string;
  telegram_id: string;
  period_end: number;
  auto_renew: number;
  expired_notified_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * Лениво создаёт баланс при первом обращении — отдельного шага
 * "регистрации" нет (§2 ТЗ). INSERT ... ON CONFLICT(telegram_id) DO NOTHING
 * — конкурентный первый запрос от того же telegram_id (например, два
 * одновременных открытия приложения на старте) не затирает уже созданную
 * строку и не падает на дубле PRIMARY KEY; повторный вызов для уже
 * существующего пользователя НЕ сбрасывает free_*_remaining обратно к
 * дефолту (DO NOTHING, а не UPDATE) — это принципиально: иначе каждое
 * открытие "Мои партии" тихо возвращало бы бесплатные партии.
 */
export async function getOrCreateUserBalance(db: D1Database, telegramId: string): Promise<UserBalanceRow> {
  await ensureFreeGamePolicy(db);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO user_balances
        (telegram_id, free_games_remaining, free_ai_reviews_remaining, paid_games, paid_ai_reviews, version, created_at, updated_at)
       VALUES (?, ?, ?, 0, 0, 1, ?, ?)
       ON CONFLICT(telegram_id) DO NOTHING`
    )
    .bind(telegramId, FREE_GAMES_DEFAULT, FREE_AI_REVIEWS_DEFAULT, now, now)
    .run();

  const row = await db.prepare('SELECT * FROM user_balances WHERE telegram_id = ?').bind(telegramId).first<UserBalanceRow>();
  if (!row) {
    // Практически недостижимо (после ON CONFLICT DO NOTHING строка обязана
    // существовать — либо только что вставленная, либо та, с которой был
    // конфликт), но не молчим, если это всё-таки произойдёт, вместо того
    // чтобы уронить вызывающий код на null с непонятной причиной.
    throw new Error(`user_balances row missing for telegram_id=${telegramId} after upsert`);
  }
  return row;
}

/**
 * Самая свежая по period_end подписка пользователя. null — подписки не
 * было никогда. ИСТЕКШАЯ подписка тоже возвращается (period_end в
 * прошлом) — решение "активна ли" остаётся за computeEntitlements, не за
 * этим запросом (см. payments/entitlements.ts).
 *
 * §20 ТЗ: параллельных активных подписок у одного пользователя быть не
 * должно (проверка — на уровне создания invoice, батч 3), но читаем
 * защитно на случай, если в истории всё же осталось несколько строк.
 */
export async function getLatestSubscription(db: D1Database, telegramId: string): Promise<SubscriptionRow | null> {
  const row = await db
    .prepare('SELECT * FROM subscriptions WHERE telegram_id = ? ORDER BY period_end DESC LIMIT 1')
    .bind(telegramId)
    .first<SubscriptionRow>();
  return row ?? null;
}

export async function getEntitlements(db: D1Database, telegramId: string): Promise<Entitlements> {
  const [balance, subscription] = await Promise.all([getOrCreateUserBalance(db, telegramId), getLatestSubscription(db, telegramId)]);
  return computeEntitlements(balance, subscription, Date.now());
}

/**
 * §26 ТЗ, событие subscription_expired — см. развёрнутый комментарий в
 * 0012_add_subscription_expired_notified.sql про то, почему у этого
 * события нет естественной точки вызова. Дёргается из
 * GET /api/v1/entitlements (index.ts) — не влияет на возвращаемые
 * entitlements (computeEntitlements и так корректно считает истёкшую
 * подписку неактивной независимо от этого флага), только логирует факт
 * первого обнаружения истечения.
 */
export async function trackSubscriptionExpiryIfNeeded(db: D1Database, telegramId: string): Promise<void> {
  const subscription = await getLatestSubscription(db, telegramId);
  if (!subscription) return;
  if (subscription.period_end > Date.now()) return; // ещё активна
  if (subscription.expired_notified_at != null) return; // уже залогировано

  const result = await db
    .prepare('UPDATE subscriptions SET expired_notified_at = ? WHERE id = ? AND expired_notified_at IS NULL')
    .bind(Date.now(), subscription.id)
    .run();
  if ((result.meta?.changes ?? 0) > 0) {
    // Условие в WHERE выше — защита от гонки (два параллельных запроса
    // одновременно видят expired_notified_at IS NULL): UPDATE выигрывает
    // только у одного из них, только он логирует.
    await logAnalyticsEvent(db, telegramId, 'subscription_expired');
  }
}

export type GameChargeSource = 'subscription' | 'free' | 'paid';

/** Баланс исчерпан (нет активной подписки, нет бесплатных и купленных
 * партий) — вызывающий код (index.ts) должен ответить 402 с каталогом. */
export class InsufficientBalanceError extends Error {
  constructor() {
    super('insufficient balance');
    this.name = 'InsufficientBalanceError';
  }
}


// ----------------------------------------------------------------------
// Батч 3: транзакции (инвойсы) и начисление по successful_payment.
// ----------------------------------------------------------------------

export interface TransactionRow {
  id: string;
  telegram_id: string;
  product_id: string;
  stars_amount: number;
  status: 'created' | 'pending' | 'successful' | 'failed' | 'refunded';
  telegram_payment_charge_id: string | null;
  is_subscription_renewal: number;
  granted_games: number;
  granted_ai_reviews: number;
  granted_subscription_days: number;
  created_at: number;
  updated_at: number;
}

/** Read historical invoice snapshots; new Stars invoices cannot be created. */
export async function getTransactionById(db: D1Database, id: string): Promise<TransactionRow | null> {
  const row = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<TransactionRow>();
  return row ?? null;
}

/** Идемпотентность (§14 ТЗ) — Telegram может повторно доставить
 * successful_payment; если этот telegram_payment_charge_id уже записан у
 * какой-то транзакции, вебхук не должен начислять повторно (см.
 * webhook.ts:handleSuccessfulPayment). */
export async function findTransactionByChargeId(db: D1Database, chargeId: string): Promise<TransactionRow | null> {
  const row = await db.prepare('SELECT * FROM transactions WHERE telegram_payment_charge_id = ?').bind(chargeId).first<TransactionRow>();
  return row ?? null;
}

/** Settle a historical invoice atomically with access. The conditional
 * transition fences duplicates and refunds, including notifications racing
 * between the caller's read and this batch. */
export async function applySuccessfulPayment(
  db: D1Database,
  transaction: TransactionRow,
  params: { telegramPaymentChargeId: string; isRenewal: boolean; subscriptionExpirationDateSeconds?: number }
): Promise<boolean> {
  const now = Date.now();
  await ensurePaymentEvents(db);
  const subscription = transaction.granted_subscription_days > 0 || params.isRenewal;
  if (subscription && (params.subscriptionExpirationDateSeconds == null
    || !Number.isSafeInteger(params.subscriptionExpirationDateSeconds) || params.subscriptionExpirationDateSeconds <= 0)) {
    throw new Error('applySuccessfulPayment: missing or invalid subscriptionExpirationDateSeconds');
  }
  const current = params.isRenewal ? await getLatestSubscription(db, transaction.telegram_id) : null;
  if (params.isRenewal && !current) throw new Error('applySuccessfulPayment: renewal without subscription');
  if (!subscription) await getOrCreateUserBalance(db, transaction.telegram_id);
  const statements = [db.prepare(`UPDATE transactions SET status = 'successful', telegram_payment_charge_id = ?,
    is_subscription_renewal = ?, updated_at = ? WHERE id = ? AND status = 'created'
    AND NOT EXISTS (SELECT 1 FROM legacy_star_refunds WHERE charge_id = ?)`)
    .bind(params.telegramPaymentChargeId, params.isRenewal ? 1 : 0, now, transaction.id, params.telegramPaymentChargeId)];
  if (params.isRenewal && current) {
    statements.push(db.prepare('UPDATE subscriptions SET period_end = ?, updated_at = ? WHERE id = ? AND changes() = 1')
      .bind(params.subscriptionExpirationDateSeconds! * 1000, now, current.id));
  } else if (subscription) {
    statements.push(db.prepare(`INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at)
      SELECT ?, ?, ?, 1, ?, ? WHERE changes() = 1`)
      .bind(crypto.randomUUID(), transaction.telegram_id, params.subscriptionExpirationDateSeconds! * 1000, now, now));
  } else {
    statements.push(db.prepare(`UPDATE user_balances SET paid_games = paid_games + ?, paid_ai_reviews = paid_ai_reviews + ?,
      version = version + 1, updated_at = ? WHERE telegram_id = ? AND changes() = 1`)
      .bind(transaction.granted_games, transaction.granted_ai_reviews, now, transaction.telegram_id));
  }
  const results = await db.batch(statements);
  return (results[0].meta?.changes ?? 0) === 1;
}

/** Historical cancellation changes auto-renew only; the paid period remains. */
export async function markSubscriptionAutoRenewOff(db: D1Database, telegramId: string): Promise<void> {
  const current = await getLatestSubscription(db, telegramId);
  if (!current) return; // Нет подписки — нечего отменять, тихо игнорируем.
  await db.prepare('UPDATE subscriptions SET auto_renew = 0, updated_at = ? WHERE id = ?').bind(Date.now(), current.id).run();
}
