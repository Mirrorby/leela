import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { publicAiReview } from './reviewFormat';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import { getOrCreateUserBalance, InsufficientBalanceError } from '../payments/repository';
import {
  reserveAiReview, getAiReview, getRecoverableAiReview, failAiReviewAndRefund,
  markAiReviewReady, recoverExpiredAiReviews, REVIEW_ATTEMPT_TIMEOUT_MS,
} from './reviewRepository';

describe('AI reservation and settlement on real SQLite', () => {
  let database: ReturnType<typeof createSqliteD1>;
  let now: number;
  const user = 'user-1';
  beforeEach(() => {
    database = createSqliteD1();
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => { vi.restoreAllMocks(); database.sqlite.close(); });
  const balance = () => getOrCreateUserBalance(database.db, user);
  async function paid(count: number) {
    await balance();
    await database.db.prepare('UPDATE user_balances SET free_ai_reviews_remaining = 0, paid_ai_reviews = ? WHERE telegram_id = ?')
      .bind(count, user).run();
  }

  it('uses the last free credit without consuming a paid credit', async () => {
    await balance();
    await database.db.prepare('UPDATE user_balances SET paid_ai_reviews = 3 WHERE telegram_id = ?').bind(user).run();
    const result = await reserveAiReview(database.db, 'g1', user);
    expect(result.review.charged_from).toBe('free');
    expect(await balance()).toMatchObject({ free_ai_reviews_remaining: 0, paid_ai_reviews: 3 });
  });

  it('three concurrent starts reserve one attempt and consume one paid credit', async () => {
    await paid(2);
    const results = await Promise.all(Array.from({ length: 3 }, () => reserveAiReview(database.db, 'g1', user)));
    expect(results.filter((r) => r.started)).toHaveLength(1);
    expect(new Set(results.map((r) => r.review.updated_at)).size).toBe(1);
    expect(await balance()).toMatchObject({ paid_ai_reviews: 1 });
  });

  it('two different games competing for the last credit cannot overspend', async () => {
    await paid(1);
    const results = await Promise.allSettled(['g1', 'g2'].map((id) => reserveAiReview(database.db, id, user)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await balance()).paid_ai_reviews).toBe(0);
  });

  it('a failed INSERT leaves the credit untouched and retry succeeds', async () => {
    await balance();
    database.sqlite.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON ai_reviews BEGIN SELECT RAISE(ABORT, 'injected'); END");
    await expect(reserveAiReview(database.db, 'g1', user)).rejects.toThrow('injected');
    expect((await balance()).free_ai_reviews_remaining).toBe(1);
    expect(await getAiReview(database.db, 'g1')).toBeNull();
    database.sqlite.exec('DROP TRIGGER fail_insert');
    expect((await reserveAiReview(database.db, 'g1', user)).started).toBe(true);
  });

  it('a failed debit rolls back the reservation', async () => {
    await balance();
    database.sqlite.exec("CREATE TRIGGER fail_debit BEFORE UPDATE ON user_balances BEGIN SELECT RAISE(ABORT, 'injected'); END");
    await expect(reserveAiReview(database.db, 'g1', user)).rejects.toThrow('injected');
    expect(await getAiReview(database.db, 'g1')).toBeNull();
    expect((await balance()).free_ai_reviews_remaining).toBe(1);
  });

  it('a failed refund rolls back failed status, allowing a safe recovery retry', async () => {
    const { review } = await reserveAiReview(database.db, 'g1', user);
    database.sqlite.exec("CREATE TRIGGER fail_refund BEFORE UPDATE ON user_balances BEGIN SELECT RAISE(ABORT, 'injected'); END");
    await expect(failAiReviewAndRefund(database.db, 'g1', review.updated_at)).rejects.toThrow('injected');
    expect((await getAiReview(database.db, 'g1'))?.status).toBe('pending');
    expect((await balance()).free_ai_reviews_remaining).toBe(0);
    database.sqlite.exec('DROP TRIGGER fail_refund');
    expect(await failAiReviewAndRefund(database.db, 'g1', review.updated_at)).toBe(true);
    expect((await balance()).free_ai_reviews_remaining).toBe(1);
  });

  it.each(['free', 'paid'] as const)('refunds %s to its original counter exactly once', async (source) => {
    if (source === 'paid') await paid(1);
    const { review } = await reserveAiReview(database.db, 'g1', user);
    expect(review.charged_from).toBe(source);
    const results = await Promise.all([
      failAiReviewAndRefund(database.db, 'g1', review.updated_at),
      failAiReviewAndRefund(database.db, 'g1', review.updated_at),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await balance()).toMatchObject(source === 'free'
      ? { free_ai_reviews_remaining: 1, paid_ai_reviews: 0 }
      : { free_ai_reviews_remaining: 0, paid_ai_reviews: 1 });
  });

  it('late success and failure from an old attempt cannot change or refund a retry', async () => {
    const first = await reserveAiReview(database.db, 'g1', user);
    await failAiReviewAndRefund(database.db, 'g1', first.review.updated_at);
    const second = await reserveAiReview(database.db, 'g1', user);
    expect(second.review.updated_at).toBeGreaterThan(first.review.updated_at);
    expect(await markAiReviewReady(database.db, 'g1', first.review.updated_at, 'old')).toBe(false);
    expect(await failAiReviewAndRefund(database.db, 'g1', first.review.updated_at)).toBe(false);
    expect((await balance()).free_ai_reviews_remaining).toBe(0);
    expect(await markAiReviewReady(database.db, 'g1', second.review.updated_at, 'new')).toBe(true);
    expect(publicAiReview((await getAiReview(database.db, 'g1'))!).content).toBe('new');
  });

  it('attempt tokens stay distinct when the clock moves backwards', async () => {
    const first = await reserveAiReview(database.db, 'g1', user);
    await failAiReviewAndRefund(database.db, 'g1', first.review.updated_at);
    now -= 100;
    const second = await reserveAiReview(database.db, 'g1', user);
    expect(second.review.updated_at).toBe(first.review.updated_at + 1);
  });

  it('ready reviews remain available without credits and cannot be refunded', async () => {
    const { review } = await reserveAiReview(database.db, 'g1', user);
    await markAiReviewReady(database.db, 'g1', review.updated_at, 'saved');
    expect((await reserveAiReview(database.db, 'g1', user)).started).toBe(false);
    expect(await failAiReviewAndRefund(database.db, 'g1', review.updated_at)).toBe(false);
    expect((await balance()).free_ai_reviews_remaining).toBe(0);
  });

  it('expired work cannot become ready and is recovered once on read', async () => {
    const { review } = await reserveAiReview(database.db, 'g1', user);
    now += REVIEW_ATTEMPT_TIMEOUT_MS;
    expect(await markAiReviewReady(database.db, 'g1', review.updated_at, 'too late')).toBe(false);
    expect((await getRecoverableAiReview(database.db, 'g1'))?.status).toBe('failed');
    await getRecoverableAiReview(database.db, 'g1');
    expect((await balance()).free_ai_reviews_remaining).toBe(1);
  });

  it('cron recovers a legacy expired pending row but preserves live work', async () => {
    await paid(2);
    await reserveAiReview(database.db, 'old', user);
    now += REVIEW_ATTEMPT_TIMEOUT_MS;
    await reserveAiReview(database.db, 'live', user);
    await recoverExpiredAiReviews(database.db);
    await recoverExpiredAiReviews(database.db);
    expect((await getAiReview(database.db, 'old'))?.status).toBe('failed');
    expect((await getAiReview(database.db, 'live'))?.status).toBe('pending');
    expect((await balance()).paid_ai_reviews).toBe(1);
  });

  it('an active historical game subscription does not grant AI credits', async () => {
    await paid(0);
    await database.db.prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('s1', user, now + 100_000, 0, now, now).run();
    await expect(reserveAiReview(database.db, 'g1', user)).rejects.toThrow(InsufficientBalanceError);
  });
});
