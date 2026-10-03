import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Executes production SQL and migrations, including constraints and rollback.
export function createSqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
  }
  function prepare(sql: string) {
    let args: SQLInputValue[] = [];
    function execute() {
      const statement = sqlite.prepare(sql);
      if (statement.columns().length) {
        return { success: true, results: statement.all(...args), meta: { changes: 0 } };
      }
      const result = statement.run(...args);
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    }
    return {
      bind(...values: SQLInputValue[]) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return execute(); },
      async run() { return execute(); },
      execute,
    };
  }
  const db = {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map((statement) => (statement as unknown as { execute(): unknown }).execute());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
