// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setStorageOwner, hideGameId } from '../storage/localStorage';
import { MyGames } from './MyGames';
import { setLanguagePreference } from '../i18n/language';
import { makeGame } from '../testUtils/fixtures';
import type { ScreenProps } from '../navigation/ScreenProps';
import { loadHistoryPage } from '../state/historyRecovery';
import { deleteGameAndCache } from '../state/deleteGame';
vi.mock('../state/historyRecovery', () => ({ loadHistoryPage: vi.fn() }));
vi.mock('../state/deleteGame', () => ({ deleteGameAndCache: vi.fn() }));
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.localStorage.clear(); setStorageOwner('111');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  vi.mocked(loadHistoryPage).mockResolvedValue({ entries: [{ id:'g1', game:makeGame(), localRecord:null }], nextCursor:null, offline:false });
});
afterEach(() => { act(() => root.unmount()); setStorageOwner(null); vi.clearAllMocks(); vi.unstubAllGlobals(); setLanguagePreference('auto'); });
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;

it.each(['ru','en'] as const)('requires confirmation, preserves the row on failure and allows retry (%s)', async language => {
  setLanguagePreference(language);
  const session = { reset:vi.fn(), cancelPending:vi.fn(), isBusy:false, getSnapshot:() => ({game:null}) };
  const props = { session, nav:{pop:vi.fn(),resetTo:vi.fn(),push:vi.fn()} } as unknown as ScreenProps;
  await act(async () => root.render(<MyGames {...props} />));
  act(() => button(language === 'ru' ? 'Удалить' : 'Delete').click());
  expect(deleteGameAndCache).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(language === 'ru' ? 'Восстановить их нельзя' : 'cannot be restored');
  vi.mocked(deleteGameAndCache).mockRejectedValueOnce(Error('offline'));
  await act(async () => button(language === 'ru' ? 'Удалить партию' : 'Delete game').click());
  expect(document.querySelector('.game-list-item')).not.toBeNull();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  vi.mocked(deleteGameAndCache).mockResolvedValueOnce();
  await act(async () => button(language === 'ru' ? 'Удалить партию' : 'Delete game').click());
  expect(document.querySelector('.game-list-item')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(deleteGameAndCache).toHaveBeenCalledTimes(2);
});

it('offers a way to reveal previously hidden games for real deletion', async () => {
  setLanguagePreference('en'); hideGameId('g1');
  const props = {session:{reset:vi.fn(),cancelPending:vi.fn(),isBusy:false},nav:{}} as unknown as ScreenProps;
  await act(async () => root.render(<MyGames {...props} />));
  await act(async () => button('Show previously hidden games').click());
  expect(loadHistoryPage).toHaveBeenLastCalledWith({limit:20,includeHidden:true}, expect.any(Function));
  expect(document.body.textContent).toContain('delete them from the server');
});
