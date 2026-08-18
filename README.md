# Этап 7.1–7.2 — каркас Cloudflare Worker

## Куда класть файлы в репозитории (github.dev)

```
leela/
├── worker/
│   ├── package.json
│   ├── tsconfig.json
│   ├── wrangler.toml
│   └── src/
│       └── index.ts
└── .github/
    └── workflows/
        └── deploy-worker.yml
```

Существующие файлы фронтенда (`src/`, `.github/workflows/deploy.yml` для Pages
и т.д.) не трогаем — `worker/` живёт рядом как отдельный npm-проект.

## Порядок действий (см. пошаговую карточку в чате)

1. Создать D1-базу и таблицу `games` через Cloudflare Dashboard.
2. Вставить `database_id` в `worker/wrangler.toml`.
3. Создать Cloudflare API Token и добавить его в GitHub как секрет
   `CLOUDFLARE_API_TOKEN`.
4. Закоммитить файлы из этого архива в `main` — сработает
   `deploy-worker.yml` и создаст воркер `leela-worker` на Cloudflare.
5. После первого успешного деплоя — добавить секреты `BOT_TOKEN` и
   `WEBHOOK_SECRET` через Dashboard → leela-worker → Settings → Variables.
6. Проверить `https://leela-worker.<твой-субдомен>.workers.dev/api/v1/health`
   — должно вернуть `{"ok": true, "db": "reachable", ...}`.

## Что дальше (этапы 7.3–7.6, отдельными сообщениями)

- 7.3: перенос `gameEngine.ts` / `diceEngine.ts` / `transitionEngine.ts` в
  `worker/src` (общий код с фронтом, без изменений логики).
- 7.4: валидация `initData` по HMAC на каждый запрос `/api/v1/*`.
- 7.5: эндпойнты `games` (create/list/get/rolls) с идемпотентностью по
  `clientEventId`.
- 7.6: `/telegram/webhook` — ответ на `/start` кнопкой открытия Mini App.
