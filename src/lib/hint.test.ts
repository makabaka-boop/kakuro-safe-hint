import { describe, expect, it } from 'vitest';
import type { Board, Cell, WallCell } from './types.js';
import { validateBoard } from './validation.js';
import { possibleSums } from './combinations.js';
import {
  DEFAULT_NODE_LIMIT,
  existsSolution,
  preparePuzzle,
  type PreparedPuzzle
} from './solver.js';
import {
  computeSafeHint,
  createSafeHintSession,
  fixedFromEntries,
  type ExistsOracle
} from './hint.js';

/**
 * “安全提示”测试。
 *
 * 与 solver.test.ts 相同的策略：另写一个**与求解器/提示实现完全独立**的朴素
 * 全枚举器，枚举与玩家已填数字相容的**全部**完整填法，逐格统计“所有解中
 * 出现过的数字集合”，作为安全提示的标准答案（不是前两份见证！）。
 */

// ---------------------------------------------------------------------------
// 独立朴素枚举器：收集全部解（数量 + 每格取值集合 + 前两份解）
// ---------------------------------------------------------------------------

function bruteForceProfiles(
  board: Board,
  fixed: ReadonlyArray<number | null>
): { count: number; masks: number[]; firstTwo: number[][] } {
  const v = validateBoard(board);
  if (!v.ok || !v.runs) throw new Error('board invalid');
  const whites = board.cells
    .map((c, i) => (c.type === 'white' ? i : -1))
    .filter((i) => i >= 0);
  const wiOf = new Map<number, number>();
  whites.forEach((cell, wi) => wiOf.set(cell, wi));
  const runs = v.runs.runs;

  for (const cell of whites) {
    const d = fixed[cell];
    if (d !== null && d !== undefined && (d < 1 || d > 9)) {
      throw new Error('bad fixed digit');
    }
  }

  const closesAt: number[][] = whites.map(() => []);
  for (const run of runs) {
    const last = run.cells[run.cells.length - 1];
    closesAt[wiOf.get(last)!].push(runs.indexOf(run));
  }
  const cellsOfRun = runs.map((run) => run.cells.map((cell) => wiOf.get(cell)!));

  const assign = new Array<number>(whites.length).fill(0);
  let count = 0;
  const masks = new Array<number>(whites.length).fill(0);
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
      for (let k = 0; k < assign.length; k++) masks[k] |= 1 << assign[k];
      return;
    }
    const forced = fixed[whites[wi]];
    const digits = forced === null || forced === undefined ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [forced];
    for (const d of digits) {
      assign[wi] = d;
      if (checkClosed(wi)) rec(wi + 1);
    }
    assign[wi] = 0;
  };
  rec(0);
  return { count, masks, firstTwo };
}

function popcount(x: number): number {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

/** 朴素全枚举给出的“标准安全提示”。 */
function bruteHint(
  board: Board,
  fixed: ReadonlyArray<number | null>,
  profile: { count: number; masks: number[] }
): { status: 'contradiction' | 'hint' | 'no-clue'; cell: number | null; digit: number | null } {
  if (profile.count === 0) return { status: 'contradiction', cell: null, digit: null };
  const whites = board.cells
    .map((c, i) => (c.type === 'white' ? i : -1))
    .filter((i) => i >= 0);
  for (let wi = 0; wi < whites.length; wi++) {
    const cell = whites[wi];
    if (fixed[cell] !== null && fixed[cell] !== undefined) continue;
    if (popcount(profile.masks[wi]) === 1) {
      return { status: 'hint', cell, digit: 31 - Math.clz32(profile.masks[wi]) };
    }
  }
  return { status: 'no-clue', cell: null, digit: null };
}

// ---------------------------------------------------------------------------
// 盘面构造辅助（与 solver.test.ts 相互独立的本地副本）
// ---------------------------------------------------------------------------

function wallCells(n: number): Cell[] {
  return Array.from({ length: n }, () => ({ type: 'wall', h: null, v: null }));
}

function block2x2([h1, h2, v1, v2]: number[]): Board {
  const board: Board = { rows: 4, cols: 3, cells: wallCells(12) };
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

function block2x3([h1, h2, v1, v2, v3]: number[]): Board {
  const board: Board = { rows: 4, cols: 4, cells: wallCells(16) };
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

/** 非矩形阶梯盘（7 白格），定义同 solver.test.ts。 */
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

function emptyFixed(board: Board): Array<number | null> {
  return board.cells.map(() => null);
}

function withDigit(board: Board, r: number, c: number, d: number | null): Array<number | null> {
  const f = emptyFixed(board);
  f[r * board.cols + c] = d;
  return f;
}

function expectMatchesBrute(board: Board, fixed: Array<number | null>): void {
  const prep = preparePuzzle(board);
  if ('error' in prep) throw new Error(prep.error);
  const hint = computeSafeHint(prep, fixed);
  const profile = bruteForceProfiles(board, fixed);
  const truth = bruteHint(board, fixed, profile);
  expect(hint.status, `应与全枚举一致（解数 ${profile.count}）`).toBe(truth.status);
  expect(hint.cell).toBe(truth.cell);
  expect(hint.digit).toBe(truth.digit);
  // 大节点预算下，小盘面绝不允许报未知。
  expect(hint.status).not.toBe('unknown');
}

// ---------------------------------------------------------------------------
// 独立穷举对拍
// ---------------------------------------------------------------------------

describe('安全提示 × 独立穷举对拍（2×2 块，无已填数字）', () => {
  const sums = [3, 4, 5, 10, 15, 16, 17];
  const cases: number[][] = [];
  for (const h1 of sums)
    for (const h2 of sums)
      for (const v1 of sums)
        for (const v2 of sums) cases.push([h1, h2, v1, v2]);

  it(`${cases.length} 个线索组合：矛盾/提示格/数字/暂无线索全部一致`, () => {
    let classes = { contradiction: 0, hint: 0, 'no-clue': 0 };
    for (const clues of cases) {
      const board = block2x2(clues);
      const fixed = emptyFixed(board);
      const profile = bruteForceProfiles(board, fixed);
      const truth = bruteHint(board, fixed, profile);
      classes[truth.status]++;
      expectMatchesBrute(board, fixed);
    }
    // 防呆：三类都必须真实出现。
    expect(classes.contradiction).toBeGreaterThan(0);
    expect(classes.hint).toBeGreaterThan(0);
    expect(classes['no-clue']).toBeGreaterThan(0);
  }, 60000);
});

describe('安全提示 × 独立穷举对拍（带玩家已填数字）', () => {
  const sums = [3, 4, 5, 16, 17];
  const cases: number[][] = [];
  for (const h1 of sums)
    for (const h2 of sums)
      for (const v1 of sums)
        for (const v2 of sums) cases.push([h1, h2, v1, v2]);

  // a=(1,1), b=(1,2)：含空格、单子固定、双字固定、明显非法、边界值 9。
  const fillings: Array<(b: Board) => Array<number | null>> = [
    (b) => withDigit(b, 1, 1, 1),
    (b) => withDigit(b, 1, 1, 9),
    (b) => withDigit(b, 1, 1, 5),
    (b) => {
      const f = withDigit(b, 1, 1, 1);
      f[1 * 3 + 2] = 2;
      return f;
    },
    (b) => {
      const f = withDigit(b, 1, 1, 8);
      f[1 * 3 + 2] = 9;
      return f;
    }
  ];

  it(`${cases.length} 个组合 × ${fillings.length} 种填法全部一致`, () => {
    let classes = { contradiction: 0, hint: 0, 'no-clue': 0 };
    for (const clues of cases) {
      for (const fill of fillings) {
        const board = block2x2(clues);
        const fixed = fill(board);
        const profile = bruteForceProfiles(board, fixed);
        classes[bruteHint(board, fixed, profile).status]++;
        expectMatchesBrute(board, fixed);
      }
    }
    expect(classes.contradiction).toBeGreaterThan(0);
    expect(classes.hint).toBeGreaterThan(0);
  }, 60000);
});

describe('安全提示 × 独立穷举对拍（2×3 块，抽样）', () => {
  const hSums = possibleSums(3).filter((s) => [6, 15, 24].includes(s));
  const vSums = possibleSums(2).filter((s) => [3, 10, 17].includes(s));
  const cases: number[][] = [];
  for (const h1 of hSums)
    for (const h2 of hSums)
      for (const v1 of vSums)
        for (const v2 of vSums)
          for (const v3 of vSums) cases.push([h1, h2, v1, v2, v3]);

  const fillings: Array<(b: Board) => Array<number | null>> = [
    (b) => emptyFixed(b),
    (b) => withDigit(b, 1, 1, 1),
    (b) => withDigit(b, 1, 1, 9),
    (b) => withDigit(b, 2, 1, 1),
    (b) => {
      const f = withDigit(b, 1, 1, 1);
      f[2 * 4 + 1] = 2;
      return f;
    }
  ];

  it(`${cases.length} 个组合 × ${fillings.length} 种填法全部一致`, () => {
    for (const clues of cases) {
      for (const fill of fillings) {
        const board = block2x3(clues);
        expectMatchesBrute(board, fill(board));
      }
    }
  }, 60000);
});

describe('安全提示 × 独立穷举对拍（7 白格阶梯盘，抽样）', () => {
  const len2 = possibleSums(2).filter((s) => [3, 10, 17].includes(s));
  const len3 = possibleSums(3).filter((s) => [6, 15, 24].includes(s));

  it('抽样组合 × 两种填法全部一致', () => {
    let checked = 0;
    for (const h1 of len2)
      for (const h3 of len2)
        for (const h2 of len3)
          for (const v1 of len2)
            for (const v3 of len2)
              for (const v2 of len3) {
                const board = staircaseBoard([h1, h2, h3, v1, v2, v3]);
                if (!validateBoard(board).ok) continue;
                expectMatchesBrute(board, emptyFixed(board));
                expectMatchesBrute(board, withDigit(board, 1, 1, 1));
                checked++;
              }
    expect(checked).toBeGreaterThan(0);
  }, 60000);
});

// ---------------------------------------------------------------------------
// 多解场景：不得用前两份见证冒充“所有解”
// ---------------------------------------------------------------------------

describe('多解盘面', () => {
  it('[3,7,3,7] 恰有两解且每格都取值不同 => 无已填时暂无线索', () => {
    // 解：[1,2,2,5] 与 [2,1,1,6]。
    const board = block2x2([3, 7, 3, 7]);
    const profile = bruteForceProfiles(board, emptyFixed(board));
    expect(profile.count).toBe(2);
    profile.masks.forEach((m) => expect(popcount(m)).toBeGreaterThan(1));

    const prep = preparePuzzle(board);
    if ('error' in prep) throw new Error(prep.error);
    const hint = computeSafeHint(prep, emptyFixed(board));
    expect(hint.status).toBe('no-clue');
    expect(hint.cell).toBeNull();
  });

  it('玩家填入 a=1 后只剩一份延伸解 => 首个未填格 b 必为 2', () => {
    const board = block2x2([3, 7, 3, 7]);
    const entries = board.cells.map(() => '');
    entries[1 * 3 + 1] = '1'; // a

    const session = createSafeHintSession();
    const result = session.request(board, entries);
    expect(result.status).toBe('hint');
    expect(result.cell).toBe(1 * 3 + 2); // b
    expect(result.digit).toBe(2);
    expect(session.state.stale).toBe(false);

    // 确认后才写入；页面拿到 {cell, digit} 自己更新 entries。
    const apply = session.confirm();
    expect(apply).toEqual({ cell: 1 * 3 + 2, digit: 2 });
    expect(session.state.result).toBeNull();
  });

  it('陷阱盘：前两份字典序解在某格相同、但第三份不同——提示不得在该格下结论', () => {
    // 在 2×3 抽样空间里程序化寻找“前两解一致但非所有解一致”的格子。
    const hSums = possibleSums(3).filter((s) => [6, 15, 24].includes(s));
    const vSums = possibleSums(2).filter((s) => [3, 10, 17].includes(s));
    const trap: { board: Board; wi: number; count: number }[] = [];
    for (const h1 of hSums)
      for (const h2 of hSums)
        for (const v1 of vSums)
          for (const v2 of vSums)
            for (const v3 of vSums) {
              const board = block2x3([h1, h2, v1, v2, v3]);
              const profile = bruteForceProfiles(board, emptyFixed(board));
              if (profile.count < 3 || profile.firstTwo.length < 2) continue;
              for (let wi = 0; wi < profile.masks.length; wi++) {
                if (
                  profile.firstTwo[0][wi] === profile.firstTwo[1][wi] &&
                  popcount(profile.masks[wi]) > 1
                ) {
                  trap.push({ board, wi, count: profile.count });
                  break;
                }
              }
            }
    // 抽样空间里必须真的存在这种盘，测试本身才有意义。
    expect(trap.length).toBeGreaterThan(0);

    for (const { board } of trap) {
      const fixed = emptyFixed(board);
      const profile = bruteForceProfiles(board, fixed);
      const prep = preparePuzzle(board);
      if ('error' in prep) throw new Error(prep.error);
      const hint = computeSafeHint(prep, fixed);
      const truth = bruteHint(board, fixed, profile);

      // 行优先第一个“前两解一致”的格子绝不能被提示直接选中。
      let shortcutWi = -1;
      for (let wi = 0; wi < profile.masks.length; wi++) {
        if (profile.firstTwo[0][wi] === profile.firstTwo[1][wi]) {
          shortcutWi = wi;
          break;
        }
      }
      expect(shortcutWi).toBeGreaterThanOrEqual(0);
      const trapCell = prep.whiteCells[shortcutWi];
      expect(popcount(profile.masks[shortcutWi])).toBeGreaterThan(1);
      expect(hint.cell).not.toBe(trapCell);
      // 与全枚举真值一致。
      expect(hint.status).toBe(truth.status);
      expect(hint.cell).toBe(truth.cell);
      expect(hint.digit).toBe(truth.digit);
    }
  }, 60000);
});

// ---------------------------------------------------------------------------
// 矛盾：只提示，不清空玩家输入
// ---------------------------------------------------------------------------

describe('局面矛盾', () => {
  const board = block2x2([3, 4, 3, 4]); // 唯一解 [2,1,1,3]

  function entriesWith(r: number, c: number, d: string): string[] {
    const e = board.cells.map(() => '');
    e[r * 3 + c] = d;
    return e;
  }

  it('填了孤立看没问题但无法延伸的数字 => contradiction（不清空）', () => {
    const entries = entriesWith(1, 1, '1'); // 唯一解中 a=2
    const snapshot = entries.slice();
    const session = createSafeHintSession();
    const result = session.request(board, entries);
    expect(result.status).toBe('contradiction');
    expect(result.cell).toBeNull();
    expect(result.digit).toBeNull();
    // 控制器不触碰玩家输入。
    expect(entries).toEqual(snapshot);
    // 矛盾时没有可确认的填入动作。
    expect(session.confirm()).toBeNull();
  });

  it('同线重复 => contradiction', () => {
    const entries = board.cells.map(() => '');
    entries[1 * 3 + 1] = '1';
    entries[1 * 3 + 2] = '1';
    const session = createSafeHintSession();
    expect(session.request(board, entries).status).toBe('contradiction');
  });

  it('取值直接不在候选内（a=9）=> contradiction', () => {
    const session = createSafeHintSession();
    expect(session.request(board, entriesWith(1, 1, '9')).status).toBe('contradiction');
  });

  it('盘面本身无解 => contradiction 而非别的', () => {
    const unsat = block2x2([3, 3, 3, 5]);
    const session = createSafeHintSession();
    expect(session.request(unsat, unsat.cells.map(() => '')).status).toBe('contradiction');
  });
});

// ---------------------------------------------------------------------------
// 超限：未知就是未知，绝不当作不可能
// ---------------------------------------------------------------------------

describe('搜索超限', () => {
  it('existsSolution 触顶返回 limit，不武断为 unsat', () => {
    const board = block2x2([3, 3, 3, 3]); // 两个解，传播后不收敛
    const prep = preparePuzzle(board);
    if ('error' in prep) throw new Error(prep.error);

    // 预算 1：根节点 1 个，进入第一分支即触顶（第 2 个节点超限）。
    expect(existsSolution(prep, emptyFixed(board), 1).status).toBe('limit');
    expect(existsSolution(prep, emptyFixed(board), DEFAULT_NODE_LIMIT).status).toBe('sat');
    // 不可能的数字依旧由传播直接判定 unsat（节点 0，与预算无关）。
    expect(existsSolution(prep, withDigit(board, 1, 1, 5), 1).status).toBe('unsat');
  });

  it('computeSafeHint 预算为 0 => unknown，且不是矛盾/无线索', () => {
    const board = block2x2([3, 3, 3, 3]);
    const prep = preparePuzzle(board);
    if ('error' in prep) throw new Error(prep.error);
    const hint = computeSafeHint(prep, emptyFixed(board), 0);
    expect(hint.status).toBe('unknown');
    expect(hint.cell).toBeNull();
  });

  it('页面会话预算为 0 => unknown，且不允许确认填入', () => {
    const board = block2x2([3, 3, 3, 3]);
    const session = createSafeHintSession();
    const result = session.request(board, board.cells.map(() => ''), 0);
    expect(result.status).toBe('unknown');
    expect(session.confirm()).toBeNull();
  });

  // 真实求解器在小盘面（≤7 白格）上传播极强：不可行探活几乎全在传播阶段
  // 判死，因此“查到一半触顶”的编排路径用可注入的存在性预言机精确固定。
  function anyPrepared(): PreparedPuzzle {
    const prep = preparePuzzle(block2x2([3, 4, 3, 4]));
    if ('error' in prep) throw new Error(prep.error);
    return prep;
  }

  /** 按“首个被固定的白格 + 数字”回答的脚本预言机。 */
  function scriptedOracle(
    base: 'sat' | 'unsat' | 'limit',
    probes: Record<number, 'sat' | 'unsat' | 'limit'>
  ): ExistsOracle {
    return (_p, fixed) => {
      for (let i = 0; i < fixed.length; i++) {
        const d = fixed[i];
        if (d !== null && d !== undefined) {
          // 只有一个固定点（脚本只用于单格探活）。
          return { status: probes[d as number] ?? 'unsat', nodes: 1 };
        }
      }
      return { status: base, nodes: 1 };
    };
  }

  it('整体存在性触顶 => unknown（不进入逐格判定）', () => {
    const prep = anyPrepared();
    let calls = 0;
    const oracle: ExistsOracle = () => {
      calls++;
      return { status: 'limit', nodes: 1 };
    };
    const hint = computeSafeHint(prep, emptyFixed(prep.board), 1, oracle);
    expect(hint.status).toBe('unknown');
    expect(calls).toBe(1);
  });

  it('局面有解、首格某数字未查完：不得把该候选当不可能，整体 unknown', () => {
    const prep = anyPrepared();
    // 3 已确认可行；2 触顶未知——绝不能只凭 3 报“必为 3”。
    const hint = computeSafeHint(
      prep,
      emptyFixed(prep.board),
      1,
      scriptedOracle('sat', { 1: 'unsat', 2: 'limit', 3: 'sat' })
    );
    expect(hint.status).toBe('unknown');
    expect(hint.cell).toBeNull();
  });

  it('已证明两个可行数字后即便之前有查询触顶，本格仍可判非单值并继续', () => {
    const prep = anyPrepared();
    const cells = prep.whiteCells;
    // 首格：1 触顶、2/3 可行（非单值，跳过）；次格：仅 4 可行且全部查完 => 提示。
    const oracle: ExistsOracle = (_p, fixed) => {
      for (let k = 0; k < fixed.length; k++) {
        const d = fixed[k];
        if (d === null || d === undefined) continue;
        const wi = cells.indexOf(k);
        if (wi === 0) {
          const ans: Record<number, 'sat' | 'unsat' | 'limit'> = {
            1: 'limit',
            2: 'sat',
            3: 'sat'
          };
          return { status: ans[d as number] ?? 'unsat', nodes: 1 };
        }
        if (wi === 1) {
          return { status: d === 4 ? 'sat' : 'unsat', nodes: 1 };
        }
        return { status: 'sat', nodes: 1 };
      }
      return { status: 'sat', nodes: 1 };
    };
    const hint = computeSafeHint(prep, emptyFixed(prep.board), 1, oracle);
    expect(hint.status).toBe('hint');
    expect(hint.cell).toBe(cells[1]);
    expect(hint.digit).toBe(4);
  });

  it('已填格变化不重新探活：固定格被跳过，首格不可定论时直接 unknown', () => {
    const prep = anyPrepared();
    const cells = prep.whiteCells;
    // 玩家已填首格；次格 1 触顶、2 可行（不能断定单值）。
    const fixed = emptyFixed(prep.board);
    fixed[cells[0]] = 7;
    const oracle: ExistsOracle = (_p, f) => {
      const fixedPoints: { k: number; d: number }[] = [];
      for (let k = 0; k < f.length; k++) {
        if (f[k] !== null && f[k] !== undefined) fixedPoints.push({ k, d: f[k] as number });
      }
      if (fixedPoints.length === 0) return { status: 'sat', nodes: 1 };
      // 整体查询带玩家的固定值 => 有解；探活查询再带次格数字。
      if (fixedPoints.length === 1 && fixedPoints[0].k === cells[0]) {
        return { status: 'sat', nodes: 1 };
      }
      const probe = fixedPoints.find((x) => x.k === cells[1])!;
      return { status: probe.d === 1 ? 'limit' : probe.d === 2 ? 'sat' : 'unsat', nodes: 1 };
    };
    const hint = computeSafeHint(prep, fixed, 1, oracle);
    expect(hint.status).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// 编辑后失效
// ---------------------------------------------------------------------------

describe('编辑后旧提示立即失效', () => {
  const board = block2x2([3, 4, 3, 4]); // 唯一解 [2,1,1,3]
  const a = 1 * 3 + 1;

  it('修改任一已填数字 => stale，且不能再确认', () => {
    const entries = board.cells.map(() => '');
    const session = createSafeHintSession();
    const result = session.request(board, entries);
    expect(result.status).toBe('hint');
    expect(session.state.stale).toBe(false);

    // 模拟页面反应：玩家在任意格输入（包括与提示无关的格）。
    entries[a] = '9';
    session.invalidate();
    expect(session.state.stale).toBe(true);
    expect(session.state.result).toBe(result); // 旧结果保留但失效
    expect(session.confirm()).toBeNull();
  });

  it('棋盘/线索变化 => stale；重新请求后得到新结果', () => {
    const session = createSafeHintSession();
    session.request(board, board.cells.map(() => ''));
    session.invalidate();
    expect(session.state.stale).toBe(true);

    // 换成矛盾盘（线索变化）：旧提示必须作废，新结论以新盘为准。
    const other = block2x2([3, 3, 3, 5]);
    const next = session.request(other, other.cells.map(() => ''));
    expect(session.state.stale).toBe(false);
    expect(next.status).toBe('contradiction');
  });

  it('失效后再编辑不会“复活”；dismiss 后 invalidate 为 no-op', () => {
    const session = createSafeHintSession();
    session.request(board, board.cells.map(() => ''));
    session.invalidate();
    session.invalidate(); // 幂等
    expect(session.state.stale).toBe(true);

    session.dismiss();
    expect(session.state.result).toBeNull();
    session.invalidate(); // 无提示时不产生状态
    expect(session.state.result).toBeNull();
  });

  it('确认填入后提示被消费，后续失效反应为空操作', () => {
    const entries = board.cells.map(() => '');
    const session = createSafeHintSession();
    const result = session.request(board, entries);
    expect(result.cell).toBe(a);
    expect(result.digit).toBe(2);

    // 页面 confirmHint：先拿 {cell,digit}，写入 entries，再触发一次失效反应。
    const apply = session.confirm();
    expect(apply).toEqual({ cell: a, digit: 2 });
    if (apply) entries[apply.cell] = String(apply.digit);
    session.invalidate(); // 对应 $: board, entries 的反应
    expect(session.state.result).toBeNull();
    expect(entries[a]).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// entries 转换
// ---------------------------------------------------------------------------

describe('fixedFromEntries', () => {
  it('仅接受 1～9 单字符，其余视为未填', () => {
    expect(fixedFromEntries(['', '1', '9', '0', '12', 'x'], 6)).toEqual([
      null,
      1,
      9,
      null,
      null,
      null
    ]);
  });
});
