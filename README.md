# Этап 6 — файлы для вставки в github.dev

## Новые файлы (создать папку src/telegram)
- src/telegram/telegramAdapter.ts       — единственная точка входа в window.Telegram
- src/telegram/telegramAdapter.test.ts  — юнит-тесты (Telegram есть / Telegram нет)
- src/telegram/useTelegramTheme.ts      — тема -> CSS-переменные --tg-theme-*
- src/telegram/useTelegramViewport.ts   — высота вьюпорта + safe area -> CSS-переменные
- src/telegram/useTelegramBackButton.ts — системная BackButton -> тот же pop()
- src/telegram/haptics.ts               — safe-обёртка над HapticFeedback

## Изменённые файлы (заменить целиком)
- index.html            — добавлен <script src="telegram-web-app.js">
- src/App.tsx            — подключение всех Telegram-хуков
- src/App.css            — safe-area отступы, --app-height, --accent-fg на кнопках
- src/index.css          — --tg-theme-* с фоллбеками + ПЕРЕСТАВЛЕНЫ переменные
                            --board-* этапа 5 (в репозитории их не оказалось —
                            видимо, при вставке файлов этапа 5 этот файл
                            заменили не полностью; без них доска рисуется
                            без цветов)
- src/screens/DiceRoll.tsx    — hapticImpact('light') на бросок
- src/screens/TurnResult.tsx  — hapticImpact('medium') на "приземление"
- src/screens/Splash.tsx      — приветствие по имени, если открыто в Telegram
                                 (initDataUnsafe, только для отображения)

## Важно
Проверить index.css после вставки: там снова должны появиться строки
--board-frame / --board-cell / --board-special-* и т.д. — без них Board.tsx
из этапа 5 отрисуется без палитры.

Подробности — в комментариях внутри самих файлов.
