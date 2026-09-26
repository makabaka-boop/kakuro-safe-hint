import type {
  Board,
  Cell,
  Run
} from './types.js';
import {
  MAX_BOARD_SIDE,
  MAX_RUN_LEN,
  MAX_SUM,
  MAX_WHITE_CELLS,
  MIN_RUN_LEN,
  MIN_SUM,
  colOf,
  idx,
  isWall,
  isWhite,
  rowOf,
  whiteCount
} from './types.js';

export type IssueCode =
  | 'EMPTY'
  | 'BAD_DIMENSIONS'
  | 'TOO_MANY_WHITES'
  | 'CLUE_RANGE'
  | 'DANGLING_H_CLUE'
  | 'DANGLING_V_CLUE'
  | 'RUN_TOO_SHORT'
  | 'RUN_TOO_LONG'
  | 'WHITE_NO_H_CLUE'
  | 'WHITE_NO_V_CLUE';

export interface Issue {
  code: IssueCode;
  /** 相关格（通常为一个）；为空表示整盘级问题。 */
  cell?: number;
  message: string;
}

export interface RunInfo {
  runs: Run[];
  /** 每个白格所属的横线索引/竖线索引（非白格为 undefined）。 */
  hRunOf: (number | undefined)[];
  vRunOf: (number | undefined)[];
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
  /** 仅当 ok 时可用：白格 -> 横线/竖线 的双向索引。 */
  runs?: RunInfo;
}

function clueInRange(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_SUM && n <= MAX_SUM;
}

function get(board: Board, r: number, c: number): Cell | undefined {
  if (r < 0 || r >= board.rows || c < 0 || c >= board.cols) return undefined;
  return board.cells[idx(board, r, c)];
}

interface SegCheck {
  seg: number[];
  /** 段首紧邻格（横线为左邻、竖线为上邻）。 */
  head: Cell | undefined;
  missingCode: IssueCode;
  danglingCode: IssueCode;
  label: string;
}

/**
 * 校验盘面。
 *
 * 关键要求：每个白格恰属一条横线与一条竖线。等价地：
 *  - 每个水平/竖直白格段几何长度 ∈ [2,6]；
 *  - 段首紧邻墙格携带合法的对应线索（横段看左邻 h，竖段看上邻 v）；
 *  - 携带线索的墙格必须真有紧邻白格（不允许悬空线索）。
 */
export function validateBoard(board: Board): ValidationResult {
  const issues: Issue[] = [];

  const dimsOk =
    Number.isInteger(board.rows) &&
    Number.isInteger(board.cols) &&
    board.rows >= 1 &&
    board.cols >= 1 &&
    board.rows <= MAX_BOARD_SIDE &&
    board.cols <= MAX_BOARD_SIDE &&
    board.cells.length === board.rows * board.cols;
  if (!dimsOk) {
    return {
      ok: false,
      issues: [
        {
          code: 'BAD_DIMENSIONS',
          message: `棋盘尺寸须为 1～${MAX_BOARD_SIDE} 的整数，且格子数与尺寸一致`
        }
      ]
    };
  }

  const whites = whiteCount(board);
  if (whites === 0) issues.push({ code: 'EMPTY', message: '盘面上没有白格' });
  if (whites > MAX_WHITE_CELLS) {
    issues.push({
      code: 'TOO_MANY_WHITES',
      message: `白格数 ${whites} 超过上限 ${MAX_WHITE_CELLS}`
    });
  }

  // 线索取值范围 + 悬空线索。
  board.cells.forEach((cell, i) => {
    if (!isWall(cell)) return;
    const r = rowOf(board, i);
    const c = colOf(board, i);
    if (cell.h !== null) {
      if (!clueInRange(cell.h)) {
        issues.push({
          code: 'CLUE_RANGE',
          cell: i,
          message: `横线索 ${cell.h} 不在 ${MIN_SUM}～${MAX_SUM} 整数范围内`
        });
      } else {
        const right = get(board, r, c + 1);
        if (!right || !isWhite(right)) {
          issues.push({
            code: 'DANGLING_H_CLUE',
            cell: i,
            message: '该墙格携带横线索，但右侧紧邻处没有白格'
          });
        }
      }
    }
    if (cell.v !== null) {
      if (!clueInRange(cell.v)) {
        issues.push({
          code: 'CLUE_RANGE',
          cell: i,
          message: `竖线索 ${cell.v} 不在 ${MIN_SUM}～${MAX_SUM} 整数范围内`
        });
      } else {
        const below = get(board, r + 1, c);
        if (!below || !isWhite(below)) {
          issues.push({
            code: 'DANGLING_V_CLUE',
            cell: i,
            message: '该墙格携带竖线索，但下方紧邻处没有白格'
          });
        }
      }
    }
  });

  const runs: Run[] = [];
  const hRunOf: (number | undefined)[] = new Array(board.cells.length).fill(undefined);
  const vRunOf: (number | undefined)[] = new Array(board.cells.length).fill(undefined);

  const checks: { dir: 'h' | 'v'; data: SegCheck }[] = [];

  // 水平扫描。
  for (let r = 0; r < board.rows; r++) {
    let c = 0;
    while (c < board.cols) {
      if (!isWhite(get(board, r, c)!)) {
        c++;
        continue;
      }
      const start = c;
      const seg: number[] = [];
      while (c < board.cols && isWhite(get(board, r, c)!)) {
        seg.push(idx(board, r, c));
        c++;
      }
      checks.push({
        dir: 'h',
        data: {
          seg,
          head: start === 0 ? undefined : get(board, r, start - 1),
          missingCode: 'WHITE_NO_H_CLUE',
          danglingCode: 'DANGLING_H_CLUE',
          label: '横线'
        }
      });
    }
  }

  // 竖直扫描。
  for (let c = 0; c < board.cols; c++) {
    let r = 0;
    while (r < board.rows) {
      if (!isWhite(get(board, r, c)!)) {
        r++;
        continue;
      }
      const start = r;
      const seg: number[] = [];
      while (r < board.rows && isWhite(get(board, r, c)!)) {
        seg.push(idx(board, r, c));
        r++;
      }
      checks.push({
        dir: 'v',
        data: {
          seg,
          head: start === 0 ? undefined : get(board, start - 1, c),
          missingCode: 'WHITE_NO_V_CLUE',
          danglingCode: 'DANGLING_V_CLUE',
          label: '竖线'
        }
      });
    }
  }

  for (const { dir, data } of checks) {
    const { seg, head, missingCode, label } = data;
    const len = seg.length;
    if (len < MIN_RUN_LEN) {
      issues.push({
        code: 'RUN_TOO_SHORT',
        cell: seg[0],
        message: `${label}长度 ${len} 小于最小长度 ${MIN_RUN_LEN}`
      });
      continue;
    }
    if (len > MAX_RUN_LEN) {
      issues.push({
        code: 'RUN_TOO_LONG',
        cell: seg[0],
        message: `${label}长度 ${len} 超过最大长度 ${MAX_RUN_LEN}`
      });
      continue;
    }
    const clueVal = dir === 'h'
      ? head && isWall(head) ? head.h : null
      : head && isWall(head) ? head.v : null;
    // 线索完全缺失才报 WHITE_NO_*；越界已由上方的 CLUE_RANGE 报过，不重复。
    if (clueVal === null) {
      issues.push({
        code: missingCode,
        cell: seg[0],
        message: `该白格所在${label}缺少 ${MIN_SUM}～${MAX_SUM} 的线索`
      });
      continue;
    }
    if (!clueInRange(clueVal)) continue;
    const ri = runs.length;
    runs.push({ dir, clue: clueVal, cells: seg });
    const runOf = dir === 'h' ? hRunOf : vRunOf;
    for (const i of seg) runOf[i] = ri;
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, issues: [], runs: { runs, hRunOf, vRunOf } };
}
