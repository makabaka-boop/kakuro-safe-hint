<script lang="ts">
  import type { Board } from '../lib/types';
  import { isWall } from '../lib/types';

  export let board: Board;
  /** 行优先的白格数字（与 board 中白格顺序对应）。 */
  export let digits: number[];

  $: map = buildMap(board, digits);

  function buildMap(b: Board, ds: number[]): Map<number, number> {
    const m = new Map<number, number>();
    let wi = 0;
    b.cells.forEach((c, i) => {
      if (c.type === 'white') m.set(i, ds[wi++]);
    });
    return m;
  }
</script>

<table class="mini">
  {#each Array.from({ length: board.rows }) as _, r}
    <tr>
      {#each Array.from({ length: board.cols }) as _, c}
        {@const i = r * board.cols + c}
        {@const cell = board.cells[i]}
        {#if isWall(cell)}
          <td class="wall">
            {#if cell.h !== null}<span class="mh">{cell.h}→</span>{/if}
            {#if cell.v !== null}<span class="mv">↓{cell.v}</span>{/if}
          </td>
        {:else}
          <td>{map.get(i)}</td>
        {/if}
      {/each}
    </tr>
  {/each}
</table>
