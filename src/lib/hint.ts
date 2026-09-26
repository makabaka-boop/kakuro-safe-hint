import type { Board } from './types.js';
import { MAX_DIGIT, MIN_DIGIT } from './types.js';
import {
  DEFAULT_NODE_LIMIT,
  existsSolution,
  preparePuzzle,
  type PreparedPuzzle
} from './solver.js';

/**
 * “安全提示”：
 *  1. 把玩家当前已填数字当作固定条件，先查是否还存在完整合法填法；
 *  2. 若无解 => contradiction（只提示矛盾，绝不清空玩家输入）；
 *  3. 若有解 => 对每个未填白格（行优先）逐数字做存在性查询，
 *     返回行优先第一个“所有可行填法都取同一数字”的格子；
 *     不能用唯一性分析的前两份见证冒充“所有解”——每个数字都是独立的
 *     存在性查询；
 *  4. 任一查询触及节点上限 => unknown（未知），绝不把没查完的候选当作不可能；
 *  5. 所有格子都查完仍无这种格子 => 'no-clue'，明确告知暂无线索。
 */

export type SafeHintStatus = 'contradiction' | 'hint' | 'no-clue' | 'unknown';

export interface SafeHint {
  status: SafeHintStatus;
  /** 仅 status==='hint' 时有效：目标格（棋盘格索引）。 */
  cell: number | null;
  /** 仅 status==='hint' 时有效：该格在所有可行填法中共同取的数字。 */
  digit: number | null;
  /** 全部存在性查询累计消耗的搜索节点数（透明展示用）。 */
  nodes: number;
}

/** 把谜题页 entries（'' 为空）转成按棋盘格索引的固定值数组。 */
export function fixedFromEntries(
  entries: ReadonlyArray<string>,
  length: number
): Array<number | null> {
  const fixed: Array<number | null> = new Array(length).fill(null);
  for (let i = 0; i < length && i < entries.length; i++) {
    const raw = entries[i];
    if (raw && /^[1-9]$/.test(raw)) fixed[i] = Number(raw);
  }
  return fixed;
}

/** 单个 (格, 数字) 候选的存在性查询：sat=可延伸为完整填法，limit=未查完。 */
export type ExistsOracle = (
  p: PreparedPuzzle,
  fixed: ReadonlyArray<number | null | undefined>,
  nodeLimit: number
) => { status: 'sat' | 'unsat' | 'limit'; nodes: number };

export function computeSafeHint(
  p: PreparedPuzzle,
  fixed: ReadonlyArray<number | null>,
  nodeLimit: number = DEFAULT_NODE_LIMIT,
  /**
   * 存在性查询入口（默认就是 solver 的回溯引擎；页面始终用真实引擎）。
   * 抽出参数只是为了让“查询触顶时如何编排后续判定”这一逻辑可被单测精确固定：
   * 无论真实求解器还是测试桩，编排规则必须一致——触顶即未知。
   */
  exists: ExistsOracle = existsSolution
): SafeHint {
  let nodes = 0;

  // 第 0 步：当前局面整体是否还可延伸为完整填法。
  const base = exists(p, fixed, nodeLimit);
  nodes += base.nodes;
  if (base.status === 'limit') {
    return { status: 'unknown', cell: null, digit: null, nodes };
  }
  if (base.status === 'unsat') {
    return { status: 'contradiction', cell: null, digit: null, nodes };
  }

  // whiteCells 已按行优先排列；已填格固定，不是提示目标。
  for (const cell of p.whiteCells) {
    if (fixed[cell] !== null && fixed[cell] !== undefined) continue;

    let satCount = 0;
    let satDigit = -1;
    let unknown = false;

    for (let d = MIN_DIGIT; d <= MAX_DIGIT; d++) {
      const probe = fixed.slice();
      probe[cell] = d;
      const r = exists(p, probe, nodeLimit);
      nodes += r.nodes;
      if (r.status === 'limit') {
        // 该数字尚未查清：不能当作不可能，本格暂时无法定论。
        unknown = true;
        continue;
      }
      if (r.status === 'sat') {
        satCount++;
        if (satCount === 1) satDigit = d;
        // 已找到两个可行数字 => 本格必非单值，其余数字不必再查；
        // 即便之前有查询触顶，也不影响“本格不是单值”这一结论。
        if (satCount >= 2) break;
      }
    }

    if (satCount >= 2) continue;
    // 只有一个（或零个）可行数字、且存在未查清的候选 => 不能断定单值。
    if (unknown) return { status: 'unknown', cell: null, digit: null, nodes };
    if (satCount === 1) {
      return { status: 'hint', cell, digit: satDigit, nodes };
    }
    // 理论上不可达：整体有解则该格在任意一份填法中的取值必可行；
    // 若真发生说明求解结果自相矛盾，按未知处理（绝不武断下结论）。
    return { status: 'unknown', cell: null, digit: null, nodes };
  }

  return { status: 'no-clue', cell: null, digit: null, nodes };
}

// ---------------------------------------------------------------------------
// 页面状态会话：求解结果、提示文案状态与格子高亮共用同一份 SafeHint；
// 棋盘/线索/任一已填数字变化时调用 invalidate()，旧提示立即失效。
// 不依赖 DOM，可在 Vitest（node 环境）中直接对拍页面流程。
// ---------------------------------------------------------------------------

export interface HintSessionState {
  /** 最近一次安全提示结果；null 表示当前没有提示。 */
  result: SafeHint | null;
  /** 结果是否已因棋盘、线索或已填数字变化而失效。 */
  stale: boolean;
}

export interface SafeHintSession {
  readonly state: HintSessionState;
  /** 计算提示并取代旧结果；盘面非法时抛错（页面应在按钮上禁用）。 */
  request(board: Board, entries: ReadonlyArray<string>, nodeLimit?: number): SafeHint;
  /** 旧提示仍有效且确为可填提示时，返回待填入的 {cell, digit}；否则 null。 */
  confirm(): { cell: number; digit: number } | null;
  /** 棋盘、线索或任一已填数字变化：立即把旧提示标记失效（不丢弃展示）。 */
  invalidate(): void;
  /** 关闭提示面板。 */
  dismiss(): void;
}

export function createSafeHintSession(): SafeHintSession {
  let state: HintSessionState = { result: null, stale: false };

  const session: SafeHintSession = {
    get state() {
      return state;
    },

    request(board, entries, nodeLimit = DEFAULT_NODE_LIMIT) {
      const prep = preparePuzzle(board);
      if ('error' in prep) throw new Error(prep.error);
      const fixed = fixedFromEntries(entries, board.cells.length);
      const result = computeSafeHint(prep, fixed, nodeLimit);
      state = { result, stale: false };
      return result;
    },

    confirm() {
      const r = state.result;
      if (!r || state.stale || r.status !== 'hint' || r.cell === null || r.digit === null) {
        return null;
      }
      const cell = r.cell;
      const digit = r.digit;
      // 填入后提示即被消费；页面随后的 invalidate() 面对的是空状态。
      state = { result: null, stale: false };
      return { cell, digit };
    },

    invalidate() {
      if (state.result && !state.stale) {
        state = { ...state, stale: true };
      }
    },

    dismiss() {
      state = { result: null, stale: false };
    }
  };
  return session;
}
