import limits from '../data/limits.json';
import { tr, getLanguage } from '../i18n/language';
import type { DiceMode, GameState, RollEvent } from '../types/game';
import { isGameState, isRollEvents } from '../game/validateGameState';
import type { Product, Entitlements } from '../types/payments';
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
  retryAfter?: number;
}

async function apiFetch<T>(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const initData = getInitData();
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetch(`${WORKER_API_URL}${path}`, {
      ...init,
      signal: controller?.signal ?? init.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `tma ${initData}`,
        ...init.headers,
      },
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch (error) {
      if (controller?.signal.aborted) throw error;
      // Empty bodies can be legitimate, e.g. HTTP 204.
    }
    if (!res.ok) {
      const errorBody = body as ErrorBody | null;
      throw new WorkerApiError(apiErrorMessage(errorBody, res.status), res.status, body);
    }
    return body as T;
  } catch (error) {
    if (error instanceof WorkerApiError) throw error;
    throw new WorkerApiError(
      controller?.signal.aborted
        ? tr("Сервер не ответил вовремя. Проверьте соединение и повторите запрос.")
        : tr("Нет соединения с сервером — проверь интернет и попробуй ещё раз."),
      0, null
    );
  } finally {
    clearTimeout(timer);
  }
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
  return checkedGame(result?.game);
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
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const query = params.toString();
  const page = await apiFetch<GamesPage>(`/api/v1/games${query ? `?${query}` : ''}`);
  if (!page || !Array.isArray(page.games) || !(page.nextCursor === null || typeof page.nextCursor === 'string')) {
    throw new WorkerApiError(tr("Сервер вернул некорректную историю. Попробуйте обновить список."), 502, { error: 'invalid_response' });
  }
  return { games: page.games.map((game) => checkedGame(game)), nextCursor: page.nextCursor };
}

export async function getGameFromServer(gameId: string): Promise<GameState> {
  const result = await apiFetch<{ game: GameState }>(`/api/v1/games/${gameId}`);
  return checkedGame(result?.game, gameId);
}

function checkedGame(value: unknown, expectedId?: string): GameState {
  if (!isGameState(value) || (expectedId && value.id !== expectedId)) {
    throw new WorkerApiError(tr("Не удалось прочитать партию. Попробуйте загрузить её снова."), 502, { error: 'invalid_response' });
  }
  return value;
}

export async function getAccountFromServer(): Promise<{ telegramId: string }> {
  const result = await apiFetch<{ telegramId: string }>('/api/v1/me');
  if (!result || typeof result.telegramId !== 'string' || !/^[1-9]\d*$/.test(result.telegramId)) {
    throw new WorkerApiError(tr("Не удалось подтвердить Telegram-аккаунт."), 502, { error: 'invalid_response' });
  }
  return result;
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
  const result = await apiFetch<RollResult>(`/api/v1/games/${gameId}/rolls`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!result || !isRollEvents(result.events) || !Number.isInteger(result.value) || result.value < 1 || result.value > 6) {
    throw new WorkerApiError(tr("Не удалось прочитать результат броска. Повторите запрос."), 502, { error: 'invalid_response' });
  }
  return { ...result, game: checkedGame(result.game, gameId) };
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


export type ReviewKind = 'short' | 'full';
export interface AiReviewStatus {
  language?: 'ru' | 'en';
  shortLanguage?: 'ru' | 'en' | null;
  kind?: ReviewKind;
  shortContent?: string | null;
  status: 'none' | 'pending' | 'ready' | 'failed';
  content?: string | null;
  error?: string | null;
}

/** 202 (pending, только что запущена) или 200 (уже была готова — повторный
 * просмотр, бесплатно, см. §11 ТЗ) — apiFetch не различает эти статусы
 * отдельно, тело ответа в обоих случаях содержит актуальный AiReviewStatus. */
export async function startAiReviewOnServer(gameId: string, kind: ReviewKind = 'short'): Promise<AiReviewStatus> {
  return apiFetch<AiReviewStatus>(`/api/v1/games/${gameId}/analysis/start`, { method: 'POST', body: JSON.stringify({ kind, language: getLanguage() }) }, 15_000);
}

export async function getAiReviewFromServer(gameId: string): Promise<AiReviewStatus> {
  return apiFetch<AiReviewStatus>(`/api/v1/games/${gameId}/analysis`, {}, 15_000);
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

function apiErrorMessage(body: ErrorBody | null, status: number): string {
  if (status === 429) return tr('Слишком много запросов. Повторите через {0} сек.', Number.isFinite(body?.retryAfter) ? Math.max(1, Math.ceil(body!.retryAfter!)) : 60);
  if (body?.error === 'request_too_long') return tr('Сократите запрос до {0} символов.', limits.requestCharacters);
  if (status === 413) return tr('Запрос слишком большой. Сократите текст и попробуйте снова.');
  if (body?.error === 'history_limit_reached') return tr('Достигнут предел истории этой партии. Сохранённые ходы доступны в истории; можно начать новую партию.');
  if (body?.error === 'invalid_identifier') return tr('Некорректный идентификатор запроса. Перезапустите игру через Telegram.');
  if (body?.error === 'analysis_input_too_large') return tr('Эта партия слишком большая для ИИ-разбора. Её история сохранена, попытка не списана.');
  if (body?.detail && (getLanguage() === 'ru' || !/[а-яё]/i.test(body.detail))) return tr(body.detail);
  if (status === 401 || status === 403) return tr('Откройте игру через Telegram, чтобы получить доступ к своим партиям.');
  if (status === 402) return tr('Партии закончились');
  if (status === 404) return tr('Партия недоступна. Откройте «Мои партии» или перезапустите игру через Telegram.');
  return getLanguage() === 'en' ? 'The request could not be completed. Please try again.' : body?.detail ?? tr('Неизвестная ошибка сервера');
}

/** A checkout click is observational; only a signed payment webhook grants access. */
export async function logTributeCheckoutClick(productId: Product['id'], clientEventId: string): Promise<void> {
  await apiFetch('/api/v1/analytics/event', {
    method: 'POST', body: JSON.stringify({ event: 'tribute_checkout_clicked', productId, clientEventId }),
  });
}
