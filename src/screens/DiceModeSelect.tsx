import { useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import type { DiceMode } from '../types/game';

export function DiceModeSelect({ session, nav }: ScreenProps) {
  // Локальный pending, а не session.isBusy: session.isBusy предполагается
  // общим индикатором занятости сессии (пригодится и для роллов на
  // GameHome), а здесь важно именно "какую из двух кнопок нажали", чтобы
  // задизейблить обе на время запроса, а не гадать по общему флагу.
  const [pending, setPending] = useState<DiceMode | null>(null);

  const choose = async (mode: DiceMode) => {
    if (pending) return;
    setPending(mode);
    session.setDiceMode(mode);
    try {
      // startGame теперь сетевой запрос (POST /api/v1/games, этап 7.5) —
      // партию считает и сохраняет Worker. При ошибке (нет сети, не внутри
      // Telegram и т.п.) session.error уже выставлен внутри useGameSession —
      // просто не переходим на GameHome и остаёмся на этом экране.
      await session.startGame({ diceMode: mode });
      nav.resetTo('GameHome');
    } catch {
      // Ошибка уже отражена в session.error и покажется ниже.
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="screen screen-centered">
      <h1>Кубик</h1>
      <p>Как будем бросать кубик в этой партии?</p>
      <button className="primary" onClick={() => choose('virtual')} disabled={pending !== null}>
        Виртуальный — приложение бросает само
      </button>
      <button onClick={() => choose('physical')} disabled={pending !== null}>
        Физический — я введу результат сам
      </button>
      {session.error && <p className="screen-error">{session.error}</p>}
    </div>
  );
}
