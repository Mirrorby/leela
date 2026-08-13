# Этап 5 — файлы для вставки в github.dev

## Новые файлы (создать)
- src/types/board.ts
- src/game/boardCoordinates.ts
- src/components/Board.tsx
- src/components/Board.css
(создайте также папку src/components, если её ещё нет)

## Изменённые файлы (заменить целиком)
- src/screens/GameHome.tsx
- src/screens/CellCard.tsx
- src/index.css — это ПОЛНЫЙ файл со всеми правками уже внутри
  (добавлены переменные --board-* в :root и в тёмную тему),
  просто замените старый index.css этим целиком.

## Не забыть
Эти файлы предполагают, что в репозитории уже лежат (вы их залили сами):
- public/board/classic-v1-board.svg
- src/data/board/classic-v1-coordinates.json

Подробности того, что делает каждый файл — в комментариях внутри самих файлов.
