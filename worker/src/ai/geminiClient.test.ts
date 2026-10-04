import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateReview, GEMINI_TIMEOUT_MS } from './geminiClient';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function geminiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('generateReview', () => {
  it('bounds the short review output without using the output budget for thinking', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiResponse({ candidates: [{ content: { parts: [{ text: 'short' }] } }] }));
    await generateReview('dummy', 'prompt', 'short');
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string).generationConfig)
      .toEqual({ maxOutputTokens: 768, thinkingConfig: { thinkingBudget: 0 } });
  });
  it('rejects truncated provider output so the caller refunds the attempt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'unfinished' }] } }] }));
    await expect(generateReview('dummy', 'prompt', 'short')).rejects.toThrow('MAX_TOKENS');
  });
  it('aborts a stalled provider request before waitUntil expires', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }));
    const result = generateReview('key', 'prompt').catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(GEMINI_TIMEOUT_MS);
    expect(await result).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the timeout active while reading a stalled response body', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const response = geminiResponse({});
      vi.spyOn(response, 'json').mockImplementation(() => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('body timeout')), { once: true });
      }));
      return response;
    });
    const result = generateReview('key', 'prompt').catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(GEMINI_TIMEOUT_MS);
    expect(await result).toBeInstanceOf(Error);
  });
  it('возвращает текст из candidates[0].content.parts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      geminiResponse({ candidates: [{ content: { parts: [{ text: 'Разбор партии...' }] }, finishReason: 'STOP' }] })
    );
    const result = await generateReview('test-key', 'prompt');
    expect(result).toBe('Разбор партии...');
  });

  it('склеивает несколько parts в один текст', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      geminiResponse({ candidates: [{ content: { parts: [{ text: 'Часть 1. ' }, { text: 'Часть 2.' }] } }] })
    );
    const result = await generateReview('test-key', 'prompt');
    expect(result).toBe('Часть 1. Часть 2.');
  });

  it('обращается к правильному эндпоинту gemini-2.5-flash с ключом в заголовке x-goog-api-key', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(geminiResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    await generateReview('my-secret-key', 'prompt text');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('my-secret-key');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toBe('prompt text');
  });

  it('непустой promptFeedback.blockReason — бросает исключение (запрос заблокирован Gemini)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiResponse({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }));
    await expect(generateReview('key', 'prompt')).rejects.toThrow(/SAFETY/);
  });

  it('пустой ответ (нет candidates) — бросает исключение, а не возвращает пустую строку', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiResponse({ candidates: [] }));
    await expect(generateReview('key', 'prompt')).rejects.toThrow(/пустой/);
  });

  it('HTTP-ошибка — сообщает статус без сохранения тела ответа провайдера', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('quota exceeded', { status: 429 }));
    await expect(generateReview('key', 'prompt')).rejects.toThrow(/429/);
    await expect(generateReview('key', 'prompt')).rejects.not.toThrow(/quota exceeded/);
  });
});
