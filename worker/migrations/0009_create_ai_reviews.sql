-- 0009_create_ai_reviews.sql
--
-- Статус ИИ-разбора на партию (ТЗ §11): отсутствует (нет строки) / pending /
-- ready / failed. game_id — PRIMARY KEY: "один ИИ-разбор может быть
-- использован только для одной партии" (§4.1) буквально означает "одна
-- партия — максимум один разбор", что PRIMARY KEY на game_id обеспечивает
-- на уровне схемы, а не только в коде приложения.
--
-- charged_from ('free' | 'paid') — куда вернуть баланс, если генерация
-- упадёт технической ошибкой (§12: "пользователь не должен терять
-- оплаченный доступ"). Без этого поля возврат при сбое пришлось бы
-- угадывать (или всегда возвращать в paid, что неверно, если списали
-- именно бесплатный разбор).

CREATE TABLE IF NOT EXISTS ai_reviews (
  game_id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  status TEXT NOT NULL,
  charged_from TEXT NOT NULL,
  content TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
