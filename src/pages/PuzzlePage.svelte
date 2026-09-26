<script lang="ts">
  import type { Board } from '../lib/types';
  import { isWall } from '../lib/types';
  import { validateBoard } from '../lib/validation';
  import { preparePuzzle, solve, maskToDigits, type SolveResult } from '../lib/solver';
  import { deserialize, serialize } from '../lib/stores/boardStore';
  import WitnessGrid from '../components/WitnessGrid.svelte';
  import { SAMPLE_BOARD } from '../lib/sample';

  const STORAGE_KEY = 'kakuro-published-board';

  let board: Board = loadInitial();
  let entries: string[] = board.cells.map(() => '');
  let jsonText = '';
  let jsonError = '';
  let solution: SolveResult | null = null;
  let showSolution = false;
  let selected = -1;

  function loadInitial(): Board {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return deserialize(JSON.parse(raw));
    } catch {
      // 回退到内置示例
    }
    return SAMPLE_BOARD;
  }

  $: validation = validateBoard(board);
  $: whiteIndices = board.cells.map((c, i) => (c.type === 'white' ? i : -1)).filter((i) => i >= 0);

  // 冲突检测：同线重复 / 已填满但和不等。
  $: conflictCells = new Set<number>();
  $: wrongSumRuns = new Set<number>();
  $: completeCount = 0;
  function recomputeChecks() {
    const cc = new Set<number>();
    const ws = new Set<number>();
    let filled = 0;
    if (validation.ok && validation.runs) {
      for (const [ri, run] of validation.runs.runs.entries()) {
        const digits: { cell: number; d: number }[] = [];
        let allFilled = true;
        for (const cell of run.cells) {
          const raw = entries[cell];
          if (raw === '') {
            allFilled = false;
            continue;
          }
          digits.push({ cell, d: Number(raw) });
        }
        const seen = new Map<number, number>();
        for (const { cell, d } of digits) {
          if (seen.has(d)) {
            cc.add(cell);
            cc.add(seen.get(d)!);
          }
          seen.set(d, cell);
        }
        if (allFilled) {
          filled++;
          const sum = digits.reduce((a, x) => a + x.d, 0);
          if (sum !== run.clue) ws.add(ri);
        }
      }
    }
    conflictCells = cc;
    wrongSumRuns = ws;
    completeCount = filled;
  }
  $: entries, board, recomputeChecks();

  $: totalRuns = validation.ok && validation.runs ? validation.runs.runs.length : 0;
  $: allFilled = whiteIndices.every((i) => entries[i] !== '');
  $: solved = allFilled && conflictCells.size === 0 && wrongSumRuns.size === 0 && totalRuns > 0;

  function onDigit(cell: number, target: EventTarget | null) {
    const value = (target as HTMLInputElement | null)?.value ?? '';
    if (!/^[1-9]?$/.test(value)) return;
    entries = entries.map((x, i) => (i === cell ? value : x));
  }

  function clearEntries() {
    entries = board.cells.map(() => '');
    showSolution = false;
  }

  function loadJson() {
    try {
      board = deserialize(JSON.parse(jsonText));
      entries = board.cells.map(() => '');
      solution = null;
      showSolution = false;
      jsonError = '';
    } catch (e) {
      jsonError = e instanceof Error ? e.message : String(e);
    }
  }

  function publishFromEditor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        jsonError = '编辑器尚未发布盘面：请在编辑器页点击“发布到谜题页”。';
        return;
      }
      board = deserialize(JSON.parse(raw));
      entries = board.cells.map(() => '');
      solution = null;
      showSolution = false;
      jsonError = '';
    } catch (e) {
      jsonError = e instanceof Error ? e.message : String(e);
    }
  }

  function analyze() {
    const prep = preparePuzzle(board);
    if ('error' in prep) {
      jsonError = prep.error;
      return;
    }
    solution = solve(prep);
  }

  function candidateList(cell: number): number[] {
    if (!solution) return [];
    return maskToDigits(solution.domains[cell]);
  }
</script>

<div class="layout">
  <div>
    <div class="panel">
      <h2>
        谜题页
        {#if validation.ok && validation.runs}
          <span class="tag h">{validation.runs.runs.filter((run) => run.dir === 'h').length} 横</span>
          <span class="tag v">{validation.runs.runs.filter((run) => run.dir === 'v').length} 竖</span>
        {/if}
      </h2>

      {#if !validation.ok}
        <div class="result-banner unsat">盘面数据不合法，无法开始：</div>
        <ul class="issue-list">
          {#each validation.issues as issue (issue.code + String(issue.cell))}
            <li>{issue.message}</li>
          {/each}
        </ul>
      {/if}

      <div class="grid-wrap">
        <table class="kgrid">
          {#each Array.from({ length: board.rows }) as _, r}
            <tr>
              {#each Array.from({ length: board.cols }) as _, c}
                {@const i = r * board.cols + c}
                {@const cell = board.cells[i]}
                {#if isWall(cell)}
                  <td class="wall">
                    {#if cell.h !== null}<span class="static-clue h">{cell.h}</span>{/if}
                    {#if cell.v !== null}<span class="static-clue v">{cell.v}</span>{/if}
                  </td>
                {:else}
                  {@const inWrongRun =
                    validation.ok &&
                    validation.runs !== undefined &&
                    validation.runs.runs.some(
                      (run, ri) => wrongSumRuns.has(ri) && run.cells.includes(i)
                    )}
                  <td
                    class="white playable"
                    class:conflict={conflictCells.has(i)}
                    class:wrong={inWrongRun}
                    class:selected={selected === i}
                  >
                    <input
                      class="digit-input"
                      type="text"
                      inputmode="numeric"
                      maxlength="1"
                      value={entries[i]}
                      on:focus={() => (selected = i)}
                      on:input={(e) => onDigit(i, e.currentTarget)}
                    />
                    {#if selected === i && solution}
                      <div class="cand-popup">
                        候选：{candidateList(i).length ? candidateList(i).join(' ') : '空'}
                      </div>
                    {/if}
                  </td>
                {/if}
              {/each}
            </tr>
          {/each}
        </table>
      </div>

      <div class="toolbar" style="margin-top: 12px">
        <button on:click={clearEntries}>清空填写</button>
        <button class="primary" on:click={analyze} disabled={!validation.ok}>求解 / 唯一性分析</button>
        {#if allFilled}
          {#if solved}
            <span style="color: var(--ok); font-weight: 700">🎉 全部完成，答案正确！</span>
          {:else}
            <span style="color: var(--bad); font-weight: 700">存在冲突或和不符</span>
          {/if}
        {:else}
          <span class="muted">已满足线段：{completeCount}/{totalRuns}</span>
        {/if}
      </div>
    </div>

    {#if solution && showSolution}
      <div class="panel" style="margin-top: 16px">
        <h2>分析结果</h2>
        <div class="result-banner {solution.status}">
          {#if solution.status === 'unsat'}无解{:else if solution.status === 'unique'}
            唯一解
          {:else if solution.status === 'multiple'}
            多解（展示行优先字典序最小的两份）
          {:else}搜索超限{/if}
        </div>
        <div style="display:flex;gap:24px;flex-wrap:wrap">
          {#each solution.witnesses as w, k (k)}
            <div class="witness">
              <div class="cap">见证 {k + 1}</div>
              <WitnessGrid {board} digits={w} />
            </div>
          {/each}
        </div>
        <p class="hint">点击任意白格可查看该格在当前传播阶段剩余的候选数字。</p>
      </div>
    {/if}
  </div>

  <aside>
    <div class="panel" style="margin-bottom: 16px">
      <h2>盘面来源</h2>
      <p class="hint" style="margin-top:0">
        谜题页由容器（docker compose）作为纯静态站点提供。编辑器发布的盘面存于浏览器
        localStorage，可直接载入；也可粘贴 JSON。
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button on:click={publishFromEditor}>载入编辑器发布的盘面</button>
        <button
          on:click={() => {
            board = SAMPLE_BOARD;
            entries = board.cells.map(() => '');
            solution = null;
          }}>内置示例</button
        >
      </div>
    </div>

    <div class="panel" style="margin-bottom: 16px">
      <h2>规则</h2>
      <ul class="hint" style="margin:0;padding-left:18px">
        <li>每个白格填 1～9；</li>
        <li>同一条横线/竖线内数字不得重复；</li>
        <li>每条线段数字之和等于线索值（横线索在墙格右上，竖线索在左下）。</li>
      </ul>
    </div>

    <div class="panel">
      <h2>JSON 载入</h2>
      <textarea class="json" bind:value={jsonText} placeholder="粘贴盘面 JSON"></textarea>
      {#if jsonError}<p style="color: var(--bad); font-size: 12px">{jsonError}</p>{/if}
      <div style="display:flex;gap:8px;margin-top:6px">
        <button on:click={loadJson}>载入</button>
        <button on:click={() => (jsonText = JSON.stringify(serialize(board)))}>查看当前 JSON</button>
        <button on:click={() => (showSolution = !showSolution)} disabled={!solution}>
          {showSolution ? '隐藏' : '显示'}分析结果
        </button>
      </div>
    </div>
  </aside>
</div>

<style>
  .static-clue {
    position: absolute;
    font-size: 13px;
    font-weight: 700;
    color: #e7c98a;
  }
  .static-clue.h {
    right: 5px;
    top: 2px;
  }
  .static-clue.v {
    left: 5px;
    bottom: 2px;
  }
  td.playable {
    cursor: text;
  }
  .digit-input {
    width: 100%;
    height: 100%;
    border: none;
    text-align: center;
    font-size: 24px;
    font-weight: 600;
    outline: none;
    background: transparent;
    font-variant-numeric: tabular-nums;
  }
  td.conflict {
    background: #fde2e2;
  }
  td.conflict .digit-input {
    color: var(--bad);
  }
  td.wrong {
    box-shadow: inset 0 0 0 2px var(--warn);
  }
  td.selected {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  .cand-popup {
    position: absolute;
    z-index: 5;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: var(--ink);
    color: #fff;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 6px;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
