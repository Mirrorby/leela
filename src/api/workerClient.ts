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

export async function listGamesOnServer(): Promise<GameState[]> {
  const result = await apiFetch<{ games: GameState[] }>('/api/v1/games');
  return result.games;
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
 */
export async function rollOnServer(gameId: string, clientEventId: string, value?: number): Promise<RollResult> {
  return apiFetch<RollResult>(`/api/v1/games/${gameId}/rolls`, {
    method: 'POST',
    body: JSON.stringify(value === undefined ? { clientEventId } : { clientEventId, value }),
  });
}
