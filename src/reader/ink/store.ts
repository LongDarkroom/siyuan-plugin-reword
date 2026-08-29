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

/** 默认笔刷状态（沿用鲸鱼批注的第一个预设） */
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

/** 设置上下文（开新书 / 翻页时调用） */
export function setInkContext(bookId: string, pageIndex: number): void {
  inkContext.set({ bookId, pageIndex });
}

/** 清除所有笔触（debug 用） */
export function clearAllStrokes(): void {
  inkStrokes.set([]);
  activeStroke.set(null);
}
