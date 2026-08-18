import { useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';

export function RequestInput({ session, nav }: ScreenProps) {
  const [value, setValue] = useState(session.request);
  const canContinue = value.trim().length > 0;

  return (
    <div className="screen screen-centered">
      <h1>Твой запрос</h1>
      <p>С чем ты хочешь поработать в этой партии?</p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        placeholder="Например: хочу понять, что мешает мне двигаться дальше..."
      />
      <button
        className="primary"
        disabled={!canContinue}
        onClick={() => {
          session.setRequest(value.trim());
          nav.push('DiceModeSelect');
        }}
      >
        Далее
      </button>
    </div>
  );
}
