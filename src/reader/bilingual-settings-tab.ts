import { logSwallow } from "../core/safe.ts";
/**
 * 双语翻译设置 - 弹窗控制器（2026-08-31 Phase 4 → 弹窗化）
 * ---------------------------------------------------------------
 * 把「双语翻译设置」从独立 Tab 改为思源原生 Dialog 弹窗：
 * - 命令 / 顶栏按钮 → openBilingualSettingsTab 直接打开弹窗（单例，避免叠加）
 * - 弹窗内复用 BilingualSettingsTab（左侧类目导航 + 右侧参数面板）
 * - 关闭弹窗时 destroyCallback 销毁 Svelte 组件，避免内存泄漏
 * - 已移除独立 Tab 注册（registerBilingualSettingsTab）
 */

// @ts-ignore - Svelte 组件
import BilingualSettingsTab from "./BilingualSettingsTab.svelte";
import { Dialog } from "siyuan";

// 单例句柄：已打开时不再叠加
let activeDialog: any = null;

/** 打开「双语翻译设置」弹窗 */
export async function openBilingualSettingsTab(plugin: any): Promise<void> {
  try {
    // 已存在且仍在 DOM 中 → 直接 return，避免重复弹窗叠加
    if (activeDialog && activeDialog.element?.isConnected) return;

    const content = '<div class="reword-bset-dialog-body"></div>';
    let comp: any = null;

    const dialog: any = new Dialog({
      title: "双语翻译设置",
      content,
      width: "920px",
      height: "680px",
      destroyCallback: () => {
        try {
          comp?.$destroy?.();
        } catch (e) {
          logSwallow(e, "bilingual-settings-tab.ts · destroy", "debug");
        }
        if (activeDialog === dialog) activeDialog = null;
      },
    });
    activeDialog = dialog;

    // 让 Dialog body 撑满并去掉默认内边距，使组件视觉与弹窗边框对齐
    const bodyEl = dialog.element.querySelector(".b3-dialog__body") as HTMLElement | null;
    if (bodyEl) {
      bodyEl.style.display = "flex";
      bodyEl.style.flexDirection = "column";
      bodyEl.style.padding = "0";
      bodyEl.style.overflow = "hidden";
    }

    const target = dialog.element.querySelector(".reword-bset-dialog-body") as HTMLElement | null;
    if (!target) {
      console.warn("[REword] 双语设置弹窗挂载节点缺失");
      dialog.destroy();
      return;
    }
    target.style.display = "flex";
    target.style.flexDirection = "column";
    target.style.minHeight = "0";
    target.style.flex = "1";

    comp = new BilingualSettingsTab({
      target,
      props: {
        // 阅读设置（bilingual* 字段 + 目标语言等）
        settingsStore: plugin.readerDock?.settingsStoreRef,
        // AI / 引擎设置（tencent/baidu/youdao/ai + 配额）
        getAiSettings: () => (plugin as any).getAiSettings?.() ?? null,
        onSaveAiSettings: (partial: any) =>
          (plugin as any).updateAiSettings?.(partial) ?? Promise.resolve(),
        // 缓存管理
        listCachedBooks: () =>
          (plugin as any).listCachedBooks?.() ?? Promise.resolve([]),
        getTranslationCacheStats: (bid: string) =>
          (plugin as any).getTranslationCacheStats?.(bid) ??
          Promise.resolve({ count: 0, cachedPages: 0, pageRangeText: "", title: "" }),
        clearTranslationCache: (bid: string) =>
          (plugin as any).clearTranslationCache?.(bid) ?? Promise.resolve(),
        cleanOrphanTranslationCaches: () =>
          (plugin as any).cleanOrphanTranslationCaches?.() ?? Promise.resolve(0),
        // 引擎测试 / 用量重置
        testEngine: (id: string) =>
          (plugin as any).testTranslationEngine?.(id) ??
          Promise.resolve({ ok: false, error: "未实现" }),
        resetEngineUsage: (id: string) =>
          (plugin as any).resetEngineUsage?.(id) ?? Promise.resolve(),
        resetAiTokenUsage: () =>
          (plugin as any).resetAiTokenUsage?.() ?? Promise.resolve(),
        // 术语表
        getGlossaryTerms: () =>
          (plugin as any).getGlossaryTerms?.() ??
          [] as Array<{ src: string; dst: string; caseSensitive?: boolean; note?: string }>,
        setGlossaryTerms: (terms: any[]) =>
          (plugin as any).setGlossaryTerms?.(terms) ?? Promise.resolve(),
        // 2026-08-31 Task A：双语「按书记忆」模式（列出全部 / 清除某本）
        listBilingualBookModes: () =>
          (plugin as any).listBilingualBookModes?.() ??
          Promise.resolve([] as Array<{ bookId: string; mode: "whole-book" | "progressive"; title: string }>),
        clearBilingualBookMode: (bookId: string) =>
          (plugin as any).clearBilingualBookMode?.(bookId) ?? Promise.resolve(),
      },
    });
  } catch (e) {
    console.warn("[REword] 打开双语设置弹窗失败:", e);
  }
}
