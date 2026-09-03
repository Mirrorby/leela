import { useEffect, useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { usePayments } from '../state/usePayments';
import type { ProductId } from '../types/payments';

/** §6 ТЗ ("Основной paywall") — партии-продукты + подписка. game_ai_combo
 * включён сюда же (не в апселл ИИ-разбора на Summary) — §5 ТЗ: "комбо
 * рекомендуется предлагать... при выборе покупки одной партии", т.е.
 * контекстно это апселл именно здесь. */
const GAME_PRODUCT_IDS: ProductId[] = ['game_1', 'game_5', 'subscription_unlimited', 'game_ai_combo'];

/**
 * Пэйвол на создание партии — DiceModeSelect ведёт сюда (nav.push), когда
 * session.startGame() вернул 402 games_limit_reached. Специально СВОЙ,
 * независимый вызов usePayments() (не через параметры навигации) — так
 * баланс/каталог всегда свежие на входе, а не то, что успело устареть,
 * пока пользователь думал.
 */
export function Paywall({ session, nav }: ScreenProps) {
  const payments = usePayments();
  const [buyingId, setBuyingId] = useState<ProductId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void payments.refresh();
    // payments.refresh стабилен (useCallback с пустыми deps) — звать один раз на маунт.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gameProducts = payments.products.filter((p) => GAME_PRODUCT_IDS.includes(p.id));

  const handleBuy = async (productId: ProductId) => {
    setBuyingId(productId);
    setMessage(null);
    const status = await payments.buyProduct(productId);
    if (status === 'paid') {
      // Автоматически довершаем то, ради чего вообще открылся пэйвол —
      // request/diceMode уже в session с предыдущего экрана (DiceModeSelect),
      // startGame() переиспользует тот же pendingStartGameIdRef (он не
      // сбрасывался на 402 — партия так и не была создана, повтор безопасен).
      try {
        await session.startGame();
        nav.resetTo('GameHome');
        return;
      } catch {
        setMessage('Оплата прошла, но партию пока не удалось создать — подождите пару секунд и нажмите «Продолжить» ниже.');
        void payments.refresh();
      }
    } else if (status === 'failed') {
      setMessage('Не удалось завершить оплату — попробуйте ещё раз.');
    }
    // 'cancelled' — пользователь сам закрыл экран оплаты, ничего не показываем.
    setBuyingId(null);
  };

  const handleContinue = async () => {
    setMessage(null);
    try {
      await session.startGame();
      nav.resetTo('GameHome');
    } catch {
      // session.error уже выставлен, покажется через session ниже (если
      // экран его читает) — здесь достаточно остаться на месте.
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
      )}

      {message && <p className="muted">{message}</p>}
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
