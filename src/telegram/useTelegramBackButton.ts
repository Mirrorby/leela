import { useEffect, useSyncExternalStore } from 'react';
import { closeTopDialog, hasOpenDialogs, subscribeDialogs } from '../navigation/dialogStack';
import { getWebApp, isTelegramEnvironment } from './telegramAdapter';

/** Telegram Back closes the top dialog before navigating. A dialog makes
 * Back visible even on a root screen. Outside Telegram this is a no-op. */
export function useTelegramBackButton(visible: boolean, onBack: () => void): void {
  const dialogOpen = useSyncExternalStore(subscribeDialogs, hasOpenDialogs, () => false);
  useEffect(() => {
    if (!isTelegramEnvironment()) return;
    const webApp = getWebApp();
    if (!webApp) return;

    const backButton = webApp.BackButton;
    if (visible || dialogOpen) {
      backButton.show();
    } else {
      backButton.hide();
    }

    const handleBack = () => { if (!closeTopDialog()) onBack(); };
    backButton.onClick(handleBack);
    return () => {
      backButton.offClick(handleBack);
    };
  }, [visible, dialogOpen, onBack]);

  // На размонтирование всего приложения (в SPA практически никогда, но на
  // всякий случай) прячем кнопку, чтобы не оставлять её "подвисшей".
  useEffect(() => {
    return () => {
      if (!isTelegramEnvironment()) return;
      getWebApp()?.BackButton.hide();
    };
  }, []);
}
