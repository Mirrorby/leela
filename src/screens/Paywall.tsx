import { useEffect, useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { usePayments } from '../state/usePayments';
import type { ProductId } from '../types/payments';
import { formatProductPrice, ProductPurchaseButton, TributePaymentNotice } from '../components/ProductPurchase';

/** §6 ТЗ ("Основной paywall") — пакеты партий Tribute. game_ai_combo
 * включён сюда же (не в апселл ИИ-разбора на Summary) — §5 ТЗ: "комбо
 * рекомендуется предлагать... при выборе покупки одной партии", т.е.
 * контекстно это апселл именно здесь. */
const GAME_PRODUCT_IDS: ProductId[] = ['game_1', 'game_5', 'game_ai_combo'];

/**
 * Пэйвол на создание партии — DiceModeSelect ведёт сюда (nav.push), когда
 * session.startGame() вернул 402 games_limit_reached. Специально СВОЙ,
 * независимый вызов usePayments() (не через параметры навигации) — так
 * баланс/каталог всегда свежие на входе, а не то, что успело устареть,
 * пока пользователь думал.
 */
export function Paywall({ session, nav }: ScreenProps) {
  const payments = usePayments();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void payments.refresh();
    // payments.refresh стабилен (useCallback с пустыми deps) — звать один раз на маунт.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gameProducts = payments.products.filter((p) => GAME_PRODUCT_IDS.includes(p.id));

  const handleContinue = async () => {
    setMessage(null);
    try {
      await session.startGame();
      nav.resetTo('GameHome');
    } catch {
      setMessage('Не удалось создать партию — попробуйте ещё раз.');
    }
  };

  return (
    <div className="screen screen-paywall">
      <h1>Партии закончились</h1>
      <p className="muted">Бесплатные и купленные партии закончились — выберите один из вариантов ниже.</p>

      {payments.loading && !payments.entitlements && <p className="muted">Загрузка…</p>}

      {gameProducts.length > 0 && (
        <ul className="game-list">
          {gameProducts.map((product) => (
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
      )}

      {gameProducts.some((product) => product.tribute) && <TributePaymentNotice loading={payments.loading} onRefresh={() => { void payments.refresh(); }} />}

      {message && <p className="screen-error">{message}</p>}
      {session.error && <p className="screen-error">{session.error}</p>}
      {!payments.loading && !payments.error && payments.products.length === 0 && <p className="muted">Оплата временно недоступна. Попробуйте обновить баланс позже.</p>}
      {payments.error && <p className="screen-error">{payments.error}</p>}

      {payments.entitlements?.canStartGame && (
        <button className="primary" onClick={handleContinue}>
          Продолжить — партия уже доступна
        </button>
      )}
      <button onClick={() => nav.pop()}>Назад</button>
    </div>
  );
}
