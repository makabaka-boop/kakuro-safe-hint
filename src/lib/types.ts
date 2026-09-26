/**
 * 盘面数据模型。
 *
 * 盘面为 rows × cols 的网格（至多 10×10）。每个格子为以下之一：
 *  - wall：黑格，可携带横线索（h，右侧连续白格段之和）与竖线索（v，下方连续白格段之和）；
 *  - white：白格，运行期填入 1～9。
 *
 * 不变量（由 validateBoard 校验）：
 *  每条横/竖连续白格段长度 2～6，且段首紧邻的墙格上必须有对应线索；
 *  每个白格恰属于一条横线与一条竖线（横线索或竖线索都不能缺失/悬空）。
 */

export interface WallCell {
  type: 'wall';
  /** 横线索：该格右侧白格段之和；null 表示不携带横线索。 */
  h: number | null;
  /** 竖线索：该格下方白格段之和；null 表示不携带竖线索。 */
  v: number | null;
}

export interface WhiteCell {
  type: 'white';
}

export type Cell = WallCell | WhiteCell;

export interface Board {
  rows: number;
  cols: number;
  cells: Cell[]; // 长度 rows*cols，行优先
}

export type RunDirection = 'h' | 'v';

/** 一条连续白格段：线索值 + 格坐标（行优先顺序，竖线自上而下）。 */
export interface Run {
  dir: RunDirection;
  clue: number;
  cells: number[]; // cells 索引
}

export const MIN_SUM = 3;
export const MAX_SUM = 45;
export const MIN_RUN_LEN = 2;
export const MAX_RUN_LEN = 6;
export const MIN_DIGIT = 1;
export const MAX_DIGIT = 9;
export const MAX_BOARD_SIDE = 10;
export const MAX_WHITE_CELLS = 28;

export function idx(board: { cols: number }, r: number, c: number): number {
  return r * board.cols + c;
}

export function rowOf(board: { cols: number }, i: number): number {
  return Math.floor(i / board.cols);
}

export function colOf(board: { cols: number }, i: number): number {
  return i % board.cols;
}

export function isWall(cell: Cell): cell is WallCell {
  return cell.type === 'wall';
}

export function isWhite(cell: Cell): cell is WhiteCell {
  return cell.type === 'white';
}

export function createBoard(rows: number, cols: number): Board {
  const cells: Cell[] = Array.from({ length: rows * cols }, () => ({
    type: 'wall',
    h: null,
    v: null
  }));
  return { rows, cols, cells };
}

export function cloneBoard(board: Board): Board {
  return {
    rows: board.rows,
    cols: board.cols,
    cells: board.cells.map((c) => ({ ...c }))
  };
}

export function whiteCount(board: Board): number {
  let n = 0;
  for (const c of board.cells) if (c.type === 'white') n++;
  return n;
}
