import { describe, it, expect } from 'vitest';
import { resolveGameScreen, normalizeScreenName, gameResumeScreen } from './resolveGameScreen';
import { makeGame } from '../testUtils/fixtures';
import type { ScreenName } from '../navigation/types';

describe('resolveGameScreen', () => {
  it.each(['WAITING_FOR_BIRTH', 'IN_PROGRESS'] as const)('stores %s independently of menus and pre-game screens', status => {
    const game = makeGame({ status });
    for (const screen of ['RequestInput', 'DiceModeSelect', 'Intro', 'Paywall', 'MyGames', 'Splash', 'YourAccess', 'HowToPlay', 'Summary'] as ScreenName[]) {
      expect(resolveGameScreen(screen, game)).toBe('GameHome');
    }
  });
  it.each(['FINISHED', 'ARCHIVED'] as const)('uses Summary for %s even with a stale unfinished screen', status => {
    const game = makeGame({ status });
    expect(resolveGameScreen('RequestInput', game)).toBe('Summary');
    expect(resolveGameScreen('MyGames', game)).toBe('Summary');
    expect(gameResumeScreen(game)).toBe('Summary');
  });
  it('does not change navigation before a game exists', () => {
    expect(resolveGameScreen('RequestInput', null)).toBe('RequestInput');
    expect(resolveGameScreen('DiceModeSelect', null)).toBe('DiceModeSelect');
    expect(resolveGameScreen('Intro', null)).toBe('Intro');
  });
  it('permits browsing History but resumes unfinished games at the board', () => {
    const game = makeGame();
    expect(resolveGameScreen('History', game)).toBe('History');
    expect(gameResumeScreen(game)).toBe('GameHome');
  });
});

describe('normalizeScreenName', () => {
  it('keeps valid navigation names', () => {
    expect(normalizeScreenName('GameHome')).toBe('GameHome');
    expect(normalizeScreenName('MyGames')).toBe('MyGames');
    expect(normalizeScreenName('HowToPlay')).toBe('HowToPlay');
  });
  it('maps retired FinishScreen to Summary', () => {
    expect(normalizeScreenName('FinishScreen')).toBe('Summary');
  });
  it('maps removed or unknown names to GameHome', () => {
    expect(normalizeScreenName('DiceRoll')).toBe('GameHome');
    expect(normalizeScreenName('TurnResult')).toBe('GameHome');
    expect(normalizeScreenName('totally-unknown')).toBe('GameHome');
  });
  it('does not let a stale FinishScreen prevent continuation of an unborn game', () => {
    expect(resolveGameScreen(normalizeScreenName('FinishScreen'), makeGame())).toBe('GameHome');
  });
});
