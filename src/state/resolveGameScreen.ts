import type { ScreenName } from '../navigation/types';
import type { GameState } from '../types/game';

/**
 * Найденный баг ("Продолжить" незавершённую партию из "Моих партий"
 * фактически заводит НОВУЮ, а не возвращает к старой): экраны ДО создания
 * партии (Intro, RequestInput, DiceModeSelect) могут — из-за гонки между
 * commit'ом setGame(newGame) внутри useGameSession.startGame() и
 * последующим nav.resetTo('GameHome') в DiceModeSelect.choose() —
 * персистнуться как "текущий экран" для партии, у которой на самом деле
 * УЖЕ есть реальный прогресс (родилась, есть ходы). Дальше — замкнутый
 * круг: открываем такую партию, видим RequestInput с восстановленным
 * старым текстом запроса (session.request действительно восстанавливается
 * верно), жмём "Далее" → DiceModeSelect → выбираем кубик → это создаёт
 * СОВЕРШЕННО НОВУЮ партию на сервере (новый id), а старая с прогрессом
 * остаётся сиротой — доступной только через повторный заход в "Мои
 * партии", где та же ловушка повторится снова.
 *
 * Фикс — defense in depth в двух точках:
 *  1) ЗАПИСЬ (App.tsx, persist-эффект) — не даём такому "предыгровому"
 *     экрану вообще попасть в снимок партии с прогрессом.
 *  2) ЧТЕНИЕ (App.tsx при старте, MyGames при "Продолжить") — самолечение
 *     уже испорченных ранее записей: если сохранённый экран всё равно
 *     оказался "предыгровым" для партии с прогрессом (старая запись с ДО
 *     этого фикса), интерпретируем это как GameHome, а не как настоящий
 *     RequestInput/DiceModeSelect/Intro.
 */
const PRE_GAME_SCREENS = new Set<ScreenName>(['Intro', 'RequestInput', 'DiceModeSelect']);

export function resolveGameScreen(screen: ScreenName, game: GameState | null): ScreenName {
  if (game && game.status !== 'WAITING_FOR_BIRTH' && PRE_GAME_SCREENS.has(screen)) {
    return 'GameHome';
  }
  return screen;
}
