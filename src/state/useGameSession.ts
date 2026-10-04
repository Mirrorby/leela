import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getRuleset, getContentPack } from '../game/ruleset';
import { createGameSessionController } from './gameSessionController';
export type { LastMove } from './gameSessionController';

// The controller preserves network operation IDs and fences stale responses;
// the hook exposes the same session interface to the existing screens.
export function useGameSession() {
  const [controller] = useState(() => createGameSessionController());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.cancelPending(), [controller]);
  const activeRuleset = state.game?.rulesetId ?? 'classic-v1';
  const ruleset = getRuleset(activeRuleset);
  const content = getContentPack(activeRuleset, 'ru');
  const cellById = useCallback((id: number) => content.cells.find((cell) => cell.id === id), [content]);
  return { ...state, ...controller, ruleset, content, cellById };
}

export type GameSession = ReturnType<typeof useGameSession>;
