import { useSyncExternalStore } from 'react';
import { getDisplayUser } from '../telegram/telegramAdapter';
import english from './en.json';

export type Language = 'ru' | 'en';
export type LanguagePreference = 'auto' | Language;
const STORAGE_KEY = 'leela:language';
const listeners = new Set<() => void>();
let preference: LanguagePreference = 'auto';
try {
  const saved = typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'ru' || saved === 'en') preference = saved;
} catch { /* Language selection still works when storage is unavailable. */ }

export function resolveLanguage(telegramLanguage?: string, browserLanguage?: string): Language {
  const code = (telegramLanguage?.trim() || browserLanguage?.trim() || 'en').toLowerCase();
  return /^ru(?:[-_]|$)/.test(code) ? 'ru' : 'en';
}
export function getLanguage(): Language {
  if (preference !== 'auto') return preference;
  const browserLanguage = typeof navigator === 'undefined' ? undefined : navigator.language;
  return resolveLanguage(getDisplayUser()?.language_code, browserLanguage);
}
export function getLanguagePreference(): LanguagePreference { return preference; }
export function setLanguagePreference(next: LanguagePreference): void {
  preference = next;
  try {
    if (next === 'auto') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  } catch { /* Optional preference persistence must not block the game. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = getLanguage();
  for (const notify of listeners) notify();
}
function subscribe(notify: () => void) {
  listeners.add(notify);
  if (typeof window !== 'undefined') window.addEventListener('languagechange', notify);
  return () => {
    listeners.delete(notify);
    if (typeof window !== 'undefined') window.removeEventListener('languagechange', notify);
  };
}
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}
export function useLanguagePreference(): LanguagePreference {
  return useSyncExternalStore(subscribe, getLanguagePreference, getLanguagePreference);
}
export function locale(): string { return getLanguage() === 'ru' ? 'ru-RU' : 'en-US'; }
export function tr(key: string, ...values: (string | number)[]): string {
  const template = getLanguage() === 'en' ? (english as Record<string, string>)[key] ?? key : key;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => String(values[Number(index)] ?? match));
}
