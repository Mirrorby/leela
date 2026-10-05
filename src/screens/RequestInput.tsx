import { ScreenHeading } from '../components/ScreenHeading';
import { tr } from '../i18n/language';
import limits from '../data/limits.json';
import { useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';

export function RequestInput({ session, nav }: ScreenProps) {
  const [value, setValue] = useState(session.request);
  const canContinue = value.trim().length > 0 && value.length <= limits.requestCharacters;

  return (
    <div className="screen screen-centered">
      <ScreenHeading>{tr("Твой запрос")}</ScreenHeading>
      <p>{tr("С чем ты хочешь поработать в этой партии?")}</p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={limits.requestCharacters}
        aria-describedby="request-length"
        rows={4}
        placeholder={tr("Например: хочу понять, что мешает мне двигаться дальше...")}
      />
      <p id="request-length" className="muted">{tr("{0} / {1} символов", value.length, limits.requestCharacters)}</p>
      <button
        className="primary"
        disabled={!canContinue}
        onClick={() => {
          session.setRequest(value.trim());
          nav.push('DiceModeSelect');
        }}
      >{tr("Далее")} </button>
    </div>
  );
}
