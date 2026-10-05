import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1 } from '../testUtils/sqliteD1';
import { createNewGame } from '../game/gameEngine';
import { getRuleset } from '../game/rulesetLoader';
import { createGameWithCharge, getGameById, listGamesByUser } from './repository';
import { deleteOwnedGame, GameDeletedError } from './deletion';
import { getOrCreateUserBalance } from '../payments/repository';
import { reserveAiReview, getAiReview, markAiReviewReady, failAiReviewAndRefund } from '../ai/reviewRepository';
import { logAnalyticsEvent, listAnalyticsEvents } from '../analytics/repository';
import worker, { type Env } from '../index';
import { buildSignedInitData, freshAuthDate, TEST_BOT_TOKEN } from '../testUtils/signInitData';

describe('owned game deletion on production SQL', () => {
  let database: ReturnType<typeof createSqliteD1>;
  const owner = '111';
  const balance = () => getOrCreateUserBalance(database.db, owner);
  const game = () => createNewGame({ id: 'g1', ruleset: getRuleset('classic-v1')!, request: 'private intention', diceMode: 'virtual' });
  beforeEach(async () => { database = createSqliteD1(); await createGameWithCharge(database.db, game(), owner, 'create-key'); });
  afterEach(() => database.sqlite.close());

  it('removes the intention, path, ready review and linked analytics while keeping purchases/balance', async () => {
    const reserved = await reserveAiReview(database.db, 'g1', owner, 'short');
    await markAiReviewReady(database.db, 'g1', reserved.review.updated_at, 'private review');
    await logAnalyticsEvent(database.db, owner, 'ai_review_completed', { gameId: 'g1' });
    await logAnalyticsEvent(database.db, owner, 'payment_success', { purchaseId: 'purchase' });
    const before = await balance();
    expect(await deleteOwnedGame(database.db, 'g1', owner)).toEqual({ deleted: true, clientRequestId: 'create-key' });
    expect(await getGameById(database.db, 'g1', owner)).toBeNull();
    expect(await getAiReview(database.db, 'g1')).toBeNull();
    expect((await listGamesByUser(database.db, owner)).games).toEqual([]);
    expect(await balance()).toEqual(before);
    expect((await listAnalyticsEvents(database.db, owner)).map(row => row.event)).toEqual(['payment_success']);
    const receipt = database.sqlite.prepare('SELECT * FROM game_deletions').get();
    expect(Object.keys(receipt!)).toEqual(['game_id', 'telegram_id', 'client_request_id', 'deleted_at']);
  });

  it.each(['short', 'full'] as const)('refunds a pending %s review once, rejects late settlement and replay', async kind => {
    if (kind === 'full') await database.db.prepare('UPDATE user_balances SET paid_ai_reviews = 1 WHERE telegram_id = ?').bind(owner).run();
    const before = await balance();
    const { review } = await reserveAiReview(database.db, 'g1', owner, kind);
    await Promise.all([deleteOwnedGame(database.db, 'g1', owner), deleteOwnedGame(database.db, 'g1', owner)]);
    expect(await balance()).toMatchObject({ free_ai_reviews_remaining: before.free_ai_reviews_remaining, paid_ai_reviews: before.paid_ai_reviews });
    expect(await markAiReviewReady(database.db, 'g1', review.updated_at, 'late result')).toBe(false);
    expect(await failAiReviewAndRefund(database.db, 'g1', review.updated_at)).toBe(false);
    await expect(reserveAiReview(database.db, 'g1', owner, kind)).rejects.toThrow();
    expect(await getAiReview(database.db, 'g1')).toBeNull();
    await logAnalyticsEvent(database.db, owner, 'ai_review_completed', { gameId: 'g1' });
    expect(await listAnalyticsEvents(database.db, owner)).toEqual([]);
  });

  it('cannot recreate a deleted operation or spend another game credit', async () => {
    await deleteOwnedGame(database.db, 'g1', owner);
    await database.db.prepare('UPDATE user_balances SET paid_games = 2 WHERE telegram_id = ?').bind(owner).run();
    await expect(createGameWithCharge(database.db, { ...game(), id: 'g2' }, owner, 'create-key')).rejects.toBeInstanceOf(GameDeletedError);
    expect((await balance()).paid_games).toBe(2);
    expect((await createGameWithCharge(database.db, { ...game(), id: 'g3' }, owner, 'new-key')).created).toBe(true);
    expect((await balance()).paid_games).toBe(1);
  });

  it('cannot delete another owner’s game, review or analytics', async () => {
    await reserveAiReview(database.db, 'g1', owner, 'short');
    expect(await deleteOwnedGame(database.db, 'g1', '222')).toBeNull();
    expect(await getGameById(database.db, 'g1', owner)).not.toBeNull();
    expect((await getAiReview(database.db, 'g1'))?.status).toBe('pending');
    expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM game_deletions').get()?.n).toBe(0);
    expect((await balance()).free_ai_reviews_remaining).toBe(0);
  });

  it('rolls the refund and receipt back if content deletion fails', async () => {
    await reserveAiReview(database.db, 'g1', owner, 'short');
    database.sqlite.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON games BEGIN SELECT RAISE(ABORT, 'injected'); END");
    await expect(deleteOwnedGame(database.db, 'g1', owner)).rejects.toThrow('injected');
    expect(await getGameById(database.db, 'g1', owner)).not.toBeNull();
    expect((await getAiReview(database.db, 'g1'))?.status).toBe('pending');
    expect((await balance()).free_ai_reviews_remaining).toBe(0);
    expect(database.sqlite.prepare('SELECT COUNT(*) AS n FROM game_deletions').get()?.n).toBe(0);
    database.sqlite.exec('DROP TRIGGER fail_delete');
    await deleteOwnedGame(database.db, 'g1', owner);
    expect((await balance()).free_ai_reviews_remaining).toBe(1);
  });

  it('serializes deletion after a completed or failed attempt without a second refund', async () => {
    const { review } = await reserveAiReview(database.db, 'g1', owner, 'short');
    await failAiReviewAndRefund(database.db, 'g1', review.updated_at);
    await deleteOwnedGame(database.db, 'g1', owner);
    expect((await balance()).free_ai_reviews_remaining).toBe(1);
  });

  it('authenticates DELETE, keeps retries successful and returns 410 on the old creation key', async () => {
    const env = { DB: database.db, BOT_TOKEN: TEST_BOT_TOKEN } as Env;
    const ctx = { waitUntil() {} } as unknown as ExecutionContext;
    const request = (method: string, auth?: string, path = '/api/v1/games/g1', body?: string) => new Request(`https://example.com${path}`, { method, headers: auth ? { Authorization: auth } : {}, body });
    const auth = async (id: number) => `tma ${await buildSignedInitData({auth_date:freshAuthDate(), user:JSON.stringify({id})})}`;
    expect((await worker.fetch(request('DELETE'), env, ctx)).status).toBe(401);
    expect((await worker.fetch(request('DELETE', await auth(222)), env, ctx)).status).toBe(404);
    const headers = await auth(111);
    expect((await worker.fetch(request('DELETE', headers), env, ctx)).status).toBe(200);
    expect((await worker.fetch(request('DELETE', headers), env, ctx)).status).toBe(200);
    expect((await worker.fetch(request('GET', headers), env, ctx)).status).toBe(404);
    expect((await worker.fetch(request('POST', headers, '/api/v1/games', JSON.stringify({request:'private intention',diceMode:'virtual',clientRequestId:'create-key'})), env, ctx)).status).toBe(410);
    const cors = await worker.fetch(request('OPTIONS'), env, ctx);
    expect(cors.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });
});
