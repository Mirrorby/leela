import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Summary } from './Summary';
import { setLanguagePreference } from '../i18n/language';
import type { ScreenProps } from '../navigation/ScreenProps';
import { makeGame } from '../testUtils/fixtures';
vi.mock('../state/useAiReview', () => ({ useAiReview:() => ({state:'none',kind:'short',start:vi.fn()}) }));
vi.mock('../state/usePayments', () => ({ usePayments:() => ({products:[],entitlements:{freeAiReviewsRemaining:1,paidAiReviews:1},refresh:vi.fn()}) }));
afterEach(() => setLanguagePreference('auto'));
it.each(['ru','en'] as const)('explains data transfer before either review action (%s)', language => {
  setLanguagePreference(language);
  const html = renderToStaticMarkup(<Summary {...{ session:{game:makeGame({status:'FINISHED'}),cellById:vi.fn()},nav:{} } as unknown as ScreenProps} />);
  const notice = html.indexOf('Google Gemini');
  expect(notice).toBeGreaterThan(0);
  expect(notice).toBeLessThan(html.indexOf(language === 'ru' ? 'Получить краткий' : 'Get a free short'));
  expect(html).toContain(language === 'ru' ? 'Играть можно без ИИ-разбора.' : 'You can play without an AI review.');
  if (language === 'en') expect(html).not.toMatch(/[А-Яа-яЁё]/);
});
