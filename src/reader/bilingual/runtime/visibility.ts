/**
 * 双语运行时 · 可见性窗口（L2 runtime）
 * ==================================================================
 * 决定「切哪些分节」与「注入到哪」，替代旧 bilingual-v2.ts:48-78 的
 * isImmediateScreen / isPrefetchAhead。
 *
 * 相对旧实现的变化：
 *  - 旧：逐元素调 getBoundingClientRect() 判「眼前屏 / 后 N 屏」，N 段 = N 次
 *    强制同步布局；且 imm 与 prefetch 两态让同一段在不同时机走不同分支。
 *  - 新：先算分节区间，再对段落做区间归属判断 —— 几何读从 O(N) 降到 O(1)，
 *    且「已译即注入（窗口内）」，不再区分眼前/预取两态。
 */
import type { VisibilityWindow, VisibilityLike, InjectGate } from "../core/types.ts";
import { PRETRANSLATE_DEFAULTS } from "../core/types.ts";

export interface VisibilityOptions {
  /** 当前所在分节（0-based）；无法判定时按 0 处理 */
  getCurrentSection?: () => number;
  /** 窗口基准：流式版式按视口折算后仍落到分节；定版面直接按分节数 */
  basis?: "viewport" | "section";
}

export function createVisibility(opts: VisibilityOptions = {}): VisibilityLike {
  const basis = opts.basis ?? "viewport";

  function current(): number {
    const n = opts.getCurrentSection?.();
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  return {
    currentWindow(): VisibilityWindow {
      const cur = current();
      return {
        fromSection: cur,
        toSection: cur + PRETRANSLATE_DEFAULTS.aheadSections,
        basis,
      };
    },
    /**
     * 该分节是否落在注入闸门内。
     *
     * 注意 sectionIndex < cur 一率放行：用户往回翻时，已经译过的旧分节必须
     * 继续显示译文，否则回翻会看到译文消失。
     */
    withinInjectGate(sectionIndex: number, gate: InjectGate): boolean {
      const cur = current();
      const ahead = gate?.aheadSections ?? PRETRANSLATE_DEFAULTS.aheadSections;
      if (sectionIndex < cur) return true;
      return sectionIndex <= cur + ahead;
    },
  };
}
