import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadMigrations, planLegacyBaseline, schemaQuery } from './legacy-baseline.mjs';

const migrations = loadMigrations();
const schema = db => db.prepare(schemaQuery).all();
const applied = db => db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(row => row.name);
function seeded(count = migrations.length) {
  const db = new DatabaseSync(':memory:');
  for (const migration of migrations.slice(0, count)) db.exec(migration.sql);
  return db;
}

test('fresh schema records every historical migration, and reapplying is a no-op', () => {
  const db = seeded(0);
  try {
    db.exec(planLegacyBaseline(schema(db), []));
    assert.equal(applied(db).length, 16);
    assert.equal(planLegacyBaseline(schema(db), applied(db)), null);
    assert.ok(db.prepare('PRAGMA table_info(games)').all().some(column => column.name === 'client_request_id'));
  } finally { db.close(); }
});

test('adopts manually created schema while preserving games, paid balances and receipts', () => {
  const db = seeded();
  try {
    db.exec(`INSERT INTO games (id, telegram_id, status, ruleset_id, ruleset_version, dice_mode, created_at, updated_at)
      VALUES ('game', '111', 'WAITING_FOR_BIRTH', 'classic-v1', '1', 'physical', 1, 1);
      INSERT INTO user_balances (telegram_id, paid_games, paid_ai_reviews, created_at, updated_at) VALUES ('111', 7, 3, 1, 1);
      INSERT INTO tribute_purchases (purchase_id, transaction_id, tribute_product_id, telegram_id, product_id,
        amount, currency, status, granted_games, created_at, updated_at) VALUES (1, 2, 3, '111', 'game_5', 599, 'USD', 'successful', 5, 1, 1)`);
    const before = ['games', 'user_balances', 'tribute_purchases'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
    const sql = planLegacyBaseline(schema(db), []);
    assert.doesNotMatch(sql, /ALTER TABLE|\b(?:DROP|UPDATE|DELETE)\b/i);
    db.exec(sql);
    assert.deepEqual(['games', 'user_balances', 'tribute_purchases'].map(table => db.prepare(`SELECT * FROM ${table}`).all()), before);
    assert.equal(applied(db).length, 16);
  } finally { db.close(); }
});

test('recovers partially applied historical ALTERs without adding a column twice', () => {
  const db = seeded(1);
  try {
    db.exec('ALTER TABLE games ADD COLUMN consecutive_sixes INTEGER NOT NULL DEFAULT 0');
    const sql = planLegacyBaseline(schema(db), []);
    assert.doesNotMatch(sql, /ADD COLUMN consecutive_sixes/);
    assert.match(sql, /ADD COLUMN position_before_six_series/);
    db.exec(sql);
    assert.equal(applied(db).length, 16);
  } finally { db.close(); }
});

test('can finish a previously interrupted baseline with a partial migration ledger', () => {
  const db = seeded(0);
  try {
    db.exec(planLegacyBaseline(schema(db), []));
    db.exec("DELETE FROM d1_migrations WHERE name >= '0011'");
    db.exec(planLegacyBaseline(schema(db), applied(db)));
    assert.equal(applied(db).length, 16);
  } finally { db.close(); }
});

test('rejects incompatible column types before writing the ledger or touching rows', () => {
  const db = seeded(1);
  try {
    db.exec('ALTER TABLE games ADD COLUMN consecutive_sixes TEXT NOT NULL DEFAULT 0');
    assert.throws(() => planLegacyBaseline(schema(db), []), /Incompatible schema: games.consecutive_sixes/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'd1_migrations'").get().n, 0);
  } finally { db.close(); }
});

test('rejects a same-named index with wrong uniqueness or columns', () => {
  const db = seeded();
  try {
    db.exec('DROP INDEX idx_games_client_request_id; CREATE INDEX idx_games_client_request_id ON games(client_request_id)');
    assert.throws(() => planLegacyBaseline(schema(db), []), /Incompatible index: idx_games_client_request_id/);
  } finally { db.close(); }
});

test('rejects a missing financial status constraint', () => {
  const db = seeded(12);
  try {
    const migration = migrations.find(item => item.name.startsWith('0013'));
    db.exec(migration.sql.replace(" CHECK (status IN ('pending', 'successful', 'refunded'))", ''));
    assert.throws(() => planLegacyBaseline(schema(db), []), /Missing Tribute status constraint/);
  } finally { db.close(); }
});

test('refuses a release older than the database migration history', () => {
  assert.throws(() => planLegacyBaseline([], ['9999_future.sql']), /unknown migration/);
});

test('does not stamp or reconcile appended migrations; Wrangler remains responsible for them', () => {
  const db = seeded();
  try {
    const future = { name: '0017_example.sql', sql: 'CREATE TABLE example(id TEXT)' };
    const sql = planLegacyBaseline(schema(db), [], [...migrations, future]);
    assert.doesNotMatch(sql, /0017_example|CREATE TABLE example/);
    db.exec(sql);
    assert.equal(applied(db).length, 16);
  } finally { db.close(); }
});
