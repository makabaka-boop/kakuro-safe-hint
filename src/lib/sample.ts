import type { Board } from './types.js';
import { createBoard, idx } from './types.js';

/**
 * 内置示例：4×3 盘面，2×2 白格块，唯一解。
 *
 *  W      W(↓4) W(↓3)
 *  W(3→)   1     2
 *  W(4→)   3     1
 *  W      W     W
 *
 * 唯一填法（行优先）：1,2,3,1。
 */
export const SAMPLE_BOARD: Board = (() => {
  const b = createBoard(4, 3);
  const setWall = (r: number, c: number, h: number | null, v: number | null) => {
    b.cells[idx(b, r, c)] = { type: 'wall', h, v };
  };
  setWall(0, 0, null, null);
  setWall(0, 1, null, 4);
  setWall(0, 2, null, 3);
  setWall(1, 0, 3, null);
  setWall(2, 0, 4, null);
  setWall(3, 0, null, null);
  setWall(3, 1, null, null);
  setWall(3, 2, null, null);
  b.cells[idx(b, 1, 1)] = { type: 'white' };
  b.cells[idx(b, 1, 2)] = { type: 'white' };
  b.cells[idx(b, 2, 1)] = { type: 'white' };
  b.cells[idx(b, 2, 2)] = { type: 'white' };
  return b;
})();
