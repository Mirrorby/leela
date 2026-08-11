import { getRuleset, getContentPack } from './game/ruleset';
import { createNewGame } from './game/gameEngine';
import './App.css';

// Временный экран-заглушка этапа 1: подтверждает, что ruleset и контент
// корректно грузятся и Game Engine можно вызвать. Реальные 14 экранов
// появятся на этапе 3.
function App() {
  const ruleset = getRuleset('classic-v1');
  const content = getContentPack('classic-v1', 'ru');
  const demoGame = createNewGame({
    id: 'demo',
    ruleset,
    request: 'Тестовый запрос',
    diceMode: 'virtual',
  });

  return (
    <div className="app-shell">
      <h1>Лила — каркас проекта (этап 1)</h1>
      <ul>
        <li>Ruleset: {ruleset.rulesetId} v{ruleset.version}</li>
        <li>Клеток в поле: {ruleset.board.size}</li>
        <li>Клеток контента загружено: {content.cells.length}</li>
        <li>Демо-партия создана: {demoGame.id}, статус {demoGame.status}</li>
      </ul>
      <p>
        Дальше: этап 2 — полная реализация Game Engine и unit-тестов.
      </p>
    </div>
  );
}

export default App;
