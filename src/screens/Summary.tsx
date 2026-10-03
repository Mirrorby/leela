import { useEffect, useRef } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { setActivePersistedGameId } from '../state/persistence';
import { MoveTile } from '../components/MoveTile';
import { logClientAnalyticsEvent } from '../api/workerClient';
import { useAiReview } from '../state/useAiReview';
import { usePayments } from '../state/usePayments';
import { formatProductPrice, ProductPurchaseButton, TributePaymentNotice } from '../components/ProductPurchase';

/**
 * Итог партии (переоформлен — п.7 правок). Список ходов — MoveTile
 * (переиспользован из Истории, см. components/MoveTile.tsx).
 *
 * ИИ-разбор (батч 6 монетизации, §7/§11/§12 ТЗ) — раньше здесь была
 * заглушка ("Скоро — в разработке"). Реальный флоу:
 *   1. При открытии экрана тихо проверяем, нет ли уже готового/идущего
 *      разбора (getAiReviewFromServer) — партию могли уже анализировать
 *      раньше (повторный визит на Summary), не показываем оффер заново.
 *   2. 'none' → показываем предложение (§7), логируем ai_offer_shown —
 *      единственное чисто клиентское событие аналитики (§26), у сервера
 *      нет своего сигнала на "просто увидел кнопку".
 *   3. Клик → startAiReviewOnServer сам решает, списывать бесплатный или
 *      платный разбор (клиент этот выбор не делает) — 402 означает "нечем
 *      списывать", тогда показываем покупку через usePayments.
 *   4. useAiReview проверяет статус без параллельных запросов и ограничивает ожидание.
 */
export function Summary({ session, nav }: ScreenProps) {
  const { game } = session;
  const payments = usePayments();

  const review = useAiReview(game?.id);
  const { state: aiState, content: aiContent, error: aiError } = review;
  const handleGetReview = () => { void review.start(); };
  const offerShownLoggedRef = useRef<string | null>(null);

  useEffect(() => {
    if (aiState !== 'none' || !game || offerShownLoggedRef.current === game.id) return;
    offerShownLoggedRef.current = game.id;
    void logClientAnalyticsEvent('ai_offer_shown');
  }, [aiState, game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (aiState === 'locked' || aiState === 'ready' || aiState === 'failed') void payments.refresh();
  }, [aiState, payments.refresh]);

  if (!game) return null;
  const reviewProduct = payments.products.find((product) => product.id === 'ai_review_1');

  return (
    <div className="screen screen-summary">
      <h1>Итог партии</h1>
      <p className="muted">Запрос: {game.request}</p>
      <p className="muted">Ходов всего: {game.turns.length}</p>
      {game.turns.length > 0 && (
        <ol className="history-list">
          {game.turns.map((turn, i) => (
            <MoveTile key={turn.id} turn={turn} index={i} cellById={session.cellById} />
          ))}
        </ol>
      )}

      <div className="ai-review-section">
        {aiState === 'checking' && <p className="muted">Проверяем, есть ли уже разбор…</p>}

        {aiState === 'none' && (
          <button className="primary" onClick={handleGetReview}>
            Получить ИИ-разбор
          </button>
        )}

        {(aiState === 'pending' || aiState === 'starting') && <p className="muted">Разбор генерируется — обычно занимает несколько секунд…</p>}

        {aiState === 'ready' && aiContent && <p className="ai-review-content">{aiContent}</p>}

        {aiState === 'locked' && (
          <>
            <p className="muted">{payments.entitlements?.canStartAiReview ? 'Разбор доступен на вашем балансе.' : 'Бесплатный и купленные разборы закончились.'}</p>
            {payments.entitlements?.canStartAiReview ? (
              <button className="primary" onClick={handleGetReview}>Получить ИИ-разбор</button>
            ) : reviewProduct ? (
              <ProductPurchaseButton product={reviewProduct} label={`Купить разбор — ${formatProductPrice(reviewProduct)}`} />
            ) : <button onClick={() => { void payments.refresh(); }} disabled={payments.loading}>
              {payments.loading ? 'Загружаем цену…' : 'Загрузить варианты оплаты'}
            </button>}
            {reviewProduct?.tribute && <TributePaymentNotice loading={payments.loading} onRefresh={() => { void payments.refresh(); }} />}
          </>
        )}

        {aiState === 'failed' && (
          <>
            <p className="screen-error">{aiError ?? 'Не удалось сгенерировать разбор.'}</p>
            <button onClick={handleGetReview}>Попробовать ещё раз</button>
          </>
        )}

        {payments.error && <p className="screen-error">{payments.error}</p>}
      </div>

      <button
        onClick={() => {
          setActivePersistedGameId(null);
          session.reset();
          nav.resetTo('Splash');
        }}
      >
        Начать заново
      </button>
    </div>
  );
}
