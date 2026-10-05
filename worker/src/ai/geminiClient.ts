import type { ReviewKind } from './reviewFormat';
import { readBoundedText } from '../http/limits';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
export const GEMINI_TIMEOUT_MS = 20_000;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

/**
 * По требованию — Gemini 2.5 Flash, не Anthropic API (несмотря на то, что
 * остальной проект — приложение Claude; сам разбор партий генерируется
 * отдельным провайдером). Ключ — секрет GEMINI_API_KEY, добавляется в
 * Cloudflare Dashboard так же, как BOT_TOKEN/WEBHOOK_SECRET (не в коде).
 *
 * x-goog-api-key — актуальный формат передачи ключа (а не ?key= в URL) по
 * официальной документации Gemini API на момент разработки.
 */
export async function generateReview(apiKey: string, prompt: string, kind: ReviewKind = 'full'): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: kind === 'short' ? 768 : 4096,
          thinkingConfig: { thinkingBudget: kind === 'short' ? 0 : 1024 },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error ${response.status}`);
    }

    const data = JSON.parse(await readBoundedText(response, 128 * 1024)) as GeminiResponse;

    if (data.promptFeedback?.blockReason) {
      throw new Error(`Gemini заблокировал запрос: ${data.promptFeedback.blockReason}`);
    }

    const reason = data.candidates?.[0]?.finishReason;
    if (reason && reason !== 'STOP') throw new Error(`Gemini не завершил разбор: ${reason}`);
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text.trim()) {
      throw new Error('Gemini вернул пустой ответ');
    }
    return text.trim();
  } finally {
    // Includes reading the response body, not just receiving HTTP headers.
    clearTimeout(timer);
  }
}
