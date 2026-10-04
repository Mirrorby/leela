import { useEffect } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { usePayments } from '../state/usePayments';
import { formatProductPrice, ProductPurchaseButton, TributePaymentNotice } from '../components/ProductPurchase';

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Historical access is displayed only until the already paid period expires.
export function YourAccess({ nav }: ScreenProps) {
  const payments = usePayments();

  useEffect(() => {
    void payments.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscription = payments.entitlements?.subscription ?? null;
  const subscriptionLine = subscription ? `До ${formatDate(subscription.periodEnd)}.${subscription.autoRenew ? ' Автопродление отключается; новый период не продаётся.' : ''}` : '';

  return (
    <div className="screen screen-your-access">
      <h1>Ваш доступ</h1>

      {payments.loading && !payments.entitlements && <p className="muted">Загрузка…</p>}

      {payments.entitlements && (
        <div className="access-summary">
          <p>
            Партии: <strong>{payments.entitlements.freeGamesRemaining}</strong> бесплатных,{' '}
            <strong>{payments.entitlements.paidGames}</strong> купленных
          </p>
          <p>
            Краткий ИИ-разбор: <strong>{payments.entitlements.freeAiReviewsRemaining}</strong> бесплатно
          </p>
          <p>
            Полные ИИ-разборы: <strong>{payments.entitlements.paidAiReviews}</strong> купленных
          </p>
          {subscription?.active && <p>Ранее оплаченный доступ: {subscriptionLine}</p>}
        </div>
      )}

      {!payments.loading && !payments.error && payments.products.length === 0 && <p className="muted">Оплата временно недоступна. Попробуйте обновить баланс позже.</p>}
      {payments.error && <p className="screen-error">{payments.error}</p>}

      <h2>Докупить</h2>
      <ul className="game-list">
        {payments.products.map((product) => (
            <li key={product.id} className="game-list-item">
              <div>
                <strong>{product.title}</strong>
                <div className="muted">{formatProductPrice(product)}</div>
              </div>
              <div className="game-list-actions">
                <ProductPurchaseButton product={product} />
              </div>
            </li>
          ))}
      </ul>

      {payments.products.some((product) => product.tribute) && <TributePaymentNotice loading={payments.loading} onRefresh={() => { void payments.refresh(); }} />}

      <button onClick={() => nav.pop()}>Назад</button>
    </div>
  );
}
