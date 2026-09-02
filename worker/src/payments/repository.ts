import type { Entitlements, ProductId } from '../types/payments';
import { computeEntitlements } from './entitlements';
import { FREE_GAMES_DEFAULT, FREE_AI_REVIEWS_DEFAULT, getProduct } from './catalog';

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
export type AiReviewChargeSource = 'free' | 'paid';

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

/**
 * Списание за ИИ-разбор — приоритет free → paid (§9 ТЗ). В отличие от
 * chargeForGame здесь НЕТ варианта "подписка" — §3.3 ТЗ прямо оговаривает,
 * что подписка не покрывает ИИ-разборы (см. entitlements.ts:canStartAiReview,
 * та же логика продублирована здесь намеренно, а не переиспользована — это
 * решение о деньгах, явное дублирование безопаснее скрытой косвенной связи
 * через общий helper).
 */
export async function chargeForAiReview(db: D1Database, telegramId: string): Promise<{ source: AiReviewChargeSource }> {
  const balance = await getOrCreateUserBalance(db, telegramId);
  const now = Date.now();

  if (balance.free_ai_reviews_remaining > 0) {
    const result = await db
      .prepare(
        `UPDATE user_balances SET free_ai_reviews_remaining = free_ai_reviews_remaining - 1, version = version + 1, updated_at = ?
         WHERE telegram_id = ? AND version = ? AND free_ai_reviews_remaining > 0`
      )
      .bind(now, telegramId, balance.version)
      .run();
    if ((result.meta?.changes ?? 0) === 0) throw new BalanceVersionConflictError();
    return { source: 'free' };
  }

  if (balance.paid_ai_reviews > 0) {
    const result = await db
      .prepare(
        `UPDATE user_balances SET paid_ai_reviews = paid_ai_reviews - 1, version = version + 1, updated_at = ?
         WHERE telegram_id = ? AND version = ? AND paid_ai_reviews > 0`
      )
      .bind(now, telegramId, balance.version)
      .run();
    if ((result.meta?.changes ?? 0) === 0) throw new BalanceVersionConflictError();
    return { source: 'paid' };
  }

  throw new InsufficientBalanceError();
}

/**
 * §12 ТЗ: если генерация упала технической ошибкой, списанный разбор
 * возвращается на баланс — ЧИСТО аддитивно, версия здесь не нужна (тот же
 * довод, что у applySuccessfulPayment: сложение в одном UPDATE атомарно
 * само по себе). source берётся из ai_reviews.charged_from конкретной
 * попытки (см. ai/reviewRepository.ts) — принципиально возвращать туда же,
 * откуда списали, а не всегда в paid.
 */
export async function refundAiReviewCharge(db: D1Database, telegramId: string, source: AiReviewChargeSource): Promise<void> {
  const column = source === 'free' ? 'free_ai_reviews_remaining' : 'paid_ai_reviews';
  await db
    .prepare(`UPDATE user_balances SET ${column} = ${column} + 1, version = version + 1, updated_at = ? WHERE telegram_id = ?`)
    .bind(Date.now(), telegramId)
    .run();
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

/** Уже есть активная (period_end в будущем) подписка — §20 ТЗ: у одного
 * пользователя не должно быть параллельных подписок. Проверяется ДО
 * создания invoice на subscription_unlimited (см. index.ts). */
export async function hasActiveSubscription(db: D1Database, telegramId: string): Promise<boolean> {
  const sub = await getLatestSubscription(db, telegramId);
  return sub != null && sub.period_end > Date.now();
}

/**
 * Создаёт "черновик" транзакции (status='created') ДО обращения к Bot API
 * за ссылкой на инвойс — id этой строки становится invoice_payload
 * (см. payments/invoice.ts), и именно по нему потом опознаётся
 * pre_checkout_query/successful_payment в вебхуке (worker/src/telegram/webhook.ts).
 * granted_* — снимок из каталога НА МОМЕНТ покупки (§28 ТЗ), не пересчитывается
 * позже, даже если цены в catalog.ts изменятся до того, как платёж завершится.
 */
export async function createPendingTransaction(
  db: D1Database,
  telegramId: string,
  productId: ProductId
): Promise<TransactionRow> {
  const product = getProduct(productId);
  if (!product) {
    throw new Error(`unknown productId: ${productId}`);
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO transactions (
        id, telegram_id, product_id, stars_amount, status, telegram_payment_charge_id,
        is_subscription_renewal, granted_games, granted_ai_reviews, granted_subscription_days,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'created', NULL, 0, ?, ?, ?, ?, ?)`
    )
    .bind(id, telegramId, productId, product.stars, product.grant.games, product.grant.aiReviews, product.grant.subscriptionDays, now, now)
    .run();

  return {
    id,
    telegram_id: telegramId,
    product_id: productId,
    stars_amount: product.stars,
    status: 'created',
    telegram_payment_charge_id: null,
    is_subscription_renewal: 0,
    granted_games: product.grant.games,
    granted_ai_reviews: product.grant.aiReviews,
    granted_subscription_days: product.grant.subscriptionDays,
    created_at: now,
    updated_at: now,
  };
}

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

/**
 * Применяет успешный платёж: помечает транзакцию successful И начисляет
 * доступ — единственная точка входа для обеих операций, чтобы их нельзя
 * было случайно рассинхронизировать (пометить успешной, забыв начислить,
 * или наоборот). Вызывается ТОЛЬКО из webhook.ts:handleSuccessfulPayment,
 * которая сама уже проверила идемпотентность по chargeId.
 *
 * isRenewal (is_recurring && !is_first_recurring, см. вызывающий код) —
 * продление подписки НЕ создаёт новую транзакцию с начислением игр (их и
 * так не начисляет subscription_unlimited), только продлевает period_end
 * (§18 ТЗ). subscriptionExpirationDate — секунды от Telegram (Unix time),
 * не миллисекунды — конвертация в this функции, не у вызывающего кода,
 * чтобы ошибка на единицах измерения не могла случиться в двух местах
 * по-разному.
 */
export async function applySuccessfulPayment(
  db: D1Database,
  transaction: TransactionRow,
  params: { telegramPaymentChargeId: string; isRenewal: boolean; subscriptionExpirationDateSeconds?: number }
): Promise<void> {
  const now = Date.now();

  const updateResult = await db
    .prepare(`UPDATE transactions SET status = 'successful', telegram_payment_charge_id = ?, is_subscription_renewal = ?, updated_at = ? WHERE id = ? AND status = 'created'`)
    .bind(params.telegramPaymentChargeId, params.isRenewal ? 1 : 0, now, transaction.id)
    .run();
  if ((updateResult.meta?.changes ?? 0) === 0) {
    // Транзакция уже не в статусе 'created' (гонка с повторной доставкой
    // вебхука, обработанной параллельно) — findTransactionByChargeId в
    // вызывающем коде должен был поймать это раньше, но проверяем и тут:
    // начислять доступ ещё раз НЕЛЬЗЯ.
    return;
  }

  if (params.isRenewal) {
    if (params.subscriptionExpirationDateSeconds == null) {
      throw new Error('applySuccessfulPayment: isRenewal=true без subscriptionExpirationDateSeconds');
    }
    // ВАЖНО: стандартный SQLite (и D1) не поддерживает ORDER BY/LIMIT в
    // UPDATE — сначала находим id актуальной строки подписки отдельным
    // SELECT (getLatestSubscription), затем обновляем по PRIMARY KEY.
    const current = await getLatestSubscription(db, transaction.telegram_id);
    if (!current) {
      // Продление без существующей подписки — не должно случаться в
      // норме (Telegram шлёт is_recurring только для уже оформленной
      // подписки), но не молчим, если чем-то не так.
      throw new Error(`applySuccessfulPayment: продление подписки для telegram_id=${transaction.telegram_id}, но подписки не найдено`);
    }
    await db
      .prepare('UPDATE subscriptions SET period_end = ?, updated_at = ? WHERE id = ?')
      .bind(params.subscriptionExpirationDateSeconds * 1000, now, current.id)
      .run();
    return;
  }

  if (transaction.granted_subscription_days > 0) {
    if (params.subscriptionExpirationDateSeconds == null) {
      throw new Error('applySuccessfulPayment: подписочный продукт без subscriptionExpirationDateSeconds');
    }
    await db
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), transaction.telegram_id, params.subscriptionExpirationDateSeconds * 1000, 1, now, now)
      .run();
    return;
  }

  if (transaction.granted_games > 0 || transaction.granted_ai_reviews > 0) {
    await getOrCreateUserBalance(db, transaction.telegram_id); // гарантирует существование строки
    await db
      .prepare(
        `UPDATE user_balances SET paid_games = paid_games + ?, paid_ai_reviews = paid_ai_reviews + ?, version = version + 1, updated_at = ?
         WHERE telegram_id = ?`
      )
      .bind(transaction.granted_games, transaction.granted_ai_reviews, now, transaction.telegram_id)
      .run();
  }
}

/**
 * BotSubscriptionUpdated (Update.subscription, Bot API 10.2) — единственное
 * место во всей интеграции, где не удалось достать полный официальный
 * список полей (см. комментарий в telegram/webhook.ts у вызывающего кода).
 * Здесь — предельно защищённая часть: просто выключает auto_renew,
 * НИКОГДА не трогает сам доступ (period_end не меняется) — отмена
 * автопродления НЕ обязана обрывать уже оплаченный период (§17 ТЗ:
 * cancelled — доступ сохраняется до period_end).
 */
export async function markSubscriptionAutoRenewOff(db: D1Database, telegramId: string): Promise<void> {
  const current = await getLatestSubscription(db, telegramId);
  if (!current) return; // Нет подписки — нечего отменять, тихо игнорируем.
  await db.prepare('UPDATE subscriptions SET auto_renew = 0, updated_at = ? WHERE id = ?').bind(Date.now(), current.id).run();
}
