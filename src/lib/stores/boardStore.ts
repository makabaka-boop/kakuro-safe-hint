import { derived, get, writable } from 'svelte/store';
import type {
  Board,
  Cell
} from '../types.js';
import {
  cloneBoard,
  createBoard,
  idx,
  isWall,
  MAX_BOARD_SIDE
} from '../types.js';
import { validateBoard } from '../validation.js';
import type {
  SolveResult
} from '../solver.js';
import {
  maskToDigits,
  preparePuzzle,
  solve
} from '../solver.js';

export interface SerializedBoard {
  rows: number;
  cols: number;
  cells: Array<{ type: 'wall'; h: number | null; v: number | null } | { type: 'white' }>;
}

export function serialize(board: Board): SerializedBoard {
  return { rows: board.rows, cols: board.cols, cells: board.cells.map((c: Cell) => ({ ...c })) };
}

export function deserialize(data: unknown): Board {
  if (!data || typeof data !== 'object') throw new Error('数据不是有效的盘面 JSON');
  const b = data as Partial<SerializedBoard>;
  if (
    typeof b.rows !== 'number' ||
    typeof b.cols !== 'number' ||
    !Array.isArray(b.cells)
  ) {
    throw new Error('缺少 rows / cols / cells 字段');
  }
  if (b.cells.length !== b.rows * b.cols) throw new Error('cells 长度与尺寸不符');
  const cells: Cell[] = b.cells.map((c) => {
    if (!c || typeof c !== 'object' || (c.type !== 'wall' && c.type !== 'white')) {
      throw new Error('存在非法格子描述');
    }
    if (c.type === 'white') return { type: 'white' };
    const h = c.h === null || typeof c.h === 'number' ? c.h : null;
    const v = c.v === null || typeof c.v === 'number' ? c.v : null;
    return { type: 'wall', h, v };
  });
  return { rows: b.rows, cols: b.cols, cells };
}

/** 可撤销的盘面仓库。 */
function createBoardStore() {
  const initial = createBoard(4, 4);
  const { subscribe, set } = writable<Board>(initial);
  const past: Board[] = [];
  const future: Board[] = [];
  const canUndoStore = writable(false);
  const canRedoStore = writable(false);

  const refreshFlags = () => {
    canUndoStore.set(past.length > 0);
    canRedoStore.set(future.length > 0);
  };

  const pushHistory = (snapshot: Board) => {
    past.push(snapshot);
    if (past.length > 200) past.shift();
    future.length = 0;
    refreshFlags();
  };

  const mutate = (fn: (draft: Board) => void) => {
    const current = get(boardStore);
    pushHistory(cloneBoard(current));
    const draft = cloneBoard(current);
    fn(draft);
    set(draft);
  };

  return {
    subscribe,
    canUndo: canUndoStore,
    canRedo: canRedoStore,
    set,
    mutate,
    replace(board: Board) {
      pushHistory(get(boardStore));
      set(cloneBoard(board));
    },
    undo() {
      const current = get({ subscribe });
      const prev = past.pop();
      if (!prev) return;
      future.push(current);
      set(prev);
      refreshFlags();
    },
    redo() {
      const current = get({ subscribe });
      const next = future.pop();
      if (!next) return;
      past.push(current);
      set(next);
      refreshFlags();
    },
    reset() {
      mutate((draft) => {
        draft.cells = createBoard(draft.rows, draft.cols).cells;
      });
    }
  };
}

export const boardStore = createBoardStore();
export const canUndo = boardStore.canUndo;
export const canRedo = boardStore.canRedo;

// ---------------------------------------------------------------------------
// 结构编辑操作
// ---------------------------------------------------------------------------

export function toggleCell(i: number): void {
  boardStore.mutate((draft) => {
    const cell = draft.cells[i];
    if (isWall(cell)) {
      draft.cells[i] = { type: 'white' };
    } else {
      draft.cells[i] = { type: 'wall', h: null, v: null };
    }
  });
}

export function setClue(i: number, dir: 'h' | 'v', raw: string): void {
  const trimmed = raw.trim();
  boardStore.mutate((draft) => {
    const cell = draft.cells[i];
    if (!isWall(cell)) return;
    cell[dir] = trimmed === '' ? null : Number(trimmed);
  });
}

export function resize(rows: number, cols: number): void {
  rows = Math.max(1, Math.min(MAX_BOARD_SIDE, Math.round(rows)));
  cols = Math.max(1, Math.min(MAX_BOARD_SIDE, Math.round(cols)));
  boardStore.mutate((draft) => {
    const next = createBoard(rows, cols);
    for (let r = 0; r < Math.min(rows, draft.rows); r++) {
      for (let c = 0; c < Math.min(cols, draft.cols); c++) {
        next.cells[idx(next, r, c)] = { ...draft.cells[idx(draft, r, c)] };
      }
    }
    draft.rows = rows;
    draft.cols = cols;
    draft.cells = next.cells;
  });
}

// ---------------------------------------------------------------------------
// 校验与求解（异步：求解期间 UI 不卡顿；盘面一变结论立即标记过期）
// ---------------------------------------------------------------------------

export interface AnalysisState {
  version: number;
  valid: boolean;
  issues: ReturnType<typeof validateBoard>['issues'];
  status: 'idle' | 'running' | 'done';
  result: SolveResult | null;
  /** 当前展示的结果是否对应最新盘面（任何修改后立即为 false）。 */
  stale: boolean;
  error?: string;
}

const INITIAL: AnalysisState = {
  version: 0,
  valid: false,
  issues: [],
  status: 'idle',
  result: null,
  stale: true
};

export const analysis = writable<AnalysisState>(INITIAL);

let runToken = 0;

/** 校验随盘面实时派生；求解只在点击“分析唯一性”时执行。 */
export const validation = derived(boardStore, ($board) => validateBoard($board));

boardStore.subscribe(($board) => {
  // 任何修改：版本号 +1，旧结论立即失效（stale=true）。
  const v = validateBoard($board);
  analysis.update((s) => ({
    ...s,
    version: s.version + 1,
    valid: v.ok,
    issues: v.issues,
    stale: true,
    status: 'idle',
    error: undefined
  }));
  runToken++;
});

export async function runAnalysis(): Promise<void> {
  const token = ++runToken;
  const board = get(boardStore);
  analysis.update((s) => ({ ...s, status: 'running', stale: false, result: null }));
  // 让出一帧，按钮状态先渲染。
  await new Promise((res) => setTimeout(res, 0));
  try {
    const prep = preparePuzzle(board);
    if ('error' in prep) {
      if (token !== runToken) return;
      analysis.update((s) => ({
        ...s,
        status: 'done',
        result: null,
        error: prep.error
      }));
      return;
    }
    const result = solve(prep);
    if (token !== runToken) return; // 期间盘面被修改，丢弃本次结果。
    analysis.update((s) => ({ ...s, status: 'done', result, stale: false }));
  } catch (e) {
    if (token !== runToken) return;
    analysis.update((s) => ({
      ...s,
      status: 'done',
      error: e instanceof Error ? e.message : String(e)
    }));
  }
}

export { maskToDigits };
