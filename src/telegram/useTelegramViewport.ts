import { useEffect } from 'react';
import { getWebApp, isTelegramEnvironment } from './telegramAdapter';

// Пишем в px-строках прямо в CSS-переменные — App.css использует их через
// var(--tg-viewport-stable-height, 100dvh) и var(--tg-safe-area-top, env(safe-area-inset-top))
// с фоллбэком на обычные CSS-механизмы для браузера без Telegram.
function applyViewportVars() {
  const webApp = getWebApp();
  if (!webApp) return;
  const root = document.documentElement.style;

  root.setProperty('--tg-viewport-height', `${webApp.viewportHeight}px`);
  root.setProperty('--tg-viewport-stable-height', `${webApp.viewportStableHeight}px`);

  // safeAreaInset появился не во всех версиях клиента — читаем защитно,
  // при отсутствии просто не трогаем переменные (сработает CSS env()-фоллбек).
  const inset = webApp.safeAreaInset;
  if (inset) {
    root.setProperty('--tg-safe-area-top', `${inset.top}px`);
    root.setProperty('--tg-safe-area-bottom', `${inset.bottom}px`);
    root.setProperty('--tg-safe-area-left', `${inset.left}px`);
    root.setProperty('--tg-safe-area-right', `${inset.right}px`);
  }
}

/**
 * Подписывает документ на изменения высоты вьюпорта и safe area Telegram
 * (шторка/клавиатура/чёлка). Вне Telegram — no-op, приложение работает на
 * обычных 100dvh + env(safe-area-inset-*) (см. App.css).
 */
export function useTelegramViewport(): void {
  useEffect(() => {
    if (!isTelegramEnvironment()) return;
    const webApp = getWebApp();
    if (!webApp) return;

    applyViewportVars();

    const handleViewportChanged = () => applyViewportVars();
    webApp.onEvent('viewportChanged', handleViewportChanged);
    return () => webApp.offEvent('viewportChanged', handleViewportChanged);
  }, []);
}
