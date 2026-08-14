import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureInitData,
  getDisplayUser,
  getInitData,
  getWebApp,
  initTelegramApp,
  isTelegramEnvironment,
  type TelegramWebApp,
} from './telegramAdapter';

function makeFakeWebApp(overrides: Partial<TelegramWebApp> = {}): TelegramWebApp {
  return {
    ready: vi.fn(),
    expand: vi.fn(),
    colorScheme: 'light',
    themeParams: {},
    viewportHeight: 600,
    viewportStableHeight: 600,
    initData: 'query_id=AAA&user=%7B%22id%22%3A1%7D',
    initDataUnsafe: { user: { id: 1, first_name: 'Аркадий' } },
    BackButton: { isVisible: false, show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
    HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn(), selectionChanged: vi.fn() },
    onEvent: vi.fn(),
    offEvent: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  // @ts-expect-error — тестовый global, вне vitest этого поля нет.
  delete globalThis.window;
});

describe('telegramAdapter — вне Telegram (обычный браузер)', () => {
  it('isTelegramEnvironment() -> false, когда window.Telegram не определён', () => {
    // @ts-expect-error — минимальный window-стаб для теста.
    globalThis.window = {};
    expect(isTelegramEnvironment()).toBe(false);
    expect(getWebApp()).toBeNull();
  });

  it('initTelegramApp()/captureInitData()/getDisplayUser() безопасно no-op без Telegram', () => {
    // @ts-expect-error — минимальный window-стаб для теста.
    globalThis.window = {};
    expect(() => initTelegramApp()).not.toThrow();
    expect(() => captureInitData()).not.toThrow();
    expect(getDisplayUser()).toBeNull();
  });
});

describe('telegramAdapter — внутри Telegram', () => {
  it('isTelegramEnvironment() -> true и getWebApp() возвращает WebApp', () => {
    const fake = makeFakeWebApp();
    // @ts-expect-error — минимальный window-стаб для теста.
    globalThis.window = { Telegram: { WebApp: fake } };
    expect(isTelegramEnvironment()).toBe(true);
    expect(getWebApp()).toBe(fake);
  });

  it('initTelegramApp() зовёт ready() и expand()', () => {
    const fake = makeFakeWebApp();
    // @ts-expect-error — минимальный window-стаб для теста.
    globalThis.window = { Telegram: { WebApp: fake } };
    initTelegramApp();
    expect(fake.ready).toHaveBeenCalledTimes(1);
    expect(fake.expand).toHaveBeenCalledTimes(1);
  });

  it('captureInitData()/getInitData() читают initData из WebApp', () => {
    const fake = makeFakeWebApp({ initData: 'some-raw-init-data' });
    // @ts-expect-error — минимальный window-стаб для теста.
    globalThis.window = { Telegram: { WebApp: fake } };
    captureInitData();
    expect(getInitData()).toBe('some-raw-init-data');
  });

  it('getDisplayUser() возвращает initDataUnsafe.user только для отображения', () => {
    const fake = makeFakeWebApp();
    // @ts-expect-error — минимальный window-стаб для теста.
    globalThis.window = { Telegram: { WebApp: fake } };
    expect(getDisplayUser()?.first_name).toBe('Аркадий');
  });
});
