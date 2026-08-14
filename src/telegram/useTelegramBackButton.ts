import { useEffect } from 'react';
import { getWebApp, isTelegramEnvironment } from './telegramAdapter';

/**
 * Показывает системную кнопку "назад" Telegram, когда есть куда возвращаться
 * (стек глубже одного экрана), и вызывает по нажатию тот же onBack, что и
 * обычный UI-back в приложении — один источник правды (App.tsx.pop()), два
 * триггера (свой UI-back + системная кнопка Telegram).
 * Вне Telegram — no-op.
 */
export function useTelegramBackButton(visible: boolean, onBack: () => void): void {
  useEffect(() => {
    if (!isTelegramEnvironment()) return;
    const webApp = getWebApp();
    if (!webApp) return;

    const backButton = webApp.BackButton;
    if (visible) {
      backButton.show();
    } else {
      backButton.hide();
    }

    backButton.onClick(onBack);
    return () => {
      backButton.offClick(onBack);
    };
  }, [visible, onBack]);

  // На размонтирование всего приложения (в SPA практически никогда, но на
  // всякий случай) прячем кнопку, чтобы не оставлять её "подвисшей".
  useEffect(() => {
    return () => {
      if (!isTelegramEnvironment()) return;
      getWebApp()?.BackButton.hide();
    };
  }, []);
}
