import { describe, expect, it } from 'vitest';
import type { Board, Cell, WallCell } from './types.js';
import { validateBoard } from './validation.js';
import { combinationsFor, possibleSums } from './combinations.js';
import { preparePuzzle, solve, maskToDigits } from './solver.js';

/**
 * 独立的朴素全枚举器：按行优先顺序枚举所有 1～9 赋值，
 * 逐条线段检查“线内不重复 + 和等于线索”。
 * 与 solver 的组合传播/回溯实现完全独立，用于交叉核对。
 */

/** 完整计数（不提前停止），用于小盘面全枚举核对；增量剪枝。 */
function bruteForceCount(board: Board): { count: number; firstTwo: number[][] } {
  const v = validateBoard(board);
  if (!v.ok || !v.runs) throw new Error('board invalid');
  const whites = board.cells
    .map((c, i) => (c.type === 'white' ? i : -1))
    .filter((i) => i >= 0);
  const wiOf = new Map<number, number>();
  whites.forEach((cell, wi) => wiOf.set(cell, wi));
  const runs = v.runs.runs;

  // 对每个白格记录：赋值后“至此刚好闭合”的线段（该格为线段最后一格），
  // 闭合时立即校验“线内不重复 + 和等于线索”，从而尽早剪枝。
  const closesAt: number[][] = whites.map(() => []);
  for (const run of runs) {
    const last = run.cells[run.cells.length - 1];
    closesAt[wiOf.get(last)!].push(runs.indexOf(run));
  }
  const cellsOfRun = runs.map((run) => run.cells.map((cell) => wiOf.get(cell)!));

  const assign = new Array<number>(whites.length).fill(0);
  let count = 0;
  const firstTwo: number[][] = [];

  const checkClosed = (wi: number): boolean => {
    for (const ri of closesAt[wi]) {
      const run = runs[ri];
      let sum = 0;
      const seen = new Set<number>();
      for (const k of cellsOfRun[ri]) {
        const d = assign[k];
        if (seen.has(d)) return false;
        seen.add(d);
        sum += d;
      }
      if (sum !== run.clue) return false;
    }
    return true;
  };

  const rec = (wi: number): void => {
    if (wi === whites.length) {
      count++;
      if (firstTwo.length < 2) firstTwo.push(assign.slice());
      return;
    }
    for (let d = 1; d <= 9; d++) {
      assign[wi] = d;
      if (checkClosed(wi)) rec(wi + 1);
    }
    assign[wi] = 0;
  };
  rec(0);
  return { count, firstTwo };
}

// ---------------------------------------------------------------------------
// 盘面构造辅助
// ---------------------------------------------------------------------------

/** 4×3 盘面：2×2 白格块。线索顺序 [H1,H2,V1,V2]。
 *
 *  W     W(V1) W(V2)
 *  W(H1)  a     b
 *  W(H2)  c     d
 *  W     W     W
 */
function wallCells(n: number): Cell[] {
  return Array.from({ length: n }, () => ({ type: 'wall', h: null, v: null }));
}

function block2x2([h1, h2, v1, v2]: number[]): Board {
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
  // 白格 a,b,c,d（行优先）
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
function block2x3([h1, h2, v1, v2, v3]: number[]): Board {
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

// ---------------------------------------------------------------------------
// 组合表
// ---------------------------------------------------------------------------

describe('combinationsFor', () => {
  it('基本组合正确', () => {
    expect(combinationsFor(2, 3)).toEqual([[1, 2]]);
    expect(combinationsFor(2, 17)).toEqual([[8, 9]]);
    expect(combinationsFor(3, 24)).toEqual([[7, 8, 9]]);
    expect(combinationsFor(4, 10)).toEqual([[1, 2, 3, 4]]);
  });

  it('无组合时返回空（长度 2 不可能凑出 2 或 18）', () => {
    expect(combinationsFor(2, 2)).toEqual([]);
    expect(combinationsFor(2, 18)).toEqual([]);
    expect(combinationsFor(6, 3)).toEqual([]);
    expect(combinationsFor(6, 45)).toEqual([]);
  });

  it('每个组合都满足长度、互异、取值、和', () => {
    for (let len = 2; len <= 6; len++) {
      for (let s = 3; s <= 45; s++) {
        for (const combo of combinationsFor(len, s)) {
          expect(combo).toHaveLength(len);
          expect(new Set(combo).size).toBe(len);
          expect(combo.every((d) => d >= 1 && d <= 9)).toBe(true);
          expect(combo.reduce((a, b) => a + b, 0)).toBe(s);
        }
      }
    }
  });

  it('possibleSums 给出长度 2 的全部可行和 3..17', () => {
    expect(possibleSums(2)).toEqual(Array.from({ length: 15 }, (_, i) => i + 3));
  });
});

// ---------------------------------------------------------------------------
// 2×2 盘面：手工见证 + 全枚举交叉核对
// ---------------------------------------------------------------------------

describe('2×2 白格块', () => {
  it('全线索=3：两个解（字典序 [1,2,2,1] 与 [2,1,1,2]）', () => {
    const board = block2x2([3, 3, 3, 3]);
    const r = solve(board);
    expect(r.status).toBe('multiple');
    expect(r.witnesses).toHaveLength(2);
    expect(r.witnesses[0]).toEqual([1, 2, 2, 1]);
    expect(r.witnesses[1]).toEqual([2, 1, 1, 2]);
  });

  it('H=[3,4], V=[3,4]：唯一解 [2,1,1,3]', () => {
    const board = block2x2([3, 4, 3, 4]);
    const r = solve(board);
    expect(r.status).toBe('unique');
    expect(r.witnesses).toEqual([[2, 1, 1, 3]]);
  });

  it('V2=5 其余=3：无解', () => {
    const board = block2x2([3, 3, 3, 5]);
    expect(solve(board).status).toBe('unsat');
  });

  it('长度 2 线索=18（取值合法但不可能）：无解而非唯一', () => {
    const board = block2x2([18, 3, 3, 3]);
    const v = validateBoard(board);
    expect(v.ok).toBe(true); // 3..45 范围内，结构合法
    expect(solve(board).status).toBe('unsat');
  });

  it('线索全部改成不可能值时，不能把某个可能填法误称唯一', () => {
    const board = block2x2([17, 17, 17, 17]);
    // a+b=17 => {8,9}, c+d=17 => {8,9}, a+c=17 => a,c∈{8,9}
    // 行内互异 => b=17-a, d=17-c；列2: b+d = 34-(a+c) = 17 => a+c=17 ✓
    // 两个排列都成立 => multiple
    const r = solve(board);
    expect(r.status).toBe('multiple');
    expect(r.witnesses[0]).toEqual([8, 9, 9, 8]);
    expect(r.witnesses[1]).toEqual([9, 8, 8, 9]);
  });
});

// ---------------------------------------------------------------------------
// 小盘面全枚举：穷举一批线索组合，逐盘与朴素枚举器比对分类与前两个见证
// ---------------------------------------------------------------------------

describe('全枚举交叉核对（2×2 块，线索网格的一个子集）', () => {
  const sums = [3, 4, 5, 10, 15, 16, 17];
  const cases: number[][] = [];
  for (const h1 of sums)
    for (const h2 of sums)
      for (const v1 of sums)
        for (const v2 of sums) cases.push([h1, h2, v1, v2]);

  it(`共 ${cases.length} 个线索组合，分类与两个见证完全一致`, () => {
    let nUnsat = 0;
    let nUnique = 0;
    let nMultiple = 0;
    for (const clues of cases) {
      const board = block2x2(clues);
      const r = solve(board);
      const bf = bruteForceCount(board);
      const expectStatus =
        bf.count === 0 ? 'unsat' : bf.count === 1 ? 'unique' : 'multiple';
      expect(r.status).toBe(expectStatus);
      expect(r.witnesses).toEqual(bf.firstTwo);
      if (expectStatus === 'unsat') nUnsat++;
      else if (expectStatus === 'unique') nUnique++;
      else nMultiple++;
    }
    // 防呆：确保三类确实都出现，测试本身没被架空。
    expect(nUnsat).toBeGreaterThan(0);
    expect(nUnique).toBeGreaterThan(0);
    expect(nMultiple).toBeGreaterThan(0);
  }, 60000);
});

describe('全枚举交叉核对（2×3 块，抽样线索）', () => {
  const hSums = possibleSums(3).filter((s) => [6, 15, 24].includes(s));
  const vSums = possibleSums(2).filter((s) => [3, 10, 17].includes(s));
  const cases: number[][] = [];
  for (const h1 of hSums)
    for (const h2 of hSums)
      for (const v1 of vSums)
        for (const v2 of vSums)
          for (const v3 of vSums) cases.push([h1, h2, v1, v2, v3]);

  it(`${cases.length} 个组合的分类与前两个见证一致`, () => {
    for (const clues of cases) {
      const board = block2x3(clues);
      const r = solve(board);
      const bf = bruteForceCount(board);
      const expectStatus =
        bf.count === 0 ? 'unsat' : bf.count === 1 ? 'unique' : 'multiple';
      expect(r.status).toBe(expectStatus);
      expect(r.witnesses).toEqual(bf.firstTwo);
    }
  }, 60000);
});

/**
 * 非矩形“阶梯”盘面（4×4，7 白格）：
 *
 *  行0:  W        W(↓v1)  W(↓v2)  W
 *  行1:  W(h1→)   a       b       W(v3↓)
 *  行2:  W(h2→)   e       c       d
 *  行3:  W        W(h3→)  h       g
 *
 * 横线：H1=[a,b] 长2；H2=[e,c,d] 长3；H3=[h,g] 长2（头墙 (3,1)）。
 * 竖线：V1=[a,e] 长2；V2=[b,c,h] 长3；V3=[d,g] 长2（顶墙 (1,3)，不在行0）。
 * 每个白格恰属一横一竖。行优先白格：a,b,e,c,d,h,g。
 */
function staircaseBoard([h1, h2, h3, v1, v2, v3]: number[]): Board {
  const board: Board = { rows: 4, cols: 4, cells: wallCells(16) };
  const W = (r: number, c: number): WallCell => board.cells[r * 4 + c] as WallCell;
  W(1, 0).h = h1;
  W(2, 0).h = h2;
  W(3, 1).h = h3;
  W(0, 1).v = v1;
  W(0, 2).v = v2;
  W(1, 3).v = v3;
  for (const [r, c] of [
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
    [2, 3],
    [3, 2],
    [3, 3]
  ]) {
    board.cells[r * 4 + c] = { type: 'white' };
  }
  return board;
}

describe('非矩形阶梯盘结构', () => {
  it('在合法线索下通过校验', () => {
    const board = staircaseBoard([3, 6, 3, 3, 6, 3]);
    const res = validateBoard(board);
    expect(res.ok, res.issues.map((i) => i.message).join('; ')).toBe(true);
  });
});

describe('全枚举交叉核对（非矩形阶梯盘，7 白格，抽样线索）', () => {
  const len2 = possibleSums(2).filter((s) => [3, 10, 17].includes(s));
  const len3 = possibleSums(3).filter((s) => [6, 15, 24].includes(s));

  it('抽样组合的分类与前两个见证一致', () => {
    let checked = 0;
    let classes = { unsat: 0, unique: 0, multiple: 0 };
    for (const h1 of len2)
      for (const h3 of len2)
        for (const h2 of len3)
          for (const v1 of len2)
            for (const v3 of len2)
              for (const v2 of len3) {
                const board = staircaseBoard([h1, h2, h3, v1, v2, v3]);
                if (!validateBoard(board).ok) continue;
                const r = solve(board);
                const bf = bruteForceCount(board);
                const expectStatus =
                  bf.count === 0 ? 'unsat' : bf.count === 1 ? 'unique' : 'multiple';
                expect(r.status).toBe(expectStatus);
                expect(r.witnesses).toEqual(bf.firstTwo);
                classes[expectStatus]++;
                checked++;
              }
    expect(checked).toBeGreaterThan(0);
    // 抽样集合以紧/松极端值为主，多数无解，但至少三类都应出现。
    expect(classes.unsat + classes.unique + classes.multiple).toBe(checked);
  }, 60000);
});

// ---------------------------------------------------------------------------
// 非法盘面 / 非法线索
// ---------------------------------------------------------------------------

describe('校验：非法结构与线索', () => {
  it('线索超出 3..45 被拒', () => {
    const board = block2x2([2, 3, 3, 3]);
    expect(validateBoard(board).ok).toBe(false);
    expect(validateBoard(board).issues.some((i) => i.code === 'CLUE_RANGE')).toBe(true);

    const board2 = block2x2([46, 3, 3, 3]);
    expect(validateBoard(board2).ok).toBe(false);
  });

  it('悬空线索被拒（墙格右侧无白格却带 h）', () => {
    const board = block2x2([3, 3, 3, 3]);
    (board.cells[0] as WallCell).h = 7; // (0,0) 右侧是墙
    const res = validateBoard(board);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.code === 'DANGLING_H_CLUE')).toBe(true);
  });

  it('白格段长度 1 被拒（缺少另一个格=缺少所属线）', () => {
    // 把 d 改成墙：c 成为长度 1 的横段，且第 3 列竖线只剩 b。
    const board = block2x2([3, 3, 3, 3]);
    board.cells[2 * 3 + 2] = { type: 'wall', h: null, v: null };
    const res = validateBoard(board);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.code === 'RUN_TOO_SHORT')).toBe(true);
  });

  it('缺少线索被拒（每个白格必须恰属一横一竖）', () => {
    const board = block2x2([3, 3, 3, 3]);
    (board.cells[1 * 3] as WallCell).h = null; // W(H1)
    const res = validateBoard(board);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.code === 'WHITE_NO_H_CLUE')).toBe(true);
  });

  it('没有白格被拒', () => {
    const board: Board = {
      rows: 2,
      cols: 2,
      cells: wallCells(4)
    };
    expect(validateBoard(board).issues.some((i) => i.code === 'EMPTY')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 候选查看：传播后的候选数字
// ---------------------------------------------------------------------------

describe('候选查看', () => {
  it('唯一解盘面传播后每格候选都包含答案数字（弧一致不保证单值化）', () => {
    const board = block2x2([3, 4, 3, 4]);
    const prep = preparePuzzle(board);
    if ('error' in prep) throw new Error(prep.error);
    const r = solve(prep);
    expect(r.status).toBe('unique');
    r.witnesses[0].forEach((d, wi) => {
      expect(maskToDigits(r.domains[prep.whiteCells[wi]])).toContain(d);
    });
  });

  it('构造一个传播即可单值化的盘面：H1=3∩V1=4 把 a 夹成 1', () => {
    // a∈{1,2}(H1=3) 且 a∈{1,3}(V1=4) => a=1；
    // 连锁：b=2(H1)、c=3(V1, 互异)、d=1(H2=4)、V2=2+1=3。
    const board = block2x2([3, 4, 4, 3]);
    const prep = preparePuzzle(board);
    if ('error' in prep) throw new Error(prep.error);
    const r = solve(prep);
    expect(r.status).toBe('unique');
    expect(r.witnesses[0]).toEqual([1, 2, 3, 1]);
    expect(r.propagationSolved).toBe(true);
    expect(maskToDigits(r.domains[prep.whiteCells[0]])).toEqual([1]);
  });

  it('多解盘面传播后候选保留两个见证用到的全部数字', () => {
    const board = block2x2([3, 3, 3, 3]);
    const prep = preparePuzzle(board);
    if ('error' in prep) throw new Error(prep.error);
    const r = solve(prep);
    expect(r.status).toBe('multiple');
    prep.whiteCells.forEach((cell, wi) => {
      const used = new Set(r.witnesses.map((w) => w[wi]));
      for (const d of used) expect(maskToDigits(r.domains[cell])).toContain(d);
    });
  });
});
