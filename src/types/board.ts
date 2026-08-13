// Типы координатной раскладки доски (этап 5). Board.tsx и вызывающий его
// код работают через эти типы, а не заглядывают в структуру JSON напрямую.
// Namespaced отдельно от types/game.ts: этот файл ничего не знает про
// GameState/Ruleset/RollEvent — только про числа и координаты.

export interface BoardCellCoordinate {
  cellId: number;
  x: number;
  y: number;
}

export interface BoardCoordinates {
  rulesetId: string;
  /** SVG viewBox целиком строкой, как в исходном файле: "0 0 736 816". */
  viewBox: string;
  cells: BoardCellCoordinate[];
}
