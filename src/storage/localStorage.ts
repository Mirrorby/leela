// Private cache keys are accessible only after /api/v1/me verified the
// current Telegram account. Old shared game snapshots are never displayed.
let storageOwner: string | null = null;

export function setStorageOwner(owner: string | null): void {
  if (owner !== null && !/^[1-9]\d*$/.test(owner)) throw new Error('Invalid verified storage owner');
  storageOwner = owner;
}
export function getStorageOwner(): string | null { return storageOwner; }

function prefix(): string | null {
  return storageOwner ? `leela:v2:user:${storageOwner}:` : null;
}
function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
function read(key: string): string | null {
  try { return storage()?.getItem(key) ?? null; } catch { return null; }
}
function write(key: string, value: string | null): boolean {
  try {
    const target = storage();
    if (!target) return false;
    if (value === null) target.removeItem(key); else target.setItem(key, value);
    return true;
  } catch { return false; }
}
function privateKey(name: string): string | null {
  const scope = prefix();
  return scope ? scope + name : null;
}
function readIds(name: string): string[] {
  const key = privateKey(name);
  if (!key) return [];
  try {
    const parsed: unknown = JSON.parse(read(key) ?? '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))] : [];
  } catch { return []; }
}
function writeIds(name: string, ids: string[]): boolean {
  const key = privateKey(name);
  return key ? write(key, JSON.stringify(ids)) : false;
}

export function saveGame<T extends { id: string }>(record: T): boolean {
  const key = privateKey('game:' + record.id);
  if (!key || !record.id) return false;
  try {
    if (!write(key, JSON.stringify(record))) return false;
    const ids = readIds('index');
    return ids.includes(record.id) || writeIds('index', [...ids, record.id]);
  } catch { return false; }
}

/** A validator can check the domain schema. Even generic records must
 * match their storage key; corrupt data cannot poison the index. */
export function loadGame<T>(id: string, validate?: (value: unknown) => value is T): T | null {
  const key = privateKey('game:' + id);
  if (!key) return null;
  const raw = read(key);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || (value as { id?: unknown }).id !== id || (validate && !validate(value))) {
      deleteGame(id);
      return null;
    }
    return value as T;
  } catch {
    deleteGame(id);
    return null;
  }
}

export function listGames<T extends { id: string }>(validate?: (value: unknown) => value is T): T[] {
  const ids = readIds('index');
  const result = ids.map((id) => loadGame<T>(id, validate)).filter((record): record is T => record !== null);
  if (result.length !== ids.length) writeIds('index', result.map((record) => record.id));
  return result;
}

export function deleteGame(id: string): void {
  const key = privateKey('game:' + id);
  if (!key) return;
  write(key, null);
  writeIds('index', readIds('index').filter((existing) => existing !== id));
}
export function getActiveGameId(): string | null {
  const key = privateKey('activeGameId');
  return key ? read(key) || null : null;
}
export function setActiveGameId(id: string | null): boolean {
  const key = privateKey('activeGameId');
  return key ? write(key, id) : false;
}

/** Use only as a hint for an authenticated server lookup, never to load
 * a shared v1 snapshot or infer its owner. Server history survives migration. */
export function getLegacyActiveGameId(): string | null {
  return storageOwner ? read('leela:v1:activeGameId') || null : null;
}
export function clearLegacyActiveGameId(): void {
  if (storageOwner) write('leela:v1:activeGameId', null);
}
export function getHiddenGameIds(): string[] { return readIds('hiddenGameIds'); }
export function hideGameId(id: string): void {
  const ids = getHiddenGameIds();
  if (!ids.includes(id)) writeIds('hiddenGameIds', [...ids, id]);
}
export function getOnboardingSeen(): boolean {
  const key = privateKey('onboardingSeen');
  return key ? read(key) === '1' : false;
}
export function setOnboardingSeen(): void {
  const key = privateKey('onboardingSeen');
  if (key) write(key, '1');
}
