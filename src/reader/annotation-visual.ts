import { logSwallow } from "../core/safe.ts";
/**
 * annotation-visual.ts — 阅读面板高亮「视觉层」确定性同步工具
 * -------------------------------------------------------------------
 * 背景：foliate 的删除 API `view.addAnnotation(ann, true)` 是"静默失败"型——
 *       resolveNavigation 失败 / #getOverlayer 找不到（fixed-layout 页码 vs spine index 错位）/
 *       overlayer.remove key 不匹配时都不抛错、直接跳过。REword 此前把"没抛错"当"删成功"，
 *       导致视觉残留永远没有兜底。
 * 思路：不再信任 foliate 删除 API 的返回值，改为直接遍历 `view.renderer.getContents()`
 *       拿到的每个 Overlayer（其 removeBy/hasBy 是 REword 2026-08-24 的 vendor patch），
 *       按 key 精确/宽松匹配强制移除——只要 SVG 还在 DOM 里就一定能移除，
 *       完全绕开 resolveNavigation → #getOverlayer(index) 的 index 匹配体系。
 * 删除是否"成功"以实际移除数为准。
 */

type Listener = (bookId: string) => void;

/** 模块级事件桥：dock 批注面板等"旁路删除"后广播，各 ReaderView 订阅后执行 reconcile */
const annChangedListeners = new Set<Listener>();

export function subscribeAnnotationsChanged(fn: Listener): () => void {
  annChangedListeners.add(fn);
  return () => {
    annChangedListeners.delete(fn);
  };
}

export function notifyAnnotationsChanged(bookId: string): void {
  for (const fn of [...annChangedListeners]) {
    try {
      fn(bookId);
    } catch (__swallowErr) { logSwallow(__swallowErr, "annotation-visual.ts · notifyAnnotationsChanged", "debug"); }
  }
}

/** 与 ReaderView.onShowAnnotation 一致的宽松归一化（去 epubcfi() 包装、去尾部括号） */
export function normCfi(s: unknown): string {
  return String(s || "").replace(/^epubcfi\(/i, "").replace(/\)+$/, "");
}

/**
 * 宽松 CFI 匹配（与 onShowAnnotation 1472-1477 完全一致）。
 * 先严格相等，再兜底"互为前缀"——foliate 内部存储的 cfi 与 annStore 持有的 cfi
 * 可能因 epubcfi() 包装 / normalize 差异而不完全相同，但必然共享公共前缀。
 */
export function cfiMatch(a: string, b: string): boolean {
  const na = normCfi(a), nb = normCfi(b);
  return na === nb || (!!(na && nb) && (na.startsWith(nb) || nb.startsWith(na)));
}

/** 收集当前所有已渲染 overlay（含 scroll/fixed-layout 下 index=页码 的 content） */
export function overlayersOf(view: any): Array<{ overlayer: any; doc: any }> {
  try {
    return (view?.renderer?.getContents?.() ?? [])
      .filter((c: any) => c && c.overlayer)
      .map((c: any) => ({ overlayer: c.overlayer, doc: c.doc }));
  } catch {
    return [];
  }
}

/** 按 cfi 探测是否存在（只读，无副作用）。使用宽松匹配（与 onShowAnnotation 一致）。 */
export function hasOverlayKey(view: any, cfi: string): boolean {
  if (!view || !cfi) return false;
  for (const { overlayer } of overlayersOf(view)) {
    if (typeof overlayer?.hasBy !== "function") continue;
    try {
      if (overlayer.hasBy((key: string) => cfiMatch(key, cfi))) return true;
    } catch (__swallowErr) { logSwallow(__swallowErr, "annotation-visual.ts · hasOverlayKey", "debug"); }
  }
  return false;
}

/** 按 cfi 强制移除视觉高亮（遍历所有已渲染 overlay，绕开 index 匹配）。使用宽松匹配。返回移除条数。 */
export function eraseOverlayKey(view: any, cfi: string): number {
  if (!view || !cfi) return 0;
  let removed = 0;
  for (const { overlayer } of overlayersOf(view)) {
    if (typeof overlayer?.removeBy !== "function") continue;
    try {
      removed += overlayer.removeBy((key: string) => cfiMatch(key, cfi));
    } catch (__swallowErr) { logSwallow(__swallowErr, "annotation-visual.ts · eraseOverlayKey", "debug"); }
  }
  return removed;
}

interface BookAnnotationsLike {
  getByBook(bookId: string): Array<{ cfi?: string; deletedAt?: string }>;
}

/**
 * 全量 reconcile：数据中活跃（未软删）的 cfi 集合来自 annStore.getByBook(bookId)，
 * 凡 overlay 中已存在但集合里没有的 key，一律 removeBy 强制移除。
 * 使用宽松 CFI 匹配（与 onShowAnnotation 一致），避免因 cfi 格式差异导致
 * 活跃高亮被误删或残留高亮漏删。返回移除条数。
 */
export function syncVisualWithStore(view: any, annStore: BookAnnotationsLike | null | undefined, bookId: string): number {
  if (!view || !annStore || !bookId) return 0;
  let activeCfis: string[] = [];
  try {
    activeCfis = (annStore.getByBook(bookId) ?? [])
      .filter((it: any) => !it.deletedAt && it.cfi)
      .map((it: any) => it.cfi as string);
  } catch {
    return 0;
  }
  // 对每个 overlay key：若不宽松匹配任何活跃 cfi → 移除
  const isActive = (key: string) => activeCfis.some((ac) => cfiMatch(key, ac));
  let removed = 0;
  for (const { overlayer } of overlayersOf(view)) {
    if (typeof overlayer?.removeBy !== "function") continue;
    try {
      removed += overlayer.removeBy((key: string) => !isActive(key));
    } catch (__swallowErr) { logSwallow(__swallowErr, "annotation-visual.ts · isActive", "debug"); }
  }
  return removed;
}

/**
 * 核选项：清空所有已渲染 overlay 的全部 SVG 内容，然后触发 create-overlay 重绘。
 * 完全不依赖 CFI 匹配——适用于 CFI 格式差异导致常规删除全部失败的极端场景。
 * 重绘时 onCreateOverlay 只会遍历 annStore.getByBook() 的活跃项（过滤 deletedAt），
 * 所以软删的高亮不会重新出现。返回清除的 overlay 数量。
 */
export function nukeAndRedrawOverlays(view: any): number {
  if (!view) return 0;
  let nuked = 0;
  for (const { overlayer } of overlayersOf(view)) {
    if (typeof overlayer?.removeBy !== "function") continue;
    try {
      // removeBy(() => true) 删除该 overlay 中所有 annotation
      const count = overlayer.removeBy(() => true);
      nuked += (count > 0 ? 1 : 0);
    } catch (__swallowErr) { logSwallow(__swallowErr, "annotation-visual.ts · nukeAndRedrawOverlays", "debug"); }
  }
  // 触发 foliate 的 create-overlay 事件 → onCreateOverlay 回调重绘所有活跃标注
  try {
    view.dispatchEvent(new CustomEvent('create-overlay', { detail: {} }));
  } catch (__swallowErr) { logSwallow(__swallowErr, "annotation-visual.ts · nukeAndRedrawOverlays", "debug"); }
  return nuked;
}
