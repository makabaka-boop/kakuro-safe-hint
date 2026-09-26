import { combinationsFor } from './combinations.js';
import type {
  Board,
  Run
} from './types.js';
import {
  MAX_DIGIT,
  MIN_DIGIT,
  isWhite
} from './types.js';
import type { RunInfo } from './validation.js';
import { validateBoard } from './validation.js';

/**
 * 求解器：
 *  1. 候选组合（一条线段 = 互异数字之和为线索的组合）+ 二分图匹配判定
 *     “某格还能不能放某个数字”，做队列式约束传播；
 *  2. 回溯时严格按行优先顺序、数字从小到大分支 —— 因此找到的前两个解
 *     恰好就是行优先字典序最小的两份完整填法；
 *  3. 一旦找到第二个解立即停止（status: 'multiple'）。
 */

export type SolveStatus = 'unsat' | 'unique' | 'multiple' | 'limit';

export interface SolveResult {
  status: SolveStatus;
  /** 至多两份见证填法；长度 = 白格总数（行优先），值为 1～9。 */
  witnesses: number[][];
  /**
   * 初始传播结束后每格剩余候选的位掩码（第 d 位表示数字 d）；
   * 墙格为 0。无解时为传播到矛盾前的最后状态（可能含 0 掩码格）。
   */
  domains: number[];
  /** 传播是否独立收敛为单值。 */
  propagationSolved: boolean;
  nodes: number;
}

export const DIGIT_MASK_ALL = ((1 << (MAX_DIGIT + 1)) - 1) & ~1; // 位 1..9

export const DEFAULT_NODE_LIMIT = 500_000;

interface PreparedRun extends Run {
  combos: number[][];
  /** analyzeRun 结果缓存，键为该线各格候选掩码打包的整数（一次求解期间复用）。 */
  memo: Map<bigint, { ok: boolean; masks: number[] }>;
}

function popcount(x: number): number {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

/**
 * 计算一次完美匹配（Kuhn）。返回 matchPos[pos]=数字下标，无解返回 null。
 */
function findMatching(
  digits: number[],
  domMasks: number[]
): number[] | null {
  const n = digits.length;
  const matchPos = new Array<number>(n).fill(-1);

  const tryKuhn = (di: number, seen: boolean[]): boolean => {
    const bit = 1 << digits[di];
    for (let pos = 0; pos < n; pos++) {
      if (seen[pos] || (domMasks[pos] & bit) === 0) continue;
      seen[pos] = true;
      if (matchPos[pos] === -1 || tryKuhn(matchPos[pos], seen)) {
        matchPos[pos] = di;
        return true;
      }
    }
    return false;
  };

  for (let di = 0; di < n; di++) {
    if (!tryKuhn(di, new Array<boolean>(n).fill(false))) return null;
  }
  return matchPos.every((x) => x !== -1) ? matchPos : null;
}

/**
 * 分析单条线段在当前各格域下的传播结果。
 * 返回每个位置“在某个仍可行的组合中、且存在合法排列”能取到的数字掩码。
 *
 * 先用一次完美匹配 M（不存在则该组合已死）；对二分图残差做 SCC（n≤6），
 * 边 (pos,d) 可取当且仅当它在 M 中，或其两端位于同一 SCC（可沿交替环调整）。
 * 这样每个组合只需一次匹配 + 一次 O(n²) 可达，而非 n² 次完整匹配。
 */
function analyzeRun(
  run: PreparedRun,
  domains: Uint16Array
): { ok: boolean; masks: number[] } {
  const n = run.cells.length;
  // 每格掩码 10 位（位 1..9），长度 ≤6，可打包进一个 bigint 作缓存键。
  let key = 0n;
  const localDom = new Array<number>(n);
  for (let pos = 0; pos < n; pos++) {
    const m = domains[run.cells[pos]];
    localDom[pos] = m;
    key = (key << 10n) | BigInt(m);
  }
  const hit = run.memo.get(key);
  if (hit) return hit;

  const masks = new Array<number>(n).fill(0);
  let anyCombo = false;

  for (const combo of run.combos) {
    // 廉价必要条件：组合中每个数字至少要有一个位置能放；
    // 且 Hall 条件的单元素检查（这能挡掉绝大多数死组合）。
    let quickReject = false;
    for (let di = 0; di < n; di++) {
      const bit = 1 << combo[di];
      let can = 0;
      for (let pos = 0; pos < n; pos++) {
        if (localDom[pos] & bit) can++;
      }
      if (can === 0) {
        quickReject = true;
        break;
      }
    }
    if (quickReject) continue;

    const m = findMatching(combo, localDom);
    if (m === null) continue; // 该组合在当前域下无法排列
    anyCombo = true;

    // 残差图：2n 个节点。位置 0..n-1；数字 n..2n-1。
    // 非匹配边 pos -> di+n；匹配边 di+n -> pos。
    const adj: number[][] = Array.from({ length: 2 * n }, () => []);
    const matchDiOfPos = m;
    for (let pos = 0; pos < n; pos++) {
      for (let di = 0; di < n; di++) {
        if ((localDom[pos] & (1 << combo[di])) === 0) continue;
        if (matchDiOfPos[pos] === di) {
          adj[di + n].push(pos); // 匹配边反向
        } else {
          adj[pos].push(di + n); // 非匹配边正向
        }
      }
    }

    const scc = kosaraju(adj);
    for (let pos = 0; pos < n; pos++) {
      let support = 0;
      for (let di = 0; di < n; di++) {
        if ((localDom[pos] & (1 << combo[di])) === 0) continue;
        // 匹配边天然属于某个完美匹配；非匹配边需要同 SCC（存在交替环）。
        if (matchDiOfPos[pos] === di || scc[pos] === scc[di + n]) {
          support |= 1 << combo[di];
        }
      }
      masks[pos] |= support;
    }
  }
  const result = { ok: anyCombo, masks };
  run.memo.set(key, result);
  return result;
}

/** Kosaraju 求强连通分量，返回每个节点的分量编号。 */
function kosaraju(adj: number[][]): number[] {
  const n = adj.length;
  const radj: number[][] = Array.from({ length: n }, () => []);
  for (let u = 0; u < n; u++) for (const w of adj[u]) radj[w].push(u);

  const seen = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const dfs1 = (u: number): void => {
    seen[u] = true;
    for (const w of adj[u]) if (!seen[w]) dfs1(w);
    order.push(u);
  };
  for (let u = 0; u < n; u++) if (!seen[u]) dfs1(u);

  const comp = new Array<number>(n).fill(-1);
  const dfs2 = (u: number, c: number): void => {
    comp[u] = c;
    for (const w of radj[u]) if (comp[w] === -1) dfs2(w, c);
  };
  let c = 0;
  for (let k = n - 1; k >= 0; k--) {
    const u = order[k];
    if (comp[u] === -1) dfs2(u, c++);
  }
  return comp;
}

export interface PreparedPuzzle {
  board: Board;
  runs: PreparedRun[];
  runInfo: RunInfo;
  /** 行优先排列的白格（盘面格索引）。 */
  whiteCells: number[];
  /** 每个白格 -> 所属横线索引。 */
  hRun: number[];
  /** 每个白格 -> 所属竖线索引。 */
  vRun: number[];
}

export function preparePuzzle(board: Board): PreparedPuzzle | { error: string } {
  const v = validateBoard(board);
  if (!v.ok || !v.runs) return { error: v.issues[0]?.message ?? '盘面不合法' };
  const runInfo = v.runs;
  const runs: PreparedRun[] = runInfo.runs.map((r) => ({
    ...r,
    combos: combinationsFor(r.cells.length, r.clue),
    memo: new Map<bigint, { ok: boolean; masks: number[] }>()
  }));
  const whiteCells: number[] = [];
  board.cells.forEach((c, i) => {
    if (isWhite(c)) whiteCells.push(i);
  });
  const hRun = whiteCells.map((i) => runInfo.hRunOf[i]!);
  const vRun = whiteCells.map((i) => runInfo.vRunOf[i]!);
  return { board, runs, runInfo, whiteCells, hRun, vRun };
}

class PropagationFailure extends Error {}

function propagate(
  p: PreparedPuzzle,
  domains: Uint16Array,
  queue: number[]
): void {
  const dirty = new Set<number>(queue);
  while (dirty.size > 0) {
    const ri = dirty.values().next().value as number;
    dirty.delete(ri);
    const run = p.runs[ri];
    const a = analyzeRun(run, domains);
    if (!a.ok) throw new PropagationFailure(`run ${ri} infeasible`);
    run.cells.forEach((cell, pos) => {
      const next = domains[cell] & a.masks[pos];
      if (next === 0) throw new PropagationFailure(`cell ${cell} wiped out`);
      if (next !== domains[cell]) {
        domains[cell] = next;
        // 本线内某格收缩会影响其他格（互斥）；
        // 同时加入与之交叉的另一条线。
        dirty.add(ri);
        const otherRi = run.dir === 'h' ? p.runInfo.vRunOf[cell] : p.runInfo.hRunOf[cell];
        if (otherRi !== undefined) dirty.add(otherRi);
      }
    });
  }
}

function initialDomains(p: PreparedPuzzle): Uint16Array {
  const domains = new Uint16Array(p.board.cells.length);
  for (const i of p.whiteCells) domains[i] = DIGIT_MASK_ALL;
  return domains;
}

/**
 * 求解。最多收集两个见证（行优先字典序最小的两个）。
 */
export function solve(
  boardOrPrepared: Board | PreparedPuzzle,
  nodeLimit = DEFAULT_NODE_LIMIT
): SolveResult {
  let p: PreparedPuzzle;
  const obj = boardOrPrepared as Partial<PreparedPuzzle>;
  if (Array.isArray(obj.runs) && Array.isArray(obj.whiteCells)) {
    p = boardOrPrepared as PreparedPuzzle;
  } else {
    const prep = preparePuzzle(boardOrPrepared as Board);
    if ('error' in prep) throw new Error(prep.error);
    p = prep;
  }

  const baseDomains = initialDomains(p);
  let propagatedDomains: Uint16Array;
  try {
    propagate(p, baseDomains, p.runs.map((_, i) => i));
    propagatedDomains = baseDomains;
  } catch {
    return {
      status: 'unsat',
      witnesses: [],
      domains: Array.from(baseDomains),
      propagationSolved: false,
      nodes: 0
    };
  }

  const allSingletons = p.whiteCells.every((i) => popcount(propagatedDomains[i]) === 1);

  const outcome = searchWitnesses(p, propagatedDomains.slice(), 2, nodeLimit);

  if (outcome.limitHit) {
    return {
      status: 'limit',
      witnesses: outcome.witnesses,
      domains: Array.from(propagatedDomains),
      propagationSolved: allSingletons,
      nodes: outcome.nodes
    };
  }
  return {
    status:
      outcome.witnesses.length === 0
        ? 'unsat'
        : outcome.witnesses.length === 1
          ? 'unique'
          : 'multiple',
    witnesses: outcome.witnesses,
    domains: Array.from(propagatedDomains),
    propagationSolved: allSingletons,
    nodes: outcome.nodes
  };
}

/**
 * 回溯搜索核心：在已传播的候选域上严格按行优先、数字从小到大分支，
 * 每找到 maxWitnesses 个完整合法填法即停止；节点数触顶同样立即停止。
 *
 * 求解（收集前两个见证）与存在性查询（只要一个见证）共用本函数，
 * 保证“安全提示”用的就是与唯一性分析同一套约束传播/回溯引擎。
 */
function searchWitnesses(
  p: PreparedPuzzle,
  startDomains: Uint16Array,
  maxWitnesses: number,
  nodeLimit: number
): { witnesses: number[][]; nodes: number; limitHit: boolean } {
  let nodes = 0;
  let limitHit = false;
  const witnesses: number[][] = [];

  const readSolution = (domains: Uint16Array): number[] =>
    p.whiteCells.map((i) => {
      const m = domains[i];
      return 31 - Math.clz32(m); // 单比特 -> 数字
    });

  const verifyLeaf = (digits: number[]): boolean => {
    const valAt = new Map<number, number>();
    p.whiteCells.forEach((cell, wi) => valAt.set(cell, digits[wi]));
    for (const run of p.runs) {
      let sum = 0;
      const seen = new Set<number>();
      for (const cell of run.cells) {
        const d = valAt.get(cell)!;
        if (d < MIN_DIGIT || d > MAX_DIGIT || seen.has(d)) return false;
        seen.add(d);
        sum += d;
      }
      if (sum !== run.clue) return false;
    }
    return true;
  };

  const dfs = (domains: Uint16Array, nextWhite: number): void => {
    if (witnesses.length >= maxWitnesses || limitHit) return;
    nodes++;
    if (nodes > nodeLimit) {
      limitHit = true;
      return;
    }
    // 行优先：选第一个尚未单值化的白格。
    let wi = nextWhite;
    while (wi < p.whiteCells.length && popcount(domains[p.whiteCells[wi]]) === 1) wi++;
    if (wi === p.whiteCells.length) {
      const sol = readSolution(domains);
      if (verifyLeaf(sol)) witnesses.push(sol);
      return;
    }
    const cell = p.whiteCells[wi];
    const mask = domains[cell];
    // 数字从小到大，保证字典序。
    for (let d = MIN_DIGIT; d <= MAX_DIGIT; d++) {
      if ((mask & (1 << d)) === 0) continue;
      const child = domains.slice();
      child[cell] = 1 << d;
      try {
        // 该格所属的两条线都要重新分析。
        propagate(p, child, [p.hRun[wi], p.vRun[wi]]);
      } catch {
        continue;
      }
      dfs(child, wi + 1);
      if (witnesses.length >= maxWitnesses || limitHit) return;
    }
  };

  dfs(startDomains, 0);
  return { witnesses, nodes, limitHit };
}

export type ExistsStatus = 'sat' | 'unsat' | 'limit';

export interface ExistsResult {
  status: ExistsStatus;
  nodes: number;
}

/**
 * 存在性查询：在把 fixed 当作“已固定填法”的条件下，是否还存在一份完整合法填法。
 *
 * fixed 按棋盘格索引：1～9 表示玩家已填、null/undefined 表示空格。
 * 不修改玩家输入本身 —— 只是把固定值收窄进候选域后跑同一套传播 + 回溯，
 * 找到任意一份填法即停。搜索触顶时如实返回 'limit'（未知），
 * 调用方绝不能把它当作 'unsat'。
 */
export function existsSolution(
  p: PreparedPuzzle,
  fixed: ReadonlyArray<number | null | undefined>,
  nodeLimit = DEFAULT_NODE_LIMIT
): ExistsResult {
  const domains = initialDomains(p);
  for (const cell of p.whiteCells) {
    const d = fixed[cell];
    if (d === null || d === undefined) continue;
    if (!Number.isInteger(d) || d < MIN_DIGIT || d > MAX_DIGIT) {
      return { status: 'unsat', nodes: 0 };
    }
    domains[cell] = 1 << d;
  }
  try {
    propagate(p, domains, p.runs.map((_, i) => i));
  } catch {
    return { status: 'unsat', nodes: 0 };
  }

  const outcome = searchWitnesses(p, domains.slice(), 1, nodeLimit);
  if (outcome.limitHit) return { status: 'limit', nodes: outcome.nodes };
  return {
    status: outcome.witnesses.length > 0 ? 'sat' : 'unsat',
    nodes: outcome.nodes
  };
}

/** 便捷工具：位掩码 -> 排序后的候选数字数组。 */
export function maskToDigits(mask: number): number[] {
  const out: number[] = [];
  for (let d = MIN_DIGIT; d <= MAX_DIGIT; d++) {
    if (mask & (1 << d)) out.push(d);
  }
  return out;
}
