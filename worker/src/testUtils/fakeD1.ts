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
        if (normalized.startsWith('SELECT * FROM games WHERE telegram_id = ?')) {
          const [telegramId] = bound as [string];
          const results = rows
            .filter((r) => r.telegram_id === telegramId)
            .sort((a, b) => (b.updated_at as number) - (a.updated_at as number));
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
          });
        } else if (normalized.startsWith('UPDATE games SET')) {
          const [
            status,
            current_cell,
            is_born,
            rolls_json,
            turns_json,
            updated_at,
            consecutive_sixes,
            position_before_six_series,
            id,
            telegram_id,
          ] = bound;
          const row = rows.find((r) => r.id === id && r.telegram_id === telegram_id);
          if (row) {
            Object.assign(row, {
              status,
              current_cell,
              is_born,
              rolls_json,
              turns_json,
              updated_at,
              consecutive_sixes,
              position_before_six_series,
            });
          }
        }
        return { results: [], success: true, meta: {} as never };
      },
    };

    return stmt;
  }

  return { prepare } as unknown as D1Database;
}
