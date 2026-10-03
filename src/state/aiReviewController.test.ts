import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerApiError, type AiReviewStatus } from '../api/workerClient';
import { createAiReviewController, REVIEW_POLL_INTERVAL_MS, REVIEW_WAIT_LIMIT_MS } from './aiReviewController';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('AI review screen lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  function fixture() {
    const get = vi.fn<() => Promise<AiReviewStatus>>().mockResolvedValue({ status: 'none' });
    const start = vi.fn<() => Promise<AiReviewStatus>>().mockResolvedValue({ status: 'pending' });
    const changed = vi.fn();
    const controller = createAiReviewController({ get, start }, changed);
    return { get, start, changed, controller, last: () => changed.mock.calls.at(-1)?.[0] };
  }

  it('a balance version conflict shows retry instead of polling a nonexistent task', async () => {
    const f = fixture();
    await f.controller.check();
    f.start.mockRejectedValue(new WorkerApiError('Повторите запрос', 409, { error: 'version_conflict' }));
    await f.controller.start();
    await vi.advanceTimersByTimeAsync(REVIEW_WAIT_LIMIT_MS);
    expect(f.last()).toMatchObject({ state: 'failed', error: 'Повторите запрос' });
    expect(f.get).toHaveBeenCalledTimes(1);
  });

  it('already_generating polls the existing review and displays its content', async () => {
    const f = fixture();
    await f.controller.check();
    f.start.mockRejectedValue(new WorkerApiError('already_generating', 409, { error: 'already_generating' }));
    await f.controller.start();
    f.get.mockResolvedValue({ status: 'ready', content: 'saved' });
    await vi.advanceTimersByTimeAsync(REVIEW_POLL_INTERVAL_MS);
    expect(f.last()).toMatchObject({ state: 'ready', content: 'saved' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('none during polling stops waiting and restores the offer', async () => {
    const f = fixture();
    await f.controller.check();
    await f.controller.start();
    await vi.advanceTimersByTimeAsync(REVIEW_POLL_INTERVAL_MS);
    expect(f.last().state).toBe('none');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waiting has a deadline even if a polling request never resolves', async () => {
    const f = fixture();
    await f.controller.check();
    await f.controller.start();
    const late = deferred<AiReviewStatus>();
    f.get.mockReturnValue(late.promise);
    await vi.advanceTimersByTimeAsync(REVIEW_WAIT_LIMIT_MS);
    expect(f.last().state).toBe('failed');
    expect(f.get).toHaveBeenCalledTimes(2); // no overlapping requests
    late.resolve({ status: 'ready', content: 'late' });
    await Promise.resolve();
    expect(f.last().state).toBe('failed');
    f.start.mockResolvedValue({ status: 'ready', content: 'saved on server' });
    await f.controller.start();
    expect(f.last().content).toBe('saved on server');
  });

  it('does not poll or accept a double click before start is acknowledged', async () => {
    const f = fixture();
    await f.controller.check();
    const ack = deferred<AiReviewStatus>();
    f.start.mockReturnValue(ack.promise);
    const request = f.controller.start();
    await f.controller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.get).toHaveBeenCalledTimes(1);
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.last().state).toBe('starting');
    ack.resolve({ status: 'pending' });
    await request;
    expect(f.last().state).toBe('pending');
    f.controller.dispose();
  });

  it('recovers state after a lost POST response without another purchase', async () => {
    const f = fixture();
    await f.controller.check();
    f.start.mockRejectedValue(new WorkerApiError('timeout', 0, null));
    f.get.mockResolvedValue({ status: 'pending' });
    await f.controller.start();
    expect(f.last().state).toBe('pending');
    expect(f.start).toHaveBeenCalledTimes(1);
    f.controller.dispose();
  });

  it('a disposed game cannot apply a late start response to another game', async () => {
    const f = fixture();
    await f.controller.check();
    const ack = deferred<AiReviewStatus>();
    f.start.mockReturnValue(ack.promise);
    const request = f.controller.start();
    f.controller.dispose();
    const calls = f.changed.mock.calls.length;
    ack.resolve({ status: 'ready', content: 'old game' });
    await request;
    expect(f.changed).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a disposed game ignores late polling results', async () => {
    const f = fixture();
    await f.controller.check();
    await f.controller.start();
    const late = deferred<AiReviewStatus>();
    f.get.mockReturnValue(late.promise);
    await vi.advanceTimersByTimeAsync(REVIEW_POLL_INTERVAL_MS);
    f.controller.dispose();
    const calls = f.changed.mock.calls.length;
    late.resolve({ status: 'failed', error: 'old game' });
    await Promise.resolve();
    expect(f.changed).toHaveBeenCalledTimes(calls);
  });

  it('402 opens purchase choices and failed generation preserves the server message', async () => {
    const f = fixture();
    await f.controller.check();
    f.start.mockRejectedValue(new WorkerApiError('locked', 402, { error: 'analysis_locked' }));
    await f.controller.start();
    expect(f.last().state).toBe('locked');
    f.start.mockResolvedValue({ status: 'failed', error: 'Попытка возвращена' });
    await f.controller.start();
    expect(f.last()).toMatchObject({ state: 'failed', error: 'Попытка возвращена' });
  });
});
