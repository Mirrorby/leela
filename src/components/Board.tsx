import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardCoordinates } from '../types/board';
import './Board.css';

/**
 * Board — чисто визуальный компонент поля. Он НЕ знает о GameState,
 * Ruleset или Game Engine: только числа (id клетки, координаты) и
 * необязательные callback'и. Вся игровая логика остаётся в game/*, сюда
 * экран передаёт уже готовые числа.
 *
 * Устройство: готовая картинка доски (public/board/…svg) лежит фоном как
 * <img>, а поверх неё — прозрачный <svg> с ТЕМ ЖЕ viewBox: в нём живут
 * тап-зоны клеток, подсветка текущей клетки, дополнительное выделение
 * особой зоны (69–72) и фишка. Оба слоя масштабируются синхронно, потому
 * что используют одну и ту же систему координат.
 *
 * Анимация. currentCell — это ЛОГИЧЕСКАЯ (целевая) позиция фишки.
 * Необязательные fromCell/viaCell описывают ПУТЬ, которым нужно туда
 * визуально доехать:
 *   - fromCell — откуда начать анимацию (session.lastMove.fromCell).
 *     Не передан — фишка появляется сразу в currentCell без анимации
 *     (например, при первом рендере восстановленной партии).
 *   - viaCell  — промежуточная остановка (session.lastMove.landedCell),
 *     нужна только когда сработали змея/стрела: фишка сначала обычным
 *     шагом доезжает до viaCell, и только потом "перелетает" в currentCell.
 * Экран решает, передавать viaCell или нет — Board лишь проигрывает
 * полученную последовательность точек, сама не зная, что такое змея.
 */

const STEP_DURATION_MS = 480;
const LEAP_DURATION_MS = 620;

export interface BoardProps {
  coordinates: BoardCoordinates;
  /** Путь к SVG-картинке доски (обычно из getBoardImageSrc()). */
  imageSrc: string;
  /** Логическая (целевая) позиция фишки. */
  currentCell: number;
  /** Откуда анимировать приезд. Не передан — фишка ставится сразу без анимации. */
  fromCell?: number;
  /** Промежуточная остановка для двухфазной анимации змеи/стрелы. */
  viaCell?: number;
  /** Диапазон клеток, который нужно дополнительно выделить (напр. [69, 72]). */
  highlightRange?: readonly [number, number];
  /** Тап по любой клетке — посмотреть её описание, не двигая фишку. */
  onCellTap?: (cellId: number) => void;
  className?: string;
}

type TokenPhase = 'idle' | 'step' | 'leap';

export function Board({
  coordinates,
  imageSrc,
  currentCell,
  fromCell,
  viaCell,
  highlightRange,
  onCellTap,
  className,
}: BoardProps) {
  const { viewBox, cells } = coordinates;
  const coordById = useMemo(() => new Map(cells.map((c) => [c.cellId, c])), [cells]);

  // Размер клетки не хранится в JSON явно — считаем его один раз из шага
  // сетки координат (все клетки лежат на равномерной сетке).
  const cellSize = useMemo(() => {
    const xs = Array.from(new Set(cells.map((c) => c.x))).sort((a, b) => a - b);
    const ys = Array.from(new Set(cells.map((c) => c.y))).sort((a, b) => a - b);
    const stepX = xs.length > 1 ? xs[1] - xs[0] : 80;
    const stepY = ys.length > 1 ? ys[1] - ys[0] : 80;
    return Math.min(stepX, stepY);
  }, [cells]);

  const [renderCell, setRenderCell] = useState<number>(fromCell ?? currentCell);
  const [phase, setPhase] = useState<TokenPhase>('idle');
  const leapTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(leapTimerRef.current);
  }, []);

  useEffect(() => {
    window.clearTimeout(leapTimerRef.current);

    if (viaCell !== undefined && viaCell !== currentCell) {
      setPhase('step');
      setRenderCell(viaCell);
      leapTimerRef.current = window.setTimeout(() => {
        setPhase('leap');
        setRenderCell(currentCell);
      }, STEP_DURATION_MS);
    } else {
      setPhase('step');
      setRenderCell(currentCell);
    }
    // fromCell намеренно не в зависимостях: он имеет значение только в
    // момент монтирования (см. начальное значение renderCell выше), а не
    // на каждое последующее изменение currentCell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCell, viaCell]);

  const handleTransitionEnd = () => setPhase('idle');

  const tokenCoord = coordById.get(renderCell) ?? coordById.get(currentCell);
  const currentCoord = coordById.get(currentCell);

  const isSpecial = (id: number) =>
    highlightRange !== undefined && id >= highlightRange[0] && id <= highlightRange[1];

  return (
    <div className={`board-wrap${className ? ` ${className}` : ''}`}>
      <div className="board-stage" style={{ aspectRatio: viewBox.split(' ').slice(2).join(' / ') }}>
        <img className="board-bg" src={imageSrc} alt="Игровое поле Лила" draggable={false} />

        <svg
          className="board-overlay"
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label="Клетки поля, 72 штуки"
        >
          <defs>
            <radialGradient id="board-special-glow" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="var(--board-special-glow)" />
              <stop offset="100%" stopColor="var(--board-special-glow)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {cells.map((cell) => {
            const special = isSpecial(cell.cellId);
            return (
              <g
                key={cell.cellId}
                className={`board-cell${special ? ' board-cell--special' : ''}`}
                role={onCellTap ? 'button' : undefined}
                tabIndex={onCellTap ? 0 : undefined}
                aria-label={`Клетка ${cell.cellId}${special ? ', особая зона' : ''}`}
                onClick={onCellTap ? () => onCellTap(cell.cellId) : undefined}
                onKeyDown={
                  onCellTap
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onCellTap(cell.cellId);
                        }
                      }
                    : undefined
                }
              >
                {special && (
                  <>
                    <circle cx={cell.x} cy={cell.y} r={cellSize * 0.62} fill="url(#board-special-glow)" />
                    <rect
                      x={cell.x - cellSize / 2 + 2}
                      y={cell.y - cellSize / 2 + 2}
                      width={cellSize - 4}
                      height={cellSize - 4}
                      rx={5}
                      fill="none"
                      stroke="var(--board-special-line)"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                    />
                  </>
                )}
                {/* Прозрачная тап-зона поверх клетки — картинка сама не перехватывает клик. */}
                <rect
                  x={cell.x - cellSize / 2}
                  y={cell.y - cellSize / 2}
                  width={cellSize}
                  height={cellSize}
                  fill="transparent"
                  className="board-cell-hit"
                />
              </g>
            );
          })}

          {currentCoord && (
            <circle className="board-current-ring" cx={currentCoord.x} cy={currentCoord.y} r={cellSize * 0.44} />
          )}

          {tokenCoord && (
            <g
              className={`board-token board-token--${phase}`}
              style={{ transform: `translate(${tokenCoord.x}px, ${tokenCoord.y}px)` }}
              onTransitionEnd={handleTransitionEnd}
            >
              <circle className="board-token-shadow" r={cellSize * 0.26} />
              <circle className="board-token-core" r={cellSize * 0.22} />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

// Экспортируем длительности фаз, чтобы вызывающий код (напр. GameHome) мог
// при желании синхронизировать переход дальше по флоу с окончанием
// анимации — сама Board об этом никого не уведомляет, кроме как через DOM.
export const BOARD_STEP_DURATION_MS = STEP_DURATION_MS;
export const BOARD_LEAP_DURATION_MS = LEAP_DURATION_MS;
