<script lang="ts">
  import {
    analysis,
    canRedo,
    canUndo,
    boardStore,
    deserialize,
    maskToDigits,
    resize,
    runAnalysis,
    serialize,
    setClue,
    toggleCell,
    validation
  } from '../lib/stores/boardStore';
  import type { Board } from '../lib/types';
  import {
    MAX_WHITE_CELLS,
    colOf,
    rowOf,
    whiteCount
  } from '../lib/types';
  import BoardGrid from '../components/BoardGrid.svelte';
  import WitnessGrid from '../components/WitnessGrid.svelte';

  let selected = -1;
  let showCandidates = false;
  let rowsDraft = 4;
  let colsDraft = 4;
  let jsonText = '';
  let jsonError = '';
  let published = false;

  $: board = $boardStore;
  $: rowsDraft = board.rows;
  $: colsDraft = board.cols;
  $: v = $validation;
  $: a = $analysis;
  $: domains = a.result ? a.result.domains : board.cells.map((c) => (c.type === 'white' ? 0x3fe : 0));

  function onSelect(e: CustomEvent<number>): void {
    selected = e.detail;
  }
  function onToggle(e: CustomEvent<number>): void {
    toggleCell(e.detail);
  }
  function onClue(e: CustomEvent<{ index: number; dir: 'h' | 'v'; value: string }>): void {
    setClue(e.detail.index, e.detail.dir, e.detail.value);
  }

  function toggleSelected(): void {
    if (selected >= 0) toggleCell(selected);
  }

  function clearSelectedClues(): void {
    if (selected < 0) return;
    boardStore.mutate((draft) => {
      const c = draft.cells[selected];
      if (c.type === 'wall') {
        c.h = null;
        c.v = null;
      }
    });
  }

  const statusText: Record<string, string> = {
    unsat: '无解：当前线索下不存在任何合法填法。',
    unique: '唯一解：所有横竖线索共同确定唯一填法。',
    multiple: '多解：线索不足，至少存在两份合法填法（展示字典序最小的两份）。',
    limit: '搜索触及节点上限：未能完成唯一性判定。'
  };

  function exportJson(): void {
    jsonText = JSON.stringify(serialize(board));
    jsonError = '';
  }
  function publish(): void {
    if (!v.ok) return;
    localStorage.setItem('kakuro-published-board', JSON.stringify(serialize(board)));
    published = true;
    setTimeout(() => (published = false), 2000);
  }
  function importJson(): void {
    try {
      const b: Board = deserialize(JSON.parse(jsonText));
      boardStore.replace(b);
      jsonError = '';
      selected = -1;
    } catch (e) {
      jsonError = e instanceof Error ? e.message : String(e);
    }
  }

  $: selectedCell = selected >= 0 ? board.cells[selected] : null;
  $: selectedCands =
    selected >= 0 && a.result ? maskToDigits(a.result.domains[selected]) : [];
</script>

<div class="layout">
  <div>
    <div class="panel" style="margin-bottom: 16px">
      <div class="toolbar">
        <div class="field">
          行
          <input type="number" min="1" max="10" bind:value={rowsDraft} />
        </div>
        <div class="field">
          列
          <input type="number" min="1" max="10" bind:value={colsDraft} />
        </div>
        <button on:click={() => resize(rowsDraft, colsDraft)}>调整尺寸</button>
        <span class="muted">白格 {whiteCount(board)}/{MAX_WHITE_CELLS}</span>
        <span style="flex:1"></span>
        <button on:click={() => boardStore.undo()} disabled={!$canUndo}>撤销</button>
        <button on:click={() => boardStore.redo()} disabled={!$canRedo}>重做</button>
        <button on:click={() => boardStore.reset()}>清空</button>
      </div>

      <BoardGrid
        {board}
        {selected}
        issues={v.issues}
        {domains}
        {showCandidates}
        on:select={onSelect}
        on:toggle={onToggle}
        on:clue={onClue}
      />

      <p class="hint" style="margin-top: 10px">
        单击选择格子；双击白格（或选中后按按钮）切换墙/白。墙格右上写横线索、左下写竖线索（3～45 的整数）。
        每条横/竖连续白格长度需为 2～6，每个白格必须恰属一条横线与一条竖线。
      </p>
    </div>
  </div>

  <aside>
    <div class="panel" style="margin-bottom: 16px">
      <h2>格子操作</h2>
      {#if selectedCell}
        <p class="muted" style="margin: 0 0 8px">
          ({rowOf(board, selected) + 1}, {colOf(board, selected) + 1}) ·
          {selectedCell.type === 'wall' ? '墙格' : '白格'}
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button on:click={toggleSelected}>
            {selectedCell.type === 'wall' ? '改为白格' : '改为墙格'}
          </button>
          {#if selectedCell.type === 'wall'}
            <button on:click={clearSelectedClues}>清除线索</button>
          {/if}
        </div>
        {#if selectedCell.type === 'white' && a.result}
          <div class="cand-detail">
            传播后候选数字：
            <strong>{selectedCands.length ? selectedCands.join('、') : '（空：矛盾）'}</strong>
          </div>
        {/if}
      {:else}
        <p class="muted" style="margin:0">未选择格子。</p>
      {/if}
    </div>

    <div class="panel" style="margin-bottom: 16px">
      <h2>结构校验</h2>
      {#if v.ok && v.runs}
        <p style="color: var(--ok); margin: 0; font-size: 13px; font-weight: 600">
          ✓ 结构合法：{v.runs.runs.filter((run) => run.dir === 'h').length} 条横线、
          {v.runs.runs.filter((run) => run.dir === 'v').length} 条竖线。
        </p>
      {:else}
        <ul class="issue-list">
          {#each v.issues as issue (issue.code + String(issue.cell))}
            <li>
              {issue.message}
              {#if issue.cell !== undefined}
                <button
                  style="padding:0 6px;font-size:11px;margin-left:4px"
                  on:click={() => {
                    if (issue.cell !== undefined) selected = issue.cell;
                  }}>定位</button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="panel" style="margin-bottom: 16px">
      <h2>唯一性分析</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="primary" on:click={runAnalysis} disabled={!v.ok || a.status === 'running'}>
          {a.status === 'running' ? '搜索中…' : '分析唯一性'}
        </button>
        <label class="field">
          <input type="checkbox" bind:checked={showCandidates} disabled={!a.result} />
          显示候选
        </label>
      </div>
      {#if a.stale && a.result}
        <p class="stale-note">⚠ 盘面已修改：以下结论已失效，请重新分析以获得最新判定。</p>
      {/if}
      {#if a.error}
        <div class="result-banner unsat" style="margin-top:10px">{a.error}</div>
      {/if}
      {#if a.result}
        <div class="result-banner {a.result.status}" class:stale={a.stale} style="margin-top:10px">
          {statusText[a.result.status]}
        </div>
        {#if a.result.status === 'unique' || a.result.status === 'multiple'}
          {#each a.result.witnesses as w, k (k)}
            <div class="witness">
              <div class="cap">
                见证 {k + 1}{a.result.status === 'multiple' ? `（行优先字典序第 ${k + 1} 小）` : ''}
              </div>
              <WitnessGrid {board} digits={w} />
            </div>
          {/each}
        {/if}
        <p class="muted">
          搜索节点数：{a.result.nodes}；
          {a.result.propagationSolved
            ? '约束传播已独立确定全部白格'
            : '传播后仍有分叉，由回溯搜索完成判定'}
        </p>
      {/if}
    </div>

    <div class="panel">
      <h2>导入 / 导出（离线 JSON）</h2>
      <textarea
        class="json"
        bind:value={jsonText}
        placeholder="点击“导出”生成，或粘贴盘面 JSON 后导入"
      ></textarea>
      {#if jsonError}<p style="color: var(--bad); font-size:12px">{jsonError}</p>{/if}
      <div style="display:flex;gap:8px;margin-top:6px">
        <button on:click={exportJson}>导出</button>
        <button on:click={importJson}>导入</button>
        <button class="primary" on:click={publish} disabled={!v.ok}>
          {published ? '已发布 ✓' : '发布到谜题页'}
        </button>
      </div>
    </div>
  </aside>
</div>
