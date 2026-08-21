// Этап 6: Telegram Web App SDK. Это ЕДИНСТВЕННОЕ место в приложении, где
// упоминается window.Telegram — весь остальной код (хуки в этой папке,
// экраны) работает через isTelegramEnvironment()/getWebApp() и никогда не
// трогает window.Telegram напрямую. Так приложение остаётся тем же самым
// сайтом, что открывается и в обычном браузере: там window.Telegram просто
// не определён, и весь код в этом файле аккуратно возвращает null/false.
//
// Типы ниже — НЕ полный SDK, а только то подмножество API, которым реально
// пользуется приложение (ready/expand, themeParams, viewport, safeArea,
// BackButton, initData, HapticFeedback). Расширять по мере необходимости.

export type TelegramColorScheme = 'light' | 'dark';

export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

export interface TelegramSafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramWebAppInitDataUnsafe {
  user?: TelegramWebAppUser;
  [key: string]: unknown;
}

type TelegramEventName =
  | 'themeChanged'
  | 'viewportChanged'
  | 'backButtonClicked'
  | 'safeAreaChanged'
  | 'contentSafeAreaChanged';

export interface TelegramBackButton {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

export interface TelegramHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  selectionChanged: () => void;
}

export interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  colorScheme: TelegramColorScheme;
  themeParams: TelegramThemeParams;
  viewportHeight: number;
  viewportStableHeight: number;
  /** Есть не во всех версиях клиента — читаем защитно (см. useTelegramViewport). */
  safeAreaInset?: TelegramSafeAreaInset;
  contentSafeAreaInset?: TelegramSafeAreaInset;
  initData: string;
  initDataUnsafe: TelegramWebAppInitDataUnsafe;
  BackButton: TelegramBackButton;
  HapticFeedback: TelegramHapticFeedback;
  onEvent: (event: TelegramEventName, cb: () => void) => void;
  offEvent: (event: TelegramEventName, cb: () => void) => void;
  /** Красит системный header Telegram вокруг Mini App. Принимает hex-цвет. */
  setHeaderColor?: (color: string) => void;
  /** Красит фон под safe area (например, за системными кнопками). */
  setBackgroundColor?: (color: string) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

/** Открыто внутри Telegram (клиент подставил window.Telegram.WebApp)? */
export function isTelegramEnvironment(): boolean {
  return typeof window !== 'undefined' && window.Telegram?.WebApp != null;
}

/** WebApp-объект или null — если открыто как обычный сайт в браузере. */
export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

let initialized = false;

/**
 * ready() + expand(). Идемпотентно — можно смело звать из App.tsx при
 * каждом монтировании (например, из-за StrictMode двойного вызова
 * эффектов), реальный вызов SDK произойдёт один раз.
 */
export function initTelegramApp(): void {
  if (initialized) return;
  const webApp = getWebApp();
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
  initialized = true;
}

/**
 * Сырая initData-строка, сохранённая в памяти приложения на этапе 6.
 * Понадобится на этапе 7 для запросов к Worker'у — сейчас НИКАК не
 * проверяется, проверка подписи — задача backend'а.
 */
let cachedInitData: string | null = null;

export function captureInitData(): void {
  const webApp = getWebApp();
  cachedInitData = webApp?.initData ?? '';
}

export function getInitData(): string {
  if (cachedInitData === null) captureInitData();
  return cachedInitData ?? '';
}

/**
 * initDataUnsafe.user — ТОЛЬКО для отображения (например, поздороваться по
 * имени на Splash). Никогда не использовать для решений о доступе: эти
 * данные не проверены и может подделать кто угодно на клиенте.
 */
export function getDisplayUser(): TelegramWebAppUser | null {
  return getWebApp()?.initDataUnsafe.user ?? null;
}
