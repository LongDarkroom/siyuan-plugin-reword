/**
 * bilingual-v2 · 渲染层（兄弟节点方案）
 * ------------------------------------------------------------------
 * 与 v1 最大的结构差异：
 *  v1 把译文 `div` 作为原文 `p` 的**子节点** appendChild 进去
 *     → div 嵌进 <p> 是非法 HTML，且破坏 foliate 的 CFI 文本偏移，
 *       导致标注/批注/高亮/跳转/TTS 串读译文。
 *  v2 把译文作为原文元素的**紧邻兄弟节点**（insertAdjacentElement afterend）
 *     → 原文 <p> 的父节点 / 索引 / 文本偏移完全不变，CFI 零影响；
 *       译文在视觉上仍是「段下对照」（沿用 .reword-bilingual 现有 CSS），
 *       与你截图里「淡色左边线 + 半透明」的外观一模一样。
 *
 * 视觉样式的所有细节（border-left、font-size、opacity、hover）都来自
 * reader-style.ts 的 .reword-bilingual 规则——本文件只负责生成 DOM 结构，
 * 不重复任何样式，因此改版后外观 100% 一致。
 */

import { mdToHtml } from "../../annotation/lute.ts";

export const REWORD_BILINGUAL = "reword-bilingual";
export const REWORD_BILINGUAL_TEXT = "reword-bilingual-text";
export const REWORD_BILINGUAL_FAILED = "reword-bilingual-failed";
export const REWORD_BILINGUAL_FAILED_TEXT = "reword-bilingual-failed-text";
/** 2026-08-31 Phase 3：段落级「用 AI 重译」按钮（hover 译文块时显形） */
export const REWORD_BILINGUAL_AI_REDO = "reword-bilingual-ai-redo";
/** 2026-08-31：段落级「删除此段译文」按钮（hover 译文块时显形，隐藏该段译文） */
export const REWORD_BILINGUAL_HIDE = "reword-bilingual-hide";
/** 2026-09-02：段落级操作工具条（AI 重译 + 删除译文 合并为右上角玻璃药丸） */
export const REWORD_BILINGUAL_ACTIONS = "reword-bilingual-actions";

/** 该原文元素是否已通过「兄弟节点」注入译文（幂等判定） */
export function isTranslatedPeer(el: Element): boolean {
  const sib = el.nextElementSibling;
  return !!(sib && sib.classList && sib.classList.contains(REWORD_BILINGUAL));
}

/**
 * 探测译文是否含 Markdown 结构特征，决定是否走 lute 富文本渲染。
 * 2026-08-31：只有真的含结构才渲染——纯译文（云 API / 硬直译）必须保持
 * textContent，否则译文里偶然出现的 * 、# 会被当成 Markdown 语法误解析。
 * 这样无需新增开关：纯译文行为不变，AI 返回结构化内容时自动美化。
 */
function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  // ① 显式 Markdown 语法
  const hasMdSyntax =
    /^\s{0,3}[-*+]\s+\S/m.test(text) || // 无序列表
    /^\s{0,3}\d+\.\s+\S/m.test(text) || // 有序列表
    /\*\*[^*\n]+\*\*/.test(text) || // 加粗
    /^#{1,6}\s+\S/m.test(text) || // 标题
    /^\s{0,3}>\s+\S/m.test(text) || // 引用
    /`[^`\n]+`/.test(text); // 行内代码
  if (hasMdSyntax) return true;
  // ② 空行分段：说明是有结构的多段内容，交给 lute 渲染成 <p>，
  //    顺带解决「长译文糊成一坨、没有呼吸感」的排版问题。
  return /\n[ \t]*\n/.test(text);
}

/**
 * 构建译文块 DOM（视觉样式由 .reword-bilingual CSS 提供）。
 */
export function buildTranslationEl(
  doc: Document,
  text: string,
  opts?: { showAiRedo?: boolean; showHide?: boolean }
): HTMLElement {
  const div = doc.createElement("div");
  div.className = REWORD_BILINGUAL;
  // data-reword-translated 标记在原文节点（见 injectSibling 调用处）；
  // 译文块自身用 data-translation-mark 供 v2 内部做幂等/排除判定。
  //
  // cfi-inert（2026-08-31 P0 修复）：foliate 内核只认 cfi-inert / cfi-skip
  // 两种属性（epubcfi.js:194、paginator.js:467、overlayer.js:96），
  // 不认 data-translation-mark。缺了它，译文 div 会占据父容器下的 CFI 索引位，
  // 导致后续兄弟段落的 CFI 全部偏移 → 标注/高亮/书签错位、分页把译文算进正文。
  div.setAttribute("data-translation-mark", "1");
  div.setAttribute("cfi-inert", "");

  const span = doc.createElement("span");
  span.className = REWORD_BILINGUAL_TEXT;
  // 富文本译文（AI 返回的 Markdown）走 lute 渲染；纯译文保持 textContent，
  // 避免译文里偶然出现的 * / # 被当成 Markdown 语法误解析。
  // mdToHtml 内部已 SetSanitize(true) 净化，降级路径也会转义 → 两条路都安全。
  if (looksLikeMarkdown(text)) {
    span.innerHTML = mdToHtml(text);
  } else {
    span.textContent = text;
  }
  div.appendChild(span);

  // 2026-09-02：两个操作按钮合并进右上角工具条（.reword-bilingual-actions），
  // 彻底离开左侧竖线区域，避免 hover 左缘时误触「删除译文」。工具条随译文块 hover 淡入，
  // 内部按钮保持普通 flex 子项（不再各自绝对定位）。
  const actions = doc.createElement("div");
  actions.className = REWORD_BILINGUAL_ACTIONS;
  actions.setAttribute("data-translation-mark", "1");
  actions.setAttribute("cfi-inert", "");

  // 2026-08-31 Phase 3：段落级「用 AI 重译」。
  // 默认不显示（靠 CSS hover 译文块时显形），点击走 doc 级事件委托。
  if (opts?.showAiRedo) {
    const btn = doc.createElement("button");
    btn.className = REWORD_BILINGUAL_AI_REDO;
    btn.setAttribute("data-action", "ai-redo");
    btn.setAttribute("data-translation-mark", "1");
    btn.setAttribute("cfi-inert", "");
    btn.type = "button";
    btn.textContent = "✨ AI 重译";
    btn.title = "用 AI 重新翻译本段（覆盖缓存）";
    actions.appendChild(btn);
  }

  // 2026-08-31：段落级「删除此段译文」。hover 译文块时显形，点击隐藏该段译文
  // （从 DOM 移除并记入隐藏集合，injectAll 跳过被隐藏段，不重复注入）。
  if (opts?.showHide) {
    const hbtn = doc.createElement("button");
    hbtn.className = REWORD_BILINGUAL_HIDE;
    hbtn.setAttribute("data-action", "hide");
    hbtn.setAttribute("data-translation-mark", "1");
    hbtn.setAttribute("cfi-inert", "");
    hbtn.type = "button";
    hbtn.textContent = "✕ 删除译文";
    hbtn.title = "隐藏本段译文（重新开启双语可恢复）";
    actions.appendChild(hbtn);
  }

  if (actions.childElementCount > 0) div.appendChild(actions);
  return div;
}

/** 构建失败占位块（静默灰色，无重试按钮，避免界面杂乱） */
export function buildFailedEl(doc: Document): HTMLElement {
  const div = doc.createElement("div");
  div.className = `${REWORD_BILINGUAL} ${REWORD_BILINGUAL_FAILED}`;
  div.setAttribute("data-translation-mark", "1");
  div.setAttribute("cfi-inert", "");
  const span = doc.createElement("span");
  span.className = `${REWORD_BILINGUAL_TEXT} ${REWORD_BILINGUAL_FAILED_TEXT}`;
  span.textContent = "译文暂不可用";
  div.appendChild(span);
  return div;
}

/** doc 级委托去重标记：foliate 翻页会重建 Document，重绑时靠它避免重复 addEventListener */
const AI_REDO_BOUND_FLAG = "__rewordAiRedoBound";

/**
 * 绑定「用 AI 重译」的 doc 级事件委托（幂等）。
 *
 * 为什么不逐个按钮绑 onclick：译文块会随翻页反复重建，逐个绑既慢又容易漏；
 * 委托只需绑一次，且新注入的按钮天然生效。
 *
 * @param handler 收到（译文块元素, 对应原文文本）
 */
export function bindAiRedoDelegation(
  doc: Document,
  handler: (wrap: Element, sourceText: string) => void
): void {
  if (!doc) return;
  const d = doc as any;
  if (d[AI_REDO_BOUND_FLAG]) return;
  d[AI_REDO_BOUND_FLAG] = true;
  doc.addEventListener("click", (e) => {
    const t = e.target as Element | null;
    const btn = t?.closest?.("." + REWORD_BILINGUAL_AI_REDO);
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const wrap = btn.closest("." + REWORD_BILINGUAL);
    if (!wrap) return;
    // 兄弟节点方案：原文是译文块的前一个兄弟
    const src = wrap.previousElementSibling;
    const text = src ? (src.textContent || "").trim() : "";
    if (!text) return;
    handler(wrap, text);
  });
}

/**
 * 兄弟节点注入：原文元素不变，译文作为紧邻其后的兄弟节点插入。
 * - 已注入则跳过（幂等），返回 false
 * - 原文 <p>/<li>/<blockquote> 的父节点关系、子节点索引、文本偏移全部不变 → CFI 稳定
 *
 * 2026-09-05 R6 三态改造：本函数**只做插入，不再打标、不再算样式**。
 *  - 打标移到注入器（injector）：只有「译文非空且插入成功」才打
 *    data-reword-translated；失败段不打标，下一轮才会被重新切出并重试。
 *    旧实现无条件打标，导致失败段被永久当作已译跳过（永久黑洞）。
 *  - 样式计算拆成 readParaStyle / applyAlignment 两步，由注入器做读写分离：
 *    一帧内先连续读 N 段样式（只触发 1 次 layout），再连续写 N 段（写不触发
 *    layout），强制同步布局从 2N 降到 O(1)。
 */
export function injectSibling(paragraphEl: Element, translationEl: HTMLElement): boolean {
  if (isTranslatedPeer(paragraphEl)) return false;
  paragraphEl.insertAdjacentElement("afterend", translationEl);
  return true;
}

/** 译文左侧竖线宽度（CSS 常量；不再运行时读 getComputedStyle） */
const BORDER_LEFT_PX = 2.5;

/** 原文段落的对齐相关样式（读阶段产出） */
export interface ParaStyle {
  padLeft: number;
  textIndent: number;
}

const paraStyleCache = new WeakMap<Element, ParaStyle>();

/**
 * 读阶段：取原文段落的对齐样式（paddingLeft / textIndent）。
 * 按元素缓存，同一元素只算一次。
 */
export function readParaStyle(el: Element): ParaStyle {
  const hit = paraStyleCache.get(el);
  if (hit) return hit;
  const style: ParaStyle = { padLeft: 0, textIndent: 0 };
  try {
    const cs = getComputedStyle(el);
    style.padLeft = parseFloat(cs.paddingLeft) || 0;
    style.textIndent = parseFloat(cs.textIndent) || 0;
  } catch {
    // 某些安全/沙箱环境下 getComputedStyle 不可用，按 0 处理
  }
  paraStyleCache.set(el, style);
  return style;
}

/**
 * 写阶段：把对齐结果写进译文块（纯写，不读任何样式，不触发 layout）。
 *
 * 对齐公式（2026-08-31 确立，R6 保留）：英文文字左缘与译文文字左缘相等 →
 *   marginLeft = 原文 paddingLeft + 原文 textIndent - 译文 borderLeft
 * 译文自身 textIndent / paddingLeft 归零，避免首行与内边距二次缩进。
 * 左侧 2.5px 竖线因此落在左留白里，不挤占正文。
 */
export function applyAlignment(translationEl: HTMLElement, style: ParaStyle): void {
  const marginLeft = style.padLeft + style.textIndent - BORDER_LEFT_PX;
  try {
    translationEl.style.setProperty("margin-left", marginLeft + "px", "important");
    translationEl.style.setProperty("padding-left", "0px", "important");
    translationEl.style.setProperty("text-indent", "0px", "important");
  } catch {
    // 某些安全/沙箱环境下 style 赋值可能不可用，忽略即可
  }
}

/** 移除某段译文兄弟节点（关闭双语 / 重载时），零正文污染 */
export function removeTranslationSibling(paragraphEl: Element): void {
  const sib = paragraphEl.nextElementSibling;
  if (sib && sib.classList && sib.classList.contains(REWORD_BILINGUAL)) {
    sib.remove();
  }
}

/**
 * 稳定段落指纹：与缓存哈希解耦（缓存哈希含 salt + mode），用于「隐藏集合」的
 * 跨会话匹配。基于归一化后的原文（折叠空白、去首尾、转小写）做 FNV-1a。
 * 隐藏判定与隐藏按钮点击必须对同一函数产出同一指纹。
 */
export function segHash(text: string): string {
  const s = (text || "").replace(/\s+/g, " ").trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const HIDE_BOUND_FLAG = "__rewordHideBound";

/**
 * 绑定「删除此段译文」的 doc 级事件委托（幂等，与 bindAiRedoDelegation 同构）。
 * 点击后回传（译文块元素, 对应原文文本），由调用方负责隐藏 + 记入隐藏集合。
 */
export function bindHideDelegation(
  doc: Document,
  handler: (wrap: Element, sourceText: string) => void
): void {
  if (!doc) return;
  const d = doc as any;
  if (d[HIDE_BOUND_FLAG]) return;
  d[HIDE_BOUND_FLAG] = true;
  doc.addEventListener("click", (e) => {
    const t = e.target as Element | null;
    const btn = t?.closest?.("." + REWORD_BILINGUAL_HIDE);
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const wrap = btn.closest("." + REWORD_BILINGUAL);
    if (!wrap) return;
    // 兄弟节点方案：原文是译文块的前一个兄弟
    const src = wrap.previousElementSibling;
    const text = src ? (src.textContent || "").trim() : "";
    if (!text) return;
    handler(wrap, text);
  });
}
