import type { Board, Cell, WallCell } from '../types.js';

/**
 * 测试专用盘面构造器（仅被 *.test.ts 引用，不进入应用包）。
 * 布局与 solver.test.ts 中的构造器一致。
 */

export function wallCells(n: number): Cell[] {
  return Array.from({ length: n }, () => ({ type: 'wall', h: null, v: null }));
}

/** 4×3 盘面：2×2 白格块。线索顺序 [H1,H2,V1,V2]。
 *
 *  W     W(V1) W(V2)
 *  W(H1)  a     b
 *  W(H2)  c     d
 *  W     W     W
 */
export function block2x2([h1, h2, v1, v2]: number[]): Board {
  const board: Board = {
    rows: 4,
    cols: 3,
    cells: wallCells(12)
  };
  const W = (r: number, c: number): WallCell => board.cells[r * 3 + c] as WallCell;
  W(0, 1).v = v1;
  W(0, 2).v = v2;
  W(1, 0).h = h1;
  W(2, 0).h = h2;
  board.cells[1 * 3 + 1] = { type: 'white' };
  board.cells[1 * 3 + 2] = { type: 'white' };
  board.cells[2 * 3 + 1] = { type: 'white' };
  board.cells[2 * 3 + 2] = { type: 'white' };
  return board;
}

/** 4×4 盘面：2 行 × 3 列白格块（6 白格）。线索 [H1,H2,V1,V2,V3]。
 *
 *  W  W(V1) W(V2) W(V3)
 *  W(H1) a  b  c
 *  W(H2) d  e  f
 *  W  W  W  W
 */
export function block2x3([h1, h2, v1, v2, v3]: number[]): Board {
  const board: Board = {
    rows: 4,
    cols: 4,
    cells: wallCells(16)
  };
  const W = (r: number, c: number): WallCell => board.cells[r * 4 + c] as WallCell;
  [v1, v2, v3].forEach((v, k) => {
    W(0, k + 1).v = v;
  });
  W(1, 0).h = h1;
  W(2, 0).h = h2;
  for (const [r, c] of [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 1],
    [2, 2],
    [2, 3]
  ]) {
    board.cells[r * 4 + c] = { type: 'white' };
  }
  return board;
}
