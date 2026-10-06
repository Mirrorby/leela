# Бот и Tribute: русский и английский

## Что меняется автоматически

Сообщения `/start`, `/paysupport` и отказ от старой оплаты Stars используют
`from.language_code` из Telegram: `ru`, `ru-RU`, `ru_BY` → русский,
остальные языки и отсутствующий код → английский. Ручной выбор языка внутри
Mini App хранится на устройстве и не меняет язык Telegram или чата бота.
Уже отправленные сообщения Telegram не переводит задним числом.

Тексты профиля хранятся в [`src/telegram/profile.ts`](src/telegram/profile.ts).
Production cron устанавливает полное описание, короткое описание и подписи
команд через Bot API для `ru`, `en` и английского языка по умолчанию. Обычно
это происходит на ближайшем пятиминутном запуске после выпуска. Нужен уже
настроенный `BOT_TOKEN`; новый ключ не требуется. Чат-сообщения и рассылки
эта настройка не отправляет. Имя, username, аватар и кнопка меню не меняются.

Успех всех девяти запросов отмечается в `application_policies` ключом
`telegram-profile:<bot ID>:<SHA-256 текстов>`. При ошибке отметка не создаётся,
следующий cron повторяет настройку. Изменение текстов меняет SHA и применяет
новую версию. Не записываем токен, тело ответа Telegram или данные пользователей.
Для проверки в Cloudflare D1 можно выполнить:

```sql
SELECT id, applied_at FROM application_policies
WHERE id LIKE 'telegram-profile:%' ORDER BY applied_at DESC;
```

Описание Telegram отображается по языку Telegram. Само наличие выпущенного
Worker не подтверждает успешную настройку профиля: проверьте отметку и
`getMyDescription` / `getMyShortDescription` / `getMyCommands` для `ru`, `en`
и пустого `language_code` в приватном инструменте Bot API. Для проверки
нового приветствия отправьте `/start` после изменения языка Telegram.

## Что нужно заменить в Tribute

Тексты товаров и содержимое, выдаваемое после покупки, хранятся в Tribute,
а не в Worker. Изменение репозитория само по себе их не обновляет.
В официальной инструкции не описаны отдельные поля локализации товара;
если в вашем кабинете есть выбор языка для каждого поля, используйте
соответствующие блоки EN/RU ниже. Для одного общего поля вставляйте оба
блока: английский первым, русский вторым. Это позволяет сохранить четыре
существующих товара и ссылки для обеих аудиторий.

Откройте [@Tribute](https://t.me/tribute) → профиль автора → нужный товар →
«Ещё» → «Редактировать». Замените название, описание и, если оно доступно
для редактирования, текст выдаваемого товара. Сохраните. Если поле выдаваемого
содержимого недоступно, уточните у [поддержки Tribute](https://t.me/TributeSupportBot),
как заменить его в существующем товаре. Не создавайте дубликат с новым ID без
обновления интеграции. Публичную карточку проверяйте и в английском интерфейсе.

| Ссылка | ID | Цена | Состав |
|---|---|---|---|
| [FWC](https://web.tribute.tg/p/FWC) | 161238 | $1.59 USD | 1 партия |
| [FWP](https://web.tribute.tg/p/FWP) | 161251 | $5.99 USD | 5 партий |
| [FWQ](https://web.tribute.tg/p/FWQ) | 161252 | $1.99 USD | 1 полный ИИ-разбор |
| [FWR](https://web.tribute.tg/p/FWR) | 161253 | $2.99 USD | 1 партия + 1 полный ИИ-разбор |

Цены, валюту, числовые ID и ссылки при переводе сохраняйте.
Общий текст кнопки, если доступно одно поле: **Buy / Купить**.

## FWC — 1 партия

Название для общего поля:

```text
Leela — 1 game / Лила — 1 партия
```

Описание:

```text
EN
One additional game of Leela. Set an intention, explore the board and return to your saved journey whenever you wish. A full AI review is sold separately.

Sign in to Tribute with the same Telegram account you use for Leela. After payment is confirmed, 1 game credit is added automatically. This is a one-time purchase.

RU
Одна дополнительная партия в Лилу. Сформулируйте намерение, исследуйте клетки доски и возвращайтесь к сохранённому пути. Полный ИИ-разбор приобретается отдельно.

Войдите в Tribute через тот же Telegram-аккаунт, который используете в Лиле. После подтверждения оплаты 1 партия начисляется автоматически. Это разовая покупка.
```

Текст самого товара, выдаваемый после оплаты:

```text
EN
Thank you for your purchase! Once payment is confirmed, 1 game credit will be added to your Leela account automatically.

Return to the Leela bot in Telegram and tap Open Leela. Use the same Telegram account you used for the purchase. If the balance has not updated, tap Refresh balance after payment in the game. For help, send /paysupport to the Leela bot or contact https://t.me/Mirrorby with your Tribute purchase ID.

RU
Спасибо за покупку! После подтверждения оплаты 1 партия будет автоматически начислена на ваш аккаунт Лилы.

Вернитесь в бот Лилы в Telegram и нажмите «Открыть Лилу». Используйте тот же Telegram-аккаунт, с которым оформляли покупку. Если баланс не обновился, нажмите в игре «Обновить баланс после оплаты». Для помощи отправьте /paysupport боту Лилы или напишите https://t.me/Mirrorby, указав ID покупки Tribute.
```

## FWP — 5 партий

Название для общего поля:

```text
Leela — 5 games / Лила — 5 партий
```

Описание:

```text
EN
Five additional games of Leela for exploring different intentions at your own pace. Each journey is saved so you can return to it later. Full AI reviews are sold separately.

Sign in to Tribute with the same Telegram account you use for Leela. After payment is confirmed, 5 game credits are added automatically. This is a one-time purchase.

RU
Пять дополнительных партий в Лилу, чтобы исследовать разные намерения в своём темпе. Каждый путь сохраняется, и к нему можно вернуться позже. Полные ИИ-разборы приобретаются отдельно.

Войдите в Tribute через тот же Telegram-аккаунт, который используете в Лиле. После подтверждения оплаты 5 партий начисляются автоматически. Это разовая покупка.
```

Текст самого товара, выдаваемый после оплаты:

```text
EN
Thank you for your purchase! Once payment is confirmed, 5 game credits will be added to your Leela account automatically.

Return to the Leela bot in Telegram and tap Open Leela. Use the same Telegram account you used for the purchase. If the balance has not updated, tap Refresh balance after payment in the game. For help, send /paysupport to the Leela bot or contact https://t.me/Mirrorby with your Tribute purchase ID.

RU
Спасибо за покупку! После подтверждения оплаты 5 партий будут автоматически начислены на ваш аккаунт Лилы.

Вернитесь в бот Лилы в Telegram и нажмите «Открыть Лилу». Используйте тот же Telegram-аккаунт, с которым оформляли покупку. Если баланс не обновился, нажмите в игре «Обновить баланс после оплаты». Для помощи отправьте /paysupport боту Лилы или напишите https://t.me/Mirrorby, указав ID покупки Tribute.
```

## FWQ — полный ИИ-разбор

Название для общего поля:

```text
Leela — Full AI review / Лила — полный ИИ-разбор
```

Описание:

```text
EN
One full AI review of a completed Leela game. Reflect on your intention, the squares you visited and the patterns in your journey. Choose English or Russian in the game before requesting the review. This purchase does not include a game credit.

The review is generated by AI, not a human consultant. Your intention and game path are sent to Google Gemini when you request it. Sign in to Tribute with the same Telegram account you use for Leela. After payment is confirmed, 1 full AI review credit is added automatically. This is a one-time purchase.

RU
Один полный ИИ-разбор завершённой партии в Лилу. Осмыслите своё намерение, пройденные клетки и закономерности игрового пути. Перед запросом разбора выберите русский или английский язык в игре. Партия в этот товар не входит.

Разбор создаёт ИИ, а не консультант. При запросе разбора ваше намерение и игровой путь передаются в Google Gemini. Войдите в Tribute через тот же Telegram-аккаунт, который используете в Лиле. После подтверждения оплаты 1 полный ИИ-разбор начисляется автоматически. Это разовая покупка.
```

Текст самого товара, выдаваемый после оплаты:

```text
EN
Thank you for your purchase! Once payment is confirmed, 1 full AI review credit will be added to your Leela account automatically.

Open Leela in Telegram with the same account you used for the purchase. Open a completed game's summary, choose your language and request a full AI review. The review is generated when you request it; it is not delivered as a finished report by Tribute. If the balance has not updated, tap Refresh balance after payment in the game. For help, send /paysupport to the Leela bot or contact https://t.me/Mirrorby with your Tribute purchase ID.

RU
Спасибо за покупку! После подтверждения оплаты 1 полный ИИ-разбор будет автоматически начислен на ваш аккаунт Лилы.

Откройте Лилу в Telegram с того же аккаунта, с которым оформляли покупку. Откройте итоги завершённой партии, выберите язык и запросите полный ИИ-разбор. Он создаётся по вашему запросу; Tribute не присылает готовый отчёт. Если баланс не обновился, нажмите в игре «Обновить баланс после оплаты». Для помощи отправьте /paysupport боту Лилы или напишите https://t.me/Mirrorby, указав ID покупки Tribute.
```

## FWR — партия + полный ИИ-разбор

Название для общего поля:

```text
Leela — Game + Full AI review / Лила — партия + разбор
```

Описание:

```text
EN
One additional game of Leela and one full AI review. Explore an intention, complete your journey and request a detailed reflection on your path. Choose English or Russian in the game before requesting the review.

The review is generated by AI, not a human consultant. Your intention and game path are sent to Google Gemini when you request it. Sign in to Tribute with the same Telegram account you use for Leela. After payment is confirmed, 1 game credit and 1 full AI review credit are added automatically. This is a one-time purchase.

RU
Одна дополнительная партия в Лилу и один полный ИИ-разбор. Исследуйте своё намерение, завершите игровой путь и запросите подробное осмысление пройденных клеток. Перед запросом разбора выберите русский или английский язык в игре.

Разбор создаёт ИИ, а не консультант. При запросе разбора ваше намерение и игровой путь передаются в Google Gemini. Войдите в Tribute через тот же Telegram-аккаунт, который используете в Лиле. После подтверждения оплаты 1 партия и 1 полный ИИ-разбор начисляются автоматически. Это разовая покупка.
```

Текст самого товара, выдаваемый после оплаты:

```text
EN
Thank you for your purchase! Once payment is confirmed, 1 game credit and 1 full AI review credit will be added to your Leela account automatically.

Return to the Leela bot in Telegram and tap Open Leela. Use the same account you used for the purchase. Start a game; after completing it, open its summary and request a full AI review in your chosen language. If the balance has not updated, tap Refresh balance after payment in the game. For help, send /paysupport to the Leela bot or contact https://t.me/Mirrorby with your Tribute purchase ID.

RU
Спасибо за покупку! После подтверждения оплаты 1 партия и 1 полный ИИ-разбор будут автоматически начислены на ваш аккаунт Лилы.

Вернитесь в бот Лилы в Telegram и нажмите «Открыть Лилу». Используйте тот же аккаунт, с которым оформляли покупку. Начните партию; после её завершения откройте итоги и запросите полный ИИ-разбор на выбранном языке. Если баланс не обновился, нажмите в игре «Обновить баланс после оплаты». Для помощи отправьте /paysupport боту Лилы или напишите https://t.me/Mirrorby, указав ID покупки Tribute.
```

## Официальные инструкции

- [Локализованные описания и команды Telegram](https://core.telegram.org/bots/api#setmydescription)
- [Редактирование существующего товара Tribute](https://wiki.tribute.tg/ru/for-content-creators/digital-product/how-to-edit-a-digital-product)
- [Содержимое, название и описание товара Tribute](https://wiki.tribute.tg/ru/for-content-creators/digital-product/how-to-create-a-digital-product)
