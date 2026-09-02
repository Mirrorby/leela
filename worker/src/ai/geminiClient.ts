const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
export async function generateReview(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorBody}`);
  }

  const data = (await response.json()) as GeminiResponse;

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini заблокировал запрос: ${data.promptFeedback.blockReason}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) {
    throw new Error('Gemini вернул пустой ответ');
  }
  return text.trim();
}
