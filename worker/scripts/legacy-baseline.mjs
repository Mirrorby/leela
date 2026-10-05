import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const directory = new URL('../migrations/', import.meta.url);
const legacy = JSON.parse(readFileSync(new URL('./legacy-migrations.json', import.meta.url), 'utf8'));
const ledgerSql = `CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;
export const schemaQuery = `SELECT name, type, tbl_name, sql FROM sqlite_master
  WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL`;

export function loadMigrations() {
  const files = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  for (const name of files) if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) throw new Error(`Invalid migration filename: ${name}`);
  const migrations = files.map(name => ({ name, sql: readFileSync(new URL(name, directory), 'utf8') }));
  for (const [name, hash] of Object.entries(legacy)) {
    const migration = migrations.find(item => item.name === name);
    if (!migration || createHash('sha256').update(migration.sql).digest('hex') !== hash) {
      throw new Error(`Historical migration changed: ${name}; append a new migration instead`);
    }
  }
  if (files.some(name => name <= Object.keys(legacy).at(-1) && !legacy[name])) throw new Error('Migration inserted before the historical baseline');
  return migrations;
}

const identifier = value => `"${value.replaceAll('"', '""')}"`;
const normalize = sql => sql.replace(/IF\s+NOT\s+EXISTS/gi, '').replace(/["`[\]]/g, '').replace(/\s+/g, '').replace(/;$/, '').toLowerCase();

/** Only frozen historical DDL is reconciled. A copy of schema, never user
 * rows, proves compatibility before any production write. Later migrations
 * remain managed by Wrangler. No DROP, UPDATE, DELETE or blind stamp. */
export function planLegacyBaseline(schema, applied, migrations = loadMigrations()) {
  const names = new Set(migrations.map(item => item.name));
  for (const name of applied) if (!names.has(name)) throw new Error(`Database has an unknown migration: ${name}; refusing an older release`);
  const pending = Object.keys(legacy).filter(name => !applied.includes(name));
  if (!pending.length) return null;
  const expected = new DatabaseSync(':memory:');
  const actual = new DatabaseSync(':memory:');
  try {
    for (const item of migrations.filter(item => legacy[item.name])) expected.exec(item.sql);
    expected.exec(ledgerSql);
    const required = new Set(expected.prepare(schemaQuery).all().map(item => item.name));
    for (const type of ['table', 'index']) {
      for (const item of schema.filter(item => item.type === type && required.has(item.name))) actual.exec(item.sql);
    }
    actual.exec(ledgerSql);
    const statements = [];
    for (const item of migrations.filter(item => pending.includes(item.name))) {
      // Frozen SQL contains only line comments and semicolon-delimited DDL.
      for (const sql of item.sql.replace(/--[^\n]*/g, '').split(';').map(part => part.trim()).filter(Boolean)) {
        const add = /^ALTER TABLE (\w+) ADD COLUMN (\w+) /i.exec(sql);
        if (add && actual.prepare(`PRAGMA table_info(${identifier(add[1])})`).all().some(column => column.name === add[2])) continue;
        if (!add && !/^CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS /i.test(sql)) throw new Error(`Unsupported legacy DDL in ${item.name}`);
        actual.exec(sql);
        statements.push(sql);
      }
    }
    for (const item of expected.prepare(schemaQuery).all()) {
      if (item.type === 'table') {
        const columns = actual.prepare(`PRAGMA table_info(${identifier(item.name)})`).all();
        for (const wanted of expected.prepare(`PRAGMA table_info(${identifier(item.name)})`).all()) {
          const found = columns.find(column => column.name === wanted.name);
          for (const field of ['type', 'notnull', 'dflt_value', 'pk']) {
            if (!found || String(found[field]).toUpperCase() !== String(wanted[field]).toUpperCase()) {
              throw new Error(`Incompatible schema: ${item.name}.${wanted.name} (${field}); no baseline written`);
            }
          }
        }
        // CHECK/UNIQUE constraints belong to table DDL, not table_info.
        if (item.name === 'tribute_purchases' && !normalize(actual.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(item.name).sql)
          .includes("check(statusin('pending','successful','refunded'))")) throw new Error('Missing Tribute status constraint');
      } else {
        const found = actual.prepare('SELECT sql FROM sqlite_master WHERE name = ? AND type = ?').get(item.name, 'index');
        if (!found || normalize(found.sql) !== normalize(item.sql)) throw new Error(`Incompatible index: ${item.name}; no baseline written`);
      }
    }
    const uniqueNames = actual.prepare('PRAGMA index_list(d1_migrations)').all().filter(index => index.unique);
    if (!uniqueNames.some(index => actual.prepare(`PRAGMA index_info(${identifier(index.name)})`).all()
      .map(column => column.name).join(',') === 'name')) throw new Error('Migration ledger requires a unique name');
    // Stamp only after every DDL statement has passed and all effects exist.
    return [ledgerSql, ...statements, ...pending.map(name => `INSERT INTO d1_migrations (name) VALUES ('${name}') ON CONFLICT(name) DO NOTHING`)]
      .join(';\n') + ';';
  } finally { expected.close(); actual.close(); }
}
