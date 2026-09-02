import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker, { type Env } from './index';
import { createFakeD1 } from './testUtils/fakeD1';
import { buildSignedInitData, freshAuthDate, TEST_BOT_TOKEN } from './testUtils/signInitData';
import { getOrCreateUserBalance } from './payments/repository';

function makeEnv(): Env {
  return { DB: createFakeD1(), BOT_TOKEN: TEST_BOT_TOKEN, WEBHOOK_SECRET: 'test-webhook-secret', GEMINI_API_KEY: 'test-gemini-key' };
}

async function authHeaderFor(telegramId: number): Promise<string> {
  const initData = await buildSignedInitData({
    auth_date: freshAuthDate(),
    user: JSON.stringify({ id: telegramId, first_name: 'Test' }),
  });
  return `tma ${initData}`;
}

/** Тестовый хелпер (батч 2): выдать пользователю большой запас купленных
 * партий, чтобы тесты, не относящиеся к монетизации (пагинация и т.п.), не
 * упирались в лимит бесплатных партий из §2 ТЗ. Не эмулирует реальную
 * покупку (нет записи в transactions) — только баланс, этого достаточно
 * для проверки остальной логики создания/чтения партий изолированно от
 * платежей. */
async function grantUnlimitedGamesForTest(env: Env, telegramId: number): Promise<void> {
  const id = String(telegramId);
  await getOrCreateUserBalance(env.DB, id);
  await env.DB.prepare('UPDATE user_balances SET paid_games = ? WHERE telegram_id = ?').bind(1000, id).run();
}

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`https://leela-worker.example.workers.dev${path}`, init);
}

// Response.json() типизирован строго (@cloudflare/workers-types), а тела
// ответов здесь произвольные JSON-объекты — этот хелпер лёгким образом
// снимает строгую типизацию только в тестах, не влияя на прод-код.
async function readJson(res: Response): Promise<any> {
  return res.json();
}

// ctx.waitUntil (батч 4): фоновая генерация ИИ-разбора запускается через
// него (см. index.ts:handleStartAiReview), а не await'ится синхронно в
// HTTP-ответе — тесты, проверяющие результат генерации, должны уметь
// детерминированно дождаться завершения фоновой задачи, а не полагаться на
// то, что микротаска успеет выполниться сама по себе до следующей проверки.
const pendingWaitUntil: Promise<unknown>[] = [];
const fakeCtx = {
  waitUntil(promise: Promise<unknown>) {
    pendingWaitUntil.push(promise);
  },
} as unknown as ExecutionContext;

async function flushWaitUntil(): Promise<void> {
  await Promise.allSettled(pendingWaitUntil.splice(0));
}

describe('worker routes', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.restoreAllMocks();
  });

  it('/api/v1/health отвечает без авторизации', async () => {
    const res = await worker.fetch(req('/api/v1/health'), env, fakeCtx);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.ok).toBe(true);
  });

  it('запрос к /api/v1/games без заголовка Authorization отклоняется 401', async () => {
    const res = await worker.fetch(req('/api/v1/games'), env, fakeCtx);
    expect(res.status).toBe(401);
  });

  it('запрос с некорректно подписанным initData отклоняется 401', async () => {
    const res = await worker.fetch(
      req('/api/v1/games', { headers: { Authorization: 'tma auth_date=1&user=%7B%22id%22%3A1%7D&hash=deadbeef' } }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(401);
  });

  it('создаёт партию и сразу возвращает её по id', async () => {
    const auth = await authHeaderFor(111);

    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'На чём мне сфокусироваться?', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    expect(createRes.status).toBe(201);
    const created = await readJson(createRes);
    expect(created.game.status).toBe('WAITING_FOR_BIRTH');
    expect(created.game.request).toBe('На чём мне сфокусироваться?');
    expect(created.game.rulesetId).toBe('classic-v1');

    const getRes = await worker.fetch(req(`/api/v1/games/${created.game.id}`, { headers: { Authorization: auth } }), env, fakeCtx);
    expect(getRes.status).toBe(200);
    const fetched = await readJson(getRes);
    expect(fetched.game.id).toBe(created.game.id);
  });

  it('партия недоступна другому telegram_id (404, не утечка чужих данных)', async () => {
    const ownerAuth = await authHeaderFor(222);
    const strangerAuth = await authHeaderFor(333);

    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: ownerAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);

    const strangerRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}`, { headers: { Authorization: strangerAuth } }),
      env,
      fakeCtx
    );
    expect(strangerRes.status).toBe(404);
  });

  it('список партий содержит только партии текущего пользователя', async () => {
    const authA = await authHeaderFor(444);
    const authB = await authHeaderFor(555);

    await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: authA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'a', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: authB, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'b', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );

    const listRes = await worker.fetch(req('/api/v1/games', { headers: { Authorization: authA } }), env, fakeCtx);
    const list = await readJson(listRes);
    expect(list.games).toHaveLength(1);
    expect(list.games[0].request).toBe('a');
  });

  it('физический режим: бросок обрабатывается и сохраняется', async () => {
    const auth = await authHeaderFor(666);

    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);

    const rollRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'e1', value: 6 }),
      }),
      env,
      fakeCtx
    );
    expect(rollRes.status).toBe(200);
    const rolled = await readJson(rollRes);
    expect(rolled.game.isBorn).toBe(true);
    expect(rolled.value).toBe(6);
    expect(rolled.events.some((e: { type: string }) => e.type === 'BIRTH_SUCCESS')).toBe(true);

    // Состояние реально записано в D1 — повторный GET видит уже обновлённую партию.
    const getRes = await worker.fetch(req(`/api/v1/games/${created.game.id}`, { headers: { Authorization: auth } }), env, fakeCtx);
    const fetched = await readJson(getRes);
    expect(fetched.game.isBorn).toBe(true);
  });

  it('повторный бросок с тем же clientEventId — идемпотентно (DUPLICATE_IGNORED, без повторного применения)', async () => {
    const auth = await authHeaderFor(777);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);

    const firstRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'same-id', value: 6 }),
      }),
      env,
      fakeCtx
    );
    const first = await readJson(firstRes);

    const secondRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'same-id', value: 6 }),
      }),
      env,
      fakeCtx
    );
    const second = await readJson(secondRes);

    expect(second.events).toEqual([{ type: 'DUPLICATE_IGNORED' }]);
    expect(second.game.currentCell).toBe(first.game.currentCell);
    // value на дубликате обязан быть ТЕМ ЖЕ, что реально выпало и было
    // сохранено при первом броске — не просто "какое-то число" (см. баг,
    // найден при ревью: раньше virtual-режим прогонял rollVirtualDice()
    // заново на каждый ретрай и возвращал случайное новое значение, хотя
    // сохранённое состояние партии не менялось).
    expect(second.value).toBe(first.value);
  });

  it('повторный бросок в virtual-режиме — value на дубликате берётся из сохранённого броска, а не генерируется заново', async () => {
    const auth = await authHeaderFor(778);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'virtual' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);

    const rollOnce = () =>
      worker
        .fetch(
          req(`/api/v1/games/${created.game.id}/rolls`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientEventId: 'virtual-same-id' }),
          }),
          env,
          fakeCtx
        )
        .then(readJson);

    const first = await rollOnce();
    const second = await rollOnce();

    expect(second.events).toEqual([{ type: 'DUPLICATE_IGNORED' }]);
    expect(second.value).toBe(first.value);
  });

  it('дубликат-ретрай с одновременно другим diceMode в теле — не применяет и не отражает смену режима (она не сохранена в БД)', async () => {
    const auth = await authHeaderFor(779);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);

    await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'mode-switch-id', value: 6 }),
      }),
      env,
      fakeCtx
    );

    // Ретрай того же clientEventId, но с diceMode: 'virtual' — имитирует
    // клиента, который между двумя попытками успел переключить режим.
    const retryRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'mode-switch-id', diceMode: 'virtual' }),
      }),
      env,
      fakeCtx
    );
    const retry = await readJson(retryRes);

    expect(retry.events).toEqual([{ type: 'DUPLICATE_IGNORED' }]);
    // Режим в БД не должен был поменяться — GET партии обязан вернуть
    // всё ещё 'physical', а не 'virtual' из проигнорированного ретрая.
    const getRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}`, { headers: { Authorization: auth } }),
      env,
      fakeCtx
    );
    const fetched = await readJson(getRes);
    expect(fetched.game.diceMode).toBe('physical');
  });

  it('виртуальный режим: значение генерирует сервер, любой value от клиента игнорируется', async () => {
    // Math.random зафиксирован так, чтобы rollVirtualDice() вернул ровно 6
    // (birth.requiredValue) — детерминированно проверяем, что использовано
    // именно СЕРВЕРНОЕ значение, а не подсунутое клиентом value: 1.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    const auth = await authHeaderFor(888);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'virtual' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);

    const rollRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        // Клиент нечестно присылает value: 1 — сервер обязан его проигнорировать.
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'e1', value: 1 }),
      }),
      env,
      fakeCtx
    );
    const rolled = await readJson(rollRes);
    expect(rolled.game.isBorn).toBe(true); // родилась бы только от 6, не от подсунутой 1
    expect(rolled.value).toBe(6); // сервер вернул СВОЁ значение, не клиентскую подделку (1)
  });

  it('переключение diceMode во время партии (п.1): бросок с diceMode="physical" переводит партию с виртуального режима на физический и использует value из запроса', async () => {
    // Партия создана виртуальной — если бы сервер игнорировал diceMode из
    // тела ролла (старый баг), он бы сам сгенерировал случайное значение и
    // отбросил бы руками введённую грань 6.
    vi.spyOn(Math, 'random').mockReturnValue(0); // виртуальный бросок дал бы 1, не 6
    const auth = await authHeaderFor(1010);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'virtual' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);
    expect(created.game.diceMode).toBe('virtual');

    const rollRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'e1', value: 6, diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    expect(rollRes.status).toBe(200);
    const rolled = await readJson(rollRes);
    expect(rolled.value).toBe(6); // использована человеком выбранная грань, а не серверный рандом
    expect(rolled.game.diceMode).toBe('physical');
    expect(rolled.game.isBorn).toBe(true);

    // Новый режим реально сохранён в D1, а не только в ответе на этот запрос.
    const getRes = await worker.fetch(req(`/api/v1/games/${created.game.id}`, { headers: { Authorization: auth } }), env, fakeCtx);
    const fetched = await readJson(getRes);
    expect(fetched.game.diceMode).toBe('physical');
  });

  it('переключение diceMode во время партии (п.1): бросок с diceMode="virtual" переводит партию с физического режима на виртуальный без ожидания value от клиента', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // виртуальный бросок даёт 6
    const auth = await authHeaderFor(1011);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);
    expect(created.game.diceMode).toBe('physical');

    // Раньше (баг) такой запрос без value упал бы с 400, потому что сервер
    // всё ещё считал партию физической и требовал руками введённое значение.
    const rollRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'e1', diceMode: 'virtual' }),
      }),
      env,
      fakeCtx
    );
    expect(rollRes.status).toBe(200);
    const rolled = await readJson(rollRes);
    expect(rolled.value).toBe(6);
    expect(rolled.game.diceMode).toBe('virtual');
  });

  it('роллс с некорректным diceMode отклоняется 400', async () => {
    const auth = await authHeaderFor(1012);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);

    const rollRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'e1', value: 6, diceMode: 'bogus' }),
      }),
      env,
      fakeCtx
    );
    expect(rollRes.status).toBe(400);
  });

  it('завершённая партия отклоняет новые броски (409)', async () => {
    const auth = await authHeaderFor(999);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);

    // Рождаем и доводим фишку до финиша (клетка 68) серией не-шестёрок,
    // чтобы не зависеть от случайности и не ловить лишний EXTRA_ROLL_GRANTED.
    await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'birth', value: 6 }),
      }),
      env,
      fakeCtx
    );

    // currentCell = 1 после рождения. Заранее просчитанный путь до клетки 68
    // (1 + сумма шагов = 68), НЕ содержащий значение 6 (чтобы не задействовать
    // правило шестёрок) и не приземляющийся ТОЧНО ни на одну клетку-источник
    // змеи/стрелы из classic-v1.json (иначе сработает переход и путь собьётся):
    // источники — 10,12,16,17,20,22,24,27,28,29,37,44,45,46,52,54,55,61,63,72.
    // Промежуточные клетки маршрута: 6,11,15,19,23,26,31,36,41,43,48,53,58,62,67,68 — все безопасны.
    const steps = [5, 5, 4, 4, 4, 3, 5, 5, 5, 2, 5, 5, 5, 4, 5, 1];
    let lastBody: any = null;
    for (let i = 0; i < steps.length; i++) {
      const res = await worker.fetch(
        req(`/api/v1/games/${created.game.id}/rolls`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientEventId: `step-${i}`, value: steps[i] }),
        }),
        env,
        fakeCtx
      );
      lastBody = await readJson(res);
    }
    expect(lastBody?.game.currentCell).toBe(68);
    expect(lastBody?.game.status).toBe('FINISHED');

    const afterFinish = await worker.fetch(
      req(`/api/v1/games/${created.game.id}`, { headers: { Authorization: auth } }),
      env,
      fakeCtx
    );
    const finishedGame = await readJson(afterFinish);
    expect(finishedGame.game.status).toBe('FINISHED');

    const rejectedRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'after-finish', value: 3 }),
      }),
      env,
      fakeCtx
    );
    expect(rejectedRes.status).toBe(409);
  });

  it('optimistic concurrency: конфликт версии при записи возвращает 409, а не тихо теряет бросок', async () => {
    // Настоящую гонку двух параллельных запросов в однопоточном тесте не
    // устроить (каждый handleRoll сам читает САМУЮ свежую версию перед
    // записью — если бы мы просто заранее продвинули версию другим
    // запросом, второй запрос эту свежую версию и прочитал бы, конфликта
    // не было бы). Поэтому конфликт имитируем напрямую: подменяем
    // updateGame() на один вызов так, будто конкурентная запись успела
    // произойти МЕЖДУ чтением и записью текущего запроса — это и есть тот
    // самый сценарий, который optimistic concurrency обязан ловить.
    const repo = await import('./games/repository');
    const auth = await authHeaderFor(1300);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);

    const updateSpy = vi.spyOn(repo, 'updateGame').mockResolvedValueOnce({ success: false });

    const rollRes = await worker.fetch(
      req(`/api/v1/games/${created.game.id}/rolls`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEventId: 'birth', value: 6 }),
      }),
      env,
      fakeCtx
    );
    expect(rollRes.status).toBe(409);
    const body = await readJson(rollRes);
    expect(body.error).toBe('version_conflict');
    updateSpy.mockRestore();

    // Партия в БД НЕ должна была измениться — конфликтный бросок не применён.
    const afterConflict = await worker.fetch(
      req(`/api/v1/games/${created.game.id}`, { headers: { Authorization: auth } }),
      env,
      fakeCtx
    );
    const stillUnborn = await readJson(afterConflict);
    expect(stillUnborn.game.isBorn).toBe(false);
    expect(stillUnborn.game.status).toBe('WAITING_FOR_BIRTH');
  });

  it('optimistic concurrency: реальный (не замоканный) конфликт версии в repository.updateGame — устаревшая expectedVersion не проходит условный UPDATE', async () => {
    const repo = await import('./games/repository');
    const auth = await authHeaderFor(1301);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);
    const telegramId = String(1301);

    // Первое обновление с верной version=1 — должно пройти.
    const first = await repo.updateGame(env.DB, { ...created.game, request: 'изменено-1' }, telegramId, 1);
    expect(first.success).toBe(true);

    // Повторное обновление с ТОЙ ЖЕ (уже устаревшей) version=1 — версия в
    // БД уже стала 2 после первого успешного апдейта, условный UPDATE не
    // должен задеть ни одной строки.
    const second = await repo.updateGame(env.DB, { ...created.game, request: 'изменено-2' }, telegramId, 1);
    expect(second.success).toBe(false);
  });

  it('пагинация: limit ограничивает размер страницы, nextCursor ведёт на следующую, на последней странице nextCursor = null', async () => {
    const auth = await authHeaderFor(1400);
    // Тест про пагинацию, не про лимит бесплатных партий (§2 ТЗ по
    // монетизации, батч 2) — создаём 5 партий подряд для одного
    // пользователя, поэтому сначала выдаём тестовый запас, чтобы 402 на
    // 3-й партии не мешал проверять именно keyset-пагинацию.
    await grantUnlimitedGamesForTest(env, 1400);
    const requests = ['p1', 'p2', 'p3', 'p4', 'p5'];
    for (const r of requests) {
      await worker.fetch(
        req('/api/v1/games', {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: r, diceMode: 'physical' }),
        }),
        env,
        fakeCtx
      );
    }

    const seenIds = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = cursor ? `/api/v1/games?limit=2&cursor=${encodeURIComponent(cursor)}` : '/api/v1/games?limit=2';
      const res = await worker.fetch(req(url, { headers: { Authorization: auth } }), env, fakeCtx);
      expect(res.status).toBe(200);
      const body = await readJson(res);
      expect(body.games.length).toBeLessThanOrEqual(2);
      for (const g of body.games) {
        expect(seenIds.has(g.id)).toBe(false); // ни одна партия не должна повториться между страницами
        seenIds.add(g.id);
      }
      cursor = body.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(10); // защита от бесконечного цикла, если пагинация сломана
    } while (cursor);

    expect(seenIds.size).toBe(requests.length);
    expect(pages).toBe(3); // 5 партий по 2 на страницу -> 2,2,1
  });

  it('пагинация: некорректный limit (не число / <1) отклоняется 400', async () => {
    const auth = await authHeaderFor(1401);
    const res = await worker.fetch(req('/api/v1/games?limit=abc', { headers: { Authorization: auth } }), env, fakeCtx);
    expect(res.status).toBe(400);

    const res2 = await worker.fetch(req('/api/v1/games?limit=0', { headers: { Authorization: auth } }), env, fakeCtx);
    expect(res2.status).toBe(400);
  });

  it('пагинация: некорректный cursor отклоняется 400, а не тихо отдаёт первую страницу (баг, найден при ревью)', async () => {
    const auth = await authHeaderFor(1403);
    await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'one', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const res = await worker.fetch(
      req('/api/v1/games?cursor=not-valid-base64-not-a-real-cursor', { headers: { Authorization: auth } }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error).toBe('invalid_query');
  });

  it('пагинация: limit сверх потолка (100) не отклоняется, а тихо ужимается сервером', async () => {
    const auth = await authHeaderFor(1402);
    await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'only-one', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const res = await worker.fetch(req('/api/v1/games?limit=99999', { headers: { Authorization: auth } }), env, fakeCtx);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.games).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
  });
});

describe('/telegram/webhook routing', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.restoreAllMocks();
  });

  it('GET на /telegram/webhook отклоняется 405 (Telegram шлёт только POST)', async () => {
    const res = await worker.fetch(req('/telegram/webhook'), env, fakeCtx);
    expect(res.status).toBe(405);
  });

  it('POST с неверным секретом отклоняется 401, минуя авторизацию initData (разные механизмы)', async () => {
    const res = await worker.fetch(
      req('/telegram/webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong', 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 1 }),
      }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(401);
  });

  it('POST с верным секретом и /start доходит до обработчика и отвечает 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await worker.fetch(
      req('/telegram/webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': env.WEBHOOK_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: '/start' } }),
      }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('монетизация (батч 1) — /api/v1/products и /api/v1/entitlements', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.restoreAllMocks();
  });

  it('/api/v1/products без авторизации — 401', async () => {
    const res = await worker.fetch(req('/api/v1/products'), env, fakeCtx);
    expect(res.status).toBe(401);
  });

  it('/api/v1/products возвращает все 5 продуктов каталога', async () => {
    const auth = await authHeaderFor(9001);
    const res = await worker.fetch(req('/api/v1/products', { headers: { Authorization: auth } }), env, fakeCtx);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.products).toHaveLength(5);
    expect(body.products.map((p: { id: string }) => p.id).sort()).toEqual(
      ['ai_review_1', 'game_1', 'game_5', 'game_ai_combo', 'subscription_unlimited'].sort()
    );
  });

  it('/api/v1/products с POST — 405', async () => {
    const auth = await authHeaderFor(9001);
    const res = await worker.fetch(req('/api/v1/products', { method: 'POST', headers: { Authorization: auth } }), env, fakeCtx);
    expect(res.status).toBe(405);
  });

  it('/api/v1/entitlements без авторизации — 401', async () => {
    const res = await worker.fetch(req('/api/v1/entitlements'), env, fakeCtx);
    expect(res.status).toBe(401);
  });

  it('/api/v1/entitlements для нового пользователя — дефолты §2 ТЗ, можно и партию, и разбор', async () => {
    const auth = await authHeaderFor(9002);
    const res = await worker.fetch(req('/api/v1/entitlements', { headers: { Authorization: auth } }), env, fakeCtx);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toEqual({
      freeGamesRemaining: 2,
      paidGames: 0,
      freeAiReviewsRemaining: 1,
      paidAiReviews: 0,
      subscription: null,
      canStartGame: true,
      canStartAiReview: true,
    });
  });

  it('/api/v1/entitlements — повторный запрос не сбрасывает и не меняет баланс (чистое чтение)', async () => {
    const auth = await authHeaderFor(9003);
    const first = await readJson(await worker.fetch(req('/api/v1/entitlements', { headers: { Authorization: auth } }), env, fakeCtx));
    const second = await readJson(await worker.fetch(req('/api/v1/entitlements', { headers: { Authorization: auth } }), env, fakeCtx));
    expect(second).toEqual(first);
  });

  it('/api/v1/entitlements изолирован по пользователю (разные telegram_id не делят баланс)', async () => {
    const authA = await authHeaderFor(9004);
    const authB = await authHeaderFor(9005);
    const a = await readJson(await worker.fetch(req('/api/v1/entitlements', { headers: { Authorization: authA } }), env, fakeCtx));
    const b = await readJson(await worker.fetch(req('/api/v1/entitlements', { headers: { Authorization: authB } }), env, fakeCtx));
    expect(a.freeGamesRemaining).toBe(2);
    expect(b.freeGamesRemaining).toBe(2);
  });
});

describe('монетизация (батч 2) — списание партий, paywall, идемпотентность создания', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.restoreAllMocks();
  });

  async function createGame(auth: string, extra: Record<string, unknown> = {}) {
    const res = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical', ...extra }),
      }),
      env,
      fakeCtx
    );
    return { res, body: await readJson(res) };
  }

  async function entitlementsFor(auth: string) {
    return readJson(await worker.fetch(req('/api/v1/entitlements', { headers: { Authorization: auth } }), env, fakeCtx));
  }

  it('первые 2 партии — бесплатно, списывается freeGamesRemaining (§2 ТЗ)', async () => {
    const auth = await authHeaderFor(20001);
    const { res: res1 } = await createGame(auth);
    expect(res1.status).toBe(201);
    expect((await entitlementsFor(auth)).freeGamesRemaining).toBe(1);

    const { res: res2 } = await createGame(auth);
    expect(res2.status).toBe(201);
    expect((await entitlementsFor(auth)).freeGamesRemaining).toBe(0);
  });

  it('3-я партия без баланса — 402 games_limit_reached с каталогом продуктов, партия НЕ создаётся', async () => {
    const auth = await authHeaderFor(20002);
    await createGame(auth);
    await createGame(auth);
    const { res, body } = await createGame(auth);
    expect(res.status).toBe(402);
    expect(body.error).toBe('games_limit_reached');
    expect(body.products.length).toBeGreaterThan(0);
    expect(body.products.every((p: { grant: { games: number }; isSubscription: boolean }) => p.grant.games > 0 || p.isSubscription)).toBe(true);

    const list = await readJson(await worker.fetch(req('/api/v1/games', { headers: { Authorization: auth } }), env, fakeCtx));
    expect(list.games).toHaveLength(2);
  });

  it('повторный POST с тем же clientRequestId возвращает ту же партию и НЕ списывает баланс дважды', async () => {
    const auth = await authHeaderFor(20003);
    const { res: res1, body: body1 } = await createGame(auth, { clientRequestId: 'same-id' });
    expect(res1.status).toBe(201);
    expect((await entitlementsFor(auth)).freeGamesRemaining).toBe(1);

    const { res: res2, body: body2 } = await createGame(auth, { clientRequestId: 'same-id' });
    expect(res2.status).toBe(200);
    expect(body2.game.id).toBe(body1.game.id);
    // Баланс не должен был списаться второй раз за тот же clientRequestId.
    expect((await entitlementsFor(auth)).freeGamesRemaining).toBe(1);
  });

  it('разные clientRequestId — разные партии, баланс списывается за каждую', async () => {
    const auth = await authHeaderFor(20004);
    const { body: body1 } = await createGame(auth, { clientRequestId: 'id-1' });
    const { body: body2 } = await createGame(auth, { clientRequestId: 'id-2' });
    expect(body1.game.id).not.toBe(body2.game.id);
    expect((await entitlementsFor(auth)).freeGamesRemaining).toBe(0);
  });

  it('после исчерпания free — списывается paidGames (§9 ТЗ, приоритет free -> paid)', async () => {
    const auth = await authHeaderFor(20005);
    await createGame(auth);
    await createGame(auth);
    await env.DB.prepare('UPDATE user_balances SET paid_games = ? WHERE telegram_id = ?').bind(3, String(20005)).run();

    const { res } = await createGame(auth);
    expect(res.status).toBe(201);
    const entitlements = await entitlementsFor(auth);
    expect(entitlements.freeGamesRemaining).toBe(0);
    expect(entitlements.paidGames).toBe(2);
  });

  it('активная подписка — партия создаётся без списания free/paid счётчиков вообще (§3.3, §18 ТЗ)', async () => {
    const auth = await authHeaderFor(20006);
    const telegramId = String(20006);
    await getOrCreateUserBalance(env.DB, telegramId);
    await env.DB
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-1', telegramId, Date.now() + 1000 * 60 * 60 * 24 * 30, 1, Date.now(), Date.now())
      .run();

    const { res } = await createGame(auth);
    expect(res.status).toBe(201);
    const entitlements = await entitlementsFor(auth);
    expect(entitlements.freeGamesRemaining).toBe(2); // не тронуто
    expect(entitlements.paidGames).toBe(0); // не тронуто
    expect(entitlements.subscription?.active).toBe(true);
  });

  it('приоритет §3.3: активная подписка используется ПЕРЕД бесплатными партиями (free остаётся нетронутым)', async () => {
    const auth = await authHeaderFor(20007);
    const telegramId = String(20007);
    await getOrCreateUserBalance(env.DB, telegramId); // free_games_remaining = 2
    await env.DB
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-1', telegramId, Date.now() + 1000 * 60 * 60 * 24 * 30, 1, Date.now(), Date.now())
      .run();

    await createGame(auth);
    expect((await entitlementsFor(auth)).freeGamesRemaining).toBe(2);
  });

  it('запрос без clientRequestId (обратная совместимость со старым фронтом) — партия создаётся, сервер сам генерирует id', async () => {
    const auth = await authHeaderFor(20008);
    const { res, body } = await createGame(auth);
    expect(res.status).toBe(201);
    expect(typeof body.game.id).toBe('string');
  });

  it('конфликт версии баланса (гонка) — 409, а не тихая порча счёта', async () => {
    const auth = await authHeaderFor(20009);
    const telegramId = String(20009);
    await getOrCreateUserBalance(env.DB, telegramId);
    // Меняем версию баланса "из-под ног" между чтением и записью —
    // эмулирует параллельный запрос, который уже успел списать раньше нас.
    const originalPrepare = env.DB.prepare.bind(env.DB);
    let intercepted = false;
    vi.spyOn(env.DB, 'prepare').mockImplementation((query: string) => {
      const stmt = originalPrepare(query);
      if (!intercepted && query.trim().startsWith('UPDATE user_balances SET free_games_remaining = free_games_remaining - 1')) {
        intercepted = true;
        return {
          ...stmt,
          bind: (...args: unknown[]) => {
            // Гонка: конкурентный запрос "успевает" поднять version раньше нас.
            void env.DB.prepare('UPDATE user_balances SET version = ? WHERE telegram_id = ?').bind(999, telegramId).run();
            return stmt.bind(...args);
          },
        } as D1PreparedStatement;
      }
      return stmt;
    });

    const { res, body } = await createGame(auth);
    expect(res.status).toBe(409);
    expect(body.error).toBe('version_conflict');
  });
});

describe('монетизация (батч 3, найденный пробел покрываем сейчас) — POST /api/v1/payments/invoice', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.restoreAllMocks();
  });

  it('без авторизации — 401', async () => {
    const res = await worker.fetch(req('/api/v1/payments/invoice', { method: 'POST' }), env, fakeCtx);
    expect(res.status).toBe(401);
  });

  it('неизвестный productId — 400', async () => {
    const auth = await authHeaderFor(30001);
    const res = await worker.fetch(
      req('/api/v1/payments/invoice', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 'no-such-product' }),
      }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(400);
  });

  it('валидный productId — создаёт транзакцию и возвращает invoiceUrl из createInvoiceLink', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: 'https://t.me/invoice/abc' }), { status: 200 })
    );
    const auth = await authHeaderFor(30002);
    const res = await worker.fetch(
      req('/api/v1/payments/invoice', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 'game_5' }),
      }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.invoiceUrl).toBe('https://t.me/invoice/abc');

    // Тело запроса к Bot API должно нести цену/название именно этого продукта.
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.prices[0].amount).toBe(299);
    expect(sentBody.currency).toBe('XTR');
  });

  it('§20 ТЗ: попытка купить подписку при уже активной подписке — 400 subscription_already_active, invoice НЕ создаётся', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, result: 'https://t.me/invoice/x' }), { status: 200 }));
    const auth = await authHeaderFor(30003);
    const telegramId = String(30003);
    await getOrCreateUserBalance(env.DB, telegramId);
    await env.DB
      .prepare('INSERT INTO subscriptions (id, telegram_id, period_end, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('sub-1', telegramId, Date.now() + 100000, 1, Date.now(), Date.now())
      .run();

    const res = await worker.fetch(
      req('/api/v1/payments/invoice', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 'subscription_unlimited' }),
      }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error).toBe('subscription_already_active');
    expect(fetchSpy).not.toHaveBeenCalled(); // дешевле отклонить локально, не дошли до Bot API
  });

  it('продукт-подписка без активной подписки — invoice создаётся с subscription_period', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: 'https://t.me/invoice/sub' }), { status: 200 })
    );
    const auth = await authHeaderFor(30004);
    const res = await worker.fetch(
      req('/api/v1/payments/invoice', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 'subscription_unlimited' }),
      }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(200);
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.subscription_period).toBe(2592000);
  });
});

describe('монетизация (батч 4) — ИИ-разбор партии (Gemini)', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    vi.restoreAllMocks();
    pendingWaitUntil.length = 0;
  });

  function geminiOk(text: string): Response {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
  }

  async function createFinishedGame(auth: string, telegramId: number): Promise<string> {
    await grantUnlimitedGamesForTest(env, telegramId);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);
    // Напрямую метим партию завершённой — не гонять реальный движок до
    // финиша ради теста, который проверяет саму механику ИИ-разбора, а не
    // игровую логику (она уже покрыта gameEngine.test.ts).
    await env.DB.prepare("UPDATE games SET status = 'FINISHED' WHERE id = ?").bind(created.game.id).run();
    return created.game.id as string;
  }

  it('партия не найдена — 404', async () => {
    const auth = await authHeaderFor(40001);
    const res = await worker.fetch(req('/api/v1/games/no-such-game/analysis/start', { method: 'POST', headers: { Authorization: auth } }), env, fakeCtx);
    expect(res.status).toBe(404);
  });

  it('партия ещё не завершена — 400 invalid_state, баланс не трогается', async () => {
    const auth = await authHeaderFor(40002);
    await grantUnlimitedGamesForTest(env, 40002);
    const createRes = await worker.fetch(
      req('/api/v1/games', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'test', diceMode: 'physical' }),
      }),
      env,
      fakeCtx
    );
    const created = await readJson(createRes);

    const res = await worker.fetch(
      req(`/api/v1/games/${created.game.id}/analysis/start`, { method: 'POST', headers: { Authorization: auth } }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('invalid_state');

    const entitlements = await readJson(await worker.fetch(req('/api/v1/entitlements', { headers: { Authorization: auth } }), env, fakeCtx));
    expect(entitlements.freeAiReviewsRemaining).toBe(1); // не списано
  });

  it('успешная генерация: pending сразу, ready после фоновой задачи, баланс списан один раз', async () => {
    // Управляемый fetch — не резолвится сам по себе, иначе фоновая задача
    // (ctx.waitUntil) успевает завершиться раньше следующего await в тесте
    // (микротаски мока без реальной задержки I/O разрешаются практически
    // мгновенно), и "pending"-окно нечем поймать детерминированно.
    let resolveFetch!: (value: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockReturnValue(pendingFetch);

    const auth = await authHeaderFor(40003);
    const gameId = await createFinishedGame(auth, 40003);

    const startRes = await worker.fetch(
      req(`/api/v1/games/${gameId}/analysis/start`, { method: 'POST', headers: { Authorization: auth } }),
      env,
      fakeCtx
    );
    expect(startRes.status).toBe(202);
    expect((await readJson(startRes)).status).toBe('pending');

    const pendingGet = await readJson(await worker.fetch(req(`/api/v1/games/${gameId}/analysis`, { headers: { Authorization: auth } }), env, fakeCtx));
    expect(pendingGet.status).toBe('pending');

    resolveFetch(geminiOk('Твой путь начался с рождения и привёл к заблуждению...'));
    await flushWaitUntil();

    const readyGet = await readJson(await worker.fetch(req(`/api/v1/games/${gameId}/analysis`, { headers: { Authorization: auth } }), env, fakeCtx));
    expect(readyGet.status).toBe('ready');
    expect(readyGet.content.length).toBeGreaterThan(0);

    const entitlements = await readJson(await worker.fetch(req('/api/v1/entitlements', { headers: { Authorization: auth } }), env, fakeCtx));
    expect(entitlements.freeAiReviewsRemaining).toBe(0);
  });

  it('повторный запрос после ready — не списывает баланс снова, отдаёт кэш', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiOk('Готовый разбор'));
    const auth = await authHeaderFor(40004);
    const gameId = await createFinishedGame(auth, 40004);

    await worker.fetch(req(`/api/v1/games/${gameId}/analysis/start`, { method: 'POST', headers: { Authorization: auth } }), env, fakeCtx);
    await flushWaitUntil();

    const secondStart = await worker.fetch(
      req(`/api/v1/games/${gameId}/analysis/start`, { method: 'POST', headers: { Authorization: auth } }),
      env,
      fakeCtx
    );
    expect(secondStart.status).toBe(200);
    const body = await readJson(secondStart);
    expect(body.status).toBe('ready');
    expect(body.content).toBe('Готовый разбор');

    const entitlements = await readJson(await worker.fetch(req('/api/v1/entitlements', { headers: { Authorization: auth } }), env, fakeCtx));
    expect(entitlements.freeAiReviewsRemaining).toBe(0); // списано один раз, не два
  });

  it('повторный клик пока ещё pending — 409 already_generating, не запускает вторую генерацию', async () => {
    let resolveFetch!: (value: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockReturnValue(pendingFetch);

    const auth = await authHeaderFor(40005);
    const gameId = await createFinishedGame(auth, 40005);

    await worker.fetch(req(`/api/v1/games/${gameId}/analysis/start`, { method: 'POST', headers: { Authorization: auth } }), env, fakeCtx);
    // fetch ещё "висит" — генерация реально не завершена, второй клик
    // застаёт настоящий pending, а не то, что уже успело стать ready.
    const secondRes = await worker.fetch(
      req(`/api/v1/games/${gameId}/analysis/start`, { method: 'POST', headers: { Authorization: auth } }),
      env,
      fakeCtx
    );
    expect(secondRes.status).toBe(409);
    expect((await readJson(secondRes)).error).toBe('already_generating');

    resolveFetch(geminiOk('Разбор'));
    await flushWaitUntil();
    const entitlements = await readJson(await worker.fetch(req('/api/v1/entitlements', { headers: { Authorization: auth } }), env, fakeCtx));
    expect(entitlements.freeAiReviewsRemaining).toBe(0); // списано ровно один раз
  });

  it('баланс исчерпан (free и paid = 0) — 402 analysis_locked, партия не помечается pending', async () => {
    const auth = await authHeaderFor(40006);
    const gameId = await createFinishedGame(auth, 40006);
    await env.DB.prepare('UPDATE user_balances SET free_ai_reviews_remaining = 0 WHERE telegram_id = ?').bind(String(40006)).run();

    const res = await worker.fetch(
      req(`/api/v1/games/${gameId}/analysis/start`, { method: 'POST', headers: { Authorization: auth } }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(402);
    expect((await readJson(res)).error).toBe('analysis_locked');

    const getRes = await readJson(await worker.fetch(req(`/api/v1/games/${gameId}/analysis`, { headers: { Authorization: auth } }), env, fakeCtx));
    expect(getRes.status).toBe('none');
  });

  it('§12 ТЗ: сбой Gemini — статус failed И баланс возвращается на счётчик, с которого списали', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));
    const auth = await authHeaderFor(40007);
    const gameId = await createFinishedGame(auth, 40007);

    await worker.fetch(req(`/api/v1/games/${gameId}/analysis/start`, { method: 'POST', headers: { Authorization: auth } }), env, fakeCtx);
    await flushWaitUntil();

    const getRes = await readJson(await worker.fetch(req(`/api/v1/games/${gameId}/analysis`, { headers: { Authorization: auth } }), env, fakeCtx));
    expect(getRes.status).toBe('failed');
    expect(getRes.error).toContain('429');

    const entitlements = await readJson(await worker.fetch(req('/api/v1/entitlements', { headers: { Authorization: auth } }), env, fakeCtx));
    expect(entitlements.freeAiReviewsRemaining).toBe(1); // возвращён — не потерян
  });

  it('после сбоя и возврата баланса — повторная попытка снова списывает и может завершиться успехом', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(new Response('fail', { status: 500 }));
    const auth = await authHeaderFor(40008);
    const gameId = await createFinishedGame(auth, 40008);

    await worker.fetch(req(`/api/v1/games/${gameId}/analysis/start`, { method: 'POST', headers: { Authorization: auth } }), env, fakeCtx);
    await flushWaitUntil();
    expect((await readJson(await worker.fetch(req(`/api/v1/games/${gameId}/analysis`, { headers: { Authorization: auth } }), env, fakeCtx))).status).toBe(
      'failed'
    );

    fetchMock.mockResolvedValueOnce(geminiOk('Успешный повтор'));
    await worker.fetch(req(`/api/v1/games/${gameId}/analysis/start`, { method: 'POST', headers: { Authorization: auth } }), env, fakeCtx);
    await flushWaitUntil();

    const finalGet = await readJson(await worker.fetch(req(`/api/v1/games/${gameId}/analysis`, { headers: { Authorization: auth } }), env, fakeCtx));
    expect(finalGet.status).toBe('ready');
    expect(finalGet.content).toBe('Успешный повтор');
  });

  it('чужая партия — 404, а не доступ к чужому разбору', async () => {
    const authOwner = await authHeaderFor(40009);
    const gameId = await createFinishedGame(authOwner, 40009);
    const authStranger = await authHeaderFor(40010);

    const res = await worker.fetch(
      req(`/api/v1/games/${gameId}/analysis`, { headers: { Authorization: authStranger } }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(404);
  });
});
