import type { DiceMode, GameState, RollEvent } from '../types/game';
import type { Product, ProductId, Entitlements } from '../types/payments';
import { getInitData } from '../telegram/telegramAdapter';

// Публичный (не секретный) адрес Worker'а — одинаковый для всех пользователей,
// поэтому спокойно живёт как константа в бандле. VITE_WORKER_API_URL остаётся
// возможностью переопределить его при сборке (например, staging-воркер), но
// по умолчанию задавать ничего не нужно.
const DEFAULT_WORKER_API_URL = 'https://leela-worker.nikita-karpof.workers.dev';
const WORKER_API_URL = (import.meta.env.VITE_WORKER_API_URL as string | undefined) || DEFAULT_WORKER_API_URL;

export class WorkerApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'WorkerApiError';
    this.status = status;
    this.body = body;
  }
}

interface ErrorBody {
  error?: string;
  detail?: string;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  // initData отсутствует (пустая строка), когда приложение открыто НЕ
  // внутри Telegram (обычный браузер) — Worker в этом случае честно
  // ответит 401, что и станет видимой пользователю ошибкой ниже.
  const initData = getInitData();

  let res: Response;
  try {
    res = await fetch(`${WORKER_API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `tma ${initData}`,
        ...init.headers,
      },
    });
  } catch {
    throw new WorkerApiError('Нет соединения с сервером — проверь интернет и попробуй ещё раз.', 0, null);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Тело могло быть пустым (например, при 204) — не критично.
  }

  if (!res.ok) {
    const errorBody = body as ErrorBody | null;
    const detail = errorBody?.detail ?? errorBody?.error ?? res.statusText ?? 'Неизвестная ошибка сервера';
    throw new WorkerApiError(detail, res.status, body);
  }

  return body as T;
}

/**
 * clientRequestId — идемпотентность создания партии (см. worker/src/index.ts:handleCreateGame,
 * найдено при бэкенд-ревью п.2/батч 2: без стабильного ключа ретрай после
 * потерянного ответа списывал бы партию из баланса повторно). Опционален на
 * уровне HTTP-контракта (сервер сгенерирует сам, если не передан), но
 * useGameSession.startGame ВСЕГДА передаёт стабильный id — тот же паттерн,
 * что takeClientEventId для бросков.
 */
export async function createGameOnServer(request: string, diceMode: DiceMode, clientRequestId: string): Promise<GameState> {
  const result = await apiFetch<{ game: GameState }>('/api/v1/games', {
    method: 'POST',
    body: JSON.stringify({ request, diceMode, clientRequestId }),
  });
  return result.game;
}

export interface GamesPage {
  games: GameState[];
  nextCursor: string | null;
}

/**
 * Раньше вызывалась без параметров и вообще не использовалась экраном "Мои
 * партии" (см. MyGames.tsx) — весь список читался из localStorage, из-за
 * чего партии "терялись" из UI при очистке локального хранилища, хотя
 * оставались целы на сервере. Теперь это основной источник списка партий;
 * cursor/limit пробрасывают серверную keyset-пагинацию (worker/src/games/repository.ts)
 * дальше в UI ("Загрузить ещё").
 */
export async function listGamesOnServer(options: { cursor?: string | null; limit?: number } = {}): Promise<GamesPage> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  return apiFetch<GamesPage>(`/api/v1/games${query ? `?${query}` : ''}`);
}

export async function getGameFromServer(gameId: string): Promise<GameState> {
  const result = await apiFetch<{ game: GameState }>(`/api/v1/games/${gameId}`);
  return result.game;
}

export interface RollResult {
  game: GameState;
  events: RollEvent[];
  value: number;
}

/**
 * value передаётся ТОЛЬКО для physical-режима (ввод человека). Для virtual
 * его передавать не нужно и не следует — сервер сам бросает кубик и
 * возвращает результат в ответе; см. комментарий в worker/src/index.ts про
 * тонкий клиент.
 *
 * diceMode передаётся, если известен текущий выбранный режим (см.
 * useGameSession.roll()) — партия на сервере хранит diceMode со времени
 * создания и сама не узнает о переключателе на GameHome, если ей об этом не
 * сообщить явно этим полем (баг п.1: раньше это поле не отправлялось вовсе,
 * из-за чего переключение режима во время партии молча не работало).
 */
export async function rollOnServer(
  gameId: string,
  clientEventId: string,
  value?: number,
  diceMode?: DiceMode
): Promise<RollResult> {
  const body: { clientEventId: string; value?: number; diceMode?: DiceMode } = { clientEventId };
  if (value !== undefined) body.value = value;
  if (diceMode !== undefined) body.diceMode = diceMode;
  return apiFetch<RollResult>(`/api/v1/games/${gameId}/rolls`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ----------------------------------------------------------------------
// Монетизация (батч 6 — фронтенд к бэкенду батчей 1-5).
// ----------------------------------------------------------------------

export async function getProductsFromServer(): Promise<Product[]> {
  const result = await apiFetch<{ products: Product[] }>('/api/v1/products');
  return result.products;
}

export async function getEntitlementsFromServer(): Promise<Entitlements> {
  return apiFetch<Entitlements>('/api/v1/entitlements');
}

/** Возвращает ссылку на оплату Stars — открывается через
 * telegramAdapter.openInvoice(), не напрямую (см. usePayments.ts). */
export async function createInvoiceOnServer(productId: ProductId): Promise<string> {
  const result = await apiFetch<{ invoiceUrl: string }>('/api/v1/payments/invoice', {
    method: 'POST',
    body: JSON.stringify({ productId }),
  });
  return result.invoiceUrl;
}

export interface AiReviewStatus {
  status: 'none' | 'pending' | 'ready' | 'failed';
  content?: string | null;
  error?: string | null;
}

/** 202 (pending, только что запущена) или 200 (уже была готова — повторный
 * просмотр, бесплатно, см. §11 ТЗ) — apiFetch не различает эти статусы
 * отдельно, тело ответа в обоих случаях содержит актуальный AiReviewStatus. */
export async function startAiReviewOnServer(gameId: string): Promise<AiReviewStatus> {
  return apiFetch<AiReviewStatus>(`/api/v1/games/${gameId}/analysis/start`, { method: 'POST' });
}

export async function getAiReviewFromServer(gameId: string): Promise<AiReviewStatus> {
  return apiFetch<AiReviewStatus>(`/api/v1/games/${gameId}/analysis`);
}

/** Единственное чисто клиентское событие аналитики (§26 ТЗ) — момент показа
 * предложения ИИ-разбора на Summary, у сервера нет собственного сигнала об
 * этом (см. worker/src/index.ts:handleLogClientEvent — узкий allowlist
 * ровно на это значение). */
export async function logClientAnalyticsEvent(event: 'ai_offer_shown'): Promise<void> {
  await apiFetch('/api/v1/analytics/event', {
    method: 'POST',
    body: JSON.stringify({ event }),
  });
}
