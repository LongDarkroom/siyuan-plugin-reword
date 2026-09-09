import { logSwallow } from "../core/safe.ts";
/**
 * 启动空闲等待（2026-09-08 启动卡死修复：从 reader-tab.ts 抽出共用）。
 *
 * 背景：思源布局恢复会直接重建自定义阅读 Tab（早于 restoreSession 的空闲保护），
 * ReaderView onMount 自动开书若不等空闲窗口，25MB 级大书会在启动最密集期
 * （布局恢复 + 词典解析 + 文档 protyle 渲染并发）冻结渲染进程主线程。
 * reader-tab.ts 与 ReaderView.svelte 都要用，放独立模块避免
 * 「reader-tab → ReaderView → reader-tab」循环依赖。
 */

/** 空闲窗口兜底：不支持 requestIdleCallback 或长时间无空闲时，最多等这么久就放行 */
export const LAUNCH_IDLE_FALLBACK_MS = 3000;

/** 让出主线程：等思源启动的密集布局期过去再执行重活（开书 / 会话恢复） */
export function waitForLaunchIdle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as any).requestIdleCallback;
    if (typeof ric === "function") {
      try { ric(() => resolve(), { timeout: LAUNCH_IDLE_FALLBACK_MS }); return; }
      catch (__e) { logSwallow(__e, "reader-launch.ts · requestIdleCallback", "debug"); }
    }
    // 兜底：Electron 旧版 Chromium 可能没有 requestIdleCallback
    setTimeout(resolve, LAUNCH_IDLE_FALLBACK_MS);
  });
}
