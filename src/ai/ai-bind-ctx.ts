/**
 * AI 面板「部件绑定上下文」（P2 部件化）
 * ---------------------------------------------------------------------------
 * bind() 原是一个 1840 行的巨型闭包，14 个互不相干的 UI 部件靠**隐式作用域**共享
 * DOM 引用与少量回调。这里把共享面收敛成一个显式对象，让每个部件都变成
 * `bindXxx(ctx)` 的独立函数，可单独读、单独改、单独测。
 *
 * 依赖方向：本文件只 `import type` AiPanel（构建期擦除），不产生运行时循环依赖；
 * parts/* 同理。运行时的真实引用在 bind() 里装配。
 */
import type { AiPanel } from "./ai-panel.ts";

export interface AiBindCtx {
  /** 宿主面板：访问 host / chatHistory / activePreset / disposables 等 */
  panel: AiPanel;
  /** 面板内容容器（#hiword-dock-content），所有 querySelector 的根 */
  contentEl: HTMLElement;
  /**
   * bindAbort.signal —— **凡是挂在 document / window 上的监听都必须传它**。
   * 否则每轮 render 都会泄漏监听（2026-09-04 性能修复的机制，见 bindAbort 字段注释）。
   */
  signal: AbortSignal;
  /** 输入区底部容器（#hiword-ai-footer）：resizer 等部件共用 */
  footerEl: HTMLElement | null;
}
