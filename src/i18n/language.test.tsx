import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getLanguage, resolveLanguage, setLanguagePreference, tr } from './language';
import * as telegram from '../telegram/telegramAdapter';
import { getContentPack, getRuleset } from '../game/ruleset';
import { Splash } from '../screens/Splash';
import { HowToPlay } from '../screens/HowToPlay';
import { GameHome } from '../screens/GameHome';
import { History } from '../screens/History';
import { RequestInput } from '../screens/RequestInput';
import { CellContent } from '../components/CellContent';
import { productTitle } from '../components/ProductPurchase';
import type { ScreenProps } from '../navigation/ScreenProps';
import { makeGame } from '../testUtils/fixtures';

afterEach(() => { setLanguagePreference('auto'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('automatic game language', () => {
  it.each(['ru', 'en'] as const)('renders the intention limit and prevents submitting oversized legacy text (%s)', language => {
    setLanguagePreference(language);
    const render = (request: string) => renderToStaticMarkup(<RequestInput {...{
      session: { request, setRequest: vi.fn() }, nav: { push: vi.fn() },
    } as unknown as ScreenProps} />);
    expect(render('test')).toContain('maxLength="2000"');
    expect(render('test')).toContain(language === 'en' ? '4 / 2000 characters' : '4 / 2000 символов');
    expect(render('test')).not.toContain('disabled=""');
    expect(render('x'.repeat(2001))).toContain('disabled=""');
  });
  it.each([
    ['ru', 'en-US', 'ru'], ['ru-RU', 'en', 'ru'], ['en', 'ru-RU', 'en'],
    ['de', 'ru', 'en'], [undefined, 'ru-BY', 'ru'], [undefined, 'fr', 'en'],
    ['', 'ru', 'ru'], [undefined, undefined, 'en'],
  ])('Telegram %s, browser %s resolves to %s', (t, b, expected) => {
    expect(resolveLanguage(t, b)).toBe(expected);
  });
  it('uses Telegram first, supports an override and returns to automatic detection', () => {
    vi.spyOn(telegram, 'getDisplayUser').mockReturnValue({ id: 1, first_name: 'Test', language_code: 'ru' });
    vi.stubGlobal('navigator', { language: 'en-US' });
    expect(getLanguage()).toBe('ru');
    setLanguagePreference('en'); expect(getLanguage()).toBe('en');
    expect(tr('С возвращением, {0}!', 'Alex')).toBe('Welcome back, Alex!');
    setLanguagePreference('auto'); expect(getLanguage()).toBe('ru');
  });
  it('uses browser language outside Telegram', () => {
    vi.spyOn(telegram, 'getDisplayUser').mockReturnValue(null);
    vi.stubGlobal('navigator', { language: 'ru-BY' }); expect(getLanguage()).toBe('ru');
    vi.stubGlobal('navigator', { language: 'es-ES' }); expect(getLanguage()).toBe('en');
  });
  it('retains language selection when local storage is unavailable', () => {
    vi.stubGlobal('window', { localStorage: { setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } } });
    setLanguagePreference('en'); expect(getLanguage()).toBe('en');
  });
  it('includes complete English content with unchanged cell IDs and Sanskrit', () => {
    const ru = getContentPack('classic-v1', 'ru'), en = getContentPack('classic-v1', 'en');
    expect(en.cells).toHaveLength(72);
    en.cells.forEach((cell, i) => {
      expect(cell.id).toBe(ru.cells[i].id);
      expect(cell.sanskrit).toBe(ru.cells[i].sanskrit);
      expect(cell.name.length).toBeGreaterThan(2);
      expect(cell.shortDescription.length).toBeGreaterThan(40);
      expect(cell.fullDescription.length).toBeGreaterThan(250);
      expect(cell.reflectionQuestions).toHaveLength(1);
      expect(cell.reflectionQuestions[0].endsWith('?')).toBe(true);
      expect(JSON.stringify(cell)).not.toMatch(/[а-яё]/i);
    });
  });
  it('switches tutorial, board, history and cell text without modifying an unfinished game', () => {
    const game = makeGame({ request: 'My original intention', currentCell: 4, isBorn: true, status: 'IN_PROGRESS' });
    const before = JSON.stringify(game);
    const props = { session: { game, ruleset: getRuleset('classic-v1'), lastEvents: [], lastRollValue: null, lastMove: null,
      cellById: (id: number) => getContentPack('classic-v1', getLanguage()).cells.find(c => c.id === id) },
      nav: { push: vi.fn(), pop: vi.fn(), resetTo: vi.fn(), replace: vi.fn() } } as unknown as ScreenProps;
    for (const language of ['ru', 'en'] as const) {
      setLanguagePreference(language);
      const tutorial = renderToStaticMarkup(<HowToPlay {...props} />);
      expect(tutorial).toContain(language === 'en' ? 'What is Leela?' : 'Что такое Лила');
      const board = renderToStaticMarkup(<GameHome {...props} />);
      expect(board).toContain(language === 'en' ? 'Roll the die' : 'Бросить кубик');
      if (language === 'en') expect(board).not.toMatch(/[а-яё]/i);
      const cell = renderToStaticMarkup(<CellContent cellId={4} cell={props.session.cellById(4)} />);
      expect(cell).toContain(language === 'en' ? 'Greed' : 'Жадность');
      expect(renderToStaticMarkup(<History {...props} />)).toContain(language === 'en' ? 'Move history' : 'История ходов');
      expect(renderToStaticMarkup(<Splash {...props} />)).toContain(language === 'en' ? 'New game' : 'Новая партия');
    }
    expect(JSON.stringify(game)).toBe(before);
  });
  it('localises product titles while retaining checkout data', () => {
    setLanguagePreference('en');
    const product = { id: 'game_1', title: '1 партия', tribute: { url: 'https://web.tribute.tg/p/FWC', amount: 159, currency: 'USD' }, grant: { games: 1, aiReviews: 0, subscriptionDays: 0 }, isSubscription: false } as const;
    expect(productTitle(product)).toBe('1 game');
    expect(product.tribute.amount).toBe(159);
  });
});
