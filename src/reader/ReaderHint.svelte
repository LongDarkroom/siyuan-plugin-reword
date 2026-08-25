<script lang="ts">
  /**
   * 阅读器 - 快捷键 hint overlay
   * - 按 ? 触发显隐
   * - 列出全部快捷键 + 功能
   * - 半透明背景 + 居中浮窗
   * - Esc 或 ? 关闭
   * - 数据源：reader-shortcuts.ts 的 getHintLines()
   */
  import { getHintLines } from "./reader-shortcuts";
  import { createEventDispatcher, onMount, onDestroy } from "svelte";

  export let visible: boolean = false;
  export let isMac: boolean = false;
  export let conflicts: string[] = [];

  const dispatch = createEventDispatcher<{ close: void }>();
  let hintEl: HTMLDivElement | null = null;
  let boundKeydown: ((e: KeyboardEvent) => void) | null = null;

  $: lines = getHintLines();

  onMount(() => {
    boundKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        if (visible) {
          e.preventDefault();
          dispatch("close");
        }
      }
    };
    window.addEventListener("keydown", boundKeydown);
  });

  onDestroy(() => {
    if (boundKeydown) window.removeEventListener("keydown", boundKeydown);
  });

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      dispatch("close");
    }
  }

  function isConflict(label: string): boolean {
    return conflicts.includes(label);
  }
</script>

{#if visible}
  <div class="reader-hint-backdrop" on:click={handleBackdrop} role="presentation">
    <div class="reader-hint" bind:this={hintEl}>
      <div class="reader-hint__title">键盘快捷键</div>
      <div class="reader-hint__list">
        {#each lines as line}
          <div class="reader-hint__row" class:reader-hint__row--conflict={isConflict(line.label)}>
            <kbd class="reader-hint__keys">{line.keys}</kbd>
            <span class="reader-hint__label">{line.label}</span>
            {#if isConflict(line.label)}
              <span class="reader-hint__warn" title="与思源全局冲突，已禁用">⚠</span>
            {/if}
          </div>
        {/each}
      </div>
      <div class="reader-hint__footer">
        按 <kbd>?</kbd> 或 <kbd>Esc</kbd> 关闭
      </div>
    </div>
  </div>
{/if}

<style>
  .reader-hint-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100000;
    animation: reader-hint-fade 150ms ease-out;
  }
  @keyframes reader-hint-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .reader-hint {
    background: var(--b3-theme-surface, #fff);
    border: 1px solid var(--b3-border-color);
    border-radius: 8px;
    padding: 20px 24px;
    min-width: 360px;
    max-width: 480px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }
  .reader-hint__title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--b3-theme-on-surface);
  }
  .reader-hint__list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 6px;
    margin-bottom: 12px;
  }
  .reader-hint__row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 0;
    font-size: 13px;
  }
  .reader-hint__row--conflict {
    opacity: 0.5;
  }
  .reader-hint__keys {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    padding: 2px 6px;
    background: var(--b3-theme-background, #f5f5f5);
    border: 1px solid var(--b3-border-color);
    border-radius: 3px;
    min-width: 80px;
    text-align: center;
  }
  .reader-hint__label {
    flex: 1;
    color: var(--b3-theme-on-surface);
  }
  .reader-hint__warn {
    color: var(--b3-theme-error, #d32f2f);
    font-size: 14px;
  }
  .reader-hint__footer {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
    text-align: center;
    border-top: 1px solid var(--b3-border-color);
    padding-top: 8px;
  }
</style>
