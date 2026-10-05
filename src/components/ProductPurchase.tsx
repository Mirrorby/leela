import support from '../data/paymentSupport.json';
import { logTributeCheckoutClick } from '../api/workerClient';
import { tr } from '../i18n/language';
import type { MouseEvent } from 'react';
import type { Product } from '../types/payments';
import { getWebApp } from '../telegram/telegramAdapter';

export function formatProductPrice(product: Product): string {
  if (!product.tribute) return tr("Оплата временно недоступна");
  const { amount, currency } = product.tribute;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
}

interface PurchaseProps {
  product: Product;
  disabled?: boolean;
  label?: string;
}

export function ProductPurchaseButton({ product, disabled = false, label = tr("Купить") }: PurchaseProps) {
  if (!product.tribute) return <button className="primary" disabled>{tr("Оплата недоступна")}</button>;
  const url = product.tribute.url;
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    const webApp = getWebApp();
    if (webApp?.openLink && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      webApp.openLink(url);
    }
    // Keep opening the link synchronous so mobile browsers preserve the gesture.
    trackCheckoutClick(product);
  };
  return (
    <a className="purchase-link primary" href={url} target="_blank" rel="noopener noreferrer"
      onClick={handleClick} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
      {label}
    </a>
  );
}

export function trackCheckoutClick(product: Product): void {
  // Analytics failures (including storage/UUID availability) cannot block purchase.
  try { void logTributeCheckoutClick(product.id, crypto.randomUUID()).catch(() => {}); } catch { /* Optional telemetry. */ }
}

export function TributePaymentNotice({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return (
    <div className="tribute-payment-notice">
      <p className="muted">{tr("Оплата откроется в Tribute. Войдите через тот же Telegram-аккаунт, с которым играете в Лилу. После оплаты вернитесь в игру.")}</p>
      <button disabled={loading} onClick={onRefresh}>{loading ? tr("Проверяем баланс…") : tr("Обновить баланс после оплаты")}</button>
      <p className="muted">{tr("Нужна помощь с оплатой?")} <a href={support.authorUrl} target="_blank" rel="noopener noreferrer">{tr("Написать автору")}</a> · <a href={support.tributeUrl} target="_blank" rel="noopener noreferrer">{tr("Поддержка Tribute")}</a></p>
    </div>
  );
}

export function productTitle(product: Product): string {
  const titles = { game_1: '1 партия', game_5: '5 партий', ai_review_1: 'Полный ИИ-разбор партии', game_ai_combo: 'Партия + полный ИИ-разбор' };
  return tr(titles[product.id] ?? product.title);
}
