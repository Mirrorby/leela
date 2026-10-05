import { ScreenHeading } from '../components/ScreenHeading';
import { tr } from '../i18n/language';
import { useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';

export function RequestInput({ session, nav }: ScreenProps) {
  const [value, setValue] = useState(session.request);
  const canContinue = value.trim().length > 0;

  return (
    <div className="screen screen-centered">
      <ScreenHeading>{tr("Твой запрос")}</ScreenHeading>
      <p>{tr("С чем ты хочешь поработать в этой партии?")}</p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        placeholder={tr("Например: хочу понять, что мешает мне двигаться дальше...")}
      />
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
