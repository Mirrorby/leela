import { ScreenHeading } from '../components/ScreenHeading';
import { tr, useLanguage } from '../i18n/language';
import { useEffect, useRef } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { setActivePersistedGameId } from '../state/persistence';
import { MoveTile } from '../components/MoveTile';
import { logClientAnalyticsEvent } from '../api/workerClient';
import { useAiReview } from '../state/useAiReview';
import { usePayments } from '../state/usePayments';
import { formatProductPrice, ProductPurchaseButton, TributePaymentNotice } from '../components/ProductPurchase';

export function Summary({ session, nav }: ScreenProps) {
  const { game } = session;
  const payments = usePayments();

  const language = useLanguage();
  const review = useAiReview(game?.id);
  const { state: aiState, content: aiContent, error: aiError } = review;
  const shortReview = () => { void review.start('short'); };
  const fullReview = () => { void review.start('full'); };
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
      <ScreenHeading>{tr("Итог партии")}</ScreenHeading>
      <p className="muted">{tr("Запрос:")} {game.request}</p>
      <p className="muted">{tr("Ходов всего:")} {game.turns.length}</p>
      {game.turns.length > 0 && (
        <ol className="history-list">
          {game.turns.map((turn, i) => (
            <MoveTile key={turn.id} turn={turn} index={i} cellById={session.cellById} />
          ))}
        </ol>
      )}

      <div className="ai-review-section">
        {((aiState === 'ready' && review.language && review.language !== language) ||
          (review.shortContent && review.shortLanguage && review.shortLanguage !== language)) &&
          <p className="muted">{tr('Сохранённый разбор остаётся на языке, на котором был создан.')}</p>}
        {aiState === 'checking' && <p className="muted">{tr("Проверяем, есть ли уже разбор…")}</p>}

        {review.shortContent && !(aiState === 'ready' && review.kind === 'full') && (
          <><h2>{tr("Краткий разбор")}</h2><p className="ai-review-content">{review.shortContent}</p></>
        )}
        {aiState === 'ready' && review.kind === 'full' && aiContent && (
          <><h2>{tr("Полный разбор")}</h2><p className="ai-review-content">{aiContent}</p></>
        )}
        {(aiState === 'pending' || aiState === 'starting') && <p className="muted">{review.kind === 'short' ? tr("Краткий") : tr("Полный")} {tr("разбор генерируется…")}</p>}
        {aiState === 'failed' && <p className="screen-error">{aiError ?? tr("Не удалось создать разбор.")}</p>}
        {aiState === 'locked' && <p className="muted">{review.kind === 'full' ? tr("Для полного разбора нужен купленный кредит.") : tr("Бесплатный краткий разбор уже использован.")}</p>}

        {!['checking', 'pending', 'starting'].includes(aiState) && !(aiState === 'ready' && review.kind === 'full') && (
          <>
            <p className="muted">{tr("Для ИИ-разбора ваше намерение и путь партии передаются Google Gemini. Нажимая кнопку получения или повтора разбора, вы соглашаетесь с этой передачей. Не включайте в намерение данные, которыми не хотите делиться. Играть можно без ИИ-разбора.")}</p>
            {!review.shortContent && (payments.entitlements?.freeAiReviewsRemaining ?? 0) > 0 && (
              <button className="primary" onClick={shortReview}>{tr("Получить краткий разбор бесплатно")}</button>
            )}
            <p className="muted">{tr("Полный разбор подробно связывает путь партии с вашим запросом. Он оплачивается отдельно.")}</p>
            {(payments.entitlements?.paidAiReviews ?? 0) > 0 ? (
              <button className="primary" onClick={fullReview}>{tr("Получить полный разбор · 1 купленный кредит")}</button>
            ) : reviewProduct ? (
              <ProductPurchaseButton product={reviewProduct} label={tr("Купить полный разбор — {0}", formatProductPrice(reviewProduct))} />
            ) : <button onClick={() => { void payments.refresh(); }} disabled={payments.loading}>
              {payments.loading ? tr("Загружаем цену…") : tr("Загрузить варианты оплаты")}
            </button>}
            {reviewProduct?.tribute && <TributePaymentNotice loading={payments.loading} onRefresh={() => { void payments.refresh(); }} />}
            {aiState === 'failed' && <button onClick={() => { void review.start(review.kind); }}>{tr("Повторить запрос разбора")}</button>}
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
      >{tr("Начать заново")} </button>
    </div>
  );
}
