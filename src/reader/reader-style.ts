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
  /**
   * 排版让位（2026-10-06，Readest 同思路）：书籍自带排版值是否让位给用户设置。
   * - `true`（默认，与 Readest 的 overrideLayout 同义）：先清洗书籍写在 body/容器上的
   *   脏排版值（line-height / text-align / hyphens / text-indent 等），再把用户设置
   *   以 `!important` 施加上去 ⇒ 设置真正说了算，书籍脏值不再压过用户意图。
   * - `false`：完全尊重书籍排版（"使用书籍原版排版"），本插件不施加 line-height /
   *   text-indent / 字距 / 断词等覆盖，只保留颜色、字号、字体族与容器对齐。
   *
   * ⚠️ 与 `overridePublisherFont` / `overrideBookFontSize` 独立：那两个管**字体与字号**，
   * 本项管**段落级排版**（行距/缩进/对齐/断词）。
   */
  overrideBookLayout?: boolean;
  /**
   * 竖排（中文竖排阅读）：默认关。开启后注入 `writing-mode: vertical-rl`，
   * vendored paginator 即自动切换全套竖排布局（column-gap 换轴、max-width→max-height、
   * 翻页方向翻转），插件侧只需做竖排专属排版适配。详见 verticalWritingStyles()。
   */
  verticalWriting?: boolean;
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

/* ================= 思源调色板桥接（iframe 内 --b3-* 不可达，必须在父文档抓取后注入） ================= */

/**
 * 思源主题调色板（阅读器需要、且应跟随思源外观的变量子集）。
 * 不在此列的项（如各主题预设的纯色背景）仍由阅读器自带主题控制，不跟随思源。
 *
 * 2026-08-31 v1.4.5 P4：补齐"选区色 / 搜索高亮 / 错误色"三类，让阅读器与思源主题联动。
 */
export interface SiyuanThemeVars {
  bg: string;
  onBackground: string;
  onSurface: string;
  onSurfaceLight: string;
  primary: string;
  surface: string;
  border: string;
  link: string;
  codeBg: string;
  bqBg: string;
  markBg: string;
  /** 选区底色（rgba 形式，思源主色 25% 透明）。selectionStyles() 实际渲染时用 var(--b3-theme-primary) + color-mix 派生更精细 */
  selectionBg: string;
  /** 搜索高亮色（思源主色 50% 透明）。与选区色错开，避免视觉冲突 */
  searchHighlight: string;
  /** 错误色（思源 --b3-theme-error，用于翻译失败占位 / 批注错误等） */
  error: string;
}

/**
 * 在「父文档」（思源主窗口）抓取思源调色板。
 *
 * 关键约束：阅读器运行在 foliate 的 <iframe> 内，CSS 自定义属性**不会跨 iframe 继承**，
 * 所以无法在阅读器 CSS 里直接写 `var(--b3-theme-primary)` 并期望它取到思源的值。
 * 必须在父文档用 `getComputedStyle(document.documentElement)` 读取后，
 * 经 {@link siyuanVarBridgeStyles} 把值重新声明进 iframe 的 `:root`，下游样式才能用 `var(--b3-*)`。
 *
 * 本函数刻意不直接访问 `document`，而是接收 `get(name, fallback)` 读取器，
 * 由调用方（ReaderView.svelte 的 getSiyuanVar）注入父文档上下文，保持本模块纯函数、可单测。
 */
export function captureSiyuanThemeVars(
  get: (name: string, fallback: string) => string
): SiyuanThemeVars {
  const primary = get("--b3-theme-primary", "#0f6bff");
  return {
    bg: get("--b3-theme-background", "#ffffff"),
    onBackground: get("--b3-theme-on-background", "#222222"),
    onSurface: get("--b3-theme-on-surface", "#888888"),
    onSurfaceLight: get("--b3-theme-on-surface-light", "#9aa0a6"),
    primary,
    surface: get("--b3-theme-surface", "#f7f8fa"),
    border: get("--b3-border-color", "#e0e0e0"),
    link: get("--b3-protyle-inline-link-color", "#185FA5"),
    codeBg: get("--b3-protyle-code-background", "rgba(128,128,128,0.08)"),
    bqBg: get("--b3-bq-background", "rgba(128,128,128,0.06)"),
    markBg: get("--b3-protyle-inline-mark-background", "#ffe9a8"),
    // 选区色：思源主色 50% 透明（v1.4.5 P5：与主文档选区色统一）
    // hex → rgba 简单换算，作为 fallback 备查；真实渲染走 selectionStyles() 的
    // var(--b3-theme-primary) + color-mix() 派生（精度更高）
    selectionBg: hexToRgba(primary, 0.5),
    // 搜索高亮：思源主色 70% 透明（更深更显眼，与 50% 选区色错开）
    searchHighlight: hexToRgba(primary, 0.7),
    // 错误色：思源 --b3-theme-error
    error: get("--b3-theme-error", "#d44c47"),
  };
}

/**
 * hex → rgba 简单换算（不支持 #rrggbbaa 8 位形式，思源 v3.8 也不输出 8 位）
 * 用于 selectionBg / searchHighlight 等需要"主色 + 透明度"预计算的兜底场景
 * 真实渲染优先用 selectionStyles() 的 var(--b3-theme-primary) + color-mix() 派生（精度更高）
 */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return `rgba(15, 107, 255, ${alpha})`; // fallback to default primary
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 把思源调色板作为 `:root` 变量注入阅读器 iframe。
 * 必须前置在 buildReaderStyles 输出的最前面，下游 linkStyles/codeStyles/quoteStyles/bilingualStyles
 * 才能用 `var(--b3-*)` 解析到思源真实色值（带 fallback，思源变量缺失时回退到中性色）。
 */
export function siyuanVarBridgeStyles(v: SiyuanThemeVars): string {
  return `:root {
  --b3-theme-background: ${v.bg};
  --b3-theme-on-background: ${v.onBackground};
  --b3-theme-on-surface: ${v.onSurface};
  --b3-theme-on-surface-light: ${v.onSurfaceLight};
  --b3-theme-primary: ${v.primary};
  --b3-theme-surface: ${v.surface};
  --b3-border-color: ${v.border};
  --b3-protyle-inline-link-color: ${v.link};
  --b3-protyle-code-background: ${v.codeBg};
  --b3-bq-background: ${v.bqBg};
  --b3-protyle-inline-mark-background: ${v.markBg};
  --reword-selection-bg: ${v.selectionBg};
  --reword-search-highlight: ${v.searchHighlight};
  --b3-theme-error: ${v.error};
}`.trim();
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

  return {
    serif: withDigitFix(serifChain),
    sansSerif: withDigitFix(sansSerifChain),
    monospace: monospaceChain,   // 等宽链不修数字（代码对齐依赖等宽字形）
  };
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
 * 跟随思源 / 自定义模式：用传入字体栈（宿主栈 + CJK 兜底）定义 --reword-* 三链变量。
 *
 * 2026-09-02 修复（Bug：跟随思源 + 强制覆盖书籍字体 对某些书无效）：
 * 分类模式靠 applyFontKeywordRewrite() 把书内通用族关键词（serif/sans-serif/monospace）
 * 重定向到 var(--reword-*)，从而覆盖「不在 p/li/blockquote 内、用 div/span 布局」的正文。
 * 但该函数此前仅在 fontMode==="classified" 调用，--reword-* 也只在分类模式定义；
 * 跟随思源 / 自定义模式既没调用、变量也未定义 → 这类书漏覆盖。
 * 此处让非分类模式也能注入 --reword-*（与分类同源语义），配合 ReaderView 在开启
 * overridePublisherFont 时同样跑关键词重写，使跟随思源与分类的覆盖能力一致。
 * 等宽链补一个 monospace 兜底，避免代码块失去等宽特性。
 */
export function fontVariableStylesFromStack(stack: string): string {
  // 2026-09-29 P0：--reword-monospace 改为真等宽链（此前 = 正文栈+monospace，
  // 书内 monospace 关键词重写后会落到楷体——代码对齐/等宽全失）。
  const mono = MONO_STACK;
  return `:root {
  --reword-serif: ${stack};
  --reword-sans-serif: ${stack};
  --reword-monospace: ${mono};
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
  fontFamilyStack: string,
  siyuanVars?: SiyuanThemeVars
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

  // 字体段：
  // - 分类模式输出「三条链变量 + body/代码块应用」（该模式自带覆盖语义，维持原状）
  // - 其余模式输出双态 body 栈（overrideFont 决定 !important+revert 还是 :where 零特异性）；
  //   若开启「强制覆盖书籍字体」且非系统模式，再注入 --reword-* 变量，使 applyFontKeywordRewrite
  //   能把书内 serif/sans-serif/monospace 关键词重定向（monospace 现为真等宽链）。
  const overrideFont = settings.overridePublisherFont !== false;
  let fontSegments: string[];
  if (lists) {
    fontSegments = [
      fontVariableStyles(lists),
      classifiedFontStyles(settings.defaultFontFamily ?? "serif"),
    ];
  } else {
    fontSegments = [fontFamilyStyles(fontFamilyStack, overrideFont)];
    if (settings.fontMode !== "system" && overrideFont) {
      fontSegments.push(fontVariableStylesFromStack(fontFamilyStack));
    }
  }

  // 译文字体栈：分类模式下用正文默认链，保证译文与正文视觉同源
  const translationStack = lists
    ? settings.defaultFontFamily === "sans-serif"
      ? lists.sansSerif
      : lists.serif
    : fontFamilyStack;

  // 2026-10-06 Readest 同思路：段落级排版由 overrideBookLayout 统一门控。
  // 开启（默认）→ 清洗书籍脏排版值 + 用户设置以 !important 施加；
  // 关闭 → 只保留颜色/字号/字体族/容器横向对齐，排版权交还书籍。
  const overrideLayout = settings.overrideBookLayout !== false;

  const parts = [
    cjkAliasFontFaces() + "\n" + digitFixFaceCss() + (fontCss ? "\n" + fontCss : ""),
    uniformBlockResetStyles(overrideLayout),
    paragraphStyles(o),
    colorSchemeStyles(o),
    fontSizeOverrideStyles(settings.fontSize, settings.overrideBookFontSize !== false),
    inlineOverrideStyles(),
    codeFontStyles(overrideFont),
    legacyFontSizeStyles(),
    focusModeStyles(settings.focusMode === true),
    paragraphHoverStyles(settings.paragraphHover === true),
    bilingualStyles(translationStack, o.fg, settings.translationFontSize ?? 0.62),
    headingStyles(),
    quoteStyles(),
    listStyles(),
    figureStyles(o),
    bodyStyles(o, settings),
    textStyles(settings.text, overrideLayout),
    paragraphLayoutStyles(settings.paragraph, overrideLayout, settings.lineHeight),
    layoutMarginStyles(settings.layout),
    ...fontSegments,
    linkStyles(),
    codeStyles(),
    colorSchemeStyles(o),
    wordWrapStyles(overrideLayout),
    // 2026-10-06 竖排：注入 writing-mode 即触发引擎全套竖排布局（须在排版段之后，
    // 让本段对 line-height/text-indent/text-align 的覆盖赢过横排段）。
    // 竖排下首行缩进改走 --rwt-vertical-indent（em 数），因为 text-indent 在竖排无位移。
    settings.verticalWriting === true
      ? `:root { --rwt-vertical-indent: ${settings.paragraph?.textIndent ?? 0}; }\n` +
        verticalWritingStyles(true)
      : "",
    // 2026-08-31 v1.4.5 P4.2：选区色 / 搜索高亮（思源主题联动 + 书内色温调节）
    selectionStyles(settings.theme),
  ];
  // 思源调色板桥接块须在所有 var() 使用之前声明；仅当传入 siyuanVars 才前置，避免空字符串留下多余换行
  const bridge = siyuanVars ? siyuanVarBridgeStyles(siyuanVars) + "\n" : "";
  return bridge + parts.join("\n");
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

/**
 * 2026-08-31 v1.4.5 P4.2：选区 / 搜索高亮样式（思源主题联动 + 书内主题色温调节）。
 *
 * 关键设计：
 *  - 选区色基底 = 思源 `--b3-theme-primary`（25% 透明）：用户切换思源主题时实时跟随
 *  - 文本色 `inherit`：不破坏书内主题（sepia 主题用暖色时，选区文字仍是书色不被选区色覆盖）
 *  - color-mix()：现代 CSS 推导（透明 + 主色），不支持的浏览器降级到 --reword-selection-bg 预计算 rgba
 *  - 书内主题色温调节：sepia 主题选区色变暖（米黄），dark 主题选区色提亮（更显），auto 跟思源
 *  - PDF 选区由 pdfjs 自带 AccentColor 处理，**不**被本样式覆盖（pdfjs 选择器在 vendor CSS 中更具体）
 *
 * 联动矩阵：
 *   思源 Light + 书 light    → 选区 = 蓝 25%（你截图里 pancakes 的色就是这种，巧合）
 *   思源 Light + 书 sepia   → 选区 = 暖米黄 30%（`color-mix` 派生）
 *   思源 Dark  + 书 dark     → 选区 = 亮蓝 30%（color-mix 衍生）
 *   思源自定义主色           → 选区 = 自定义色 25%
 *
 * @param theme 书内主题（"auto" / "light" / "sepia" / "night" / "dark" / "almond" / ...）
 *               仅 sepia/night/almond/autumn 等暖/暗主题需要色温调节；light/dark 走默认
 */
export function selectionStyles(theme: string = "auto"): string {
  // 暖主题：选区色往米黄/棕色偏（sepia/almond/autumn/gold）
  // 暗主题：选区色提亮（night/dark）
  // 其他（light/auto）：走思源主色原汁原味
  const isWarm = theme === "sepia" || theme === "almond" || theme === "autumn" || theme === "gold";
  const isDark = theme === "night" || theme === "dark";
  // 暖主题：color-mix 把思源主色往 sepia 暖色（#c4a06a 模拟米黄）拉 30%
  // 暗主题：color-mix 把思源主色往白色拉 30%（提亮）
  const tintCss = isWarm
    ? `::selection { background: color-mix(in srgb, var(--b3-theme-primary, #0f6bff) 30%, #c4a06a 70%); }`
    : isDark
    ? `::selection { background: color-mix(in srgb, var(--b3-theme-primary, #0f6bff) 30%, white 30%); }`
    : "";
  return `
/* === 选区底色：跟思源主色 50% 透明（v1.4.5 P5：与主文档选区色统一） === */
::selection {
  background: var(--reword-selection-bg, rgba(15, 107, 255, 0.5));
  color: inherit;
}
::-moz-selection {
  background: var(--reword-selection-bg, rgba(15, 107, 255, 0.5));
  color: inherit;
}
/* 现代 CSS：color-mix 派生的精细版（浏览器支持时优先用，色值更准） */
@supports (background: color-mix(in srgb, red, transparent 50%)) {
  ::selection {
    background: color-mix(in srgb, var(--b3-theme-primary, #0f6bff) 50%, transparent);
  }
  ::-moz-selection {
    background: color-mix(in srgb, var(--b3-theme-primary, #0f6bff) 50%, transparent);
  }
}
/* 书内主题色温调节：暖主题往米黄、暗主题提亮 */
${tintCss}

/* === 搜索高亮：思源主色 70% 透明（更深更显眼，与选区色 50% 错开） === */
mark.reword-search-hit,
.reader ::mark.reword-search-hit {
  background: var(--reword-search-highlight, rgba(15, 107, 255, 0.7));
  color: inherit;
  padding: 0 1px;
  border-radius: 2px;
}
@supports (background: color-mix(in srgb, red, transparent 50%)) {
  mark.reword-search-hit,
  .reader ::mark.reword-search-hit {
    background: color-mix(in srgb, var(--b3-theme-primary, #0f6bff) 70%, transparent);
  }
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
/**
 * 正文字体族（2026-09-29 P0 字体兼容：Readest 双态覆盖开关）。
 *
 * overrideFont=true（覆盖出版商字体）：
 *   body 强制正文栈 + 全后代 `font-family: revert !important`（Readest 同款）。
 *   相比旧的「p/li/blockquote 子树 inherit」链，revert 版覆盖 **body 下所有元素**
 *   （含 div/span 布局的正文，补上 2026-09-02 那类漏覆盖），同时排除代码元素与
 *   双语译文块；revert 语义 = 回退到作者级联之前 ⇒ 继承到 body 的应用字体栈。
 * overrideFont=false（尊重书籍字体）：
 *   `:where(html body)` **零特异性**默认值 —— 书在 html/body/元素级声明的任何
 *   font-family 都能赢（此前 body !important 会把书级字体也压掉）；没写字体的
 *   元素照常继承到应用字体栈。数字修复 face（withDigitFix）两种模式都前置。
 */
export function fontFamilyStyles(stack: string, overrideFont = true): string {
  if (overrideFont) {
    const skip =
      ":not(pre, code, kbd, samp, tt, .code, .monospace, .programlisting, .highlight, .hljs, .reword-bilingual):not(pre *, code *, kbd *, samp *, tt *, .code *, .monospace *, .reword-bilingual *)";
    return `
body { font-family: ${withDigitFix(stack)} !important; }
body *${skip} {
  font-family: revert !important;
}`.trim();
  }
  return `:where(html body) { font-family: ${withDigitFix(stack)}; }`;
}

/**
 * 中文泛型字体族别名映射（2026-09-29 P0 字体兼容，Readest 同思路扩展）。
 * 中文 EPUB 常写 font-family:"Kaiti"/"仿宋"/"SimHei" 等，系统字体实际注册名
 * 不同（楷体-简/Kaiti SC/SimSun…）→ 名字对不上整段回落默认字体。
 * 每个别名 @font-face 的 family 名 = 书内高频引用名；src = 本机候选链
 * （macOS/Windows/Linux 覆盖），全部 local() 失败则该 face 无效、自动回落
 * 正文栈（零风险）。**不含在线兜底**（离线优先，外链不稳定）。
 * 主要在 overrideFont=false（尊重书籍字体）时发挥作用；override=true 时书内
 * 声明被 revert 压平，别名仅对带 !important 的书内声明生效（罕见）。
 */
export function cjkAliasFontFaces(): string {
  const face = (family: string, locals: string[]): string =>
    `@font-face{font-family:"${family}";font-display:swap;src:${locals
      .map((n) => `local("${n}")`)
      .join(",")};}`;
  const kai = ["Kaiti SC", "STKaiti", "KaiTi", "楷体", "LXGW WenKai", "LXGW WenKai GB Screen", "AR PL UKai CN"];
  const fang = ["Fangsong SC", "STFangsong", "FangSong", "仿宋", "LXGW WenKai", "Noto Serif CJK SC"];
  const hei = ["Heiti SC", "STHeiti", "SimHei", "黑体", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC"];
  const song = ["Songti SC", "STSong", "SimSun", "宋体", "Noto Serif CJK SC", "Source Han Serif SC"];
  return [
    // 楷体系
    ...["Kaiti", "KaiTi", "楷体", "STKaiti", "KaiTi_GB2312", "楷体_GB2312"].map((f) => face(f, kai)),
    // 仿宋系
    ...["FangSong", "仿宋", "STFangsong", "FangSong_GB2312", "仿宋_GB2312"].map((f) => face(f, fang)),
    // 黑体系
    ...["SimHei", "Heiti", "黑体", "STHeiti", "XiHeiti"].map((f) => face(f, hei)),
    // 宋体系
    ...["SimSun", "宋体", "STSong", "Songti"].map((f) => face(f, song)),
  ].join("\n");
}

/** 真等宽链（代码块/书内 monospace 关键词共用；CJK 兜底保证注释中文有字形） */
export const MONO_STACK =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", "PingFang SC", "Microsoft YaHei", "Noto Sans Mono CJK SC", monospace';

/**
 * 代码字体独立通道（2026-09-29 P0 字体兼容，Readest 同款「随开关换边」）：
 * 覆盖开 = html body 前缀 !important（压过书内代码字体）；关 = :where 零特异性
 * （书的代码字体赢）。连字关闭防破坏代码对齐。所有字体模式可用（变量恒有定义）。
 */
export function codeFontStyles(overrideFont: boolean): string {
  const sel =
    "pre, code, kbd, samp, tt, .code, .monospace, .programlisting, .highlight, .hljs";
  return `${overrideFont ? `html body :is(${sel})` : `:where(${sel})`} {
  font-family: var(--reword-monospace)${overrideFont ? " !important" : ""};
  font-variant-ligatures: none;
}`.trim();
}

/**
 * 老式 HTML 字号标签映射（2026-09-29 P0 字体兼容，Readest 同款；em 相对正文字号）。
 * 旧版 EPUB 用 <font size="1..7"> 控制字号，浏览器 UA 默认渲染与其排版意图偏差大。
 */
export function legacyFontSizeStyles(): string {
  const map: Array<[string, string]> = [
    ["1", "0.5em"],
    ["2", "0.75em"],
    ["3", "1em"],
    ["4", "1.2em"],
    ["5", "1.5em"],
    ["6", "2em"],
    ["7", "3em"],
  ];
  return map.map(([s, size]) => `font[size="${s}"] { font-size: ${size}; }`).join("\n");
}

/**
 * 数字宽度修复（2026-09-29，Readest 式排版观感）：
 * 霞鹜文楷（LXGW WenKai）的数字字形是楷体传统宽字形——0.6em 步进、字面窄居中，
 * 连排数字（2007/1996）看起来像被拆成「2 0 0 7」（实为字形 advance，非断行/对齐问题；
 * pwid/pnum/halt 等 OpenType 特性实测均无法收窄）。修复 = 用一个 unicode-range 仅覆盖
 * U+0030-0039 的 @font-face 把数字交给比例宽系统字体（苹方/微软雅黑/Helvetica），
 * 字母与汉字不受影响（不在 range 内 → 回落正文楷体）。src 全部 local() 失败时 face
 * 无效、自动回落原字体，零风险。仅修 body 字体栈；书内代码块等自带字体不受影响。
 */
export const DIGIT_FIX_FAMILY = "RW Digit Fix";

export function digitFixFaceCss(): string {
  // local() 候选按平台覆盖：macOS 苹方 / Windows 微软雅黑 / Linux Noto Sans
  return `@font-face{font-family:"${DIGIT_FIX_FAMILY}";src:local("PingFang SC"),local("Microsoft YaHei"),local("Noto Sans CJK SC"),local("Helvetica Neue");unicode-range:U+0030-0039;}`;
}

/** 字体栈前置数字修复 face（仅当栈为非空字符串；重复前置守卫） */
export function withDigitFix(stack: string): string {
  if (!stack || !stack.trim()) return stack;
  if (stack.includes(`"${DIGIT_FIX_FAMILY}"`)) return stack;
  return `"${DIGIT_FIX_FAMILY}", ${stack}`;
}

/** 段落 p 段距 + 对齐 + 取消内联 line-height（2026-08-28 加 text-rendering 精修） */
export function paragraphStyles(o: ReaderStyleOutput): string {
  return `
p {
  margin: 0.6em 0 !important;
  /* 强制清零 EPUB 书籍在段落上写的横向 padding/margin，避免同页内不同 p
     左缘参差不齐（用户截图：图片下方段落与后续段落不在同一左边界）。
     margin 简写已让左右 margin 为 0；padding-left/right 需显式覆盖。
     ⚠️ 2026-10-06：此处**不再**声明 line-height / text-indent / text-align ——
     旧版写死 line-height:inherit !important + text-indent:0 !important，
     前者架空用户行距设置、后者靠注入顺序压过用户缩进滑块（脆弱）。
     三项统一交给 paragraphLayoutStyles() 按 overrideBookLayout 门控施加。 */
  padding-left: 0 !important;
  padding-right: 0 !important;
  text-rendering: optimizeLegibility !important;
}`.trim();
}

/**
 * 强制清零 EPUB 容器级横向 padding/margin（2026-09-02 绘本/图文混排版修复）。
 *
 * 问题：很多 EPUB（尤其绘本、固定版式童书）用 div/section 做左右栏或图文块，
 * 外层容器带 padding-left/margin-left，导致同页文字列左缘参差不齐。
 * 仅清零 <p> 不够，必须对容器本身动手。
 *
 * 策略：
 * - 用 `html body ...` 高特异性选择器覆盖书籍类选择器；
 * - 先统一归零，再为 blockquote/ul/ol/li/figure 恢复必要语义缩进；
 * - 不碰上下边距和纵向排版，只清横向偏移。
 */
export function uniformBlockResetStyles(overrideLayout = true): string {
  return `
html body,
html body > div,
html body > section,
html body > article,
html body > main,
html body > aside,
html body div.text,
html body div.body,
html body div.story,
html body div.page,
html body div.spread,
html body section.text,
html body section.body,
html body section.chapter,
html body article.text,
html body [class*="page"],
html body [class*="spread"],
html body [class*="chapter"] {
  margin-left: 0 !important;
  margin-right: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}
/* 恢复必须保留的语义缩进，避免误伤引用和列表 */
html body blockquote,
html body blockquote > div,
html body blockquote > p {
  margin-left: 1em !important;
  padding-left: 0.75em !important;
}
html body ul,
html body ol {
  margin-left: 0 !important;
  padding-left: 1.5em !important;
}
/* li 不清零 padding-left：list-style-position:outside 的 marker 画在 li 的
   padding 盒外侧，清零会让符号被挤到容器边缘甚至裁掉（2026-10-06 实测）。 */
html body li {
  margin-left: 0 !important;
  padding-left: 0.35em !important;
}
/* 统一文本对齐：覆盖书籍用高特异性类把段落设为 text-align:center。
   2026-10-06：受 overrideBookLayout 门控 —— 关闭时（使用书籍原版排版）
   不再强制 justify，把对齐权交还书籍。段落级的 justify 由
   paragraphLayoutStyles() 施加，此处只兜住 div/section/article/li 这些
   不在段落选择器里的容器。 */
${overrideLayout
      ? `html body p,
html body div,
html body section,
html body article,
html body li,
html body blockquote {
  text-align: justify !important;
}`
      : ""}
/* 图片/题注保持居中，不被清零拉偏 */
html body figure,
html body figcaption {
  margin-left: auto !important;
  margin-right: auto !important;
  text-align: center !important;
}
/* 标题默认居中 */
html body h1,
html body h2,
html body h3,
html body h4,
html body h5,
html body h6 {
  text-align: center !important;
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
 * 【2026-09-29 P0 已废弃并入 fontFamilyStyles(stack, overrideFont)】
 * 旧实现 = p/li/blockquote 子树 font-family:inherit!important：
 * ① 漏覆盖 div/span 布局的正文（2026-09-02 那类 bug 的残留面）；
 * ② 书内对元素自带 font-family 的设计也被一律抹平。
 * 新实现见 fontFamilyStyles：Readest 式 body !important + 全后代 revert
 * （排除代码/译文块）；关闭时 :where 零特异性尊重书内字体。
 */

/** 标题层级（h1-h6）（2026-08-30 排版精修：更紧凑的层级 + 防长标题溢出） */
export function headingStyles(): string {
  return `
h1, h2, h3, h4, h5, h6 {
  /* 2026-09-29 P0 字体兼容：不再强制 font-family:inherit ——
     覆盖开时 body * revert 已统一到正文栈；关时应尊重书内标题字体。 */
  font-weight: 600 !important;
  line-height: 1.28 !important;
  letter-spacing: 0.02em !important;
  margin: 1.1em 0 0.55em !important;
  page-break-after: avoid;
  break-after: avoid;
  /* 长标题/艺术字标题换行，避免溢出阅读区（绘本封面标题常见） */
  overflow-wrap: break-word !important;
  word-break: break-word !important;
}
h1 { font-size: 1.5em !important; }
h2 { font-size: 1.32em !important; }
h3 { font-size: 1.18em !important; }
h4 { font-size: 1.08em !important; }
h5 { font-size: 1.02em !important; }
h6 { font-size: 0.95em !important; }`.trim();
}

/** 引用块 blockquote（2026-08-28 柔和化：左边线 + 微底色 + 圆角，不再整块压暗）
 *  2026-08-30 思源化：左边线/底色改用思源变量（--b3-border-color / --b3-bq-background），跟随思源外观 */
export function quoteStyles(): string {
  return `
blockquote {
  margin: 0.8em 1.5em !important;
  padding: 0.4em 1em !important;
  border-left: 3px solid var(--b3-border-color, currentColor) !important;
  background: var(--b3-bq-background, rgba(128, 128, 128, 0.06)) !important;
  border-radius: 0 4px 4px 0 !important;
  font-style: italic !important;
}`.trim();
}

/**
 * 竖排（中文竖排阅读，2026-10-06）
 *
 * 引擎侧**已经完备**，不需要插件做任何分页工作：
 * vendored `paginator.js` 的 `getDirection()` 只读 CSS `writing-mode`（不读插件配置），
 * 命中 `vertical-rl` 后分页器自动做四件事（paginator.js:851-900）：
 *   ① `column-gap` 换成上下间距（`column-gap: (marginTop+marginBottom)*1.5`）
 *   ② body 的 `max-width` 换成 `max-height`（`max-height: columnWidth`）
 *   ③ `padding` 改成上下（`marginTop*1.5 / 0 / marginBottom*1.5 / 0`）
 *   ④ 翻页方向翻转（`rtl = true`，用 horizontal-rtl 约定翻页）
 * ⇒ 插件侧只需**注入 writing-mode** + 做竖排专属的排版适配。
 *
 * ⚠️ 两个实测踩坑（无头，2026-10-06，vertical-rl + 短文本单段）：
 *  ① **竖排下 `text-indent` 完全无效**：`p` 的 `textIndent` 解析为 `32px`，
 *     但 `getBoundingClientRect().top - body.top` 恒为 `0` —— 缩进没有产生位移。
 *     原因：竖排的块流方向是水平，`text-indent` 作用于行首（垂直方向）的**行盒**，
 *     对单段不换行的情形无可见效果。中文竖排的首行缩进惯例是用
 *     **`padding-top`**（沿垂直方向推进），故此处两者都写。
 *  ② **`line-height` 在竖排下改变的是"列宽"而非"行距"**：`line-height: 1.8` 让 body
 *     宽度从 `66px` → `86px`（= 一列的宽度被撑开），因为竖排下行距 = 列间距。
 *     故竖排下把 line-height 固定为 1（正常字距），行距由 `column-gap` 控制。
 */
export function verticalWritingStyles(enabled: boolean): string {
  if (!enabled) return "";
  return `
/* ── ① 开启竖排：只需这一条，引擎即自动切换全部布局 ── */
html body {
  writing-mode: vertical-rl !important;
}
/* ── ② 行距改由 column-gap 控制，line-height 必须回到 1 ──
   竖排下 line-height 撑开的是「列宽」（实测 66→86px），不是行距。 */
html body p,
html body li,
html body blockquote,
html body dd {
  line-height: 1 !important;
}
/* ── ③ 首行缩进：竖排下 text-indent 无位移（实测 topOff 恒 0），
      改用 padding-top —— 沿垂直方向推进，符合中文竖排「起首空一格」惯例。
      值由 JS 侧按用户的首行缩进滑块注入 --rwt-vertical-indent（单位 em）。 ── */
html body p {
  text-indent: 0 !important;
  padding-top: calc(var(--rwt-vertical-indent, 0) * 1em) !important;
}
/* ── ④ 竖排下的对齐与标题 ──
   justify 在竖排里是「沿垂直方向两端对齐」，中文竖排通常不做，
   故回退到 start（顶端对齐）；标题居中在竖排里也不合适，改为不设。 */
html body p,
html body li,
html body blockquote,
html body dd {
  text-align: start !important;
}
html body h1, html body h2, html body h3,
html body h4, html body h5, html body h6 {
  text-align: start !important;
}
/* 标题竖排时按 1em 一格递进更符合中文竖排习惯 */
html body h2, html body h3 { margin-top: 0.5em !important; }
html body h4, html body h5, html body h6 { margin-top: 0.25em !important; }
/* ── ⑤ 图片/表格在竖排下按块居中，避免沿列拉伸 ── */
html body img,
html body svg,
html body table {
  max-width: 100% !important;
  margin-left: auto !important;
  margin-right: auto !important;
}`.trim();
}

/**
 * 列表 ul/ol 缩进 + 项目符号（marker）兜底
 *
 * 2026-10-06 修「段落前出现灰色空心方块」：
 * 真实脏 EPUB 常用「图标字体 + li::before{content:"\f0a7"}」自绘项目符号。
 * 该字体在书内资源里常缺失/路径失效（neutralizeBadFontFaces 只删非法 scheme，
 * 合法但 404 的不动）⇒ 私用区码位 U+E000–U+F8FF 找不到字形 ⇒ Chromium 渲染
 * .notdef「空心方框」，且因 li 无左内边距而紧贴文字，看起来像"文字被方块挤到右侧"。
 *
 * 修复（只改 CSS 兜底，不动 fontFamilyStyles）：
 * ① uniformBlockResetStyles：li 保留 0.35em 左内边距 —— list-style-position:outside
 *    的 marker 画在 li 的 padding 盒外侧，清零会让符号被挤到容器边缘。
 * ② 本函数：显式声明 list-style-type（ul/ol 分别 disc/decimal）+ li::marker 字体族
 *    兜底。书里写 list-style:none 时同特异性 !important 夺回，图标字体缺字形时
 *    marker 退回 serif 通用符号，而不是 .notdef 方框。
 *
 * 实测要点（无头，2026-10-06）：
 * - 原生 marker（disc）在 li padding 清零时**仍然可见**（A/B 截图对照），
 *   所以「符号消失」不是 padding 造成的，别再往这个方向查。
 * - 灰方块的真根因是**书里的图标字体没加载**：`body *{font-family:revert}`
 *   命中 li（字体挂在 li 上、::before 靠继承时会被 revert 掉，实测 PingFang SC）
 *   ⇒ 私用区码位 \f0a7 落到中文字体 ⇒ 无字形 ⇒ Chromium 画 .notdef 空心方框。
 *   书若把 font-family 直接写在 ::before 上则不受 revert 影响（实测）。
 */
export function listStyles(): string {
  return `
ul, ol {
  margin: 0.6em 0 0.6em 1.5em !important;
  padding-left: 1em !important;
  /* marker 兜底：书里写 list-style:none 时，这里被同特异性 !important 夺回 */
  list-style-type: disc !important;
}
ol {
  list-style-type: decimal !important;
}
li {
  margin: 0.3em 0 !important;
}
/* marker 字体族兜底：图标字体缺字形时退回 serif 通用符号，而不是 .notdef 方框 */
li::marker {
  font-family: serif !important;
}`.trim();
}

/** 图片 figure/figcaption（2026-08-30 排版精修：分页不切图、浮动图转块居中、轻阴影） */
export function figureStyles(o: ReaderStyleOutput): string {
  return `
img {
  max-width: 100% !important;
}
/* ⚠️ 2026-10-06 移除 img { height: auto !important }（真实 EPUB 实证，见下方说明）。
   它会打掉**书籍自己声明的** height —— 某些书用 <img class="height-1em"> 画项目符号，
   期望 1em 的小方块；被 height:auto 覆盖后退回图片**自然尺寸**，再被 max-width 压到
   列宽 ⇒ 渲染成巨大灰方块 + 文字被挤到右侧换行。
   实测（books/b6l8ohr.epub，OEBPS/Text/p-006.xhtml + Images/img01.png 180×180 纯灰方块）：
     改前符号 200×200px（ratio=9）；Readest 同书同图为 22×22px。
     移除本条后 ratio=1（符号高度=1em），与 Readest 一致。
   ⇒ 图片高度**交给书籍自己**；只保留 max-width 防横向溢出。

   ⚠️ 曾试过补 max-height 100% 兜底，**实测无效故未采用**：
   百分比相对父容器高度，而 foliate 分页器把 body/栏设为 height:auto
   ⇒ max-height:100% 解析失效（实测书里写死 height:800px 的图仍渲染 800px）。
   能生效的是 max-height:100vh（实测压到视口高），但那会**按视口而非版心**裁图，
   分页模式下版心常远小于视口 ⇒ 会误裁正常插图。**故宁可不做，也不引入一个错的兜底。**
   若将来要真兜底，正确做法是取 foliate 的栏宽变量算 px 值，而非用百分比。 */
figure {
  margin: 1.2em 0 !important;
  text-align: center !important;
  /* 分页模式下避免图片被栏边界切成两半 */
  break-inside: avoid;
  page-break-inside: avoid;
}
figure img {
  max-width: 100% !important;
  border-radius: 6px !important;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.12);
}
figcaption {
  font-size: 0.82em !important;
  opacity: 0.65;
  margin-top: 0.5em !important;
  text-align: center !important;
}
/* 书籍内 float 图片强制转为块级居中，避免与正文挤在一起或被分页切断 */
img[style*="float"] {
  float: none !important;
  display: block !important;
  margin: 1em auto !important;
}`.trim();
}

/** 链接 a（2026-08-30 思源化：跟随思源行内链接色 --b3-protyle-inline-link-color） */
export function linkStyles(): string {
  return `a { color: var(--b3-protyle-inline-link-color, #185FA5) !important; }`;
}

/** 代码块 pre / code（2026-08-30 思源化：跟随思源行内代码底色 --b3-protyle-code-background） */
/**
 * 代码块（pre）与行内代码（code）样式补齐（2026-10-06）
 *
 * 改前的现状**本末倒置**：`codeStyles()` 只有一条背景色，
 * 而 txt/md 适配器（`book-adapters.ts` 内联 <style>）反而给了
 * `padding/.8em 1em` + `border-radius:6px` + `overflow-x:auto` + `font-size:.92em`
 * ⇒ **自己造的 txt/md 书比 EPUB 书好看**。本函数补齐 EPUB/图书路径。
 *
 * ⚠️ 变量只用**实测存在**于内置 daylight + midnight 的（2026-10-06 核验）：
 *   ✅ --b3-protyle-code-background、--b3-border-color、
 *      --b3-theme-on-surface-light、--b3-theme-background-light
 *   ❌ --b3-protyle-code-color **内置主题未定义** ⇒ 裸引用会让整条声明失效
 *      （无兜底 `var()` = invalid at computed-value time，不是回退默认值）
 *      ⇒ 一律带兜底，且兜底链只收敛在本段开头。
 *
 * `overflow-x: auto` 让长代码**块内横向滚动**而不是撑破页面 —— 但要注意：
 * 本项目**无全局 `box-sizing: border-box` 重置**（见 MEMORY 铁律 8），
 * pre 若同时写 width 与 padding/border 会溢出；此处不写 width，靠 max-width:100% 约束。
 */
export function codeStyles(): string {
  return `
/* ── 代码块 ── */
pre {
  background: var(--b3-protyle-code-background, rgba(128,128,128,0.08)) !important;
  border: 1px solid var(--b3-border-color, rgba(128,128,128,0.22)) !important;
  border-radius: 6px !important;
  padding: 0.8em 1em !important;
  margin: 0.8em 0 !important;
  /* 块内横向滚动：长代码不撑破页面（配 max-width 防溢出） */
  max-width: 100% !important;
  overflow-x: auto !important;
  /* 代码通常比正文小一号，0.92em 与 txt/md 适配器保持一致 */
  font-size: 0.92em !important;
  line-height: 1.55 !important;
  /* 保留书内 tab 宽度语义，同时允许软换行避免超长行溢出 */
  white-space: pre-wrap !important;
  word-break: break-word !important;
  /* 竖排时 revert：代码块在竖排下无法正常排版（实测 line-height 会撑开列宽） */
  writing-mode: horizontal-tb !important;
  text-align: start !important;
}
/* 行内代码：无边框无背景，避免正文里到处是灰块 */
code {
  background: var(--b3-protyle-code-background, rgba(128,128,128,0.08)) !important;
  border-radius: 3px !important;
  padding: 0.1em 0.3em !important;
  font-size: 0.92em !important;
}
/* pre 内的 code：去掉二次背景与内边距（否则出现"块中块"） */
pre code {
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  padding: 0 !important;
  font-size: 1em !important;
  color: inherit !important;
}
/* 行内代码不该影响行高：inline-block 会撑行，用 vertical-align 校正 */
p code, li code, td code, th code, h1 code, h2 code, h3 code, h4 code {
  vertical-align: baseline !important;
}`.trim();
}

/** word-wrap（避免超长 URL / 英文单词撑出右边界） */
/**
 * 断词 / 标点 / 孤行控制（2026-10-06 升级：Readest 同思路）
 *
 * 旧版（2026-09-29）只写 `overflow-wrap: normal`，且**无 `!important`**，
 * 而 vendored `paginator.js:924` 给 documentElement 设了
 * `overflow-wrap: break-word !important` ⇒ 分页模式下引擎赢，
 * 用户报告的「数字被拆开」其实从未真正修好。
 *
 * 现在按 Readest 的做法补齐精细排版属性，并按 `overrideBookLayout` 门控 `!important`：
 * - `hyphens: auto` + `hyphenate-limit-*`：只对超过限长的词断词（Readest 同值 3/2/2）
 * - `hanging-punctuation: allow-end last`：行尾标点悬挂，**中文观感提升最大的单项**
 * - `widows: 2`：分页时不留孤行
 * - `overflow-wrap: break-word`（**不是 anywhere**）：anywhere 会污染 min-content
 *   导致 flex/grid 子项塌陷（Readest 注释明确点名此坑）
 */
export function wordWrapStyles(overrideLayout = true): string {
  const imp = overrideLayout ? " !important" : "";
  /* 段落级排版由 layoutStyles 统一施加（行距/缩进/字距）；此处只管断行与标点，
     避免同一属性在两处重复 !important 造成后续维护困难。 */
  return `
body, p, li, blockquote {
  -webkit-hyphens: auto${imp};
  hyphens: auto${imp};
  -webkit-hyphenate-limit-before: 3;
  -webkit-hyphenate-limit-after: 2;
  -webkit-hyphenate-limit-lines: 2;
  hanging-punctuation: allow-end last;
  widows: 2;
  overflow-wrap: break-word${imp};
  word-wrap: break-word${imp};
}`.trim();
}

/* ================= 2026-08-24 新增 4 大设置组 CSS ================= */

/**
 * 文本设置：字重 + 字距（注入到 body）
 * 缺省时用 400 / 0，向后兼容旧 settings（无 text 字段）
 */
/**
 * 文本设置：字重 + 字距
 * 2026-10-06：从「只作用于 body」扩展到段落级。
 * 原因：书籍常在 p/li 上写死 `letter-spacing`/`font-weight`，只压 body 时
 * 段落级声明仍会赢（body 的值被继承覆盖不掉子元素的直接声明）。
 * `!important` 按 `overrideBookLayout` 门控（与 Readest 的 overrideLayout 同义）。
 */
export function textStyles(
  input?: { fontWeight: number; letterSpacing: number },
  overrideLayout = true,
): string {
  const fw = input?.fontWeight ?? 400;
  const ls = input?.letterSpacing ?? 0;
  const imp = overrideLayout ? " !important" : "";
  return `
body, p, li, blockquote, dd, dt {
  font-weight: ${fw}${imp};
  letter-spacing: ${ls}px${imp};
}`.trim();
}

/**
 * 段落设置：段距 + 首行缩进
 * 缺省时用 0.8em / 0（接近 SiReader 默认）
 */
/**
 * 段落级排版（2026-10-06 升级：Readest「脏样式清洗 + 设置让位」双层策略）
 *
 * Readest 的做法（`utils/style.ts`）不是拿 `!important` 跟书籍对轰，而是**两层**：
 *  ① **清洗层**：把出版方写在 `body`/容器上的脏排版值 `unset` 掉，让它不参与级联
 *     —— `body { line-height: unset }`（注释原文： badly designed EPUBs put their
 *     line-height on body, drop it so the Line Spacing setting spaces the text）
 *  ② **施加层**：把用户设置以 `!important` 施加到**段落级选择器**上
 *     —— `p, blockquote, dd, div:not(:has(非行内子元素)) { line-height/word-spacing/
 *      letter-spacing/text-indent/hyphens/... }`
 *
 * reword 旧版的两个病：
 *  ① `paragraphStyles` 写死 `line-height: inherit !important` ⇒ **用户行距设置被架空**
 *     （inherit 拿的是 body 的值，而 body 上的书籍脏值又没被清洗）。
 *  ② `text-indent: 0 !important` 与用户滑块（`textIndent`）同特异性且都在
 *     `!important` 下，靠**注入顺序**取胜 —— 脆弱，加一段就可能翻转。
 *
 * 现在：`overrideBookLayout=true`（默认）→ 清洗 + 施加；
 * `false`（使用书籍原版排版）→ 只做必要的横向对齐，不碰行距/缩进/对齐/断词。
 */
export function paragraphLayoutStyles(
  input?: { paragraphSpacing: number; textIndent: number },
  overrideLayout = true,
  lineHeight = 1.8,
): string {
  const ps = input?.paragraphSpacing ?? 0.8;
  const ti = input?.textIndent ?? 0;
  /* ⚠️ 单出口设计（2026-10-06）：关闭 overrideLayout 时**不提前 return**，
     而是把该分支写成空串占位。原因是 test/reader-settings-4-sections.test.mjs 的 B4
     用 `match(/function paragraphLayoutStyles[\s\S]*?return \`([^\`]+)\`/)` 捕获
     **第一个** return 模板 —— 提前 return 会让它只拿到「关」分支而误判失败。
     单出口同时让"这段 CSS 里到底有什么"可被一条正则完整断言。 */
  const imp = overrideLayout ? " !important" : "";
  const cleanLayer = overrideLayout
    ? `
/* ── ① 清洗层：丢弃书籍写在 body 上的脏排版值 ──
   出版方常把 line-height 写在 body 上并被所有段落继承；不清掉的话，
   下面的 line-height 设置会被这条继承值架空（与 Readest #6088 同因）。 */
html body {
  line-height: unset${imp};
}`
    : "";
  const applyLayer = overrideLayout
    ? `
/* ── ② 施加层：用户设置真正说了算 ──
   div 只在「子元素全是行内标签」时才当段落处理（对齐 Readest 的
   div:not(:has(*:not(INLINE)))，否则书里的结构化 div 会被误当段落压平。 */
html body p,
html body blockquote,
html body dd,
html body div:not(:has(*:not(a, abbr, b, bdi, bdo, cite, code, data, del, dfn, em, i, ins, kbd, mark, q, rp, rt, ruby, s, samp, small, span, strong, sub, sup, time, u, var, wbr))) {
  line-height: ${lineHeight}${imp};
  text-indent: ${ti}em${imp};
  text-align: justify${imp};
  margin-bottom: ${ps}em${imp};
  widows: 2${imp};
}
/* 图片/题注段落不该缩进：图居中段、图文混排段加首行缩进会歪（Readest 同款例外清单） */
html body p:has(> img:only-child),
html body p:has(> span:only-child > img:only-child),
html body figure,
html body figcaption {
  text-indent: 0 !important;
}`
    : "";
  /* 段距属容器观感、不属书籍排版语义，两个模式都保留 */
  return `${cleanLayer}${applyLayer}
html body p {
  margin-bottom: ${ps}em !important;
}`.trim();
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
  /** 内容宽度占视口百分比（铺满95/正常80/宽松70）；左右 padding = (100-pct)/2 % */
  widthPct?: number;
  /** 页宽模式（2026-09-29）：fixed = 固定书页宽，body 左右 padding 归零（宽度由 foliate 列宽控制并居中） */
  widthMode?: "pct" | "fixed";
  /** 固定书页宽 px（widthMode=fixed 时仅用于文档说明；实际居中由 paginator 的 --_reword-content-fixed 实现） */
  fixedWidthPx?: number;
  /** 「跟随思源页边」开启时左右仍走宿主 px 边距（本函数不读开关本身，由调用方传入） */
  followSiyuanMargin?: boolean;
}): string {
  const mt = input?.marginTopPx ?? 16;
  const mb = input?.marginBottomPx ?? 16;
  const gap = input?.columnGapPx ?? 16;
  // 2026-09-25 页宽语义：widthPct = 内容宽度占视口百分比 ⇒ 左右 padding = (100-pct)/2 %（随窗口伸缩）。
  // 2026-09-29 固定书页宽（widthMode=fixed）：body 左右 padding 归零——书页宽度由 paginator 的
  // --_reword-content-fixed 控制（列宽封顶 + grid 弹性轨道自动居中）；padding 再干预会双重收窄。
  // 「跟随思源页边」开启时左右退回宿主 px 边距（applySiyuanDocMargin 写入的 marginLeft/RightPx）。
  const side = input?.widthMode === "fixed"
    ? "0px 0px"
    : input?.followSiyuanMargin
      ? `${input?.marginLeftPx ?? 16}px ${input?.marginRightPx ?? 16}px`
      : `${((100 - (input?.widthPct ?? 80)) / 2).toFixed(2)}%`;
  return `body { padding: ${mt}px ${side} ${mb}px !important; column-gap: ${gap}px; }`;
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
 * 双语对照译文样式（2026-08-30 v3「段落块 + 淡色左边线」）：
 * 顶栏「双语」开启后，每段正文内注入 `.reword-bilingual` 译文块（appendChild 子节点）。
 * 该节点位于 foliate 内容 iframe 内，必须由 user CSS 注入（Svelte 组件 scoped 样式够不到）。
 *
 * 2026-08-30 排版升级（针对绘本/短句书的碎片化问题）：
 * 旧版译文 `margin:0.15em 0 0 0` 紧贴原文，每句话裂成「原文一行/译文一行」的小块，
 * 绘本短句书尤为碎。新版把译文做成**独立译文块**——
 *   - 与下一段原文拉开 0.7em 段距（形成「原文段 + 译文块」的呼吸单元）；
 *   - 淡色左边线 + 轻微左内边距，视觉上把译文从原文中分层，便于扫读；
 *   - 字号略小、透明度略低，明确译文是辅助信息、不抢焦点；
 *   - 悬停恢复不透明，方便细看。
 *
 * @param fontFamilyStack 思源阅读字体栈（含用户字体 + CJK 兜底）
 * @param fg 思源正文色（具体 hex，来自 deriveStyleOutput）
 * @param translationFontSize 译文字号 em 倍数（默认 0.62）
 */
export function bilingualStyles(fontFamilyStack: string, fg: string, translationFontSize: number): string {
  const fs = Number.isFinite(translationFontSize) && translationFontSize > 0 ? translationFontSize : 0.62;
  // 按钮 hover/active 颜色：主题色取自传入 fg。背景用半透明灰，避免亮色/暗色主题下按钮浮起来。
  // 2026-08-30 段级"简洁版"按钮：右上角悬浮，hover 译文块时显形（避免干扰阅读）。
  return `
/* ---- 双语译文块（段落内子节点注入，独立成块的温和对照样式） ---- */
/* 高权重选择器：类 + 两个属性选择器，压住 EPUB 中更具体的自定义选择器 */
.reword-bilingual[cfi-inert][data-translation-mark] {
  display: block !important;
  /* 段落块化：与上一段（原文）留 0.25em、与下一段原文留 0.7em，形成呼吸单元。
     margin-left 由 injectSibling（render.ts）按英文段 paddingLeft+textIndent 动态计算，
     使译文文字左缘精确对齐英文文字左缘（齐平）；此处 0 仅作兜底初值（会被 inline 覆盖）。 */
  /* 2026-09-02 紧凑双语排版：译文块作为「原文段下的辅助条」紧跟英文，
     不再用 0.7em 大段距把页面切成两条平行轨道。数值与正文段距（默认 0.8em）
     配合，形成「原文 + 译文」一个呼吸单元，整体节奏更连贯。 */
  /* 2026-09-06 紧贴英文：顶部 margin 用 -0.5em 负边距抵消上一段 margin-bottom，
     让译文块上缘真正靠住原文段下缘；底部保留 0.35em，维持「原文+译文」单元与下一段的呼吸感。 */
  margin: -0.6em 0 0.35em 0 !important;
  text-indent: 0 !important;
  /* Task B（2026-08-31）：强制译文文字左对齐。
     EPUB 容器常自带 text-align:center，且 injectSibling 只清了 margin/padding，
     没清 text-align，导致译文文字被居中（与上方英文左缘不对齐）。
     这里用 !important 压过书籍继承值；左侧竖线由 border-left 绘制（不占内容位，
     文字左缘仅比英文左缘内缩 2.5px 边框宽，视觉等同对齐）。 */
  text-align: left !important;
  /* 思源引述块风格：左侧竖线 + 浅底色 + 圆角。
     竖线颜色随思源主题边框色 --b3-border-color；
     注意：padding-left 必须保持 0，译文文字左对齐由 injectSibling 动态计算 margin-left 实现
     （公式：marginLeft = 原文 paddingLeft + 原文 textIndent - borderLeft）。
     若在这里给 padding-left，即使 injectSibling 用内联 !important 覆盖，简写 padding 的 !important
     在某些渲染路径下仍会生效，导致译文整体向右偏移、与原文不齐平。 */
  padding-top: 0 !important;
  padding-right: 0.6em !important;
  padding-bottom: 0.1em !important;
  padding-left: 0 !important;
  border-left: 2.5px solid var(--b3-border-color, rgba(128, 128, 128, 0.22)) !important;
  border-radius: 0 6px 6px 0;
  background: var(--b3-theme-surface-light, rgba(128, 128, 128, 0.06));
  position: relative;

  /* 字号：默认 0.62em —— CJK 字体的 x-height 远大于英文 serif，
     0.62em 渲染后视觉尺寸 ≈ 英文正文的 0.88~0.92 倍，略小一号、不抢焦点 */
  font-size: ${fs}em;
  /* 行高比正文紧凑一点（正文通常 1.6~1.8），避免译文撑开过多空间 */
  line-height: 1.5;
  font-weight: 400;

  /* 字体：思源阅读字体栈（!important 压过 publisherFontOverride 的 inherit） */
  font-family: ${fontFamilyStack} !important;
  /* 颜色：思源次级文本色，比正文淡一级；fallback 用传入的 fg。
     2026-09-06 取消 opacity（改为 1）：原先 0.9 叠加 on-surface 灰色后对比度偏低，
     在绘本/浅色页上显得发虚；用纯色 on-surface 既保留“辅助”语义，又确保可读。 */
  color: var(--b3-theme-on-surface, ${fg});
  opacity: 1;

  /* CJK 字间距微调，让中文更紧凑自然 */
  letter-spacing: 0.02em;

  /* 行为 */
  word-break: break-word;
  overflow-wrap: break-word;
  /* 2026-08-31：放开选中。原为 none，导致译文既不能划词查词也不能复制。
     配合 cfi-inert（见 bilingual-v2/render.ts），译文仍被 CFI 索引排除，
     所以放开选中不会让选区污染锚点。 */
  user-select: text;
  transition: opacity 0.2s ease, background 0.2s ease;
}

/* 译文内部文本容器：再保险一层，确保 span 自身没有 margin/padding/缩进 */
.reword-bilingual[cfi-inert][data-translation-mark] > .reword-bilingual-text {
  display: inline !important;
  margin: 0 !important;
  padding: 0 !important;
  text-indent: 0 !important;
}

/* Task B（2026-08-31）：Lute 会把含结构的译文渲染成内部 <p>，
   它会被全局 p{ text-align:justify !important; margin:0.6em 0 } 命中 → 译文又变两端对齐/带段距。
   这里用更高权重的「类+双属性」选择器压回左对齐、零段距，使整段译文左缘与英文对齐。 */
.reword-bilingual[cfi-inert][data-translation-mark] p {
  text-align: left !important;
  margin: 0 !important;
  padding: 0 !important;
  text-indent: 0 !important;
}

/* 悬停时恢复完全不透明 + 底色加深 */
.reword-bilingual[cfi-inert][data-translation-mark]:hover {
  opacity: 1;
  background: var(--b3-list-hover, rgba(128, 128, 128, 0.1));
}

/* 列表项内的译文：随项目符号缩进，其余样式继承基类。
   因基类已用 !important，列表项规则也必须 !important 才能覆盖。 */
li > .reword-bilingual[cfi-inert][data-translation-mark] {
  margin: -0.6em 0 0.5em 0.5em !important;
  text-indent: 0 !important;
  border-left: 2.5px solid var(--b3-border-color, rgba(128, 128, 128, 0.22)) !important;
  background: var(--b3-theme-surface-light, rgba(128, 128, 128, 0.06));
}

/* 2026-09-02：段落级操作工具条（AI 重译 + 删除译文 合并为右上角玻璃药丸）。
   默认完全隐藏，hover 译文块时整体淡入；整体绝对定位于译文块右上角、离开左侧竖线，
   鼠标贴近左缘阅读/滑过不再误触「删除译文」。内部按钮为普通 flex 子项。 */
.reword-bilingual-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px;
  border-radius: 999px;
  /* 毛玻璃药丸：半透明背景 + 细边框 + 轻阴影，悬浮在译文之上不抢眼 */
  background: var(--b3-theme-background, #fff);
  background: color-mix(in srgb, var(--b3-theme-background, #fff) 82%, transparent);
  border: 1px solid var(--b3-border-color, rgba(128, 128, 128, 0.3));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  z-index: 2;
}
.reword-bilingual[cfi-inert][data-translation-mark]:hover > .reword-bilingual-actions {
  opacity: 1;
  pointer-events: auto;
}

/* 工具条内按钮（✨ AI 重译 / ✕ 删除译文）：圆角小药丸，去掉各自绝对定位 */
.reword-bilingual-ai-redo,
.reword-bilingual-hide {
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif !important;
  font-size: ${Math.max(0.7, fs * 1.1)}em;
  line-height: 1;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.reword-bilingual-ai-redo {
  color: var(--b3-theme-primary, #357abd);
}
.reword-bilingual-ai-redo:hover {
  background: color-mix(in srgb, var(--b3-theme-primary, #357abd) 14%, transparent);
}
.reword-bilingual-ai-redo:disabled {
  opacity: 0.5;
  cursor: default;
}
.reword-bilingual-hide {
  color: var(--b3-theme-on-background, #555);
}
/* ✕ 删除：平时低调灰色（置于工具条最右端，远离左侧），hover 才显红警示 */
.reword-bilingual-hide:hover {
  color: var(--b3-theme-error, #d9534f);
  background: color-mix(in srgb, var(--b3-theme-error, #d9534f) 14%, transparent);
  border-color: color-mix(in srgb, var(--b3-theme-error, #d9534f) 40%, transparent);
}

/* 翻译失败块：静默灰色占位，不抢眼（无重试按钮）。
   需用与主块同权重的属性选择器才能覆盖主块颜色。 */
.reword-bilingual-failed[cfi-inert][data-translation-mark] {
  color: #9ca3af;
  background: rgba(128, 128, 128, 0.06);
}
.reword-bilingual-failed-text { font-style: italic; opacity: 0.8; }

`.trim();
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

/**
 * 中和书内 @font-face 中使用了非法 URL scheme 的 src（如某些 EPUB 把字体写成
 * `url(ms-appx://...)` / `url(chrome://...)` 或自定义 scheme），否则浏览器会报
 * `net::ERR_UNKNOWN_URL_SCHEME` 且可能让 `document.fonts.ready` 迟迟不解析。
 * 仅删除「含显式非法 scheme」的 @font-face 块；相对路径（无 scheme）与
 * http/https/blob/data 等合法 scheme 一律保留，避免误伤正常内嵌字体的书籍。
 * 在 foliate 的书内 CSS 转换钩子（book.transformTarget）上调用本函数。
 */
export function neutralizeBadFontFaces(css: string): string {
  if (typeof css !== "string" || !css) return css;
  const BAD_SCHEMES = new Set(["http", "https", "blob", "data"]);
  return css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
    const urls = block.match(/url\(\s*([^)]*?)\s*\)/g) || [];
    const hasBad = urls.some((u) => {
      const inner = u
        .replace(/^url\(\s*/i, "")
        .replace(/\s*\)$/i, "")
        .trim()
        .replace(/^['"]|['"]$/g, "");
      const m = inner.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
      if (!m) return false; // 相对路径（无 scheme）→ 保留
      return !BAD_SCHEMES.has(m[1].toLowerCase());
    });
    return hasBad ? "" : block;
  });
}

/* ================= 内部辅助（不导出，避免外部误用） ================= */

/**
 * 验证 buildReaderStyles 输出包含必要段（仅供内部 / 测试使用）
 * 不导出以避免外部依赖；若测试需要可手动 grep 输出字符串。
 */
function _sanityCheckUnused(): void {
  // 占位，让 buildReaderStyles 引用所有子函数以避免 tree-shake 误删
  const _x = [paragraphStyles, uniformBlockResetStyles, inlineOverrideStyles, headingStyles, quoteStyles, listStyles, figureStyles, bodyStyles, textStyles, paragraphLayoutStyles, layoutMarginStyles, linkStyles, codeStyles, colorSchemeStyles, wordWrapStyles, fontSizeOverrideStyles, focusModeStyles, bilingualStyles, paragraphHoverStyles, buildFontFamilyLists, fontVariableStyles, classifiedFontStyles, fontFamilyStyles];
  void _x;
}
