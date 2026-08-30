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
 * Правка после ревью: первая версия фикса применяла подмену ТОЛЬКО когда
 * game.status !== 'WAITING_FOR_BIRTH' — ход мысли был "раз партия ещё
 * ждёт рождения, значит реального прогресса нет, предыгровой экран тут
 * законный". Это было неверно: партия УЖЕ СОЗДАНА НА СЕРВЕРЕ (у нее есть
 * свой id) в момент, когда становится WAITING_FOR_BIRTH, — понятия "ещё
 * не существует" тут просто нет, есть только "уже существует, но фишка
 * пока не родилась". Проверено сценарием из скрина: партия "ждёт
 * рождения · клетка 0", записанная с screen: 'RequestInput' — "Продолжить"
 * с прежней (status-зависимой) версией фикса корректно вела на
 * RequestInput, но это ТА ЖЕ ловушка: "Далее" → DiceModeSelect → выбор
 * кубика → session.startGame() создаёт ЕЩЁ ОДНУ партию поверх уже
 * существующей. Значение status вообще не должно участвовать в этом
 * решении — единственное, что имеет значение: game не null (партия
 * реально существует на сервере), а раз так, "Продолжить" должен вести
 * на GameHome при любом статусе, включая WAITING_FOR_BIRTH (GameHome
 * прекрасно показывает состояние "Ждём рождения — нужна 6" сам по себе).
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
  if (game && PRE_GAME_SCREENS.has(screen)) {
    return 'GameHome';
  }
  return screen;
}

// Редизайн (этап 7): шесть экранов флоу броска (DiceRoll, TurnResult,
// CellCard, TransitionEvent, ExtraRollPrompt, TripleSixReset) убраны из
// ScreenName и больше никогда не пушатся в стек — но старая сохранённая
// партия в localStorage (или партия, у которой на сервере такой снимок
// экрана никогда и не было — просто GameState с сервера, см. MyGames.tsx)
// могла быть записана с одним из этих имён как "текущий экран". TS-тип на
// рантайм-значение из JSON.parse/сервера не влияет, поэтому
// normalizeScreenName подстраховывает восстановление в ОБЕИХ точках входа
// (App.tsx при старте и MyGames.tsx при "Продолжить") — раньше эта
// нормализация была только в App.tsx, и запись с незнакомым именем экрана,
// выбранная через "Мои партии", падала бы при рендере (screens[name]
// оказывался undefined).
const KNOWN_SCREENS = new Set<ScreenName>(['Splash', 'MyGames', 'Intro', 'RequestInput', 'DiceModeSelect', 'GameHome', 'History', 'Summary']);

export function normalizeScreenName(name: string): ScreenName {
  // FinishScreen (п.8 правок): раньше отдельный промежуточный шаг "Партия
  // завершена". Убран из стека — сохранённая до этой правки партия,
  // ссылающаяся на 'FinishScreen', открывается прямо на Summary, а не на
  // GameHome, чтобы не откатывать человека на доску, если он уже дошёл до
  // конца пути.
  if (name === 'FinishScreen') return 'Summary';
  return KNOWN_SCREENS.has(name as ScreenName) ? (name as ScreenName) : 'GameHome';
}
