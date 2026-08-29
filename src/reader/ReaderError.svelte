<script lang="ts">
  /**
   * 阅读器 - 错误状态
   * - 4 类：parse（解析失败）/ notFound（文件不存在）/ permission（权限不足）/ memory（内存不足）
   * - 错误详情可折叠 + 重试按钮 + 错误日志入口
   */
  export let kind: "parse" | "notFound" | "permission" | "memory" = "parse";
  export let detail: string = "";
  export let onRetry: (() => void) | null = null;
  export let onOpenLog: (() => void) | null = null;

  let expanded = false;
  const COPY: Record<string, { icon: string; title: string; hint: string }> = {
    parse:      { icon: "⚠️", title: "解析失败",         hint: "书籍文件可能损坏或格式不兼容" },
    notFound:   { icon: "🔍", title: "文件不存在",       hint: "书籍文件已被移动或删除" },
    permission: { icon: "🔒", title: "权限不足",         hint: "无法读取书籍文件" },
    memory:     { icon: "💾", title: "内存不足",         hint: "书籍过大，建议先关闭其他标签页" },
  };
  $: copy = COPY[kind];
</script>

<div class="reader-error">
  <div class="reader-error__icon">{copy.icon}</div>
  <div class="reader-error__title">{copy.title}</div>
  <div class="reader-error__hint">{copy.hint}</div>
  <div class="reader-error__actions">
    {#if onRetry}
      <button class="reader-error__btn reader-error__btn--primary" on:click={onRetry}>重试</button>
    {/if}
    {#if onOpenLog}
      <button class="reader-error__btn" on:click={onOpenLog}>查看日志</button>
    {/if}
  </div>
  {#if detail}
    <details class="reader-error__details" bind:open={expanded}>
      <summary>错误详情</summary>
      <pre>{detail}</pre>
    </details>
  {/if}
</div>

<style>
  .reader-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2em;
    color: var(--b3-theme-on-surface);
    text-align: center;
  }
  .reader-error__icon {
    font-size: 48px;
    margin-bottom: 0.5em;
  }
  .reader-error__title {
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 0.4em;
    color: var(--b3-theme-error, #d32f2f);
  }
  .reader-error__hint {
    font-size: 13px;
    color: var(--b3-theme-on-surface-light, #888);
    margin-bottom: 1em;
  }
  .reader-error__actions {
    display: flex;
    gap: 8px;
    margin-bottom: 1em;
  }
  .reader-error__btn {
    padding: var(--reword-space-2) var(--reword-space-4);
    border: 1px solid var(--b3-border-color);
    border-radius: var(--reword-radius-sm);
    background: var(--b3-theme-surface, #fff);
    color: var(--b3-theme-on-surface);
    font-size: 13px;
    cursor: pointer;
    transition: opacity var(--reword-dur-base) var(--reword-ease);
  }
  .reader-error__btn--primary {
    background: var(--b3-theme-primary, #4285f4);
    color: var(--b3-theme-on-primary, #fff);
  }
  .reader-error__btn:hover {
    opacity: 0.9;
  }
  .reader-error__details {
    max-width: 600px;
    width: 100%;
    text-align: left;
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .reader-error__details summary {
    cursor: pointer;
    margin-bottom: 6px;
  }
  .reader-error__details pre {
    background: var(--b3-theme-background, #fafafa);
    padding: var(--reword-space-2);
    border-radius: var(--reword-radius-sm);
    overflow: auto;
    max-height: 200px;
    margin: 0;
  }
</style>
