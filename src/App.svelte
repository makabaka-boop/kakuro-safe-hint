<script lang="ts">
  import EditorPage from './pages/EditorPage.svelte';
  import PuzzlePage from './pages/PuzzlePage.svelte';
  import { route, goto } from './lib/router';
</script>

<div class="app">
  <header class="topbar">
    <h1>Kakuro Studio · 数和编辑器</h1>
    <nav>
      <a
        href="#/editor"
        class:active={$route === 'editor'}
        on:click|preventDefault={() => goto('editor')}>编辑器</a
      >
      <a
        href="#/puzzle"
        class:active={$route === 'puzzle'}
        on:click|preventDefault={() => goto('puzzle')}>谜题</a
      >
    </nav>
  </header>

  {#if $route === 'editor'}
    <EditorPage />
  {:else}
    <PuzzlePage />
  {/if}
</div>
