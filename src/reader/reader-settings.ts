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
/** 字体来源：跟随思源 / 自定义导入 / 系统默认（不注入） */
export type ReaderFontMode = "follow-siyuan" | "custom" | "system";
/** 笔记插入位置：剪贴板 / 当前文档 / 笔记本 */
export type NoteInsertPosition = "clipboard" | "currentDoc" | "notebook";
/** 笔记模板预设 */
export type NoteTemplatePreset = "simple" | "heading" | "quote" | "custom";
/** 进度样式：分数（如 5/100）/ 页码（如 12）/ 百分比（如 5%） */
export type ReaderProgressStyle = "fraction" | "page" | "percent";

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
  /** 参考页数 0-2000（默认 0，0=不显示） */
  referencePageCount: number;
  /** 显示当前时间（默认 false） */
  showCurrentTime: boolean;
  /** 24 小时制（默认 false） */
  use24Hour: boolean;
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
  clickToTurn: false,
  overridePublisherFont: true,
  overrideBookFontSize: true,
  focusMode: false,
  bilingual: false,
  bilingualTarget: "zh",
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
    referencePageCount: 0,
    showCurrentTime: false,
    use24Hour: false,
  },
  note: {
    syncOnAdd: false,
    syncOnDelete: false,
    insertPosition: "clipboard",
    templatePreset: "simple",
    linkFormat:
      "> {{text}}\n>\n> ——《{{bookTitle}}》{{author}} · {{chapter}}\n\n{{note}}",
    excludeRegex: "",
    tagPresets: "未分组\n生词\n句法\n文化\n逻辑",
    quickSendDocs: [],
  },
};

export const FONT_MODE_PRESETS: Record<ReaderFontMode, { label: string; hint: string }> = {
  "follow-siyuan": { label: "跟随思源", hint: "使用思源笔记当前的字体（含字体插件/主题）" },
  custom: { label: "自定义", hint: "使用导入的字体文件" },
  system: { label: "系统默认", hint: "不注入字体，用阅读器内核默认" },
};

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

  constructor(private plugin: any) {}

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
        this.settings = {
          ...READER_DEFAULT_SETTINGS,
          ...data,
        };
      }
    } catch {
      /* 使用默认 */
    }
    this.loaded = true;
    // 加载完成后推送最新值 → 订阅者（含其它已开 Tab）立即生效
    this._store.set({ ...this.settings });
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
