import { tr, locale } from '../i18n/language';
import { useEffect } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { usePayments } from '../state/usePayments';
import { formatProductPrice, productTitle, ProductPurchaseButton, TributePaymentNotice } from '../components/ProductPurchase';

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

// Historical access is displayed only until the already paid period expires.
export function YourAccess({ nav }: ScreenProps) {
  const payments = usePayments();

  useEffect(() => {
    void payments.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscription = payments.entitlements?.subscription ?? null;
  const subscriptionLine = subscription ? tr("До {0}.{1}", formatDate(subscription.periodEnd), subscription.autoRenew ? tr(" Автопродление отключается; новый период не продаётся.") : '') : '';

  return (
    <div className="screen screen-your-access">
      <h1>{tr("Ваш доступ")}</h1>

      {payments.loading && !payments.entitlements && <p className="muted">{tr("Загрузка…")}</p>}

      {payments.entitlements && (
        <div className="access-summary">
          <p>{tr("Партии:")} <strong>{payments.entitlements.freeGamesRemaining}</strong> {tr("бесплатных,")}{' '}
            <strong>{payments.entitlements.paidGames}</strong> {tr("купленных")} </p>
          <p>{tr("Краткий ИИ-разбор:")} <strong>{payments.entitlements.freeAiReviewsRemaining}</strong> {tr("бесплатно")} </p>
          <p>{tr("Полные ИИ-разборы:")} <strong>{payments.entitlements.paidAiReviews}</strong> {tr("купленных")} </p>
          {subscription?.active && <p>{tr("Ранее оплаченный доступ:")} {subscriptionLine}</p>}
        </div>
      )}

      {!payments.loading && !payments.error && payments.products.length === 0 && <p className="muted">{tr("Оплата временно недоступна. Попробуйте обновить баланс позже.")}</p>}
      {payments.error && <p className="screen-error">{payments.error}</p>}

      <h2>{tr("Докупить")}</h2>
      <ul className="game-list">
        {payments.products.map((product) => (
            <li key={product.id} className="game-list-item">
              <div>
                <strong>{productTitle(product)}</strong>
                <div className="muted">{formatProductPrice(product)}</div>
              </div>
              <div className="game-list-actions">
                <ProductPurchaseButton product={product} />
              </div>
            </li>
          ))}
      </ul>

      {payments.products.some((product) => product.tribute) && <TributePaymentNotice loading={payments.loading} onRefresh={() => { void payments.refresh(); }} />}

      <button onClick={() => nav.pop()}>{tr("Назад")}</button>
    </div>
  );
}
