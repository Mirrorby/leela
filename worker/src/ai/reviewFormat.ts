import type { AiReviewRow } from './reviewRepository';

export type ReviewKind = 'short' | 'full';
export const REVIEW_FORMAT = 'leela-review-v2';
export function publicAiReview(row: AiReviewRow, preferShort = false) {
  let envelope: { format: string; kind: ReviewKind; shortContent: string | null; fullContent: string | null } | null = null;
  try {
    const value = JSON.parse(row.content ?? 'null');
    if (value?.format === REVIEW_FORMAT && (value.kind === 'short' || value.kind === 'full')
      && (value.shortContent === null || typeof value.shortContent === 'string')
      && (value.fullContent === null || typeof value.fullContent === 'string')) envelope = value;
  } catch { /* Existing plain-text reviews remain fully available. */ }
  if (!envelope) return { status: row.status, kind: 'full' as ReviewKind, content: row.status === 'ready' ? row.content : null, shortContent: null, error: row.error };
  if (preferShort && envelope.shortContent) return { status: 'ready' as const, kind: 'short' as ReviewKind, content: envelope.shortContent, shortContent: envelope.shortContent, error: null };
  return { status: row.status, kind: envelope.kind,
    content: row.status === 'ready' ? (envelope.kind === 'short' ? envelope.shortContent : envelope.fullContent) : null,
    shortContent: envelope.shortContent, error: row.error };
}
