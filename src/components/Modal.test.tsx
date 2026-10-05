// @vitest-environment jsdom
import { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';
import { closeTopDialog, hasOpenDialogs } from '../navigation/dialogStack';
import { useTelegramBackButton } from '../telegram/useTelegramBackButton';
import type { TelegramWebApp } from '../telegram/telegramAdapter';
import { setLanguagePreference } from '../i18n/language';
import { LanguageControl } from '../i18n/LanguageControl';

let root: Root;
const byId = (id: string) => document.getElementById(id)!;
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
function click(id: string) { act(() => byId(id).dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
function key(key: string, shiftKey = false, target: Element = document.activeElement!) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(event));
  return event;
}
function Harness({ nav = () => {}, depth = false }: { nav?: () => void; depth?: boolean }) {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  useTelegramBackButton(depth, nav);
  return <>
    <button id="opener" onClick={() => setOpen(true)}>Open</button><button id="background">Background</button>
    <Modal open={open} onClose={() => setOpen(false)} title="Cell details">
      <button id="first" onClick={() => setNested(true)}>Details</button>
      <button id="last">Continue</button>
      <button disabled id="disabled">Disabled</button><button style={{ display: 'none' }}>Hidden</button>
      <Modal open={nested} onClose={() => setNested(false)} ariaLabel="Nested detail"><button id="nested">Nested</button></Modal>
    </Modal>
  </>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setLanguagePreference('en');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(byId('root'));
});
afterEach(() => {
  act(() => root.unmount());
  expect(hasOpenDialogs()).toBe(false);
  delete window.Telegram;
  document.body.style.cssText = ''; document.documentElement.style.cssText = '';
  vi.restoreAllMocks(); vi.unstubAllGlobals(); setLanguagePreference('auto');
});
function open() { act(() => root.render(<Harness />)); byId('opener').focus(); click('opener'); }

describe('dialog focus and isolation', () => {
  it('focuses the named dialog outside the app root and restores its opener on Escape', () => {
    open();
    expect(document.activeElement).toBe(panel());
    expect(document.getElementById(panel().getAttribute('aria-labelledby')!)?.textContent).toBe('Cell details');
    expect(byId('root').contains(panel())).toBe(false);
    expect(byId('root').hasAttribute('inert')).toBe(true);
    expect(byId('root').getAttribute('aria-hidden')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(byId('opener'));
    expect(byId('root').hasAttribute('inert')).toBe(false);
    expect(byId('root').hasAttribute('aria-hidden')).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('wraps Tab in both directions and prevents programmatic focus escaping to the background', () => {
    open(); key('Tab');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
    byId('last').focus(); key('Tab');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
    key('Tab', true); expect(document.activeElement).toBe(byId('last'));
    byId('background').focus(); expect(document.activeElement).toBe(panel());
  });

  it('keeps a locked dialog focused and consumes Back/Escape without navigation', () => {
    act(() => root.render(<Modal open ariaLabel="Read only"><p>No actions</p></Modal>));
    expect(panel().getAttribute('aria-label')).toBe('Read only');
    expect(key('Tab').defaultPrevented).toBe(true); expect(document.activeElement).toBe(panel());
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(closeTopDialog()).toBe(true); expect(hasOpenDialogs()).toBe(true);
  });

  it('closes only the top nested dialog and restores focus to the parent before the original opener', () => {
    open(); byId('first').focus(); click('first');
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs).toHaveLength(2);
    expect(document.activeElement).toBe(dialogs[1]);
    expect(dialogs[0].parentElement?.hasAttribute('inert')).toBe(true);
    key('Escape'); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(byId('first')); expect(byId('root').hasAttribute('inert')).toBe(true);
    key('Escape'); expect(document.activeElement).toBe(byId('opener'));
  });

  it('restores existing inert/aria-hidden and overflow values after unmount, including StrictMode cleanup', () => {
    document.body.style.setProperty('overflow', 'auto', 'important');
    document.documentElement.style.overflow = 'scroll';
    const aside = document.createElement('aside'); aside.setAttribute('inert', ''); aside.setAttribute('aria-hidden', 'false'); document.body.append(aside);
    act(() => root.render(<StrictMode><Modal open title="Strict"><button>Close</button></Modal></StrictMode>));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    act(() => root.render(null));
    expect(document.body.style.getPropertyValue('overflow')).toBe('auto');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
    expect(document.documentElement.style.overflow).toBe('scroll');
    expect(aside.hasAttribute('inert')).toBe(true); expect(aside.getAttribute('aria-hidden')).toBe('false');
    expect(byId('root').hasAttribute('inert')).toBe(false);
  });

  it('does not reset focus on a rerender and uses the latest close callback', () => {
    const first = vi.fn(); const latest = vi.fn();
    act(() => root.render(<Modal open onClose={first}><button id="content">Continue</button></Modal>));
    byId('content').focus();
    act(() => root.render(<Modal open onClose={latest}><button id="content">Updated</button></Modal>));
    expect(document.activeElement).toBe(byId('content'));
    key('Escape'); expect(latest).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled();
  });

  it('restores focus to an SVG board cell after closing', () => {
    function BoardOpener() {
      const [open, setOpen] = useState(false);
      return <><svg><g id="cell" role="button" tabIndex={0} onClick={() => setOpen(true)}><rect /></g></svg>
        <Modal open={open} onClose={() => setOpen(false)} ariaLabel="Cell 4"><p>Cell content</p></Modal></>;
    }
    act(() => root.render(<BoardOpener />));
    document.querySelector<SVGElement>('#cell')!.focus(); click('cell'); key('Escape');
    expect(document.activeElement).toBe(byId('cell'));
  });

  it('lets an inner menu consume Escape without closing its containing dialog', () => {
    const close = vi.fn();
    act(() => root.render(<Modal open onClose={close}><LanguageControl /></Modal>));
    act(() => document.querySelector<HTMLButtonElement>('.language-trigger')!.click());
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    key('Escape');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(close).not.toHaveBeenCalled(); expect(hasOpenDialogs()).toBe(true);
  });

  it('closes on the backdrop, but a click within the panel does not dismiss it', () => {
    open(); click('last'); expect(hasOpenDialogs()).toBe(true);
    act(() => document.querySelector<HTMLElement>('.modal-backdrop')!.click());
    expect(hasOpenDialogs()).toBe(false); expect(document.activeElement).toBe(byId('opener'));
  });
});

describe('Telegram Back priority', () => {
  function sdk() {
    const callbacks = new Set<() => void>();
    const button = { isVisible: false, show: vi.fn(() => { button.isVisible = true; }), hide: vi.fn(() => { button.isVisible = false; }),
      onClick: vi.fn((cb: () => void) => callbacks.add(cb)), offClick: vi.fn((cb: () => void) => callbacks.delete(cb)) };
    window.Telegram = { WebApp: { BackButton: button } as unknown as TelegramWebApp };
    return { button, callbacks, back: () => act(() => { [...callbacks].forEach(cb => cb()); }) };
  }

  it('closes a dialog before popping navigation and cleans up SDK handlers on unmount', () => {
    const api = sdk(); const nav = vi.fn();
    act(() => root.render(<StrictMode><Harness nav={nav} depth /></StrictMode>));
    byId('opener').focus(); click('opener'); api.back();
    expect(hasOpenDialogs()).toBe(false); expect(nav).not.toHaveBeenCalled(); expect(api.button.isVisible).toBe(true);
    api.back(); expect(nav).toHaveBeenCalledOnce(); expect(api.callbacks.size).toBe(1);
    act(() => root.render(null)); expect(api.callbacks.size).toBe(0); expect(api.button.isVisible).toBe(false);
  });

  it('shows Back for a dialog on the root screen and hides it after closure', () => {
    const api = sdk(); const nav = vi.fn();
    act(() => root.render(<Harness nav={nav} />)); expect(api.button.isVisible).toBe(false);
    byId('opener').focus(); click('opener'); expect(api.button.isVisible).toBe(true);
    api.back(); expect(nav).not.toHaveBeenCalled(); expect(api.button.isVisible).toBe(false);
  });
});
