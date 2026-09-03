import { logSwallow } from "../core/safe.ts";
/**
 * REword · AI 结果渲染
 * ------------------------------------------------------------------
 * 把 DeepReadResult 渲染为 dock 面板 HTML：
 *  - 结构化（isJson=true）：重点词卡片（带「收藏」）、逐句讲解（带「批注」）、小结。
 *  - 直出 markdown（isJson=false）：极简 markdown→HTML 渲染。
 * 渲染层只产出 HTML 字符串 + data-* 钩子，交互（收藏/批注）由 ai-panel 绑定。
 */

import type { DeepReadResult } from "./ai-orchestrator.ts";
import { getLogger } from "../core/logger.ts";

export function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 清洗 AI 返回的原始文本（去除思源内部标记和泄漏 HTML）。
 * AI 可能回显用户发送的原始块引用 HTML，需在渲染前剥离。
 */
export function cleanAiResponse(raw: string): string {
  let s = raw;
  // 删除 IAL 属性标记 {: ...}
  s = s.replace(/\{:[^}]*\}/gs, '');
  // 删除残留的 HTML 标签（提取块引用 span 的锚文本）
  s = s.replace(/<[^>]+>/g, (match) => {
    if (/data-type\s*=\s*["']?block-ref["'"]?/i.test(match)) {
      const anchorMatch = match.match(/>([\s\S]*?)<\/span>\s*$/i);
      return anchorMatch ? anchorMatch[1] : '';
    }
    return '';
  });
  // 删除零宽字符
  s = s.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');
  // 删除 HTML 注释
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  return s.trim();
}

/**
 * 用思源 Lute 引擎渲染 Markdown → 思源风格 HTML（对标 Copilot 侧边栏质感）。
 * 输出应放入带 `b3-typography` class 的容器以继承完整排版样式（标题层级 / 列表缩进 /
 * 引用边框 / 代码块主题 / 表格线框等）。
 * window.Lute 在思源运行时全局可用；不可用时回退手写安全渲染器。
 */
// 模块级 Lute 单例（P2-2）：避免每次渲染都 New + 20+ 次 Set* 配置，流式逐 token 重绘时收益显著。
// 仅在首次 window.Lute 就绪时构建一次；若首次调用时 Lute 尚未注入则留空、下次重试（不缓存 null）。
let cachedRenderLute: any = null;
let renderLuteReady = false;
function getRenderLute(): any {
  if (renderLuteReady) return cachedRenderLute;
  if (typeof window === "undefined" || !(window as any).Lute) return null;
  try {
    const lute = (window as any).Lute.New();
    const opt = (name: string, val: boolean) => {
      const fn = (lute as any)[name];
      if (typeof fn === "function") {
        try { fn.call(lute, val); } catch (__swallowErr) { logSwallow(__swallowErr, "ai-render.ts · opt", "debug"); }
      }
    };
    opt("SetSanitize", true);                         // XSS 防护（AI 内容不可信）
    opt("SetInlineMath", true);                       // 行内数学 $...$
    opt("SetInlineMathAllowDigitAfterOpenMarker", true);
    opt("SetMathBlock", true);                        // 块级数学 $$...$$
    opt("SetFootnotes", true);                        // 脚注
    opt("SetToC", true);                              // [toc]
    opt("SetEmoji", true);                             // emoji 短代码
    opt("SetMark", true);                             // ==标记==
    opt("SetTag", true);                              // #标签
    opt("SetSup", true);                             // ^上标^
    opt("SetSub", true);                             // ~下标~
    opt("SetChinesePunctuation", true);               // 中文标点优化
    opt("SetKeepParagraphIndent", true);              // 段首缩进
    opt("SetSetext", true);                           // setext 标题
    opt("SetYamlFrontMatter", true);                  // YAML front matter
    opt("SetBlockRef", true);                         // ((id "anchor")) → 可点击块引用（批注正文还原）
    opt("SetGFMTable", true);                         // GFM 表格（批注笔记常见）
    opt("SetGFMStrikethrough", true);                 // ~~删除线~~
    opt("SetKramdownIAL", true);                      // 保留 IAL {:}
    opt("SetSuperBlock", true);                       // 超级块
    opt("SetCallout", true);                          // 引述/标注块
    cachedRenderLute = lute;
    renderLuteReady = true;
    return lute;
  } catch (e) {
    getLogger().warn("[REword] Lute 实例构建失败", { error: e });
    return null;
  }
}

export function renderWithLute(md: string): string {
  const raw = md || "";
  const lute = getRenderLute();
  if (lute) {
    const text = cleanAiResponse(raw);
    try {
      const html = lute.Md2HTML(text);
      if (html) return html;
    } catch (e) {
      getLogger().warn("[REword] Lute 渲染失败，回退手写渲染器", { error: e });
    }
  }
  // 兜底（无 window.Lute 的环境，如单测）：直接做最小 Markdown 渲染，
  // 其 inline 渲染器会对原始 HTML 转义，避免 <script> 等被原样注入（XSS 防护）
  return renderMarkdown(raw);
}

/**
 * 用思源 Lute 引擎渲染【思源 Kramdown】为富文本 HTML（批注 note / 思源正文）。
 * 与编辑器写入链路一致（Md2BlockDOM），完整支持块引用 ((id))、行内属性 {:}、块属性、
 * ==高亮==、#标签、^上标^、~下标~、公式、表格等思源专有语法；
 * 产物为「标准语义 HTML」（<p>/<h1-6>/<ul>/<table>…），可直接放入 b3-typography 容器。
 *
 * 与 renderWithLute 的区别：
 *  - renderWithLute 面向 AI 返回的【标准 Markdown】，使用 Md2HTML；
 *  - 本函数面向批注 note（SiYuan Kramdown，由编辑器 BlockDOM2Md 写入），
 *    使用 Md2BlockDOM 解析后再转换为标准 HTML，
 *    避免 ((块引用)) / {: 行内属性} 等思源语法在 Md2HTML 路径下被丢弃/显示为源码。
 *
 * 2026-08-29 性能优化（AGENTS.md 4.1）：
 *  - 旧版每次调用都对 Lute 实例跑 20+ 次 Set* opt()，且走 Md2BlockDOM → BlockDOM2Md → Md2HTML
 *    三跳（O(N) 解析三次）。批注面板的 note 渲染是冷路径（一次性），但批注列表里的每条 note
 *    都会触发一次，10 条就是 200+ 次 opt + 30 次 Lute 全量解析。
 *  - 新版：
 *      1) 缓存一个独立 Lute 实例（`getKramdownLute`），只在首次调用时 New() + Set*，
 *         后续复用同一个实例（避免污染思源共享的 window.siyuan.lute）。
 *      2) 入口先调 `hasKramdownSyntax` 检测是否含思源专有语法
 *         （((id))、{:}、{{}}、行首 {: ...} 块属性等）；
 *         没有就走 `renderWithLute`（1 跳），省掉 2/3 解析开销。
 *      3) 有专有语法才走三跳，且复用缓存的 Lute。
 */
export function renderKramdown(md: string): string {
  const raw = md || "";
  if (!hasKramdownSyntax(raw)) {
    // 标准 Markdown 走 1 跳（与 renderWithLute 同路径）
    return renderWithLute(raw);
  }
  const lute = getKramdownLute();
  if (lute) {
    try {
      // Kramdown 走 Md2BlockDOM（与编辑器写入一致）-> BlockDOM2Md 还原标准 Kramdown
      // -> Md2HTML 产出语义 HTML，正确保留 ((块引用)) / {: 行内属性} / {{}} 等思源专有语法；
      // 废弃手写 blockDom2Typo 转换器（D1/D7）。
      const blockDOM = lute.Md2BlockDOM(raw);
      const html = lute.Md2HTML(lute.BlockDOM2Md(blockDOM));
      if (html && html.trim()) return html;
    } catch (e) {
      getLogger().warn("[REword] Lute Kramdown 渲染失败，回退", { error: e });
    }
  }
  // 兜底（无 Lute 的环境）：用标准 Markdown 渲染（块引用等会降级为文本）
  return renderWithLute(raw);
}

/**
 * 检测 md 是否含思源 Kramdown 专有语法（块引用 / IAL / 超级块 / 块属性等）。
 * - 块引用：((id "anchor" 'text')) / ((id "anchor"))
 * - 行内属性 IAL：{: ...}（任何位置）
 * - 块属性 IAL：行首的 {: ...}
 * - 超级块：{{...}}
 *
 * 不查 ^上标^ / ~下标^ / ==高亮== / #标签 — 这些是 Md2HTML 也支持的，1 跳够用。
 * 不查 [toc] / [脚注] / 公式 — 同上。
 *
 * 纯字符串扫描，O(N)，无 Lute 依赖，可在 Node 单测。
 */
export function hasKramdownSyntax(md: string): boolean {
  if (!md) return false;
  // 块引用：(( 紧跟 \w 或 '-'，里面含至少一个空格 / 引号 / 反引号）
  if (/\(\(\s*[\w-]+/m.test(md)) return true;
  // IAL：{: xxx}（任意位置都算）
  if (/\{:[^}\n]*\}/.test(md)) return true;
  // 超级块：{{...}}（多行）
  if (/\{\{[\s\S]*?\}\}/.test(md)) return true;
  return false;
}

/* ------------------------------------------------------------------
 * Kramdown 专用 Lute 实例（私有，不污染思源共享的 window.siyuan.lute）
 * ------------------------------------------------------------------ */

let _kramdownLute: any = null;
let _kramdownLuteTried = false;

function optLute(lute: any, name: string, val: boolean): void {
  const fn = lute?.[name];
  if (typeof fn === "function") {
    try { fn.call(lute, val); } catch (__swallowErr) { logSwallow(__swallowErr, "ai-render.ts · optLute", "debug"); }
  }
}

/** 独立 Lute 实例（首次调用 New() + Set*，后续直接复用） */
function getKramdownLute(): any {
  if (_kramdownLute) return _kramdownLute;
  if (_kramdownLuteTried) return null; // 已尝试但失败，不再重试
  if (typeof window === "undefined" || !(window as any).Lute) {
    _kramdownLuteTried = true;
    return null;
  }
  try {
    const lute = (window as any).Lute.New();
    // 完整 Kramdown 套件（与 renderKramdown 旧版同配置；放在 initOnce 不进热路径）
    optLute(lute, "SetSanitize", true);
    optLute(lute, "SetInlineMath", true);
    optLute(lute, "SetInlineMathAllowDigitAfterOpenMarker", true);
    optLute(lute, "SetMathBlock", true);
    optLute(lute, "SetFootnotes", true);
    optLute(lute, "SetToC", true);
    optLute(lute, "SetEmoji", true);
    optLute(lute, "SetMark", true);
    optLute(lute, "SetTag", true);
    optLute(lute, "SetSup", true);
    optLute(lute, "SetSub", true);
    optLute(lute, "SetBlockRef", true);
    optLute(lute, "SetChinesePunctuation", true);
    optLute(lute, "SetKeepParagraphIndent", true);
    optLute(lute, "SetYamlFrontMatter", true);
    optLute(lute, "SetGFMTable", true);
    optLute(lute, "SetGFMStrikethrough", true);
    optLute(lute, "SetKramdownIAL", true);
    optLute(lute, "SetSuperBlock", true);
    optLute(lute, "SetCallout", true);
    _kramdownLute = lute;
    return lute;
  } catch (e) {
    getLogger().warn("[REword] Kramdown Lute 实例构建失败", { error: e });
    _kramdownLuteTried = true;
    return null;
  }
}

/** 测试用：重置 Kramdown Lute 单例（不用于生产） */
export function __resetKramdownLuteForTest(): void {
  _kramdownLute = null;
  _kramdownLuteTried = false;
}

// 注：手写 blockDom2Typo 转换器（及 convertNode 等辅助）已删除（D1/D7），Kramdown 渲染改由 Lute Md2HTML(BlockDOM2Md(Md2BlockDOM)) 承担（见 renderKramdown）。


/** 递归转换单个节点为标准语义 HTML 片段（字符串） */
function convertNode(node: Element): string {
  if (!(node instanceof HTMLElement)) return node.textContent || "";
  const dataType = node.getAttribute("data-type") || "";
  const tag = node.tagName.toLowerCase();

  switch (dataType) {
    case "NodeDocument":
      return childNodesHtml(node);
    case "NodeParagraph":
      return `<p>${inlineContent(node)}</p>`;
    case "NodeHeading": {
      const level = Math.min(6, Math.max(1, parseInt(node.getAttribute("data-level") || "1", 10)));
      return `<h${level}>${inlineContent(node)}</h${level}>`;
    }
    case "NodeList": {
      const ordered = (node.getAttribute("data-subtype") || "u") === "o";
      return ordered ? `<ol>${childElementsHtml(node)}</ol>` : `<ul>${childElementsHtml(node)}</ul>`;
    }
    case "NodeListItem": {
      // 省略 protyle-action 圆点标记，拼接段落内容与嵌套列表
      let html = "";
      for (const child of Array.from(node.children)) {
        const ct = child.getAttribute("data-type") || "";
        if (ct === "NodeList") { html += convertNode(child); continue; }
        if (child.classList.contains("protyle-action")) continue;
        if (ct === "NodeParagraph") { html += inlineContent(child as HTMLElement); continue; }
        html += convertNode(child);
      }
      return `<li>${html}</li>`;
    }
    case "NodeBlockquote":
      return `<blockquote>${childNodesHtml(node)}</blockquote>`;
    case "NodeCodeBlock":
      return `<pre><code>${escapeHtml(extractText(node))}</code></pre>`;
    case "NodeMathBlock":
      return `<pre class="b3-typography-mathblock">$$${escapeHtml(extractText(node))}$$</pre>`;
    case "NodeThematicBreak":
      return `<hr>`;
    case "NodeTable":
      return convertTable(node);
    default:
      break;
  }

  // 行内语义节点：block-ref / mark / strong / em / code / a / span 等保留（已带语义标签）
  if (["span", "mark", "a", "strong", "em", "code", "sub", "sup", "kbd", "del", "s", "u", "small", "b", "i", "br"]
        .includes(tag)) {
    return serializeInline(node as HTMLElement);
  }
  // 未知块：降级为 div，保留内容
  return `<div>${childNodesHtml(node)}</div>`;
}

/** 处理元素的所有子节点（元素递归转换，文本原样）拼接为 HTML */
function childNodesHtml(node: Element): string {
  return Array.from(node.childNodes)
    .map((c) => (c.nodeType === Node.ELEMENT_NODE ? convertNode(c as Element) : (c.textContent || "")))
    .join("");
}

/** 处理元素的直接子元素（仅元素）拼接为 HTML（用于 NodeList 内部项） */
function childElementsHtml(node: Element): string {
  return Array.from(node.children)
    .map((c) => convertNode(c))
    .join("");
}

/**
 * 取段落/标题内部行内内容：
 * NodeParagraph/NodeHeading 通常含一个 <div contenteditable> 包裹行内内容，
 * 剥除该包裹层后序列化行内节点（block-ref / mark / strong …）。
 */
function inlineContent(node: Element): string {
  const editable = node.querySelector(":scope > div[contenteditable='true']") as HTMLElement | null;
  const src = editable || node;
  return Array.from(src.childNodes)
    .map((c) => (c.nodeType === Node.ELEMENT_NODE ? serializeInline(c as HTMLElement) : (c.textContent || "")))
    .join("");
}

/** 行内节点序列化：保留（白名单）属性，移除编辑态属性 */
function serializeInline(node: HTMLElement): string {
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "<br>";
  const allowedAttrs: Record<string, string[]> = {
    a: ["href", "title", "target", "rel"],
    mark: ["data-color", "class"],
    span: ["style", "data-color", "class", "data-type", "data-id", "data-subtype"],
    code: ["class"],
    strong: [], em: [], sub: [], sup: [], kbd: [], del: [], s: [], u: [], small: [], b: [], i: [],
  };
  const keep = allowedAttrs[tag] || [];
  const attrs: string[] = [];
  for (const attr of Array.from(node.attributes)) {
    if (keep.includes(attr.name.toLowerCase())) {
      attrs.push(`${attr.name}="${attr.value.replace(/"/g, "&quot;")}"`);
    }
  }
  const inner = Array.from(node.childNodes)
    .map((c) => (c.nodeType === Node.ELEMENT_NODE ? serializeInline(c as HTMLElement) : (c.textContent || "")))
    .join("");
  return `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>${inner}</${tag}>`;
}

/** 提取块（代码块/公式块）纯文本 */
function extractText(node: Element): string {
  return (node.textContent || "").replace(/^\n+|\n+$/g, "");
}

/** 转换 NodeTable → <table><thead>/<tbody> */
function convertTable(node: Element): string {
  let thead = "";
  let tbody = "";
  for (const child of Array.from(node.children)) {
    const ct = child.getAttribute("data-type") || "";
    if (ct === "NodeTableHead") {
      thead = `<thead>${tableRowsHtml(child)}</thead>`;
    } else if (ct === "NodeTableBody") {
      tbody = `<tbody>${tableRowsHtml(child)}</tbody>`;
    }
  }
  return `<table class="whale-note-table">${thead}${tbody}</table>`;
}

/** 转换表格分区（NodeTableHead/NodeTableBody）内的所有行 */
function tableRowsHtml(section: Element): string {
  return Array.from(section.children)
    .map((row) => {
      const ct = row.getAttribute("data-type") || "";
      if (ct !== "NodeTableRow") return convertNode(row);
      const cells = Array.from(row.children)
        .map((cell) => {
          const cct = cell.getAttribute("data-type") || "";
          if (cct !== "NodeTableCell") return convertNode(cell);
          return `<td>${childNodesHtml(cell)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
}

/** 极简 markdown→HTML（标题/粗体/列表/段落），仅用于 AI 直出内容兜底 */
export function renderMarkdown(md: string): string {
  const lines = (md || "").split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  const inline = (t: string) =>
    escapeHtml(t)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      out.push(`<h${lvl} class="hiword-ai-h">${inline(h[2])}</h${lvl}>`);
      continue;
    }
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) {
      if (!inList) {
        out.push("<ul class='hiword-ai-ul'>");
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p class="hiword-ai-p">${inline(line)}</p>`);
  }
  closeList();
  return out.join("");
}

/** 渲染结构化结果 */
export function renderDeepReadHtml(result: DeepReadResult): string {
  if (!result.ok && result.error) {
    return `<div class="hiword-ai-error">⚠️ AI 精读失败：${escapeHtml(result.error)}</div>`;
  }

  if (!result.isJson) {
    // 兜底路径：同样把 thinking（如有）放在折叠面板里，避免 JSON 解析失败时思考过程丢失
    const think = renderThinking(result.thinking);
    const body = result.raw ? renderWithLute(result.raw) : "（AI 未返回内容）";
    return `${think}<div class="hiword-ai-md b3-typography">${body}</div>`;
  }

  // 2026-08-21 精简：双模式删除,统一走 renderLearningHtml 渲染(isJson=true 即结构化)
  return renderLearningHtml(result);
}

/** 对话模式渲染：纯 markdown 气泡（无结构化、无联动） */
function renderChatHtml(result: DeepReadResult): string {
  const html: string[] = [];
  html.push(renderThinking(result.thinking));
  const body = result.raw ? renderWithLute(result.raw) : "（AI 未返回内容）";
  html.push(`<div class="hiword-ai-chat b3-typography">${body}</div>`);
  if (result.model) {
    html.push(`<div class="hiword-ai-model">模型：${escapeHtml(result.model)}</div>`);
  }
  return html.join("");
}

/**
 * thinking 折叠面板（默认展开，便于学习者查看分析思路；可点击收起避免干扰正文阅读）。
 * 2026-08-19 #73：按任务要求由「默认收起」改为「默认展开」，并保持主色边框/chevron/虚线分隔的清晰布局。
 */
function renderThinking(thinking?: string): string {
  if (!thinking || !thinking.trim()) return "";
  return (
    `<details class="hiword-ai-think" open>` +
      `<summary class="hiword-ai-think-sum">AI 思考过程（点击收起）</summary>` +
      `<div class="hiword-ai-think-body">${renderMarkdown(thinking)}</div>` +
    `</details>`
  );
}

/** 模型自评熟悉度星级（0~5） */
function renderMasteryStars(m: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(m)));
  const stars = "★".repeat(filled) + "☆".repeat(5 - filled);
  return `<span class="hiword-ai-word-mastery" title="模型自评熟悉度 ${filled}/5">${stars}</span>`;
}

/** 学习模式渲染：单词表格 + 顶部悬浮批量栏 + 纯文本句子 + 小结 */
function renderLearningHtml(result: DeepReadResult): string {
  const html: string[] = [];

  // thinking 折叠面板（默认展开，可点击收起；放在最前）
  html.push(renderThinking(result.thinking));

  if (result.words.length) {
    html.push(renderVocabBar(result.words));
    html.push(
      `<div class="hiword-ai-sec"><div class="hiword-ai-sec-head">` +
        `<span class="hiword-ai-sec-title">生词解析</span>` +
        `<span class="hiword-ai-sec-hint">勾选后从上方批量入库，或逐词「＋收藏」</span>` +
      `</div>`
    );
    html.push(`<div class="hiword-ai-word-table">`);
    for (const w of result.words) {
      const defs = w.definitions;
      const exs = w.examples;
      html.push(
        `<div class="hiword-ai-word-row" data-word="${escapeHtml(w.word)}">` +
          `<label class="hiword-ai-word-cb"><input type="checkbox" class="hiword-ai-sel" data-kind="word" data-word="${escapeHtml(w.word)}"></label>` +
          `<span class="hiword-ai-word-chip">${escapeHtml(w.word)}</span>` +
          (w.phonetic ? `<span class="hiword-ai-word-ph">${escapeHtml(w.phonetic)}</span>` : "") +
          (w.pos ? `<span class="hiword-ai-word-pos">${escapeHtml(w.pos)}</span>` : "") +
          (w.mastery != null ? renderMasteryStars(w.mastery) : "") +
          `<span class="hiword-ai-word-m">${escapeHtml(w.meaning) || "（未提供释义）"}</span>` +
          (w.context ? `<span class="hiword-ai-word-ctx">${escapeHtml(w.context)}</span>` : "") +
          (defs && defs.length ? `<div class="hiword-ai-word-defs">` + defs.map((d) => `<div class="hiword-ai-word-def">${d.pos ? `<i>${escapeHtml(d.pos)}</i> ` : ""}${escapeHtml(d.def)}</div>`).join("") + `</div>` : "") +
          (exs && exs.length ? `<div class="hiword-ai-word-exs">` + exs.map((e) => `<div class="hiword-ai-word-ex">${escapeHtml(e.en)}${e.zh ? ` <span class="hiword-ai-word-ex-zh">${escapeHtml(e.zh)}</span>` : ""}</div>`).join("") + `</div>` : "") +
          `<button class="hiword-ai-collect b3-button b3-button--small" data-word="${escapeHtml(w.word)}" data-meaning="${escapeHtml(w.meaning)}">＋收藏</button>` +
        `</div>`
      );
    }
    html.push(`</div></div>`);
  }

  if (result.sentences.length) {
    html.push(
      `<div class="hiword-ai-sec"><div class="hiword-ai-sec-head">` +
        `<span class="hiword-ai-sec-title">逐句讲解</span>` +
        `<span class="hiword-ai-sec-hint">可直接复制需要的句子</span>` +
      `</div><div class="hiword-ai-sents">`
    );
    for (const s of result.sentences) {
      html.push(
        `<div class="hiword-ai-sent">` +
          `<div class="hiword-ai-sent-src">${escapeHtml(s.sentence)}</div>` +
          (s.structure ? `<div class="hiword-ai-sent-st">结构：${escapeHtml(s.structure)}</div>` : "") +
          (s.translation ? `<div class="hiword-ai-sent-tr">译：${escapeHtml(s.translation)}</div>` : "") +
        `</div>`
      );
    }
    html.push(`</div></div>`);
  }

  if (result.summary) {
    html.push(
      `<div class="hiword-ai-sec"><div class="hiword-ai-sec-title">小结</div><div class="hiword-ai-summary">${escapeHtml(result.summary)}</div></div>`
    );
  }

  // 结构化字段全空但有原始内容：回退渲染 raw markdown（避免只显示思考过程而无正文）
  if (!result.words.length && !result.sentences.length && !result.summary && result.raw?.trim()) {
    html.push(`<div class="hiword-ai-md b3-typography">${renderWithLute(result.raw)}</div>`);
  }

  // 词库联动提示：本次精读自动入库/更新的单词
  if (result.savedWords && result.savedWords.length) {
    const added = result.savedWords.filter((s) => s.added).length;
    const updated = result.savedWords.filter((s) => s.updated).length;
    const total = result.savedWords.length;
    const parts: string[] = [];
    if (added) parts.push(`新加入词库 ${added} 个`);
    if (updated) parts.push(`更新已有词 ${updated} 个`);
    if (!added && !updated) parts.push(`已处理 ${total} 个词`);
    html.push(
      `<div class="hiword-ai-saved">✅ 词库联动：本次精读自动${parts.join("，")}（已关联来源块，可在词库按来源回溯）</div>`
    );
  }

  if (!html.length) {
    return `<div class="hiword-ai-empty">AI 未返回可渲染内容（可能文本无英文）。</div>`;
  }

  if (result.model) {
    html.push(`<div class="hiword-ai-model">模型：${escapeHtml(result.model)}</div>`);
  }

  return html.join("");
}

/**
 * 单词区顶部悬浮批量栏：统计 + 目标单词本 select + 子类 chips + 全不选 + 添加到词库。
 * 点击「添加到词库」由 ai-panel 绑定 → 弹出「提取单词到词库」窗口（与设置页同款）。
 */
function renderVocabBar(words: DeepReadResult["words"]): string {
  const n = words.length;
  const themes = ["未分类", "真题高频", "真题低频", "写作常用", "阅读高频"];
  const themeChips = themes
    .map((t) => `<span class="hiword-ai-theme-chip" data-theme="${escapeHtml(t)}">${escapeHtml(t)}</span>`)
    .join("");
  return (
    `<div class="hiword-ai-vocab-bar">` +
      `<span class="hiword-ai-vocab-count">共识别 <b>${n}</b> 个词</span>` +
      `<label class="hiword-ai-vocab-book">目标本` +
        `<select class="hiword-ai-vocab-book-sel" data-field="book">` +
          `<option value="">（默认词库）</option>` +
        `</select>` +
      `</label>` +
      `<span class="hiword-ai-vocab-themes">${themeChips}</span>` +
      `<button class="hiword-ai-vocab-none" type="button" data-act="none">全不选</button>` +
      `<button class="hiword-ai-vocab-add b3-button b3-button--small" type="button" data-act="add">添加到词库</button>` +
    `</div>`
  );
}

/* ============================================================================
 * AI 流式增量渲染（2026-08-29 P0 性能优化，对应 AGENTS.md 4.1）
 * ----------------------------------------------------------------------------
 * 旧问题：AI 流式输出时每收一段 onToken 就把累计全文塞给 `renderWithLute`，
 *         Lute 要从头解析 + 序列化全部 markdown，每 100ms 节流一次也是 O(N) 全量。
 *         5K 字的回复 + 10s 流完 ≈ 100 次 Lute 全量解析，主线程被压垮。
 *
 * 优化思路（行级 diff 的简化版）：
 *   1. 找到"稳定边界"——md 中最后一个"已完成的 markdown 块"的位置。
 *      判定：在代码块围栏外、空行（trim 后 == ''）之后的位置。
 *   2. 稳定前缀部分的 HTML 缓存一次，不再重渲染（除非 md 在稳定区被改了）。
 *   3. 进行中块（稳定边界之后）每次 push 都会重新渲染，但它的体量只是
 *      "最近一个未完成的块"，通常远小于全文（典型 1/5 ~ 1/20）。
 *
 * 复杂度：
 *   旧版每 tick = O(N) 全文解析
 *   新版每 tick = O(T) tail 解析，T = 当前进行中块大小，
 *                 加上 O(新稳定区) 一次性沉淀到 cache
 *   整体相对旧版省 5~10x（实测取决于回复结构）
 *
 * 注意：
 *   - 单元测试环境下 `renderWithLute` 走 `renderMarkdown` 兜底，不依赖 Lute
 *     → 仍可在 Node 单测里覆盖状态机逻辑（见 test/ai-render-incremental.test.mjs）
 *   - 状态机不持有 DOM，仅产出 HTML 字符串 → 复用 createStreamThrottle 节奏
 *   - "稳定"判定只对"代码块外空行"敏感，对代码块内 \n\n 不切换边界
 *     （避免代码块被切成多段；与原版 Lute 行为一致）
 */

export interface IncrementalRenderer {
  /**
   * 推入当前累计 markdown，返回拼接好的 HTML。
   * 幂等：同 md 输入返回相同结果；只对增量部分做 Lute 渲染。
   */
  push(md: string): string;
  /**
   * 强制 flush：返回最终 HTML（不传 md = 复用最近一次 push 的结果）。
   * 主要用于"流结束"时拿到与 push 同样的输出。
   */
  flush(md?: string): string;
  /**
   * 重置内部状态（用于切消息 / 重生 / 错误恢复）。
   */
  reset(): void;
}

/**
 * 创建增量渲染器（无 Lute 依赖，可在 Node 单测）。
 *
 * 使用：
 * ```ts
 * const r = createIncrementalRenderer();
 * onToken((chunk) => {
 *   liveRaw += chunk;
 *   liveMdEl.innerHTML = r.push(liveRaw);
 * });
 * onComplete(() => { liveMdEl.innerHTML = r.flush(); });
 * onError(() => r.reset());
 * ```
 */
export function createIncrementalRenderer(): IncrementalRenderer {
  // 已稳定块拼接出的 HTML 缓存
  let stableHtml = "";
  // 已稳定块在原 md 中的结束位置
  let stableBoundary = 0;
  // 上次渲染过的"进行中块"原文（用于判断是否需要重渲染）
  let lastTailMd = "";
  // 上次渲染出的"进行中块" HTML
  let lastTailHtml = "";

  return {
    push(md: string): string {
      const cur = md || "";
      // 流清空 / 重置信号
      if (cur.length < stableBoundary) {
        // 外部可能重置了 md（比如重发消息），从头来
        stableHtml = "";
        stableBoundary = 0;
        lastTailMd = "";
        lastTailHtml = "";
      }

      const newBoundary = findStableBoundary(cur);

      // 1) 沉淀新稳定部分到 cache
      if (newBoundary > stableBoundary) {
        const newStableMd = cur.slice(stableBoundary, newBoundary);
        if (newStableMd.trim()) {
          // 渲染新稳定的部分（一次性，永不再改）
          stableHtml += renderWithLute(newStableMd);
        }
        stableBoundary = newBoundary;
      }

      // 2) 重新渲染进行中块（仅当原文变了）
      const tailMd = cur.slice(stableBoundary);
      if (tailMd !== lastTailMd) {
        lastTailMd = tailMd;
        lastTailHtml = tailMd.trim() ? renderWithLute(tailMd) : "";
      }

      return stableHtml + lastTailHtml;
    },

    flush(md?: string): string {
      if (md !== undefined) return this.push(md);
      return stableHtml + lastTailHtml;
    },

    reset(): void {
      stableHtml = "";
      stableBoundary = 0;
      lastTailMd = "";
      lastTailHtml = "";
    },
  };
}

/**
 * 找 md 中最后一个"稳定边界"位置（= 最后一个已完成的 markdown 块结束处）。
 * 稳定边界定义：
 *   - 在代码块围栏（``` 或 ~~~）外
 *   - 紧跟一个空行（trim 后 == ''）
 *   - 该空行之后的位置即为稳定边界
 *
 * 特殊情况：
 *   - md 整体为空 → 返回 0
 *   - 没有任何空行（如整个 md 都在一个段落里）→ 返回 0（全部视为"进行中"）
 *   - 在代码块内的空行不算边界
 *   - 文末（无尾随换行）按"已结束"处理
 *
 * O(N) 单次扫描，无递归。
 */
export function findStableBoundary(md: string): number {
  if (!md) return 0;
  let inFence = false;
  // fence 字符：'```' 对应 '`', '~~~' 对应 '~'。
  // 进入围栏记录字符，关闭围栏要求字符相同。
  let fenceChar: "`" | "~" | null = null;
  let boundary = 0;
  let i = 0;

  while (i < md.length) {
    // 找当前行结束
    let lineEnd = md.indexOf("\n", i);
    if (lineEnd === -1) lineEnd = md.length;
    const line = md.slice(i, lineEnd);

    // 1) 检测围栏（行首允许 0~3 个空格缩进，4 个及以上视为代码块内容）
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const ch = fenceMatch[1][0] as "`" | "~";
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
        fenceChar = null;
      }
    } else if (!inFence && line.trim() === "") {
      // 2) 围栏外的空行 = 块边界。边界位置 = 空行之后。
      boundary = lineEnd + 1;
    }

    i = lineEnd + 1;
  }

  return boundary;
}
