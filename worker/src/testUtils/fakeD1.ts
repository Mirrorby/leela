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
        if (normalized.startsWith('SELECT * FROM games WHERE id = ? AND telegram_id = ?')) {
          const [id, telegramId] = bound as [string, string];
          const row = rows.find((r) => r.id === id && r.telegram_id === telegramId);
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
