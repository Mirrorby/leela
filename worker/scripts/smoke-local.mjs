import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Exercise the actual bundle/runtime/D1 together, with isolated local data.
// Only game/auth routes are called: no AI, Telegram messages or payments.
const cwd = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'leela-smoke-'));
const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
const botToken = 'local-smoke-test-token';
let worker;
try {
  const migration = spawnSync(process.execPath, [cli, 'd1', 'migrations', 'apply', 'leela',
    '--local', '--persist-to', directory], { cwd, env, encoding: 'utf8', timeout: 60000 });
  assert.equal(migration.status, 0, 'isolated local migrations must succeed');
  console.log('Isolated local D1 migrations applied');

  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  worker = spawn(process.execPath, [cli, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--inspector-port', '0', '--persist-to', directory, '--show-interactive-dev-session=false',
    '--var', `BOT_TOKEN:${botToken}`], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  // Drain output, but never print potential developer secrets from startup.
  worker.stdout.resume(); worker.stderr.resume();
  let startupError;
  worker.on('error', error => { startupError = error; });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
    if (startupError) throw startupError;
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Local Wrangler stopped before becoming ready');
    try {
      const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      const health = await response.json();
      if (response.ok && health.ok === true && health.db === 'reachable') { ready = true; break; }
    } catch { /* Startup may still be in progress. */ }
    await delay(100);
  }
  assert.ok(ready, 'local Worker and D1 must become ready within 30 seconds');
  assert.equal((await fetch(`${base}/api/v1/me`, { signal: AbortSignal.timeout(5000) })).status, 401);
  const preflight = await fetch(`${base}/api/v1/games`, { method: 'OPTIONS', signal: AbortSignal.timeout(5000) });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');

  const telegramId = 900000000001;
  const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: telegramId, first_name: 'Local smoke' }) });
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const check = [...data].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  data.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  const headers = { Authorization: `tma ${data}`, 'Content-Type': 'application/json' };
  const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(5000) });
  assert.equal((await (await request('/api/v1/me')).json()).telegramId, String(telegramId));
  const body = JSON.stringify({ request: 'Local runtime verification', diceMode: 'physical', clientRequestId: randomUUID() });
  const created = await request('/api/v1/games', { method: 'POST', body });
  assert.equal(created.status, 201);
  const { game } = await created.json();
  assert.ok(game.id);
  const repeat = await request('/api/v1/games', { method: 'POST', body });
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).game.id, game.id);
  const listed = await request('/api/v1/games');
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).games.length, 1);
  const exhausted = await request('/api/v1/games', { method: 'POST',
    body: JSON.stringify({ request: 'Second operation', diceMode: 'physical', clientRequestId: randomUUID() }) });
  assert.equal(exhausted.status, 402, 'a repeat must not consume another credit or grant another free game');
  assert.ok(preflight.headers.get('Access-Control-Allow-Methods').includes('DELETE'));
  assert.equal((await request(`/api/v1/games/${game.id}`, { method:'DELETE' })).status, 200);
  assert.equal((await request(`/api/v1/games/${game.id}`, { method:'DELETE' })).status, 200);
  assert.equal((await request(`/api/v1/games/${game.id}`)).status, 404);
  assert.equal((await (await request('/api/v1/games')).json()).games.length, 0);
  assert.equal((await request('/api/v1/games', { method:'POST', body })).status, 410);
  console.log('Local Worker smoke passed: D1, auth, CORS, create, replay, list, free-game limit and deletion');
} finally {
  if (worker?.pid && worker.exitCode === null && worker.signalCode === null) {
    const stopped = new Promise(resolve => worker.once('exit', resolve));
    worker.kill('SIGTERM');
    const timer = setTimeout(() => worker.kill('SIGKILL'), 3000);
    await stopped; clearTimeout(timer);
  }
  rmSync(directory, { recursive: true, force: true });
}
