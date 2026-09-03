import { useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { setActivePersistedGameId } from '../state/persistence';
import { MoveTile } from '../components/MoveTile';
import { getAiReviewFromServer, startAiReviewOnServer, logClientAnalyticsEvent, WorkerApiError } from '../api/workerClient';
import { usePayments } from '../state/usePayments';

type AiState = 'checking' | 'none' | 'pending' | 'ready' | 'failed' | 'locked';

const POLL_INTERVAL_MS = 2000;

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
 *   4. 'pending' → поллинг getAiReviewFromServer раз в 2с до ready/failed.
 */
export function Summary({ session, nav }: ScreenProps) {
  const { game } = session;
  const payments = usePayments();

  const [aiState, setAiState] = useState<AiState>('checking');
  const [aiContent, setAiContent] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [buyingReview, setBuyingReview] = useState(false);
  const offerShownLoggedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!game) return;
    let cancelled = false;

    getAiReviewFromServer(game.id)
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'ready') {
          setAiState('ready');
          setAiContent(result.content ?? null);
        } else if (result.status === 'pending') {
          setAiState('pending');
        } else if (result.status === 'failed') {
          setAiState('failed');
          setAiError(result.error ?? null);
        } else {
          setAiState('none');
        }
      })
      .catch(() => {
        if (!cancelled) setAiState('none'); // офлайн на старте экрана — не блокируем сам экран итогов
      });

    return () => {
      cancelled = true;
    };
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- game сам по себе не должен перезапускать проверку, только смена партии

  useEffect(() => {
    if (aiState !== 'none' || offerShownLoggedRef.current) return;
    offerShownLoggedRef.current = true;
    void logClientAnalyticsEvent('ai_offer_shown');
  }, [aiState]);

  useEffect(() => {
    if (aiState !== 'pending' || !game) return;
    pollTimerRef.current = setInterval(() => {
      getAiReviewFromServer(game.id)
        .then((result) => {
          if (result.status === 'ready') {
            setAiState('ready');
            setAiContent(result.content ?? null);
          } else if (result.status === 'failed') {
            setAiState('failed');
            setAiError(result.error ?? null);
          }
          // status === 'pending' — просто ждём следующего тика.
        })
        .catch(() => {
          // Сбой одного тика поллинга — не повод останавливать сам поллинг,
          // следующий интервал попробует снова.
        });
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [aiState, game]);

  if (!game) return null;

  const handleGetReview = async () => {
    setAiState('pending');
    setAiError(null);
    try {
      const result = await startAiReviewOnServer(game.id);
      if (result.status === 'ready') {
        setAiState('ready');
        setAiContent(result.content ?? null);
      }
      // status === 'pending' — состояние уже 'pending', поллинг подхватит сам.
    } catch (err) {
      if (err instanceof WorkerApiError && err.status === 402) {
        setAiState('locked');
      } else if (err instanceof WorkerApiError && err.status === 409) {
        // already_generating — кто-то (другая вкладка?) уже запустил, просто ждём.
        setAiState('pending');
      } else {
        setAiState('failed');
        setAiError(err instanceof WorkerApiError ? err.message : 'Не удалось запросить разбор — проверь соединение.');
      }
    }
  };

  const handleBuyReview = async () => {
    setBuyingReview(true);
    const status = await payments.buyProduct('ai_review_1');
    setBuyingReview(false);
    if (status === 'paid') {
      await handleGetReview();
    }
    // 'cancelled'/'failed' — остаёмся в состоянии 'locked', пользователь
    // может попробовать снова.
  };

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

        {aiState === 'pending' && <p className="muted">Разбор генерируется — обычно занимает несколько секунд…</p>}

        {aiState === 'ready' && aiContent && <p className="ai-review-content">{aiContent}</p>}

        {aiState === 'locked' && (
          <>
            <p className="muted">Бесплатный и купленные разборы закончились.</p>
            <button className="primary" onClick={handleBuyReview} disabled={buyingReview}>
              {buyingReview ? 'Открываем оплату…' : 'Купить разбор — 99 ⭐'}
            </button>
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
