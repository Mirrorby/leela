import { describe, expect, it } from 'vitest';
import limits from '../../../src/data/limits.json';
import { BodyTooLargeError, readBoundedText } from './limits';

describe('bounded request bodies', () => {
  it('accepts the byte boundary and decodes multibyte characters across chunks', async () => {
    const encoded = new TextEncoder().encode('я'.repeat(limits.jsonBodyBytes / 2));
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoded.slice(0, 1)); controller.enqueue(encoded.slice(1)); controller.close();
    } });
    expect(await readBoundedText({ body, headers: new Headers() })).toBe('я'.repeat(limits.jsonBodyBytes / 2));
  });

  it('stops a chunked oversized body without a length header or buffering its remainder', async () => {
    let pulls = 0; let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(limits.jsonBodyBytes + 1)); },
      cancel() { cancelled = true; },
    });
    await expect(readBoundedText({ body, headers: new Headers() })).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(cancelled).toBe(true); expect(pulls).toBeLessThanOrEqual(2);
  });

  it('rejects a declared oversized body before reading it and still checks dishonest short lengths', async () => {
    const request = new Request('https://test', { method: 'POST', body: 'x', headers: { 'Content-Length': String(limits.jsonBodyBytes + 1) } });
    await expect(readBoundedText(request)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(request.bodyUsed).toBe(false);
    const dishonest = new Request('https://test', { method: 'POST', body: 'x'.repeat(limits.jsonBodyBytes + 1), headers: { 'Content-Length': '1' } });
    await expect(readBoundedText(dishonest)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
