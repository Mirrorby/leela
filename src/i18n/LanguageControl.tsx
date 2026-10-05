import { useEffect, useRef, useState } from 'react';
import { setLanguagePreference, tr, useLanguage, type Language } from './language';

export function LanguageControl() {
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const select = (next: Language) => { setLanguagePreference(next); close(); };
  return <div className="language-control" ref={root}>
    <button ref={trigger} className="language-trigger" type="button" aria-label={tr('Выбрать язык')}
      aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
      <span aria-hidden="true">{language === 'ru' ? '🇷🇺' : '🇬🇧'}</span>
    </button>
    {open && <div ref={menu} className="language-menu" role="menu" aria-label={tr('Выбрать язык')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === 'Tab') setOpen(false);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
      }}>
      <button type="button" role="menuitemradio" aria-checked={language === 'en'} onClick={() => select('en')}>{tr('Английский')}</button>
      <button type="button" role="menuitemradio" aria-checked={language === 'ru'} onClick={() => select('ru')}>{tr('Русский')}</button>
    </div>}
  </div>;
}
