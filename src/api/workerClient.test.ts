import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGameOnServer, rollOnServer, listGamesOnServer, WorkerApiError } from './workerClient';
import * as telegramAdapter from '../telegram/telegramAdapter';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('workerClient', () => {
  beforeEach(() => {
    vi.spyOn(telegramAdapter, 'getInitData').mockReturnValue('auth_date=1&user=%7B%22id%22%3A1%7D&hash=abc');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createGameOnServer шлёт POST с телом {request, diceMode} и заголовком Authorization: tma <initData>', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ game: { id: 'g1', request: 'test', diceMode: 'virtual' } }, 201)
    );

    const game = await createGameOnServer('test', 'virtual');

    expect(game.id).toBe('g1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/v1/games');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ request: 'test', diceMode: 'virtual' });
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('tma auth_date=1&user=%7B%22id%22%3A1%7D&hash=abc');
  });

  it('rollOnServer НЕ включает value в тело, если он не передан (виртуальный режим)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ game: { id: 'g1' }, events: [], value: 4 }));

    await rollOnServer('g1', 'evt-1');

    const [, init] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody).toEqual({ clientEventId: 'evt-1' });
    expect('value' in sentBody).toBe(false);
  });

  it('rollOnServer включает value, если он передан (физический режим)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ game: { id: 'g1' }, events: [], value: 6 }));

    await rollOnServer('g1', 'evt-1', 6);

    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({ clientEventId: 'evt-1', value: 6 });
  });

  it('rollOnServer включает diceMode в тело, если он передан (переключение режима во время партии)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ game: { id: 'g1' }, events: [], value: 3 }));

    await rollOnServer('g1', 'evt-1', undefined, 'physical');

    const [, init] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody).toEqual({ clientEventId: 'evt-1', diceMode: 'physical' });
    expect('value' in sentBody).toBe(false);
  });

  it('бросает WorkerApiError с detail из тела ответа при ошибке сервера', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'not_found' }, 404));

    await expect(rollOnServer('missing', 'evt-1')).rejects.toMatchObject({
      name: 'WorkerApiError',
      status: 404,
      message: 'not_found',
    });
  });

  it('бросает WorkerApiError при сетевом сбое (fetch реджектится)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(listGamesOnServer()).rejects.toThrow(WorkerApiError);
  });

  it('listGamesOnServer без опций не добавляет query-параметры', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ games: [], nextCursor: null }));

    await listGamesOnServer();

    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://leela-worker.nikita-karpof.workers.dev/api/v1/games');
  });

  it('listGamesOnServer пробрасывает cursor и limit как query-параметры', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ games: [], nextCursor: null }));

    await listGamesOnServer({ cursor: 'abc123', limit: 5 });

    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('cursor=abc123');
    expect(String(url)).toContain('limit=5');
  });

  it('listGamesOnServer возвращает games и nextCursor из ответа сервера', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ games: [{ id: 'g1' }], nextCursor: 'next-page-token' })
    );

    const page = await listGamesOnServer();

    expect(page.games).toHaveLength(1);
    expect(page.nextCursor).toBe('next-page-token');
  });
});
