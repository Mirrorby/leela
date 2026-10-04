import { WorkerApiError, type ReviewKind, type AiReviewStatus } from '../api/workerClient';

export type AiState = 'checking' | 'none' | 'starting' | 'pending' | 'ready' | 'failed' | 'locked';
export interface AiReviewSnapshot {
  state: AiState;
  kind: ReviewKind;
  shortContent: string | null;
  content: string | null;
  error: string | null;
}
export const REVIEW_POLL_INTERVAL_MS = 2000;
export const REVIEW_WAIT_LIMIT_MS = 90_000;

interface ReviewApi {
  get(): Promise<AiReviewStatus>;
  start(kind?: ReviewKind): Promise<AiReviewStatus>;
}

/** One controller per game. Polls never overlap, and responses from a
 * disposed controller or a superseded operation cannot update the screen. */
export function createAiReviewController(api: ReviewApi, onChange: (value: AiReviewSnapshot) => void) {
  let state: AiState = 'checking';
  let kind: ReviewKind = 'short';
  let shortContent: string | null = null;
  let disposed = false;
  let epoch = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers() {
    clearTimeout(pollTimer);
    clearTimeout(deadlineTimer);
    pollTimer = deadlineTimer = undefined;
  }
  function publish(next: AiState, content: string | null = null, error: string | null = null) {
    if (disposed) return;
    state = next;
    if (next !== 'pending') clearTimers();
    onChange({ state, content, error, kind, shortContent });
  }
  function schedulePoll() {
    if (disposed || state !== 'pending' || pollTimer) return;
    const operation = epoch;
    pollTimer = setTimeout(async () => {
      pollTimer = undefined;
      try {
        const result = await api.get();
        if (!disposed && epoch === operation) apply(result);
      } catch {
        // A temporary network failure is retried until the overall deadline.
      }
      if (!disposed && epoch === operation) schedulePoll();
    }, REVIEW_POLL_INTERVAL_MS);
  }
  function pending() {
    publish('pending');
    if (!deadlineTimer) {
      deadlineTimer = setTimeout(() => {
        epoch++;
        publish('failed', null, 'Не удалось узнать результат разбора. Проверьте соединение и повторите запрос — сервер сохранит готовый результат.');
      }, REVIEW_WAIT_LIMIT_MS);
    }
    schedulePoll();
  }
  function apply(result: AiReviewStatus) {
    if (result.kind) kind = result.kind;
    else if (result.status === 'ready') kind = 'full';
    if (result.shortContent !== undefined) shortContent = result.shortContent;
    if (kind === 'short' && result.status === 'ready') shortContent = result.content ?? shortContent;
    if (result.status === 'pending') pending();
    else if (result.status === 'ready') publish('ready', result.content ?? null);
    else if (result.status === 'failed') publish('failed', null, result.error ?? 'Не удалось создать разбор. Попробуйте ещё раз.');
    else publish('none');
  }

  return {
    async check() {
      const operation = ++epoch;
      publish('checking');
      try {
        const result = await api.get();
        if (!disposed && operation === epoch) apply(result);
      } catch {
        if (!disposed && operation === epoch) publish('failed', null, 'Не удалось проверить разбор — проверьте соединение.');
      }
    },
    async start(requestedKind: ReviewKind = 'short') {
      if (disposed || state === 'starting' || state === 'pending' || state === 'checking') return;
      const operation = ++epoch;
      // Polling starts only after the reservation is acknowledged. A GET
      // racing the initial POST may otherwise return none and unlock the UI.
      kind = requestedKind;
      publish('starting');
      try {
        const result = await api.start(requestedKind);
        if (!disposed && operation === epoch) apply(result);
      } catch (error) {
        if (disposed || operation !== epoch) return;
        if (error instanceof WorkerApiError && error.status === 402) {
          publish('locked');
        } else if (error instanceof WorkerApiError && error.status === 409
          && (error.body as { error?: string } | null)?.error === 'already_generating') {
          apply({ ...(error.body as AiReviewStatus), status: 'pending' });
        } else if (error instanceof WorkerApiError && error.status === 0) {
          // A lost POST response doesn't imply a failed reservation.
          try {
            const result = await api.get();
            if (!disposed && operation === epoch) apply(result);
          } catch {
            if (!disposed && operation === epoch) publish('failed', null, error.message);
          }
        } else {
          publish('failed', null, error instanceof WorkerApiError ? error.message : 'Не удалось запросить разбор — проверьте соединение.');
        }
      }
    },
    dispose() {
      disposed = true;
      epoch++;
      clearTimers();
    },
  };
}
