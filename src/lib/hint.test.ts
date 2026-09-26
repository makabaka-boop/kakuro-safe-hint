import { describe, expect, it } from 'vitest';
import type { Board } from './types.js';
import { validateBoard } from './validation.js';
import { solve } from './solver.js';
import { safeHint } from './hint.js';
import { block2x2, block2x3 } from './testing/testBoards.js';

/**
 * 独立穷举对拍器：把玩家已填数字作为固定条件，枚举**所有**完整合法填法，
 * 直接定义安全提示的期望行为：
 *  - 没有任何完整填法           → contradiction；
 *  - 行优先第一个“所有填法取值一致”的未填格 → hint（该格、该数字）；
 *  - 不存在这样的格子           → none。
 * 与 hint.ts 基于存在性查询的实现完全独立（朴素逐格枚举 + 闭合线校验）。
 */

type Entries = readonly (number | null)[];

type ExpectedHint =
  | { status: 'contradiction' }
  | { status: 'none' }
  | { status: 'hint'; cell: number; digit: number };

function bruteForceHint(board: Board, entries: Entries): ExpectedHint {
  const v = validateBoard(board);
  if (!v.ok || !v.runs) throw new Error('board invalid');
  const whites = board.cells
    .map((c, i) => (c.type === 'white' ? i : -1))
    .filter((i) => i >= 0);
  const wiOf = new Map<number, number>();
  whites.forEach((cell, wi) => wiOf.set(cell, wi));
  const runs = v.runs.runs;

  // 每个白格赋值后“至此刚好闭合”的线段，闭合即校验，尽早剪枝。
  const closesAt: number[][] = whites.map(() => []);
  runs.forEach((run, ri) => {
    closesAt[wiOf.get(run.cells[run.cells.length - 1])!].push(ri);
  });
  const cellsOfRun = runs.map((run) => run.cells.map((cell) => wiOf.get(cell)!));

  const assign = new Array<number>(whites.length).fill(0);
  let count = 0;
  const digitSets = whites.map(() => new Set<number>());

  const checkClosed = (wi: number): boolean => {
    for (const ri of closesAt[wi]) {
      let sum = 0;
      const seen = new Set<number>();
      for (const k of cellsOfRun[ri]) {
        const d = assign[k];
        if (seen.has(d)) return false;
        seen.add(d);
        sum += d;
      }
      if (sum !== runs[ri].clue) return false;
    }
    return true;
  };

  const rec = (wi: number): void => {
    if (wi === whites.length) {
      count++;
      assign.forEach((d, k) => digitSets[k].add(d));
      return;
    }
    const given = entries[whites[wi]];
    for (let d = 1; d <= 9; d++) {
      if (given !== null && given !== undefined && d !== given) continue;
      assign[wi] = d;
      if (checkClosed(wi)) rec(wi + 1);
    }
    assign[wi] = 0;
  };
  rec(0);

  if (count === 0) return { status: 'contradiction' };
  for (let wi = 0; wi < whites.length; wi++) {
    const cell = whites[wi];
    if (entries[cell] !== null && entries[cell] !== undefined) continue;
    if (digitSets[wi].size === 1) {
      return { status: 'hint', cell, digit: [...digitSets[wi]][0]! };
    }
  }
  return { status: 'none' };
}

const emptyEntries = (board: Board): (number | null)[] => board.cells.map(() => null);

function expectMatchesBruteForce(board: Board, entries: Entries): void {
  const expected = bruteForceHint(board, entries);
  const got = safeHint(board, entries);
  expect(got.status).toBe(expected.status);
  if (expected.status === 'hint') {
    expect(got.cell).toBe(expected.cell);
    expect(got.digit).toBe(expected.digit);
    // 提示的必须是未填格
    expect(entries[expected.cell!] ?? null).toBeNull();
  } else {
    expect(got.cell).toBeNull();
    expect(got.digit).toBeNull();
  }
}

// ---------------------------------------------------------------------------
// 手工构造的关键局面
// ---------------------------------------------------------------------------

describe('安全提示：关键局面', () => {
  it('唯一解盘面：提示行优先第一格的必然数字', () => {
    const board = block2x2([3, 4, 4, 3]); // 唯一解 [1,2,3,1]
    expect(solve(board).status).toBe('unique');
    const r = safeHint(board, emptyEntries(board));
    expect(r).toMatchObject({ status: 'hint', cell: 4, digit: 1 });
  });

  it('多解但某格被所有解强制：照常给出该格', () => {
    // 3 个解 [1,2,5,2,5,6] / [1,3,4,2,4,7] / [1,4,3,2,3,8]：a 恒为 1
    const board = block2x3([8, 13, 3, 7, 11]);
    expect(solve(board).status).toBe('multiple');
    const r = safeHint(board, emptyEntries(board));
    expect(r).toMatchObject({ status: 'hint', cell: 5, digit: 1 });
  });

  it('多解且无任何被强制的格子：明确“暂无线索”', () => {
    const board = block2x2([3, 3, 3, 3]); // 两个解 [1,2,2,1] / [2,1,1,2]
    expect(solve(board).status).toBe('multiple');
    expect(safeHint(board, emptyEntries(board)).status).toBe('none');
  });

  it('绝不拿前两份见证冒充所有解（陷阱盘）', () => {
    // 共 6 个解；字典序最小的两份见证在 a、d 上恰好一致，
    // 但其余解会改变它们 —— 实际上没有任何格被强制。
    const board = block2x3([6, 9, 5, 5, 5]);
    const s = solve(board);
    expect(s.status).toBe('multiple');
    const [w1, w2] = s.witnesses;
    // 防呆：前两份见证确实在某些格一致（“见证求交”会误判为强制）。
    const naiveForced = w1!.map((d, wi) => (d === w2![wi] ? wi : -1)).filter((wi) => wi >= 0);
    expect(naiveForced.length).toBeGreaterThan(0);
    expect(safeHint(board, emptyEntries(board)).status).toBe('none');
  });

  it('已填数字彼此冲突：报告矛盾，且不改动输入', () => {
    const board = block2x2([3, 4, 4, 3]); // 唯一解 [1,2,3,1]
    const entries = emptyEntries(board);
    entries[4] = 1;
    entries[5] = 1; // 同一横线两个 1
    expect(safeHint(board, entries).status).toBe('contradiction');
    expect(entries[4]).toBe(1);
    expect(entries[5]).toBe(1);
  });

  it('已填数字局部不冲突、但无法延伸为完整填法：同样报告矛盾', () => {
    const board = block2x2([3, 4, 4, 3]); // a 在唯一解中为 1
    const entries = emptyEntries(board);
    entries[4] = 2;
    expect(safeHint(board, entries).status).toBe('contradiction');
  });

  it('已填格不会被建议；部分填写后提示行优先下一个未填格', () => {
    const board = block2x2([3, 4, 4, 3]); // 唯一解 [1,2,3,1]
    const entries = emptyEntries(board);
    entries[4] = 1; // a 已填
    const r = safeHint(board, entries);
    expect(r).toMatchObject({ status: 'hint', cell: 5, digit: 2 });
  });

  it('全部填满且正确：没有可提示的格子（none）', () => {
    const board = block2x2([3, 4, 4, 3]);
    const entries = emptyEntries(board);
    entries[4] = 1;
    entries[5] = 2;
    entries[7] = 3;
    entries[8] = 1;
    expect(safeHint(board, entries).status).toBe('none');
  });

  it('全部填满但有错：矛盾', () => {
    const board = block2x2([3, 4, 4, 3]);
    const entries = emptyEntries(board);
    entries[4] = 1;
    entries[5] = 2;
    entries[7] = 3;
    entries[8] = 2; // d 应为 1
    expect(safeHint(board, entries).status).toBe('contradiction');
  });

  it('非法填写值（0、10 等）按未填处理', () => {
    const board = block2x2([3, 4, 4, 3]);
    const entries = emptyEntries(board);
    entries[4] = 0;
    entries[5] = 10;
    const r = safeHint(board, entries);
    expect(r).toMatchObject({ status: 'hint', cell: 4, digit: 1 });
  });
});

// ---------------------------------------------------------------------------
// 节点上限：未知 ≠ 不可能
// ---------------------------------------------------------------------------

describe('安全提示：搜索上限', () => {
  it('初始存在性查询触限：结果为未知', () => {
    const board = block2x2([3, 3, 3, 3]);
    expect(safeHint(board, emptyEntries(board), 1).status).toBe('unknown');
    // 同一局面给足预算能得到确定结论 —— “未知”绝不是“没有提示”。
    expect(safeHint(board, emptyEntries(board)).status).toBe('none');
  });

  it('任何节点上限下：结论要么未知，要么与充分预算一致（绝不把未查完的候选当作不可能）', () => {
    const board = block2x3([6, 9, 5, 5, 5]);
    const definitive = safeHint(board, emptyEntries(board));
    expect(definitive.status).toBe('none');
    let sawUnknown = false;
    for (let limit = 1; limit <= 300; limit++) {
      const r = safeHint(board, emptyEntries(board), limit);
      if (r.status === 'unknown') {
        sawUnknown = true;
        continue;
      }
      expect(r.status).toBe(definitive.status);
      expect(r.cell).toBe(definitive.cell);
      expect(r.digit).toBe(definitive.digit);
    }
    expect(sawUnknown).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 独立穷举对拍：批量盘面 × 批量填写状态
// ---------------------------------------------------------------------------

describe('独立穷举对拍（2×2 块 × 多种填写状态）', () => {
  const sums = [3, 4, 5, 10, 15, 16, 17];
  const clueSets: number[][] = [];
  for (const h1 of sums)
    for (const h2 of sums)
      for (const v1 of sums)
        for (const v2 of sums) clueSets.push([h1, h2, v1, v2]);

  it(`${clueSets.length} 个线索组合 × 空盘/单格/双格填写，全部一致`, () => {
    const statuses = new Set<string>();
    let checked = 0;
    for (const clues of clueSets) {
      const board = block2x2(clues);
      const whites = [4, 5, 7, 8];
      const patterns: (number | null)[][] = [emptyEntries(board)];
      // 单格填写（含与线索不兼容的值）
      for (const cell of whites)
        for (const d of [1, 5, 9]) {
          const e = emptyEntries(board);
          e[cell] = d;
          patterns.push(e);
        }
      // 双格填写（含同线重复等冲突组合）
      for (const [c1, d1, c2, d2] of [
        [4, 1, 5, 1],
        [4, 2, 7, 2],
        [5, 3, 8, 3],
        [4, 9, 8, 9],
        [7, 4, 8, 4]
      ] as const) {
        const e = emptyEntries(board);
        e[c1] = d1;
        e[c2] = d2;
        patterns.push(e);
      }
      for (const entries of patterns) {
        const got = safeHint(board, entries);
        expect(got.status).not.toBe('unknown'); // 小盘面充分预算下不应触限
        expectMatchesBruteForce(board, entries);
        statuses.add(got.status);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    // 防呆：三类结论在抽样中都真实出现，测试没有被架空。
    expect(statuses.has('contradiction')).toBe(true);
    expect(statuses.has('hint')).toBe(true);
    expect(statuses.has('none')).toBe(true);
  }, 60000);
});

describe('独立穷举对拍（2×3 块，抽样线索与填写）', () => {
  it('抽样组合全部一致', () => {
    const hSums = [6, 15, 24];
    const vSums = [3, 10, 17];
    const statuses = new Set<string>();
    let checked = 0;
    for (const h1 of hSums)
      for (const h2 of hSums)
        for (const v1 of vSums)
          for (const v2 of vSums)
            for (const v3 of vSums) {
              const board = block2x3([h1, h2, v1, v2, v3]);
              const whites = [5, 6, 7, 9, 10, 11];
              const patterns: (number | null)[][] = [emptyEntries(board)];
              for (const cell of whites)
                for (const d of [1, 9]) {
                  const e = emptyEntries(board);
                  e[cell] = d;
                  patterns.push(e);
                }
              for (const entries of patterns) {
                expectMatchesBruteForce(board, entries);
                statuses.add(safeHint(board, entries).status);
                checked++;
              }
            }
    expect(checked).toBeGreaterThan(0);
    expect(statuses.has('contradiction')).toBe(true);
    expect(statuses.has('hint')).toBe(true);
    expect(statuses.has('none')).toBe(true);
  }, 60000);
});
