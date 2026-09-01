<script lang="ts">
  /**
   * 书架右键菜单 - 通用轻量组件
   * ----------------------------------------------------------------
   * - 单例:全文档只一个 menu 元素(切换数据时只更新内容)
   * - 子菜单:hover 展开,不需点击
   * - 自动关闭:点击外部 / Esc / 滚轮 / 窗口 resize
   * - 视口边缘 flip:避免超出右/下边界
   *
   * [2026-08-29] P2 书架 I1 改造
   */
  import { onMount, onDestroy, tick } from "svelte";

  export type MenuItem = {
    /** 按钮文字 */
    label?: string;
    /** 前缀 emoji / 字符 */
    icon?: string;
    /** 点击回调 */
    onClick?: () => void;
    /** 嵌套子菜单(hover 展开) */
    children?: MenuItem[];
    /** 分隔线 */
    divider?: boolean;
    /** 危险操作(红色) */
    danger?: boolean;
    /** 禁用 */
    disabled?: boolean;
    /** 当前选中标记(右侧打勾) */
    active?: boolean;
  };

  export let items: MenuItem[] = [];
  export let x: number;
  export let y: number;
  /** 用于暴露给父组件的 close 事件 */
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher<{ close: void }>();

  let menuEl: HTMLDivElement;
  let openSubmenuIdx = -1;
  let submenuPos = { x: 0, y: 0 };
  let adjusted = { x: 0, y: 0 };

  /** 视口边缘 flip:菜单放不下就反向 */
  async function adjustPosition() {
    await tick();
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (rect.right > vw - 8) nx = Math.max(8, vw - rect.width - 8);
    if (rect.bottom > vh - 8) ny = Math.max(8, vh - rect.height - 8);
    adjusted = { x: nx, y: ny };
  }

  onMount(() => {
    adjustPosition();
    // 自动关闭
    setTimeout(() => {
      window.addEventListener("mousedown", onDocClick, true);
      window.addEventListener("keydown", onKey);
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    }, 0);
  });

  onDestroy(() => {
    window.removeEventListener("mousedown", onDocClick, true);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
  });

  function onDocClick(e: MouseEvent) {
    if (!menuEl) return;
    if (e.target instanceof Node && menuEl.contains(e.target)) return;
    close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  export function close() {
    openSubmenuIdx = -1;
    dispatch("close");
  }

  function onItemClick(item: MenuItem) {
    if (item.disabled) return;
    if (item.children?.length) return; // 子菜单只能 hover 展开
    item.onClick?.();
    close();
  }

  function onItemEnter(idx: number, item: MenuItem, e: MouseEvent) {
    if (!item.children?.length) {
      openSubmenuIdx = -1;
      return;
    }
    openSubmenuIdx = idx;
    // 子菜单位置:菜单项右侧,垂直对齐
    const t = e.currentTarget as HTMLElement;
    const tr = t.getBoundingClientRect();
    submenuPos = { x: tr.right + 2, y: tr.top };
  }

  function onItemLeave(e: MouseEvent) {
    const next = e.relatedTarget as Node | null;
    // 如果移到了子菜单内,不关闭
    if (next && menuEl?.contains(next)) return;
    // 200ms 延迟,让用户移到子菜单
    setTimeout(() => {
      if (openSubmenuIdx >= 0) {
        const sub = menuEl?.querySelector(".shelf-menu-submenu:hover");
        if (sub) return;
        openSubmenuIdx = -1;
      }
    }, 150);
  }
</script>

<div
  bind:this={menuEl}
  class="shelf-context-menu"
  style="left:{adjusted.x}px; top:{adjusted.y}px"
  role="menu"
  on:mouseleave={() => (openSubmenuIdx = -1)}
>
  {#each items as item, i (i)}
    {#if item.divider}
      <div class="shelf-menu-divider"></div>
    {:else}
      <button
        type="button"
        class="shelf-menu-item"
        class:danger={item.danger}
        class:disabled={item.disabled}
        class:has-submenu={!!item.children?.length}
        class:active={item.active}
        role="menuitem"
        on:click={() => onItemClick(item)}
        on:mouseenter={(e) => onItemEnter(i, item, e)}
        on:mouseleave={onItemLeave}
      >
        <span class="shelf-menu-icon">{item.icon || ""}</span>
        <span class="shelf-menu-label">{item.label || ""}</span>
        {#if item.active}
          <span class="shelf-menu-check">✓</span>
        {/if}
        {#if item.children?.length}
          <span class="shelf-menu-arrow">▶</span>
        {/if}
      </button>
    {/if}
  {/each}
  {#if openSubmenuIdx >= 0 && items[openSubmenuIdx]?.children}
    <div
      class="shelf-menu-submenu"
      style="left:{submenuPos.x}px; top:{submenuPos.y}px"
      role="menu"
    >
      {#each items[openSubmenuIdx].children as sub, j (j)}
        {#if sub.divider}
          <div class="shelf-menu-divider"></div>
        {:else}
          <button
            type="button"
            class="shelf-menu-item"
            class:danger={sub.danger}
            class:disabled={sub.disabled}
            class:active={sub.active}
            role="menuitem"
            on:click={() => onItemClick(sub)}
          >
            <span class="shelf-menu-icon">{sub.icon || ""}</span>
            <span class="shelf-menu-label">{sub.label || ""}</span>
            {#if sub.active}
              <span class="shelf-menu-check">✓</span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .shelf-context-menu {
    position: fixed;
    z-index: 10000;
    min-width: 180px;
    max-width: 260px;
    background: var(--b3-theme-background, #fff);
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
    padding: 4px 0;
    font-size: 13px;
    color: var(--b3-theme-on-background, #333);
    user-select: none;
  }
  .shelf-menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    background: none;
    border: none;
    padding: 6px 12px;
    cursor: pointer;
    color: inherit;
    font: inherit;
    text-align: left;
    gap: 8px;
    line-height: 1.3;
    white-space: nowrap;
  }
  .shelf-menu-item:hover:not(.disabled) {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.14));
    color: var(--b3-theme-primary, #378add);
  }
  .shelf-menu-item.danger {
    color: var(--b3-theme-error, #e24b4a);
  }
  .shelf-menu-item.danger:hover:not(.disabled) {
    background: rgba(226, 75, 74, 0.12);
    color: var(--b3-theme-error, #e24b4a);
  }
  .shelf-menu-item.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .shelf-menu-item.has-submenu {
    position: relative;
  }
  .shelf-menu-icon {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    font-size: 13px;
  }
  .shelf-menu-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .shelf-menu-arrow {
    flex-shrink: 0;
    font-size: 9px;
    color: var(--b3-theme-on-surface-light, #888);
    margin-left: 8px;
  }
  .shelf-menu-check {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--b3-theme-primary, #378add);
    margin-left: 8px;
  }
  .shelf-menu-divider {
    height: 1px;
    background: var(--b3-border-color, rgba(0, 0, 0, 0.08));
    margin: 4px 0;
  }
  .shelf-menu-submenu {
    position: fixed;
    z-index: 10001;
    min-width: 160px;
    background: var(--b3-theme-background, #fff);
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
    padding: 4px 0;
  }
</style>
