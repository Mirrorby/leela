import type { GameState, GameStatus, DiceMode, Roll, Turn } from '../types/game';

/**
 * Форма строки таблицы games ровно как в БД (см. worker/migrations/).
 * Отдельно от GameState специально: в БД часть полей — другие типы
 * (is_born как 0/1, ruleset_version как TEXT) и хранятся под snake_case.
 */
export interface GameRow {
  id: string;
  telegram_id: string;
  status: string;
  ruleset_id: string;
  ruleset_version: string;
  dice_mode: string;
  current_cell: number | null;
  is_born: number;
  rolls_json: string;
  turns_json: string;
  created_at: number;
  updated_at: number;
  consecutive_sixes: number;
  position_before_six_series: number;
  request: string;
  version: number;
}

export function rowToGameState(row: GameRow): GameState {
  return {
    id: row.id,
    rulesetId: row.ruleset_id,
    rulesetVersion: Number(row.ruleset_version),
    request: row.request,
    status: row.status as GameStatus,
    diceMode: row.dice_mode as DiceMode,
    currentCell: row.current_cell ?? 0,
    isBorn: row.is_born === 1,
    consecutiveSixes: row.consecutive_sixes,
    positionBeforeSixSeries: row.position_before_six_series,
    currentTurnRolls: JSON.parse(row.rolls_json) as Roll[],
    turns: JSON.parse(row.turns_json) as Turn[],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

interface GameRowParams {
  id: string;
  telegram_id: string;
  status: string;
  ruleset_id: string;
  ruleset_version: string;
  dice_mode: string;
  current_cell: number;
  is_born: number;
  rolls_json: string;
  turns_json: string;
  created_at: number;
  updated_at: number;
  consecutive_sixes: number;
  position_before_six_series: number;
  request: string;
}

function gameStateToRowParams(game: GameState, telegramId: string): GameRowParams {
  return {
    id: game.id,
    telegram_id: telegramId,
    status: game.status,
    ruleset_id: game.rulesetId,
    ruleset_version: String(game.rulesetVersion),
    dice_mode: game.diceMode,
    current_cell: game.currentCell,
    is_born: game.isBorn ? 1 : 0,
    rolls_json: JSON.stringify(game.currentTurnRolls),
    turns_json: JSON.stringify(game.turns),
    created_at: Date.parse(game.createdAt),
    updated_at: Date.parse(game.updatedAt),
    consecutive_sixes: game.consecutiveSixes,
    position_before_six_series: game.positionBeforeSixSeries,
    request: game.request,
  };
}

export async function insertGame(db: D1Database, game: GameState, telegramId: string, clientRequestId: string | null = null): Promise<void> {
  const p = gameStateToRowParams(game, telegramId);
  await db
    .prepare(
      `INSERT INTO games (
        id, telegram_id, status, ruleset_id, ruleset_version, dice_mode,
        current_cell, is_born, rolls_json, turns_json, created_at, updated_at,
        consecutive_sixes, position_before_six_series, request, version, client_request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .bind(
      p.id,
      p.telegram_id,
      p.status,
      p.ruleset_id,
      p.ruleset_version,
      p.dice_mode,
      p.current_cell,
      p.is_born,
      p.rolls_json,
      p.turns_json,
      p.created_at,
      p.updated_at,
      p.consecutive_sixes,
      p.position_before_six_series,
      p.request,
      clientRequestId
    )
    .run();
}

/** Партия по идемпотентность-ключу клиента (см. 0011_add_client_request_id_to_games.sql
 * и index.ts:handleCreateGame) — используется ДО списания баланса, чтобы
 * ретрай прерванного запроса не создавал вторую партию и не списывал
 * баланс повторно. null — такого ключа ещё не видели (обычный путь для
 * первого запроса). */
export async function getGameByClientRequestId(db: D1Database, telegramId: string, clientRequestId: string): Promise<GameState | null> {
  const row = await db
    .prepare('SELECT * FROM games WHERE telegram_id = ? AND client_request_id = ?')
    .bind(telegramId, clientRequestId)
    .first<GameRow>();
  return row ? rowToGameState(row) : null;
}

/**
 * Optimistic concurrency control (см. migrations/0004_add_version_column.sql):
 * UPDATE выполняется с условием WHERE version = expectedVersion (та версия,
 * что была прочитана перед тем, как считать nextGame через processRoll) и
 * одновременно инкрементирует version. Если между чтением и записью кто-то
 * другой уже сохранил свою версию — WHERE не совпадёт ни для одной строки,
 * `.meta.changes` будет 0, и мы возвращаем { success: false } не трогая
 * данные — вызывающий код (handleRoll) обязан ответить клиенту 409, а не
 * молча считать, что запись прошла.
 */
export async function updateGame(
  db: D1Database,
  game: GameState,
  telegramId: string,
  expectedVersion: number
): Promise<{ success: boolean }> {
  const p = gameStateToRowParams(game, telegramId);
  // WHERE ... AND telegram_id = ?: партия не может "перепрыгнуть" к другому
  // владельцу через update, даже теоретически — дублирует проверку доступа
  // при чтении на всякий случай.
  // dice_mode добавлен в SET (баг п.1): раньше эта колонка отсутствовала
  // здесь вовсе, из-за чего смена режима кубика во время партии (см.
  // handleRoll в index.ts) применялась только к ОТВЕТУ конкретного запроса,
  // но никогда не долетала до D1 — уже следующий GET/roll видел старый
  // diceMode со времени создания партии.
  const result = await db
    .prepare(
      `UPDATE games SET
        status = ?, dice_mode = ?, current_cell = ?, is_born = ?, rolls_json = ?, turns_json = ?,
        updated_at = ?, consecutive_sixes = ?, position_before_six_series = ?, version = version + 1
      WHERE id = ? AND telegram_id = ? AND version = ?`
    )
    .bind(
      p.status,
      p.dice_mode,
      p.current_cell,
      p.is_born,
      p.rolls_json,
      p.turns_json,
      p.updated_at,
      p.consecutive_sixes,
      p.position_before_six_series,
      p.id,
      p.telegram_id,
      expectedVersion
    )
    .run();
  return { success: (result.meta?.changes ?? 0) > 0 };
}

/** Партия конкретного пользователя вместе с её текущей version (нужна
 * вызывающему коду для последующего условного updateGame). Возвращает
 * null, если партии нет ИЛИ она принадлежит другому telegram_id. */
export async function getGameById(
  db: D1Database,
  id: string,
  telegramId: string
): Promise<{ game: GameState; version: number } | null> {
  const row = await db
    .prepare('SELECT * FROM games WHERE id = ? AND telegram_id = ?')
    .bind(id, telegramId)
    .first<GameRow>();
  return row ? { game: rowToGameState(row), version: row.version } : null;
}

export interface ListGamesPage {
  games: GameState[];
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Пагинация "если партий станет много" — курсорная (keyset), не
 * OFFSET/LIMIT: у OFFSET на каждой следующей странице СУБД всё равно
 * пересчитывает и пропускает все предыдущие строки (дороже с ростом
 * количества партий), и результат "плывёт", если между запросами страниц
 * что-то вставили/удалили. Курсор — это (updated_at, id) последней
 * партии на предыдущей странице; следующая страница — все строки СТРОГО
 * "раньше" этой точки в том же порядке сортировки (updated_at DESC, id
 * DESC как детерминированный тай-брейк на случай одинакового updated_at).
 *
 * cursor — непрозрачная для клиента строка (base64 от "updated_at:id"),
 * клиент передаёт её как есть, полученную из nextCursor предыдущего
 * ответа — ему не нужно знать формат.
 */
/** Брошено, если клиент передал `cursor`, который не удалось декодировать —
 * отличаем эту ситуацию от "курсора нет вовсе", чтобы не отдавать молча
 * первую страницу вместо явной 400 (см. handleListGames в index.ts). */
export class InvalidCursorError extends Error {
  constructor() {
    super('invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

export async function listGamesByUser(
  db: D1Database,
  telegramId: string,
  options: { limit?: number; cursor?: string | null } = {}
): Promise<ListGamesPage> {
  const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  if (options.cursor && decodeCursor(options.cursor) === null) {
    throw new InvalidCursorError();
  }
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;

  const query = cursor
    ? `SELECT * FROM games WHERE telegram_id = ? AND (updated_at < ? OR (updated_at = ? AND id < ?))
       ORDER BY updated_at DESC, id DESC LIMIT ?`
    : `SELECT * FROM games WHERE telegram_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`;
  const params = cursor
    ? [telegramId, cursor.updatedAt, cursor.updatedAt, cursor.id, limit + 1]
    : [telegramId, limit + 1];

  const result = await db
    .prepare(query)
    .bind(...params)
    .all<GameRow>();
  const rows = result.results ?? [];

  // Запрашиваем на одну строку больше (limit + 1): если она пришла — на
  // сервере есть ещё данные за пределами этой страницы, отдаём курсор на
  // последнюю строку ИЗ ВЫДАННОЙ страницы (не считая "разведочную"
  // лишнюю); если не пришла — это последняя страница, nextCursor = null.
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow ? encodeCursor(lastRow.updated_at, lastRow.id) : null;

  return { games: pageRows.map(rowToGameState), nextCursor };
}

function encodeCursor(updatedAt: number, id: string): string {
  return btoa(`${updatedAt}:${id}`);
}

function decodeCursor(cursor: string): { updatedAt: number; id: string } | null {
  try {
    const decoded = atob(cursor);
    const sep = decoded.lastIndexOf(':');
    if (sep === -1) return null;
    const updatedAt = Number(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (!Number.isFinite(updatedAt) || !id) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}
