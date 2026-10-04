import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import { getOrCreateUserBalance, InsufficientBalanceError } from '../payments/repository';
import { reserveAiReview, markAiReviewReady, getAiReview, failAiReviewAndRefund } from './reviewRepository';
import { publicAiReview } from './reviewFormat';
import { buildReviewPrompt } from './reviewPrompt';
import { createNewGame } from '../game/gameEngine';
import { getRuleset } from '../game/rulesetLoader';

describe('short preview and paid full review', () => {
  let d: ReturnType<typeof createSqliteD1>;
  beforeEach(async () => { d = createSqliteD1(); await getOrCreateUserBalance(d.db, '111'); });
  afterEach(() => d.sqlite.close());
  const balance = () => getOrCreateUserBalance(d.db, '111');
  const read = async () => publicAiReview((await getAiReview(d.db, 'g'))!);
  async function credit() { await d.db.prepare('UPDATE user_balances SET paid_ai_reviews = 2').run(); }
  async function short() {
    const r = await reserveAiReview(d.db, 'g', '111', 'short');
    await markAiReviewReady(d.db, 'g', r.review.updated_at, 'preview');
  }
  it('full requires a paid credit even if the free preview is unused', async () => {
    await expect(reserveAiReview(d.db, 'g', '111', 'full')).rejects.toThrow(InsufficientBalanceError);
    expect(await balance()).toMatchObject({ free_ai_reviews_remaining: 1, paid_ai_reviews: 0 });
    expect(await getAiReview(d.db, 'g')).toBeNull();
  });
  it('full consumes only paid credit; preview never consumes paid credit', async () => {
    await credit();
    await reserveAiReview(d.db, 'full', '111', 'full');
    expect(await balance()).toMatchObject({ free_ai_reviews_remaining: 1, paid_ai_reviews: 1 });
    await short();
    await expect(reserveAiReview(d.db, 'other', '111', 'short')).rejects.toThrow(InsufficientBalanceError);
    expect(await balance()).toMatchObject({ free_ai_reviews_remaining: 0, paid_ai_reviews: 1 });
  });
  it('upgrades a short review once and keeps preview during generation and after success', async () => {
    await short(); await credit();
    const results = await Promise.all([1, 2, 3].map(() => reserveAiReview(d.db, 'g', '111', 'full')));
    expect(results.filter(r => r.started)).toHaveLength(1);
    expect(await read()).toMatchObject({ status: 'pending', kind: 'full', content: null, shortContent: 'preview' });
    expect((await reserveAiReview(d.db, 'g', '111', 'short')).view).toMatchObject({ status: 'ready', content: 'preview' });
    expect(await balance()).toMatchObject({ free_ai_reviews_remaining: 0, paid_ai_reviews: 1 });
    await markAiReviewReady(d.db, 'g', results[0].review.updated_at, 'full text');
    expect(await read()).toMatchObject({ status: 'ready', kind: 'full', content: 'full text', shortContent: 'preview' });
    expect((await reserveAiReview(d.db, 'g', '111', 'full')).started).toBe(false);
  });
  it('failed upgrade refunds once, preserves preview and supports paid retry', async () => {
    await short();
    await expect(reserveAiReview(d.db, 'g', '111', 'full')).rejects.toThrow(InsufficientBalanceError);
    await credit();
    const r = await reserveAiReview(d.db, 'g', '111', 'full');
    expect(await failAiReviewAndRefund(d.db, 'g', r.review.updated_at)).toBe(true);
    expect(await failAiReviewAndRefund(d.db, 'g', r.review.updated_at)).toBe(false);
    expect(await read()).toMatchObject({ status: 'failed', kind: 'full', shortContent: 'preview' });
    expect((await reserveAiReview(d.db, 'g', '111', 'short')).view.content).toBe('preview');
    expect(await balance()).toMatchObject({ free_ai_reviews_remaining: 0, paid_ai_reviews: 2 });
    expect((await reserveAiReview(d.db, 'g', '111', 'full')).started).toBe(true);
  });
  it('a failure while saving the full result cannot lose the short result', async () => {
    await short(); await credit();
    d.sqlite.exec("CREATE TRIGGER fail_upgrade BEFORE UPDATE ON ai_reviews BEGIN SELECT RAISE(ABORT, 'injected'); END");
    await expect(reserveAiReview(d.db, 'g', '111', 'full')).rejects.toThrow('injected');
    expect(await read()).toMatchObject({ status: 'ready', content: 'preview' });
    expect((await balance()).paid_ai_reviews).toBe(2);
  });
  it.each(['free', 'paid'])('preserves existing full plaintext charged from %s', async source => {
    await d.db.prepare("INSERT INTO ai_reviews VALUES (?, ?, 'ready', ?, ?, NULL, ?, ?)")
      .bind('g', '111', source, 'legacy full', Date.now(), Date.now()).run();
    for (const kind of ['short', 'full'] as const) {
      const r = await reserveAiReview(d.db, 'g', '111', kind);
      expect(r).toMatchObject({ started: false, view: { kind: 'full', content: 'legacy full' } });
    }
    expect((await balance()).free_ai_reviews_remaining).toBe(1);
  });
  it('uses separate instructions for preview and full analysis', () => {
    const g = createNewGame({ id: 'g', ruleset: getRuleset('classic-v1')!, request: 'focus', diceMode: 'virtual' });
    expect(buildReviewPrompt(g, 'short')).toContain('70–100 слов');
    expect(buildReviewPrompt(g, 'short')).toContain('один вопрос');
    expect(buildReviewPrompt(g, 'full')).toContain('3-5 абзацев');
  });
});
