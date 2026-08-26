import { useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import type { GameState, RollEvent, RollEventType } from '../types/game';
import type { LastMove } from '../state/useGameSession';
import { Board, BOARD_LEAP_DURATION_MS, BOARD_STEP_DURATION_MS } from '../components/Board';
import { Modal } from '../components/Modal';
import { CellContent } from '../components/CellContent';
import { getBoardCoordinates, getBoardImageSrc, getBoardOverlaySrcs } from '../game/boardCoordinates';
import { DiceIcon, GamesListIcon } from '../components/icons';
import { hapticImpact, hapticNotification } from '../telegram/haptics';

// Сколько крутится кубик, прежде чем на грани "проявится" результат (виртуальный режим).
const ROLL_SPIN_MS = 500;
// Сколько держим результат на грани кубика, прежде чем убрать его и запустить анимацию доски.
const FACE_HOLD_MS = 380;
// Как долго держится краткое всплывающее сообщение (неудачное рождение / отклонённый бросок).
const FLASH_MS = 1800;

// Значимые события, которые стоит показать бейджем в модалке результата —
// подмножество RollEventType: MOVE слишком очевиден (клетка и так видна),
// а EXTRA_ROLL_GRANTED/FINISH обрабатываются отдельно ниже (это уже не
// просто бейдж, а другая кнопка действия).
const NOTABLE_EVENT_LABELS: Partial<Record<RollEventType, string>> = {
  BIRTH_SUCCESS: 'Фишка родилась!',
  SNAKE: 'Змея утянула фишку вниз',
  ARROW: 'Стрела подняла фишку вверх',
  BEYOND_FINISH: 'Клетка за финишем — дальше только маленькие числа',
  // Правка после сверки реальных правил: раньше TRIPLE_SIX_RESET означал
  // "фишка вообще не двигалась" и получал отдельный тип модалки. Теперь
  // это не так — сгорание серии всегда сопровождается обычным ходом
  // (см. gameEngine.ts), поэтому это просто ещё один бейдж в обычном
  // результате, как SNAKE/ARROW.
  TRIPLE_SIX_RESET: 'Три шестёрки подряд сгорели — старт этого хода сброшен',
};

// События, при которых фишка не двигалась вовсе — для них модалка с клеткой
// не нужна, достаточно короткой всплывающей подсказки у кубика.
const FLASH_EVENT_LABELS: Partial<Record<RollEventType, string>> = {
  BIRTH_FAILED: 'Не 6 — рождение не состоялось, попробуй ещё раз.',
  REJECTED_GAME_FINISHED: 'Партия уже завершена.',
  REJECTED_INVALID_ROLL: 'Некорректное значение броска.',
  DUPLICATE_IGNORED: 'Повторный бросок проигнорирован.',
};

// Перелёт (актуально для клеток 69–71 — зона перед финишем, где годится
// только точное попадание): движок и здесь закрывает ход обычным MOVE
// (см. gameEngine.ts), просто фишка остаётся на месте — это НЕ отдельный
// RollEventType, а detail у MOVE ('overshoot: stayed in place'), поэтому
// своя константа, а не запись в FLASH_EVENT_LABELS выше.
const OVERSHOOT_FLASH = 'Слишком много очков — фишка остаётся на месте, попробуй ещё раз.';

type DiceStage = 'idle' | 'physical-pick' | 'rolling' | 'face' | 'moving';

type Sheet = { kind: 'result'; cellId: number; rollValue: number; events: RollEvent[] } | { kind: 'peek'; cellId: number };

function hasEvent(events: RollEvent[], type: RollEventType): boolean {
  return events.some((e) => e.type === type);
}

/**
 * GameHome — единственный игровой экран (этап "редизайн", п.1). Раньше
 * бросок кубика был цепочкой отдельных экранов: DiceRoll → TurnResult →
 * CellCard/TransitionEvent → ExtraRollPrompt/TripleSixReset. Теперь вся эта
 * цепочка — оркестрация внутри одного компонента: кубик крутится на месте,
 * фишка едет по доске (это умеет сама Board, см. fromCell/viaCell), а по
 * итогам показывается один и тот же Modal с разным содержимым. Splash,
 * Intro, RequestInput, DiceModeSelect, MyGames, History, Summary остаются
 * полноценными экранами — их эта переработка не касается. FinishScreen
 * (промежуточный шаг "Партия завершена") убран отдельной правкой (п.8) —
 * при завершении партии переходим сразу на Summary.
 */
export function GameHome({ session, nav }: ScreenProps) {
  const { game, ruleset, lastMove, cellById } = session;

  const [diceStage, setDiceStage] = useState<DiceStage>('idle');
  const [faceValue, setFaceValue] = useState<number | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  if (!game) {
    return (
      <div className="screen screen-centered">
        <p>Партия ещё не создана.</p>
        <button className="primary" onClick={() => nav.resetTo('Splash')}>
          В начало
        </button>
      </div>
    );
  }

  const coordinates = getBoardCoordinates(game.rulesetId);
  const imageSrc = getBoardImageSrc(game.rulesetId);
  const overlayImageSrcs = getBoardOverlaySrcs(game.rulesetId);

  // Анимируем приезд фишки только когда lastMove реально закончился именно
  // в текущей клетке — а не при каждом заходе на GameHome (например, из
  // "Истории" и обратно).
  const hasFreshMove = lastMove !== null && lastMove.finalCell === game.currentCell;
  const fromCell = hasFreshMove ? lastMove.fromCell : undefined;
  const viaCell = hasFreshMove && lastMove.landedCell !== lastMove.finalCell ? lastMove.landedCell : undefined;

  const specialZone: [number, number] = [ruleset.board.finishCell + 1, ruleset.board.extendedFinishCell];

  const currentCellContent = game.isBorn ? cellById(game.currentCell) : undefined;
  const topLabel = !game.isBorn
    ? 'Ждём рождения — нужна 6'
    : game.status === 'FINISHED'
      ? 'Путь пройден'
      : `Клетка №${game.currentCell}`;
  // п.5 правок: раньше здесь показывался либо shortDescription клетки, либо,
  // если контента ещё не было (например, самая первая отрисовка после
  // рождения, пока getBoardCoordinates/cellById не подтянулись), запрос
  // пользователя (game.request) как временный фоллбек — так на верхнюю
  // плитку иногда просачивался длинный текст запроса. Убрано по правке:
  // до рождения плитка вообще без второй строки, после — только санскритское
  // название клетки; краткое описание клетки теперь смотрят по тапу
  // (открывает модалку CellContent), как и раньше для полного описания.
  const topSnippet = game.isBorn ? currentCellContent?.sanskrit : undefined;

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const after = (ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  };

  const showFlash = (message: string) => {
    setFlash(message);
    hapticNotification('warning');
    after(FLASH_MS, () => setFlash(null));
  };

  /**
   * Общий хвост оркестрации для обоих режимов кубика: виртуальный вызывает
   * это без value (сервер сам бросит случайное число), физический — со
   * значением, которое человек выбрал руками.
   *
   * session.roll() — сетевой запрос к Worker'у (этап 7.5, тонкий клиент).
   * При сбое (нет сети, партия уже завершена на сервере и т.п.) он бросает
   * исключение — ловим здесь, чтобы кубик не застрял навсегда в состоянии
   * "крутится": возвращаем idle и показываем ту же короткую всплывающую
   * подсказку, что и для отклонённых движком бросков.
   */
  const resolveRoll = async (value?: number) => {
    hapticImpact('medium');
    let events: RollEvent[];
    let move: LastMove | null;
    let updatedGame: GameState;
    let rolledValue: number;
    try {
      ({ events, move, game: updatedGame, value: rolledValue } = await session.roll(value));
    } catch {
      setDiceStage('idle');
      showFlash(session.error ?? 'Не удалось отправить бросок — проверь соединение.');
      return;
    }

    setFaceValue(rolledValue);
    setDiceStage('face');

    after(FACE_HOLD_MS, () => {
      // ВАЖНО (баг, найден при визуальной проверке): движок НЕ добавляет
      // событие MOVE для успешного рождения (см. gameEngine.ts — рождение
      // пушит только BIRTH_SUCCESS), поэтому move здесь будет null даже
      // когда фишка реально встала на клетку 1. !move — это "фишка
      // физически не сдвинулась" ТОЛЬКО для остальных случаев (неудачное
      // рождение, отклонённый бросок) — рождение обрабатываем отдельной
      // веткой ДО общего "ничего не произошло" сценария.
      const isBirth = hasEvent(events, 'BIRTH_SUCCESS');

      // Баг п.3: перелёт (клетки 69–71 требуют точного попадания на финиш)
      // раньше открывал ту же модалку с карточкой клетки, что и обычный
      // успешный ход, — потому что gameEngine и в этом случае эмитит MOVE
      // (move здесь НЕ null, см. useGameSession.roll: fromCell === landedCell
      // === finalCell === текущая клетка). Из-за этого карточка одной и той
      // же клетки заново всплывала на каждую неудачную попытку докатиться до
      // финиша. Перелёт распознаём по detail у MOVE, а не по отдельному
      // типу события — движок специально не заводит для этого свой
      // RollEventType (см. комментарий в gameEngine.ts).
      const moveEvent = events.find((e) => e.type === 'MOVE');
      const isOvershoot = moveEvent?.detail?.startsWith('overshoot') ?? false;

      if (isOvershoot) {
        setDiceStage('idle');
        showFlash(OVERSHOOT_FLASH);
        return;
      }

      if (!move && !isBirth) {
        // Рождение не удалось / бросок отклонён движком — фишка не
        // двигалась, показывать модалку с клеткой нечего: коротко
        // сообщаем, что произошло, и возвращаем кубик в исходное состояние.
        // Грань (faceValue) НЕ сбрасываем — п.3 редизайна: последнее
        // выпавшее значение остаётся на кубике до следующего броска, даже
        // если сам бросок оказался "неудачным" (не 6 при рождении и т.п.).
        setDiceStage('idle');
        const label = (Object.keys(FLASH_EVENT_LABELS) as RollEventType[])
          .map((type) => (hasEvent(events, type) ? FLASH_EVENT_LABELS[type] : undefined))
          .find(Boolean);
        if (label) showFlash(label);
        return;
      }

      // У рождения нет "пути" по доске (фишки ещё не было на поле) —
      // анимировать нечего, сразу открываем модалку. У обычного хода путь
      // есть (move !== null) — даём доске время доехать/перелететь.
      const hasVia = move !== null && move.landedCell !== move.finalCell;
      const boardAnimMs = move ? BOARD_STEP_DURATION_MS + (hasVia ? BOARD_LEAP_DURATION_MS : 0) : 0;

      setDiceStage('moving');
      after(boardAnimMs, () => {
        setDiceStage('idle');
        hapticImpact('light');
        // Раньше здесь была отдельная ветка для TRIPLE_SIX_RESET (свой тип
        // модалки, без содержимого клетки) — убрана вместе со сгоранием
        // "без хода": теперь это всегда обычный результат с ходом, просто
        // с дополнительным бейджем (см. NOTABLE_EVENT_LABELS выше).
        setSheet({ kind: 'result', cellId: updatedGame.currentCell, rollValue: rolledValue, events });
      });
    });
  };

  const handleDiceTap = () => {
    if (diceStage !== 'idle' || sheet !== null || game.status === 'FINISHED') return;

    if (game.diceMode === 'physical') {
      setDiceStage('physical-pick');
      return;
    }

    setDiceStage('rolling');
    hapticImpact('light');
    after(ROLL_SPIN_MS, () => resolveRoll());
  };

  const handleFaceSelect = (value: number) => {
    if (diceStage !== 'physical-pick') return;
    resolveRoll(value);
  };

  const cancelPhysicalPick = () => setDiceStage('idle');

  const closeSheet = () => {
    setSheet(null);
    clearTimers();
  };

  const handleCellTap = (cellId: number) => {
    if (diceStage !== 'idle' || sheet !== null) return;
    setSheet({ kind: 'peek', cellId });
  };

  const toggleDiceMode = () => {
    if (diceStage !== 'idle') return;
    session.setDiceMode(game.diceMode === 'virtual' ? 'physical' : 'virtual');
  };

  const rollAgain = () => {
    closeSheet();
    // Небольшая пауза, чтобы шторка успела закрыться визуально перед новым броском.
    after(60, handleDiceTap);
  };

  // п.3 редизайна: последняя выпавшая грань остаётся на кубике до
  // следующего броска (и в виртуальном, и в физическом режиме) — не
  // сбрасываем в "generic" иконку сразу после того, как открылась модалка
  // с результатом. Единственный момент, когда грань скрыта, — сам спин
  // виртуального кубика (анимация вращения ещё идёт, значение не выбрано).
  const dicePips = diceStage === 'rolling' ? undefined : (faceValue ?? undefined);
  const diceLabel = !game.isBorn ? 'Бросить кубик на рождение' : 'Бросить кубик';

  return (
    <div className="screen screen-game-home">
      <div className="game-home-topbar">
        <button className="icon-button" aria-label="В меню" onClick={() => nav.resetTo('Splash')}>
          ☰
        </button>
        <div className="current-cell-info">
          <span className="cell-number">{topLabel}</span>
          {topSnippet && <span className="cell-snippet">{topSnippet}</span>}
        </div>
        <button className="icon-button" aria-label="Мои партии" onClick={() => nav.push('MyGames')}>
          <GamesListIcon />
        </button>
      </div>

      <div className="game-home-board">
        <Board
          coordinates={coordinates}
          imageSrc={imageSrc}
          overlayImageSrcs={overlayImageSrcs}
          currentCell={game.currentCell}
          fromCell={fromCell}
          viaCell={viaCell}
          highlightRange={specialZone}
          onCellTap={handleCellTap}
        />
      </div>

      <div className="game-home-bottom">
        {game.status === 'FINISHED' ? (
          <button className="primary" onClick={() => nav.push('Summary')}>
            К итогу партии
          </button>
        ) : diceStage === 'physical-pick' ? (
          <div className="dice-physical-pick">
            <p className="muted">Какая грань выпала?</p>
            <div className="dice-faces">
              {[1, 2, 3, 4, 5, 6].map((v) => (
                <button
                  key={v}
                  className="dice-face-button"
                  aria-label={`Грань ${v}`}
                  onClick={() => handleFaceSelect(v)}
                >
                  <DiceIcon value={v} />
                </button>
              ))}
            </div>
            <button className="dice-pick-cancel" onClick={cancelPhysicalPick}>
              Отмена
            </button>
          </div>
        ) : (
          <button
            className={`dice-fab${diceStage === 'rolling' ? ' rolling' : ''}`}
            aria-label={diceLabel}
            disabled={diceStage !== 'idle'}
            onClick={handleDiceTap}
          >
            <DiceIcon value={dicePips} />
          </button>
        )}

        {flash && <div className="game-home-flash">{flash}</div>}

        <div className="game-home-links">
          <button onClick={() => nav.push('History')}>История ходов</button>
          <button onClick={toggleDiceMode} disabled={diceStage !== 'idle'}>
            {game.diceMode === 'virtual' ? 'Кубик: виртуальный' : 'Кубик: физический'}
          </button>
        </div>
      </div>

      <Modal open={sheet?.kind === 'peek'} onClose={closeSheet}>
        {sheet?.kind === 'peek' && <CellContent cellId={sheet.cellId} cell={cellById(sheet.cellId)} />}
      </Modal>

      <Modal open={sheet?.kind === 'result'} onClose={closeSheet}>
        {sheet?.kind === 'result' && (
          <>
            <p className="modal-move-line">Выпало: {sheet.rollValue}</p>
            {(() => {
              const badges = (Object.keys(NOTABLE_EVENT_LABELS) as RollEventType[]).filter((type) =>
                hasEvent(sheet.events, type)
              );
              return badges.length > 0 ? (
                <div className="modal-badges">
                  {badges.map((type) => (
                    <span key={type} className="modal-badge">
                      {NOTABLE_EVENT_LABELS[type]}
                    </span>
                  ))}
                </div>
              ) : null;
            })()}
            <CellContent cellId={sheet.cellId} cell={cellById(sheet.cellId)} />
            <div className="modal-actions">
              {hasEvent(sheet.events, 'FINISH') ? (
                <button
                  className="primary"
                  onClick={() => {
                    closeSheet();
                    // п.8 правок: раньше вело на промежуточный экран
                    // "Партия завершена" с ещё одной кнопкой-переходом на
                    // итог — лишний шаг убран, идём сразу на сам итог.
                    nav.push('Summary');
                  }}
                >
                  Итог партии
                </button>
              ) : hasEvent(sheet.events, 'EXTRA_ROLL_GRANTED') ? (
                <>
                  <button className="primary" onClick={rollAgain}>
                    Выпала 6 — бросить ещё раз
                  </button>
                  <button onClick={closeSheet}>Продолжить</button>
                </>
              ) : (
                <button className="primary" onClick={closeSheet}>
                  Продолжить
                </button>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
