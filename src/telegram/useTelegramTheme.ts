import { useEffect } from 'react';
import { getWebApp, isTelegramEnvironment } from './telegramAdapter';

// У приложения теперь собственная фиксированная визуальная тема (светлый
// пастельный бежево-молочный фон + золото, см. index.css) — она НЕ
// подстраивается под тему Telegram пользователя. Вместо этого мы идём в
// обратную сторону: просим Telegram покрасить SVOЙ chrome (header, фон под
// safe area) в НАШ цвет, чтобы не было резкого шва между системным
// Telegram UI и приложением. Единый бренд важнее адаптации под чужую тему.
// Значение = --bg-top из index.css (самый светлый, "верхний" тон
// градиента — раньше здесь было #6E3A17, тёмный янтарь для старой тёмной
// темы; теперь #FFFBF3, молочно-белый).
const APP_HEADER_COLOR = '#FFFBF3';
const APP_BACKGROUND_COLOR = '#FFFBF3';

export function useTelegramTheme(): void {
  useEffect(() => {
    if (!isTelegramEnvironment()) return;
    const webApp = getWebApp();
    if (!webApp) return;

    webApp.setHeaderColor?.(APP_HEADER_COLOR);
    webApp.setBackgroundColor?.(APP_BACKGROUND_COLOR);
  }, []);
}
