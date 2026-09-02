/**
 * Лёгкий in-memory заменитель D1Database для тестов.
 * НЕ настоящий SQL-движок — просто узнаёт конкретные запросы, которые
 * реально шлёт worker/src/games/repository.ts, и эмулирует их поведение
 * над массивом объектов в памяти. Этого достаточно, чтобы прогнать роуты
 * index.ts целиком (auth -> repository -> gameEngine -> response) без
 * реального Cloudflare-биндинга, которого нет вне деплоя.
 */
export function createFakeD1(): D1Database {
  const rows: Array<Record<string, unknown>> = [];
  // Монетизация (батч 1) — отдельные in-memory "таблицы" для новых сущностей.
  // balanceRows.telegram_id уникален (эмулирует PRIMARY KEY + ON CONFLICT DO
  // NOTHING из payments/repository.ts:getOrCreateUserBalance).
  const balanceRows: Array<Record<string, unknown>> = [];
  // subscriptionRows заполняются в тестах напрямую через INSERT (реального
  // кода вставки подписок в батче 1 ещё нет — появится в батче 3, вместе с
  // обработкой successful_payment); формат строки уже зафиксирован под
  // payments/repository.ts:SubscriptionRow.
  const subscriptionRows: Array<Record<string, unknown>> = [];
  // transactionRows (батч 3) — история платежей, см.
  // payments/repository.ts:TransactionRow.
  const transactionRows: Array<Record<string, unknown>> = [];
  // aiReviewRows (батч 4) — см. ai/reviewRepository.ts:AiReviewRow.
  // game_id уникален (PRIMARY KEY, эмулирует ON CONFLICT(game_id) DO UPDATE).
  const aiReviewRows: Array<Record<string, unknown>> = [];

  function prepare(query: string) {
    let bound: unknown[] = [];
    const normalized = query.trim();

    const stmt = {
      bind(...values: unknown[]) {
        bound = values;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        if (normalized.startsWith('SELECT 1')) {
          return 1 as unknown as T;
        }
        if (normalized.startsWith('SELECT * FROM games WHERE telegram_id = ? AND client_request_id = ?')) {
          const [telegramId, clientRequestId] = bound as [string, string];
          const row = rows.find((r) => r.telegram_id === telegramId && r.client_request_id === clientRequestId);
          return (row as T) ?? null;
        }
        if (normalized.startsWith('SELECT * FROM games WHERE id = ? AND telegram_id = ?')) {
          const [id, telegramId] = bound as [string, string];
          const row = rows.find((r) => r.id === id && r.telegram_id === telegramId);
          return (row as T) ?? null;
        }
        if (normalized.startsWith('SELECT * FROM user_balances WHERE telegram_id = ?')) {
          const [telegramId] = bound as [string];
          const row = balanceRows.find((r) => r.telegram_id === telegramId);
          return (row as T) ?? null;
        }
        if (normalized.startsWith('SELECT * FROM subscriptions WHERE telegram_id = ?')) {
          // ORDER BY period_end DESC LIMIT 1 — эмулируем сортировку явно, а
          // не просто берём первую вставленную: тесты специально проверяют
          // порядок (см. payments/repository.test.ts).
          const [telegramId] = bound as [string];
          const matches = subscriptionRows.filter((r) => r.telegram_id === telegramId);
          if (matches.length === 0) return null;
          const latest = matches.slice().sort((a, b) => (b.period_end as number) - (a.period_end as number))[0];
          return (latest as T) ?? null;
        }
        if (normalized.startsWith('SELECT * FROM transactions WHERE id = ?')) {
          const [id] = bound as [string];
          const row = transactionRows.find((r) => r.id === id);
          return (row as T) ?? null;
        }
        if (normalized.startsWith('SELECT * FROM transactions WHERE telegram_payment_charge_id = ?')) {
          const [chargeId] = bound as [string];
          const row = transactionRows.find((r) => r.telegram_payment_charge_id === chargeId);
          return (row as T) ?? null;
        }
        if (normalized.startsWith('SELECT * FROM ai_reviews WHERE game_id = ?')) {
          const [gameId] = bound as [string];
          const row = aiReviewRows.find((r) => r.game_id === gameId);
          return (row as T) ?? null;
        }
        return null;
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        // Пагинация (см. repository.ts:listGamesByUser) — два варианта
        // запроса: с курсором (keyset) и без (первая страница). Оба
        // начинаются одинаково, различаем по наличию курсорного условия в
        // тексте запроса, а не по счёту "?" (менее ломко при правках).
        if (normalized.startsWith('SELECT * FROM games WHERE telegram_id = ?')) {
          const hasCursor = normalized.includes('updated_at < ?');
          let telegramId: string;
          let limit: number;
          let cursorUpdatedAt: number | undefined;
          let cursorId: string | undefined;
          if (hasCursor) {
            [telegramId, cursorUpdatedAt, , cursorId, limit] = bound as [string, number, number, string, number];
          } else {
            [telegramId, limit] = bound as [string, number];
          }
          let results = rows.filter((r) => r.telegram_id === telegramId);
          if (hasCursor) {
            results = results.filter((r) => {
              const ua = r.updated_at as number;
              const id = r.id as string;
              return ua < cursorUpdatedAt! || (ua === cursorUpdatedAt! && id < cursorId!);
            });
          }
          results = results
            .slice()
            .sort((a, b) => {
              const byUpdated = (b.updated_at as number) - (a.updated_at as number);
              if (byUpdated !== 0) return byUpdated;
              return (b.id as string) < (a.id as string) ? -1 : (b.id as string) > (a.id as string) ? 1 : 0;
            })
            .slice(0, limit);
          return { results: results as T[], success: true, meta: {} as never };
        }
        return { results: [], success: true, meta: {} as never };
      },
      async run(): Promise<D1Result> {
        if (normalized.startsWith('UPDATE user_balances SET free_games_remaining = free_games_remaining - 1')) {
          // Батч 2: списание бесплатной партии. WHERE проверяет version И
          // free_games_remaining > 0 ОДНИМ условием — эмулируем так же: любое
          // расхождение (гонка ИЛИ баланс уже исчерпан кем-то параллельным)
          // даёт meta.changes = 0, вызывающий код (chargeForGame) трактует
          // это единообразно как конфликт версии — см. комментарий там.
          const [updatedAt, telegramId, expectedVersion] = bound as [number, string, number];
          const row = balanceRows.find((r) => r.telegram_id === telegramId);
          if (row && row.version === expectedVersion && (row.free_games_remaining as number) > 0) {
            row.free_games_remaining = (row.free_games_remaining as number) - 1;
            row.version = (row.version as number) + 1;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('UPDATE user_balances SET paid_games = paid_games - 1')) {
          const [updatedAt, telegramId, expectedVersion] = bound as [number, string, number];
          const row = balanceRows.find((r) => r.telegram_id === telegramId);
          if (row && row.version === expectedVersion && (row.paid_games as number) > 0) {
            row.paid_games = (row.paid_games as number) - 1;
            row.version = (row.version as number) + 1;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('UPDATE user_balances SET free_ai_reviews_remaining = free_ai_reviews_remaining - 1')) {
          // Батч 4: списание бесплатного ИИ-разбора (chargeForAiReview) —
          // тот же паттерн condition-в-WHERE, что у free_games_remaining выше.
          const [updatedAt, telegramId, expectedVersion] = bound as [number, string, number];
          const row = balanceRows.find((r) => r.telegram_id === telegramId);
          if (row && row.version === expectedVersion && (row.free_ai_reviews_remaining as number) > 0) {
            row.free_ai_reviews_remaining = (row.free_ai_reviews_remaining as number) - 1;
            row.version = (row.version as number) + 1;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('UPDATE user_balances SET paid_ai_reviews = paid_ai_reviews - 1')) {
          const [updatedAt, telegramId, expectedVersion] = bound as [number, string, number];
          const row = balanceRows.find((r) => r.telegram_id === telegramId);
          if (row && row.version === expectedVersion && (row.paid_ai_reviews as number) > 0) {
            row.paid_ai_reviews = (row.paid_ai_reviews as number) - 1;
            row.version = (row.version as number) + 1;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('UPDATE user_balances SET free_ai_reviews_remaining = free_ai_reviews_remaining + 1')) {
          // refundAiReviewCharge (§12 ТЗ) — аддитивно, версия проверяется не
          // строго (тот же довод, что у начисления по платежу): возврат
          // счётчика назад не может логически конфликтовать с параллельным
          // списанием так, чтобы это было опасно потерять.
          const [updatedAt, telegramId] = bound as [number, string];
          const row = balanceRows.find((r) => r.telegram_id === telegramId);
          if (row) {
            row.free_ai_reviews_remaining = (row.free_ai_reviews_remaining as number) + 1;
            row.version = (row.version as number) + 1;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('UPDATE user_balances SET paid_ai_reviews = paid_ai_reviews + 1')) {
          const [updatedAt, telegramId] = bound as [number, string];
          const row = balanceRows.find((r) => r.telegram_id === telegramId);
          if (row) {
            row.paid_ai_reviews = (row.paid_ai_reviews as number) + 1;
            row.version = (row.version as number) + 1;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('UPDATE user_balances SET paid_games = paid_games + ?')) {
          // Начисление по successful_payment (applySuccessfulPayment) —
          // ЧИСТО аддитивно, в отличие от списания (chargeForGame) не нужна
          // проверка version в WHERE: сложение двух чисел в одном SQL-выражении
          // атомарно само по себе, гонка тут невозможна на уровне одного UPDATE.
          const [grantedGames, grantedAiReviews, updatedAt, telegramId] = bound as [number, number, number, string];
          const row = balanceRows.find((r) => r.telegram_id === telegramId);
          if (row) {
            row.paid_games = (row.paid_games as number) + grantedGames;
            row.paid_ai_reviews = (row.paid_ai_reviews as number) + grantedAiReviews;
            row.version = (row.version as number) + 1;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('UPDATE user_balances SET')) {
          // Обобщённый тестовый апдейт: SET-часть в реальном запросе появится
          // только в батче 2 (списание баланса) — здесь эмулируем ЛЮБОЕ
          // "SET колонка = значение WHERE telegram_id = ?" без привязки к
          // конкретному набору колонок, чтобы тесты батча 1 могли напрямую
          // симулировать "баланс уже изменён" без ожидания кода списания.
          const setClauseMatch = normalized.match(/^UPDATE user_balances SET (.+) WHERE telegram_id = \?$/);
          if (!setClauseMatch) {
            throw new Error(`fakeD1: неподдерживаемый UPDATE user_balances: ${normalized}`);
          }
          const columns = setClauseMatch[1].split(',').map((part) => part.split('=')[0].trim());
          const telegramId = bound[bound.length - 1] as string;
          const values = bound.slice(0, -1);
          const row = balanceRows.find((r) => r.telegram_id === telegramId);
          if (row) {
            columns.forEach((col, i) => {
              row[col] = values[i];
            });
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('INSERT INTO user_balances')) {
          // ON CONFLICT(telegram_id) DO NOTHING — эмулируем: если строка с
          // таким telegram_id уже есть, вообще ничего не делаем (в т.ч. не
          // трогаем free_*_remaining, это ровно то поведение, которое
          // защищает от сброса бесплатных партий при повторном вызове).
          const [telegram_id, free_games_remaining, free_ai_reviews_remaining, created_at, updated_at] = bound as [
            string,
            number,
            number,
            number,
            number,
          ];
          const exists = balanceRows.some((r) => r.telegram_id === telegram_id);
          if (!exists) {
            balanceRows.push({
              telegram_id,
              free_games_remaining,
              free_ai_reviews_remaining,
              paid_games: 0,
              paid_ai_reviews: 0,
              version: 1,
              created_at,
              updated_at,
            });
          }
          return { results: [], success: true, meta: {} as never };
        }
        if (normalized.startsWith('INSERT INTO transactions')) {
          const [
            id,
            telegram_id,
            product_id,
            stars_amount,
            granted_games,
            granted_ai_reviews,
            granted_subscription_days,
            created_at,
            updated_at,
          ] = bound as [string, string, string, number, number, number, number, number, number];
          // status='created', telegram_payment_charge_id=NULL, is_subscription_renewal=0
          // — литералы в реальном SQL (createPendingTransaction), не bind-параметры.
          transactionRows.push({
            id,
            telegram_id,
            product_id,
            stars_amount,
            status: 'created',
            telegram_payment_charge_id: null,
            is_subscription_renewal: 0,
            granted_games,
            granted_ai_reviews,
            granted_subscription_days,
            created_at,
            updated_at,
          });
          return { results: [], success: true, meta: {} as never };
        }
        if (normalized.startsWith("UPDATE transactions SET status = 'successful'")) {
          // applySuccessfulPayment — WHERE id = ? AND status = 'created'
          // защищает от повторного начисления (см. комментарий в repository.ts).
          const [chargeId, isRenewal, updatedAt, id] = bound as [string, number, number, string];
          const row = transactionRows.find((r) => r.id === id && r.status === 'created');
          if (row) {
            row.status = 'successful';
            row.telegram_payment_charge_id = chargeId;
            row.is_subscription_renewal = isRenewal;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('INSERT INTO subscriptions')) {
          // Порядок колонок ровно как в payments/repository.ts:SubscriptionRow
          // (используется и тестовым сидом, и applySuccessfulPayment).
          const [id, telegram_id, period_end, auto_renew, created_at, updated_at] = bound as [
            string,
            string,
            number,
            number,
            number,
            number,
          ];
          subscriptionRows.push({ id, telegram_id, period_end, auto_renew, created_at, updated_at });
          return { results: [], success: true, meta: {} as never };
        }
        if (normalized.startsWith('UPDATE subscriptions SET period_end = ?, updated_at = ? WHERE id = ?')) {
          // Продление подписки (applySuccessfulPayment, isRenewal=true).
          const [periodEnd, updatedAt, id] = bound as [number, number, string];
          const row = subscriptionRows.find((r) => r.id === id);
          if (row) {
            row.period_end = periodEnd;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('UPDATE subscriptions SET auto_renew = 0, updated_at = ? WHERE id = ?')) {
          // markSubscriptionAutoRenewOff — отмена автопродления, period_end
          // намеренно НЕ трогается (см. комментарий у функции).
          const [updatedAt, id] = bound as [number, string];
          const row = subscriptionRows.find((r) => r.id === id);
          if (row) {
            row.auto_renew = 0;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('INSERT INTO ai_reviews')) {
          // upsertAiReviewPending — ON CONFLICT(game_id) DO UPDATE: если
          // строка уже есть (повторная попытка после 'failed'), обновляем её
          // на месте, а не дублируем (game_id — PRIMARY KEY).
          const [gameId, telegramId, chargedFrom, createdAt, updatedAt] = bound as [string, string, string, number, number];
          const existing = aiReviewRows.find((r) => r.game_id === gameId);
          if (existing) {
            existing.status = 'pending';
            existing.charged_from = chargedFrom;
            existing.error = null;
            existing.updated_at = updatedAt;
          } else {
            aiReviewRows.push({
              game_id: gameId,
              telegram_id: telegramId,
              status: 'pending',
              charged_from: chargedFrom,
              content: null,
              error: null,
              created_at: createdAt,
              updated_at: updatedAt,
            });
          }
          return { results: [], success: true, meta: {} as never };
        }
        if (normalized.startsWith("UPDATE ai_reviews SET status = 'ready'")) {
          const [content, updatedAt, gameId] = bound as [string, number, string];
          const row = aiReviewRows.find((r) => r.game_id === gameId);
          if (row) {
            row.status = 'ready';
            row.content = content;
            row.error = null;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith("UPDATE ai_reviews SET status = 'failed'")) {
          const [errorText, updatedAt, gameId] = bound as [string, number, string];
          const row = aiReviewRows.find((r) => r.game_id === gameId);
          if (row) {
            row.status = 'failed';
            row.error = errorText;
            row.updated_at = updatedAt;
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized === "UPDATE games SET status = 'FINISHED' WHERE id = ?") {
          // Тестовый хелпер (index.test.ts:createFinishedGame, батч 4) —
          // напрямую метит партию завершённой в обход движка, чтобы тесты
          // ИИ-разбора не гоняли реальную партию до финиша. Отдельная узкая
          // ветка, а не через основной 'UPDATE games SET' (тот жёстко
          // завязан на позиционный список из 12 полей продового updateGame).
          const [gameId] = bound as [string];
          const row = rows.find((r) => r.id === gameId);
          if (row) {
            row.status = 'FINISHED';
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        if (normalized.startsWith('INSERT INTO games')) {
          const [
            id,
            telegram_id,
            status,
            ruleset_id,
            ruleset_version,
            dice_mode,
            current_cell,
            is_born,
            rolls_json,
            turns_json,
            created_at,
            updated_at,
            consecutive_sixes,
            position_before_six_series,
            request,
            client_request_id,
          ] = bound;
          // version = 1 не приходит через bind (в реальном SQL это литерал
          // в VALUES, см. repository.ts insertGame) — задаём здесь так же.
          rows.push({
            id,
            telegram_id,
            status,
            ruleset_id,
            ruleset_version,
            dice_mode,
            current_cell,
            is_born,
            rolls_json,
            turns_json,
            created_at,
            updated_at,
            consecutive_sixes,
            position_before_six_series,
            request,
            client_request_id: client_request_id ?? null,
            version: 1,
          });
          return { results: [], success: true, meta: {} as never };
        } else if (normalized.startsWith('UPDATE games SET')) {
          // dice_mode добавлен в реальный запрос (worker/src/games/repository.ts,
          // баг п.1) — порядок и состав bind-параметров здесь должен зеркалить
          // тот запрос, иначе фейковая БД молча припишет значения не своим
          // полям (именно так проявился этот баг в тестах: current_cell
          // получил бы dice_mode).
          //
          // Optimistic concurrency control: WHERE теперь ещё и AND version = ?
          // (последний bind-параметр) — если у найденной строки version не
          // совпадает с ожидаемым, апдейт не применяется и meta.changes = 0,
          // ровно как повела бы себя настоящая условная UPDATE в SQLite/D1.
          const [
            status,
            dice_mode,
            current_cell,
            is_born,
            rolls_json,
            turns_json,
            updated_at,
            consecutive_sixes,
            position_before_six_series,
            id,
            telegram_id,
            expected_version,
          ] = bound;
          const row = rows.find((r) => r.id === id && r.telegram_id === telegram_id);
          if (row && row.version === expected_version) {
            Object.assign(row, {
              status,
              dice_mode,
              current_cell,
              is_born,
              rolls_json,
              turns_json,
              updated_at,
              consecutive_sixes,
              position_before_six_series,
              version: (row.version as number) + 1,
            });
            return { results: [], success: true, meta: { changes: 1 } as never };
          }
          return { results: [], success: true, meta: { changes: 0 } as never };
        }
        return { results: [], success: true, meta: {} as never };
      },
    };

    return stmt;
  }

  return { prepare } as unknown as D1Database;
}
