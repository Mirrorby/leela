import { createNewGame, processRoll, canRoll, findRollByClientEventId } from './game/gameEngine';
import { isValidDiceValue, rollVirtualDice } from './game/diceEngine';
import { getRuleset } from './game/rulesetLoader';
import { validateInitData, extractInitData, type ValidatedInitData } from './telegram/validateInitData';
import { handleTelegramWebhook } from './telegram/webhook';
import { insertGame, updateGame, getGameById, getGameByClientRequestId, listGamesByUser, InvalidCursorError } from './games/repository';
import { listProducts, getProduct } from './payments/catalog';
import { getEntitlements, chargeForGame, hasActiveSubscription, createPendingTransaction, InsufficientBalanceError, BalanceVersionConflictError } from './payments/repository';
import { createInvoiceLink } from './payments/invoice';
import type { DiceMode } from './types/game';
import type { ProductId } from './types/payments';

export interface Env {
  DB: D1Database;
  // Секреты, добавляются через Cloudflare Dashboard (не в этом файле):
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
}

// Пока в проекте всего один ruleset — захардкожен здесь намеренно (см.
// getRuleset). Когда появится второй, сюда добавится выбор из тела запроса.
const DEFAULT_RULESET_ID = 'classic-v1';

const CORS_HEADERS: Record<string, string> = {
  // Wildcard осознанно: авторизация идёт через заголовок Authorization
  // (initData), а не через cookie, так что ограничение Origin не даёт
  // дополнительной защиты — только усложняет вызовы из github.dev/Mini App.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: { ...CORS_HEADERS, ...init.headers },
  });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Возвращает валидированный initData или готовый Response с 401 для отправки как есть. */
async function requireAuth(request: Request, env: Env): Promise<ValidatedInitData | Response> {
  const initData = extractInitData(request);
  if (!initData) {
    return json({ error: 'unauthorized', detail: 'missing Authorization: tma <initData> header' }, { status: 401 });
  }
  const result = await validateInitData(initData, env.BOT_TOKEN);
  if (!result.ok) {
    // reason безопасно показывать как есть — это метка причины ("hash_mismatch",
    // "stale_auth_date" и т.п.), а не сам секрет и не содержимое initData.
    // hash_mismatch на проде почти всегда значит одно: BOT_TOKEN в Cloudflare
    // не совпадает байт-в-байт с токеном из @BotFather (лишний пробел/перенос
    // строки при копировании — самая частая причина).
    return json({ error: 'unauthorized', detail: `invalid initData: ${result.reason}` }, { status: 401 });
  }
  const { ok: _ok, ...validated } = result;
  return validated;
}

function isValidatedInitData(value: ValidatedInitData | Response): value is ValidatedInitData {
  return !(value instanceof Response);
}

async function handleCreateGame(request: Request, env: Env, auth: ValidatedInitData): Promise<Response> {
  const body = await readJson<{ request?: unknown; diceMode?: unknown; clientRequestId?: unknown }>(request);
  if (!body || typeof body.request !== 'string' || !body.request.trim()) {
    return json({ error: 'invalid_body', detail: 'request (string, non-empty) is required' }, { status: 400 });
  }
  if (body.diceMode !== 'physical' && body.diceMode !== 'virtual') {
    return json({ error: 'invalid_body', detail: 'diceMode must be "physical" or "virtual"' }, { status: 400 });
  }

  // clientRequestId опционален для совместимости со старым фронтом, который
  // его ещё не шлёт (появится в батче 6) — но БЕЗ него ретрай после
  // потерянного ответа спишет партию из баланса повторно (тот же класс
  // бага, что уже чинили для бросков — см. findRollByClientEventId ниже).
  // Если клиент не передал id — генерируем сами; это не защищает ОТ
  // повторного списания при ретрае (сервер не может отличить "клиент
  // повторяет то же действие" от "клиент начинает новую партию" без ключа
  // от самого клиента), но и не ломает запросы от ещё не обновившегося
  // фронта прямо сейчас.
  const clientRequestId = typeof body.clientRequestId === 'string' && body.clientRequestId ? body.clientRequestId : crypto.randomUUID();

  // Идемпотентность — ДО списания баланса и ДО создания партии, тем же
  // приёмом, что дедупликация бросков (handleRoll ниже): если эту партию
  // уже создали по этому ключу, отдаём её как есть, не списывая второй раз.
  const existing = await getGameByClientRequestId(env.DB, auth.telegramId, clientRequestId);
  if (existing) {
    return json({ game: existing });
  }

  const ruleset = getRuleset(DEFAULT_RULESET_ID);
  if (!ruleset) {
    return json({ error: 'ruleset_not_found', detail: DEFAULT_RULESET_ID }, { status: 500 });
  }

  // Списание — ПЕРЕД созданием партии (после проверки ruleset'а — если его
  // почему-то нет, партия и так не создастся, незачем сначала списывать
  // баланс за партию, которая не будет создана).
  try {
    await chargeForGame(env.DB, auth.telegramId);
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return json(
        {
          error: 'games_limit_reached',
          detail: 'Бесплатные и купленные партии закончились.',
          products: listProducts().filter((p) => p.grant.games > 0 || p.isSubscription),
        },
        { status: 402 }
      );
    }
    if (err instanceof BalanceVersionConflictError) {
      return json(
        { error: 'version_conflict', detail: 'Баланс изменился параллельно (другое устройство/вкладка) — попробуйте ещё раз.' },
        { status: 409 }
      );
    }
    throw err;
  }

  const game = createNewGame({
    id: crypto.randomUUID(),
    ruleset,
    request: body.request.trim(),
    diceMode: body.diceMode as DiceMode,
  });

  await insertGame(env.DB, game, auth.telegramId, clientRequestId);
  return json({ game }, { status: 201 });
}

async function handleListGames(request: Request, env: Env, auth: ValidatedInitData): Promise<Response> {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const cursorParam = url.searchParams.get('cursor');
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limitParam !== null && (!Number.isFinite(limit) || limit! < 1)) {
    return json({ error: 'invalid_query', detail: 'limit must be a positive integer' }, { status: 400 });
  }
  try {
    const page = await listGamesByUser(env.DB, auth.telegramId, { limit, cursor: cursorParam });
    return json(page);
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return json({ error: 'invalid_query', detail: 'cursor is malformed' }, { status: 400 });
    }
    throw err;
  }
}

async function handleGetGame(env: Env, auth: ValidatedInitData, gameId: string): Promise<Response> {
  const found = await getGameById(env.DB, gameId, auth.telegramId);
  if (!found) {
    return json({ error: 'not_found' }, { status: 404 });
  }
  return json({ game: found.game });
}

// Монетизация, батч 1 (см. worker/migrations/0006..0010 и payments/):
// только каталог и чтение текущего баланса/подписки. Списание при создании
// партии/ИИ-разбора, вебхук покупок — следующие батчи.
async function handleListProducts(): Promise<Response> {
  return json({ products: listProducts() });
}

async function handleGetEntitlements(env: Env, auth: ValidatedInitData): Promise<Response> {
  const entitlements = await getEntitlements(env.DB, auth.telegramId);
  return json(entitlements);
}

/**
 * §20 ТЗ (нет параллельных подписок) проверяется здесь, ДО обращения к Bot
 * API — дешевле отклонить локально, чем создавать реальную ссылку на
 * оплату, которую потом пришлось бы аннулировать вручную.
 */
async function handleCreateInvoice(request: Request, env: Env, auth: ValidatedInitData): Promise<Response> {
  const body = await readJson<{ productId?: unknown }>(request);
  const productId = typeof body?.productId === 'string' ? body.productId : null;
  const product = productId ? getProduct(productId) : null;
  if (!product) {
    return json({ error: 'invalid_body', detail: 'productId is missing or unknown' }, { status: 400 });
  }

  if (product.isSubscription && (await hasActiveSubscription(env.DB, auth.telegramId))) {
    return json({ error: 'subscription_already_active', detail: 'У вас уже есть активная подписка.' }, { status: 400 });
  }

  const transaction = await createPendingTransaction(env.DB, auth.telegramId, product.id as ProductId);
  const invoiceUrl = await createInvoiceLink(env.BOT_TOKEN, transaction.id, product);
  return json({ invoiceUrl });
}

async function handleRoll(request: Request, env: Env, auth: ValidatedInitData, gameId: string): Promise<Response> {
  const found = await getGameById(env.DB, gameId, auth.telegramId);
  if (!found) {
    return json({ error: 'not_found' }, { status: 404 });
  }
  const { game, version } = found;

  const body = await readJson<{ clientEventId?: unknown; value?: unknown; diceMode?: unknown }>(request);
  if (!body || typeof body.clientEventId !== 'string' || !body.clientEventId) {
    return json({ error: 'invalid_body', detail: 'clientEventId (string) is required' }, { status: 400 });
  }

  // Проверка дубликата — НАМЕРЕННО до применения diceMode и до генерации
  // значения кубика (баг, найден при ревью, п.7): раньше повторный запрос
  // с уже обработанным clientEventId (легитимный ретрай клиента после
  // потерянного ответа) всё равно прогонялся через rollVirtualDice() —
  // ответ содержал СЛУЧАЙНОЕ новое значение вместо того, что реально
  // выпало и сохранилось при первом (настоящем) броске, и, если тело
  // ретрая заодно несло другой diceMode, ответ показывал этот diceMode
  // как применённый, хотя запись в БД не менялась (updateGame для
  // дубликата не вызывается). Возвращаем и state, и value из уже
  // сохранённого броска — ответ на ретрай должен быть неотличим от ответа
  // на исходный успешный запрос.
  const existingRoll = findRollByClientEventId(game, body.clientEventId);
  if (existingRoll) {
    return json({ game, events: [{ type: 'DUPLICATE_IGNORED' }], value: existingRoll.value });
  }

  // Баг п.1 (найден на клиенте): переключатель "Кубик: виртуальный/физический"
  // на GameHome раньше менял режим ТОЛЬКО в локальном React-состоянии — сервер
  // как хранитель истины продолжал использовать diceMode со времени создания
  // партии, и следующий бросок либо игнорировал руками выбранную грань
  // (переключились на физический — сервер всё равно бросал сам), либо падал с
  // 400 "value is required" (переключились на виртуальный — клиент больше не
  // присылал value, а сервер всё ещё ждал его). Клиент теперь всегда
  // присылает свой текущий diceMode вместе с броском; здесь применяем его к
  // партии ДО того, как решаем, кто бросает кубик (сервер или человек).
  if (body.diceMode !== undefined) {
    if (body.diceMode !== 'physical' && body.diceMode !== 'virtual') {
      return json({ error: 'invalid_body', detail: 'diceMode must be "physical" or "virtual"' }, { status: 400 });
    }
    game.diceMode = body.diceMode as DiceMode;
  }

  const ruleset = getRuleset(game.rulesetId);
  if (!ruleset) {
    return json({ error: 'ruleset_not_found', detail: game.rulesetId }, { status: 500 });
  }

  // Тонкий клиент: сервер — единственный источник истины. Для виртуального
  // режима значение ВСЕГДА генерируется здесь и любое value из тела запроса
  // игнорируется (иначе модифицированный клиент мог бы прислать выгодное
  // число). Для физического режима фишка ходит по реальной доске — значение
  // обязан передать клиент (это ввод человека, а не то, что можно подделать
  // с выгодой: игрок с тем же успехом может соврать про физический бросок
  // и в чате боту, это не задача API предотвращать).
  let value: number;
  if (game.diceMode === 'virtual') {
    value = rollVirtualDice();
  } else {
    if (typeof body.value !== 'number' || !isValidDiceValue(body.value)) {
      return json({ error: 'invalid_body', detail: 'value (integer 1..6) is required for physical dice mode' }, { status: 400 });
    }
    value = body.value;
  }

  if (!canRoll(game)) {
    return json({ error: 'game_finished' }, { status: 409 });
  }

  const { game: nextGame, events } = processRoll(game, ruleset, value, body.clientEventId);

  const isDuplicate = events.some((e) => e.type === 'DUPLICATE_IGNORED');
  if (!isDuplicate) {
    // Optimistic concurrency control (см. migrations/0004_add_version_column.sql
    // и updateGame в repository.ts): между строкой getGameById() выше и этим
    // updateGame() кто-то другой теоретически мог успеть сохранить СВОЮ
    // версию этой же партии (два устройства/вкладки с одним аккаунтом,
    // повторный запрос после таймаута и т.п.) — раньше update просто писал
    // поверх без проверки, "потерянное обновление" молча пропадало. Если
    // updateGame сигнализирует, что version уже не совпадает — не считаем
    // nextGame применённым и отвечаем 409, а не 200 с данными, которые на
    // самом деле не сохранились.
    const { success } = await updateGame(env.DB, nextGame, auth.telegramId, version);
    if (!success) {
      return json(
        {
          error: 'version_conflict',
          detail: 'Партия была изменена в другом месте (другое устройство/вкладка) между чтением и записью — этот бросок не сохранён, обновите партию и попробуйте снова.',
        },
        { status: 409 }
      );
    }
  }

  return json({ game: nextGame, events, value });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Проверка живости воркера и доступности D1 — не требует авторизации.
    if (url.pathname === '/api/v1/health') {
      try {
        await env.DB.prepare('SELECT 1').first();
        return json({ ok: true, db: 'reachable', ts: Date.now() });
      } catch (err) {
        return json({ ok: false, db: 'unreachable', error: String(err) }, { status: 500 });
      }
    }

    if (url.pathname.startsWith('/api/v1/games')) {
      const auth = await requireAuth(request, env);
      if (!isValidatedInitData(auth)) return auth;

      // /api/v1/games
      if (url.pathname === '/api/v1/games') {
        if (request.method === 'POST') return handleCreateGame(request, env, auth);
        if (request.method === 'GET') return handleListGames(request, env, auth);
        return json({ error: 'method_not_allowed' }, { status: 405 });
      }

      // /api/v1/games/:id
      const singleMatch = url.pathname.match(/^\/api\/v1\/games\/([^/]+)$/);
      if (singleMatch) {
        if (request.method === 'GET') return handleGetGame(env, auth, singleMatch[1]);
        return json({ error: 'method_not_allowed' }, { status: 405 });
      }

      // /api/v1/games/:id/rolls
      const rollsMatch = url.pathname.match(/^\/api\/v1\/games\/([^/]+)\/rolls$/);
      if (rollsMatch) {
        if (request.method === 'POST') return handleRoll(request, env, auth, rollsMatch[1]);
        return json({ error: 'method_not_allowed' }, { status: 405 });
      }

      return json({ error: 'not_found' }, { status: 404 });
    }

    // Монетизация (см. payments/) — авторизация тем же initData, что и
    // остальной API, для единообразия и потому что каталог/баланс всё равно
    // персонализированы вторым эндпоинтом (entitlements зависит от
    // telegram_id), так что делать products публичным ради одного запроса
    // без initData не даёт выгоды, а вносит асимметрию в код авторизации.
    if (url.pathname === '/api/v1/products') {
      const auth = await requireAuth(request, env);
      if (!isValidatedInitData(auth)) return auth;
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, { status: 405 });
      return handleListProducts();
    }

    if (url.pathname === '/api/v1/entitlements') {
      const auth = await requireAuth(request, env);
      if (!isValidatedInitData(auth)) return auth;
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, { status: 405 });
      return handleGetEntitlements(env, auth);
    }

    if (url.pathname === '/api/v1/payments/invoice') {
      const auth = await requireAuth(request, env);
      if (!isValidatedInitData(auth)) return auth;
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, { status: 405 });
      return handleCreateInvoice(request, env, auth);
    }

    if (url.pathname === '/telegram/webhook') {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, { status: 405 });
      }
      return handleTelegramWebhook(request, env.BOT_TOKEN, env.WEBHOOK_SECRET, env.DB);
    }

    return json({ error: 'not_found' }, { status: 404 });
  },
};
