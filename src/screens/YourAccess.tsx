import { useEffect, useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { usePayments } from '../state/usePayments';
import type { ProductId } from '../types/payments';

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * §24 ТЗ ("Экран Ваш доступ"). Отмены подписки в этом UI намеренно НЕТ —
 * пользователь управляет автопродлением в самом Telegram (кнопка "Отменить
 * подписку" под платежом бота), не через наш интерфейс; наш сервер узнаёт
 * об отмене из отдельного апдейта Telegram (worker/src/telegram/webhook.ts:
 * handleSubscriptionUpdate), а не инициирует её сам.
 */
export function YourAccess({ nav }: ScreenProps) {
  const payments = usePayments();
  const [buyingId, setBuyingId] = useState<ProductId | null>(null);

  useEffect(() => {
    void payments.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBuy = async (productId: ProductId) => {
    setBuyingId(productId);
    await payments.buyProduct(productId);
    setBuyingId(null);
  };

  const subscription = payments.entitlements?.subscription ?? null;
  let subscriptionLine: string;
  if (!subscription) {
    subscriptionLine = 'Подписки нет.';
  } else if (subscription.active && subscription.autoRenew) {
    subscriptionLine = `Активна, автопродление ${formatDate(subscription.periodEnd)}.`;
  } else if (subscription.active) {
    subscriptionLine = `Активна до ${formatDate(subscription.periodEnd)} (автопродление отключено — управляется в Telegram).`;
  } else {
    subscriptionLine = `Истекла ${formatDate(subscription.periodEnd)}.`;
  }

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
            ИИ-разборы: <strong>{payments.entitlements.freeAiReviewsRemaining}</strong> бесплатных,{' '}
            <strong>{payments.entitlements.paidAiReviews}</strong> купленных
          </p>
          <p>Подписка: {subscriptionLine}</p>
        </div>
      )}

      {payments.error && <p className="screen-error">{payments.error}</p>}

      <h2>Докупить</h2>
      <ul className="game-list">
        {payments.products
          .filter((product) => product.id !== 'subscription_unlimited' || !subscription?.active)
          .map((product) => (
            <li key={product.id} className="game-list-item">
              <div>
                <strong>{product.title}</strong>
                <div className="muted">{product.stars} ⭐</div>
              </div>
              <div className="game-list-actions">
                <button className="primary" onClick={() => handleBuy(product.id)} disabled={buyingId !== null}>
                  {buyingId === product.id ? 'Открываем оплату…' : 'Купить'}
                </button>
              </div>
            </li>
          ))}
      </ul>

      <button onClick={() => nav.pop()}>Назад</button>
    </div>
  );
}
