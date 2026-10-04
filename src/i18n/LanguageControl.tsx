import { setLanguagePreference, useLanguage, useLanguagePreference, type LanguagePreference } from './language';

export function LanguageControl() {
  const language = useLanguage();
  const preference = useLanguagePreference();
  return <label className="language-control">
    <span>{language === 'ru' ? 'Язык' : 'Language'}</span>
    <select value={preference} onChange={(event) => setLanguagePreference(event.target.value as LanguagePreference)}>
      <option value="auto">{language === 'ru' ? 'Автоматически' : 'Automatic'}</option>
      <option value="ru">Русский</option>
      <option value="en">English</option>
    </select>
  </label>;
}
