import { logSwallow } from "../core/safe.ts";
/**
 * AI 面板拖入：拖拽源识别（文档 / 块）
 * ------------------------------------------------------------------
 * 思源页签栏的页签头（<li data-id="...">）和文档树节点用 data-id 而非
 * data-node-id，原有的 [data-node-id] 块识别抓不到，导致"页签拖入无反应"。
 * 本模块把识别逻辑抽成纯函数，便于 Node 单测。
 *
 * 识别策略（与 src/index.ts resolveDragDocId 一一对应）：
 *  0. dragstart 全局记录（由 host 在 dragstart 时记录，最可信）
 *  1. dataTransfer 自定义类型（siyuan/doc-id 等）
 *  2. text/plain 中 siyuan://documents/<docId> 链接
 *  3. 拖拽源元素 / 祖先 [data-id]，且 ancestor 必须是已知的页签 / 文档树容器
 *
 * ==================================================================
 * 2026-09-02 P0 修复（AI 读不到拖入内容的根因）
 * ==================================================================
 * ⚠️ drop 事件的 e.target 恒为「放置目标」（AI 面板自己），按 DOM 规范
 *    不可能是被拖的页签 / 文档树节点。旧实现却用 e.target 反推拖拽源，
 *    于是顺着 AI 面板往上找，抓到的是 REword dock 面板自身的 UUID：
 *      - 拖「文本块」→ 被判成「拖页签」，真块 ID 被丢弃
 *      - 抓到的 UUID 在 blocks 表里 0 行 → 文档正文为空 → AI 收不到任何内容
 *    修复：策略 3 必须显式传入 dragstart 记录的源元素；没有源元素一律返回 null。
 *
 * 同时修掉两个放大器：
 *   - isInsideDocContainer 旧用 parent.querySelector(sel) 做后代查询，
 *     走到 body 时 body.querySelector(".layout-tab-bar") 必然存在 → 过滤器恒真。
 *   - findProtyleDocId 循环 10 层找容器，走完没匹配仍把"最后一个非 null 祖先"
 *     当容器用；且命中的可能是 REword 自己的输入框 protyle（data-id 为 null）。
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

/** 只有源元素位于页签栏内时，才允许用「同布局的 protyle」反查真文档 ID */
const TAB_BAR_SELECTORS = [".layout-tab-bar", ".b3-tab-bar"];

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

/** 8-4-4-4-12 的 UUID 形态。思源块 ID 是 YYYYMMDDHHmmss-xxxxxx，绝不长这样 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 是否为 UUID 形态（思源布局 / dock 面板自身的 id 常是这种，不是块 ID） */
export function looksLikeUuid(id: string): boolean {
  return typeof id === "string" && UUID_RE.test(id);
}

/** data-id 是否符合"思源文档 ID"格式 */
export function isValidDocId(id: string): boolean {
  return typeof id === "string" && DOC_ID_RE.test(id);
}

/**
 * DOM 猜测路径专用校验：格式合法 **且** 不是 UUID。
 * 仅作用于策略 3（从 DOM 猜），策略 1/2 的 dataTransfer 显式数据仍按原规则信任。
 */
function isPlausibleDomDocId(id: string): boolean {
  return isValidDocId(id) && !looksLikeUuid(id);
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

/**
 * 判断一个元素是否位于已知的"页签 / 文档树"容器内。
 *
 * 2026-09-02 修复：旧实现用 parent.querySelector(sel) 做**后代**查询，
 * 向上走到 body 时 querySelector(".layout-tab-bar") 几乎必然命中 → 过滤器恒真。
 * 改为对每一层祖先自身做 matches() 判断。
 */
function isInsideDocContainer(el: HTMLElement): boolean {
  let parent: HTMLElement | null = el;
  while (parent) {
    if (typeof (parent as any).matches !== "function") break;
    for (const sel of DOC_CONTAINER_SELECTORS) {
      try {
        if ((parent as any).matches(sel)) return true;
      } catch (__swallowErr) { logSwallow(__swallowErr, "drag-doc-id.ts · isInsideDocContainer", "debug"); }
    }
    parent = parent.parentElement;
  }
  return false;
}

/** 自身或任一祖先匹配给定选择器组 */
function closestMatchesSelf(el: HTMLElement, selector: string): boolean {
  let p: HTMLElement | null = el;
  while (p && typeof (p as any).matches === "function") {
    try {
      if ((p as any).matches(selector)) return true;
    } catch (__swallowErr) { logSwallow(__swallowErr, "drag-doc-id.ts · closestMatchesSelf", "debug"); }
    p = p.parentElement;
  }
  return false;
}

/**
 * 从拖拽源元素 / 祖先 [data-id]（或文档树的 [data-node-id]）中提取 docId。
 * 要求：格式合法 + 非 UUID + 位于文档容器内。
 */
function findDocIdInTarget(source: HTMLElement | null): string | null {
  if (!source || typeof (source as any).closest !== "function") return null;
  // 文档树节点可能只有 data-node-id（其值就是文档 ID）
  const el = (source as any).closest("[data-id],[data-node-id]") as HTMLElement | null;
  if (!el) return null;
  const id = el.getAttribute("data-id") || el.getAttribute("data-node-id") || "";
  // 长度/字符集都不对（连 isValidDocId 都过不了）→ 没得谈
  if (!isValidDocId(id)) {
    logDiag("[drag-doc-id] [data-id] 连基本格式都不符，放弃: " + id);
    return null;
  }
  if (!isInsideDocContainer(el)) {
    logDiag("[drag-doc-id] [data-id]=" + id + " 不在页签/文档树容器内，放弃");
    return null;
  }
  // 思源 v3.x：页签 li 的 data-id 可能是 tab/session 内部 ID（不在 blocks 表），
  // 真正的文档根 ID 挂在同 layout 容器内的 .protyle[data-id] 上。
  // 注意顺序：**先**反查 protyle 再否决 UUID —— 页签自身是 UUID 恰恰是最需要反查的场景。
  const protyleDocId = findProtyleDocId(el);
  if (protyleDocId) {
    logDiag("[drag-doc-id] findProtyleDocId 命中: tab-data-id=" + id + " → protyle-data-id=" + protyleDocId);
    return protyleDocId;
  }
  if (looksLikeUuid(id)) {
    logDiag("[drag-doc-id] 反查未命中且自身是 UUID（dock/布局面板 ID，不是块 ID），放弃: " + id);
    return null;
  }
  logDiag("[drag-doc-id] findProtyleDocId 未命中,用源元素自身的 data-id=" + id);
  return id;
}

/**
 * 从页签元素向上找 .layout-tab-container 内的 .protyle[data-id]。
 *
 * 思源 v3.x 布局结构：
 *   <div class="layout-tab-container fn__flex-1">
 *     <ul class="layout-tab-bar">  ← li[data-id]（可能是 tab 内部 ID）
 *     <div class="protyle" data-id="真根 ID">  ← 才是 blocks 表里的 docId
 *   </div>
 *
 * 2026-09-02 修复三点：
 *   1) 仅当源元素在**页签栏**内才反查 protyle。文档树（.sy__file）里没有同布局
 *      protyle，旧逻辑会一路找到 .sy__layout 再抓"布局里第一个 protyle"→ 拿错文档。
 *   2) 容器匹配加 found 标志：10 层循环走完仍未匹配时不得把最后的祖先当容器用。
 *   3) 排除 REword 自己的输入框 protyle（.hiword-ai-protyle），它的 data-id 为 null。
 */
function findProtyleDocId(tabEl: HTMLElement): string | null {
  if (!closestMatchesSelf(tabEl, TAB_BAR_SELECTORS.join(", "))) {
    logDiag("[drag-doc-id] 源元素不在页签栏内，跳过 protyle 反查（防误命中布局中第一个 protyle）");
    return null;
  }
  const containerSelectors = [
    ".layout-tab-container",
    ".fn__flex-1",
    ".layout__center",        // 备用
    ".sy__layout",            // 备用
  ];

  for (const sel of containerSelectors) {
    let container: HTMLElement | null = tabEl;
    let matched = false;
    for (let i = 0; i < 10 && container; i++) {
      try {
        if (typeof (container as any).matches === "function" && (container as any).matches(sel)) {
          matched = true;
          break;
        }
      } catch (__swallowErr) { logSwallow(__swallowErr, "drag-doc-id.ts · findProtyleDocId", "debug"); }
      container = container.parentElement;
    }
    // 循环走完 / 走到根都没匹配到该容器 → 换下一个候选选择器
    if (!matched || !container) continue;
    // 在容器内找 .protyle[data-id]（数据是 protyle 的根 block ID）
    const protyleEl = container.querySelector?.(
      ".protyle[data-id]:not(.hiword-ai-protyle)"
    ) as HTMLElement | null;
    if (protyleEl) {
      const id = protyleEl.getAttribute("data-id") || "";
      logDiag("[drag-doc-id] 容器 " + sel + " → .protyle[data-id]=" + id + " (length=" + id.length + ")");
      // protyle 自身也可能挂 UUID（dock 面板），同样否决
      if (isPlausibleDomDocId(id)) return id;
      logDiag("[drag-doc-id] protyle data-id 形态可疑（过短或 UUID），放弃: " + id);
    } else {
      const protyles = container.querySelectorAll?.(".protyle") || [];
      const detail = Array.from(protyles).map((p: any) => ({
        tag: p.tagName,
        className: (p.className || "").toString().slice(0, 30),
        dataId: p.getAttribute("data-id"),
      }));
      logDiag(
        "[drag-doc-id] 容器 " + sel + " 找到但无可用 .protyle[data-id]" +
        ",该容器内 .protyle 数=" + protyles.length +
        " 详情=" + JSON.stringify(detail)
      );
    }
  }
  return null;
}

/**
 * dragstart 专用：从**真实拖拽源元素**解析文档 ID。
 *
 * 与 extractDocIdFromDrag 策略 3 的区别：dragstart 的 e.target 才是被拖的元素
 * （drop 的 e.target 是放置目标，不可用于反推来源）。
 *
 * 已排除「拖的是文档正文里的块」这种情况：源元素位于 .protyle-wysiwyg 内时
 * 返回 null，让上层走块引用路径。
 *
 * @returns 文档 ID 或 null
 */
export function resolveDocIdFromDragSource(source: EventTarget | null): string | null {
  const el = (source as HTMLElement | null) ?? null;
  if (!el || typeof (el as any).closest !== "function") return null;
  try {
    // 拖的是文档正文中的块 → 不是文档级拖拽
    if ((el as any).closest("[data-node-id]")?.closest?.(".protyle-wysiwyg")) {
      logDiag("[drag-doc-id] resolveDocIdFromDragSource: 源是文档正文内的块，按块处理");
      return null;
    }
    if ((el as any).closest(".protyle-wysiwyg")) {
      logDiag("[drag-doc-id] resolveDocIdFromDragSource: 源在文档正文内，按块处理");
      return null;
    }
  } catch (__swallowErr) { logSwallow(__swallowErr, "drag-doc-id.ts · resolveDocIdFromDragSource", "debug"); }
  return findDocIdInTarget(el);
}

/**
 * 统一入口：从 DragEvent 中提取 docId。
 *
 * @param e        drop / dragover 事件
 * @param sourceEl **真实拖拽源元素**（由 dragstart 记录）。
 *                 不传则跳过策略 3 —— drop 的 e.target 是放置目标，不可用于反推来源。
 * @returns 文档 ID 或 null
 */
export function extractDocIdFromDrag(
  e: DragEvent,
  sourceEl?: HTMLElement | null
): string | null {
  if (!e.dataTransfer) {
    logDiag("[drag-doc-id] 无 dataTransfer,返回 null");
    return null;
  }
  // 1) 自定义类型（显式数据，可信）
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
  // 3) DOM 元素 [data-id]（页签/文档树节点）—— 必须用显式传入的拖拽源元素
  if (!sourceEl) {
    logDiag(
      "[drag-doc-id] 策略3跳过: 未提供拖拽源元素。" +
      "drop 的 e.target 是放置目标(AI 面板自身),拿它反推来源会误抓 dock 面板 UUID"
    );
    return null;
  }
  logDiag(
    "[drag-doc-id] 策略3详情: sourceEl.tagName=" + (sourceEl.tagName || "null") +
      " sourceEl.className=" + (sourceEl.className || "null")
  );
  const fromSource = findDocIdInTarget(sourceEl);
  if (fromSource) {
    logDiag("[drag-doc-id] 策略3命中(拖拽源 [data-id]): " + fromSource);
    return fromSource;
  }
  logDiag("[drag-doc-id] 全部策略未命中,返回 null");
  return null;
}

/**
 * 把思源 DOM 的 data-type（NodeParagraph / NodeHeading / …）映射成
 * blocks 表里的短类型码（p / h / c / …），用于拖入卡片的差异化图标。
 * 无法映射时返回空串，由调用方回退到 SQL 查询。
 */
export function blockTypeFromDomType(domType?: string | null): string {
  if (!domType) return "";
  const map: Record<string, string> = {
    NodeParagraph: "p",
    NodeList: "l",
    NodeListItem: "i",
    NodeHeading: "h",
    NodeCodeBlock: "c",
    NodeBlockquote: "quote",
    NodeTable: "t",
    NodeMathBlock: "m",
    NodeHTMLBlock: "html",
    NodeSuperBlock: "sb",
    NodeThematicBreak: "tb",
  };
  return map[domType] || "";
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
