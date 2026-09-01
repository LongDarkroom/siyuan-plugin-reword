import { logSwallow } from "../core/safe.ts";
import { lsNotebooks, listDocsByPath } from "../siyuan/filetree.ts";
import { getIDsByHPath } from "../siyuan/api.ts";

/** 阅读设置全局单例（供非 Svelte 模块如 graph.ts / index.ts 读取绑定文档 ID） */
let _globalSettingsStore: any = null;
export function getGlobalSettingsStore(): ReaderSettingsStore | null {
  return _globalSettingsStore as ReaderSettingsStore | null;
}
/**
 * 阅读器 - 文本样式与阅读设置（持久化）
 * ---------------------------------------------------------------
 * 字号 / 行距 / 主题（8 预设 + 自定义色）/ 行宽 / 阅读模式 / 翻页动画，
 * 文本设置（字重/字距）/ 段落设置（段距/首行缩进）/ 页面布局（4 边距/页眉/页脚/进度等）/
 * 笔记插入（发送模板/插入位置/同步开关），全局一套设置，存 hiword-reader-settings.json，变更防抖保存。
 *
 * 2026-08-24 扩展：4 大分类（文本/段落/页面布局/笔记插入）—— 适配自思阅 SiReader。
 * 向后兼容：旧版本 settings（无 text/paragraph/layout/note 字段）加载时用 DEFAULTS 合并。
 */

import { writable } from "svelte/store";

export type ReaderTheme =
  | "auto"    // 跟随思源主题（2026-08-25 新增）
  | "light"
  | "almond"
  | "autumn"
  | "green"
  | "blue"
  | "night"
  | "dark"
  | "gold"
  | "custom";

export type ReaderLineWidth = "narrow" | "normal" | "wide";
export type ReaderFlow = "paginated" | "scrolled";
export type ReaderTurnStyle = "default" | "slide" | "curl";
/**
 * 字体来源：跟随思源 / 自定义导入 / 系统默认（不注入）/ 分类设置
 *
 * 2026-08-28 新增 `classified`（分类设置，参考 Readest 字体面板）：
 * 衬线 / 无衬线 / 等宽三条独立字体链 + 可选中文字体，与「跟随思源」单栈模式并列，
 * 由用户在设置面板切换。保留双模式——跟随思源零配置够用，分类模式给进阶用户。
 */
export type ReaderFontMode = "follow-siyuan" | "custom" | "system" | "classified";

/** 正文默认走哪条字体链（2026-08-28，Readest 的「默认字体」概念） */
export type ReaderDefaultFontFamily = "serif" | "sans-serif";
/** 笔记插入位置：剪贴板 / 当前文档 / 笔记本 */
export type NoteInsertPosition = "clipboard" | "currentDoc" | "notebook";
/** 笔记模板预设 */
export type NoteTemplatePreset = "simple" | "heading" | "quote" | "custom";
/** 进度样式：分数（如 5/100）/ 页码（如 12）/ 百分比（如 5%） */
export type ReaderProgressStyle = "fraction" | "page" | "percent";
/** 底部进度条「程序坞」唤出方式（2026-08-30）：小圆点常驻 / 悬浮热区 / 两者 */
export type ReaderBottomBarMode = "dot" | "hover" | "both";

/** 排版预设（2026-08-30）：一键套用边距 / 行距 / 段距 / 字距组合（与边距预设 LAYOUT_PRESETS 并存，维度更全） */
export type ReaderTypographyPreset = "compact" | "comfort" | "spacious" | "picture";

/** 文本设置（2026-08-24 新增） */
export interface ReaderTextSettings {
  /** 字重 100-900，step 100（默认 400） */
  fontWeight: number;
  /** 字距 -2 ~ 8 px，step 0.5（默认 0） */
  letterSpacing: number;
}

/** 段落设置（2026-08-24 新增） */
export interface ReaderParagraphSettings {
  /** 段距 0-2 em，step 0.1（默认 0.8） */
  paragraphSpacing: number;
  /** 首行缩进 0-4 em，step 0.5（默认 0） */
  textIndent: number;
}

/** 页面布局（2026-08-24 新增） */
export interface ReaderLayoutSettings {
  /** 4 边距（px） */
  marginTopPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  marginRightPx: number;
  /** 分栏间距 0-40 px（默认 16，foliate 默认单列，预留多列扩展） */
  columnGapPx: number;
  /** 显示页眉（默认 true） */
  showHeader: boolean;
  /** 显示页脚（默认 true） */
  showFooter: boolean;
  /** 显示阅读进度（默认 true） */
  showProgress: boolean;
  /** 进度样式（默认 fraction） */
  progressStyle: ReaderProgressStyle;
  /** 底部进度条「程序坞」唤出方式（默认 both：小圆点常驻 + 悬浮热区） */
  bottomBarMode: ReaderBottomBarMode;
  /** 参考页数 0-2000（默认 0，0=不显示） */
  referencePageCount: number;
  /** 显示当前时间（默认 false） */
  showCurrentTime: boolean;
  /** 24 小时制（默认 false） */
  use24Hour: boolean;
  /** 跟随思源文档边距：用宿主 .protyle-wysiwyg 的水平 padding 作为阅读器左右边距（默认 false，2026-08-29） */
  followSiyuanMargin?: boolean;
  /** 重启思源后自动恢复上次打开的阅读 Tab（默认 true；思源不会自动恢复自定义插件 Tab） */
  restoreTabsOnLaunch?: boolean;
}

/** 笔记模板支持的变量（用于 linkFormat 模板） */
export type NoteTemplateVar =
  | "bookTitle"
  | "author"
  | "chapter"
  | "cfi"
  | "link"
  | "text"
  | "note"
  | "image"
  | "date";

/** 笔记插入（发送文档设计，2026-08-24 新增） */
export interface ReaderNoteSettings {
  /** 添加时同步到思源块（默认 false） */
  syncOnAdd: boolean;
  /** 删除时同步删除（默认 false） */
  syncOnDelete: boolean;
  /** 插入位置（默认 clipboard） */
  insertPosition: NoteInsertPosition;
  /** 模板预设（默认 simple） */
  templatePreset: NoteTemplatePreset;
  /** 链接格式（textarea，默认 simple 模板） */
  linkFormat: string;
  /** 文档链接入库排除正则（textarea） */
  excludeRegex: string;
  /** 标注标签预设（textarea，每行一个或中文逗号分隔） */
  tagPresets: string;
  /** 快捷发送文档（笔记本 + 路径 + 别名） */
  quickSendDocs: Array<{ notebookId: string; path: string; alias: string }>;
}

export interface ReaderSettings {
  /** 字号 12-28 px */
  fontSize: number;
  /** 行距 1.4-2.2 */
  lineHeight: number;
  theme: ReaderTheme;
  /** 自定义主题文字色/背景色（theme=custom 时生效） */
  customFg?: string;
  customBg?: string;
  /** 自定义背景图 URL（theme=custom 时生效，2026-08-27 晚 P2.3） */
  customBgImage?: string;
  lineWidth: ReaderLineWidth;
  /** 阅读模式：分页 / 连续滚动 */
  flow: ReaderFlow;
  /** 翻页动画：默认 / 滑动 / 卷页 */
  turnStyle: ReaderTurnStyle;
  /** 字体来源 */
  fontMode: ReaderFontMode;
  /** fontMode=custom 时选中的自定义字体 id */
  customFontId?: string;
  /* ---- 2026-08-28 分类字体（fontMode=classified，参考 Readest 字体面板） ---- */
  /** 正文默认走衬线还是无衬线链（默认 serif） */
  defaultFontFamily?: ReaderDefaultFontFamily;
  /** 衬线链首选字体（默认「霞鹜文楷」，思源笔记常用） */
  serifFont?: string;
  /** 无衬线链首选字体（默认「苹方」） */
  sansSerifFont?: string;
  /** 等宽链首选字体（默认「Fira Code」，代码块专用） */
  monospaceFont?: string;
  /** 中文字体：插入每条链的次位（留空=不插入，仅用跨平台 CJK 兜底栈） */
  defaultCJKFont?: string;
  /** 点击正文左右三分之一区域翻页（默认关，防误触） */
  clickToTurn?: boolean;
  /** 强制正文使用阅读器字体（霞鹜文楷），覆盖书籍自带死字体；默认开（参考 Readest/思阅「覆盖出版商字体」） */
  overridePublisherFont?: boolean;
  /** 统一正文字号：压平书籍自带 p/li 级字号（如 font-size: medium），让字号 A+/A- 全局生效；默认开 */
  overrideBookFontSize?: boolean;
  /** 专注模式：滚动时高亮视口中心段落、其余淡出（仅滚动模式生效）；默认关 */
  focusMode?: boolean;
  /** 双语对照：开启后每段正文后注入译文（2026-08-27 重设计） */
  bilingual?: boolean;
  /** 双语目标语言（ISO-639-1，默认 "zh"） */
  bilingualTarget?: string;
  /** 译文风格：直译(default) / 简洁版(concise)。简洁版译文更短、更像学习者笔记（2026-08-31 重新启用） */
  bilingualStyle?: "default" | "concise";
  /** 隐藏译文集合（2026-08-31）：bookId → 已隐藏段落指纹(segHash)数组，关闭/重开双语后保持隐藏 */
  bilingualHidden?: Record<string, string[]>;
  /** 译文字号（em 倍数，相对正文；默认 0.70；思源 CJK 字体大，0.70≈书籍字体的 0.90；2026-08-28） */
  translationFontSize?: number;
  /** 双语预取页数：当前屏之后额外预译并缓存的「面」数（默认 2；值越大越省翻页等待但越费 token；2026-08-28 新增可调） */
  bilingualPrefetchPages?: number;
  /** 双语调试信息：译文块显示引擎与 Token 明细（默认关，替代原写死的 DEBUG_BILINGUAL 常量；2026-08-30） */
  bilingualDebug?: boolean;
  /** 双语默认模式：点击「双语」时如何翻译
   *  - "ask"        （默认）弹窗询问「整书预翻译 / 渐进式」
   *  - "whole-book" 直接整书预翻译（后台填充缓存）
   *  - "progressive" 直接渐进式（当前页 + N 页窗口，翻页自动补译）
   *  2026-08-31 Phase 4：独立「双语翻译设置」Tab 的全局默认行为。 */
  bilingualDefaultMode?: "ask" | "whole-book" | "progressive";
  /** 双语源语言（ISO-639-1，默认 "en"；英文书为主，亦支持 "auto"/"ja"/"fr"/...） */
  bilingualSourceLang?: string;
  /** 渐进式：翻页自动补译当前窗口（默认 true） */
  bilingualProgressiveAuto?: boolean;
  /** 翻译时跳过已缓存段落（默认 true，避免重复消耗 token/额度） */
  bilingualSkipCached?: boolean;
  /** 整书预翻译：边译边显示译文（默认 true；关则纯后台缓存，不注入 DOM） */
  bilingualRealtimePreview?: boolean;
  /** 用量告警阈值（0~1，默认 0.8）：达到即黄，达 1.0 即红并触发停止/提示 */
  bilingualAlertRatio?: number;
  /* 2026-08-31：原 bilingualV2Enabled 开关已删除——v1（bilingual.ts）移除后，
   * v2 兄弟节点渲染成为唯一实现，无需再灰度切换。 */
  /** 段落悬停高亮：鼠标悬停段落时轻微底色（默认开，2026-08-28 增强项） */
  paragraphHover?: boolean;
  /* ---- 2026-08-31 Phase 2：译文归档到思源 SQLite ---- */
  /** 是否把译文同步写进思源笔记（可搜索 / 可 SQL 查询 / 随思源同步）。
   *  关闭时译文只存在插件自己的 JSON 缓存里。默认关闭——在用户思源里建文档是
   *  写入操作，需用户明确启用。 */
  translationArchiveEnabled?: boolean;
  /** 译文归档文档 ID（由 ensureTranslationArchiveDoc 自动创建并回填，一般无需手改） */
  translationArchiveDocId?: string;
  /* ---- 2026-09-01 笔记文档绑定：阅读摘录 / 书图谱 发送目标（替代写死的 /REword 路径） ---- */
  /** 阅读摘录绑定目标文档 ID：发送摘录时 append 到此文档 */
  excerptDocId?: string;
  /** 阅读摘录绑定文档标题（仅展示用） */
  excerptDocTitle?: string;
  /** 阅读摘录绑定文档所在笔记本 ID */
  excerptNotebookId?: string;
  /** 书图谱绑定目标文档 ID：导出书图谱时按书名去重 append 到此文档 */
  bookGraphDocId?: string;
  /** 书图谱绑定文档标题（仅展示用） */
  bookGraphDocTitle?: string;
  /** 书图谱绑定文档所在笔记本 ID */
  bookGraphNotebookId?: string;
  /* ---- 2026-08-29 PDF 显示设置（仅 PDF 书生效，对齐 Obsidian PDF++ 阅读菜单） ---- */
  /** PDF 视图模式：单页 / 双页 / 书籍（映射 foliate spread: none/both/portrait） */
  pdfViewMode?: "single" | "double" | "book";
  /** PDF 滚动方向：垂直 / 水平（仅「滚动」模式生效；映射 foliate scroll-direction） */
  pdfScrollDir?: "vertical" | "horizontal";
  /** PDF 反色 / 暗色：canvas 级 pageColors 反色，独立于阅读器通用主题 */
  pdfInvert?: boolean;
  /** 文本设置（2026-08-24 新增） */
  text: ReaderTextSettings;
  /** 段落设置（2026-08-24 新增） */
  paragraph: ReaderParagraphSettings;
  /** 页面布局（2026-08-24 新增） */
  layout: ReaderLayoutSettings;
  /** 笔记插入（2026-08-24 新增） */
  note: ReaderNoteSettings;
}

export const READER_DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 17,
  lineHeight: 1.7,
  theme: "auto", // 默认跟随思源主题（2026-08-25）
  lineWidth: "normal",
  flow: "paginated",
  turnStyle: "default",
  fontMode: "follow-siyuan",
  // 分类字体默认值（对齐 Readest 面板默认：衬线=霞鹜文楷 / 无衬线=微软雅黑 / 等宽=Fira Code）
  defaultFontFamily: "serif",
  serifFont: "霞鹜文楷",
  sansSerifFont: "苹方",
  monospaceFont: "Fira Code",
  defaultCJKFont: "",
  clickToTurn: false,
  overridePublisherFont: true,
  overrideBookFontSize: true,
  focusMode: false,
  bilingual: false,
  bilingualTarget: "zh",
  bilingualStyle: "default",
  translationFontSize: 0.62,
  bilingualPrefetchPages: 2,
  bilingualDebug: false,
  // 2026-08-31 Phase 4：双语「独立设置 Tab」全局默认行为
  bilingualDefaultMode: "ask",
  bilingualSourceLang: "en",
  bilingualProgressiveAuto: true,
  bilingualSkipCached: true,
  bilingualRealtimePreview: true,
  bilingualAlertRatio: 0.8,
  paragraphHover: true,
  // 2026-08-31 Phase 2：译文归档默认关闭（会在用户思源里建文档，需明确启用）
  translationArchiveEnabled: false,
  translationArchiveDocId: "",
  excerptDocId: "",
  excerptDocTitle: "",
  excerptNotebookId: "",
  bookGraphDocId: "",
  bookGraphDocTitle: "",
  bookGraphNotebookId: "",
  pdfViewMode: "single",
  pdfScrollDir: "vertical",
  pdfInvert: false,
  text: {
    fontWeight: 400,
    letterSpacing: 0,
  },
  paragraph: {
    paragraphSpacing: 0.8,
    textIndent: 0,
  },
  layout: {
    marginTopPx: 16,
    marginBottomPx: 16,
    marginLeftPx: 16,
    marginRightPx: 16,
    columnGapPx: 16,
    showHeader: true,
    showFooter: true,
    showProgress: true,
    progressStyle: "fraction",
    bottomBarMode: "both",
    referencePageCount: 0,
    showCurrentTime: false,
    use24Hour: false,
    followSiyuanMargin: false,
    restoreTabsOnLaunch: true,
  },
  note: {
    syncOnAdd: false,
    syncOnDelete: false,
    insertPosition: "clipboard",
    templatePreset: "simple",
    // 2026-08-29：末行 {{link}} = 回跳原书的深链（siyuan://plugins/…），在思源文档里
    // 点击即打开该书并定位到摘录处。此前该变量恒为空串，模板里等于没有这个功能。
    linkFormat:
      "> {{text}}\n>\n> ——《{{bookTitle}}》{{author}} · {{chapter}}\n\n{{note}}\n\n{{link}}",
    excludeRegex: "",
    tagPresets: "未分组\n生词\n句法\n文化\n逻辑",
    quickSendDocs: [],
  },
};

export const FONT_MODE_PRESETS: Record<ReaderFontMode, { label: string; hint: string }> = {
  "follow-siyuan": { label: "跟随思源", hint: "使用思源笔记当前的字体（含字体插件/主题）" },
  custom: { label: "自定义", hint: "使用导入的字体文件" },
  system: { label: "系统默认", hint: "不注入字体，用阅读器内核默认" },
  classified: {
    label: "分类",
    hint: "衬线 / 无衬线 / 等宽三条字体链分别设置（参考 Readest），代码块自动用等宽",
  },
};

/** 正文默认链（Readest「默认字体」） */
export const DEFAULT_FONT_FAMILY_PRESETS: Record<
  ReaderDefaultFontFamily,
  { label: string; hint: string }
> = {
  serif: { label: "衬线字体", hint: "笔画末端有饰线，长文阅读更省力，适合小说/文学" },
  "sans-serif": { label: "无衬线字体", hint: "笔画均匀简洁，小字号更清晰，适合技术/新闻" },
};

/* ================= 分类字体候选池（2026-08-28，参考 Readest services/constants.ts） =================
 * 排序原则：思源笔记常用字体 → macOS → Windows → 跨平台开源 → 通用兜底。
 * 说明：Reword 运行在思源插件 iframe 内，**不能枚举系统已装字体**（无原生 API），
 * 因此用预设池覆盖主流场景；未命中的字体浏览器自动跳过，由链尾 CJK 兜底栈接管。
 */

/** 衬线链候选池 */
export const SERIF_FONT_PRESETS: string[] = [
  "霞鹜文楷",
  "LXGW WenKai",
  "LXGW WenKai Screen",
  "Songti SC",
  "宋体",
  "SimSun",
  "Source Han Serif CN",
  "Noto Serif CJK SC",
  "Noto Serif SC",
  "Georgia",
  "Times New Roman",
  "Literata",
  "Merriweather",
];

/** 无衬线链候选池 */
export const SANS_SERIF_FONT_PRESETS: string[] = [
  "苹方",
  "PingFang SC",
  "微软雅黑",
  "Microsoft YaHei",
  "思源黑体",
  "Source Han Sans CN",
  "Noto Sans SC",
  "Helvetica",
  "Arial",
  "Roboto",
  "Open Sans",
];

/** 等宽链候选池（代码块 / <pre> / <code> 专用） */
export const MONOSPACE_FONT_PRESETS: string[] = [
  "Fira Code",
  "JetBrains Mono",
  "Source Code Pro",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "Courier New",
  "Noto Sans Mono CJK SC",
];

/** 中文字体候选池（插入每条链次位，留空则不插入） */
export const CJK_FONT_PRESETS: string[] = [
  "霞鹜文楷",
  "LXGW WenKai",
  "苹方",
  "PingFang SC",
  "微软雅黑",
  "Microsoft YaHei",
  "思源黑体",
  "Source Han Sans CN",
  "Noto Sans SC",
  "Songti SC",
  "宋体",
  "SimSun",
];

/** 笔记插入位置选项（用于设置面板 dropdown） */
export const NOTE_INSERT_POSITION_PRESETS: Record<NoteInsertPosition, { label: string; hint: string }> = {
  clipboard: { label: "剪贴板", hint: "复制到剪贴板，手动粘贴" },
  currentDoc: { label: "当前文档", hint: "插入到思源笔记当前打开的文档末尾" },
  notebook: { label: "笔记本", hint: "保存到设置中的笔记本（默认 /REword/阅读摘录）" },
};

/** 笔记模板预设 */
export const NOTE_TEMPLATE_PRESETS: Record<NoteTemplatePreset, { label: string; template: string }> = {
  simple: {
    label: "简洁",
    template: "> {{text}}\n\n——《{{bookTitle}}》{{chapter}}",
  },
  heading: {
    label: "标题+引文",
    template: "## {{bookTitle}}\n\n> {{text}}\n\n——{{chapter}}\n\n{{note}}",
  },
  quote: {
    label: "纯引文",
    template: "> {{text}}\n\n—— 《{{bookTitle}}》 {{author}}",
  },
  custom: {
    label: "自定义",
    template: "",
  },
};

/** 进度样式选项 */
export const PROGRESS_STYLE_PRESETS: Record<ReaderProgressStyle, { label: string; hint: string }> = {
  fraction: { label: "分数", hint: "如 5/100" },
  page: { label: "页码", hint: "如 12" },
  percent: { label: "百分比", hint: "如 5%" },
};

/** 底部进度条「程序坞」唤出方式（2026-08-30） */
export const BOTTOM_BAR_MODE_PRESETS: Record<ReaderBottomBarMode, { label: string; hint: string }> = {
  dot: { label: "小圆点", hint: "底部中央常驻小圆点，点击展开进度条" },
  hover: { label: "悬浮", hint: "平时收起，鼠标移至阅读器底部边框才平滑显现" },
  both: { label: "两者", hint: "小圆点常驻 + 悬浮热区都能唤出" },
};

/**
 * 排版预设（2026-08-30）：一行选「紧凑 / 舒适 / 宽松 / 绘本」，一键套用
 * 边距（上下/左右）+ 行距 + 段距 + 字距的组合，免去逐个拖滑块。
 * - compact  紧凑：小边距、小行距，适合手机小屏或想多装字。
 * - comfort  舒适（默认基线）：适中边距行距，通读最舒服。
 * - spacious 宽松：大边距、大行距，适合大屏 / 长时间阅读。
 * - picture  绘本：图文书（儿童绘本 / 画册）友好——边距适中、行距略紧、
 *   段距偏小，让文图更紧凑成块（避免短句被拉太散）。
 */
export const READER_TYPO_PRESETS: Record<
  ReaderTypographyPreset,
  {
    label: string;
    hint: string;
    lineHeight: number;
    letterSpacing: number;
    marginTopPx: number;
    marginBottomPx: number;
    marginLeftPx: number;
    marginRightPx: number;
    paragraphSpacing: number;
  }
> = {
  compact: { label: "紧凑", hint: "小边距小行距，适合手机小屏", lineHeight: 1.5, letterSpacing: 0, marginTopPx: 8, marginBottomPx: 8, marginLeftPx: 12, marginRightPx: 12, paragraphSpacing: 0.5 },
  comfort: { label: "舒适", hint: "适中边距行距，通读最舒服", lineHeight: 1.7, letterSpacing: 0.2, marginTopPx: 16, marginBottomPx: 16, marginLeftPx: 18, marginRightPx: 18, paragraphSpacing: 0.8 },
  spacious: { label: "舒展", hint: "大边距大行距，适合大屏长读", lineHeight: 1.9, letterSpacing: 0.4, marginTopPx: 28, marginBottomPx: 28, marginLeftPx: 30, marginRightPx: 30, paragraphSpacing: 1.2 },
  picture: { label: "绘本", hint: "图文书友好，文图紧凑成块", lineHeight: 1.55, letterSpacing: 0, marginTopPx: 12, marginBottomPx: 12, marginLeftPx: 14, marginRightPx: 14, paragraphSpacing: 0.6 },
};

/** 8 款预设主题 + 自定义（参考 sireader 色板） */
export const THEME_PRESETS: Record<ReaderTheme, { label: string; bg: string; fg: string; fg2: string }> = {
  auto: { label: "跟随思源", bg: "#ffffff", fg: "#222222", fg2: "#888888" }, // 运行时由 resolveAutoTheme 覆盖
  light: { label: "默认", bg: "#ffffff", fg: "#222222", fg2: "#888888" },
  almond: { label: "杏仁黄", bg: "#f5ecdc", fg: "#4a3f2f", fg2: "#8f8370" },
  autumn: { label: "秋叶褐", bg: "#f4e8d8", fg: "#5a4632", fg2: "#97856e" },
  green: { label: "青草绿", bg: "#eef4e8", fg: "#2e4a2e", fg2: "#6d8468" },
  blue: { label: "海天蓝", bg: "#e8f2f8", fg: "#1f3a4d", fg2: "#5f7f92" },
  night: { label: "夜间", bg: "#23262e", fg: "#c8ccd4", fg2: "#7d828c" },
  dark: { label: "暗黑", bg: "#121212", fg: "#d6d6d6", fg2: "#888888" },
  gold: { label: "赤金", bg: "#241c10", fg: "#e6c977", fg2: "#9d8448" },
  custom: { label: "自定义", bg: "#ffffff", fg: "#222222", fg2: "#888888" },
};

export const LINE_WIDTH_PRESETS: Record<ReaderLineWidth, { label: string; padding: string }> = {
  narrow: { label: "窄", padding: "2em 3em" },
  normal: { label: "标准", padding: "2em 1.5em" },
  wide: { label: "宽", padding: "2em 0.6em" },
};

/* ================= 2026-08-29 页面边距三档预设（替代失效的行宽 padding 控制） =================
 * 旧 lineWidth 预设只控制 body padding 的左右，且无法让 4 边距滑块生效；现统一改由
 * 4 个边距滑块 / 三档预设驱动 body padding（见 reader-style.ts layoutMarginStyles）。
 * 三档数值（px，对应 T R B L）：
 *   - 铺满：内容几乎贴边，适合小屏 / 资料密集型阅读
 *   - 正常：日常默认
 *   - 宽松：大屏沉浸式，左右留白更多
 * custom 仅作 UI 态，不携带固定数值（滑块拖动即进入该态）。
 */
export type ReaderLayoutPreset = "fill" | "normal" | "loose" | "custom";
export const LAYOUT_PRESETS: Record<
  ReaderLayoutPreset,
  { label: string; margins: { top: number; right: number; bottom: number; left: number } }
> = {
  fill: { label: "铺满", margins: { top: 4, right: 16, bottom: 8, left: 12 } },
  normal: { label: "正常", margins: { top: 16, right: 24, bottom: 20, left: 20 } },
  loose: { label: "宽松", margins: { top: 32, right: 56, bottom: 48, left: 48 } },
  custom: { label: "自定义", margins: { top: 0, right: 0, bottom: 0, left: 0 } },
};

/** 根据 4 边距反推当前落在哪个预设（都不匹配则「自定义」） */
export function detectLayoutPreset(layout: ReaderLayoutSettings): ReaderLayoutPreset {
  for (const key of ["fill", "normal", "loose"] as ReaderLayoutPreset[]) {
    const m = LAYOUT_PRESETS[key].margins;
    if (
      layout.marginTopPx === m.top &&
      layout.marginRightPx === m.right &&
      layout.marginBottomPx === m.bottom &&
      layout.marginLeftPx === m.left
    ) {
      return key;
    }
  }
  return "custom";
}

export const FLOW_PRESETS: Record<ReaderFlow, { label: string }> = {
  paginated: { label: "分页" },
  scrolled: { label: "滚动" },
};

export const TURN_STYLE_PRESETS: Record<ReaderTurnStyle, { label: string }> = {
  default: { label: "默认" },
  slide: { label: "滑动" },
  curl: { label: "卷页" },
};

const STORAGE_KEY = "hiword-reader-settings.json";

export class ReaderSettingsStore {
  private settings: ReaderSettings = { ...READER_DEFAULT_SETTINGS };
  /** 内部 Svelte store：让 ReaderView 可订阅，跨 Tab 同实例自动同步 */
  private _store = writable<ReaderSettings>({ ...READER_DEFAULT_SETTINGS });
  private loaded = false;
  private saveTimer: any = null;
  /** 思源插件实例（loadData / saveData）。
   *  2026-08-28：原为 TS 参数属性 `constructor(private plugin: any)` —— Node 的
   *  strip-only 类型擦除（--experimental-strip-types）**不支持参数属性**，
   *  一旦有测试文件 import 本模块就会抛 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX 整个崩掉。
   *  改为显式字段 + 构造函数赋值（语义等价，且 strip 兼容）。 */
  private plugin: any;

  constructor(plugin: any) {
    this.plugin = plugin;
    // 2026-09-01：注册为全局单例，供非 Svelte 模块读取绑定文档 ID
    _globalSettingsStore = this;
  }

  /** 实现 Svelte store 契约：返回退订函数（支持 `$settingsStore` 自动订阅） */
  subscribe(run: (value: ReaderSettings) => void, invalidate?: (value?: ReaderSettings) => void): () => void {
    return this._store.subscribe(run, invalidate as any);
  }

  async load(): Promise<void> {
    if (this.loaded) {
      // 已加载：重新推送当前值，唤醒（可能晚于 onMount 才订阅的）组件
      this._store.set({ ...this.settings });
      return;
    }
    try {
      const data = await this.plugin.loadData(STORAGE_KEY);
      if (data && typeof data === "object") {
        // 浅合并 + 各子对象（text/paragraph/layout/note）逐层合并，
        // 保证旧版已保存的配置也能补齐新增字段（如 bottomBarMode），不会因整体覆盖而丢失默认。
        this.settings = {
          ...READER_DEFAULT_SETTINGS,
          ...data,
          text: { ...READER_DEFAULT_SETTINGS.text, ...(data.text ?? {}) },
          paragraph: { ...READER_DEFAULT_SETTINGS.paragraph, ...(data.paragraph ?? {}) },
          layout: { ...READER_DEFAULT_SETTINGS.layout, ...(data.layout ?? {}) },
          note: { ...READER_DEFAULT_SETTINGS.note, ...(data.note ?? {}) },
        };
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "reader-settings.ts · load", "debug"); }
    // 2026-09-01：首次加载时把旧 /REword/阅读摘录、/REword/书图谱 自动识别为绑定目标
    try { await this.autoMigrateBindings(); } catch (__migErr) { logSwallow(__migErr, "reader-settings.ts · autoMigrate", "debug"); }
    this.loaded = true;
    // 加载完成后推送最新值 → 订阅者（含其它已开 Tab）立即生效
    this._store.set({ ...this.settings });
  }

  /** 2026-09-01：自动迁移旧版写死的 /REword 路径文档为绑定目标（仅当对应字段为空时） */
  private async autoMigrateBindings(): Promise<void> {
    const targets: Array<{ hpath: string; key: "excerpt" | "graph" }> = [];
    if (!this.settings.excerptDocId) targets.push({ hpath: "/REword/阅读摘录", key: "excerpt" });
    if (!this.settings.bookGraphDocId) targets.push({ hpath: "/REword/书图谱", key: "graph" });
    if (!targets.length) return;
    try {
      const nbs = await lsNotebooks();
      for (const nb of nbs) {
        if (nb.closed) continue;
        for (let i = targets.length - 1; i >= 0; i--) {
          const t = targets[i];
          try {
            if (t.key === "excerpt") {
              const ids = await getIDsByHPath(nb.id, t.hpath);
              if (ids && ids.length) {
                this.settings.excerptDocId = ids[0];
                this.settings.excerptDocTitle = "阅读摘录";
                this.settings.excerptNotebookId = nb.id;
                targets.splice(i, 1);
              }
            } else {
              // 书图谱旧结构是文件夹：取其下首个文档绑定；不存在则不自动创建
              // （早期版本会在 /REword/书图谱 不存在时 createDocWithMd 报「no such file or directory」，
              // 现改为保持未绑定，由用户在「阅读器设置 → 笔记导出绑定」中手动拖入绑定）
              const kids = await listDocsByPath(nb.id, t.hpath);
              const firstDoc = (kids || [])[0];
              if (firstDoc) {
                this.settings.bookGraphDocId = firstDoc.id;
                this.settings.bookGraphDocTitle = firstDoc.name || "书图谱";
                this.settings.bookGraphNotebookId = nb.id;
                targets.splice(i, 1);
              }
            }
          } catch { /* 单笔记本失败跳过，继续下一个 */ }
        }
        if (!targets.length) break;
      }
    } catch { /* 内核不可用则跳过迁移 */ }
  }

  get(): ReaderSettings {
    return { ...this.settings };
  }

  /** 更新并立即返回新设置；保存防抖 300ms；推送新值通知所有订阅者（跨 Tab 同步） */
  update(patch: Partial<ReaderSettings>): ReaderSettings {
    this.settings = { ...this.settings, ...patch };
    this._store.set({ ...this.settings });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.plugin.saveData(STORAGE_KEY, this.settings).catch(() => {});
    }, 300);
    return this.get();
  }
}
