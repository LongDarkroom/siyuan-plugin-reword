/**
 * AI 面板部件 · 输入区拖拽拉伸 + chevron 收展
 * ---------------------------------------------------------------------------
 * P2 部件化：自 ai-panel.ts 的 bind() 机械搬出（原 L3420-3541），零行为变更。
 * 依赖只经显式 ctx 传入，不再靠 1840 行闭包的隐式作用域。
 *
 * 注意：pointermove / pointerup 走 panel.disposables 注册（随面板销毁统一解绑）；
 * 而 document.removeEventListener 在 onResizeEnd 里手动解绑——这是搬移前的既有
 * 写法，为保持零行为变更原样保留。
 */
import type { AiBindCtx } from "../ai-bind-ctx.ts";
import { logSwallow } from "../../core/safe.ts";

export function bindResizer(ctx: AiBindCtx): void {
    /* ========== 输入区向上拖拽拉伸 + 2026-08-22 新增：chevron 点击收展 ========== */
    const resizer = ctx.contentEl.querySelector("#hiword-ai-resizer") as HTMLElement;
    const toggleBtn = ctx.contentEl.querySelector("#hiword-ai-resizer-toggle") as HTMLElement | null;
    const panelEl = ctx.contentEl.querySelector(".hiword-ai-panel") as HTMLElement;
    const MIN_FOOTER_H = 120;
    const FOOTER_H_KEY = "reword-ai-footer-height";
    const COLLAPSE_KEY = "reword-ai-footer-collapsed";  // 2026-08-22 新增

    // 2026-08-22 改：纯函数 applyCollapsedState（吃 localStorage）,便于单测
    const applyCollapsedState = (panel: HTMLElement | null, footer: HTMLElement | null, btn: HTMLElement | null, collapsed: boolean, lastH: number) => {
      if (!panel || !footer || !btn) return;
      if (collapsed) {
        panel.classList.add("hiword-ai-panel--collapsed");
        footer.style.height = "0px";
        footer.style.minHeight = "0";
        footer.style.overflow = "hidden";
        btn.setAttribute("aria-label", "展开输入区");
        btn.textContent = "▴";
      } else {
        panel.classList.remove("hiword-ai-panel--collapsed");
        if (lastH >= MIN_FOOTER_H) footer.style.height = `${Math.round(lastH)}px`;
        footer.style.minHeight = "";
        footer.style.overflow = "";
        btn.setAttribute("aria-label", "收起输入区");
        btn.textContent = "▾";
      }
      try { localStorage.setItem(COLLAPSE_KEY, String(collapsed)); } catch (__swallowErr) { logSwallow(__swallowErr, "ai-panel.ts · applyCollapsedState", "debug"); }
    };

    /** 应用高度并持久化 */
    const applyFooterHeight = (h: number) => {
      if (!ctx.footerEl) return;
      ctx.footerEl.style.height = `${Math.round(h)}px`;
    };
    const savedH = Number(localStorage.getItem(FOOTER_H_KEY) || "0");
    if (savedH >= MIN_FOOTER_H && panelEl) {
      const maxH = Math.max(MIN_FOOTER_H, Math.round(panelEl.clientHeight * 0.6));
      applyFooterHeight(Math.min(savedH, maxH));
    }

    // 2026-08-22 新增：初始化收起态
    let isCollapsed = false;
    try { isCollapsed = localStorage.getItem(COLLAPSE_KEY) === "true"; } catch (__swallowErr) { logSwallow(__swallowErr, "ai-panel.ts · applyFooterHeight", "debug"); }
    if (isCollapsed && ctx.footerEl && panelEl && toggleBtn) {
      applyCollapsedState(panelEl, ctx.footerEl, toggleBtn, true, savedH);
    }

    let dragging = false;
    let startY = 0;
    let startH = 0;
    let rafId = 0;
    let pendingH = 0;

    const doResize = () => {
      rafId = 0;
      if (!ctx.footerEl || !panelEl) return;
      const maxH = Math.max(MIN_FOOTER_H, Math.round(panelEl.clientHeight * 0.6));
      let h = pendingH;
      if (h < MIN_FOOTER_H) h = MIN_FOOTER_H;
      if (h > maxH) h = maxH;
      ctx.footerEl.style.height = `${h}px`;
    };

    const onResizeMove = (ev: PointerEvent) => {
      if (!dragging) return;
      // 向上拖：起始 Y 大于当前 Y → 输入区变高
      const dy = startY - ev.clientY;
      pendingH = startH + dy;
      if (!rafId) rafId = requestAnimationFrame(doResize);
    };

    const onResizeEnd = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("pointermove", onResizeMove);
      document.removeEventListener("pointerup", onResizeEnd);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      resizer.classList.remove("hiword-ai-resizer--active");
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      doResize();
      // 2026-08-22 改：仅在展开态才写 height（避免收起时把 0 写回 localStorage）
      if (!isCollapsed) {
        const finalH = ctx.footerEl ? ctx.footerEl.offsetHeight : 0;
        if (finalH > 0) localStorage.setItem(FOOTER_H_KEY, String(finalH));
      }
    };

    resizer?.addEventListener("pointerdown", (ev: PointerEvent) => {
      ev.preventDefault();
      if (!ctx.footerEl) return;
      dragging = true;
      startY = ev.clientY;
      startH = ctx.footerEl.offsetHeight;
      ctx.panel.disposables.addEventListener(document, "pointermove", onResizeMove);
      ctx.panel.disposables.addEventListener(document, "pointerup", onResizeEnd);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "row-resize";
      resizer.classList.add("hiword-ai-resizer--active");
    });

    // 2026-08-22 新增：chevron 点击收展
    toggleBtn?.addEventListener("click", (e) => {
      e.stopPropagation();  // 不触发 resizer 的 pointerdown
      if (!ctx.footerEl || !panelEl || !toggleBtn) return;
      if (!isCollapsed) {
        // 收起前记下当前高度
        const h = ctx.footerEl.offsetHeight;
        if (h >= MIN_FOOTER_H) {
          try { localStorage.setItem(FOOTER_H_KEY, String(h)); } catch (__swallowErr) { logSwallow(__swallowErr, "ai-panel.ts · try { localStorage.setItem(FOOTER_H_KEY, String(h)); }", "debug"); }
        }
        applyCollapsedState(panelEl, ctx.footerEl, toggleBtn, true, h);
        isCollapsed = true;
      } else {
        const lastH = Number(localStorage.getItem(FOOTER_H_KEY) || "0") || MIN_FOOTER_H;
        applyCollapsedState(panelEl, ctx.footerEl, toggleBtn, false, lastH);
        isCollapsed = false;
      }
    });
}
