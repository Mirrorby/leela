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

export async function insertGame(db: D1Database, game: GameState, telegramId: string): Promise<void> {
  const p = gameStateToRowParams(game, telegramId);
  await db
    .prepare(
      `INSERT INTO games (
        id, telegram_id, status, ruleset_id, ruleset_version, dice_mode,
        current_cell, is_born, rolls_json, turns_json, created_at, updated_at,
        consecutive_sixes, position_before_six_series, request
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      p.request
    )
    .run();
}

export async function updateGame(db: D1Database, game: GameState, telegramId: string): Promise<void> {
  const p = gameStateToRowParams(game, telegramId);
  // WHERE ... AND telegram_id = ?: партия не может "перепрыгнуть" к другому
  // владельцу через update, даже теоретически — дублирует проверку доступа
  // при чтении на всякий случай.
  await db
    .prepare(
      `UPDATE games SET
        status = ?, current_cell = ?, is_born = ?, rolls_json = ?, turns_json = ?,
        updated_at = ?, consecutive_sixes = ?, position_before_six_series = ?
      WHERE id = ? AND telegram_id = ?`
    )
    .bind(
      p.status,
      p.current_cell,
      p.is_born,
      p.rolls_json,
      p.turns_json,
      p.updated_at,
      p.consecutive_sixes,
      p.position_before_six_series,
      p.id,
      p.telegram_id
    )
    .run();
}

/** Партия конкретного пользователя. Возвращает null, если партии нет ИЛИ она принадлежит другому telegram_id. */
export async function getGameById(db: D1Database, id: string, telegramId: string): Promise<GameState | null> {
  const row = await db
    .prepare('SELECT * FROM games WHERE id = ? AND telegram_id = ?')
    .bind(id, telegramId)
    .first<GameRow>();
  return row ? rowToGameState(row) : null;
}

export async function listGamesByUser(db: D1Database, telegramId: string): Promise<GameState[]> {
  const result = await db
    .prepare('SELECT * FROM games WHERE telegram_id = ? ORDER BY updated_at DESC')
    .bind(telegramId)
    .all<GameRow>();
  return (result.results ?? []).map(rowToGameState);
}
