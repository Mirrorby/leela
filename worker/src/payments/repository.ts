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
