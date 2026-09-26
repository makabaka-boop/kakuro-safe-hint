import { MAX_DIGIT, MIN_DIGIT } from './types.js';

/**
 * 给定长度 L、线索和 S，枚举所有“长度为 L、数字互异、取自 1～9、和为 S”的组合。
 *
 * 组合内数字按升序排列（多格的具体排列在 solver 内处理）。
 * 结果做记忆化：一盘内所有线段会大量复用 (L,S)。
 */

export type Combo = number[];

const cache = new Map<string, Combo[]>();

function keyOf(len: number, sum: number): string {
  return `${len}:${sum}`;
}

function enumerate(len: number, sum: number): Combo[] {
  const out: Combo[] = [];
  const cur: number[] = [];

  function rec(start: number, remaining: number, left: number): void {
    if (left === 0) {
      if (remaining === 0) out.push(cur.slice());
      return;
    }
    // 剪枝：后续 left 个递增数字能凑出的最小/最大和。
    const minTake = ((start + start + left - 1) * left) / 2;
    const maxTake = ((MAX_DIGIT + MAX_DIGIT - left + 1) * left) / 2;
    if (remaining < minTake || remaining > maxTake) return;
    for (let d = start; d <= MAX_DIGIT; d++) {
      cur.push(d);
      rec(d + 1, remaining - d, left - 1);
      cur.pop();
    }
  }

  if (len >= MIN_DIGIT && len <= MAX_DIGIT) rec(MIN_DIGIT, sum, len);
  return out;
}

export function combinationsFor(len: number, sum: number): Combo[] {
  const key = keyOf(len, sum);
  const hit = cache.get(key);
  if (hit) return hit;
  const result = enumerate(len, sum);
  cache.set(key, result);
  return result;
}

/** 某长度下所有可能的线索和（用于编辑器提示合法范围）。 */
export function possibleSums(len: number): number[] {
  const sums = new Set<number>();
  const cur: number[] = [];
  const rec = (start: number): void => {
    if (cur.length === len) {
      sums.add(cur.reduce((a, b) => a + b, 0));
      return;
    }
    for (let d = start; d <= MAX_DIGIT; d++) {
      cur.push(d);
      rec(d + 1);
      cur.pop();
    }
  };
  rec(MIN_DIGIT);
  return [...sums].sort((a, b) => a - b);
}
