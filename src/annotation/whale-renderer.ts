/**
 * 鲸鱼风格 —— 侧边栏批注汇总面板渲染器
 * ------------------------------------------------------------------
 * 基于截图「3 侧边栏批注汇总」区域重构。
 *
 * 特征：
 *  - 自动汇集、分类筛选（全部/重点/困难/待办/行程）
 *  - 全文搜索框
 *  - 卡片式列表（颜色圆点 + 样式图标 + 日期 + 来源文档 + 标签）
 *  - 一键跳转到原文块
 *  - 批量操作（删除/导出/清空）
 */

import type { AnnotationItem, AnnotationCategory, AnnotationStyle } from "./annotation-store.ts";
import { sanitizeHtml, compactSentence, stripIal, ensureBlockSeparators, expandInlineTableRows } from "./annotation-render.ts";
import { getLute, configureKramdownLute, htmlToMd } from "./lute.ts";

// ============ 类型与常量 ============

/** 分类筛选项 —— 2026-08-14 改造：保留"全部"硬编码，其余由 labelStore 自定义标签驱动 */
export const WHALE_CATEGORY_ALL = "all" as const;
export type WhaleActiveLabel = typeof WHALE_CATEGORY_ALL | string; // "all" | labelId

/** 样式图标映射 */
const STYLE_ICONS: Record<string, string> = {
  solid: "━", wavy: "﹏", dashed: "┄", double: "═", dotted: "┉",
};

// ============ 工具函数 ============

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] || c));
}

function escAttr(s: string): string { return esc(s); }

function shortDate(iso?: string): string {
  if (!iso) return "";
  return iso.slice(5, 16).replace("T", " ");
}

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}天前`;
  return shortDate(iso);
}

// 注：whale-renderer.renderMd 已删除（D7 死代码，无调用方）。


/**
 * 2026-08-15 修复：sentence 渲染 + selectedText 高亮（共享函数，弹窗与批注卡通用）。
 *  - sentence 现在【包含】 selectedText（extractContextSentence 已重写为整句提取）：
 *    在句中找到选中词并包 <mark> 高亮（不依赖 range 偏移，避免坐标系错位）。
 *  - 兼容旧数据：sentence 不含 selectedText 时，追加高亮到句尾（保持旧行为）。
 *  - sentence 是原文上下文，不做 Markdown 转义，避免把文档里的 * 当语法（直接高亮 + 转义）。
 */
export function highlightInText(text: string, sel: string): string {
  const t = (text || "").trim();
  const s = (sel || "").trim();
  if (!s) return esc(t);
  if (!t) return `<mark class="whale-card-sel">${esc(s)}</mark>`;
  const idx = t.toLowerCase().indexOf(s.toLowerCase());
  if (idx === -1) {
    // 旧数据：sentence 不含 selectedText → 追加高亮（带长度保护，避免异常长 selectedText 造成怪显示）
    const tooLong = s.length > Math.max(2, t.length * 0.5);
    if (tooLong) return esc(t);
    const sep = !/[。.!?！？\s]$/.test(t) ? " " : "";
    return esc(t) + sep + `<mark class="whale-card-sel">${esc(s)}</mark>`;
  }
  const before = esc(t.slice(0, idx));
  const match = esc(t.slice(idx, idx + s.length));
  const after = esc(t.slice(idx + s.length));
  return before + `<mark class="whale-card-sel">${match}</mark>` + after;
}

/**
 * 统一渲染批注正文（弹窗展示区与汇总面板共用入口）。
 *  - 输出应为「思源富文本 HTML」，调用方需放入带 b3-typography class 的容器，
 *    以继承标题层级 / 列表缩进 / 引用边框 / 块引用等完整思源排版样式；
 *  - 统一走 renderAnnotationText(note)，由思源 Lute 渲染（含块引用还原、==高亮==、#标签等）；
 *  - 无 Lute 的兜底路径回退 sanitizeHtml（旧行为）。
 */
export function renderAnnotationHTML(note: string | undefined): string {
  return renderAnnotationText(note, "note");
}

/**
 * 归一化 note 输入给 Lute 渲染（D9 单格式 Kramdown）。
 *  - 若含 HTML 标签（旧版工具栏 execCommand / 思源编辑器粘贴产物，未走 migrate 全量归一化），
 *    先经 Lute HTML2Md 转 Kramdown 再渲染，避免把 HTML 当 Kramdown 解析导致结构错乱；
 *  - 纯文本 / 已是 Kramdown 直接返回。
 */
function normalizeNote(t: string): string {
  if (/<[a-z][\s\S]*>/i.test(t)) {
    const md = htmlToMd(t);
    if (md && md !== t) return md;
  }
  return t;
}

/**
 * 统一渲染批注文本（接入思源 Lute 引擎）。
 *  - kind="sentence"：只做「折叠空白 + 转义 + 高亮选中词」，**不解析 Markdown**
 *    （原文来自思源正文，*、#、~ 等是普通标点，二次解析会错乱）；
 *  - kind="note"：统一走思源 Lute 渲染（D9 单格式 Kramdown）。旧数据（富文本 HTML）
 *    先经 HTML2Md 归一化为 Kramdown 再渲染；新数据（Kramdown/纯文本）直接渲染
 *    （==高亮==、#标签、^上标^、~下标~、块引用、代码块等）。
 */
export function renderAnnotationText(text: string | undefined, kind: "sentence" | "note"): string {
  const t = (text || "").trim();
  if (!t) return "";
  if (kind === "sentence") {
    // 原文：不做 Markdown 解析，仅折叠空白 + 高亮（2026-08-17 修复误解析）；
    // 先剥 IAL 防止块导出的 `{.: id="…" updated="…"}` 当正文显示（2026-08-18 修复）。
    return highlightInText(compactSentence(stripIal(t)), "");
  }
  // note：统一走思源 Lute 渲染（D9 单格式 Kramdown）。
  //  - 旧数据若仍是富文本 HTML（未走 migrate 全量归一化），先经 HTML2Md 转 Kramdown
  //    再渲染，保证全量单格式一致；纯文本 / 已是 Kramdown 直接渲染；
  //  - 真实 SiYuan 运行时由 Lute（SetSanitize）转义原始 HTML，不会原样注入 <script>；
  //  - 无 Lute 的兜底路径回退 sanitizeHtml（旧行为），保留彩色 mark 等内联样式；
  //  - 输出再剥一次 IAL，兜住 Lute 未能识别为属性、原样吐回的裸 IAL（2026-08-18 修复）。
  const lute = getLute();
  if (lute) {
    // 2026-08-19：显式开启 GFM Table 等，确保侧栏 fallback 正确渲染表格/删除线/块引用等
    configureKramdownLute(lute);
    const kd = expandInlineTableRows(normalizeNote(t)); // 旧 HTML → Kramdown；单行伪表格展开为多行
    try {
      // 双转换（对齐 ai-render.renderKramdown）：Md2BlockDOM（与编辑器写入一致）
      // → BlockDOM2Md → Md2HTML，完整保留 ((块引用)) / {: 行内属性} / {{}} / 表格等思源语法，
      // 并正确渲染为 <table> / <blockquote> 等语义 HTML（杜绝 `|...|` 文本塌缩）。
      const blockDOM = lute.Md2BlockDOM(ensureBlockSeparators(kd));
      const html = lute.Md2HTML(lute.BlockDOM2Md(blockDOM));
      if (html && html.trim()) return applyMarkColors(stripIal(html));
    } catch { /* 落到下方单层 Md2HTML 兜底 */ }
    // 单层兜底（双转换异常或产出空时）
    return applyMarkColors(stripIal(lute.Md2HTML(ensureBlockSeparators(kd))));
  }
  return applyMarkColors(stripIal(sanitizeHtml(t)));
}

/**
 * 2026-08-17：把渲染结果中的 <mark data-color="..."> 转成内联背景色。
 * 思源 b3-typography 的 mark 默认样式不带 data-color 着色（attr() 支持有限），
 * 在批注正文/面板/浮层里直接注入 background-color，保证「绿/橙等彩色高亮」原样显示。
 * 仅在 Lute / sanitize 输出之后调用（颜色值来自思源 Kramdown 的 data-color 属性，可信）。
 */
export function applyMarkColors(html: string): string {
  if (!html || html.indexOf("data-color") === -1) return html;
  return html.replace(
    /<mark\b([^>]*?)\bdata-color=(["'])([^"']+)\2([^>]*)>/gi,
    (_m: string, pre: string, _q: string, color: string, post: string) => {
      if (/style=/i.test(pre + post)) return _m; // 已有内联样式（如背景色）则不动
      return `<mark${pre}data-color=${_q}${color}${_q}${post} style="background-color:${color}">`;
    }
  );
}

// ============ 主渲染函数 ============

/**
 * 渲染鲸鱼风格批注侧边栏面板。
 *
 * @param items 全部批注列表
 * @param activeLabel 当前标签筛选（"all" = 全部，或 labelId）
 * @param searchKeyword 当前搜索关键词
 * @param labelMap 标签 id → 颜色（用于 chips 着色）
 * @param labels 全部标签（labelStore 数据驱动 chips 渲染）
 * @param tagsCollapsed 标签筛选区是否收起
 * @param sortMode 排序模式（2026-08-15 新增）："time" | "doc" | "style"
 * @param sortTimeDir 时间排序方向（"desc" 默认 / "asc"）
 * @param sortDoc 当前选中的 docId（null = 不按文档筛选）
 * @param sortStyles 当前选中的样式组合列表，每项格式 "colorId|colorValue|styleKey"
 * @param docInfos 文档列表 [{ id, name, count }]，用于文档下拉渲染
 * @param styleFilterOpen 样式选择面板是否展开（仅样式模式）
 * @param groupMode 列表分组方式（2026-08-17 新增，默认 "time"）：
 *                  "time" = 按时间分组（今天/昨天/更早）；"doc" = 按文档分组
 */
export function renderWhalePanel(
  items: AnnotationItem[],
  activeLabel: WhaleActiveLabel = "all",
  searchKeyword: string = "",
  labelMap: Record<string, string> = {},
  labels: { id: string; name: string; color: string }[] = [],
  tagsCollapsed: boolean = false,
  sortMode: "time" | "doc" | "style" = "time",
  sortTimeDir: "desc" | "asc" = "desc",
  sortDoc: string | null = null,
  sortStyles: string[] = [],
  docInfos: { id: string; name: string; count: number }[] = [],
  styleFilterOpen: boolean = false,
  groupMode: "time" | "doc" = "time"
): string {
  // 统计各标签命中数（2026-08-14 改造：基于 labelStore 自定义标签）
  const labelCounts: Record<string, number> = { all: items.length };
  for (const a of items) {
    for (const lid of a.labels || []) {
      labelCounts[lid] = (labelCounts[lid] || 0) + 1;
    }
  }

  // 筛选：按 label id
  let filtered = [...items];
  if (activeLabel !== "all") {
    filtered = filtered.filter(a => (a.labels || []).includes(activeLabel));
  }
  if (searchKeyword.trim()) {
    const kw = searchKeyword.trim().toLowerCase();
    filtered = filtered.filter(a =>
      [a.sentence, a.selectedText, a.note].some(f => f?.toLowerCase().includes(kw))
    );
  }
  // 2026-08-15 新增：3 维筛选
  // - 文档筛选：sortDoc 非空时按 docId 过滤
  if (sortMode === "doc" && sortDoc) {
    filtered = filtered.filter(a => a.docId === sortDoc);
  }
  // - 样式筛选：sortStyles 非空时按样式组合过滤（每个选中的样式编码为 colorValue|styleKey）
  if (sortMode === "style" && sortStyles.length > 0) {
    filtered = filtered.filter(a => {
      const c = a.color || "#06b6d4";
      const s = a.style || "solid";
      return sortStyles.includes(`${c}|${s}`);
    });
  }
  // - 时间排序：永远按 createdAt 排（其他模式也按时间排序，文档/样式仅作筛选）
  filtered.sort((a, b) => {
    const cmp = a.createdAt.localeCompare(b.createdAt);
    return sortTimeDir === "asc" ? cmp : -cmp;
  });

  // 当前选中样式/文档的提示文本（按钮副标）
  const docFilterLabel = sortDoc
    ? docInfos.find(d => d.id === sortDoc)?.name || "未知文档"
    : "";
  const styleFilterLabel = sortStyles.length > 0 ? `${sortStyles.length} 种` : "";

  // 2026-08-17：labels id → name 映射（卡片标签徽章显示真实标签名）
  const labelNameMap: Record<string, string> = {};
  for (const l of labels) labelNameMap[l.id] = l.name;

  // 2026-08-15 新增：面包屑（并列叠加的可视化）——只列"非默认"条件
  const activeLabelName = labels.find(l => l.id === activeLabel)?.name || "";
  const hasFilter =
    activeLabel !== "all" ||
    !!searchKeyword.trim() ||
    !!sortDoc ||
    sortStyles.length > 0 ||
    sortTimeDir === "asc";
  const filterChips: string[] = [];
  if (activeLabel !== "all" && activeLabelName) {
    filterChips.push(`<button type="button" class="whale-filter-chip" data-filter-clear="label" title="清除标签筛选">#${esc(activeLabelName)} <span class="whale-filter-chip-x">×</span></button>`);
  }
  if (searchKeyword.trim()) {
    filterChips.push(`<button type="button" class="whale-filter-chip" data-filter-clear="search" title="清除搜索">搜索:${esc(searchKeyword.trim())} <span class="whale-filter-chip-x">×</span></button>`);
  }
  if (sortDoc) {
    filterChips.push(`<button type="button" class="whale-filter-chip" data-filter-clear="doc" title="清除文档筛选">文档:${esc(docFilterLabel)} <span class="whale-filter-chip-x">×</span></button>`);
  }
  if (sortStyles.length > 0) {
    filterChips.push(`<button type="button" class="whale-filter-chip" data-filter-clear="style" title="清除样式筛选">样式:${sortStyles.length}种 <span class="whale-filter-chip-x">×</span></button>`);
  }
  if (sortTimeDir === "asc") {
    filterChips.push(`<button type="button" class="whale-filter-chip" data-filter-clear="time" title="恢复从新到旧">旧→新 <span class="whale-filter-chip-x">×</span></button>`);
  }
  const breadcrumbHtml = filterChips.length > 0
    ? `<div class="whale-filter-breadcrumb" id="whale-filter-breadcrumb">${filterChips.join("")}</div>`
    : "";

  return `
    <div class="whale-panel">
      <!-- 头部：标题 + 统计 + 分组切换（2026-08-17：时间/文档，默认时间） -->
      <div class="whale-panel-head">
        <span class="whale-panel-title">批注汇总</span>
        <span class="whale-panel-count ${hasFilter ? "whale-panel-count--active" : ""}" title="${hasFilter ? "有筛选条件生效" : ""}">${filtered.length}/${items.length}</span>
        <span class="whale-panel-head-group" title="列表分组方式">
          <button type="button" class="whale-group-btn ${groupMode === "time" ? "active" : ""}" data-group-action="time">时间</button>
          <button type="button" class="whale-group-btn ${groupMode === "doc" ? "active" : ""}" data-group-action="doc">文档</button>
        </span>
      </div>

      <!-- 搜索框 -->
      <div class="whale-panel-search">
        <svg class="whale-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input class="whale-search-input"
               id="whale-search-input"
               placeholder="搜索批注内容…"
               value="${escAttr(searchKeyword)}"
               autocomplete="off" />
        ${searchKeyword ? `<button class="whale-search-clear" id="whale-search-clear" title="清除搜索">✕</button>` : ""}
      </div>

      <!-- 标签筛选 chips（2026-08-14 改造：基于 labelStore + "全部" + "⚙ 管理"；2026-08-15 加收起/展开） -->
      <div class="whale-panel-tabs-wrap ${tagsCollapsed ? 'whale-panel-tabs-wrap--collapsed' : ''}">
        <button type="button" class="whale-tags-collapse-btn" id="whale-tags-collapse-btn"
                aria-expanded="${tagsCollapsed ? 'false' : 'true'}" title="收起/展开标签筛选">
          ${tagsCollapsed ? '🏷️ 标签 ▸ 展开' : '🏷️ 标签 ▾ 收起'}
        </button>
        <div class="whale-panel-tabs" id="whale-panel-tabs">
          <button class="whale-tab ${activeLabel === "all" ? 'whale-tab--active' : ''}" data-cat="all" title="全部批注">
            <span class="whale-tab-icon">📋</span>
            <span class="whale-tab-label">全部</span>
            <span class="whale-tab-count">${labelCounts["all"] || 0}</span>
          </button>
          ${labels.map((l) => `
            <button class="whale-tab ${activeLabel === l.id ? 'whale-tab--active' : ''}"
                    data-cat="${escAttr(l.id)}"
                    style="--tag-color:${l.color}"
                    title="#${escAttr(l.name)}（${labelCounts[l.id] || 0}）">
              <span class="whale-tab-icon" style="color:${l.color}">●</span>
              <span class="whale-tab-label">#${esc(l.name)}</span>
              <span class="whale-tab-count">${labelCounts[l.id] || 0}</span>
            </button>
          `).join("")}
          <button class="whale-tab whale-tab--manage" data-action="whale-manage-labels" title="管理标签（增删改 + 颜色）">⚙ 管理</button>
        </div>
      </div>

      ${breadcrumbHtml}

      <!-- 排序 / 筛选切换（2026-08-15 改造：3 维度，时间可切换方向）-->
      <div class="whale-panel-sort">
        <button class="whale-sort-btn ${sortMode === "time" ? "active" : ""}" data-sort-action="time" title="按时间排序${sortMode === "time" ? "（点击切换方向）" : ""}">
          时间${sortMode === "time" ? (sortTimeDir === "desc" ? "↓" : "↑") : "↓"}
        </button>
        <button class="whale-sort-btn ${sortMode === "doc" ? "active" : ""}" data-sort-action="doc" title="按文档筛选${sortDoc ? '（当前：' + docFilterLabel + '）' : ''}">
          📄 文档${docFilterLabel ? ' · ' + docFilterLabel : ''}
        </button>
        <button class="whale-sort-btn ${sortMode === "style" ? "active" : ""}" data-sort-action="style" title="按样式筛选${sortStyles.length ? '（当前：' + styleFilterLabel + '）' : ''}">
          🎨 样式${styleFilterLabel ? ' · ' + styleFilterLabel : ''}
        </button>
      </div>

      <!-- 文档下拉（仅文档模式显示，2026-08-15 新增） -->
      ${sortMode === "doc" ? `
        <div class="whale-doc-filter" id="whale-doc-filter">
          <button class="whale-doc-filter-btn ${!sortDoc ? "active" : ""}" data-doc-id="">全部文档 (${items.length})</button>
          ${docInfos.map((d) => `<button class="whale-doc-filter-btn ${sortDoc === d.id ? "active" : ""}" data-doc-id="${escAttr(d.id)}" title="${escAttr(d.name)}">${esc(d.name)} (${d.count})</button>`).join("")}
          ${sortDoc ? `<button class="whale-doc-filter-clear" data-doc-clear title="清除文档筛选">清除</button>` : ""}
        </div>
      ` : ""}

      <!-- 样式选择面板入口（仅样式模式显示，点击主区打开 popover；2026-08-15 新增） -->
      ${sortMode === "style" ? `
        <div class="whale-style-filter-hint" id="whale-style-filter-hint">
          ${sortStyles.length > 0
            ? `已选 ${sortStyles.length} 种样式 · ${filtered.length} 条匹配`
            : `未选样式（显示全部 ${filtered.length} 条）`}
        </div>
      ` : ""}

      <!-- 列表容器（2026-08-17：笔记化列表，按 groupMode 分组） -->
      <div class="whale-panel-list" id="whale-panel-list">
        ${filtered.length === 0 ? `
          <div class="whale-empty">
            <div class="whale-empty-icon">🐋</div>
            <p>还没有批注</p>
            <p class="whale-empty-hint">选中正文文字，点击编辑器工具栏的「批注」按钮，或按 <b>Alt+⌘/Ctrl+C</b></p>
          </div>
        ` : renderWhaleNoteList(filtered, groupMode, labelMap, labelNameMap, docInfos)}
      </div>

      <!-- 底部工具栏 -->
      <div class="whale-panel-footer">
        <button class="whale-footer-btn" id="whale-export" title="导出批注为 Markdown 文件">📤 导出</button>
        <button class="whale-footer-btn whale-footer-btn--danger" id="whale-clear-all" title="清空全部批注（不可恢复）">🗑 清空全部</button>
        ${hasFilter ? `<button class="whale-footer-btn" id="whale-filter-reset" title="重置所有筛选条件">🔄 重置筛选</button>` : ""}
        <span class="whale-footer-spacer"></span>
        <span class="whale-footer-hint">Alt+⌘/Ctrl+C 快速批注</span>
      </div>
    </div>
  `;
}

// ============ 笔记化列表渲染（2026-08-17：替代卡片墙，仿思源文档流）============

/** 列表分组方式：time = 按时间分组（今天/昨天/更早）；doc = 按文档分组 */
export type WhaleGroupMode = "time" | "doc";

/** 时间分组标签：今天 / 昨天 / N 天前 / 具体日期 */
function groupLabelTime(iso?: string): string {
  if (!iso) return "更早";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "更早";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDay = Math.round((startOfToday - startOfDay) / 86400000);
  if (diffDay <= 0) return "今天";
  if (diffDay === 1) return "昨天";
  if (diffDay < 7) return `${diffDay} 天前`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 渲染笔记化列表：按 groupMode 分组，组标题（今天/更早 或 文档名）+ 条目。
 * 每条 = 富文本正文（b3-typography，含彩色高亮）+ 元信息行（可点击定位原文 + 标签 + hover 操作）。
 */
export function renderWhaleNoteList(
  items: AnnotationItem[],
  groupMode: WhaleGroupMode = "time",
  labelMap: Record<string, string> = {},
  labelNames: Record<string, string> = {},
  docInfos: { id: string; name: string; count: number }[] = []
): string {
  if (items.length === 0) return "";
  const docNameMap: Record<string, string> = {};
  for (const d of docInfos) docNameMap[d.id] = d.name;

  const groups: { key: string; label: string; items: AnnotationItem[] }[] = [];
  const index = new Map<string, { key: string; label: string; items: AnnotationItem[] }>();
  for (const a of items) {
    let key: string;
    let label: string;
    if (groupMode === "doc") {
      key = a.docId || "__none__";
      label = docNameMap[a.docId || ""] || (a.docId ? a.docId.slice(0, 8) : "未分类");
    } else {
      key = groupLabelTime(a.createdAt);
      label = key;
    }
    let g = index.get(key);
    if (!g) {
      g = { key, label, items: [] };
      index.set(key, g);
      groups.push(g);
    }
    g.items.push(a);
  }

  return groups
    .map((g) => `
      <h3 class="whale-notes-group">${esc(g.label)} <span class="whale-notes-count">${g.items.length}</span></h3>
      ${g.items.map((a) => renderWhaleNoteItem(a, labelMap, labelNames)).join("")}
    `)
    .join("");
}

/** 渲染单条笔记化批注（无卡片边框/阴影，正文 + 元信息行，双击正文进入内联编辑） */
function renderWhaleNoteItem(
  a: AnnotationItem,
  labelMap: Record<string, string> = {},
  labelNames: Record<string, string> = {}
): string {
  const dateStr = timeAgo(a.createdAt);
  const fullDate = shortDate(a.createdAt);
  const sel = (a.selectedText || "").trim();
  const sentenceText = (a.sentence || "").trim();
  const sourceText = stripIal(sel || sentenceText);
  const noteText = stripIal((a.note || "").trim());
  const isEmptyNote = noteText === "" || noteText === sel;

  const originMark = a.origin === "ai"
    ? `<span class="whale-notes-origin whale-notes-origin--ai">AI</span>`
    : "";
  const annColor = a.color || "#06b6d4";
  const annStyle = a.style || "solid";
  const styleGlyph = STYLE_ICONS[annStyle] || "━";
  const tagBadges = (a.labels || []).map(id =>
    `<span class="whale-notes-tag" style="--tag-color:${labelMap[id] || "#9ca3af"}">#${esc(labelNames[id] || id)}</span>`
  ).join("");

  // 正文：有 note → 原生 lite Protyle 只读预览（宿主 + 静态兜底渐进增强）；
  //       纯标注（note 空）→ 只显示选中词（bare，不变）
  const bodyHtml = isEmptyNote
    ? `<div class="whale-notes-text whale-notes-text--bare b3-typography">${esc(sourceText)}</div>`
    : `<div class="whale-notes-text b3-typography">` +
        `<div class="whale-notes-protyle" data-ann-id="${escAttr(a.id)}"></div>` +
        `<div class="whale-notes-fallback">${renderAnnotationHTML(a.note)}</div>` +
      `</div>`;

  // 含表格的批注：元信息行加「⊞ 表格」标识，点击展开居中 Dialog 完整查看
  const noteHasTable = !isEmptyNote && (
    /<table[\s>]/i.test(noteText) ||
    /\n\s*\|?[\s:\-|]+\|?\s*\n/.test("\n" + noteText + "\n") ||
    // 单行空格分隔的伪表格：`|表头|表头| |------|------| |数据|数据|`
    (() => {
      if (/\n/.test(noteText)) return false;
      // 与 expandInlineTableRows 一致：非贪婪 + lookahead 按行边界拆分
      const rows = noteText.match(/\|(?:[^|]*\|)+?(?=\s+\||\s*$)/g);
      if (!rows || rows.length < 2) return false;
      return rows.some(r => /^\s*\|?[\s:\-|]+\|?\s*$/.test(r) && r.includes("-"));
    })()
  );
  const tableBadge = noteHasTable
    ? `<button type="button" class="whale-notes-table-badge" data-action="expand-table" data-ann-id="${escAttr(a.id)}" title="展开查看表格">⊞ 表格</button>`
    : "";
  // 元信息行：有 note → 显示「原文：xxx」可点击定位；纯标注 → 显示时间
  const metaLeft = isEmptyNote
    ? `<span class="whale-notes-time" title="${escAttr(fullDate)}">${dateStr}</span>${originMark}${tableBadge}`
    : `<span class="whale-notes-source" data-action="jump" title="点击定位到原文">原文：${esc(sourceText)}</span>${tagBadges}${originMark}${tableBadge}`;

  return `
    <div class="whale-notes-item" data-id="${escAttr(a.id)}" data-block="${escAttr(a.blockId)}" data-doc="${escAttr(a.docId)}"
         style="--ann-color:${escAttr(annColor)}" data-ann-style="${escAttr(annStyle)}">
      <span class="whale-notes-accent" title="标注样式" style="color:${escAttr(annColor)}">${styleGlyph}</span>
      <div class="whale-notes-main">
        ${bodyHtml}
        <div class="whale-notes-meta">
          ${metaLeft}
          <span class="whale-footer-spacer"></span>
          <span class="whale-notes-acts">
            <button type="button" class="whale-notes-act" data-action="edit" title="编辑批注">编辑</button>
            <button type="button" class="whale-notes-act whale-notes-act--danger" data-action="delete" title="删除批注">删除</button>
          </span>
        </div>
      </div>
    </div>
  `;
}

// ============ 样式预览区渲染（用于设置页）============

/**
 * 渲染「批注文本效果」预览区（对应截图 Section 1）。
 * 展示各种下划线样式在示例文字上的效果。
 */
export function renderStylePreview(): string {
  const sampleText = "重要的文本内容示例";
  const colors = ["#9ca3af", "#facc15", "#22c55e", "#06b6d4", "#ec4899", "#f97316", "#8b5cf6"];
  const styles = [
    { key: "solid", css: "solid", label: "单实线" },
    { key: "wavy", css: "wavy", label: "波浪线" },
    { key: "dashed", css: "dashed", label: "虚线" },
    { key: "double", css: "double", label: "双实线" },
    { key: "dotted", css: "dotted", label: "点线" },
  ];

  const rows = styles.map(s => `
    <div class="whale-preview-row">
      <span class="whale-preview-label">${s.label}</span>
      <span class="whale-preview-text"
            style="text-decoration: underline; text-decoration-style: ${s.css}; text-decoration-color: #06b6d4; text-decoration-thickness: 2px;">
        ${sampleText}
      </span>
    </div>
  `).join("");

  const colorDots = colors.map(c =>
    `<span class="whale-preview-dot" style="background:${c}" title="${c}"></span>`
  ).join("");

  return `
    <div class="whale-preview-section">
      <div class="whale-preview-header">
        <span class="whale-preview-title">① 批注文本效果</span>
        <span class="whale-preview-subtitle">选中文字一键批注，多种样式自定义</span>
      </div>
      <div class="whale-preview-body">${rows}</div>
      <div class="whale-preview-more">
        <span>更多样式自由组合…</span>
        <span class="whale-preview-dots">${colorDots}</span>
      </div>
    </div>
  `;
}

/**
 * 渲染「正文下划线自定义」选择器（对应截图右上角）。
 * 7 色 × 5 线型矩阵选择器。
 */
export function renderStyleMatrixPicker(selectedColor?: string, selectedStyle?: string): string {
  const colors = [
    { name: "灰", value: "#9ca3af" }, { name: "黄", value: "#facc15" },
    { name: "绿", value: "#22c55e" }, { name: "青", value: "#06b6d4" },
    { name: "粉", value: "#ec4899" }, { name: "橙", value: "#f97316" },
    { name: "紫", value: "#8b5cf6" },
  ];
  const lineStyles = [
    { key: "solid", icon: "━", label: "实线" },
    { key: "wavy", icon: "﹏", label: "波浪" },
    { key: "dashed", icon: "┄", label: "虚线" },
    { key: "double", icon: "═", label: "双线" },
    { key: "dotted", icon: "┉", label: "点线" },
  ];

  return `
    <div class="whale-matrix-picker">
      <div class="whale-matrix-header">
        <span class="whale-matrix-icon">🎨</span>
        <span>正文下划线自定义</span>
      </div>
      <div class="whale-matrix-subtitle">${colors.length} 种颜色 × ${lineStyles.length} 种线型 = ${colors.length * lineStyles.length} 种组合自由搭配</div>
      <div class="whale-matrix-colors">
        ${colors.map(c => `
          <button class="whale-matrix-color-dot ${(c.value === selectedColor) ? 'active' : ''}"
                  data-color="${c.value}" style="background:${c.value}" title="${c.name}"></button>
        `).join("")}
      </div>
      <div class="whale-matrix-lines">
        ${lineStyles.map(ls => `
          <button class="whale-matrix-line-btn ${(ls.key === selectedStyle) ? 'active' : ''}"
                  data-style="${ls.key}" title="${ls.label}">
            <span class="whale-matrix-line-icon" style="text-decoration: underline; text-decoration-style: ${ls.key};">${ls.icon}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

// ============ 标签管理弹窗（2026-08-14 新增）============

/**
 * 渲染「管理标签」弹窗的 HTML 内容（不含事件绑定）。
 * 提供标签的增删改 + 颜色查看入口。
 *
 * 注意：此函数只返回 HTML 字符串；事件绑定由 index.ts 调用方完成。
 */
export function renderLabelManagementDialog(labels: { id: string; name: string; color: string }[]): string {
  const rows = labels.map((l) => `
    <div class="hiword-vb-label-mgmt-row" data-id="${escAttr(l.id)}">
      <span class="hiword-vb-label-mgmt-swatch" style="background:${l.color}" data-action="label-cycle-color" title="点击循环更换颜色"></span>
      <span class="hiword-vb-label-mgmt-name" data-action="label-rename">${esc(l.name)}</span>
      <input type="text" class="hiword-vb-label-mgmt-input" style="display:none;" value="${escAttr(l.name)}" data-action="label-rename-input" />
      <span class="hiword-vb-label-mgmt-id" title="${l.id}">#${l.id.slice(-6)}</span>
      <button type="button" class="hiword-vb-label-mgmt-del" data-action="label-delete" title="删除标签（仅删定义，已标注数据保留）">✕</button>
    </div>
  `).join("");

  return `
    <div class="hiword-vb-label-mgmt">
      <div class="hiword-vb-section-tag whale-card-tag-primary">
        <span class="whale-card-section-icon">🏷️</span><span>管理标签</span>
        <span class="hiword-vb-label-mgmt-count">${labels.length}</span>
      </div>
      <p class="hiword-vb-label-mgmt-hint">删除标签仅移除定义，已批注/已打词的标签引用会保留（显示灰色 #id 后缀）。</p>
      <div class="hiword-vb-label-mgmt-list" id="hiword-vb-label-mgmt-list">
        ${rows || `<div class="hiword-vb-label-empty-hint">还没有标签，先在批注弹窗用「＋ 新建标签」创建。</div>`}
      </div>
      <div class="hiword-vb-label-mgmt-new">
        <span class="whale-card-section-icon">➕</span>
        <input type="text" id="hiword-vb-label-mgmt-new-input" class="b3-text-field" placeholder="新建标签名称（如 口语 / 作文素材）" />
        <button type="button" class="b3-button b3-button--small b3-button--outline" id="hiword-vb-label-mgmt-new-btn">创建</button>
      </div>
    </div>
  `;
}
