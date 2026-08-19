import { useEffect, useRef, useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import type { RollEvent, RollEventType } from '../types/game';
import { Board, BOARD_LEAP_DURATION_MS, BOARD_STEP_DURATION_MS } from '../components/Board';
import { Modal } from '../components/Modal';
import { CellContent } from '../components/CellContent';
import { getBoardCoordinates, getBoardImageSrc } from '../game/boardCoordinates';
import { DiceIcon } from '../components/icons';
import { hapticImpact, hapticNotification } from '../telegram/haptics';

// Сколько крутится кубик, прежде чем на грани "проявится" результат (виртуальный режим).
const ROLL_SPIN_MS = 500;
// Сколько держим результат на грани кубика, прежде чем убрать его и запустить анимацию доски.
const FACE_HOLD_MS = 380;
// Как долго держится краткое всплывающее сообщение (неудачное рождение / отклонённый бросок).
const FLASH_MS = 1800;

// Значимые события, которые стоит показать бейджем в модалке результата —
// подмножество RollEventType: MOVE слишком очевиден (клетка и так видна),
// а TRIPLE_SIX_RESET/EXTRA_ROLL_GRANTED/FINISH обрабатываются отдельно ниже.
const NOTABLE_EVENT_LABELS: Partial<Record<RollEventType, string>> = {
  BIRTH_SUCCESS: 'Фишка родилась!',
  SNAKE: 'Змея утянула фишку вниз',
  ARROW: 'Стрела подняла фишку вверх',
  BEYOND_FINISH: 'Фишка вышла за пределы клетки 68',
};

// События, при которых фишка не двигалась вовсе — для них модалка с клеткой
// не нужна, достаточно короткой всплывающей подсказки у кубика.
const FLASH_EVENT_LABELS: Partial<Record<RollEventType, string>> = {
  BIRTH_FAILED: 'Не 6 — рождение не состоялось, попробуй ещё раз.',
  REJECTED_GAME_FINISHED: 'Партия уже завершена.',
  REJECTED_INVALID_ROLL: 'Некорректное значение броска.',
  DUPLICATE_IGNORED: 'Повторный бросок проигнорирован.',
};

type DiceStage = 'idle' | 'physical-pick' | 'rolling' | 'face' | 'moving';

type Sheet =
  | { kind: 'result'; cellId: number; rollValue: number; events: RollEvent[] }
  | { kind: 'triple-six'; cellId: number }
  | { kind: 'peek'; cellId: number };

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
 * Intro, RequestInput, DiceModeSelect, MyGames, History, Summary,
 * FinishScreen остаются полноценными экранами — их эта переработка не
 * касается.
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
      : `Клетка ${game.currentCell}`;
  const topSnippet = currentCellContent?.shortDescription || currentCellContent?.name || game.request;

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
   * это без value (движок сам бросит случайное число), физический — со
   * значением, которое человек выбрал руками.
   */
  const resolveRoll = (value?: number) => {
    hapticImpact('medium');
    const { events, move, game: updatedGame, value: rolledValue } = session.roll(value);

    setFaceValue(rolledValue);
    setDiceStage('face');

    after(FACE_HOLD_MS, () => {
      if (!move) {
        // Рождение не удалось / бросок отклонён движком — фишка не
        // двигалась, показывать модалку с клеткой нечего: коротко
        // сообщаем, что произошло, и возвращаем кубик в исходное состояние.
        setDiceStage('idle');
        setFaceValue(null);
        const label = (Object.keys(FLASH_EVENT_LABELS) as RollEventType[])
          .map((type) => (hasEvent(events, type) ? FLASH_EVENT_LABELS[type] : undefined))
          .find(Boolean);
        if (label) showFlash(label);
        return;
      }

      setDiceStage('moving');
      const hasVia = move.landedCell !== move.finalCell;
      const boardAnimMs = BOARD_STEP_DURATION_MS + (hasVia ? BOARD_LEAP_DURATION_MS : 0);

      after(boardAnimMs, () => {
        setDiceStage('idle');
        setFaceValue(null);
        hapticImpact('light');
        if (hasEvent(events, 'TRIPLE_SIX_RESET')) {
          setSheet({ kind: 'triple-six', cellId: updatedGame.currentCell });
        } else {
          setSheet({ kind: 'result', cellId: updatedGame.currentCell, rollValue: rolledValue, events });
        }
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

  const dicePips = diceStage === 'face' && faceValue ? faceValue : undefined;
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
          ⋯
        </button>
      </div>

      <div className="game-home-board">
        <Board
          coordinates={coordinates}
          imageSrc={imageSrc}
          currentCell={game.currentCell}
          fromCell={fromCell}
          viaCell={viaCell}
          highlightRange={specialZone}
          onCellTap={handleCellTap}
        />
      </div>

      <div className="game-home-bottom">
        {game.status === 'FINISHED' ? (
          <button className="primary" onClick={() => nav.push('FinishScreen')}>
            К завершению
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
                  {v}
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

      <Modal open={sheet?.kind === 'triple-six'} onClose={closeSheet} title="Три шестёрки подряд">
        {sheet?.kind === 'triple-six' && (
          <>
            <p>Серия шестёрок оборвана — фишка возвращается на клетку {sheet.cellId}.</p>
            <div className="modal-actions">
              <button className="primary" onClick={rollAgain}>
                Бросить снова
              </button>
            </div>
          </>
        )}
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
                    nav.push('FinishScreen');
                  }}
                >
                  Завершить путь
                </button>
              ) : hasEvent(sheet.events, 'EXTRA_ROLL_GRANTED') ? (
                <>
                  <button className="primary" onClick={rollAgain}>
                    Выпала 6 — бросить ещё раз
                  </button>
                  <button onClick={closeSheet}>Закрыть</button>
                </>
              ) : (
                <button className="primary" onClick={closeSheet}>
                  Закрыть
                </button>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
