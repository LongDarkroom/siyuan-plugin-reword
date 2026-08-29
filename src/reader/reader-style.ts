/**
 * 阅读器 - 排版样式生成器（EPUB 适配增强）
 * --------------------------------------------------------------------
 * 把 ReaderView.svelte 的 buildStyles() 拆成纯函数，便于单测与复用。
 *
 * 关键约束（来自用户 2026-08-23 反馈）：
 * 1. **绝不修改书籍文件内容** —— 本模块只产出 CSS 字符串，注入到 foliate-view
 *    的 `<style>` 标签里；不删/不改/不写回任何 epub xhtml DOM、不改元素 style 属性。
 * 2. **不隐藏脚注** —— 保留 <aside epub:type="footnote"> 原样显示。
 * 3. **跨平台 CJK 字体栈** —— macOS / Windows / Linux 都能找到中文字体。
 * 4. **用 !important 覆盖 epub 内联 style**（内联 style specificity 1,0,0,0，
 *    普通选择器 0,0,0,1 赢不过；用 !important 提升选择器优先级；**不修改元素 style 属性**）。
 *
 * 适配对象根因（用户书「北欧向左，美国向右？」实测）：
 * - 段内 <span style="font-size:16px;font-family:'PingFang SC'"> 嵌套
 *   → CSS 选 p span { font-size: inherit !important } 让正文走 root font-size
 * - 段落 <p> 无外边距 → 0.6em 0 段距
 * - 跨平台字体不一致 → CJK fallback chain
 * - <p> 内联 line-height 缺失 → 走 body line-height
 *
 * 参考：foliate-js `paginator.setStyles(styles: string)`（paginator.js:3837-3858）
 *       思阅 / Readest 通用做法：注入 user CSS 覆盖 epub 默认样式。
 */

import {
  SERIF_FONT_PRESETS,
  SANS_SERIF_FONT_PRESETS,
  MONOSPACE_FONT_PRESETS,
} from "./reader-settings.ts";

export type ReaderStyleTheme = "light" | "almond" | "autumn" | "green" | "blue" | "night" | "dark" | "gold" | "custom";

export type ReaderStyleLineWidth = "narrow" | "normal" | "wide";

/** 正文默认字体链（2026-08-28 分类字体） */
export type ReaderStyleDefaultFontFamily = "serif" | "sans-serif";

export interface ReaderStyleInput {
  /** 字号 12-28 px */
  fontSize: number;
  /** 行距 1.4-2.2 */
  lineHeight: number;
  theme: ReaderStyleTheme;
  customFg?: string;
  customBg?: string;
  /** 自定义背景图 URL（theme=custom 时生效，2026-08-27 晚 P2.3） */
  customBgImage?: string;
  lineWidth: ReaderStyleLineWidth;
  /** 字体来源（只用于决定 fontCss 是否非空；不参与本模块其他逻辑） */
  fontMode: "follow-siyuan" | "custom" | "system" | "classified";
  customFontId?: string;
  /* ---- 2026-08-28 分类字体（fontMode=classified 时生效）---- */
  /** 正文默认走哪条链 */
  defaultFontFamily?: ReaderStyleDefaultFontFamily;
  /** 衬线链首选字体 */
  serifFont?: string;
  /** 无衬线链首选字体 */
  sansSerifFont?: string;
  /** 等宽链首选字体 */
  monospaceFont?: string;
  /** 中文字体：插入每条链次位（留空=不插入） */
  defaultCJKFont?: string;
  /** 是否强制正文继承 body 字体栈（覆盖 epub 内联死字体）；默认 true（运行时总为 boolean） */
  overridePublisherFont?: boolean;
  /** 统一正文字号：压平书籍 p/li 级写死字号（如 font-size: medium），默认 true（运行时总为 boolean） */
  overrideBookFontSize?: boolean;
  /** 专注模式（运行时开关）：高亮视口中心段落、其余淡出；仅滚动模式生效 */
  focusMode?: boolean;
  /** 译文字号（em 倍数，相对正文；默认 0.78；由阅读设置「译文字号」调节，2026-08-28） */
  translationFontSize?: number;
  /** 段落悬停高亮（运行时开关，2026-08-28）：鼠标悬停段落时轻微底色，提升阅读定位感 */
  paragraphHover?: boolean;
  /** 文本设置（2026-08-24 新增） */
  text?: { fontWeight: number; letterSpacing: number };
  /** 段落设置（2026-08-24 新增） */
  paragraph?: { paragraphSpacing: number; textIndent: number };
  /** 页面布局（2026-08-24 新增） */
  layout?: {
    marginTopPx: number;
    marginBottomPx: number;
    marginLeftPx: number;
    marginRightPx: number;
    columnGapPx: number;
  };
}

export interface ReaderStyleOutput {
  bg: string;
  fg: string;
  fg2: string;
  padding: string;
  isDark: boolean;
  /** color-scheme 字符串（light/dark） */
  colorScheme: "light" | "dark";
}

/** 把设置转换为 buildReaderStyles 用的派生参数 */
/** 判断颜色是否为深色（用于「跟随思源」深色模式下的代码块/链接配色） */
function isColorDark(hex: string): boolean {
  const c = (hex || "").replace("#", "").trim();
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16) || 0;
  const g = parseInt(c.slice(2, 4), 16) || 0;
  const b = parseInt(c.slice(4, 6), 16) || 0;
  // 相对亮度（Rec. 601 luma），< 0.5 视为深色
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

export function deriveStyleOutput(
  settings: ReaderStyleInput,
  preset: { bg: string; fg: string; fg2: string },
  lineWidthPreset: { padding: string }
): ReaderStyleOutput {
  // 显式深色主题 OR 解析后的背景为深色（覆盖「跟随思源」+ 思源深色 → bg=#000000 的情况）
  const explicitDark = settings.theme === "dark" || settings.theme === "night" || settings.theme === "gold";
  const isDark = explicitDark || isColorDark(preset.bg);
  return {
    bg: settings.theme === "custom" && settings.customBg ? settings.customBg : preset.bg,
    fg: settings.theme === "custom" && settings.customFg ? settings.customFg : preset.fg,
    fg2: preset.fg2,
    padding: lineWidthPreset.padding,
    isDark,
    colorScheme: isDark ? "dark" : "light",
  };
}

/**
 * 跨平台 CJK 字体栈（macOS / Windows / Linux 都有像样的中文字体）
 * 顺序：macOS 优先 → Windows → Linux 通用 → Noto 系列 → 兜底 sans-serif
 */
export function getDefaultCjkFontStack(): string {
  return [
    // macOS
    '"PingFang SC"',
    '"Hiragino Sans GB"',
    "-apple-system",
    "BlinkMacSystemFont",
    // Windows
    '"Microsoft YaHei"',
    '"微软雅黑"',
    // 跨平台
    '"Source Han Sans CN"',
    '"Noto Sans CJK SC"',
    '"Noto Sans SC"',
    // Linux
    '"WenQuanYi Micro Hei"',
    '"WenQuanYi Zen Hei"',
    // 兜底
    "sans-serif",
  ].join(", ");
}

/* ================= 分类字体（2026-08-28，参考 Readest utils/style.ts:30-63） ================= */

/** 三条字体链（各为可直接用于 font-family 的完整 CSS 字符串） */
export interface FontFamilyLists {
  serif: string;
  sansSerif: string;
  monospace: string;
}

/** 字体名 → CSS 字面量（含空格/中文必须加引号，否则 CSS 解析失败） */
function q(name: string): string {
  return /^[\w-]+$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
}

/**
 * 把用户选的「首选字体」拼成三条完整 fallback 链。
 *
 * 参考 Readest `buildFontFamilyLists()`：用户只选首选字体名，系统自动补全
 * 同类候选池 + CJK 兜底 + 通用族，保证任何字符都有字形（不会方块/乱码）。
 *
 * 链结构（以衬线为例）：
 *   [首选衬线] → [CJK 指定字体] → [衬线候选池其余] → [跨平台 CJK 兜底栈] → serif
 *
 * 为什么每条链都要带 CJK 兜底：英文衬线字体（Georgia/Literata）**没有汉字字形**，
 * 若链尾只有 `serif`，浏览器会用系统默认衬线渲染中文（macOS 上是 Songti SC，
 * Windows 上是 SimSun，观感参差）；显式带 CJK 兜底栈可保证跨平台一致。
 * 等宽链同理——Fira Code 等西文等宽字体同样缺汉字字形。
 *
 * @param serif 衬线链首选字体（空=不指定，走候选池）
 * @param sansSerif 无衬线链首选字体
 * @param monospace 等宽链首选字体
 * @param defaultCJKFont 中文字体（插入每条链次位；空=不插入）
 */
export function buildFontFamilyLists(
  serif: string,
  sansSerif: string,
  monospace: string,
  defaultCJKFont: string
): FontFamilyLists {
  const cjk = (defaultCJKFont || "").trim();
  const cjkFallback = getDefaultCjkFontStack();

  // 衬线链
  const serifChain = [
    ...(serif ? [q(serif)] : []),
    ...(cjk && cjk !== serif ? [q(cjk)] : []),
    ...SERIF_FONT_PRESETS.filter((f) => f !== serif && f !== cjk).map(q),
    cjkFallback,
    "serif",
  ].join(", ");

  // 无衬线链
  const sansSerifChain = [
    ...(sansSerif ? [q(sansSerif)] : []),
    ...(cjk && cjk !== sansSerif ? [q(cjk)] : []),
    ...SANS_SERIF_FONT_PRESETS.filter((f) => f !== sansSerif && f !== cjk).map(q),
    cjkFallback,
    "sans-serif",
  ].join(", ");

  // 等宽链：不插 CJK 指定字体（中文正文不该用等宽），但仍带 CJK 兜底
  // 保证代码注释里的中文有字形；ui-monospace 让 macOS/Windows 走系统最优等宽。
  const monospaceChain = [
    ...(monospace ? [q(monospace)] : []),
    ...MONOSPACE_FONT_PRESETS.filter((f) => f !== monospace).map(q),
    "ui-monospace",
    cjkFallback,
    "monospace",
  ].join(", ");

  return { serif: serifChain, sansSerif: sansSerifChain, monospace: monospaceChain };
}

/** 三条链输出为 CSS 变量（供 body / 代码块 / EPUB 内联关键词替换引用） */
export function fontVariableStyles(lists: FontFamilyLists): string {
  return `:root {
  --reword-serif: ${lists.serif};
  --reword-sans-serif: ${lists.sansSerif};
  --reword-monospace: ${lists.monospace};
}`;
}

/**
 * 分类字体的应用段：body 走默认链，代码类元素走等宽链。
 *
 * 代码块选择器覆盖 EPUB 常见写法：原生 <pre>/<code>/<kbd>/<samp>/<tt>
 * + 常见 class（.code / .monospace / .programlisting / .highlight）。
 * 用 !important 压过书籍内联字体（内联 style specificity 1,0,0,0）。
 */
export function classifiedFontStyles(defaultFamily: ReaderStyleDefaultFontFamily): string {
  const body = defaultFamily === "sans-serif" ? "var(--reword-sans-serif)" : "var(--reword-serif)";
  return `body {
  font-family: ${body} !important;
}
pre, code, kbd, samp, tt,
.code, .monospace, .programlisting, .highlight, .hljs {
  font-family: var(--reword-monospace) !important;
}`.trim();
}

/**
 * 主样式生成器：把现有 buildStyles() 的内容 + EPUB 排版增强 CSS 拼成完整字符串。
 *
 * @param settings ReaderStyleInput
 * @param preset 主题预设 {bg, fg, fg2}
 * @param lineWidthPreset 行宽预设 {padding}
 * @param fontCss 来自 fontCss() 的 @font-face 段（不含 body { font-family }，避免与 fontFamilyStack 冲突）
 * @param fontFamilyStack 完整 font-family 栈（由 ReaderView 组装，含用户字体 + CJK fallback）
 * @returns 完整 CSS 字符串（可传入 foliate view.renderer.setStyles()）
 */
export function buildReaderStyles(
  settings: ReaderStyleInput,
  preset: { bg: string; fg: string; fg2: string },
  lineWidthPreset: { padding: string },
  fontCss: string,
  fontFamilyStack: string
): string {
  const o = deriveStyleOutput(settings, preset, lineWidthPreset);

  // 分类字体模式（2026-08-28）：本模块自行构建三条链，忽略传入的 fontFamilyStack
  const lists =
    settings.fontMode === "classified"
      ? buildFontFamilyLists(
          settings.serifFont ?? "",
          settings.sansSerifFont ?? "",
          settings.monospaceFont ?? "",
          settings.defaultCJKFont ?? ""
        )
      : null;

  // 字体段：分类模式输出「三条链变量 + body/代码块应用」，其余模式输出单一 body 栈
  const fontSegments = lists
    ? [fontVariableStyles(lists), classifiedFontStyles(settings.defaultFontFamily ?? "serif")]
    : [fontFamilyStyles(fontFamilyStack)];

  // 译文字体栈：分类模式下用正文默认链，保证译文与正文视觉同源
  const translationStack = lists
    ? settings.defaultFontFamily === "sans-serif"
      ? lists.sansSerif
      : lists.serif
    : fontFamilyStack;

  return [
    fontCss,
    paragraphStyles(o),
    colorSchemeStyles(o),
    fontSizeOverrideStyles(settings.fontSize, settings.overrideBookFontSize !== false),
    inlineOverrideStyles(),
    publisherFontOverrideStyles(settings.overridePublisherFont !== false),
    focusModeStyles(settings.focusMode === true),
    paragraphHoverStyles(settings.paragraphHover === true),
    bilingualStyles(translationStack, o.fg, settings.translationFontSize ?? 0.62),
    headingStyles(),
    quoteStyles(o),
    listStyles(),
    figureStyles(o),
    bodyStyles(o, settings),
    textStyles(settings.text),
    paragraphLayoutStyles(settings.paragraph),
    layoutMarginStyles(settings.layout),
    ...fontSegments,
    linkStyles(o),
    codeStyles(o),
    colorSchemeStyles(o),
    wordWrapStyles(),
  ].join("\n");
}

/* ================= 各段 CSS（可独立测试） ================= */

/** color-scheme + 根字号 */
export function colorSchemeStyles(o: ReaderStyleOutput): string {
  return `:root { color-scheme: ${o.colorScheme}; }`;
}

/**
 * 字号覆盖段（2026-08-27 修复「字号设置无效」）
 *
 * 根因（用户书《Nate the Great on the Owl Express》实测）：
 * - 书的 CSS 在段落 class 上写死绝对字号：p.k_nonindent_lh { font-size: medium }
 * - CSS 关键字 medium 是「浏览器默认字号」（≈16px），**不随 html 根字号缩放**；
 *   且 p.k_nonindent_lh 特异性 (0,1,1) 高于 html (0,0,1)。
 * - 旧实现只输出 html { font-size: Xpx }，对这类书完全无效 → A+/A- 无反应。
 *
 * 修复策略（flatten=true 时）：
 * 1. body { font-size: Xpx !important } —— !important 压过书籍非 important 声明（与特异性无关）
 * 2. p/li/blockquote/div 等正文容器 font-size: inherit !important —— 压平书籍在
 *    元素/class 上的写死字号，最终全部回到 body 的 Xpx
 * 3. 标题 h1-h6 不在压平列表（headingStyles 已有 em 相对值，随 body 等比缩放）；
 *    figcaption 不压平（figureStyles 的 0.85em 相对值保留）
 *
 * flatten=false 时仅输出 html 根字号（保留书籍原排版，行内 span 仍被 inlineOverrideStyles 压制）。
 */
export function fontSizeOverrideStyles(fontSize: number, flatten: boolean): string {
  const base = `html { font-size: ${fontSize}px; }`;
  if (!flatten) return base;
  return `${base}
body { font-size: ${fontSize}px !important; }
p, li, blockquote, div, dd, dt, td, th {
  font-size: inherit !important;
}`.trim();
}

/** body 主题（背景 / 文字色 / 行高 / 行宽 padding）
 *  **不输出 font-family**，由 fontFamilyStyles() 单一职责管理。
 *  这样能避免与 fontCss() 注入的宿主字体（如「霞鹜文楷」）冲突。
 */
export function bodyStyles(o: ReaderStyleOutput, settings: ReaderStyleInput): string {
  const rawImg = settings.theme === "custom" ? (settings.customBgImage || "").trim() : "";
  const img = rawImg ? rawImg.replace(/"/g, "%22").replace(/\)/g, "%29") : "";
  if (img) {
    // 2026-08-27 晚（P2.3 自定义背景图）：拆简写 background，避免 image 被覆盖
    return `
body {
  background-color: ${o.bg} !important;
  background-image: url("${img}") !important;
  background-size: cover !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-attachment: fixed !important;
  color: ${o.fg} !important;
  line-height: ${settings.lineHeight} !important;
}`.trim();
  }
  return `
body {
  background: ${o.bg} !important;
  color: ${o.fg} !important;
  line-height: ${settings.lineHeight} !important;
}`.trim();
}

/**
 * 单一职责的 font-family 段。
 * 由 ReaderView.svelte 的 fontCss() 拼装完整栈（含用户字体 + CJK fallback）后传入。
 *
 * 为什么独立成段：
 * - 2026-08-23 用户反馈：原 bodyStyles 自带 CJK fallback 覆盖了宿主「霞鹜文楷」
 * - CSS 后写者赢 + !important 同优先级 → 后注入的 font-family 覆盖前者
 * - 拆成独立段确保 buildReaderStyles 输出**只有一处** body font-family 声明
 */
export function fontFamilyStyles(stack: string): string {
  return `body { font-family: ${stack} !important; }`;
}

/** 段落 p 段距 + 对齐 + 取消内联 line-height（2026-08-28 加 text-rendering 精修） */
export function paragraphStyles(o: ReaderStyleOutput): string {
  return `
p {
  margin: 0.6em 0 !important;
  line-height: inherit !important;
  text-align: justify !important;
  text-indent: 0 !important;
  text-rendering: optimizeLegibility !important;
}`.trim();
}

/**
 * 覆盖 epub 内联 style（温和版，方案 A 配套）
 *
 * epubs 经常在 <p> 内嵌 <span style="font-size:16px;font-family:'PingFang SC'">，
 * 内联 style specificity 1,0,0,0 高于普通选择器 0,0,0,1。
 *
 * **2026-08-23 乱码根治（方案 A）重要变更**：
 * - 旧版 `font-family: inherit !important` 激进覆盖导致整链崩坏：当 body 字体栈
 *   含无效宿主字体（跨域/加载失败）时，inherit 会一级级传染无效栈 → 汉字无字形。
 * - 现在**不再覆盖 font-family / font-style / font-weight** —— 内联字体族保留
 *   epub 自带字体（正常书籍有自己的 latin+cjk 字体，且 body 栈的 CJK 兜底仍生效），
 *   只统一压制 font-size，保证字号走阅读器主题设置。
 * - 如果某本书内联 font-family 本身无效，CSS 回退机制会沿各字体名逐级找字形，
 *   最终命中 body 栈的 CJK 字体 —— 这比"强制 inherit"更健壮。
 *
 * **不修改元素 style 属性**，仅靠 CSS 优先级压过。
 */
export function inlineOverrideStyles(): string {
  return `
p span, p div, p b, p i, p em, p strong, p a,
li span, li div, li b, li i, li em, li strong, li a,
blockquote span, blockquote div, blockquote b, blockquote i,
h1 span, h2 span, h3 span, h4 span, h5 span, h6 span {
  font-size: inherit !important;
}`.trim();
}

/**
 * 强制正文元素继承 body 字体栈（覆盖 epub 内联死字体）。
 * 参考 Readest / 思阅「覆盖出版商字体」(Override Publisher Font)：
 * epub 常在 <p>/<span> 上写死 `font-family: 'PingFang SC'` 等系统字体，
 * 导致正文混用系统字体 + 用户字体（如《北欧向左，美国想右》截图表象）。
 * 开启后统一回退到 body 的霞鹜文楷；关闭则保留 epub 原排版（仅统一字号）。
 * 安全前提：字体栈已反转（霞鹜文楷前置 + CJK 本机栈兜底），inherit 不会整链崩坏。
 *
 * @param enabled 来自 settings.overridePublisherFont（设置面板开关，默认 true）
 */
export function publisherFontOverrideStyles(enabled: boolean): string {
  if (!enabled) return "";
  return `
p, li, blockquote,
p span, p div, p b, p i, p em, p strong, p a,
li span, li div, li b, li i, li em, li strong, li a,
blockquote span, blockquote div, blockquote b, blockquote i {
  font-family: inherit !important;
}`.trim();
}

/** 标题层级（h1-h6）（2026-08-28 加字距精修） */
export function headingStyles(): string {
  return `
h1, h2, h3, h4, h5, h6 {
  font-family: inherit !important;
  font-weight: 600 !important;
  line-height: 1.3 !important;
  letter-spacing: 0.02em !important;
  margin: 1em 0 0.5em !important;
  page-break-after: avoid;
  break-after: avoid;
}
h1 { font-size: 1.6em !important; }
h2 { font-size: 1.4em !important; }
h3 { font-size: 1.2em !important; }
h4 { font-size: 1.1em !important; }
h5 { font-size: 1.05em !important; }
h6 { font-size: 1em !important; }`.trim();
}

/** 引用块 blockquote（2026-08-28 柔和化：左边线 + 微底色 + 圆角，不再整块压暗） */
export function quoteStyles(o: ReaderStyleOutput): string {
  return `
blockquote {
  margin: 0.8em 1.5em !important;
  padding: 0.4em 1em !important;
  border-left: 3px solid currentColor !important;
  background: rgba(128, 128, 128, 0.06) !important;
  border-radius: 0 4px 4px 0 !important;
  font-style: italic !important;
}`.trim();
}

/** 列表 ul/ol 缩进 */
export function listStyles(): string {
  return `
ul, ol {
  margin: 0.6em 0 0.6em 1.5em !important;
  padding-left: 1em !important;
}
li {
  margin: 0.3em 0 !important;
}`.trim();
}

/** 图片 figure/figcaption（2026-08-28 加 img 约束：自适应宽度、不溢出、圆角） */
export function figureStyles(o: ReaderStyleOutput): string {
  return `
figure {
  margin: 1em 0 !important;
  text-align: center !important;
}
figure img {
  max-width: 100% !important;
  height: auto !important;
  border-radius: 4px !important;
}
figcaption {
  font-size: 0.85em !important;
  opacity: 0.7;
  margin-top: 0.4em !important;
  text-align: center !important;
}`.trim();
}

/** 链接 a */
export function linkStyles(o: ReaderStyleOutput): string {
  return `a { color: ${o.isDark ? "#85B7EB" : "#185FA5"} !important; }`;
}

/** 代码块 pre / code */
export function codeStyles(o: ReaderStyleOutput): string {
  return `pre { background: ${o.isDark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.06)"} !important; }`;
}

/** word-wrap（避免超长 URL / 英文单词撑出右边界） */
export function wordWrapStyles(): string {
  return `body, p, li, blockquote { word-wrap: break-word; overflow-wrap: break-word; }`;
}

/* ================= 2026-08-24 新增 4 大设置组 CSS ================= */

/**
 * 文本设置：字重 + 字距（注入到 body）
 * 缺省时用 400 / 0，向后兼容旧 settings（无 text 字段）
 */
export function textStyles(input?: { fontWeight: number; letterSpacing: number }): string {
  const fw = input?.fontWeight ?? 400;
  const ls = input?.letterSpacing ?? 0;
  return `body { font-weight: ${fw} !important; letter-spacing: ${ls}px !important; }`;
}

/**
 * 段落设置：段距 + 首行缩进
 * 缺省时用 0.8em / 0（接近 SiReader 默认）
 */
export function paragraphLayoutStyles(input?: { paragraphSpacing: number; textIndent: number }): string {
  const ps = input?.paragraphSpacing ?? 0.8;
  const ti = input?.textIndent ?? 0;
  return `p { margin-bottom: ${ps}em !important; text-indent: ${ti}em !important; }`;
}

/**
 * 页面布局：4 边距（统一映射为 body padding，控制正文与视口边缘的距离）+ 分栏间距。
 * 缺省时用 16 / 16 / 16 / 16 / 16。
 *
 * ⚠️ 2026-08-29 修正：此前输出 `body { margin }`，但 foliate 分页/滚动视图里 body 的
 * margin 基本不生效（被渲染层裁掉/折叠），导致「边距滑块调了没反应、左右间距过大」的
 * 体感。真正撑开内容的是 body padding（即旧 lineWidth 行宽预设杠杆）。故改为输出
 * `body { padding: T R B L }`，由 4 个边距滑块 / 三档预设统一驱动。
 */
export function layoutMarginStyles(input?: {
  marginTopPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  marginRightPx: number;
  columnGapPx: number;
}): string {
  const mt = input?.marginTopPx ?? 16;
  const mb = input?.marginBottomPx ?? 16;
  const ml = input?.marginLeftPx ?? 16;
  const mr = input?.marginRightPx ?? 16;
  const gap = input?.columnGapPx ?? 16;
  return `body { padding: ${mt}px ${mr}px ${mb}px ${ml}px !important; column-gap: ${gap}px; }`;
}

/**
 * 专注模式（2026-08-27 晚 P2.2）：高亮视口中心段落、其余淡出。
 * 由 ReaderView 在 iframe 内容文档给 <body> 加 .reword-focus、给中心 <p>/<li>/<blockquote> 加 .in-center；
 * 本段只负责「非中心元素淡出」的样式（注入到 foliate 内容文档，与字号/字体同属 user CSS）。
 * 仅滚动模式有意义（分页模式无滚动，中心段落概念不成立 → 调用方不开启 .reword-focus）。
 */
export function focusModeStyles(enabled: boolean): string {
  if (!enabled) return "";
  return `
.reword-focus p:not(.in-center),
.reword-focus li:not(.in-center),
.reword-focus blockquote:not(.in-center) {
  opacity: 0.32 !important;
  transition: opacity 0.25s ease;
}
.reword-focus .in-center {
  opacity: 1 !important;
  transition: opacity 0.25s ease;
}`.trim();
}

/**
 * 双语对照译文样式（2026-08-28 v2「思源字体 + Readest 极简」）：
 * 顶栏「双语」开启后，每段正文内注入 `.reword-bilingual` 译文块（appendChild 子节点）。
 * 该节点位于 foliate 内容 iframe 内，必须由 user CSS 注入（Svelte 组件 scoped 样式够不到）。
 *
 * 设计原则（结合思源笔记 + Readest 实践）：
 * 1. 译文用「思源阅读字体栈」(fontFamilyStack !important) + 思源正文色(具体 hex fg)：
 *    iframe 内**读不到**思源父文档的 --b3-* CSS 变量，故必须传具体值；用思源字体栈
 *    保证译文与思源笔记视觉一致（而非继承书籍 serif 英文字体发虚）。
 * 2. 字号由 translationFontSize（默认 0.78em，设置可调）控制，相对正文独立、不抢焦点。
 * 3. 仅轻微透明（opacity 0.9）—— 译文是辅助信息但不被强压暗。
 * 4. 无边框 / 无底色 / 无圆角 —— 与 Readest 一致，译文自然融入正文作为「内容的一部分」。
 * 5. user-select:none 防误选；data-translation-mark 保护划词 CFI。
 *
 * @param fontFamilyStack 思源阅读字体栈（含用户字体 + CJK 兜底）
 * @param fg 思源正文色（具体 hex，来自 deriveStyleOutput）
 * @param translationFontSize 译文字号 em 倍数（默认 0.62）
 */
export function bilingualStyles(fontFamilyStack: string, fg: string, translationFontSize: number): string {
  const fs = Number.isFinite(translationFontSize) && translationFontSize > 0 ? translationFontSize : 0.62;
  return `
/* ---- 双语译文块（段落内子节点注入，紧贴书籍排版） ---- */
.reword-bilingual {
  display: block !important;
  /* 紧贴原文，极简间距 */
  margin: 0.15em 0 0 0;
  padding: 0;

  /* 字号：默认 0.62em —— CJK 字体（霞鹜文楷/苹方）的 x-height 远大于英文 serif，
     0.62em 渲染后视觉尺寸 ≈ 英文正文的 0.88~0.92 倍，略小一号、不抢焦点 */
  font-size: ${fs}em;
  /* 行高比正文紧凑一点（正文通常 1.6~1.8），避免译文撑开过多空间 */
  line-height: 1.45;
  font-weight: 400;

  /* 字体：思源阅读字体栈（!important 压过 publisherFontOverride 的 inherit） */
  font-family: ${fontFamilyStack} !important;
  /* 色彩：思源正文色（具体 hex，iframe 内 --b3-* 不可达） */
  color: ${fg};
  /* 轻微透明：译文是辅助信息，淡于原文但不至于看不清 */
  opacity: 0.82;

  /* 与原文对齐：继承父段落的 text-indent（书籍段落常首行缩进 1~2em） */
  text-indent: inherit;
  /* CJK 字间距微调，让中文更紧凑自然 */
  letter-spacing: 0.02em;

  /* 无边框 / 无底色 / 无圆角 —— Readest 极简哲学 */

  /* 行为 */
  word-break: break-word;
  overflow-wrap: break-word;
  user-select: none;
  transition: opacity 0.2s ease;
}

/* 悬停时恢复完全不透明 */
.reword-bilingual:hover {
  opacity: 1;
}

/* 列表项内的译文：随原文缩进，避免与项目符号视觉冲突 */
li > .reword-bilingual {
  margin: 0.12em 0 0 1em;
}`.trim();
}

/**
 * 段落悬停高亮（2026-08-28，C2 增强项）：
 * 鼠标悬停段落时轻微底色 + 圆角，提升阅读定位感（专注模式外的轻量辅助）。
 * 必须由 ReaderView 在 body 上加 `.reword-p-hover` 类才生效（避免默认开启干扰）。
 * 颜色用具体 rgba（iframe 内 --b3-* 不可达），深浅主题统一柔和灰。
 */
export function paragraphHoverStyles(enabled: boolean): string {
  if (!enabled) return "";
  return `
.reword-p-hover p:hover,
.reword-p-hover li:hover,
.reword-p-hover blockquote:hover {
  background: rgba(128, 128, 128, 0.07) !important;
  border-radius: 4px !important;
  transition: background 0.15s ease;
}`.trim();
}

/* ================= 内部辅助（不导出，避免外部误用） ================= */

/**
 * 验证 buildReaderStyles 输出包含必要段（仅供内部 / 测试使用）
 * 不导出以避免外部依赖；若测试需要可手动 grep 输出字符串。
 */
function _sanityCheckUnused(): void {
  // 占位，让 buildReaderStyles 引用所有子函数以避免 tree-shake 误删
  const _x = [paragraphStyles, inlineOverrideStyles, headingStyles, quoteStyles, listStyles, figureStyles, bodyStyles, textStyles, paragraphLayoutStyles, layoutMarginStyles, linkStyles, codeStyles, colorSchemeStyles, wordWrapStyles, fontSizeOverrideStyles, focusModeStyles, bilingualStyles, paragraphHoverStyles, buildFontFamilyLists, fontVariableStyles, classifiedFontStyles, fontFamilyStyles];
  void _x;
}
