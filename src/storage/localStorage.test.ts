import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteGame, getActiveGameId, listGames, loadGame, saveGame, setActiveGameId } from './localStorage';

interface TestRecord {
  id: string;
  value: number;
}

function createMockLocalStorage(opts: { quota?: number } = {}) {
  const store = new Map<string, string>();
  const quota = opts.quota ?? Infinity;
  let used = 0;

  return {
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      const delta = value.length - (store.get(key)?.length ?? 0);
      if (used + delta > quota) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      used += delta;
      store.set(key, value);
    },
    removeItem(key: string): void {
      if (store.has(key)) {
        used -= store.get(key)!.length;
        store.delete(key);
      }
    },
    _raw: store,
  };
}

function createThrowingLocalStorage() {
  const explode = () => {
    throw new Error('SecurityError: доступ к localStorage запрещён');
  };
  return { getItem: explode, setItem: explode, removeItem: explode };
}

let mockStorage: ReturnType<typeof createMockLocalStorage>;

beforeEach(() => {
  mockStorage = createMockLocalStorage();
  // @ts-expect-error — тестовый глобальный window, окружение vitest здесь 'node'
  globalThis.window = { localStorage: mockStorage };
});

afterEach(() => {
  // @ts-expect-error — убираем тестовый window между тестами
  delete globalThis.window;
});

describe('localStorage layer — нормальный путь', () => {
  it('сохраняет и читает запись', () => {
    const record: TestRecord = { id: 'a', value: 1 };
    expect(saveGame(record)).toBe(true);
    expect(loadGame<TestRecord>('a')).toEqual(record);
  });

  it('возвращает null для несуществующей записи', () => {
    expect(loadGame('missing')).toBeNull();
  });

  it('перечисляет все сохранённые записи', () => {
    saveGame<TestRecord>({ id: 'a', value: 1 });
    saveGame<TestRecord>({ id: 'b', value: 2 });
    expect(
      listGames<TestRecord>()
        .map((r) => r.id)
        .sort()
    ).toEqual(['a', 'b']);
  });

  it('удаляет запись и вычищает её из индекса', () => {
    saveGame<TestRecord>({ id: 'a', value: 1 });
    deleteGame('a');
    expect(loadGame('a')).toBeNull();
    expect(listGames()).toEqual([]);
  });

  it('хранит activeGameId', () => {
    expect(getActiveGameId()).toBeNull();
    setActiveGameId('a');
    expect(getActiveGameId()).toBe('a');
    setActiveGameId(null);
    expect(getActiveGameId()).toBeNull();
  });
});

describe('localStorage layer — устойчивость к повреждённым данным', () => {
  it('возвращает null при повреждённом JSON одной записи', () => {
    mockStorage.setItem('leela:v1:game:broken', '{not json');
    expect(loadGame('broken')).toBeNull();
  });

  it('пропускает повреждённые записи при listGames и вычищает их из индекса', () => {
    saveGame<TestRecord>({ id: 'a', value: 1 });
    mockStorage._raw.set('leela:v1:game:ghost', '{not json');
    mockStorage._raw.set('leela:v1:index', JSON.stringify(['a', 'ghost']));

    expect(listGames<TestRecord>().map((r) => r.id)).toEqual(['a']);

    const rawIndex = JSON.parse(mockStorage.getItem('leela:v1:index')!);
    expect(rawIndex).toEqual(['a']);
  });

  it('не падает, если индекс сам повреждён', () => {
    mockStorage._raw.set('leela:v1:index', 'не json вообще');
    expect(listGames()).toEqual([]);
  });
});

describe('localStorage layer — недоступность/переполнение', () => {
  it('saveGame возвращает false при переполненной квоте, ничего не регистрируя в индексе', () => {
    // @ts-expect-error — тестовый window с урезанной квотой
    globalThis.window = { localStorage: createMockLocalStorage({ quota: 5 }) };
    expect(saveGame<TestRecord>({ id: 'a', value: 1 })).toBe(false);
    expect(listGames()).toEqual([]);
  });

  it('работает мягко, когда window/localStorage вообще отсутствует', () => {
    // @ts-expect-error — тестовый сценарий "storage недоступен"
    delete globalThis.window;
    expect(saveGame<TestRecord>({ id: 'a', value: 1 })).toBe(false);
    expect(loadGame('a')).toBeNull();
    expect(listGames()).toEqual([]);
    expect(getActiveGameId()).toBeNull();
    expect(() => setActiveGameId('a')).not.toThrow();
    expect(() => deleteGame('a')).not.toThrow();
  });

  it('работает мягко, когда localStorage бросает исключение на каждый вызов (приватный режим Safari)', () => {
    // @ts-expect-error — тестовый "падающий" localStorage
    globalThis.window = { localStorage: createThrowingLocalStorage() };
    expect(saveGame<TestRecord>({ id: 'a', value: 1 })).toBe(false);
    expect(loadGame('a')).toBeNull();
    expect(getActiveGameId()).toBeNull();
    expect(() => setActiveGameId('a')).not.toThrow();
  });
});
