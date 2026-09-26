import type { Board } from './types.js';
import { MAX_DIGIT, MIN_DIGIT } from './types.js';
import {
  DEFAULT_NODE_LIMIT,
  asPrepared,
  maskToDigits,
  search,
  type PreparedPuzzle
} from './solver.js';

/**
 * 安全提示：
 * 把玩家当前填写的数字作为固定条件，先判定是否仍存在完整合法填法；
 * 有解时，对每个未填白格的每个候选数字分别做独立的存在性查询
 * （“固定该格为该数字后，是否还能延伸出完整填法”），从而精确算出
 * 每个格子在**所有**可行填法中出现的数字集合 —— 而不是用前两份见证
 * 冒充所有解（多解盘面里前两份见证一致的格子，其余解完全可能不同）。
 *
 * 返回按行优先第一个“所有可行填法取值一致”的未填格；
 * 任何一次存在性查询触及节点上限，整体结论都是 unknown ——
 * 未查完的候选绝不当作不可能。
 */

export type SafeHintStatus =
  /** 固定条件下已不存在任何完整合法填法（玩家填写与线索矛盾）。 */
  | 'contradiction'
  /** 找到一个被所有可行填法强制的未填格。 */
  | 'hint'
  /** 有解，但没有任何未填格被所有可行填法唯一确定。 */
  | 'none'
  /** 搜索触及节点上限，无法判定（既非矛盾、也非“没有提示”）。 */
  | 'unknown';

export interface SafeHintResult {
  status: SafeHintStatus;
  /** status === 'hint' 时：目标格（盘面格索引，行优先）。 */
  cell: number | null;
  /** status === 'hint' 时：所有可行填法在该格共用的数字。 */
  digit: number | null;
  /** 全部存在性查询累计的搜索节点数。 */
  nodes: number;
}

const settle = (status: SafeHintStatus, nodes: number): SafeHintResult => ({
  status,
  cell: null,
  digit: null,
  nodes
});

/**
 * 计算安全提示。
 *
 * @param boardOrPrepared 盘面（或已规格化的 PreparedPuzzle，多次调用可复用）
 * @param entries 玩家填写：长度 = 盘面格数；未填为 null/undefined，已填为 1～9
 * @param nodeLimit 每次存在性查询的节点上限
 */
export function safeHint(
  boardOrPrepared: Board | PreparedPuzzle,
  entries: readonly (number | null | undefined)[],
  nodeLimit: number = DEFAULT_NODE_LIMIT
): SafeHintResult {
  const p = asPrepared(boardOrPrepared);

  // 固定条件：只接受白格上合法的 1～9。
  const fixed = new Map<number, number>();
  for (const cell of p.whiteCells) {
    const d = entries[cell];
    if (typeof d === 'number' && Number.isInteger(d) && d >= MIN_DIGIT && d <= MAX_DIGIT) {
      fixed.set(cell, d);
    }
  }

  let nodes = 0;

  // 1) 固定条件下是否仍存在完整填法。
  const first = search(p, { fixed, maxWitnesses: 1, nodeLimit });
  nodes += first.nodes;
  if (first.witnesses.length === 0) {
    return settle(first.limitHit ? 'unknown' : 'contradiction', nodes);
  }

  // 2) 每个白格“已见证可行”的数字集合：每份完整填法都证明
  //    它用到的每个数字在对应格上可行。初始见证先铺一层。
  const feasible: Set<number>[] = p.whiteCells.map(() => new Set<number>());
  const absorb = (w: number[]): void => {
    for (let wi = 0; wi < p.whiteCells.length; wi++) feasible[wi].add(w[wi]);
  };
  absorb(first.witnesses[0]);

  // 3) 行优先扫描未填格：候选 = 传播后剩余域（是真实可行集的超集）。
  //    对每个尚未见证的候选做存在性查询；不可行即排除。
  //    集合精确收敛为单值时，该格即被所有可行填法强制。
  for (let wi = 0; wi < p.whiteCells.length; wi++) {
    const cell = p.whiteCells[wi];
    if (fixed.has(cell)) continue; // 已填格不需要提示
    for (const d of maskToDigits(first.domains[cell])) {
      if (feasible[wi].has(d)) continue; // 已有见证，无需再查
      if (feasible[wi].size >= 2) break; // 已证明非强制，看下一格
      const r = search(p, {
        fixed: new Map([...fixed, [cell, d]]),
        maxWitnesses: 1,
        nodeLimit
      });
      nodes += r.nodes;
      if (r.witnesses.length > 0) {
        absorb(r.witnesses[0]); // 新见证同时补充其它格的可行数字
      } else if (r.limitHit) {
        // 该候选没查完：既不能当不可能，也不能据此断言本格被强制。
        return settle('unknown', nodes);
      }
      // 查询证明不可行：自然落入下一候选。
    }
    if (feasible[wi].size === 1) {
      const digit = feasible[wi].values().next().value as number;
      return { status: 'hint', cell, digit, nodes };
    }
  }
  return settle('none', nodes);
}
