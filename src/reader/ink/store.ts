/**
 * Apple Pencil 墨迹批注 · 状态管理（Svelte store）
 * ----------------------------------------------------------------
 * 当前墨迹模式（off / draw / erase）+ 笔刷 + 颜色 + 线型
 * 笔触列表（按 bookId 隔离）+ active stroke（绘制中）
 *
 * Phase 3 MVP：内存态，不持久化（Phase 4 加 hiword-ink.json 持久化）
 *
 * 不依赖：foliate / siyuan SDK
 */
import { writable, derived, type Writable } from "svelte/store";
import type { InkState, InkStroke, InkMode, InkBrush, InkColor, InkStyle } from "./types";
import { INK_PRESETS } from "./types";

/** 默认笔刷状态（沿用批注模块的第一个预设） */
const defaultState: InkState = {
  mode: "off",
  brush: "ballpoint",
  color: "#facc15",
  style: "solid",
  baseWidth: 2,
  opacity: 1,
};

/** 笔刷 → 默认粗细映射 */
export const BRUSH_BASE_WIDTH: Record<InkBrush, number> = {
  ballpoint: 2,
  pencil: 1.5,
  marker: 6,
  highlighter: 12,
  fountain: 1.2,
  eraser: 0, // 橡皮不走 stroke 路径，单独处理
};

/** 墨迹模式 store */
export const inkState: Writable<InkState> = writable({ ...defaultState });

/** 当前 bookId + pageIndex 的笔触列表 */
export const inkStrokes: Writable<InkStroke[]> = writable([]);

/** 正在绘制的 active stroke（pointerdown → pointerup 期间）*/
export const activeStroke: Writable<InkStroke | null> = writable(null);

/** 当前正在批注的书 / 页（用于按上下文分组笔触） */
export const inkContext: Writable<{ bookId: string; pageIndex: number } | null> = writable(null);

/** 派生：是否在墨迹模式（draw 或 erase）*/
export const isInkMode = derived(inkState, ($s) => $s.mode !== "off");

/** 派生：当前页的笔触 */
export const currentPageStrokes = derived(
  [inkStrokes, inkContext],
  ([$strokes, $ctx]) => {
    if (!$ctx) return [];
    return $strokes.filter(
      (s) => s.bookId === $ctx.bookId && s.pageIndex === $ctx.pageIndex
    );
  }
);

/** 切换墨迹模式（off → draw → erase → off） */
export function cycleInkMode(): void {
  inkState.update((s) => {
    if (s.mode === "off") return { ...s, mode: "draw" };
    if (s.mode === "draw") return { ...s, mode: "erase" };
    return { ...s, mode: "off" };
  });
}

/** 直接设置墨迹模式 */
export function setInkMode(mode: InkMode): void {
  inkState.update((s) => ({ ...s, mode }));
}

/** 选择笔刷（同时重置 baseWidth） */
export function setInkBrush(brush: InkBrush): void {
  inkState.update((s) => ({
    ...s,
    brush,
    baseWidth: BRUSH_BASE_WIDTH[brush],
  }));
}

/** 选择颜色 */
export function setInkColor(color: InkColor): void {
  inkState.update((s) => ({ ...s, color }));
}

/** 选择线型 */
export function setInkStyle(style: InkStyle): void {
  inkState.update((s) => ({ ...s, style }));
}

/** 选择预设 */
export function applyInkPreset(presetIndex: number): void {
  const preset = INK_PRESETS[presetIndex];
  if (!preset) return;
  inkState.set({
    mode: "draw",
    brush: preset.brush,
    color: preset.color,
    style: preset.style,
    baseWidth: preset.baseWidth,
    opacity: preset.opacity,
  });
}

/** 添加笔触到列表 */
export function addStroke(stroke: InkStroke): void {
  inkStrokes.update((arr) => [...arr, stroke]);
}

/** 移除笔触（橡皮用） */
export function removeStroke(strokeId: string): void {
  inkStrokes.update((arr) => arr.filter((s) => s.id !== strokeId));
}

/**
 * 设置上下文（开新书 / 翻页时调用）。
 * 2026-09-04 P0-3 补完：开新书时不再无脑清空 inkStrokes——
 * 持久化层（InkSaver）会在此之前把新书墨迹灌入 inkStrokes。
 * 翻页（同书不同页）也不清空——笔触按 pageIndex 自带上下文，跨页查看。
 *
 * 仍保留「清空后重置」的兜底：调用方明确传 lastSetup = true 时强制清空
 * （用于异常恢复，例如持久化层还没就绪就调了 setInkContext）。
 */
export function setInkContext(bookId: string, pageIndex: number, opts: { reset?: boolean } = {}): void {
  inkContext.set({ bookId, pageIndex });
  if (opts.reset) inkStrokes.set([]);
}

/** 清除所有笔触（debug 用） */
export function clearAllStrokes(): void {
  inkStrokes.set([]);
  activeStroke.set(null);
}

/**
 * 整体替换 inkStrokes（2026-09-04 P0-3 补完）。
 * 用途：持久化层切书时把指定 bookId 的笔触塞进 store。
 * 不触发额外副作用（无 save 回调，调用方自己控节奏）。
 */
export function replaceAllStrokes(strokes: InkStroke[]): void {
  inkStrokes.set([...strokes]);
}

/**
 * 切书时把"内存全局笔触"按 bookId 过滤出来（2026-09-04 P0-3 补完）。
 * 调用方通常是 InkSaver.setStrokesForBook 调此函数。
 */
export function filterStrokesByBook(strokes: readonly InkStroke[], bookId: string): InkStroke[] {
  return strokes.filter((s) => s.bookId === bookId);
}
