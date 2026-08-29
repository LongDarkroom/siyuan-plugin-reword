<script lang="ts">
  /**
   * 阅读器 - 空状态
   * - 4 类：shelf（书架空）/ toc（本章无目录）/ bookmark（无书签）/ search（搜索无结果）
   * - 思源 dock 风格：图标 + 引导文案 + 操作按钮
   */
  export let kind: "shelf" | "toc" | "bookmark" | "search" = "shelf";
  export let onImport: (() => void) | null = null;
  export let onClearSearch: (() => void) | null = null;

  const COPY: Record<string, { icon: string; title: string; hint: string; action: string }> = {
    shelf:    { icon: "📚", title: "还没有导入任何书", hint: "把 EPUB / TXT / Markdown 拖到此处，或点击下方按钮", action: "导入书籍" },
    toc:      { icon: "📑", title: "本章没有目录",       hint: "当前书籍未提供章节大纲",                       action: "" },
    bookmark: { icon: "🔖", title: "还没有书签",          hint: "按 Ctrl/Cmd + B 在当前位置添加书签",            action: "" },
    search:   { icon: "🔍", title: "未找到匹配",          hint: "换个关键词试试",                                 action: "清空搜索" },
  };
  $: copy = COPY[kind];
</script>

<div class="reader-empty">
  <div class="reader-empty__icon">{copy.icon}</div>
  <div class="reader-empty__title">{copy.title}</div>
  <div class="reader-empty__hint">{copy.hint}</div>
  {#if kind === "shelf" && onImport}
    <button class="reader-empty__action" on:click={onImport}>{copy.action}</button>
  {/if}
  {#if kind === "search" && onClearSearch}
    <button class="reader-empty__action" on:click={onClearSearch}>{copy.action}</button>
  {/if}
</div>

<style>
  .reader-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2em;
    color: var(--b3-theme-on-surface);
    text-align: center;
  }
  .reader-empty__icon {
    font-size: 48px;
    opacity: 0.4;
    margin-bottom: 0.5em;
  }
  .reader-empty__title {
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 0.4em;
  }
  .reader-empty__hint {
    font-size: 13px;
    color: var(--b3-theme-on-surface-light, #888);
    margin-bottom: 1em;
  }
  .reader-empty__action {
    padding: var(--reword-space-2) var(--reword-space-4);
    border: 1px solid var(--b3-border-color);
    border-radius: var(--reword-radius-sm);
    background: var(--b3-theme-primary, #4285f4);
    color: var(--b3-theme-on-primary, #fff);
    font-size: 13px;
    cursor: pointer;
    transition: opacity var(--reword-dur-base) var(--reword-ease),
      transform var(--reword-dur-base) var(--reword-ease);
  }
  .reader-empty__action:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
</style>
