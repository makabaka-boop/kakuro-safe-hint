<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Board } from '../lib/types';
  import { isWall } from '../lib/types';
  import type { Issue } from '../lib/validation';

  export let board: Board;
  export let selected = -1;
  export let domains: number[] = [];
  export let showCandidates = false;
  export let issues: Issue[] = [];

  const dispatch = createEventDispatcher<{
    select: number;
    toggle: number;
    clue: { index: number; dir: 'h' | 'v'; value: string };
  }>();

  function issueCells(): Set<number> {
    const s = new Set<number>();
    for (const i of issues) if (i.cell !== undefined) s.add(i.cell);
    return s;
  }
  $: badCells = issueCells();

  function onClueInput(e: Event, index: number, dir: 'h' | 'v') {
    const input = e.currentTarget as HTMLInputElement;
    dispatch('clue', { index, dir, value: input.value });
  }
</script>

<div class="grid-wrap">
  <table class="kgrid" style="--cols: {board.cols}">
    {#each Array.from({ length: board.rows }) as _, r}
      <tr>
        {#each Array.from({ length: board.cols }) as _, c}
          {@const i = r * board.cols + c}
          {@const cell = board.cells[i]}
          {#if isWall(cell)}
            <td
              class="wall"
              class:selected={selected === i}
              class:bad={badCells.has(i)}
              role="button"
              tabindex="0"
              title={`墙格 (${r + 1}, ${c + 1})`}
              on:click={() => dispatch('select', i)}
              on:keydown={(e) => e.key === 'Enter' && dispatch('select', i)}
            >
              <!-- {#key} 随线索值变化：撤销/重做/导入后重建为受控值 -->
              {#key `${i}-h-${cell.h ?? ''}`}
                <input
                  class="clue-input h"
                  class:invalid={badCells.has(i)}
                  type="number"
                  min="3"
                  max="45"
                  placeholder="—"
                  aria-label="横线索"
                  value={cell.h ?? ''}
                  on:focus={() => dispatch('select', i)}
                  on:input={(e) => onClueInput(e, i, 'h')}
                />
              {/key}
              {#key `${i}-v-${cell.v ?? ''}`}
                <input
                  class="clue-input v"
                  class:invalid={badCells.has(i)}
                  type="number"
                  min="3"
                  max="45"
                  placeholder="—"
                  aria-label="竖线索"
                  value={cell.v ?? ''}
                  on:focus={() => dispatch('select', i)}
                  on:input={(e) => onClueInput(e, i, 'v')}
                />
              {/key}
            </td>
          {:else}
            {@const mask = showCandidates ? domains[i] ?? 0 : 0}
            <td
              class="white"
              class:selected={selected === i}
              class:bad={badCells.has(i)}
              role="button"
              tabindex="0"
              title={`白格 (${r + 1}, ${c + 1})`}
              on:click={() => dispatch('select', i)}
              on:dblclick={() => dispatch('toggle', i)}
              on:keydown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  dispatch('toggle', i);
                }
              }}
            >
              {#if showCandidates && mask > 0}
                <div class="cand-overlay">
                  {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as d}
                    <span class:eliminated={(mask & (1 << d)) === 0}>{d}</span>
                  {/each}
                </div>
              {:else if showCandidates && mask === 0}
                <div class="white-value" style="color: var(--bad)">✕</div>
              {/if}
            </td>
          {/if}
        {/each}
      </tr>
    {/each}
  </table>
</div>

<style>
  td.bad {
    outline: 2px dashed var(--bad);
    outline-offset: -2px;
  }
</style>
