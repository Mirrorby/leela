import { getWebApp, isTelegramEnvironment } from './telegramAdapter';

/** WebApp.HapticFeedback.impactOccurred(). Вне Telegram — тихо ничего не делает. */
export function hapticImpact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light'): void {
  if (!isTelegramEnvironment()) return;
  getWebApp()?.HapticFeedback.impactOccurred(style);
}

/** WebApp.HapticFeedback.notificationOccurred(). Вне Telegram — тихо ничего не делает. */
export function hapticNotification(type: 'error' | 'success' | 'warning'): void {
  if (!isTelegramEnvironment()) return;
  getWebApp()?.HapticFeedback.notificationOccurred(type);
}
