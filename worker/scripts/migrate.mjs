import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadMigrations, planLegacyBaseline, schemaQuery } from './legacy-baseline.mjs';

const mode = process.argv[2];
if (!['--local', '--remote'].includes(mode) || process.argv.length !== 3) throw new Error('Usage: node scripts/migrate.mjs --local|--remote');
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
function run(args, capture = false) {
  return execFileSync(process.execPath, [wrangler, 'd1', ...args], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', timeout: 120000,
  });
}
function query(sql) {
  // Wrangler 3 emits this diagnostic ahead of JSON when a proxy is configured.
  const output = run(['execute', 'leela', mode, '--command', sql, '--json', '--yes'], true)
    .replace(/^Proxy environment variables detected\.[^\n]*\r?\n/, '');
  const response = JSON.parse(output);
  if (!Array.isArray(response) || response.length !== 1 || response[0].success !== true || !Array.isArray(response[0].results)) {
    throw new Error('Unexpected D1 response; migration stopped');
  }
  return response[0].results;
}
const migrations = loadMigrations();
const schema = query(schemaQuery);
const applied = schema.some(item => item.name === 'd1_migrations') ? query('SELECT name FROM d1_migrations ORDER BY id').map(item => item.name) : [];
const baseline = planLegacyBaseline(schema, applied, migrations);
if (baseline) {
  console.log('Reconciling frozen historical DDL with the existing schema');
  run(['execute', 'leela', mode, '--command', baseline, '--yes']);
}
run(['migrations', 'apply', 'leela', mode]);
const recorded = new Set(query('SELECT name FROM d1_migrations').map(item => item.name));
if (migrations.some(item => !recorded.has(item.name))) throw new Error('Incomplete migration ledger; deployment stopped');
console.log(`Schema ready: ${migrations.length} migrations recorded (${mode})`);
