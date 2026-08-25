/**
 * 全局编辑会话（2026-08-18，D6 / D8）。
 * ------------------------------------------------------------------
 * 纯逻辑、无 DOM 依赖、无循环引用：
 *  - 不 import index.ts / whale-manager.ts；
 *  - 仅通过运行时全局对象 `WhaleAnnotationManager` 维护 `editorOpen` 工具栏守卫标志；
 *  - 保证「面板内联 / 微阅弹窗 / 文档浮层」同一时刻只有一个编辑会话，
 *    后打开的展示面申请被拒，由调用方提示「已在别处编辑」。
 */

export type EditScope = "panel" | "dialog" | "popover";

let active: EditScope | null = null;

/** 维护工具栏守卫标志（保持 index.ts 原 editorOpen 守卫可用），跨环境安全 */
function setEditorOpen(v: boolean): void {
  try {
    const g: any = typeof globalThis !== "undefined" ? globalThis : {};
    const m = g.WhaleAnnotationManager;
    if (m) m.editorOpen = v;
  } catch { /* ignore */ }
}

/** 申请编辑会话：成功返回 true；已有会话则 false */
export function requestEditSession(scope: EditScope): boolean {
  if (active !== null) return false;
  active = scope;
  setEditorOpen(true);
  return true;
}

/** 释放编辑会话（仅当 scope 是当前持有者才生效） */
export function releaseEditSession(scope: EditScope): void {
  if (active !== scope) return;
  active = null;
  setEditorOpen(false);
}

/** 是否已有其它展示面的编辑会话（exclude 用于排除自身查询） */
export function hasActiveSession(exclude?: EditScope): boolean {
  return active !== null && active !== exclude;
}

/** 当前活动的会话（测试 / 调试用） */
export function currentEditSession(): EditScope | null {
  return active;
}
