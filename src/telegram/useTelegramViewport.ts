import { useEffect } from 'react';
import { getWebApp, isTelegramEnvironment } from './telegramAdapter';

// Пишем в px-строках прямо в CSS-переменные — App.css использует их через
// var(--tg-viewport-stable-height, 100dvh) и var(--tg-safe-area-top, env(safe-area-inset-top))
// с фоллбэком на обычные CSS-механизмы для браузера без Telegram.
//
// ВАЖНО (правка после ревью на реальном устройстве): safeAreaInset — это
// только "железный" вырез (чёлка/шторка), а системная шапка САМОГО
// Telegram (крестик "Закрыть", шеврон сворачивания, "···") рисуется
// ПОВЕРХ контента отдельным слоем и в safeAreaInset не входит — из-за
// этого наш topbar залезал под неё. За это отвечает contentSafeAreaInset
// (Bot API 8.0) — совмещаем оба инсета в одну переменную, чтобы верхний
// паддинг учитывал обе причины "не лезть сюда".
function applyViewportVars() {
  const webApp = getWebApp();
  if (!webApp) return;
  const root = document.documentElement.style;

  root.setProperty('--tg-viewport-height', `${webApp.viewportHeight}px`);
  root.setProperty('--tg-viewport-stable-height', `${webApp.viewportStableHeight}px`);

  const device = webApp.safeAreaInset;
  const content = webApp.contentSafeAreaInset;
  if (device || content) {
    const top = (device?.top ?? 0) + (content?.top ?? 0);
    const bottom = (device?.bottom ?? 0) + (content?.bottom ?? 0);
    const left = (device?.left ?? 0) + (content?.left ?? 0);
    const right = (device?.right ?? 0) + (content?.right ?? 0);
    root.setProperty('--tg-safe-area-top', `${top}px`);
    root.setProperty('--tg-safe-area-bottom', `${bottom}px`);
    root.setProperty('--tg-safe-area-left', `${left}px`);
    root.setProperty('--tg-safe-area-right', `${right}px`);
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
    // Шапка Telegram может появляться/сворачиваться (разворот в fullscreen,
    // поворот экрана) — пересчитываем инсеты и на эти события, не только
    // на изменение высоты вьюпорта.
    webApp.onEvent('safeAreaChanged', handleViewportChanged);
    webApp.onEvent('contentSafeAreaChanged', handleViewportChanged);
    return () => {
      webApp.offEvent('viewportChanged', handleViewportChanged);
      webApp.offEvent('safeAreaChanged', handleViewportChanged);
      webApp.offEvent('contentSafeAreaChanged', handleViewportChanged);
    };
  }, []);
}
