import type { ScreenProps } from '../navigation/ScreenProps';

export function Splash({ session, nav }: ScreenProps) {
  return (
    <div className="screen screen-splash">
      <h1>Лила</h1>
      <p className="muted">
        Ruleset: {session.ruleset.rulesetId} v{session.ruleset.version} · клеток на поле:{' '}
        {session.ruleset.board.size} · контент загружен: {session.content.cells.length} клеток
      </p>
      <button onClick={() => nav.push('Intro')}>Далее</button>
    </div>
  );
}
