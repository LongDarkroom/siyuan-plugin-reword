<script lang="ts">
  /**
   * 阅读器 - 加载状态
   * - 全屏遮罩 + 居中 spinner + 进度百分比
   * - 分段加载显示（解析 EPUB / 索引章节 / 预渲染 / 完成）
   * - 加载超时（>30s）显示重试 / 取消
   */
  export let stage: "parsing" | "indexing" | "rendering" | "done" = "parsing";
  export let progress: number = 0;
  export let onCancel: (() => void) | null = null;
  export let onRetry: (() => void) | null = null;

  const STAGE_COPY: Record<string, string> = {
    parsing:   "正在解析 EPUB",
    indexing:  "正在索引章节",
    rendering: "正在预渲染",
    done:      "完成",
  };
  $: stageLabel = STAGE_COPY[stage] || "";
  $: showTimeout = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  $: if (typeof window !== "undefined") {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { showTimeout = true; }, 30000);
  }
</script>

<div class="reader-loading">
  <div class="reader-loading__spinner" />
  <div class="reader-loading__stage">{stageLabel}</div>
  <div class="reader-loading__bar">
    <div class="reader-loading__bar-fill" style="width: {progress}%" />
  </div>
  <div class="reader-loading__percent">{progress}%</div>
  {#if showTimeout}
    <div class="reader-loading__timeout">
      <span>加载较慢？</span>
      {#if onRetry}
        <button class="reader-loading__btn" on:click={onRetry}>重试</button>
      {/if}
      {#if onCancel}
        <button class="reader-loading__btn" on:click={onCancel}>取消</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .reader-loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--b3-theme-background, #fff);
    z-index: 10;
    gap: 12px;
  }
  .reader-loading__spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--b3-border-color);
    border-top-color: var(--b3-theme-primary, #4285f4);
    border-radius: 50%;
    animation: reader-spin 800ms linear infinite;
  }
  @keyframes reader-spin {
    to { transform: rotate(360deg); }
  }
  .reader-loading__stage {
    font-size: 14px;
    color: var(--b3-theme-on-surface);
  }
  .reader-loading__bar {
    width: 240px;
    height: 4px;
    background: var(--b3-border-color);
    border-radius: 2px;
    overflow: hidden;
  }
  .reader-loading__bar-fill {
    height: 100%;
    background: var(--b3-theme-primary, #4285f4);
    transition: width 200ms ease-out;
  }
  .reader-loading__percent {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .reader-loading__timeout {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
    font-size: 13px;
  }
  .reader-loading__btn {
    padding: 4px 12px;
    border: 1px solid var(--b3-border-color);
    border-radius: 4px;
    background: var(--b3-theme-surface, #fff);
    color: var(--b3-theme-on-surface);
    font-size: 12px;
    cursor: pointer;
  }
  .reader-loading__btn:hover { background: var(--b3-theme-surface-lighter, #f5f5f5); }
</style>
