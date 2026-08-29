<script lang="ts">
  /**
   * Apple Pencil 墨迹批注 · 笔刷工具栏
   * ---------------------------------------------------------------
   * 浮动在 PDF 上方的工具栏，包含：
   *  - 5 种笔刷（圆珠笔/铅笔/马克笔/荧光笔/钢笔）
   *  - 7 色调色板
   *  - 橡皮 / 关闭模式 按钮
   *  - 6 个预设（沿用鲸鱼批注）
   *
   * 仅在 inkState.mode !== 'off' 时显示
   *
   * 不依赖：foliate / siyuan SDK
   */
  import { inkState, setInkBrush, setInkColor, setInkMode, applyInkPreset, cycleInkMode, isInkMode } from "./store";
  import type { InkBrush, InkColor } from "./types";
  import { INK_COLORS, INK_PRESETS } from "./types";

  /** 5 种笔刷图标（用 emoji 占位，正式可换 SVG） */
  const BRUSH_LABELS: Record<InkBrush, { icon: string; label: string }> = {
    ballpoint: { icon: "🖊️", label: "圆珠笔" },
    pencil: { icon: "✏️", label: "铅笔" },
    marker: { icon: "🖍️", label: "马克笔" },
    highlighter: { icon: "🟨", label: "荧光笔" },
    fountain: { icon: "🖋", label: "钢笔" },
    eraser: { icon: "🧽", label: "橡皮" },
  };

  const BRUSHES: InkBrush[] = ["ballpoint", "pencil", "marker", "highlighter", "fountain"];
</script>

{#if $isInkMode}
  <div class="ink-toolbar" role="toolbar" aria-label="PDF 墨迹批注工具栏">
    <!-- 笔刷选择 -->
    <div class="ink-group" title="笔刷">
      {#each BRUSHES as brush (brush)}
        <button
          class="ink-btn"
          class:ink-active={$inkState.brush === brush && $inkState.mode === "draw"}
          title={BRUSH_LABELS[brush].label}
          on:click={() => { setInkBrush(brush); setInkMode("draw"); }}
        >{BRUSH_LABELS[brush].icon}</button>
      {/each}
    </div>

    <!-- 颜色选择 -->
    <div class="ink-group" title="颜色">
      {#each INK_COLORS as color (color)}
        <button
          class="ink-color"
          class:ink-active={$inkState.color === color && $inkState.mode === "draw"}
          style="background:{color}"
          title={color}
          on:click={() => { setInkColor(color); setInkMode("draw"); }}
        ></button>
      {/each}
    </div>

    <!-- 橡皮 -->
    <div class="ink-group" title="工具">
      <button
        class="ink-btn"
        class:ink-active={$inkState.mode === "erase"}
        title="橡皮"
        on:click={() => setInkMode("erase")}
      >{BRUSH_LABELS.eraser.icon}</button>
      <button
        class="ink-btn"
        title="关闭墨迹模式"
        on:click={() => setInkMode("off")}
      >✕</button>
    </div>

    <!-- 预设快捷（收起的下拉示意） -->
    <div class="ink-presets" title="预设">
      {#each INK_PRESETS as preset, i (i)}
        <button
          class="ink-preset"
          style="background:{preset.color}"
          title={preset.name}
          on:click={() => applyInkPreset(i)}
        ></button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .ink-toolbar {
    position: absolute;
    top: 56px;
    right: 12px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    background: var(--b3-theme-surface, #fff);
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
    border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    user-select: none;
  }
  .ink-group {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .ink-btn {
    width: 32px;
    height: 32px;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
    background: var(--b3-theme-background, #fafafa);
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    /* iPad 触摸区 ≥44px（HIG）— Phase 2 触屏优化 */
    min-width: 44px;
    min-height: 44px;
  }
  .ink-btn.ink-active {
    background: var(--b3-theme-primary, #378add);
    color: #fff;
    border-color: var(--b3-theme-primary, #378add);
  }
  .ink-color {
    width: 24px;
    height: 24px;
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    background-clip: content-box !important;
  }
  .ink-color.ink-active {
    border-color: var(--b3-theme-primary, #378add);
  }
  .ink-presets {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ink-preset {
    width: 20px;
    height: 20px;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
    border-radius: 4px;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    background-clip: content-box !important;
  }
</style>
