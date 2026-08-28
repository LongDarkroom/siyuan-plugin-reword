import { logSwallow } from "../core/safe.ts";
/**
 * AI 面板拖入：A 任务 —— 思源页签 / 文档树拖入识别
 * ------------------------------------------------------------------
 * 思源页签栏的页签头（<li data-id="...">）和文档树节点用 data-id 而非
 * data-node-id，原有的 [data-node-id] 块识别抓不到，导致"页签拖入无反应"。
 * 本模块把识别逻辑抽成纯函数，便于 Node 单测。
 *
 * 识别策略（与 src/index.ts resolveDragDocId 一一对应）：
 *  0. dragstart 全局记录（接口预留：可由 host 在 dragstart 时记录）
 *  1. dataTransfer 自定义类型（siyuan/doc-id 等）
 *  2. text/plain 中 siyuan://documents/<docId> 链接
 *  3. 拖拽源元素 / 祖先 [data-id]，且 ancestor 必须是已知的页签 / 文档树容器
 */

const DOC_CONTAINER_SELECTORS = [
  ".layout-tab-bar",
  ".b3-tab-bar",
  ".layout-tab-container",
  ".sy__file",
  ".file-tree",
  ".b3-list--files",
  ".layout-files",
  '[data-type="FileTree"]',
  ".sy__tree",
  ".sy__fileTree",
];

const CUSTOM_TYPES = [
  // 2026-08-21 实测：思源 v3.x 拖页签时,真文档 ID 在这两个 MIME 类型里
  //  - application/siyuan-tab: 旧版（仍可用,内容是 JSON {id, type} 或纯 ID）
  //  - application/siyuan-document-tab: 新版,JSON 形式更稳定
  "application/siyuan-document-tab",
  "application/siyuan-tab",
  // 兼容其他历史命名
  "siyuan/doc-id",
  "text/x-siyuan-doc",
  "text/x-siyuan-document",
  "siyuan_document_id",
  "application/siyuan-doc",
];

const DOC_ID_RE = /^[a-z0-9-]{14,}$/i;

/** data-id 是否符合"思源文档 ID"格式 */
export function isValidDocId(id: string): boolean {
  return typeof id === "string" && DOC_ID_RE.test(id);
}

/** 解析自定义 MIME 类型中的 docId */
function findDocIdInCustomTypes(dt: DataTransfer): string | null {
  for (const type of CUSTOM_TYPES) {
    let raw = "";
    try {
      raw = dt.getData(type);
    } catch {
      continue;
    }
    if (!raw) continue;
    const trimmed = raw.trim();
    logDiag("[drag-doc-id] 试类型 [" + type + "] 内容=" + trimmed.slice(0, 200));
    if (isValidDocId(trimmed)) return trimmed;
    try {
      const parsed = JSON.parse(trimmed);
      if (isValidDocId(parsed?.id)) return parsed.id;
      if (isValidDocId(parsed?.docId)) return parsed.docId;
      if (isValidDocId(parsed?.rootID)) return parsed.rootID;
      if (isValidDocId(parsed?.rootId)) return parsed.rootId;
    } catch (__swallowErr) { logSwallow(__swallowErr, "drag-doc-id.ts · findDocIdInCustomTypes", "debug"); }
  }
  return null;
}

/** 解析 text/plain 中的 siyuan://documents/<docId> */
function findDocIdInPlain(dt: DataTransfer): string | null {
  let plain = "";
  try {
    plain = dt.getData("text/plain") || "";
  } catch {
    return null;
  }
  const m = plain.match(/siyuan:\/\/documents\/([a-z0-9-]{14,})/i);
  return m ? m[1] : null;
}

/** 判断一个元素是否位于已知的"页签 / 文档树"容器内 */
function isInsideDocContainer(el: HTMLElement): boolean {
  let parent: HTMLElement | null = el;
  while (parent) {
    // 用 duck typing 避免 Node 测试环境无 HTMLElement 全局时报错
    const hasQuerySelector = parent && typeof (parent as any).querySelector === "function";
    const hasMatches = parent && typeof (parent as any).matches === "function";
    if (!hasQuerySelector && !hasMatches) break;
    for (const sel of DOC_CONTAINER_SELECTORS) {
      try {
        if (hasQuerySelector && (parent as any).querySelector(sel)) return true;
        if (hasMatches && (parent as any).matches(sel)) return true;
      } catch (__swallowErr) { logSwallow(__swallowErr, "drag-doc-id.ts · isInsideDocContainer", "debug"); }
    }
    parent = parent.parentElement;
  }
  return false;
}

/** 从拖拽源元素 / 祖先 [data-id] 中提取 docId（要求位于文档容器内） */
function findDocIdInTarget(target: EventTarget | null): string | null {
  const el = (target as HTMLElement | null)?.closest?.("[data-id]") as HTMLElement | null;
  if (!el) return null;
  const id = el.getAttribute("data-id") || "";
  if (!isValidDocId(id)) return null;
  if (!isInsideDocContainer(el)) return null;
  // 思源 v3.x 关键发现：页签 li 的 data-id 是 tab/session 内部 ID（不在 blocks 表），
  // 真正的文档根 ID 挂在同 layout 容器内的 .protyle[data-id] 上。
  // 优先尝试从 protyle 兄弟节点拿真 docId，fallback 才用 tab 自身的 data-id。
  const protyleDocId = findProtyleDocId(el);
  if (protyleDocId) {
    logDiag("[drag-doc-id] findProtyleDocId 命中: tab-data-id=" + id + " → protyle-data-id=" + protyleDocId);
    return protyleDocId;
  }
  // 兜底诊断：找不到 protyle 时,把祖先链 8 层 + 同级 .protyle 搜索结果都打出来
  logDiag("[drag-doc-id] findProtyleDocId 未命中,fallback 用 tab 自身的 data-id=" + id);
  logDiag("[drag-doc-id] tab 祖先链 8 层: " + describeAncestors(el, 8));
  return id;
}

/**
 * 从页签/文档树节点向上找 .layout-tab-container 内的 .protyle[data-id]。
 * 思源 v3.x 布局结构（实测推断,2026-08-21 待确认）：
 *   <div class="layout-tab-container fn__flex-1">
 *     <ul class="layout-tab-bar">  ← 里有 li[data-id="tab-id"]（无效,不是 blocks ID）
 *     <div class="protyle" data-id="真根 ID">  ← 才是 blocks 表里的 docId
 *   </div>
 *
 * 2026-08-21 v3：找 4 种真实思源页签容器可能类名,打印每种尝试结果。
 */
function findProtyleDocId(tabEl: HTMLElement): string | null {
  // 候选容器类名(思源 v3.x 常见命名),逐个尝试
  const containerSelectors = [
    ".layout-tab-container",
    ".fn__flex-1",
    ".layout__center",        // 备用
    ".sy__layout",            // 备用
  ];

  for (const sel of containerSelectors) {
    let container: HTMLElement | null = tabEl as HTMLElement;
    for (let i = 0; i < 10 && container; i++) {
      if (container.classList?.contains(sel.replace(".", ""))) break;
      container = container.parentElement;
    }
    if (!container) continue;
    // 在容器内找 .protyle[data-id]（数据是 protyle 的根 block ID）
    const protyleEl = container.querySelector?.(".protyle[data-id]") as HTMLElement | null;
    if (protyleEl) {
      const id = protyleEl.getAttribute("data-id") || "";
      logDiag(
        "[drag-doc-id] 容器 " + sel + " → .protyle[data-id]=" + id +
        " (length=" + id.length + ")"
      );
      if (isValidDocId(id)) return id;
    } else {
      // 容器找到了但里面没 .protyle[data-id]：可能类名错了或 protyle 没 data-id
      // 看看容器里都有什么 .protyle
      const protyles = container.querySelectorAll?.(".protyle") || [];
      const protylesWithDataId = Array.from(protyles).map(p => ({
        tag: p.tagName,
        className: (p.className || "").toString().slice(0, 30),
        dataId: p.getAttribute("data-id"),
      }));
      logDiag(
        "[drag-doc-id] 容器 " + sel + " 找到但 .protyle[data-id] 缺失" +
        ",该容器内 .protyle 数=" + protyles.length +
        " 详情=" + JSON.stringify(protylesWithDataId)
      );
    }
  }
  return null;
}

/**
 * 统一入口：从 DragEvent 中提取 docId。
 * @returns 文档 ID 或 null
 */
export function extractDocIdFromDrag(e: DragEvent): string | null {
  if (!e.dataTransfer) {
    logDiag("[drag-doc-id] 无 dataTransfer,返回 null");
    return null;
  }
  // 1) 自定义类型
  const fromCustom = findDocIdInCustomTypes(e.dataTransfer);
  if (fromCustom) {
    logDiag("[drag-doc-id] 策略1命中(自定义类型): " + fromCustom);
    return fromCustom;
  }
  // 2) text/plain
  const fromPlain = findDocIdInPlain(e.dataTransfer);
  if (fromPlain) {
    logDiag("[drag-doc-id] 策略2命中(text/plain siyuan://documents/): " + fromPlain);
    return fromPlain;
  }
  // 3) DOM 元素 [data-id]（页签/文档树节点）
  const targetEl = (e.target as HTMLElement | null);
  const closestDataId = targetEl?.closest?.("[data-id]") as HTMLElement | null;
  logDiag(
    "[drag-doc-id] 策略3详情: target.tagName=" +
      (targetEl?.tagName || "null") +
      " target.className=" + (targetEl?.className || "null") +
      " closest[data-id]=" + (closestDataId?.getAttribute("data-id") || "null") +
      " 所在 chain=" + (closestDataId ? describeAncestors(closestDataId) : "n/a")
  );
  const fromTarget = findDocIdInTarget(e.target);
  if (fromTarget) {
    logDiag("[drag-doc-id] 策略3命中(页签/文档树 [data-id]): " + fromTarget);
    return fromTarget;
  }
  logDiag("[drag-doc-id] 全部策略未命中,返回 null");
  return null;
}

/** 描述元素祖先链(类名),便于诊断真实思源页签 DOM 结构 */
function describeAncestors(el: HTMLElement, maxDepth: number = 6): string {
  const parts: string[] = [];
  let p: HTMLElement | null = el;
  let depth = 0;
  while (p && depth < maxDepth) {
    const cls = p.className && typeof p.className === "string" ? p.className : "";
    const tag = p.tagName || "";
    const idAttr = p.getAttribute?.("data-id");
    parts.push(`${tag}#${idAttr || ""}.${cls.slice(0, 40)}`);
    p = p.parentElement;
    depth++;
  }
  return parts.join(" < ");
}

import { getLogger } from "../core/logger.ts";

function logDiag(msg: string): void {
  // 双通道: console 给浏览器控制台 / logger 给 plugin log viewer
  try { console.log("[REword]", msg); } catch (__swallowErr) { logSwallow(__swallowErr, "drag-doc-id.ts · logDiag", "debug"); }
  try { getLogger().info(msg); } catch (__swallowErr) { logSwallow(__swallowErr, "drag-doc-id.ts · logDiag", "debug"); }
}

/** 测试辅助：暴露默认 doc 容器选择器列表 */
export const DOC_CONTAINERS = DOC_CONTAINER_SELECTORS;
