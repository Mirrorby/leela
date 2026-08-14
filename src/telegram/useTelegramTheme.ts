import { useEffect } from 'react';
import { getWebApp, isTelegramEnvironment, type TelegramThemeParams } from './telegramAdapter';

// Соответствие themeParams -> CSS-переменные. Значения из Telegram уже
// приходят готовыми hex-строками ("#ffffff"), поэтому просто прокидываем их
// как есть. index.css читает эти же переменные через var(--tg-theme-…, fallback)
// — если приложение открыто не в Telegram, переменные не установлены и в
// силу вступает fallback (обычная светлая/тёмная тема по prefers-color-scheme).
const THEME_VAR_MAP: Record<keyof TelegramThemeParams, string> = {
  bg_color: '--tg-theme-bg-color',
  text_color: '--tg-theme-text-color',
  hint_color: '--tg-theme-hint-color',
  link_color: '--tg-theme-link-color',
  button_color: '--tg-theme-button-color',
  button_text_color: '--tg-theme-button-text-color',
  secondary_bg_color: '--tg-theme-secondary-bg-color',
  header_bg_color: '--tg-theme-header-bg-color',
  accent_text_color: '--tg-theme-accent-text-color',
  section_bg_color: '--tg-theme-section-bg-color',
  section_header_text_color: '--tg-theme-section-header-text-color',
  subtitle_text_color: '--tg-theme-subtitle-text-color',
  destructive_text_color: '--tg-theme-destructive-text-color',
};

function applyThemeParams(themeParams: TelegramThemeParams) {
  const root = document.documentElement.style;
  for (const key of Object.keys(THEME_VAR_MAP) as (keyof TelegramThemeParams)[]) {
    const value = themeParams[key];
    const cssVar = THEME_VAR_MAP[key];
    if (value) {
      root.setProperty(cssVar, value);
    } else {
      root.removeProperty(cssVar);
    }
  }
}

/**
 * Подписывает документ на тему Telegram. Вне Telegram — no-op, приложение
 * остаётся на обычной light/dark теме браузера (см. index.css).
 */
export function useTelegramTheme(): void {
  useEffect(() => {
    if (!isTelegramEnvironment()) return;
    const webApp = getWebApp();
    if (!webApp) return;

    applyThemeParams(webApp.themeParams);

    const handleThemeChanged = () => applyThemeParams(webApp.themeParams);
    webApp.onEvent('themeChanged', handleThemeChanged);
    return () => webApp.offEvent('themeChanged', handleThemeChanged);
  }, []);
}
