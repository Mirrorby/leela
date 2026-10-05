import limits from '../../../src/data/limits.json';

export class BodyTooLargeError extends Error {}

/** Count bytes as they arrive, including chunked requests without a length
 * header. Never buffer an unbounded body before deciding to reject it. */
export async function readBoundedText(request: Pick<Request, 'body' | 'headers'>, maxBytes = limits.jsonBodyBytes): Promise<string> {
  const length = request.headers.get('Content-Length');
  if (length !== null && Number(length) > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new BodyTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export function isValidIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limits.identifierCharacters;
}
