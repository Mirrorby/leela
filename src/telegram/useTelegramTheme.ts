import { useEffect } from 'react';
import { getWebApp, isTelegramEnvironment } from './telegramAdapter';

// У приложения теперь собственная фиксированная визуальная тема (тёмный
// фиолет + золото, см. index.css) — она НЕ подстраивается под тему
// Telegram пользователя. Вместо этого мы идём в обратную сторону: просим
// Telegram покрасить SVOЙ chrome (header, фон под safe area) в НАШ цвет,
// чтобы не было резкого шва между системным Telegram UI и приложением.
// Единый бренд важнее адаптации под чужую тему.
const APP_HEADER_COLOR = '#241033';
const APP_BACKGROUND_COLOR = '#241033';

export function useTelegramTheme(): void {
  useEffect(() => {
    if (!isTelegramEnvironment()) return;
    const webApp = getWebApp();
    if (!webApp) return;

    webApp.setHeaderColor?.(APP_HEADER_COLOR);
    webApp.setBackgroundColor?.(APP_BACKGROUND_COLOR);
  }, []);
}
