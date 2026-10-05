import { ScreenHeading } from '../components/ScreenHeading';
import { tr } from '../i18n/language';

import { useState } from 'react';
import type { ScreenProps } from '../navigation/ScreenProps';
import { markOnboardingSeen } from '../state/persistence';

interface Slide {
  emoji: string;
  title: string;
  body: string;
}

// Тексты сознательно избегают терминов ruleset (transitionRule, birth и
// т.п.) и игровых чисел там, где они не нужны для понимания правил "с
// нуля" — точные цифры (72 клетки, до 3 шестёрок подряд) даются только там,
// где реально помогают игроку, а не как пересказ JSON.
const SLIDES: Slide[] = [
  {
    emoji: '🕉️',
    title: "Что такое Лила",
    body: "Лила — древняя индийская игра-практика самопознания. Перед партией ты формулируешь свой вопрос или намерение, а дальше движение фишки по полю становится зеркалом: где ты застреваешь, что помогает двигаться дальше.",
  },
  {
    emoji: '🎲',
    title: "Кубик и рождение",
    body: "Игра начинается с ожидания: фишка выходит на поле, только когда выпадет 6 — это \"рождение\". Дальше каждая шестёрка даёт право бросить ещё раз, поэтому за один ход иногда случается несколько бросков подряд.",
  },
  {
    emoji: '🧭',
    title: "Поле из 72 клеток",
    body: "Поле — это путь из 72 клеток, свёрнутый змейкой. Фишка идёт вперёд ровно на выпавшее число. Побеждать некого — партия одна, и цель не \"обыграть\" поле, а дойти по нему до конца.",
  },
  {
    emoji: '🐍',
    title: "Змеи и стрелы",
    body: "На некоторых клетках прячутся змеи и стрелы. Змея срабатывает, если ход заканчивается ровно на ней, и утягивает фишку вниз — это урок, к которому стоит прислушаться. Стрела, наоборот, подбрасывает фишку вперёд — прорыв или неожиданная помощь. Клетки, которые фишка просто проходит транзитом, не считаются.",
  },
  {
    emoji: '📜',
    title: "Клетки-подсказки",
    body: "У каждой клетки есть свой текст. Читай его в контексте своего запроса — это и есть основная часть практики, а не просто \"прошёл клетку и забыл\".",
  },
  {
    emoji: '🏁',
    title: "Финиш",
    body: "Партия заканчивается, как только фишка попадает ровно на финишную клетку — любым способом, обычным ходом или через змею/стрелу. После этого можно посмотреть итог всей партии.",
  },
];

/**
 * Обучающий онбординг перед первой партией. Автопоказ управляется извне
 * (Intro.tsx решает, пушить ли этот экран, по persistence.hasSeenOnboarding),
 * здесь — только два независимых режима:
 *  - params.mode === 'onboarding' (по умолчанию) — первый показ на пути к
 *    новой партии: любое завершение (свайп до конца, «Пропустить») ведёт
 *    в RequestInput и помечает онбординг увиденным.
 *  - params.mode === 'replay' — открыт вручную кнопкой «Как играть» на
 *    Intro: завершение просто возвращает назад (nav.pop()), партию не трогаем.
 */
export function HowToPlay({ nav, params }: ScreenProps) {
  const mode = params?.mode === 'replay' ? 'replay' : 'onboarding';
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  const finish = () => {
    // markOnboardingSeen() безопасно звать и в replay-режиме — экран уже был
    // увиден раньше (иначе кнопки «Как играть» бы не было), повторная
    // запись того же '1' ничего не меняет.
    markOnboardingSeen();
    if (mode === 'replay') {
      nav.pop();
    } else {
      nav.push('RequestInput');
    }
  };

  return (
    <div className="screen screen-centered screen-howtoplay">
      <div className="howtoplay-emoji" aria-hidden="true">
        {slide.emoji}
      </div>
      <ScreenHeading>{tr(slide.title)}</ScreenHeading>
      <p>{tr(slide.body)}</p>

      <div className="howtoplay-dots" role="tablist" aria-label={tr("Шаги обучения")}>
        {SLIDES.map((s, i) => (
          <button
            key={s.title}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={tr("Шаг {0} из {1}", i + 1, SLIDES.length)}
            className={`howtoplay-dot${i === index ? ' active' : ''}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>

      <div className="howtoplay-actions">
        {index > 0 && <button onClick={() => setIndex((i) => i - 1)}>{tr("Назад")}</button>}
        {!isLast && (
          <button className="primary" onClick={() => setIndex((i) => i + 1)}>{tr("Далее")} </button>
        )}
        {isLast && (
          <button className="primary" onClick={finish}>
            {mode === 'replay' ? tr("Понятно") : tr("Начать партию")}
          </button>
        )}
      </div>

      {!isLast && (
        <button className="howtoplay-skip" onClick={finish}>{tr("Пропустить")} </button>
      )}
    </div>
  );
}
