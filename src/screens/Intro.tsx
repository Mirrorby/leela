import type { ScreenProps } from '../navigation/ScreenProps';
import { hasSeenOnboarding } from '../state/persistence';

/**
 * Splash пушит сюда на каждую "Новую партию", а не только на первую в жизни
 * пользователя — поэтому решение "показывать ли обучающий онбординг
 * (HowToPlay)" принимается здесь, а не в Splash: при первом визите кнопка
 * "Начать" ведёт в HowToPlay (и дальше сам HowToPlay уводит в RequestInput),
 * при повторных — сразу в RequestInput, онбординг больше не навязывается.
 * "Как играть" ниже даёт открыть тот же HowToPlay вручную в любой момент.
 */
export function Intro({ nav }: ScreenProps) {
  const startGame = () => {
    if (hasSeenOnboarding()) {
      nav.push('RequestInput');
    } else {
      nav.push('HowToPlay');
    }
  };

  return (
    <div className="screen screen-centered">
      <h1>Лила — игра-трансформация</h1>
      <p>
        Лила — древняя игра духовного развития. Ты формулируешь запрос, а движение фишки по полю
        через броски кубика становится зеркалом твоего пути.
      </p>
      <p className="muted">Первая партия и один краткий ИИ-разбор — бесплатно. Следующие партии и полный разбор можно купить отдельно.</p>
      <button className="primary" onClick={startGame}>
        Начать
      </button>
      <button onClick={() => nav.push('HowToPlay', { mode: 'replay' })}>Как играть</button>
    </div>
  );
}
