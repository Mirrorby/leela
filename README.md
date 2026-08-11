# Лила (Leela) — цифровая версия игры-трансформации

Mobile-first веб-приложение, работает как обычный сайт (GitHub Pages) и как
Telegram Mini App на едином frontend.

## Статус

- ✅ Этап 1 — каркас репозитория и ruleset
- ⬜ Этап 2 — Game Engine + unit-тесты
- ⬜ Этап 3 — минимальный UI-каркас (14 экранов)
- ⬜ Этап 4 — Guest Mode + деплой
- ⬜ Этап 5 — SVG-поле и графика
- ⬜ Этап 6 — Telegram-обвязка на фронте
- ⬜ Этап 7 — Cloudflare Worker (API + бот)
- ⬜ Этап 8 — Telegram Mode целиком + финальная сверка

## Структура проекта

```
src/
  data/
    rulesets/classic-v1.json     — правила игры (доска, рождение, шестёрки,
                                     переходы). Версионируется отдельным файлом,
                                     старые версии не удаляются и не мигрируют.
    content/ru/cells.json        — тексты 72 клеток (сейчас заглушки,
                                     ждут финального контента)
  types/game.ts                  — TS-типы Ruleset, ContentPack, GameState
  game/
    ruleset.ts                   — загрузчик ruleset/контента по id
    gameEngine.ts                — ядро игровой логики (state machine).
                                     UI и Storage НИЧЕГО не знают о правилах
                                     и обращаются сюда за любым решением.
    diceEngine.ts                — генерация/валидация броска кубика
    transitionEngine.ts          — логика змей/стрел
  screens/                       — экраны приложения (появятся на этапе 3)
```

## Важные незакрытые вопросы по контенту (блокеры перед стадией контента)

Отмечены как `_todo` прямо в JSON-файлах:

1. `src/data/rulesets/classic-v1.json` → `transitions` — финальный список
   змей и стрел не утверждён, нужно сверить с физической доской.
2. `src/data/rulesets/classic-v1.json` → `beyondFinish` — правило поведения
   клеток 69–72 требует уточнения.
3. `src/data/content/ru/cells.json` — все 72 клетки сейчас заглушки
   (`Клетка N`, пустые описания), ждут реальных текстов.

## Разработка

```bash
npm install
npm run dev       # локальный запуск
npm run build     # production-сборка в dist/
```

При пуше в `main` GitHub Actions (`.github/workflows/deploy.yml`)
автоматически собирает и публикует `dist/` на GitHub Pages.
