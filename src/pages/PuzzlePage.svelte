<script lang="ts">
  import type { Board } from '../lib/types';
  import { colOf, isWall, rowOf } from '../lib/types';
  import { validateBoard } from '../lib/validation';
  import { preparePuzzle, solve, maskToDigits, type SolveResult } from '../lib/solver';
  import { deserialize, serialize } from '../lib/stores/boardStore';
  import { createSafeHintSession, type SafeHint } from '../lib/hint';
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

  // 安全提示：会话状态是页面文案、确认填入与格子高亮的唯一共同来源。
  const hintSession = createSafeHintSession();
  let hintResult: SafeHint | null = null;
  let hintStale = false;
  let hintComputing = false;
  function syncHint(): void {
    hintResult = hintSession.state.result;
    hintStale = hintSession.state.stale;
  }

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
  // 棋盘、线索或任一已填数字变化，旧安全提示立即失效。
  $: board, entries, onHintInputsChanged();

  function onHintInputsChanged(): void {
    hintSession.invalidate();
    syncHint();
  }

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
    hintSession.dismiss();
    syncHint();
  }

  function loadJson() {
    try {
      board = deserialize(JSON.parse(jsonText));
      entries = board.cells.map(() => '');
      solution = null;
      showSolution = false;
      hintSession.dismiss();
      syncHint();
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
      hintSession.dismiss();
      syncHint();
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

  async function requestHint() {
    if (hintComputing || !validation.ok) return;
    hintComputing = true;
    // 让出一帧，先渲染“计算中”。
    await new Promise((res) => setTimeout(res, 0));
    try {
      hintSession.request(board, entries);
    } catch (e) {
      jsonError = e instanceof Error ? e.message : String(e);
    }
    hintComputing = false;
    syncHint();
  }

  // 提示只预览：玩家确认后才把数字写入对应格。
  function confirmHint() {
    const apply = hintSession.confirm();
    if (!apply) return;
    entries = entries.map((x, i) => (i === apply.cell ? String(apply.digit) : x));
    syncHint(); // 会话已清空；随后的失效反应面对空状态，为 no-op。
  }

  function dismissHint() {
    hintSession.dismiss();
    syncHint();
  }

  function hintRowCol(cell: number | null): { r: number; c: number } | null {
    if (cell === null) return null;
    return { r: rowOf(board, cell) + 1, c: colOf(board, cell) + 1 };
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
                  {@const isHintTarget =
                    hintResult !== null &&
                    !hintStale &&
                    hintResult.status === 'hint' &&
                    hintResult.cell === i}
                  <td
                    class="white playable"
                    class:conflict={conflictCells.has(i)}
                    class:wrong={inWrongRun}
                    class:selected={selected === i}
                    class:hint-target={isHintTarget}
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
                    {#if isHintTarget && entries[i] === ''}
                      <span class="hint-preview">{hintResult?.digit}</span>
                    {/if}
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
        <button on:click={requestHint} disabled={!validation.ok || hintComputing} class="safe-hint">
          {hintComputing ? '提示计算中…' : '安全提示'}
        </button>
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

      {#if hintResult}
        {@const rc = hintRowCol(hintResult.cell)}
        <div
          class="result-banner hint-banner {hintResult.status}"
          class:stale={hintStale}
          role="status"
        >
          {#if hintResult.status === 'contradiction'}
            局面矛盾：以你当前已填的数字为固定条件，不存在任何完整合法填法。请检查已填数字（你的输入不会被清空）。
          {:else if hintResult.status === 'hint'}
            安全提示：第 {rc?.r} 行第 {rc?.c} 列在所有可行填法中都为
            <strong>{hintResult.digit}</strong>。
            {#if !hintStale}
              <button class="primary" on:click={confirmHint}>确认填入</button>
            {/if}
          {:else if hintResult.status === 'no-clue'}
            暂无线索：没有任何空格能被全部可行填法唯一确定（继续尝试或运行唯一性分析）。
          {:else}
            搜索超限：存在性查询触及节点上限，安全提示未知——未查完的候选不会被当作不可能。
          {/if}
          <div class="hint-actions">
            {#if hintStale}<span class="stale-note">棋盘或已填数字已变化，此提示已失效。</span>{/if}
            <button on:click={dismissHint}>关闭提示</button>
          </div>
        </div>
      {/if}
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
            hintSession.dismiss();
            syncHint();
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
  button.safe-hint {
    border-color: var(--ok);
    color: var(--ok);
    font-weight: 600;
  }
  td.hint-target {
    background: #e7f8ef;
    outline: 3px solid var(--ok);
    outline-offset: -3px;
  }
  .hint-preview {
    position: absolute;
    right: 3px;
    top: 1px;
    font-size: 15px;
    font-weight: 700;
    color: var(--ok);
    opacity: 0.75;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
  .result-banner.hint {
    color: var(--ok);
    background: #e9f7f0;
    border-color: #bfe4d2;
  }
  .result-banner.hint button {
    margin-left: 10px;
  }
  .result-banner.contradiction {
    color: var(--bad);
    background: #fdecec;
    border-color: #f2c0c0;
  }
  .result-banner.unknown {
    color: var(--warn);
    background: #fdf3e7;
    border-color: #f0d3ad;
  }
  .result-banner.no-clue {
    color: var(--ink-soft);
    background: #f3f5f8;
    border-color: var(--line);
  }
  .hint-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
  }
</style>
