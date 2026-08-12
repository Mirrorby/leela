// Чистый слой хранения. Ничего не знает про Game Engine или React — только
// читает/пишет JSON в localStorage с обработкой ошибок. Формы хранимых
// объектов задаёт вызывающий код через generic-параметр T.
//
// Схема ключей:
//   leela:v1:game:<id>   — JSON-запись одной партии (форму задаёт вызывающий код)
//   leela:v1:index       — JSON-массив id всех сохранённых партий
//   leela:v1:activeGameId — id партии, которую нужно восстановить при загрузке

const STORAGE_PREFIX = 'leela:v1:';
const INDEX_KEY = `${STORAGE_PREFIX}index`;
const ACTIVE_GAME_KEY = `${STORAGE_PREFIX}activeGameId`;

function gameKey(id: string): string {
  return `${STORAGE_PREFIX}game:${id}`;
}

/**
 * Проверка доступности localStorage без побочных эффектов "на глазок":
 * приватный режим Safari, отключённый storage в настройках браузера,
 * встраивание в iframe с ограничениями — во всех случаях просто false.
 */
function isStorageAvailable(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const testKey = `${STORAGE_PREFIX}__probe__`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function readIndex(): string[] {
  if (!isStorageAvailable()) return [];
  try {
    const raw = window.localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    // Повреждённый индекс — считаем, что сохранённых партий нет, а не падаем.
    return [];
  }
}

function writeIndex(ids: string[]): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  } catch {
    // Квота переполнена и на индекс — партия(и) при этом уже могли не
    // сохраниться, дальше просто продолжаем работать в памяти.
  }
}

/** Сохраняет запись по её id, регистрируя id в индексе. Возвращает false при любой ошибке (квота, приватный режим и т.п.) — вызывающий код решает, что делать дальше. */
export function saveGame<T extends { id: string }>(record: T): boolean {
  if (!isStorageAvailable()) return false;
  try {
    window.localStorage.setItem(gameKey(record.id), JSON.stringify(record));
  } catch {
    // QuotaExceededError и подобные — не удалось сохранить в этот раз.
    return false;
  }
  const index = readIndex();
  if (!index.includes(record.id)) {
    writeIndex([...index, record.id]);
  }
  return true;
}

/** Читает запись по id. null — если записи нет, storage недоступен, или JSON повреждён. */
export function loadGame<T>(id: string): T | null {
  if (!isStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(gameKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Возвращает все сохранённые записи (только валидные — битые пропускаются и вычищаются из индекса). */
export function listGames<T extends { id: string }>(): T[] {
  const index = readIndex();
  const result: T[] = [];
  let hasCorrupted = false;

  for (const id of index) {
    const record = loadGame<T>(id);
    if (record) {
      result.push(record);
    } else {
      hasCorrupted = true;
    }
  }

  if (hasCorrupted) {
    writeIndex(result.map((record) => record.id));
  }

  return result;
}

/** Удаляет запись и вычищает её из индекса. Никогда не бросает исключений. */
export function deleteGame(id: string): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.removeItem(gameKey(id));
  } catch {
    // ignore
  }
  writeIndex(readIndex().filter((existingId) => existingId !== id));
}

export function getActiveGameId(): string | null {
  if (!isStorageAvailable()) return null;
  try {
    return window.localStorage.getItem(ACTIVE_GAME_KEY);
  } catch {
    return null;
  }
}

export function setActiveGameId(id: string | null): void {
  if (!isStorageAvailable()) return;
  try {
    if (id === null) {
      window.localStorage.removeItem(ACTIVE_GAME_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_GAME_KEY, id);
    }
  } catch {
    // ignore
  }
}
