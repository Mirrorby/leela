import type { MouseEvent } from 'react';
import type { Product } from '../types/payments';
import { getWebApp } from '../telegram/telegramAdapter';

export function formatProductPrice(product: Product): string {
  if (!product.tribute) return `${product.stars} ⭐`;
  const { amount, currency } = product.tribute;
  if (currency === 'XTR') return `${amount} ⭐`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
}

interface PurchaseProps {
  product: Product;
  disabled?: boolean;
  label?: string;
  onBuyStars: () => void;
}

export function ProductPurchaseButton({ product, disabled = false, label = 'Купить', onBuyStars }: PurchaseProps) {
  if (!product.tribute) return <button className="primary" disabled={disabled} onClick={onBuyStars}>{label}</button>;
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
  };
  return (
    <a className="purchase-link primary" href={url} target="_blank" rel="noopener noreferrer"
      onClick={handleClick} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
      {label}
    </a>
  );
}

export function TributePaymentNotice({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return (
    <div className="tribute-payment-notice">
      <p className="muted">Оплата откроется в Tribute. Войдите через тот же Telegram-аккаунт, с которым играете в Лилу. После оплаты вернитесь в игру.</p>
      <button disabled={loading} onClick={onRefresh}>{loading ? 'Проверяем баланс…' : 'Обновить баланс после оплаты'}</button>
    </div>
  );
}
