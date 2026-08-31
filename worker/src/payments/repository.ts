import type { Entitlements } from '../types/payments';
import { computeEntitlements } from './entitlements';
import { FREE_GAMES_DEFAULT, FREE_AI_REVIEWS_DEFAULT } from './catalog';

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

export type GameChargeSource = 'subscription' | 'free' | 'paid';

/** Баланс исчерпан (нет активной подписки, нет бесплатных и купленных
 * партий) — вызывающий код (index.ts) должен ответить 402 с каталогом. */
export class InsufficientBalanceError extends Error {
  constructor() {
    super('insufficient balance for a new game');
    this.name = 'InsufficientBalanceError';
  }
}

/** Баланс изменился между чтением и списанием (гонка — например, два
 * параллельных "Начать партию") — вызывающий код должен ответить 409,
 * клиент повторяет запрос (с тем же clientRequestId — списания ещё не
 * произошло, повтор безопасен). Тот же принцип, что version_conflict у
 * games (см. worker/src/index.ts:handleRoll). */
export class BalanceVersionConflictError extends Error {
  constructor() {
    super('user_balances changed concurrently');
    this.name = 'BalanceVersionConflictError';
  }
}

/**
 * Атомарное списание за одну партию, приоритет по §3.3/§9 ТЗ: подписка →
 * бесплатные партии → купленные. Подписка не расходует счётчик — просто
 * подтверждает право начать партию, пока period_end в будущем.
 *
 * Каждое условное UPDATE проверяет version И достаточность остатка ОДНИМ
 * WHERE (`version = ? AND free_games_remaining > 0`) — если строка успела
 * измениться параллельным запросом между SELECT (в getOrCreateUserBalance
 * выше по стеку) и этим UPDATE, `.meta.changes` будет 0 независимо от
 * причины (сама гонка или кто-то другой уже потратил последнюю партию), и
 * мы всегда просим клиента повторить запрос заново — он перечитает
 * актуальный баланс и корректно попадёт либо в успешное списание, либо в
 * честный 402, а не получит партию поверх недостоверного счёта.
 *
 * Известный остаточный риск (осознанно принят, не D1-транзакция на два
 * оператора): если этот UPDATE прошёл, а последующий insertGame (в
 * index.ts) всё же упадёт по непредвиденной причине, баланс окажется
 * списан без созданной партии. Для масштаба этого проекта — редкий и
 * дешёвый в ручном разборе случай (не стали городить компенсирующую
 * транзакцию/сагу ради него); если станет реальной проблемой — можно
 * добавить сверку по analytics_events позже.
 */
export async function chargeForGame(db: D1Database, telegramId: string): Promise<{ source: GameChargeSource }> {
  const [balance, subscription] = await Promise.all([getOrCreateUserBalance(db, telegramId), getLatestSubscription(db, telegramId)]);
  const now = Date.now();
  const subscriptionActive = subscription != null && subscription.period_end > now;

  if (subscriptionActive) {
    return { source: 'subscription' };
  }

  if (balance.free_games_remaining > 0) {
    const result = await db
      .prepare(
        `UPDATE user_balances SET free_games_remaining = free_games_remaining - 1, version = version + 1, updated_at = ?
         WHERE telegram_id = ? AND version = ? AND free_games_remaining > 0`
      )
      .bind(now, telegramId, balance.version)
      .run();
    if ((result.meta?.changes ?? 0) === 0) throw new BalanceVersionConflictError();
    return { source: 'free' };
  }

  if (balance.paid_games > 0) {
    const result = await db
      .prepare(
        `UPDATE user_balances SET paid_games = paid_games - 1, version = version + 1, updated_at = ?
         WHERE telegram_id = ? AND version = ? AND paid_games > 0`
      )
      .bind(now, telegramId, balance.version)
      .run();
    if ((result.meta?.changes ?? 0) === 0) throw new BalanceVersionConflictError();
    return { source: 'paid' };
  }

  throw new InsufficientBalanceError();
}
