import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker, { type Env } from './index';
import { createFakeD1 } from './testUtils/fakeD1';
import { buildSignedInitData, freshAuthDate, TEST_BOT_TOKEN } from './testUtils/signInitData';

function makeEnv(): Env {
  return { DB: createFakeD1(), BOT_TOKEN: TEST_BOT_TOKEN, WEBHOOK_SECRET: 'test-webhook-secret' };
}

async function authHeaderFor(telegramId: number): Promise<string> {
  const initData = await buildSignedInitData({
    auth_date: freshAuthDate(),
    user: JSON.stringify({ id: telegramId, first_name: 'Test' }),
  });
  return `tma ${initData}`;
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

const fakeCtx = {} as ExecutionContext;

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
    // На дубликате value просто отражает то, что было прислано в ЭТОМ
    // запросе (клиент код это не показывает пользователю — см.
    // FLASH_EVENT_LABELS.DUPLICATE_IGNORED), важно лишь что поле есть и
    // валидно по форме контракта ответа.
    expect(typeof second.value).toBe('number');
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
