import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateReview } from './geminiClient';

afterEach(() => vi.restoreAllMocks());

function geminiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('generateReview', () => {
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

  it('HTTP-ошибка (не 2xx) — бросает исключение с текстом ответа', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('quota exceeded', { status: 429 }));
    await expect(generateReview('key', 'prompt')).rejects.toThrow(/429/);
  });
});
