type FocusTarget = Element & { focus: (options?: FocusOptions) => void };
type Dialog = { root: HTMLElement; panel: HTMLElement; close: () => (() => void) | undefined; opener: FocusTarget | null };
const dialogs: Dialog[] = [];
const listeners = new Set<() => void>();
const background = new Map<Element, { inert: string | null; hidden: string | null }>();
let observer: MutationObserver | undefined;
let overflow: { element: HTMLElement; value: string; priority: string }[] = [];

export const hasOpenDialogs = () => dialogs.length > 0;
export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A locked top dialog consumes Back too: it must never navigate underneath. */
export function closeTopDialog(): boolean {
  const top = dialogs.at(-1);
  if (!top) return false;
  top.close()?.();
  return true;
}

function canFocus(element: Element | null): element is FocusTarget {
  return element !== null && 'focus' in element && typeof element.focus === 'function';
}
function visible(element: Element): boolean {
  if (element.closest('[hidden], [inert]') || element.matches(':disabled')) return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  const details = element.closest('details:not([open])');
  return !details || Boolean(details.querySelector('summary')?.contains(element));
}
function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"]'))
    .filter(element => element.tabIndex >= 0 && visible(element))
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
}
function focusInside(top: Dialog) {
  top.panel.focus({ preventScroll: true });
}
function keydown(event: KeyboardEvent) {
  const top = dialogs.at(-1);
  if (!top || event.defaultPrevented) return;
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); closeTopDialog();
  } else if (event.key === 'Tab') {
    const elements = focusable(top.panel);
    const first = elements[0]; const last = elements.at(-1);
    const active = document.activeElement;
    if (!first) { event.preventDefault(); focusInside(top); }
    else if (!top.panel.contains(active) || active === top.panel || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
    }
  }
}
function focusin(event: FocusEvent) {
  const top = dialogs.at(-1);
  if (top && !top.panel.contains(event.target as Node)) focusInside(top);
}
function restore(element: Element, state: { inert: string | null; hidden: string | null }) {
  if (state.inert === null) element.removeAttribute('inert'); else element.setAttribute('inert', state.inert);
  if (state.hidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', state.hidden);
}
function syncBackground() {
  const top = dialogs.at(-1);
  for (const element of Array.from(document.body.children)) {
    if (element === top?.root) {
      const state = background.get(element);
      if (state) { restore(element, state); background.delete(element); }
    } else if (top) {
      if (!background.has(element)) background.set(element, { inert: element.getAttribute('inert'), hidden: element.getAttribute('aria-hidden') });
      element.setAttribute('inert', ''); element.setAttribute('aria-hidden', 'true');
    }
  }
  if (!top) {
    for (const [element, state] of background) restore(element, state);
    background.clear();
  }
}

/** Portals live outside the application root, which becomes inert. The
 * shared stack owns focus/Escape so nested dialogs never close together. */
export function registerDialog(root: HTMLElement, panel: HTMLElement, close: Dialog['close']): () => void {
  const active = document.activeElement;
  const dialog: Dialog = { root, panel, close, opener: canFocus(active) ? active : null };
  if (!dialogs.length) {
    overflow = [document.documentElement, document.body].map(element => ({ element,
      value: element.style.getPropertyValue('overflow'), priority: element.style.getPropertyPriority('overflow') }));
    overflow.forEach(({ element }) => element.style.setProperty('overflow', 'hidden'));
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    observer = new MutationObserver(syncBackground);
    observer.observe(document.body, { childList: true });
  }
  dialogs.push(dialog);
  // Move focus out of the application before hiding it from assistive tech.
  panel.scrollTop = 0; focusInside(dialog); syncBackground();
  listeners.forEach(listener => listener());
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const wasTop = dialogs.at(-1) === dialog;
    dialogs.splice(dialogs.indexOf(dialog), 1);
    if (!dialogs.length) {
      observer?.disconnect(); observer = undefined;
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
      overflow.forEach(({ element, value, priority }) => {
        if (value) element.style.setProperty('overflow', value, priority); else element.style.removeProperty('overflow');
      });
      overflow = [];
    }
    syncBackground();
    if (wasTop) {
      const top = dialogs.at(-1);
      if (dialog.opener?.isConnected && visible(dialog.opener) && (!top || top.panel.contains(dialog.opener))) {
        dialog.opener.focus({ preventScroll: true });
      } else if (top) focusInside(top);
      else focusable(document.body)[0]?.focus({ preventScroll: true });
    }
    listeners.forEach(listener => listener());
  };
}
