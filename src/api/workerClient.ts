import type { DiceMode, GameState, RollEvent } from '../types/game';
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

export async function createGameOnServer(request: string, diceMode: DiceMode): Promise<GameState> {
  const result = await apiFetch<{ game: GameState }>('/api/v1/games', {
    method: 'POST',
    body: JSON.stringify({ request, diceMode }),
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
