import type { AiReviewRow } from './reviewRepository';

export type ReviewLanguage = 'ru' | 'en';
export type ReviewKind = 'short' | 'full';
export const REVIEW_FORMAT = 'leela-review-v2';
export function publicAiReview(row: AiReviewRow, preferShort = false) {
  let envelope: { format: string; kind: ReviewKind; shortContent: string | null; fullContent: string | null; language?: ReviewLanguage; shortLanguage?: ReviewLanguage | null } | null = null;
  try {
    const value = JSON.parse(row.content ?? 'null');
    if (value?.format === REVIEW_FORMAT && (value.kind === 'short' || value.kind === 'full')
      && (value.shortContent === null || typeof value.shortContent === 'string')
      && (value.fullContent === null || typeof value.fullContent === 'string')) envelope = value;
  } catch { /* Existing plain-text reviews remain fully available. */ }
  if (!envelope) return { status: row.status, kind: 'full' as ReviewKind, content: row.status === 'ready' ? row.content : null, shortContent: null, language: 'ru' as ReviewLanguage, shortLanguage: null, error: row.error };
  if (preferShort && envelope.shortContent) return { status: 'ready' as const, kind: 'short' as ReviewKind, content: envelope.shortContent, shortContent: envelope.shortContent, language: envelope.shortLanguage ?? 'ru', shortLanguage: envelope.shortLanguage ?? 'ru', error: null };
  return { status: row.status, kind: envelope.kind,
    content: row.status === 'ready' ? (envelope.kind === 'short' ? envelope.shortContent : envelope.fullContent) : null,
    shortContent: envelope.shortContent, language: envelope.language ?? 'ru', shortLanguage: envelope.shortContent ? envelope.shortLanguage ?? 'ru' : null, error: row.error };
}
