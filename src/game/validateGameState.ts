import { getRuleset, getContentPack } from './ruleset';
import type { GameState, Roll } from '../types/game';

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
export const isDateString = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

const EVENT_TYPES = new Set(['BIRTH_SUCCESS', 'BIRTH_FAILED', 'MOVE', 'SNAKE', 'ARROW', 'EXTRA_ROLL_GRANTED',
  'TRIPLE_SIX_RESET', 'FINISH', 'BEYOND_FINISH', 'REJECTED_GAME_FINISHED', 'REJECTED_INVALID_ROLL', 'DUPLICATE_IGNORED']);
export function isRollEvents(value: unknown): boolean {
  return Array.isArray(value) && value.every((event: unknown) => isObject(event)
    && typeof event.type === 'string' && EVENT_TYPES.has(event.type) && (event.detail === undefined || typeof event.detail === 'string'));
}

function isRoll(value: unknown): value is Roll {
  return isObject(value) && isNonEmptyString(value.id) && isNonEmptyString(value.clientEventId)
    && integer(value.value, 1, 6) && isDateString(value.createdAt);
}

/** Validate untrusted JSON before it reaches React or ruleset lookup.
 * This checks shape and supported rules, without replaying game mechanics. */
export function isGameState(value: unknown): value is GameState {
  if (!isObject(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.rulesetId)
    || typeof value.request !== 'string' || !isDateString(value.createdAt) || !isDateString(value.updatedAt)
    || typeof value.status !== 'string' || !['WAITING_FOR_BIRTH', 'IN_PROGRESS', 'FINISHED', 'ARCHIVED'].includes(value.status)
    || typeof value.diceMode !== 'string' || !['physical', 'virtual'].includes(value.diceMode) || typeof value.isBorn !== 'boolean') return false;
  try {
    const ruleset = getRuleset(value.rulesetId);
    getContentPack(value.rulesetId, 'ru');
    const size = ruleset.board.size;
    return value.rulesetVersion === ruleset.version
      && integer(value.currentCell, 0, size)
      && integer(value.positionBeforeSixSeries, 0, size)
      && integer(value.consecutiveSixes, 0, ruleset.sixRule.consecutiveLimit)
      && Array.isArray(value.currentTurnRolls) && value.currentTurnRolls.every(isRoll)
      && Array.isArray(value.turns) && value.turns.every((turn: unknown) => isObject(turn)
        && isNonEmptyString(turn.id) && isNonEmptyString(turn.clientEventId)
        && integer(turn.startCell, 0, size) && integer(turn.landedCell, 0, size)
        && integer(turn.finalCell, 0, size) && isDateString(turn.createdAt)
        && Array.isArray(turn.rolls) && turn.rolls.length > 0 && turn.rolls.every(isRoll));
  } catch {
    return false;
  }
}
