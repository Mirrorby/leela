# Лила / Leela

Telegram Mini App для игры Лила: доска из 72 клеток, физический или виртуальный кубик, сохранение партий и ИИ-разбор завершённого пути. Интерфейс и контент доступны на русском и английском. Язык выбирается по Telegram, затем браузеру; ручной выбор через флаг сохраняется на устройстве.

- Игра: [mirrorby.github.io/leela](https://mirrorby.github.io/leela/).
- Worker: [проверка сервера и D1](https://leela-worker.nikita-karpof.workers.dev/api/v1/health).
- Доступ: одна бесплатная партия и один краткий ИИ-разбор на аккаунт. Полный разбор использует купленный кредит. Новые покупки — через Tribute, цены в USD.
- Старые купленные кредиты, готовые разборы и оплаченные периоды сохраняются; новые покупки Stars и подписки отключены.

## Структура

| Каталог/файл | Назначение |
|---|---|
| `src/` | React-интерфейс, игровой движок, клиент API, переводы |
| `src/data/content/ru/`, `src/data/content/en/` | Тексты 72 клеток |
| `src/data/limits.json` | Общие лимиты клиента и Worker |
| `src/data/paymentSupport.json` | Контакты поддержки оплаты |
| `worker/src/` | Telegram-аутентификация, API, D1, ИИ, вебхуки и cron |
| `worker/migrations/` | Версионированная схема D1 |
| `worker/scripts/` | Проверка старой схемы, миграции и локальная HTTP-проверка |
| `.github/workflows/` | Проверки PR и последовательная публикация Worker/Pages |

Frontend и Worker — отдельные npm-проекты со своими lock-файлами. Frontend использует React 19, TypeScript 6 и Vite 8; Worker — Wrangler 4 и Cloudflare D1. Точные версии фиксируются lock-файлами.

## Локальная разработка

Нужен Node.js 24.15 или новее в ветке 24. Для Worker используется npm 12, как в CI.

Из корня репозитория:

```bash
npm ci
npm run dev
```

В другом терминале, из корня:

```bash
cd worker
npx --yes npm@12 ci
npm run migrate:local
npm run dev -- --local
```

Для локальных секретов создайте `worker/.dev.vars` с нужными именами из таблицы ниже. Этот файл исключён из git. Он может содержать действующие ключи: используйте отдельного тестового бота и не вызывайте реальные платёжные/ИИ-сценарии при обычной проверке.

Frontend по умолчанию обращается к действующему Worker. Для локального API задайте в корневом `.env.local`:

```dotenv
VITE_WORKER_API_URL=http://localhost:8787
```

После изменения перезапустите Vite. Обычная вкладка браузера не получает подписанный Telegram `initData`: защищённые API вернут 401. Для проверки серверного цикла без настоящего бота используйте из `worker/` команду `npm run test:local`; она сама создаёт временную D1 и подписывает запросы вымышленным токеном. Это не обход аутентификации действующего приложения.

## Проверки

Frontend, из корня:

```bash
npm test
npm run lint
npm run build
```

Worker, из `worker/`:

```bash
npm run typecheck
npm test
npm run test:migrations
npm run migrate:local
npm run migrate:local
npm run build
npm run test:local
```

Повтор миграции проверяет повторное применение. `build` Worker использует `--dry-run` и не публикует код. `test:local` запускает настоящий Wrangler/workerd, проверяет D1, HMAC, CORS, создание/повтор/список партий и бесплатный лимит, затем удаляет временную базу. Реальных оплат, ИИ-запросов и сообщений в этих проверках нет. Полная проверка всех SQL на новой D1 описана в [MIGRATIONS.md](worker/MIGRATIONS.md).

## Конфигурация и секреты

| Имя | Где хранится | Назначение |
|---|---|---|
| `DB` | D1 binding в `worker/wrangler.toml` | База `leela`; для другого аккаунта заменить `database_id` |
| `ENVIRONMENT` | `[vars]` в `worker/wrangler.toml` | Метка окружения |
| `TRIBUTE_PRODUCTS` | `[vars]` в `worker/wrangler.toml` | ID товаров Tribute, SKU, ожидаемые суммы и валюты |
| `BOT_TOKEN` | Cloudflare Worker Secret | Токен бота: проверка Telegram `initData` и обращения к Bot API |
| `WEBHOOK_SECRET` | Cloudflare Worker Secret | Независимый секрет Telegram-вебхука, совпадает с `secret_token` в `setWebhook` |
| `GEMINI_API_KEY` | Cloudflare Worker Secret | Ключ Gemini для ИИ-разборов |
| `TRIBUTE_API_KEY` | Cloudflare Worker Secret | Проверка подписи Tribute |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions Secret | Публикация Worker и изменение D1 в нужном Cloudflare-аккаунте |
| `VITE_WORKER_API_URL` | Окружение Vite при запуске/сборке | Необязательный публичный адрес API; по умолчанию текущий production Worker |

Секреты не добавляются в `wrangler.toml`, git или переменные `VITE_*`: значения Vite попадают в клиентскую сборку. Из `worker/` секрет можно добавить интерактивно, например:

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TRIBUTE_API_KEY
```

Сначала проверьте выбранный Cloudflare-аккаунт и имя Worker. В существующем приложении секреты уже настроены; повторное добавление заменит значение. `wrangler secret put` сразу публикует новую версию Worker, поэтому выполняйте его из проверенного checkout. См. [официальную документацию Secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Публикация и первоначальная настройка

1. Для нового окружения создайте D1-базу и задайте её binding/ID в `worker/wrangler.toml`. Таблицы создаются проектным мигратором; вручную создавать только `games` недостаточно.
2. Добавьте `CLOUDFLARE_API_TOKEN` в секреты GitHub Actions с правами изменения Workers Scripts и D1. Настройте публикацию GitHub Pages через Actions.
3. Выпуск из `main` выполняет проверки → миграции действующей D1 → публикацию Worker → проверку здоровья → Pages. Точка входа — `deploy.yml`; `deploy-worker.yml` вызывается им как reusable workflow.
4. Добавьте четыре Worker Secret из таблицы. Свяжите бота с адресом Mini App и зарегистрируйте Telegram-вебхук, затем настройте Tribute по [TRIBUTE_SETUP.md](worker/TRIBUTE_SETUP.md).
5. Проверьте `/api/v1/health`, открытие из Telegram и баланс. Проверка здоровья подтверждает доступность Worker/D1, но не валидность ключей Gemini, Telegram или Tribute.

Для отдельного нового окружения также согласуйте адреса в `src/api/workerClient.ts`, `worker/src/telegram/webhook.ts` и health-проверке `.github/workflows/deploy-worker.yml`. Адрес Vite может задаваться переменной сборки; текущий workflow использует адрес по умолчанию.

Перед применением к старой базе прочитайте [MIGRATIONS.md](worker/MIGRATIONS.md): мигратор проверяет совместимость вручную созданной схемы и применяет недостающее. Исторические миграции 0001–0016 заморожены; изменения оформляются новой миграцией.

### Telegram-вебхук

Сообщения бота автоматически выбирают русский или английский по языку
Telegram. Production cron также устанавливает локализованные полное и короткое
описания профиля и подписи команд; английский используется по умолчанию.
Ручное переключение языка внутри игры не меняет язык Telegram.
[Настройка и готовые тексты товаров EN/RU](worker/BOT_AND_TRIBUTE_COPY.md).

Вызовите Bot API `setWebhook` для нужного бота с такими параметрами, подставив реальные адрес и секрет в приватном инструменте настройки:

```json
{
  "url": "https://<worker>/telegram/webhook",
  "secret_token": "<WEBHOOK_SECRET>",
  "allowed_updates": []
}
```

`secret_token` допускает 1–256 символов `A-Z`, `a-z`, `0-9`, `_`, `-`. Пустой `allowed_updates` включает необходимые уведомления сообщений и исторических подписок. Не сбрасывайте ожидающие финансовые уведомления через `drop_pending_updates`. Проверяйте URL, очередь и последнюю ошибку через `getWebhookInfo`. Формат описан в [Telegram Bot API](https://core.telegram.org/bots/api#setwebhook).

### Tribute и Gemini

Каталог Tribute хранится в `worker/wrangler.toml`: 1 партия — $1.59, 5 партий — $5.99, полный ИИ-разбор — $1.99, партия + полный разбор — $2.99. Цена, валюта и числовой ID товара должны совпадать с подписанным уведомлением. Переход по ссылке и тестовый webhook без покупки ничего не начисляют. Инструкции, ссылки товаров и сверка оплаты — в [TRIBUTE_SETUP.md](worker/TRIBUTE_SETUP.md).

Модель Gemini задаётся в `worker/src/ai/geminiClient.ts`, сейчас `gemini-2.5-flash`. Для генерации нужен доступный ключ и квота провайдера. Бесплатный краткий и платный полный разбор сохраняются отдельно; готовые результаты читаются без нового списания. Таймауты и возврат кредита описаны в [AI_REVIEWS.md](worker/AI_REVIEWS.md).

## API

Защищённые маршруты требуют `Authorization: tma <Telegram initData>`. Владелец определяется на сервере по проверенной подписи. `initData` действует до 24 часов; после истечения нужно заново открыть Mini App.

| Метод и маршрут | Назначение |
|---|---|
| `GET /api/v1/health` | Публичная проверка Worker и D1 |
| `GET /api/v1/me` | Подтверждённый аккаунт |
| `POST /api/v1/games` | Создание: `request`, `diceMode`, `clientRequestId`; 201 при создании, 200 при повторе |
| `GET /api/v1/games` | История с `limit`, `cursor`; ответ содержит `games`, `nextCursor` |
| `GET /api/v1/games/:id` | Чтение партии владельца |
| `DELETE /api/v1/games/:id` | Удаление партии и разборов владельца; повтор успешен, кредит pending возвращается |
| `POST /api/v1/games/:id/rolls` | Бросок с `clientEventId`; `value` для физического кубика |
| `POST /api/v1/games/:id/analysis/start` | `{ "kind": "short" или "full", "language": "ru" или "en" }`; только для завершённой/архивной партии |
| `GET /api/v1/games/:id/analysis` | Статус и сохранённые краткая/полная версии |
| `GET /api/v1/products` | Каталог Tribute с ценами и URL |
| `GET /api/v1/entitlements` | Бесплатные и платные остатки, исторический доступ |
| `POST /api/v1/analytics/event` | Разрешённые клиентские события; оплата ими не подтверждается |
| `POST /api/v1/payments/invoice` | Старый маршрут Stars: 410 |
| `POST /telegram/webhook` | Telegram, проверка `X-Telegram-Bot-Api-Secret-Token` |
| `POST /tribute/webhook` | Tribute, HMAC-SHA256 исходного тела в `trbt-signature` |

`OPTIONS` обслуживает CORS. Ключи создания/броска нужно сохранить до отправки и повторять неизменными при сетевой ошибке. Пустое тело запуска анализа означает краткую русскую версию для старых клиентов; новый клиент передаёт вид и язык явно. Ошибки JSON API возвращают JSON с кодом; лимиты дают 413/429, недостаток доступа — 402.

## Восстановление и ограничения

Продолжение восстанавливает существующую партию, включая состояние до рождения, без нового списания. Незавершённые создание/бросок журналируются на устройстве для подтверждённого аккаунта. Просроченный ИИ возвращает кредит через чтение/повторный запуск или cron каждые пять минут; генерация автоматически не повторяется.

Подробные гарантии, лимиты, оплата и таблица диагностики — в [OPERATIONS.md](worker/OPERATIONS.md). Для возвратов старых Stars со статусом `manual_review` нужна отдельная сверка; неопределённый оплаченный период автоматически не сокращается.

Кнопка удаления с подтверждением удаляет намерение, ходы и разборы из действующей D1. Сыгранная партия и готовый разбор не возвращаются на баланс; pending-разбор возвращает свой кредит. Минимальная квитанция ID/аккаунта/ключа/времени удаления предотвращает повторное создание старым запросом. Покупки и баланс сохраняются. Перед запуском ИИ интерфейс объясняет передачу намерения и пути в Google Gemini; играть можно без разбора. Удаление в Лиле не удаляет данные у Gemini, резервные копии базы или автономные копии на других устройствах. Проверки настоящей карты Tribute и нативного Telegram выполняются отдельно от CI.
