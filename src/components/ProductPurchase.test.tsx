import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductPurchaseButton, TributePaymentNotice } from './ProductPurchase';
import { setLanguagePreference } from '../i18n/language';
import * as api from '../api/workerClient';
import * as telegram from '../telegram/telegramAdapter';
import type { Product } from '../types/payments';
import type { MouseEvent } from 'react';

const product = { id: 'game_1', tribute: { url: 'https://web.tribute.tg/p/FWC', amount: 159, currency: 'USD' } } as Product;
afterEach(() => { setLanguagePreference('auto'); vi.restoreAllMocks(); });

describe('payment help and checkout', () => {
  it.each(['ru', 'en'] as const)('renders support links in %s', language => {
    setLanguagePreference(language);
    const html = renderToStaticMarkup(<TributePaymentNotice loading={false} onRefresh={() => {}} />);
    expect(html).toContain(language === 'ru' ? 'Нужна помощь с оплатой?' : 'Need help with payment?');
    expect(html).toContain('href="https://t.me/Mirrorby"');
    expect(html).toContain('href="https://t.me/TributeSupportBot"');
  });

  it('opens checkout synchronously and a rejected analytics request does not fail the click', async () => {
    const openLink = vi.fn();
    vi.spyOn(telegram, 'getWebApp').mockReturnValue({ openLink } as unknown as ReturnType<typeof telegram.getWebApp>);
    const track = vi.spyOn(api, 'logTributeCheckoutClick').mockImplementation(async () => {
      expect(openLink).toHaveBeenCalledWith(product.tribute!.url);
      throw new Error('analytics unavailable');
    });
    const event = { preventDefault: vi.fn() } as unknown as MouseEvent<HTMLAnchorElement>;
    const button = ProductPurchaseButton({ product });
    expect(() => button.props.onClick(event)).not.toThrow();
    await Promise.resolve();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledWith('game_1', expect.any(String));
  });

  it('a disabled purchase prevents navigation and does not send telemetry', () => {
    const openLink = vi.fn();
    vi.spyOn(telegram, 'getWebApp').mockReturnValue({ openLink } as unknown as ReturnType<typeof telegram.getWebApp>);
    const track = vi.spyOn(api, 'logTributeCheckoutClick');
    const event = { preventDefault: vi.fn() } as unknown as MouseEvent<HTMLAnchorElement>;
    ProductPurchaseButton({ product, disabled: true }).props.onClick(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(openLink).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});
