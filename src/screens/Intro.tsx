import type { ScreenProps } from '../navigation/ScreenProps';

export function Intro({ nav }: ScreenProps) {
  return (
    <div className="screen screen-intro">
      <h1>Лила — игра-трансформация</h1>
      <p>
        Лила — древняя игра духовного развития. Ты формулируешь запрос, а движение фишки по полю
        через броски кубика становится зеркалом твоего пути.
      </p>
      <button onClick={() => nav.push('RequestInput')}>Начать</button>
    </div>
  );
}
