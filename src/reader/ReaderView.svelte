<script lang="ts">
  import { logSwallow } from "../core/safe.ts";
  /**
   * 阅读器 - 阅读面板（P0 + P1 打磨）
   * ---------------------------------------------------------------
   * - 渲染：foliate-js <foliate-view>（EPUB/MOBI/AZW3/FB2/CBZ 原生；TXT/MD 自研适配器）
   * - 翻页：iframe 内 点击分区 / 键盘 / 触摸滑动（foliate 内核不带翻页交互）
   * - 底部工具栏：☰目录 ◀ 进度条+百分比 ▶ 🔍搜索 ⚙设置；顶栏：返回 + 书名 + 章节名
   * - 全文搜索：foliate view.search() 高亮 + 计数 + 上/下条跳转
   * - 阅读模式（分页/滚动 flow）、翻页动画（turn-style）、8 主题 + 自定义色
   */
  import { onMount, onDestroy, tick } from "svelte";
  // 移动端适配 Phase 0/1：统一环境判定入口（禁止再手写 getFrontend().endsWith("mobile")）
  import { isTouchDevice } from "../core/env.ts";
  // [REword patch 2026-08-29] 移动端 PDF 适配 Phase 1
  import { getDeviceClass, isSmallMobile, isLargeMobile } from "../core/env.ts";
  // [REword patch 2026-08-29] Phase 3 Apple Pencil 墨迹批注
  import InkLayer from "./ink/InkLayer.svelte";
  import InkToolbar from "./ink/InkToolbar.svelte";
  import {
    inkState,
    // inkStrokes：擦除时直接 update 笔触列表（onInkPointerDown L1686）
    inkStrokes,
    // currentPageStrokes：橡皮取当前页最后一个笔触（onInkPointerDown L1684）
    // 注意：$store 由 Svelte 编译器在组件实例化时注入 component_subscribe，
    // 漏 import 会在挂载阶段抛 ReferenceError → 整棵组件白屏（tsc 查不到，只有 vite warn）
    currentPageStrokes,
    activeStroke,
    inkContext,
    isInkMode,
    addStroke,
    setInkContext,
    setInkMode,
  } from "./ink/store";
  import {
    catmullRomToBezierPath,
    getCoalescedPoints,
    shouldUseHighlighter,
  } from "./ink/utils";
  import type { InkStroke, InkPoint } from "./ink/types";
  // @ts-ignore - foliate-js 为纯 ES 模块 vendor（副作用：注册 reword-foliate-view / reword-foliate-paginator / reword-foliate-fxl / reword-foliate-quoteimage）
  import "../reader/vendor/foliate-js/view-light.js";
  import { makeTextBook, isTextBookFile } from "../reader/book-adapters";
  // 脚注检测 + 抽取（scoped 模块，不依赖 foliate vendor 内核）
  import { isFootnoteRef, extractFootnote } from "./footnote";
  // v1.3.0：本书前提上下文编辑器（思源原生 lite Protyle）+ token 估算
  import { AnnEditor } from "../annotation/ann-editor.ts";
  import { estimateTokens, PRIMER_WARN_CHARS } from "./book-primer.ts";
  import type { BookshelfStore, BookMeta, BookMark } from "../reader/bookshelf-store";
  // [REword patch 2026-08-29] PDF 缩放：复用 ReadingProgress.zoom 字段
  import type { ZoomState } from "../reader/bookshelf-store";
  import { ZOOM_PRESETS } from "../reader/bookshelf-store";
  import {
    ReaderSettingsStore,
    READER_DEFAULT_SETTINGS,
    THEME_PRESETS,
    LINE_WIDTH_PRESETS,
    FLOW_PRESETS,
    TURN_STYLE_PRESETS,
    FONT_MODE_PRESETS,
    DEFAULT_FONT_FAMILY_PRESETS,
    SERIF_FONT_PRESETS,
    SANS_SERIF_FONT_PRESETS,
    MONOSPACE_FONT_PRESETS,
    CJK_FONT_PRESETS,
    NOTE_INSERT_POSITION_PRESETS,
    NOTE_TEMPLATE_PRESETS,
    PROGRESS_STYLE_PRESETS,
    LAYOUT_PRESETS,
    detectLayoutPreset,
    type ReaderSettings,
    type ReaderLayoutPreset,
    type ReaderTheme,
    type ReaderFontMode,
    type NoteInsertPosition,
    type NoteTemplatePreset,
    type ReaderProgressStyle,
  } from "../reader/reader-settings";
  import {
    FontStore,
    collectHostFontFaces,
    collectHostFontUrls,
    getHostFontStack,
    customFontFaceCss,
    type CustomFont,
  } from "../reader/reader-fonts";
  import {
    buildReaderStyles,
    getDefaultCjkFontStack,
    buildFontFamilyLists,
  } from "../reader/reader-style";
  // 2026-08-28 分类字体：EPUB 内联 serif/sans-serif/monospace 关键词 → CSS 变量（Readest 同款）
  import {
    rewriteFontKeywordsInAllContents,
    rewriteFontKeywordsInDocument,
  } from "../reader/reader-font-classify";
  // 2026-08-27 重设计：双语段落注入（顶栏「双语」开关）
  import { createBilingual, type BilingualHandle } from "./bilingual";
  // 2026-08-28：连续朗读控制器（参考 Readest：多引擎 system/youdao/edge + 句子高亮 + 控制条）
  import { ReaderTtsController, DEFAULT_REWORD_TTS, type RewordTtsSettings, type TtsState } from "./reader-tts";
  import { getFileBlob } from "../siyuan/api";
  // Phase 1：划词即时词典——复用现有离线词典引擎与卡片渲染（与「查词典」Tab 同源）
  import { lookupSmart, searchCandidates } from "../dict/dict-engine";
  import {
    parseDictEntry,
    renderDictCard,
    renderDictSuggestions,
    renderLoading,
  } from "../dict/dict-renderer";
  import { togglePosCollapsed } from "../dict/pos-toggle";
  // Phase 2：划词高亮 + 批注（阅读器 / foliate 集成）
  // @ts-ignore - foliate-js 为纯 JS vendor（无类型声明）
  import { Overlayer } from "../reader/vendor/foliate-js/overlayer.js";
  import { getAnnotationStore } from "../annotation/store-singleton";
  // 标注/批注区分：isEmptyNoteContent(rec) → 无笔记=纯标注（进编辑工具栏），有笔记=批注（进查看卡片）
  import { classifyAnnotation } from "../annotation/whale-renderer";
  import {
    WHALE_COLORS,
    ANNOTATION_STYLES,
    ANNOTATION_PANEL_STYLES,
    normalizeAnnotationStyle,
    isPureHighlight,
    type AnnotationStyle,
    type AnnotationType,
  } from "../annotation/annotation-store.ts";
  import { getDefaultAnnotationColor, getDefaultAnnotationStyle } from "../annotation/annotation-config.ts";
  // 2026-08-24 根治：视觉层确定性同步（不信任 foliate 删除 API 的"静默失败"，
  // 改为按 key 遍历 overlay 强制移除 + 全量 reconcile）
  import {
    eraseOverlayKey,
    hasOverlayKey,
    syncVisualWithStore,
    nukeAndRedrawOverlays,
    subscribeAnnotationsChanged,
  } from "./annotation-visual";

  // ============================================================
  // [DEBUG] REword 阅读器调试日志模块（Bug 排查专用）
  // ------------------------------------------------------------
  // 用法：DEBUG_READER=true 时输出 [REword-DBG] 前缀的结构化日志；
  //      false 时所有 dbg.* 调用为 no-op（编译期 tree-shake / 运行时零开销）。
  //      在 DevTools Console 用 filter "[REword-DBG]" 即可只看调试流。
  // 设计：Proxy 空函数，DEBUG_READER=false 时任意 dbg.xxx(...) 调用直接跳过，
  //      不触发任何字符串拼接或序列化（避免性能损耗）。
  // ============================================================
  const DEBUG_READER = false;  // 调试开关：true=开启控制台日志+HUD面板；false=静默（dbgHud 数据仍持续收集）
  const dbg = (() => {
    if (!DEBUG_READER) {
      const noop = () => {};
      return new Proxy(noop, { get: () => noop }) as any;
    }
    const ts = () => {
      const d = new Date();
      const p = (n: number, l = 2) => String(n).padStart(l, "0");
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
    };
    const fmt = (v: any): string => {
      try {
        if (v === null) return "null";
        if (v === undefined) return "undefined";
        if (typeof v === "object" && v instanceof Element) return `<${v.tagName.toLowerCase()} class="${(v as Element).className}">`;
        if (typeof v === "object") return JSON.stringify(v, null, 0).slice(0, 240);
        if (typeof v === "string") return v.length > 100 ? v.slice(0, 100) + "…" : v;
        return String(v);
      } catch { return "[unserializable]"; }
    };
    const head = (sym: string, tag: string) => `[REword-DBG] ${ts()} ${sym} ${tag}`;
    return {
      event: (tag: string, msg: string, data?: any) => console.log(head("•", tag), msg, data !== undefined ? "→ " + fmt(data) : ""),
      step: (tag: string, msg: string, data?: any) => console.log(head("│", tag), msg, data !== undefined ? "→ " + fmt(data) : ""),
      snapshot: (tag: string, obj: any) => console.log(head("⊞", tag), "snapshot →", fmt(obj)),
      warn: (tag: string, msg: string, data?: any) => console.warn(head("⚠", tag), msg, data !== undefined ? "→ " + fmt(data) : ""),
    };
  })();

  export let bookId: string;
  export let store: BookshelfStore;
  export let settingsStore: ReaderSettingsStore;
  export let fontStore: FontStore;
  export let onBack: () => void;
  /** 独立 Tab 模式：关闭当前 Tab（未提供时 ‹ 退化为 onBack） */
  export let onCloseTab: (() => void) | undefined = undefined;
  /** 独立 Tab 模式：标题联动（书名 · 章节） */
  export let onTitleChange: ((title: string) => void) | undefined = undefined;
  /** 朗读选中文本（委托插件 TTS 引擎，自动适配中英文 voice） */
  export let onSpeak: ((text: string) => void) | undefined = undefined;
  /** 将选区发送到设置笔记本（委托 plugin.saveToNote） */
  export let onSendToNote: ((opts: { markdown: string; title: string }) => Promise<string> | void) | undefined = undefined;
  /** 插入到当前思源文档（2026-08-24 新增，可选） */
  export let onInsertToCurrentDoc: ((markdown: string) => Promise<string> | void) | undefined = undefined;
  /** 翻译选中文本并直接发送到 AI 精读面板（委托 plugin.translateToAi） */
  export let onTranslateToAi: ((text: string) => void) | undefined = undefined;
  /** 双语段落批量翻译（委托 plugin.translateBatch，按书缓存 + 引擎链兜底） */
  export let onTranslateBatch: ((texts: string[], from: string, to: string) => Promise<string[]>) | undefined = undefined;
  /** 是否已配置任一翻译引擎（用于双语开关前置提示） */
  export let isTranslationConfigured: (() => boolean) | undefined = undefined;
  /** 加入词库（委托 plugin vocabStore.addWord） */
  export let onAddToVocab: ((word: string) => Promise<void> | void) | undefined = undefined;
  /** 在 REword 侧边栏查词（委托 plugin.openWordInSidebar：切到查词 Tab、自动填词查询、不打断编辑） */
  export let onOpenInSidebar: ((word: string) => void) | undefined = undefined;
  /** 移出词库（委托 plugin vocabStore.removeWord） */
  export let onRemoveFromVocab: ((word: string) => Promise<void> | void) | undefined = undefined;
  /** 判断单词是否在词库（委托 plugin vocabStore.hasWord） */
  export let isInVocab: ((word: string) => boolean) | undefined = undefined;
  /** 标签解析（委托插件 LabelStore）：用于阅读批注查看气泡展示标签名/色 */
  export let onProtectTab: (() => void) | undefined = undefined;
  export let getLabel: ((id: string) => { name: string; color: string } | null) | undefined = undefined;
  /** 本书前提上下文存储（v1.3.0：plugin.bookPrimer，BookPrimerStore 实例；缺省隐藏编辑区） */
  export let primerStore: any = undefined;
  /** 本书累计 token 用量读取（v1.3.0：委托 plugin.getBookTokenUsage） */
  export let getTokenUsage: ((bid: string) => { total: number; prompt: number; completion: number }) | undefined = undefined;
  /** 重置本书累计 token（v1.3.0：委托 plugin.resetBookTokenUsage） */
  export let resetTokenUsage: ((bid: string) => Promise<void> | void) | undefined = undefined;
  /** 最近一次翻译 token 用量（v1.3.0：委托 plugin.lastTranslationUsage；修复原裸 plugin 引用未定义的 bug） */
  export let getLastUsage: (() => { promptTokens: number; completionTokens: number; totalTokens: number } | null) | undefined = undefined;
  // 2026-08-28：翻译缓存统计 / 清空（按书；由 reader-tab 透传 plugin 能力）
  export let getTranslationCacheStats: ((bid: string) => Promise<{ count: number; cachedPages: number; pageRangeText: string; title: string }>) | undefined = undefined;
  export let clearTranslationCache: ((bid: string) => Promise<void> | void) | undefined = undefined;
  // 2026-08-28：翻译成功入缓存后回传「节」序号（1-based）+ 书名，供 UI「第 X-Y 页缓存成功」+「选择书籍」
  export let recordCachedSections: ((bid: string, sections: number[], title?: string) => void) | undefined = undefined;
  // 2026-08-28：列出所有有翻译缓存的书籍（bookId + 书名），供「选择书籍」下拉
  export let listCachedBooks: (() => Promise<Array<{ bookId: string; title: string }>>) | undefined = undefined;
  // 2026-08-28：连续朗读设置（get 读 / save 写，结构 = RewordTtsSettings）
  export let getTtsSettings: (() => RewordTtsSettings | null) | undefined = undefined;
  export let saveTtsSettings: ((s: RewordTtsSettings) => Promise<void> | void) | undefined = undefined;

  // 划词工具栏图标（readest 风格线性 SVG；批注/词典复用 REword 已注册 symbol）
  const SEL_ICONS: Record<string, string> = {
    copy: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`,
    highlight: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-4 4v3h3l4-4"/><path d="M13 7l4 4"/><path d="M16 4l4 4-7 7-4-4z"/></svg>`,
    annotate: `<svg viewBox="0 0 1024 1024" width="19" height="19" fill="none" stroke="currentColor" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"><use href="#iconREwordAnn"/></svg>`,
    dict: `<svg viewBox="0 0 1024 1024" width="19" height="19" fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"><use href="#iconREwordDict"/></svg>`,
    translate: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7"/><path d="M7 4v2c0 4-2 7-6 8"/><path d="M5 9c0 3 3 5 6 6"/><path d="M14 20l4-9 4 9"/><path d="M15.5 17h5"/></svg>`,
    tts: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a6 6 0 0 1 6-6h0a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H6a2 2 0 0 1-2-2z"/><path d="M14 8a9 9 0 0 1 0 8"/><path d="M17 5a14 14 0 0 1 0 14"/></svg>`,
    send: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  };

  let container: HTMLDivElement;  // foliate-view 容器（line 1485）
  let readerViewEl: HTMLDivElement;  // 2026-08-23 新增：.reader-view 容器 ref（用于浮层 offset 与全局 mousedown 监听）
  let readerStageEl: HTMLDivElement;  // 2026-08-25 新增：.reader-stage 内容区 ref（浮层上下避让判定改用内容区坐标系，避免工具栏贴顶导航栏/越界）
  let view: any = null;
  // 2026-08-28：连续朗读控制器状态
  let ttsController: ReaderTtsController | null = null;
  let ttsState: TtsState = "idle";
  let ttsProgress = { index: 0, total: 0 };
  let ttsCurrentText = "";
  let ttsRate = DEFAULT_REWORD_TTS.rate;
  let showTtsBar = false;
  // 选区朗读时记录起始 range，供 playFrom 使用
  let ttsSelRange: Range | null = null;
  // 句子高亮开关（与设置同步，控制条按钮高亮态）
  let ttsHighlightOn = DEFAULT_REWORD_TTS.enableHighlight;
  // 朗读设置本地副本（打开设置面板时从 getTtsSettings 同步，修改即写回）
  let ttsCfg: RewordTtsSettings = { ...DEFAULT_REWORD_TTS };
  // 本机可用嗓音列表（供「中文/英文嗓音」下拉选择）；打开设置面板时刷新
  let ttsVoices: { uri: string; name: string; lang: string }[] = [];
  let ttsVoiceListenerBound = false;
  // 控制条语速滑块防抖持久化定时器（拖动时实时生效，停止后落盘）
  let rateSaveTimer: ReturnType<typeof setTimeout> | null = null;
  function loadTtsVoices() {
    try {
      const synth =
        typeof window !== "undefined" && "speechSynthesis" in window
          ? window.speechSynthesis
          : null;
      if (!synth) return;
      const map = () => {
        ttsVoices = (synth.getVoices?.() || []).map((v: SpeechSynthesisVoice) => ({
          uri: v.voiceURI, name: v.name, lang: v.lang,
        }));
      };
      map();
      // 用 addEventListener 而非 onvoiceschanged，避免覆盖 SystemBackend 的预热监听
      if (!ttsVoiceListenerBound) {
        ttsVoiceListenerBound = true;
        try { synth.addEventListener("voiceschanged", map); } catch { /* 忽略 */ }
      }
    } catch { /* 忽略 */ }
  }
  // 2026-08-27 重设计：双语对照状态与注入句柄
  let bilingualOn = false;
  let bilingualHandle: BilingualHandle | null = null;
  let bilingualProgress = { done: 0, total: 0, active: false };
  let bilingualInitDone = false; // 设置恢复只执行一次
  // 2026-08-28：最近一次双语翻译的 AI token 用量（null = 无数据 / 未走 AI）
  let bilingualTokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;
  // ========== 2026-08-26 调试 HUD：高亮渲染链路诊断（foliate 原生管线） ==========
  // 退回 foliate 原生：view.addAnnotation + draw-annotation 事件 + Overlayer 静态方法。
  // 不再自建 SVG 层（rewordOverlays / rewordHighlights 已移除）。
  const dbgHud = {
    // v3 上游链路
    setupCalled: false,    // setupAnnotationLayer 是否被调用
    annStoreReady: false,  // setup 时 annStore 是否可用
    bookIdAtSetup: "",     // setup 时 bookId 值
    annotCountInStore: 0,  // 该书存储中的批注数量
    totalInStore: -1,      // store 总批注数
    storeBookIds: "",      // store 中所有 bookId 列表
    bookIdMatch: false,    // 当前 bookId 是否在 store 中存在
    // foliate 原生管线计数
    createOverlayCalls: 0, // onCreateOverlay（create-overlay 事件）被调用次数
    addAnnotationTries: 0, // addReaderAnnotation 调用次数
    addAnnotationErrors: 0,// addReaderAnnotation 失败次数
    drawnCount: 0,         // onDrawAnnotation 实际绘制次数
    relocateCalls: 0,      // onRelocate 被调用次数
    ovr_evtIndex: -1,      // create-overlay 事件的 detail.index
    lastDraw: "",          // 最近一次绘制详情
  };

  let meta: BookMeta | undefined;
  let title = "";
  let chapterLabel = "";
  let bookAuthor = "";
  let progressText = "";
  let progress = 0;
  let totalSections = 0;
  let opened = false;
  let errorMsg = "";
  let showToc = false;
  let showSettings = false;
  let showSearch = false;
  // 脚注气泡（点击脚注直接展示内容，不跳转）
  let showFootnote = false;
  // 2026-08-29 Phase 1：工具栏可见性（移动端中心点击切换，Readest 式沉浸阅读）
  let toolbarVisible = true;
  let footnoteHTML = "";
  let footnoteType = "脚注";
  let footnoteEl: HTMLElement;
  // 2026-08-27 晚（P2.1）：脚注「悬停预览」——在点击之外补充 hover 触发
  let footnoteHoverTimer: any = null;
  let footnoteHoverAnchor: any = null; // 当前 hover 触发锚点（<a>），用于去重/收起判定
  let footnotePinned = false;          // 点击锁定的气泡（hover 移开不自动收起，点空白才关）
  let footnoteLoading = false;         // 抽取中占位（点击/悬停后给即时反馈，避免以为无反应）
  let footnoteReqToken = 0;            // 异步竞态守卫：快速划过多个脚注时丢弃过期请求
  // 思源主题跟随（auto 模式）
  let siyuanThemeMode: "light" | "dark" = "light";
  let themeObserver: MutationObserver | null = null;
  let visibilityObserver: IntersectionObserver | null = null; // 页签可见性观察器：隐藏→显示时触发高亮重绘
  let annotationsDirty = true; // 标记「需要补绘批注高亮」；由 relocate（内容就绪）或兜底定时器清掉
  let tocItems: { title: string; href: string; level: number }[] = [];
  let activeHref = "";
  let visitedHrefs = new Set<string>();
  let tocReadCount = 0;
  /* 2026-08-29 UI 全面优化 · 读者外框：底栏自动淡出 + 进度条章节标记 */
  let chromeHidden = false; // 鼠标静止后底栏淡出（Foliate 风格沉浸阅读）
  let chromeIdleTimer: ReturnType<typeof setTimeout> | null = null;
  const CHROME_IDLE_MS = 2600;
  let chapterMarks: { left: number; title: string }[] = []; // 章节起始位置（0–100）
  /* ---- 2026-08-29 新增：书签 + 摘录汇总抽屉（对齐 Obsidian weave 的摘录沉淀链） ---- */
  let showBookmarks = false; // 书签抽屉
  let bookmarks: BookMark[] = [];
  let showAnnots = false; // 摘录汇总抽屉
  let annotsList: any[] = [];

  /** 鼠标移动 → 唤回底栏并重置静止计时；有浮层/抽屉时保持常显，避免交互中被抽走 */
  function wakeChrome() {
    chromeHidden = false;
    if (chromeIdleTimer) clearTimeout(chromeIdleTimer);
    chromeIdleTimer = setTimeout(() => {
      if (selToolbar.visible || noteEditor.visible || dictPopup.visible) return;
      if (showToc || showTtsBar) return;
      chromeHidden = true;
    }, CHROME_IDLE_MS);
  }

  /** 鼠标离开阅读区 → 立即淡出底栏 */
  function hideChromeNow() {
    if (chromeIdleTimer) clearTimeout(chromeIdleTimer);
    chromeIdleTimer = null;
    chromeHidden = true;
  }

  /**
   * 由 foliate 的 sections 体积累加推算每章起始进度（0–100）。
   * toc href 与 section.id 可能带 #fragment，统一去片段后匹配；匹配不到则跳过该章。
   * 全本都匹配不到时 marks 为空 → 不渲染刻度（安全降级，不改变现有外观）。
   */
  function computeChapterMarks() {
    try {
      const sections = view?.book?.sections;
      if (!Array.isArray(sections) || sections.length < 2 || !tocItems.length) {
        chapterMarks = [];
        return;
      }
      const total = sections.reduce(
        (s: number, x: any) => s + (Number(x?.size) || 0),
        0
      );
      if (!total) {
        chapterMarks = [];
        return;
      }
      const cum: number[] = [];
      let acc = 0;
      for (const sec of sections) {
        cum.push(acc);
        acc += Number(sec?.size) || 0;
      }
      const seen = new Set<number>();
      const marks: { left: number; title: string }[] = [];
      for (const item of tocItems) {
        const path = String(item?.href || "").split("#")[0];
        if (!path) continue;
        const idx = sections.findIndex(
          (s: any) => s?.id === path || String(s?.id || "").split("#")[0] === path
        );
        if (idx <= 0) continue; // 第 0 章起点就是 0%，无需刻度
        const left = Math.round((cum[idx] / total) * 1000) / 10;
        if (left <= 0.2 || left >= 99.8) continue;
        if (seen.has(left)) continue;
        seen.add(left);
        marks.push({ left, title: item?.title || "" });
      }
      // 章节过多时抽稀，避免刻度糊成一片
      const MAX_MARKS = 60;
      chapterMarks =
        marks.length > MAX_MARKS
          ? marks.filter(
              (_, i) => i % Math.ceil(marks.length / MAX_MARKS) === 0
            )
          : marks;
    } catch {
      chapterMarks = [];
    }
  }

  onDestroy(() => {
    if (chromeIdleTimer) clearTimeout(chromeIdleTimer);
    chromeIdleTimer = null;
  });

  let settings: ReaderSettings = { ...READER_DEFAULT_SETTINGS };

  // 阅读统计（时长 / 剩余时间估算）
  let totalChars = 0;
  let sessionReadMs = 0;
  let etaText = "";
  let timeTimer: any = null;
  let lastTickAt = 0;
  let searchInput: HTMLInputElement;

  // 字体状态
  let customFonts: CustomFont[] = [];
  let fontBlobUrl = "";
  let fontImporting = false;
  let fontInput: HTMLInputElement;
  // 问题 2（跟随思源）：宿主字体文件 blob 化缓存（fetch → blob → iframe 可加载的 @font-face）
  let hostFontBlobs: { family: string; blobUrl: string }[] = [];
  let hostFontBlobsReady = false;
  /** 把宿主已加载的网页字体（霞鹜文楷等）blob 化，注入 iframe 后真正生效 */
  async function prepareHostFontBlobs(): Promise<void> {
    if (hostFontBlobsReady || settings.fontMode !== "follow-siyuan") return;
    hostFontBlobsReady = true;
    try {
      const items = collectHostFontUrls();
      if (!items.length) return;
      const blobs: { family: string; blobUrl: string }[] = [];
      for (const it of items) {
        try {
          const res = await fetch(it.url);
          if (!res.ok) continue;
          const blob = await res.blob();
          blobs.push({ family: it.family, blobUrl: URL.createObjectURL(blob) });
        } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · prepareHostFontBlobs", "debug"); }
      }
      if (blobs.length) {
        hostFontBlobs = blobs;
        applyStyles(); // blob 就绪后立即重刷 iframe 样式
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · prepareHostFontBlobs", "debug"); }
  }
  const FONT_ACCEPT = ".ttf,.otf,.woff,.woff2";

  // 搜索状态
  let searchQuery = "";
  let searching = false;
  /** 单条搜索结果（含章节标签与进度，用于结果列表展示与跳转） */
  interface SearchHit {
    cfi: string;
    cfis: string[];
    excerpt: string;
    chapterLabel: string;
    progressPercent: number;
  }
  let searchResults: SearchHit[] = [];
  let searchIndex = -1;
  /** 搜索范围：全书 / 当前章（2026-08-29） */
  let searchScope: "book" | "chapter" = "book";
  let searchCaseSensitive = false;
  let searchWholeWord = false;
  /** 当前章节索引（relocate 事件驱动，用于「当前章」范围搜索） */
  let currentSectionIndex = -1;
  let searchDebounce: any = null;

  // 进度条拖动
  let dragging = false;

  let saveTimer: any = null;
  // 开书后延迟重绑内容文档的定时器（须在 onDestroy 取消，避免组件销毁后仍重绑到已死的 doc）
  let attachTimer1: any = null;
  let attachTimer2: any = null;
  function scheduleProgressSave(p: any) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (bookId) store.saveProgress(bookId, p).catch(() => {});
    }, 600);
  }

  /** 读取思源笔记实际 CSS 变量（用于「跟随思源」主题的背景/文字色同步） */
  function getSiyuanVar(name: string, fallback: string): string {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * 阅读器主题解析。
   * - custom：用自定义色
   * - auto（跟随思源）：实时读取思源笔记的 data-theme-mode + 实际 CSS 变量
   *   · 浅色 → 白色背景（#ffffff）+ 思源 --b3-theme-on-background 文字色
   *   · 深色 → 纯黑背景（#000000，用户指定）+ 思源 --b3-theme-on-background 文字色
   *   背景/文字与思源笔记视觉无缝同步；切换由 MutationObserver（startThemeObserver）触发重刷。
   */
  function themeOf(): { bg: string; fg: string; fg2: string } {
    if (settings.theme === "custom") {
      return {
        bg: settings.customBg || "#ffffff",
        fg: settings.customFg || "#222222",
        fg2: "inherit",
      };
    }
    // auto 模式：跟随思源主题（实时读取思源实际样式变量）
    if (settings.theme === "auto") {
      const dark = siyuanThemeMode === "dark";
      if (dark) {
        return {
          bg: "#000000", // 深色素黑（用户指定）
          fg: getSiyuanVar("--b3-theme-on-background", "#e0e0e0"),
          fg2: getSiyuanVar("--b3-theme-on-surface", "#9aa0a6"),
        };
      }
      return {
        bg: "#ffffff", // 浅色白底（用户指定）
        fg: getSiyuanVar("--b3-theme-on-background", "#222222"),
        fg2: getSiyuanVar("--b3-theme-on-surface", "#888888"),
      };
    }
    return THEME_PRESETS[settings.theme];
  }

  /** 检测思源当前主题模式（读取 <html data-theme-mode>） */
  function detectSiyuanTheme(): "light" | "dark" {
    try {
      const mode = document.documentElement.getAttribute("data-theme-mode");
      return mode === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  /** 启动 MutationObserver 监听思源主题切换（data-theme-mode 变化时自动重刷阅读器样式） */
  function startThemeObserver() {
    stopThemeObserver();
    siyuanThemeMode = detectSiyuanTheme();
    themeObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "data-theme-mode") {
          const newMode = detectSiyuanTheme();
          if (newMode !== siyuanThemeMode) {
            siyuanThemeMode = newMode;
            if (settings.theme === "auto") applyStyles();
          }
          break;
        }
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-mode"] });
  }

  function stopThemeObserver() {
    themeObserver?.disconnect();
    themeObserver = null;
  }

  /**
   * 字体注入：返回 { @font-face CSS, body font-family 栈 }
   * 单一职责：让 buildReaderStyles 输出**只有一处** body font-family 声明。
   *
   * 模式：
   * - system  ：仅 CJK fallback（让 epub 默认字体走跨平台栈）
   * - custom  ：用户自定义字体 + CJK fallback
   * - follow-siyuan：宿主 @font-face（@霞鹜文楷 等）+ 宿主字体栈 + CJK fallback
   *
   * 2026-08-23 修复（乱码根治 + 跟随思源字体，方案 A/C 合并）：
   * - 原实现在 follow-siyuan 把宿主栈放最前（`${hostStack}, ${cjkFallback}`）。
   *   若宿主栈含无效字体（跨域/CDN 加载失败、local() 不命中的主题字体名），
   *   阅读器 iframe 会整链崩坏 → 汉字无字形 → 方块/残缺/乱码。
   * - 方案 A：跨平台 CJK 本机栈前置兜底。但此方案把宿主字体（霞鹜文楷）压到后面，
   *   导致正文字体无法跟随思源「霞鹜文楷」设置。
   * - 方案 C（本实现采用）：宿主字体栈（含霞鹜文楷）前置，CJK 本机栈做兜底，
   *   sans-serif 永远最后。宿主字体可用时即被选中（跟随思源设置）；不可用时浏览器
   *   自动回退到 CJK 本机栈（PingFang SC / 微软雅黑 等装机必有），不会乱码。
   * - 配套改动：inlineOverrideStyles 同步温和化（不再用 font-family: inherit 压制 epub
   *   内联字体），见 reader-style.ts。
   */
  function buildFontInjection(): { fontFaceCss: string; fontFamilyStack: string } {
    const cjkFallback = getDefaultCjkFontStack();
    if (settings.fontMode === "system") {
      // system：仅 CJK fallback 兜底（不注入 @font-face，不接管 epub 默认字体栈）
      return { fontFaceCss: "", fontFamilyStack: `${cjkFallback}, sans-serif` };
    }
    if (settings.fontMode === "classified") {
      // 2026-08-28 分类字体（Readest 同款三条链）：
      // - @font-face：注入宿主 blob 字体，让「霞鹜文楷」等思源插件加载的网页字体
      //   在 iframe 内真正可用（否则只命中本机已装字体，未装则 fallback）。
      // - font-family 三条链由 buildReaderStyles 内部构建并输出 CSS 变量，
      //   此处返回的栈仅作兜底（正文链，供双语译文等同源消费）。
      const blobFaces = hostFontBlobs
        .map(
          (b) =>
            `@font-face{font-family:"${b.family}";src:url("${b.blobUrl}");font-display:swap;}`
        )
        .join("\n");
      const lists = buildFontFamilyLists(
        settings.serifFont ?? "",
        settings.sansSerifFont ?? "",
        settings.monospaceFont ?? "",
        settings.defaultCJKFont ?? ""
      );
      const stack =
        settings.defaultFontFamily === "sans-serif" ? lists.sansSerif : lists.serif;
      return { fontFaceCss: blobFaces, fontFamilyStack: stack };
    }
    if (settings.fontMode === "custom") {
      if (!settings.customFontId || !fontBlobUrl) {
        // 自定义字体未就绪 → 走 follow-siyuan 兜底
      } else {
        const f = fontStore.get(settings.customFontId);
        if (f) {
          const faceCss = customFontFaceCss(f, fontBlobUrl);
          const stack = `"${f.name}", ${cjkFallback}, sans-serif`;
          return { fontFaceCss: faceCss, fontFamilyStack: stack };
        }
      }
    }
    // follow-siyuan：宿主 @font-face（blob 真实字体文件 + local() fallback）注入，
    // 字体栈把宿主栈（含霞鹜文楷）前置，CJK 本机栈兜底 —— 跟随思源字体设置且不会乱码。
    const faces = collectHostFontFaces();
    const hostStack = getHostFontStack();
    // 问题 2：blob 化的宿主字体 @font-face（真实字体文件，iframe 可加载）优先，
    // 未 blob 化的 local() fallback 兜底（命中本机已装字体）。
    const blobFaces = hostFontBlobs
      .map(
        (b) =>
          `@font-face{font-family:"${b.family}";src:url("${b.blobUrl}");font-display:swap;}`
      )
      .join("\n");
    const fontFaceCss =
      (blobFaces ? blobFaces + "\n" : "") + (faces.length ? faces.join("\n") + "\n" : "");
    // 关键改动：宿主字体栈（含霞鹜文楷）前置，CJK 本机栈做兜底，sans-serif 永远最后。
    // 这样正文字体跟随思源「霞鹜文楷」设置；若宿主字体不可用，浏览器自动回退到
    // CJK 本机栈（PingFang SC / 微软雅黑 等装机必有），不会无字形/乱码。
    const hostHead = hostStack
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
    const stack = `${hostHead}${cjkFallback ? ", " + cjkFallback : ""}, sans-serif`;
    return { fontFaceCss, fontFamilyStack: stack };
  }

  function buildStyles() {
    const t = themeOf();
    const lw = LINE_WIDTH_PRESETS[settings.lineWidth];
    // 委托给 reader-style.ts 纯函数，便于单测与维护
    // 字号（含 overrideBookFontSize 压平书籍字号）由 fontSizeOverrideStyles 段统一输出（2026-08-27 修复字号无效）
    const { fontFaceCss, fontFamilyStack } = buildFontInjection();
    return buildReaderStyles(
      settings,
      t,
      lw,
      fontFaceCss,
      fontFamilyStack
    );
  }

  function applyStyles() {
    // 跟随思源文档边距：开时把宿主 .protyle-wysiwyg 的水平 padding 同步为阅读器左右边距
    applySiyuanDocMargin();
    if (view?.renderer?.setStyles) {
      try {
        view.renderer.setStyles(buildStyles());
      } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · applyStyles", "debug"); }
    }
    // 同步容器兜底背景（深色模式切换时避免透出旧色/黑底闪屏）
    applyContainerBg();
    // 分类字体：样式注入后再重写 EPUB 内联关键词
    // （需等 --reword-* 变量真正落到内容文档，故推迟到下一帧）
    if (settings.fontMode === "classified") {
      requestAnimationFrame(() => applyFontKeywordRewrite());
    }
  }

  /** 给阅读容器设置与主题一致的兜底背景，避免 iframe 渲染前/透明时透出黑底（黑底闪屏根因之一） */
  function applyContainerBg() {
    const bg = themeOf().bg;
    if (container) container.style.background = bg;
  }

  // 2026-08-27 晚（P2.2 专注模式）：滚动时高亮视口中心段落、其余淡出
  let focusScrollRaf: any = null;
  function onFocusScroll(doc: Document) {
    if (!(settings.focusMode && settings.flow === "scrolled")) return;
    if (focusScrollRaf) return;
    focusScrollRaf = requestAnimationFrame(() => {
      focusScrollRaf = null;
      highlightCenterParagraph(doc);
    });
  }
  /** 找视口垂直中心附近的 <p>/<li>/<blockquote>，给它加 .in-center（其余移除） */
  function highlightCenterParagraph(doc: Document) {
    const win = doc.defaultView;
    if (!win) return;
    const midY = win.innerHeight / 2;
    const paras = doc.querySelectorAll("p, li, blockquote");
    let best: Element | null = null;
    let bestDist = Infinity;
    for (const p of Array.from(paras)) {
      const r = (p as Element).getBoundingClientRect();
      if (r.bottom < 0 || r.top > win.innerHeight) continue; // 视口外跳过
      const c = r.top + r.height / 2;
      const d = Math.abs(c - midY);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    for (const p of Array.from(paras)) p.classList.remove("in-center");
    if (best) best.classList.add("in-center");
  }
  /** 应用专注模式：给已挂载内容文档的 body 加/去 .reword-focus，并立即高亮一次 */
  function applyFocusMode() {
    if (!view?.renderer?.getContents) return;
    let contents: any[] = [];
    try { contents = view.renderer.getContents() || []; } catch { return; }
    const on = settings.focusMode && settings.flow === "scrolled";
    for (const c of contents) {
      const doc: Document | undefined = c?.doc;
      if (!doc?.body) continue;
      if (on) {
        doc.body.classList.add("reword-focus");
        highlightCenterParagraph(doc);
      } else {
        doc.body.classList.remove("reword-focus");
        doc.querySelectorAll(".in-center").forEach((el: Element) => el.classList.remove("in-center"));
      }
    }
  }

  /** 段落悬停高亮（2026-08-28 C2）：给已挂载内容文档 body 加/去 .reword-p-hover */
  function applyParagraphHover() {
    if (!view?.renderer?.getContents) return;
    let contents: any[] = [];
    try { contents = view.renderer.getContents() || []; } catch { return; }
    for (const c of contents) {
      const doc: Document | undefined = c?.doc;
      if (!doc?.body) continue;
      if (settings.paragraphHover) doc.body.classList.add("reword-p-hover");
      else doc.body.classList.remove("reword-p-hover");
    }
  }

  /**
   * 分类字体关键词重写（2026-08-28，Readest 同款）：
   * 把 EPUB 作者样式表里的 serif / sans-serif / monospace 关键词替换成
   * --reword-* CSS 变量，让标题、各类 class 段落也走用户选的字体链。
   *
   * 只在 fontMode=classified 时执行；全部异常已被下游 try-catch 吞掉，
   * 最坏情况退化为「分类字体部分生效」，不影响阅读。
   *
   * 注意：foliate 翻页会重建内容文档 → 需在 relocate 后重复调用（见 handleRelocate 侧）。
   * @returns 被改写的规则条数（调试用）
   */
  function applyFontKeywordRewrite(): number {
    if (settings.fontMode !== "classified") return 0;
    if (!view?.renderer?.getContents) return 0;
    try {
      return rewriteFontKeywordsInAllContents(() => view.renderer.getContents());
    } catch {
      return 0;
    }
  }

  function applyFlow() {
    if (view?.renderer?.setAttribute) {
      try {
        view.renderer.setAttribute("flow", settings.flow);
        // 模式切换后回到当前进度（foliate 重排可能复位到开头）
        if (progress > 0) {
          setTimeout(() => {
            try {
              view.goToFraction(progress);
            } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · applyFlow", "debug"); }
          }, 60);
        }
      } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · applyFlow", "debug"); }
    }
  }

  function applyTurnStyle() {
    if (view?.renderer?.setAttribute) {
      try {
        view.renderer.setAttribute("turn-style", settings.turnStyle === "default" ? "" : settings.turnStyle);
      } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · applyTurnStyle", "debug"); }
    }
  }

  // [REword patch 2026-08-29] PDF 显示设置（spread / scroll-direction / 反色）
  // 仅 PDF 生效；对比「渲染器当前属性」判断是否需应用，避免无关设置变更时重建展开 / 重渲染。
  function applyPdfViewMode() {
    if (!isPdfBook() || !view?.renderer?.setAttribute) return
    const mode = settings.pdfViewMode ?? "single"
    const spread = mode === "double" ? "both" : mode === "book" ? "portrait" : "none"
    if (view.renderer.getAttribute("spread") === spread) return
    try { view.renderer.setAttribute("spread", spread) } catch (__e) { logSwallow(__e, "applyPdfViewMode", "debug") }
  }

  function applyPdfScrollDir() {
    if (!isPdfBook() || !view?.renderer?.setAttribute) return
    if (settings.flow !== "scrolled") return
    const dir = settings.pdfScrollDir ?? "vertical"
    if (view.renderer.getAttribute("scroll-direction") === dir) return
    try { view.renderer.setAttribute("scroll-direction", dir) } catch (__e) { logSwallow(__e, "applyPdfScrollDir", "debug") }
  }

  // 触发 foliate 重渲染当前页：pageColors 在 onZoom 时读取，setter 本身不重渲染。
  // 重设 zoom 属性可触发 attributeChangedCallback 无条件 #render()（见 fixed-layout.js:429）。
  function rerenderPdfPages() {
    if (!isPdfBook() || !view?.renderer) return
    try {
      const r = view.renderer as any
      const cur = r.getAttribute("zoom")
      if (cur != null) r.setAttribute("zoom", cur)
    } catch (__e) { logSwallow(__e, "rerenderPdfPages", "debug") }
  }

  function applyPdfInvert() {
    if (!isPdfBook() || !view?.renderer) return
    const want = !!settings.pdfInvert
    const r = view.renderer as any
    const prev = r._rewordPdfInvert ?? false
    if (prev === want) return
    r._rewordPdfInvert = want
    try {
      r.pageColors = want ? { background: "#000000", foreground: "#ffffff" } : {}
    } catch (__e) { logSwallow(__e, "applyPdfInvert set", "debug") }
    rerenderPdfPages()
  }

  function fmtPct(frac: number): string {
    if (!isFinite(frac)) return "";
    const p = Math.round(frac * 100);
    return p > 100 ? "100%" : `${p}%`;
  }

  /* ================= 翻页交互（注入 iframe 内 doc） ================= */

  /** 点击正文分区翻页（仅 clickToTurn 开启时启用）。带双击保护：两次 mousedown <300ms 视为双击 → 取消翻页判定；选词/拖选/链接点击不翻页 */
  function setupZoneClick(doc: Document) {
    if (!view) return;
    // 2026-08-29 Phase 1：触屏设备统一走下方 touch 手势处理器（滑/点/捏合），
    //   避免触摸合成的 mouse 事件与 touch 处理器双触发导致连翻两页。
    if (isTouchDevice()) return;
    let downT = 0;
    let downX = 0;
    let downY = 0;
    let dragged = false;
    let lastDownT = 0;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // 双击检测：与上次 mousedown 间隔 < 300ms → 判定为双击（选词），本次不参与翻页
      const now = Date.now();
      if (now - lastDownT < 300) {
        dragged = true; // 屏蔽本次 mouseup 的翻页判定
      }
      lastDownT = now;
      downT = now;
      downX = e.clientX;
      downY = e.clientY;
      dragged = dragged;
    };
    const onMouseMove = () => {
      dragged = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (Date.now() - downT > 600) return;
      if (dragged) return;
      // 选词（collapsed 误报兼容）：选区文本非空也视为「有选择」
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed) return;
      if (typeof sel?.toString === "function" && sel.toString().trim()) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("a")) return;
      const w = doc.documentElement.clientWidth;
      if (w <= 0) return;
      const x = e.clientX;
      if (x < w * 0.33) void view.goLeft();
      else if (x > w * 0.67) void view.goRight();
    };
    trackDocListener(doc, "mousedown", onMouseDown);
    trackDocListener(doc, "mousemove", onMouseMove);
    trackDocListener(doc, "mouseup", onMouseUp);
  }

  function injectPageTurn(doc: Document, s?: ReaderSettings) {
    if (!view) return;
    const eff = s ?? settings;
    // 2026-08-27：Option+悬浮取词（英文）注入（与翻页/快捷键同文档挂载，统一由 trackDocListener 登记移除）
    setupHoverLookup(doc);
    // 可配置的点击分区翻页（默认关闭，防误触）
    if (eff.clickToTurn) {
      setupZoneClick(doc);
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key;
      // 2026-08-27（revised）：⌘E / Ctrl+E 不再自研浮层，改为转发给父窗口，
      // 让思源原生「最近打开文档」切换器接管（焦点在 iframe 正文时父文档收不到按键）。
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "e") {
        e.preventDefault();
        forwardKeyToParent(e);
        return;
      }
      // 2026-08-28：Ctrl/Cmd+T 触发连续朗读（从选区或当前位置）
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "t") {
        e.preventDefault();
        ttsTogglePlay();
        return;
      }
      // F3 / Cmd+F：iframe 内按键不冒泡出主文档，需在 iframe 内自行响应
      if (k === "F3" || ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "f")) {
        e.preventDefault();
        showSearch = true;
        showSettings = false;
        showToc = false;
        setTimeout(() => {
          try {
            searchInput?.focus();
          } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · onKeyDown", "debug"); }
        }, 30);
        return;
      }
      // 2026-08-29 修复：方向键翻页失效
      // 原方向键处理只在 iframe doc 内（focus 在 iframe 时才响应），
      // 焦点漂移到工具栏 / 批注 / 搜索框后失效。已在 onGlobalKey 顶层统一处理（capture 阶段挂 main document），
      // iframe 内这里继续保留以防边缘场景，但所有翻页键加 stopPropagation 防止重复翻页。
      if (k === "PageDown") {
        e.preventDefault();
        e.stopPropagation();
        void view.goRight();
      } else if (k === "PageUp") {
        e.preventDefault();
        e.stopPropagation();
        void view.goLeft();
      } else if (k === "ArrowRight") {
        if (eff.flow !== "scrolled") {
          e.preventDefault();
          e.stopPropagation();
          void view.goRight();
        }
      } else if (k === "ArrowLeft") {
        if (eff.flow !== "scrolled") {
          e.preventDefault();
          e.stopPropagation();
          void view.goLeft();
        }
      } else if (k === " ") {
        // 2026-08-28：TTS 播放中 Space = 暂停/继续（与 Readest 一致）；停止时 Space = 翻页
        if (ttsState === "playing" || ttsState === "paused") {
          e.preventDefault();
          ttsTogglePlay();
          return;
        }
        // 空格翻页仅在分页模式；滚动模式下空格不应翻页（避免点内容后误翻）
        if (eff.flow !== "scrolled") {
          e.preventDefault();
          e.stopPropagation();
          void view.goRight();
        }
      } else if (k === "Home") {
        e.preventDefault();
        e.stopPropagation();
        void view.goToTextStart();
      } else if (k === "End") {
        e.preventDefault();
        e.stopPropagation();
        void view.goTo(view.book?.sections?.length ? view.book.sections.length - 1 : 0);
      }
    };
    trackDocListener(doc, "keydown", onKeyDown);

    // 2026-08-29 Phase 1：触摸手势导航（仅触屏设备生效；桌面走键盘/点击分区）
    if (!isTouchDevice()) return;
    let touchX = 0;
    let touchY = 0;
    let touchT = 0;
    // 双指捏合缩放状态
    let pinchDist0 = 0;
    let pinchFont0 = 0;
    const PINCH_FONT_MIN = 12;
    const PINCH_FONT_MAX = 40;

    // [REword patch 2026-08-29] Phase 2 触屏手势增强
    // double-tap 检测（iOS Safari iframe dblclick 不稳定，手动 touchstart 检测）
    let lastTapT = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    const DOUBLE_TAP_INTERVAL = 300;  // ms
    const DOUBLE_TAP_DIST = 24;       // px

    // 长按 500ms 弹菜单（查词/批注/翻译）
    let longPressTimer: any = null;
    let longPressStartX = 0;
    let longPressStartY = 0;
    const LONG_PRESS_MS = 500;
    const LONG_PRESS_MOVE_THRESHOLD = 12;  // px

    const touchDist = (e: TouchEvent): number => {
      if (e.touches.length < 2) return 0;
      const a = e.touches[0];
      const b = e.touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchX = t.clientX;
        touchY = t.clientY;
        touchT = Date.now();
        // [REword patch 2026-08-29] Phase 2 长按检测启动
        // 500ms 静止触发长按弹菜单（仅单指）
        longPressStartX = t.clientX;
        longPressStartY = t.clientY;
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          // [REword patch 2026-08-29] Phase 2 长按 500ms
          // 已有选区 → 触发划词流程（mouseup 走 onContentMouseUp → selToolbar 弹出）
          // 无选区 → 让系统默认长按选词菜单处理（iOS Safari / Android Chrome 自带）
          try {
            const sel = doc.getSelection?.();
            const text = sel && typeof sel.toString === "function" ? sel.toString().trim() : "";
            if (text && sel && !sel.isCollapsed) {
              // 模拟 mouseup 事件触发 selToolbar
              // 实际上 foliate 触屏的 mouseup 会被合成，这里直接用 selectionchange 已有路径
              // 触发条件：选区非折叠且有内容
              // selToolbar 通过 selectionchange 自动显示（已有逻辑）
              // 长按此处的作用是"延长选区停留时间"让 selectionchange 完成
              // 不需要额外动作
            }
            // 无选区：让浏览器原生长按选词菜单弹出
            // iOS Safari: long-press 触发 system selection toolbar
            // Android Chrome: long-press 触发 text selection magnifier
          } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · longPress", "debug"); }
        }, LONG_PRESS_MS);
      } else if (e.touches.length === 2) {
        // 记录捏合初值（仅记录，不在 start 改变字号）
        pinchDist0 = touchDist(e);
        pinchFont0 = settings.fontSize;
        // 多指触摸取消长按
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      } else {
        // 3+ 指：取消长按
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      }
    };
    trackDocListener(doc, "touchstart", onTouchStart, { passive: true });

    const onTouchMove = (e: TouchEvent) => {
      // 双指捏合：实时缩放字号，并阻止系统缩放/滚动
      if (e.touches.length === 2 && pinchDist0 > 0) {
        e.preventDefault();
        const d = touchDist(e);
        if (d > 0) {
          const ratio = d / pinchDist0;
          setFontSizeLive(Math.min(PINCH_FONT_MAX, Math.max(PINCH_FONT_MIN, pinchFont0 * ratio)));
        }
        // 移动超过阈值取消长按
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        return;
      }
      // 单指移动超过阈值取消长按
      if (longPressTimer && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - longPressStartX;
        const dy = t.clientY - longPressStartY;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_THRESHOLD) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
    };
    trackDocListener(doc, "touchmove", onTouchMove, { passive: false });

    const onTouchEnd = (e: TouchEvent) => {
      // 仍有手指按着（如捏合收尾过渡）不处理
      if (e.touches.length > 0) return;
      // 取消长按定时器（松手 = 不再触发）
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      // 捏合结束：复位，字号已由 move 实时写入（store 落盘）
      if (pinchDist0 > 0) {
        pinchDist0 = 0;
        return;
      }
      const c = e.changedTouches[0];
      if (!c) return;
      const dx = c.clientX - touchX;
      const dy = c.clientY - touchY;
      const dt = Date.now() - touchT;
      // [REword patch 2026-08-29] Phase 2 double-tap 检测
      // iOS Safari 的 dblclick 在 foliate iframe 内不稳定（容易和 mousedown 冲突），
      // 这里手动用 touchstart + 时间/距离判定模拟 dblclick。
      if (dt < DOUBLE_TAP_INTERVAL && Math.abs(dx) < DOUBLE_TAP_DIST && Math.abs(dy) < DOUBLE_TAP_DIST) {
        // 是 double-tap？
        const now = Date.now();
        if (now - lastTapT < DOUBLE_TAP_INTERVAL &&
            Math.abs(c.clientX - lastTapX) < DOUBLE_TAP_DIST &&
            Math.abs(c.clientY - lastTapY) < DOUBLE_TAP_DIST) {
          // double-tap 确认 → 触发缩放 toggle（仅 PDF）
          if (isPdfBook()) {
            try { onDblClickToggleZoom(); } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · double-tap", "debug"); }
          }
          lastTapT = 0;  // 重置（避免三连击触发两次）
          return;
        }
        // 第一次 tap：记录
        lastTapT = now;
        lastTapX = c.clientX;
        lastTapY = c.clientY;
        // delay 一下返回（让第二次 tap 有机会进 if 块）
      } else {
        lastTapT = 0;  // 距离/时间超 → 重置
      }
      // 横滑翻页（横向位移为主且超过阈值）
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) void view.goRight();
        else void view.goLeft();
        return;
      }
      // 点按：短时长 + 几乎无位移 → 分区判定
      if (dt < 350 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
        // 排除文本选区（用户可能在选词，不应翻页/切工具栏）
        const sel = doc.getSelection();
        if (sel && !sel.isCollapsed) return;
        if (typeof sel?.toString === "function" && sel.toString().trim()) return;
        const w = doc.documentElement.clientWidth;
        if (w <= 0) return;
        const x = c.clientX;
        if (x < w * 0.33) void view.goLeft();
        else if (x > w * 0.67) void view.goRight();
        else toggleToolbar(); // 中心点击：唤起/隐藏工具栏（Readest 式沉浸阅读）
      }
    };
    trackDocListener(doc, "touchend", onTouchEnd, { passive: true });
  }

  /* ================= Option+悬浮取词（英文，2026-08-27） ================= */
  // 仅在 foliate 正文 iframe 内、按住 Option(altKey) 时，用 caretRangeFromPoint 取光标所在英文单词，
  // 复用现有离线词典引擎 + 富词卡弹窗。松开 Option / 光标离开单词（未落在弹窗上）→ 收起。

  /** 判断视口坐标是否落在当前词典弹窗内（让用户能把鼠标移进弹窗点 ★ / 候选词） */
  function isOverDictPopup(x: number, y: number): boolean {
    if (!dictPopupEl) return false;
    const r = dictPopupEl.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function clearHoverHide() {
    if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }
  }

  /** 延迟收起悬浮弹窗（给光标移到弹窗留缓冲；2026-08-27 放宽至 450ms 提升稳定性） */
  function scheduleHoverHide(delay = 450) {
    clearHoverHide();
    hoverHideTimer = setTimeout(() => {
      hoverHideTimer = null;
      if (dictPopupSource === "hover") {
        dictPopup = { ...dictPopup, visible: false };
        dictPopupSource = null;
        hoverWord = null;
      }
    }, delay);
  }

  /** 显示悬浮词典弹窗（英文单词） */
  function showHoverDict(word: string, x: number, y: number) {
    clearHoverHide();
    hoverWord = word;
    dictPopupSource = "hover";
    dictPopup = { visible: true, x, y, html: renderLoading(), word, source: "hover" };
    setTimeout(() => {
      // 期间来源/单词已切换则丢弃旧结果
      if (dictPopupSource !== "hover" || hoverWord !== word) return;
      const entry = lookupSmart(word);
      let html: string;
      if (entry) {
        html = renderDictCard(parseDictEntry(entry), { showStar: true, inVocab: isInVocab?.(word) ?? false });
      } else {
        const cands = searchCandidates(word, 3);
        html = renderDictSuggestions(word, cands);
      }
      dictPopup = { ...dictPopup, html };
    }, 30);
  }

  function setupHoverLookup(doc: Document) {
    if (!view) return;
    const WORD_RE = /^[A-Za-z][A-Za-z'’-]*$/;
    const getWordAt = (cx: number, cy: number): { word: string; rect: DOMRect } | null => {
      let range: Range | null = null;
      try {
        const anyDoc = doc as any;
        if (typeof anyDoc.caretRangeFromPoint === "function") {
          range = anyDoc.caretRangeFromPoint(cx, cy) as Range;
        } else if (typeof anyDoc.caretPositionFromPoint === "function") {
          const pos = anyDoc.caretPositionFromPoint(cx, cy) as any;
          if (pos && pos.offsetNode) {
            range = doc.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
          }
        }
      } catch {
        return null;
      }
      if (!range || range.startContainer.nodeType !== 3) return null;
      const node = range.startContainer as Text;
      const text = node.data;
      let start = range.startOffset;
      let end = range.startOffset;
      while (start > 0 && /[A-Za-z'’-]/.test(text[start - 1])) start--;
      while (end < text.length && /[A-Za-z'’-]/.test(text[end])) end++;
      if (start >= end) return null;
      const word = text.slice(start, end);
      if (!WORD_RE.test(word)) return null;
      const r = doc.createRange();
      r.setStart(node, start);
      r.setEnd(node, end);
      const rect = r.getBoundingClientRect() as DOMRect;
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;
      return { word, rect };
    };

    const onMove = (e: MouseEvent) => {
      // iframe 内部 clientX/Y 是相对 iframe 视口的坐标，需加 frame 偏移换算成视口坐标，
      // 才能与父窗口弹窗 rect（getBoundingClientRect 返回视口坐标）正确比对 —— 否则
      // 移到弹窗途中 isOverDictPopup 恒为 false，弹窗被误判「未悬停」而提前收起。
      const frameEl = (doc.defaultView as any)?.frameElement as HTMLElement | null;
      const fr0 = frameEl?.getBoundingClientRect();
      const vx = e.clientX + (fr0?.left ?? 0);
      const vy = e.clientY + (fr0?.top ?? 0);
      if (!e.altKey) {
        // Option 释放：光标没落在弹窗上才宽限收起（落在弹窗上由 mouseenter 取消）
        if (dictPopupSource === "hover" && !isOverDictPopup(vx, vy)) {
          scheduleHoverHide();
        }
        return;
      }
      const found = getWordAt(e.clientX, e.clientY);
      if (!found) {
        // 2026-08-27 稳定性修复：光标离开单词但未落在弹窗上时不收起，让用户能把鼠标
        // 移到弹窗上阅读；只有 alt 释放，或离开弹窗（popup mouseleave）才收起。
        return;
      }
      // 同一单词且弹窗已显示：保持，取消待收起
      if (found.word === hoverWord && dictPopup.visible) {
        clearHoverHide();
        return;
      }
      // 计算弹窗定位（词下方居中）
      const frame = (doc.defaultView as any)?.frameElement as HTMLElement | null;
      let wx = found.rect.left + found.rect.width / 2;
      let wy = found.rect.bottom;
      if (frame) {
        const fr = frame.getBoundingClientRect();
        wx += fr.left;
        wy += fr.top;
      }
      const c = toContainerCoords(wx, wy + 4);
      let cx = c.x;
      let cy = c.y;
      // 左右防溢出（弹窗宽约 360，transform translateX(-50%) 以 cx 为中点）
      const stageW = readerStageEl?.clientWidth ?? readerViewEl?.clientWidth ?? 800;
      const half = Math.min(180, Math.max(20, stageW / 2 - 8));
      cx = Math.max(half, Math.min(stageW - half, cx));
      // 底部空间不足则翻到词上方（估计弹窗高度 ~320）
      const stageH = readerStageEl?.clientHeight ?? readerViewEl?.clientHeight ?? 600;
      if (cy + 320 > stageH) {
        let topVy = found.rect.top;
        if (frame) topVy += frame.getBoundingClientRect().top;
        const topC = toContainerCoords(found.rect.left + found.rect.width / 2, topVy - 8);
        cy = topC.y - 320;
        if (cy < 8) cy = 8;
      }
      showHoverDict(found.word, cx, cy);
    };

    trackDocListener(doc, "mousemove", onMove as EventListener);
    // 松开 Option：宽限收起（光标已在弹窗上则保留，由弹窗 mouseenter 取消收起）
    trackDocListener(doc, "keyup", ((e: KeyboardEvent) => {
      if (e.key === "Alt" && dictPopupSource === "hover" && !isOverDictPopup(e.clientX, e.clientY)) {
        scheduleHoverHide();
      }
    }) as EventListener);
    // 光标离开正文 iframe：若正落在弹窗上则保留（由 popup mouseenter 接管），否则宽限收起
    trackDocListener(doc, "mouseleave", ((ev: MouseEvent) => {
      if (dictPopupSource !== "hover") return;
      const frameEl = (doc.defaultView as any)?.frameElement as HTMLElement | null;
      const fr0 = frameEl?.getBoundingClientRect();
      const vx = ev.clientX + (fr0?.left ?? 0);
      const vy = ev.clientY + (fr0?.top ?? 0);
      if (!isOverDictPopup(vx, vy)) scheduleHoverHide();
    }) as EventListener);
  }

  /* ================= 打开书籍 ================= */

  async function openBook() {
    errorMsg = "";
    console.log("[REword] openBook 开始", { bookId });
    try {
      const blob = await store.getBlob(bookId);
      meta = store.get(bookId);
      if (!blob || !meta) throw new Error("书籍不存在或文件丢失");
      console.log("[REword] openBook blob 就绪", { size: blob.size, format: meta.format });
      title = meta.title;
      const name = `${meta.id}.${meta.format === "md" ? "md" : meta.format}`;
      const file = new File([blob], name, {
        type: /epub$/i.test(name) ? "application/epub+zip" : "",
      });
      container.innerHTML = "";
      const el = document.createElement("reword-foliate-view") as any;
      container.append(el);
      view = el;
      setupAnnotationLayer();
      console.log("[REword] openBook reword-foliate-view 已挂载", {
        containerH: container.clientHeight,
        containerW: container.clientWidth,
        viewTag: el.tagName,
      });

      view.addEventListener("relocate", (e: any) => {
        const d = e.detail;
        const frac = typeof d?.fraction === "number" ? d.fraction : 0;
        progress = frac;
        if (!dragging) progressText = fmtPct(frac);
        totalSections = view.book?.sections?.length ?? 0;
        chapterLabel = d?.tocItem?.label ?? (totalSections ? `第 ${(d?.index ?? 0) + 1}/${totalSections} 节` : "");
        currentSectionIndex = typeof d?.index === "number" ? d.index : currentSectionIndex;
        // 独立 Tab 模式：标题联动「书名 · 章节」
        if (onTitleChange) {
          onTitleChange(chapterLabel ? `${title} · ${chapterLabel}` : title);
        }
        const href = d?.tocItem?.href;
        if (typeof href === "string" && href) {
          activeHref = href;
          if (!visitedHrefs.has(href)) {
            visitedHrefs = new Set(visitedHrefs);
            visitedHrefs.add(href);
          }
          tocReadCount = visitedHrefs.size;
        }
        updateEta(frac);
        // [REword patch 2026-08-29] PDF 缩放状态一并保存
        const savePayload: any = { cfi: d?.cfi, fraction: frac };
        if (isPdfBook()) savePayload.zoom = currentZoom;
        scheduleProgressSave(savePayload);
        attachAllContentDocs();
        // 2026-08-28：滚动 / 跳转（relocate）也触发双语按需补译（内部 300ms 防抖）
        bilingualHandle?.onViewLoad();
      });

      view.addEventListener("load", (e: any) => {
        const doc = e.detail?.doc;
        if (doc) {
          // 用最新设置（用户可能在书架改过 clickToTurn/flow）
          attachAllContentDocs();
        }
        // 2026-08-27 重设计：翻页 / 加载新内容后，双语译文按需补注入
        bilingualHandle?.onViewLoad();
      });

      let book: any;
      if (isTextBookFile(name)) {
        book = await makeTextBook(file, meta.title);
        await view.open(book);
      } else {
        await view.open(file);
      }
      console.log("[REword] openBook view.open 完成");
      const saved = store.getProgress(bookId);
      if (saved?.fraction) {
        await view.init({ lastLocation: { fraction: saved.fraction }, showTextStart: false });
      } else {
        await view.init({ showTextStart: true });
      }
      console.log("[REword] openBook view.init 完成", {
        sections: view.book?.sections?.length ?? 0,
      });
      try {
        // foliate 的目录是属性 book.toc（嵌套树 [{label/title, href, subitems}]），
        // 不是方法 getTOC()；递归展开为带层级的扁平列表
        const toc = view.book?.toc;
        tocItems = flattenToc(Array.isArray(toc) ? toc : []);
        totalChars = Array.isArray(view.book?.sections)
          ? view.book.sections.reduce((s: number, x: any) => s + (x.size || 0), 0)
          : 0;
        computeChapterMarks();
      } catch {
        tocItems = [];
        chapterMarks = [];
      }
      settings = settingsStore.get();
      applyStyles();
      applyFlow();
      applyTurnStyle();
      // [REword patch 2026-08-29] PDF 显示设置（spread / scroll-direction / 反色）
      applyPdfViewMode();
      applyPdfScrollDir();
      applyPdfInvert();
      // [REword patch 2026-08-29] PDF 缩放：恢复保存的缩放状态
      // saved.zoom 是 per-file 持久化（ReadingProgress.zoom）
      if (isPdfBook()) {
        const savedZoom = store.getProgress(bookId)?.zoom;
        // [REword patch 2026-08-29] 移动端 PDF 适配 Phase 1
        // iPhone / Android Phone 降级模式：强制 fit-width（小屏 custom 缩放过小不可读）
        const initialZoom: ZoomState = isIphoneMode
          ? { kind: "fit-width" }
          : (savedZoom ?? { kind: "fit-page" });
        // 用 setTimeout 0 让 foliate-js 先完成初始渲染再 applyZoom，避免被首次 render 覆盖
        setTimeout(() => {
          applyZoom(initialZoom, { silent: true });
        }, 0);
      }
      // 问题 2：异步预热宿主字体 blob（完成后自动重刷 iframe 样式）
      prepareHostFontBlobs();
      try {
        view.renderer?.focusView?.();
      } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · try { view.renderer?.focusView?.(); }", "debug"); }
      opened = true;
      // [REword patch 2026-08-29] 确认是 PDF → 给页面四周留白区补上滚轮缩放监听
      if (isPdfBook()) bindStageWheel();
      attachAllContentDocs();
      attachTimer1 = setTimeout(attachAllContentDocs, 400);
      attachTimer2 = setTimeout(attachAllContentDocs, 1200);
    } catch (e: any) {
      console.error("[REword] openBook 失败:", e);
      // 错误分类 + 友好中文提示（2026-08-25 增强）
      const msg = String(e?.message || e || "").toLowerCase();
      if (msg.includes("unsupported") || msg.includes("format") || msg.includes("mobi") || msg.includes("azw")) {
        errorMsg = "该文件格式暂不支持，建议转换为 EPUB 格式后重试。";
      } else if (msg.includes("parse") || msg.includes("xml") || msg.includes("opf") || msg.includes("container")) {
        errorMsg = "书籍结构解析失败，文件可能已损坏或非标准 EPUB。";
      } else if (msg.includes("not found") || msg.includes("missing") || msg.includes("ENOENT")) {
        errorMsg = "文件未找到，可能已被移动或删除。请重新导入。";
      } else {
        errorMsg = e?.message || "打开失败，请检查文件格式是否正确。";
      }
    }
  }

  async function goToc(href: string) {
    if (!view) return;
    try {
      await view.goTo(href);
      showToc = false;
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · goToc", "debug"); }
  }

  /* ================= TOC 展开 / 阅读统计 ================= */

  /** foliate toc 是嵌套树，递归展开为扁平列表并记录层级 */
  function flattenToc(
    items: any[],
    level = 0,
    out: { title: string; href: string; level: number }[] = []
  ): { title: string; href: string; level: number }[] {
    if (!Array.isArray(items)) return out;
    for (const it of items) {
      if (!it) continue;
      if (it.href) out.push({ title: it.label ?? it.title ?? it.href, href: it.href, level });
      if (it.subitems?.length) flattenToc(it.subitems, level + 1, out);
    }
    return out;
  }

  /** 剩余阅读时间估算（全书字符 × 进度 → 剩余字符 ÷ 实测/默认速度） */
  function updateEta(frac: number) {
    if (!totalChars || !isFinite(frac)) {
      etaText = "";
      return;
    }
    const readChars = Math.min(totalChars, totalChars * Math.max(0, frac));
    const remain = totalChars - readChars;
    if (remain <= 0) {
      etaText = "已读完";
      return;
    }
    const minsRead = sessionReadMs / 60000;
    let speed = minsRead > 1 ? readChars / minsRead : 0; // chars/min 实测
    if (speed < 60) speed = 400; // 无实测数据时用默认速度
    const remainMin = remain / speed;
    if (remainMin < 1) {
      etaText = "即将读完";
    } else if (remainMin < 60) {
      etaText = `还剩 ~${Math.round(remainMin)} 分钟`;
    } else {
      const h = Math.floor(remainMin / 60);
      const m = Math.round(remainMin % 60);
      etaText = m ? `还剩 ~${h} 小时 ${m} 分钟` : `还剩 ~${h} 小时`;
    }
  }

  /** 阅读时长计时：每秒累加（页面隐藏时暂停），每 30s 落盘一次 */
  function startTimer() {
    lastTickAt = Date.now();
    timeTimer = setInterval(() => {
      const now = Date.now();
      if (!document.hidden) {
        sessionReadMs += now - lastTickAt;
        if (sessionReadMs >= 30000) {
          void store.addReadingTime(bookId, sessionReadMs);
          sessionReadMs = 0;
        }
      }
      lastTickAt = now;
    }, 1000);
  }

  /** 组件键盘快捷键：F3/Cmd+F 搜索（挂在组件容器上；多 Tab 时非激活 Tab 隐藏不响应）。
   *  ⌘E「最近打开文档」不再自研：焦点在父容器时由思源原生 handler 直接接管，
   *  焦点在 foliate iframe 正文时由 iframe 内 keydown 转发给父窗口（见 forwardKeyToParent）。 */
  function onGlobalKey(e: KeyboardEvent) {
    // 非激活 Tab 容器 display:none → offsetParent 为 null，不响应
    if (container?.offsetParent === null) return;
    // 跳过输入控件（保留 input / textarea / contenteditable 原生行为）
    const t = e.target as HTMLElement | null;
    if (t && t !== document.body && (
      t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.isContentEditable
    )) return;
    // 2026-08-29 修复：键盘方向键翻页失效
    // 原来方向键处理只绑在 iframe doc 上，焦点漂移到工具栏 / 批注 / 搜索框后失效。
    // 现在在 reader-view 顶层统一处理（capture 阶段注册，onMount 阶段挂到 main document），
    // 不管焦点在哪都能翻页。iframe 内的 onKeyDown 加 stopPropagation 避免重复翻页。
    if (e.key === "F3" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f")) {
      e.preventDefault();
      showSearch = true;
      showSettings = false;
      showToc = false;
      setTimeout(() => {
        try {
          searchInput?.focus();
        } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · onGlobalKey", "debug"); }
      }, 30);
      return;
    }
    if (e.key === "PageDown") {
      e.preventDefault();
      void view?.goRight?.();
      return;
    }
    if (e.key === "PageUp") {
      e.preventDefault();
      void view?.goLeft?.();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      void view?.goRight?.();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      void view?.goLeft?.();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      void view?.goRight?.();
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      void view?.goToTextStart?.();
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      try {
        const last = view?.book?.sections?.length
          ? view.book.sections.length - 1
          : 0;
        void view?.goTo?.(last);
      } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · onGlobalKey End", "debug"); }
      return;
    }
    // [REword patch 2026-08-29] PDF 缩放快捷键
    // Cmd/Ctrl + = / - / 0 / 1 / 2 / 3  跟 Obsidian PDF++ 风格一致
    // 注意：EPUB 模式下 Cmd+= / - 仍走 changeFont（保持现有字号快捷键不破坏）
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key;
      if (k === "=" || k === "+") {
        e.preventDefault();
        if (isPdfBook()) zoomIn();
        else changeFont(1);
        return;
      }
      if (k === "-" || k === "_") {
        e.preventDefault();
        if (isPdfBook()) zoomOut();
        else changeFont(-1);
        return;
      }
      if (k === "0") {
        if (isPdfBook()) {
          e.preventDefault();
          zoomReset();
          return;
        }
      }
      if (k === "1") {
        if (isPdfBook()) {
          e.preventDefault();
          fitWidth();
          return;
        }
      }
      if (k === "2") {
        if (isPdfBook()) {
          e.preventDefault();
          fitPage();
          return;
        }
      }
      if (k === "3") {
        if (isPdfBook()) {
          e.preventDefault();
          cycleZoomPreset();
          return;
        }
      }
      // ---- 2026-08-29：把 reader-shortcuts.ts 注册表里宣传、却从未接线的键位补上 ----
      // 注册表此前只用于「显示提示面板 + 冲突检测」，下面这些键在阅读器里没有任何处理。
      // 只接无歧义、不与思源全局快捷键抢的：⌘/Ctrl+B 书签（思源未占用）。
      // ⌘S/⌘T/⌘⇧L 仍留空 —— 与思源保存 / 浏览器新页签冲突，抢了会伤到用户既有习惯。
      if (k.toLowerCase() === "b") {
        e.preventDefault();
        void toggleCurrentBookmark();
        return;
      }
    }
    // F11 全屏（无修饰键，不在这个分支里判断 isPdfBook）
    if (e.key === "F11") {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    // Esc 关闭全部浮层（此前完全没有处理：开了目录/搜索只能再点一次按钮才能关）
    if (e.key === "Escape") {
      closeAllPopovers();
      return;
    }
  }

  /* ================= ⌘E 转发给思源原生「最近打开文档」 =================
   * 不自研浮层：焦点在 foliate iframe 正文时，keydown 不会冒泡到思源主窗口，
   * 故在此把 ⌘E/Ctrl+E 原样转发给父窗口（思源主文档），由思源原生快捷键接管。
   * 选中文档后思源自行为其新开 Tab，阅读 Tab 天然不被顶掉。 */

  function forwardKeyToParent(e: KeyboardEvent) {
    const pw = (window as any).parent;
    if (!pw || pw === window) return;
    const ne = new KeyboardEvent("keydown", {
      key: e.key,
      code: e.code,
      location: e.location,
      repeat: e.repeat,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      bubbles: true,
      cancelable: true,
    } as KeyboardEventInit);
    try { pw.document.dispatchEvent(ne); } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · forwardKeyToParent", "debug"); }
  }


  /* ================= 搜索 ================= */

  /** 把书摘片段里命中词高亮成 <mark>（先转义再包裹，防 XSS） */
  function escapeHtml(s: string): string {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function highlightExcerpt(text: string, q: string, caseSensitive: boolean): string {
    const safe = escapeHtml(text || "");
    const q2 = (q || "").trim();
    if (!q2) return safe;
    const esc = q2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(esc, caseSensitive ? "g" : "gi");
    return safe.replace(re, (m) => `<mark>${m}</mark>`);
  }

  /** 章节起始百分比（用于结果列表展示位置） */
  function sectionPercent(sectionIndex: number): number {
    const total = view?.book?.sections?.length ?? 0;
    if (!total) return 0;
    return Math.round((sectionIndex / total) * 100);
  }

  async function doSearch() {
    if (!view || !searchQuery.trim()) return;
    searching = true;
    searchResults = [];
    searchIndex = -1;
    try {
      const opts: any = {
        query: searchQuery.trim(),
        matchCase: searchCaseSensitive,
        matchWholeWords: searchWholeWord,
      };
      // 「当前章」范围：foliate 的 view.search({ index }) 只搜该 section
      if (searchScope === "chapter" && currentSectionIndex >= 0) {
        opts.index = currentSectionIndex;
      }
      const iter = view.search(opts);
      const flat: SearchHit[] = [];
      for await (const r of iter) {
        if (r === "done") break;
        if (r?.cfi) {
          // 单章搜索：结果直接是顶层 {cfi, excerpt}
          flat.push({
            cfi: r.cfi,
            cfis: r.cfis ?? [r.cfi],
            excerpt: r.excerpt ?? "",
            chapterLabel: chapterLabel,
            progressPercent: sectionPercent(currentSectionIndex),
          });
        } else if (r?.subitems) {
          // 全书搜索：结果嵌套在 subitems，且携带章节 label
          const label = r.label ?? "";
          const idx = typeof r.index === "number" ? r.index : -1;
          const pct = sectionPercent(idx);
          for (const sub of r.subitems) {
            if (!sub?.cfi) continue;
            flat.push({
              cfi: sub.cfi,
              cfis: sub.cfis ?? [sub.cfi],
              excerpt: sub.excerpt ?? "",
              chapterLabel: label,
              progressPercent: pct,
            });
          }
        }
      }
      searchResults = flat;
      searchIndex = flat.length ? 0 : -1;
      if (flat.length) await goSearchResultAt(0);
    } catch (e) {
      console.warn("[REword] 搜索失败:", e);
    } finally {
      searching = false;
    }
  }

  async function goSearchResultAt(i: number) {
    if (!searchResults.length) return;
    const idx = Math.max(0, Math.min(i, searchResults.length - 1));
    searchIndex = idx;
    try {
      await view.goTo(searchResults[idx].cfi);
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · goSearchResultAt", "debug"); }
  }

  async function goSearchResult(delta: number) {
    if (!searchResults.length) return;
    const i = ((searchIndex + delta) % searchResults.length + searchResults.length) % searchResults.length;
    await goSearchResultAt(i);
  }

  /** 输入即搜（防抖 300ms），空查询清空结果 */
  function onSearchInput() {
    if (!searchQuery.trim()) {
      searchResults = [];
      searchIndex = -1;
      if (searchDebounce) clearTimeout(searchDebounce);
      return;
    }
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => void doSearch(), 300);
  }

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (searchDebounce) clearTimeout(searchDebounce);
      void doSearch();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      void goSearchResult(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      void goSearchResult(-1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  }

  function startSearch() {
    void doSearch();
  }

  function closeSearch() {
    showSearch = false;
    clearSearch();
  }

  // 左右翻页箭头「按住连翻」状态
  let turnPressed: "" | "prev" | "next" = "";
  let turnTimer: any = null;
  let turnInterval: any = null;

  function turnPrev() {
    void view?.goLeft?.();
  }

  function turnNext() {
    void view?.goRight?.();
  }

  // [REword patch 2026-08-29] 首尾页直达（对齐 PDF++ 「转到第一页 / 最后」）
  function goFirstPage() {
    if (!view) return
    try { view.goTo(0) } catch (__e) { logSwallow(__e, "goFirstPage", "debug") }
  }

  function goLastPage() {
    if (!view) return
    try {
      const last = view.book?.sections?.length
        ? view.book.sections.length - 1
        : 0
      view.goTo(last)
    } catch (__e) { logSwallow(__e, "goLastPage", "debug") }
  }

  /** 箭头按下：立即翻一页 + 长按 450ms 后每 260ms 连翻 */
  function arrowDown(dir: "prev" | "next") {
    if (turnPressed && turnPressed !== dir) {
      // 已在连翻另一方向 → 切换方向时先停旧定时器
      stopArrowRepeat();
    }
    turnPressed = dir;
    if (dir === "prev") turnPrev();
    else turnNext();
    if (turnTimer) clearTimeout(turnTimer);
    turnTimer = setTimeout(() => {
      turnTimer = null;
      turnInterval = setInterval(() => {
        if (dir === "prev") turnPrev();
        else turnNext();
      }, 260);
    }, 450);
  }

  function stopArrowRepeat() {
    if (turnTimer) clearTimeout(turnTimer);
    turnTimer = null;
    if (turnInterval) clearInterval(turnInterval);
    turnInterval = null;
    turnPressed = "";
  }

  function toggleToc() {
    showToc = !showToc;
    showSearch = false;
    showSettings = false;
  }

  function toggleSettings() {
    showSettings = !showSettings;
    showSearch = false;
    showToc = false;
    // v1.3.0：打开设置时刷新本书 Token 累计显示
    if (showSettings) refreshBookTokenUsage();
    // 2026-08-28：打开设置时同步最新朗读设置（从持久化读入）
    if (showSettings) syncTtsCfg();
  }

  function clearSearch() {
    try {
      view?.clearSearch?.();
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · clearSearch", "debug"); }
    searchResults = [];
    searchIndex = -1;
    searchQuery = "";
  }

  function toggleSearch() {
    showSearch = !showSearch;
    if (showSearch) {
      showSettings = false;
      showToc = false;
    } else {
      clearSearch();
    }
  }

  /* ================= 书签 / 摘录汇总（2026-08-29 新增） =================
   * 对齐 Obsidian weave 的「书签 + 摘录笔记汇总」沉淀链，补上 REword 缺的中间一段：
   *  - 书签：按当前页 CFI 记录位置，可跳转 / 删除，存进书架索引随书持久化
   *  - 摘录：把 annStore 里本书的高亮 / 批注汇总成列表，可跳转原文 / 删除 / 批量导出 Markdown
   */

  /** 当前位置 CFI：foliate 每次 relocate 都会把 cfi 写进 view.lastLocation */
  function currentCfi(): string {
    return String(view?.lastLocation?.cfi ?? "");
  }

  function refreshBookmarks() {
    bookmarks = store?.getBookmarks?.(bookId) ?? [];
  }

  /** 从 annStore 重读本书摘录（按创建时间倒序；已软删的过滤掉） */
  function refreshAnnotsList() {
    if (!annStore) { try { annStore = getAnnotationStore(); } catch { annStore = null; } }
    if (!annStore || !bookId) { annotsList = []; return; }
    const list = (annStore.getByBook(bookId) || []).filter((it: any) => !it.deletedAt && it.cfi);
    list.sort((a: any, b: any) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    annotsList = list;
  }

  function closeOtherPanels(except: string) {
    if (except !== "bm") showBookmarks = false;
    if (except !== "ann") showAnnots = false;
    if (except !== "toc") showToc = false;
    if (except !== "search") showSearch = false;
    if (except !== "settings") showSettings = false;
  }

  function toggleBookmarkDrawer() {
    showBookmarks = !showBookmarks;
    if (showBookmarks) {
      closeOtherPanels("bm");
      refreshBookmarks();
    }
  }

  function toggleAnnots() {
    showAnnots = !showAnnots;
    if (showAnnots) {
      closeOtherPanels("ann");
      refreshAnnotsList();
    }
  }

  /** 在当前页加/删书签（同位置再点一次即移除） */
  async function toggleCurrentBookmark() {
    const cfi = currentCfi();
    if (!cfi) {
      toast("还拿不到当前位置，翻一页再试");
      return;
    }
    const res = await store.toggleBookmark(bookId, {
      cfi,
      label: chapterLabel || "",
      excerpt: (progressText || "").trim(),
    });
    bookmarks = res.list;
    toast(res.added ? "已添加书签" : "已移除书签");
  }

  async function jumpBookmark(bm: BookMark) {
    showBookmarks = false;
    try {
      await (view as any)?.goTo(bm.cfi);
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · jumpBookmark", "warn"); }
  }

  async function removeBookmark(bm: BookMark) {
    bookmarks = await store.removeBookmark(bookId, bm.id);
  }

  async function jumpAnnot(it: any) {
    if (!it?.cfi) return;
    showAnnots = false;
    try {
      await (view as any)?.goTo(it.cfi);
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · jumpAnnot", "warn"); }
  }

  async function removeAnnot(it: any) {
    await removeAnnotationById(it?.id ?? null, it?.cfi ?? "");
    refreshAnnotsList();
    toast("已删除");
  }

  /** 导出本书全部摘录为 Markdown（写入剪贴板，可直接粘贴进思源文档） */
  function exportAnnots() {
    if (!annotsList.length) {
      toast("本书还没有摘录");
      return;
    }
    const body = annotsList
      .map((it: any) => {
        const text = String(it.selectedText || it.sentence || "").trim();
        const note = String(it.note || "").trim();
        return [text ? `> ${text}` : "", note].filter(Boolean).join("\n\n");
      })
      .join("\n\n");
    const md = `# 《${title || "阅读"}》摘录\n\n${body}\n`;
    try {
      navigator.clipboard?.writeText(md);
      toast(`已导出 ${annotsList.length} 条摘录到剪贴板`);
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "ReaderView.svelte · exportAnnots", "warn");
      toast("导出失败，请检查剪贴板权限");
    }
  }

  /* ================= 设置操作 ================= */

  function changeFont(delta: number) {
    settings = settingsStore.update({ fontSize: Math.min(28, Math.max(12, settings.fontSize + delta)) });
    applyStyles();
  }

  /* ================= PDF 缩放（Phase 1） =================
   * foliate-js fixed-layout 已经原生支持 zoom + scale-factor attribute
   * （vendor/foliate-js/fixed-layout.js:204, 429-437），这里只是把状态管理 +
   * 快捷键 + 工具栏 + 持久化补齐。
   *
   * 缩放步进：按 ZOOM_PRESETS [0.5, 0.75, 1, 1.25, 1.5, 2] 找下一个/上一个档。
   * 默认 fit-page（foliate-js 原生默认）。
   */

  // 当前缩放状态（PDF only；EPUB 不会触发）
  let currentZoom: ZoomState = { kind: "fit-page" };
  // 上次 fit-width 之前的缩放（双击缩放切回用）
  let lastNonFitWidthZoom: ZoomState = { kind: "fit-page" };

  // [REword patch 2026-08-29] 移动端 PDF 适配 Phase 1
  // 设备分级（iPad / iPhone / Android Tablet / Android Phone / Desktop）
  let deviceClass: ReturnType<typeof getDeviceClass> = "desktop";
  // iPhone / Android Phone 降级模式（强制 fit-width + 工具栏底部 sheet）
  let isIphoneMode = false;

  function isPdfBook(): boolean {
    return meta?.format === "pdf";
  }

  // [REword patch 2026-08-29] 移动端 PDF 适配 Phase 1
  // 设备类 resize 监听（onMount 注册，onDestroy 注销）
  function onDeviceClassResize() {
    const newCls = getDeviceClass();
    if (newCls !== deviceClass) {
      deviceClass = newCls;
      isIphoneMode = isSmallMobile();
      // iPhone 模式切换时强制 fit-width（避免小屏上 custom 缩放过小）
      if (isIphoneMode && isPdfBook() && currentZoom.kind === "custom") {
        applyZoom({ kind: "fit-width" });
      }
    }
  }

  /* ================= Apple Pencil 墨迹批注（Phase 3） =================
   * PointerEvent 监听（绑到 readerViewEl 容器，main 文档级）
   * 仅在 PDF + ink 模式（draw / erase）下拦截 pen / touch pointer events
   * 普通 click / 划词 / 翻页不被影响
   */
  function getInkPointerContext(e: PointerEvent): { x: number; y: number; pressure: number; tiltX: number; tiltY: number } | null {
    // pointerType 限制：pen（Apple Pencil）/ touch（手指）才处理
    if (e.pointerType !== "pen" && e.pointerType !== "touch") return null;
    // 转换为 reader-stage 容器相对坐标（ink 渲染层坐标系）
    const stageEl = readerStageEl;
    if (!stageEl) return null;
    const rect = stageEl.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || 0.5,
      tiltX: (e as any).tiltX || 0,
      tiltY: (e as any).tiltY || 0,
    };
  }

  function onInkPointerDown(e: PointerEvent) {
    // 仅 PDF + ink 模式（非 off）
    if (!isPdfBook() || $inkState.mode === "off") return;
    const ctx = getInkPointerContext(e);
    if (!ctx) return;
    // 拦截（不让 foliate iframe 收到这个事件）
    e.preventDefault();
    e.stopPropagation();
    // 设置 ink 上下文（bookId + pageIndex）
    if (bookId) setInkContext(bookId, 0); // 简化：pageIndex 暂用 0，后续按 foliate 当前页
    // 橡皮模式：删最近的笔触
    if ($inkState.mode === "erase") {
      // 简化：删除最后一个笔触（实际可改成 hitTest 删命中的）
      // 这里先简单实现，后续 Phase 改进
      const lastStroke = $currentPageStrokes[$currentPageStrokes.length - 1];
      if (lastStroke) {
        inkStrokes.update((arr) => arr.filter((s) => s.id !== lastStroke.id));
      }
      return;
    }
    // 画模式：开始新笔触
    const points: InkPoint[] = [{
      x: ctx.x, y: ctx.y, pressure: ctx.pressure,
      t: e.timeStamp, tiltX: ctx.tiltX, tiltY: ctx.tiltY,
    }];
    // 倾斜 > 45° 自动变荧光笔
    const effectiveBrush = shouldUseHighlighter(ctx.tiltX, ctx.tiltY)
      ? "highlighter"
      : $inkState.brush;
    const newStroke: InkStroke = {
      id: `ink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      brush: effectiveBrush,
      color: $inkState.color,
      style: $inkState.style,
      baseWidth: $inkState.baseWidth,
      opacity: $inkState.opacity,
      points,
      path: catmullRomToBezierPath(points),
      createdAt: Date.now(),
      bookId: bookId || "",
      pageIndex: 0,
    };
    activeStroke.set(newStroke);
  }

  function onInkPointerMove(e: PointerEvent) {
    // 必须在 activeStroke 存在时（即 pointerdown 已触发）
    if (!isPdfBook() || $inkState.mode !== "draw") return;
    const cur = $activeStroke;
    if (!cur) return;
    const ctx = getInkPointerContext(e);
    if (!ctx) return;
    // getCoalescedEvents 拿所有原始点（避免 rAF 合并丢点）
    const coalesced = getCoalescedPoints(e as any);
    if (coalesced.length === 0) return;
    // 转为 stage 相对坐标：clientX/Y 减 readerStageEl 偏移
    // 简化：用 clientX/Y 减 readerStageEl 偏移（pointer 已经在 stage 内时）
    // 因 getInkPointerContext 已经返回了 stage 相对坐标，这里取最后一个 coalesced 点的偏移
    const stageEl = readerStageEl;
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    // offsetX/Y 是相对 target 元素（readerViewEl），需要补偿
    // 简化：用 ctx 的相对值近似
    const newPoints: InkPoint[] = coalesced.map((p) => ({
      x: p.x - e.offsetX + (e.clientX - rect.left),
      y: p.y - e.offsetY + (e.clientY - rect.top),
      pressure: p.pressure,
      t: p.t,
      tiltX: p.tiltX,
      tiltY: p.tiltY,
    }));
    // 合并到 activeStroke.points
    const mergedPoints = [...cur.points, ...newPoints];
    const updated: InkStroke = {
      ...cur,
      points: mergedPoints,
      path: catmullRomToBezierPath(mergedPoints),
    };
    activeStroke.set(updated);
  }

  function onInkPointerUp(_e: PointerEvent) {
    if (!isPdfBook() || $inkState.mode === "off") return;
    const cur = $activeStroke;
    if (!cur) return;
    // 完成笔触：加入列表
    addStroke(cur);
    activeStroke.set(null);
  }

  /* ================= PDF 缩放边界与工具（2026-08-29） =================
   * ZoomState.custom.scale 的合法区间（与 bookshelf-store.ts 的类型注释一致：0.25 - 4.0）
   */
  const MIN_PDF_ZOOM = 0.25;
  const MAX_PDF_ZOOM = 4.0;
  /**
   * 滚轮连续缩放灵敏度：factor = exp(-deltaY * k)。
   * 0.0018（原 0.0025 偏跳）→ 鼠标一格（截断后 deltaY≈60）约 ±10%，
   * 触控板捏合（deltaY≈10）约 ±1.8%，连续滚动更细腻。
   */
  const WHEEL_ZOOM_SENSITIVITY = 0.0018;
  /** 单个 wheel 事件的 delta 上限：不同鼠标/驱动的 deltaY 差异极大（几十到几百都有），
   *  不截断的话一格滚轮能直接跳 30%+，手感很突兀。截断后靠连续滚动累积达到目标倍率。 */
  const WHEEL_MAX_DELTA = 60;
  /** 滚动模式：滚轮停止多久后才提交真实渲染（ms）。
   *  连续缩放期间靠 CSS transform 预览，停手才真正重绘页面 canvas。 */
  const SCROLL_ZOOM_COMMIT_DELAY = 180;

  function clampPdfZoom(n: number): number {
    if (!isFinite(n) || n <= 0) return 1;
    return Math.min(MAX_PDF_ZOOM, Math.max(MIN_PDF_ZOOM, n));
  }

  /** 当前是否「滚动模式」：flow="scrolled" → foliate 内部 #scrollMode=true */
  function isScrollFlow(): boolean {
    try {
      return view?.renderer?.getAttribute?.("flow") === "scrolled";
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "ReaderView.svelte · isScrollFlow", "debug");
      return false;
    }
  }

  /** 读 foliate 当前的 scale-factor 属性（百分数 → 倍数；未设置视为 1.0） */
  function readScaleFactorAttr(): number {
    try {
      const raw = view?.renderer?.getAttribute?.("scale-factor");
      if (raw == null || raw === "") return 1;
      const n = parseFloat(raw) / 100;
      return isFinite(n) && n > 0 ? n : 1;
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "ReaderView.svelte · readScaleFactorAttr", "debug");
      return 1;
    }
  }

  /** 把 ZoomState 应用到 foliate view（实际调用 setAttribute） */
  function applyZoom(input: ZoomState, opts: { silent?: boolean } = {}) {
    if (!view?.renderer?.setAttribute) return;
    // custom 先 clamp 到合法区间，再统一用 zoom 这个局部变量走下面的分支
    // （注意：下面必须用 zoom.scale，test/pdf-zoom-apply.test.mjs 按源码文本断言这条）
    const zoom: ZoomState = input.kind === "custom"
      ? { kind: "custom", scale: clampPdfZoom(input.scale) }
      : input;
    currentZoom = zoom;
    const r = view.renderer;

    // [2026-08-29 修复] foliate 的两种布局用【完全不同】的缩放公式，写错属性就等于没缩放：
    //   分页模式  #render()          → scale = zoom × scaleFactor
    //                                  （fixed-layout.js:544-561）
    //   滚动模式  #renderScrollMode() → scale = (容器宽/页宽) × scaleFactor
    //                                  【zoom 属性完全不参与！】(fixed-layout.js:1130-1132)
    // 所以：分页模式用 zoom 承载、scale-factor 钉 100（否则 scale²）；
    //       滚动模式只能用 scale-factor 承载，zoom 保持 fit-width 作为基准。
    if (isScrollFlow()) {
      let sf = 1;
      if (zoom.kind === "custom") {
        // 滚动模式的基准是「适应宽度」，先把目标「实际缩放」换算成相对基准的倍数：
        //   当前实际缩放 = 基准 × 当前scaleFactor  →  基准 = 实际 / 当前scaleFactor
        const cur = readCurrentPdfScale();
        const curSf = readScaleFactorAttr();
        const fitBase = curSf > 0 ? cur / curSf : cur;
        sf = fitBase > 0 ? clampPdfZoom(zoom.scale) / fitBase : 1;
        sf = Math.min(MAX_PDF_ZOOM, Math.max(MIN_PDF_ZOOM, sf));
      }
      const pct = String(Math.max(25, Math.round(sf * 100)));
      if (r.getAttribute?.("scale-factor") !== pct) r.setAttribute("scale-factor", pct);
      // 基准由 foliate 自己按容器宽算，zoom 固定 fit-width
      if (r.getAttribute?.("zoom") !== "fit-width") r.setAttribute("zoom", "fit-width");
    } else {
      if (zoom.kind === "fit-width") {
        r.setAttribute("zoom", "fit-width");
      } else if (zoom.kind === "fit-page") {
        r.setAttribute("zoom", "fit-page");
      } else {
        // custom：zoom 属性本身就是「目标缩放倍数」（foliate 会 parseFloat）
        r.setAttribute("zoom", String(zoom.scale));
      }
      if (r.getAttribute?.("scale-factor") !== "100") {
        r.setAttribute("scale-factor", "100");
      }
    }
    if (!opts.silent) {
      // 持久化（relocate 事件也会保存；这里立即保存避免等待 relocate）
      scheduleProgressSave({ zoom });
    }
  }

  /**
   * 读取 PDF 当前「真实」缩放倍数。
   * fit-width / fit-page 的实际倍数是 foliate 按视口算出来的，我们手里没有；
   * 但 pdf.js 的 render() 会把本次生效的 scale 写进内容文档的
   * `--total-scale-factor`（vendor/foliate-js/pdf.js:255），直接读它最准。
   * 读不到时退化为 custom 值 / 1.0（与旧的 zoomIn/zoomOut 口径一致）。
   */
  function readCurrentPdfScale(): number {
    try {
      for (const c of (view?.renderer?.getContents?.() ?? []) as any[]) {
        const d: Document | undefined = c?.doc;
        const v = d?.documentElement?.style?.getPropertyValue("--total-scale-factor");
        if (v) {
          const n = parseFloat(v);
          if (isFinite(n) && n > 0) return n;
        }
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · readCurrentPdfScale", "debug"); }
    return currentZoom.kind === "custom" ? currentZoom.scale : 1.0;
  }

  /** 缩放到下一档（Zoom in） */
  function zoomIn() {
    if (!isPdfBook()) {
      // EPUB 退化为字号 +
      changeFont(1);
      return;
    }
    // 2026-08-29：基准改用「真实缩放」而非写死的 1.0，
    // 否则 fit-page 实际 0.42 时点一次「+」会直接跳到 1.25（画面暴涨 3 倍）。
    const cur = isPdfBook() ? readCurrentPdfScale() : (currentZoom.kind === "custom" ? currentZoom.scale : 1.0);
    const next = ZOOM_PRESETS.find((p) => p > cur + 0.001) ?? clampPdfZoom(cur * 1.25);
    applyZoom({ kind: "custom", scale: next });
  }

  /** 缩放到上一档（Zoom out） */
  function zoomOut() {
    if (!isPdfBook()) {
      changeFont(-1);
      return;
    }
    const cur = isPdfBook() ? readCurrentPdfScale() : (currentZoom.kind === "custom" ? currentZoom.scale : 1.0);
    const candidates = ZOOM_PRESETS.filter((p) => p < cur - 0.001);
    const next = candidates.length ? candidates[candidates.length - 1] : clampPdfZoom(cur / 1.25);
    applyZoom({ kind: "custom", scale: next });
  }

  /** 重置到 fit-page（Cmd+0） */
  function zoomReset() {
    if (!isPdfBook()) return;
    applyZoom({ kind: "fit-page" });
  }

  /** 适应宽度（Cmd+1） */
  function fitWidth() {
    if (!isPdfBook()) return;
    // 记录切换前的非 fit-width 状态，双击缩放切回用
    if (currentZoom.kind !== "fit-width") {
      lastNonFitWidthZoom = currentZoom;
    }
    applyZoom({ kind: "fit-width" });
  }

  /** 适应整页（Cmd+2） */
  function fitPage() {
    if (!isPdfBook()) return;
    if (currentZoom.kind !== "fit-page") {
      lastNonFitWidthZoom = currentZoom;
    }
    applyZoom({ kind: "fit-page" });
  }

  /** 循环切换预设档位（Cmd+3） */
  function cycleZoomPreset() {
    if (!isPdfBook()) return;
    const cur = currentZoom.kind === "custom" ? currentZoom.scale : 1.0;
    const idx = ZOOM_PRESETS.findIndex((p) => Math.abs(p - cur) < 0.001);
    const nextIdx = idx >= 0 ? (idx + 1) % ZOOM_PRESETS.length : 0;
    applyZoom({ kind: "custom", scale: ZOOM_PRESETS[nextIdx] });
  }

  /** 缩放百分比显示（工具栏用） */
  function zoomPercentLabel(): string {
    if (!isPdfBook()) return "";
    if (currentZoom.kind === "fit-width") return "↔ 适应宽度";
    if (currentZoom.kind === "fit-page") return "⊡ 适应整页";
    return `${Math.round(currentZoom.scale * 100)}%`;
  }

  /** [REword patch 2026-08-29] 双击切换 fit-width ↔ 上次缩放（参考 iBooks / Readest） */
  function onDblClickToggleZoom() {
    if (!isPdfBook()) return;
    if (currentZoom.kind === "fit-width") {
      // 当前是 fit-width → 切回上次非 fit-width 状态
      applyZoom(lastNonFitWidthZoom);
    } else {
      // 当前是 fit-page / custom → 切到 fit-width
      lastNonFitWidthZoom = currentZoom;
      applyZoom({ kind: "fit-width" });
    }
  }

  /* ================= PDF 滚轮 / 触控板捏合缩放（2026-08-29） =================
   * 对齐 macOS 原生语义（Preview / Chrome / Acrobat 一致）：
   *   - ⌘ 或 Ctrl + 滚轮 → 连续缩放（鼠标滚轮）
   *   - 触控板双指捏合    → macOS 会把它合成为 ctrlKey=true 的 wheel 事件，走同一条路径
   *   - 无修饰键滚轮      → 保持原生行为（页面放大后可平移；未放大时本就无可滚动内容）
   *
   * 事件必须挂两处，缺一不可：
   *   ① 内容 iframe 内部 doc（PDF 页面本体）——wheel 不跨 iframe 边界冒泡，
   *      只挂父容器时鼠标在页面上滚动完全收不到事件（这是最容易踩的坑）；
   *   ② .reader-stage 容器——页面四周灰色留白区。
   * 两处都必须 passive:false，否则 preventDefault 无效，
   * Electron/Chrome 会把 Ctrl+滚轮 吃掉去做整页缩放。
   */

  // 滚轮缩放的落盘防抖（滚动过程中不重复写盘）
  let zoomSaveTimer: any = null;
  function scheduleZoomPersist() {
    if (zoomSaveTimer) clearTimeout(zoomSaveTimer);
    zoomSaveTimer = setTimeout(() => {
      zoomSaveTimer = null;
      scheduleProgressSave({ zoom: currentZoom });
    }, 400);
  }

  /** 取 foliate fixed-layout 宿主元素（:host{overflow:auto}，负责平移滚动） */
  function getZoomHost(): HTMLElement | null {
    const h = view?.renderer as HTMLElement | null | undefined;
    return h && typeof (h as HTMLElement).getBoundingClientRect === "function" ? h : null;
  }

  /** 量当前页面渲染宽度（算缩放前后真实倍数 k 用；fixed-layout 用 open shadow DOM，可直接查） */
  function measurePageWidth(host: HTMLElement): number {
    try {
      const iframes = (host as any).shadowRoot?.querySelectorAll?.("iframe");
      if (iframes && iframes.length) {
        let best = 0;
        for (const f of Array.from(iframes) as HTMLIFrameElement[]) {
          const w = f.getBoundingClientRect?.().width || 0;
          if (w > best) best = w;
        }
        if (best > 0) return best;
      }
      return host.scrollWidth || 0;
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "ReaderView.svelte · measurePageWidth", "debug");
      return 0;
    }
  }

  /**
   * 以光标为锚点做连续缩放：缩放前后，光标压着的那个内容点保持不动
   * （不做锚点的话，放大后 foliate 会重新居中/回到顶部，画面"跳走"）。
   * @param clientX/clientY 必须是主窗口（最外层）坐标
   */
  function zoomAtPoint(nextScale: number, clientX: number, clientY: number) {
    const target = clampPdfZoom(nextScale);
    const host = getZoomHost();
    if (!host) {
      applyZoom({ kind: "custom", scale: target }, { silent: true });
      scheduleZoomPersist();
      return;
    }
    // [2026-08-29] 滚动模式不做光标锚点：
    // foliate 的 #renderScrollMode 自己用 captureScrollModeAnchor / restoreScrollModeAnchor
    // 维持「视口顶部的页面 + 页内偏移比例」（fixed-layout.js:1128/1143）。
    // 我们再去改 scrollTop 会和它打架、来回拉扯导致画面跳动。交给它即可，
    // 且它锚定的是视口顶部，连续缩放时比光标锚点更稳（不会随光标位置漂移）。
    if (isScrollFlow()) {
      applyZoom({ kind: "custom", scale: target }, { silent: true });
      scheduleZoomPersist();
      return;
    }
    const rect = host.getBoundingClientRect();
    const cursorX = clientX - rect.left;
    const cursorY = clientY - rect.top;
    const w0 = measurePageWidth(host);
    // 光标下的内容坐标（宿主滚动空间内）
    const contentX = host.scrollLeft + cursorX;
    const contentY = host.scrollTop + cursorY;

    applyZoom({ kind: "custom", scale: target }, { silent: true });

    const restore = () => {
      const w1 = measurePageWidth(host);
      if (!w0 || !w1) return;
      const k = w1 / w0;
      host.scrollLeft = contentX * k - cursorX;
      host.scrollTop = contentY * k - cursorY;
    };
    // setAttribute → attributeChangedCallback → #render() 是同步改尺寸的，这里立刻校正一次
    restore();
    // PDF 每页 canvas 重绘是异步的，等一帧再校正，避免渲染完成后尺寸回弹
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
    scheduleZoomPersist();
  }

  /**
   * PDF 滚轮缩放诊断开关。
   * 排查「按了修饰键但没反应」时改成 true，控制台会打印每一条 wheel 的
   * ctrlKey/metaKey/deltaY 以及最终算出的缩放值；确认修复后请改回 false 再发布。
   */
  const DEBUG_PDF_WHEEL = false;
  function logPdfWheel(...args: any[]) {
    if (DEBUG_PDF_WHEEL) console.log("[REword][pdf-wheel]", ...args);
  }

  // ---- 滚轮缩放的 rAF 累积状态 ----
  // PDF 每次 applyZoom 都会触发整页 canvas 重绘（很重）。触控板捏合每秒能发 60+ 个
  // wheel 事件，逐条响应会明显卡顿。这里把同一帧内的 delta 累积起来，
  // 每帧只真正缩放一次，视觉上仍然跟手。
  let wheelAccumDy = 0;
  let wheelRafId: number | null = null;
  let wheelAnchorX = 0;
  let wheelAnchorY = 0;

  // 滚动模式专用：pinch 预览状态（机制见 commitScrollWheelZoom 注释）
  let wheelPinchBase = 1;        // 本轮连续缩放开始时的缩放基准
  let wheelPinchRatio = 1;       // 累积预览倍数（相对基准）
  let wheelPinchActive = false;  // 是否处于「已预览、未提交」状态
  let wheelCommitTimer: any = null;

  /**
   * 滚动模式：把本轮缩放预览提交为真实渲染 —— 每轮连续缩放只重绘【一次】。
   * 这是滚动模式流畅度的关键：连续缩放期间不改任何页面，停手才画。
   */
  function commitScrollWheelZoom() {
    wheelCommitTimer = null;
    const r = view?.renderer as any;
    if (!wheelPinchActive) return;
    wheelPinchActive = false;
    const finalScale = clampPdfZoom(wheelPinchBase * wheelPinchRatio);
    wheelPinchRatio = 1;
    if (r) {
      try {
        // pinchEnd 快照视口中心页的矩形存进 #pinchAnchor 并清掉 transform；
        // 紧接着的 applyZoom 触发 #render → #renderScrollMode 用该锚点把页面滚回原位，不跳。
        if (typeof r.pinchEnd === "function") r.pinchEnd();
      } catch (__swallowErr) {
        logSwallow(__swallowErr, "ReaderView.svelte · pinchEnd", "debug");
      }
    }
    applyZoom({ kind: "custom", scale: finalScale }, { silent: true });
    scheduleZoomPersist();
  }

  /** 真正执行缩放（由 rAF 调用，每帧至多一次） */
  function flushWheelZoom() {
    wheelRafId = null;
    const dy = wheelAccumDy;
    wheelAccumDy = 0;
    if (!dy) return;

    // 滚动模式走 foliate 的 pinch 预览：连续缩放期间【零重绘】。
    // 滚动模式最多保持 12 页 loaded（#scrollMaxLoaded=12），逐帧提交意味着每帧重绘
    // 12 页 canvas（每页约 400ms）→ 必然卡顿。预览只改 scrollContainer 的 CSS transform，
    // 交给 GPU 合成；停手后才由 commitScrollWheelZoom 提交一次真实渲染。
    if (isScrollFlow()) {
      const r = view?.renderer as any;
      if (r && typeof r.pinchZoom === "function") {
        if (!wheelPinchActive) {
          wheelPinchBase = readCurrentPdfScale();
          wheelPinchRatio = 1;
          wheelPinchActive = true;
        }
        const target = clampPdfZoom(
          wheelPinchBase * wheelPinchRatio * Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY)
        );
        wheelPinchRatio = wheelPinchBase > 0 ? target / wheelPinchBase : 1;
        if (Math.abs(wheelPinchRatio - 1) < 0.0005) return;   // 已到边界
        try {
          r.pinchZoom(wheelPinchRatio);
        } catch (__swallowErr) {
          logSwallow(__swallowErr, "ReaderView.svelte · pinchZoom", "debug");
        }
        if (wheelCommitTimer) clearTimeout(wheelCommitTimer);
        wheelCommitTimer = setTimeout(commitScrollWheelZoom, SCROLL_ZOOM_COMMIT_DELAY);
        return;
      }
    }

    // 分页模式：只渲染当前 1-2 页，逐帧提交即可，且需要光标锚点
    const base = readCurrentPdfScale();
    const next = clampPdfZoom(base * Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY));
    logPdfWheel("zoom", { base, next, dy, flow: "paginated" });
    if (Math.abs(next - base) < 0.0005) return;      // 已到边界
    zoomAtPoint(next, wheelAnchorX, wheelAnchorY);
  }

  /** 滚轮缩放统一入口 */
  function handlePdfWheel(e: WheelEvent, clientX: number, clientY: number) {
    logPdfWheel("wheel", {
      ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey,
      deltaY: e.deltaY, deltaMode: e.deltaMode, isPdf: isPdfBook(),
    });
    if (!isPdfBook()) return;                       // EPUB 保留原生滚动
    if (!e.ctrlKey && !e.metaKey) return;           // 仅 ⌘/Ctrl + 滚轮（含触控板捏合）
    // 两个都要：
    //   preventDefault            → 阻止 Electron/Chromium 拿它去做整页缩放
    //   stopImmediatePropagation  → 连 foliate 自己挂在同文档上的 wheel 一起挡掉，
    //                               避免缩放被它后续再处理一次（冒泡阶段会晚于我们的捕获阶段）
    e.preventDefault();
    e.stopImmediatePropagation();
    // deltaMode 归一化：0=像素 / 1=行 / 2=页
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    let dy = (e.deltaY || 0) * unit;
    if (!dy) return;
    // 单条事件幅度截断：不同鼠标 deltaY 从几十到几百都有，不截断一格能跳 30%+，
    // 非常突兀。截到 ±60 后靠连续滚动累积到目标倍率，手感细腻且不失控。
    dy = Math.max(-WHEEL_MAX_DELTA, Math.min(WHEEL_MAX_DELTA, dy));
    // 累积到 rAF，一帧合并成一次缩放（锚点取本帧最后一次事件的位置）
    wheelAccumDy += dy;
    wheelAnchorX = clientX;
    wheelAnchorY = clientY;
    if (wheelRafId != null) return;
    if (typeof requestAnimationFrame === "function") {
      wheelRafId = requestAnimationFrame(flushWheelZoom);
    } else {
      flushWheelZoom();
    }
  }

  /** ① 挂在 .reader-stage（页面四周留白）：坐标本就是主窗口坐标 */
  function onStageWheel(e: WheelEvent) {
    handlePdfWheel(e, e.clientX, e.clientY);
  }

  /** ② 挂在内容 iframe 内的 doc（页面本体）：坐标要换算回主窗口 */
  function onContentWheel(e: WheelEvent) {
    if (!isPdfBook()) return;
    if (!e.ctrlKey && !e.metaKey) return;
    let left = 0;
    let top = 0;
    try {
      const doc = ((e.target as Node)?.ownerDocument ?? e.currentTarget) as Document | null;
      const fr = (doc?.defaultView as any)?.frameElement?.getBoundingClientRect?.() as DOMRect | undefined;
      if (fr) { left = fr.left; top = fr.top; }
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · onContentWheel", "debug"); }
    handlePdfWheel(e, e.clientX + left, e.clientY + top);
  }

  // 最外层 wheel 监听是否已绑定（capture 阶段；只在确认是 PDF 之后才绑，
  // 避免 passive:false 的 capture 监听拖累 EPUB 滚动性能）。
  // 函数名沿用 bindStageWheel —— test/pdf-zoom-apply.test.mjs 按源码文本断言这个名字，不要改。
  let stageWheelBound = false;
  function bindStageWheel() {
    if (stageWheelBound || !readerViewEl) return;
    // 挂【最外层 .reader-view】+【capture 阶段】：页面四周留白区的滚轮
    // 在进入任何子元素之前就被拦下，比原先挂在 .reader-stage 的冒泡阶段更早，
    // 也不会被 foliate 内部的处理抢先。
    // 注意：iframe 内的滚轮不会传播到父文档，页面本体仍靠 onContentWheel（挂 iframe 内的 doc）。
    readerViewEl.addEventListener("wheel", onStageWheel as EventListener, { capture: true, passive: false });
    stageWheelBound = true;
  }

  // 2026-08-29 Phase 1：双指捏合缩放——实时改字号（不立即持久化，松手即落盘由 store 自行处理）
  function setFontSizeLive(n: number) {
    const clamped = Math.min(40, Math.max(12, Math.round(n)));
    if (clamped === settings.fontSize) return;
    settings = settingsStore.update({ fontSize: clamped });
    applyStyles();
  }

  // 2026-08-29 Phase 1：工具栏显隐切换（移动端中心点击）。面板打开时不隐藏，避免失去锚点感。
  function toggleToolbar() {
    // [REword patch 2026-08-29] Phase 2 触屏：单击空白处关闭所有浮层
    // 触屏场景：用户点中心区时如果有浮层（搜索/设置/目录）打开，
    // 应优先关闭浮层而不是 toggle 工具栏可见性（避免被遮挡的工具栏闪一下）
    if (showSettings || showSearch) {
      showSettings = false;
      showSearch = false;
      return;
    }
    if (showToc) {
      showToc = false;
      return;
    }
    toolbarVisible = !toolbarVisible;
  }

  function onSetTheme(key: string) {
    settings = settingsStore.update({ theme: key as ReaderTheme });
    applyStyles();
  }

  // [2026-08-29] 页面边距三档预设：铺满 / 正常 / 宽松（替代失效的行宽 padding 控制）
  function onSetLayoutPreset(p: string) {
    const m = LAYOUT_PRESETS[p as ReaderLayoutPreset].margins;
    settings = settingsStore.update({
      layout: { ...settings.layout, marginTopPx: m.top, marginRightPx: m.right, marginBottomPx: m.bottom, marginLeftPx: m.left },
    });
    applyStyles();
  }
  /** 跟随思源文档边距：读取宿主 .protyle-wysiwyg 的水平 padding，作为阅读器左右边距 */
  function applySiyuanDocMargin() {
    if (!settings.layout.followSiyuanMargin) return;
    try {
      const doc = (typeof window !== "undefined" && (window.top?.document ?? window.document)) || null;
      if (!doc) return;
      const host: Element | null =
        doc.querySelector(".protyle-wysiwyg") || doc.querySelector(".protyle-content");
      if (!host) return;
      const cs = getComputedStyle(host);
      const pl = Math.round(parseFloat(cs.paddingLeft) || 0);
      const pr = Math.round(parseFloat(cs.paddingRight) || 0);
      if (pl || pr) {
        settings = settingsStore.update({
          layout: {
            ...settings.layout,
            marginLeftPx: pl || settings.layout.marginLeftPx,
            marginRightPx: pr || settings.layout.marginRightPx,
          },
        });
      }
    } catch (__e) { logSwallow(__e, "ReaderView.svelte · applySiyuanDocMargin", "debug"); }
  }
  function setFollowSiyuanMargin(e: Event) {
    settings = settingsStore.update({
      layout: { ...settings.layout, followSiyuanMargin: (e.target as HTMLInputElement).checked },
    });
    applyStyles();
  }

  function onSetFlow(key: string) {
    settings = settingsStore.update({ flow: key as ReaderSettings["flow"] });
    applyFlow();
  }

  function onSetTurnStyle(key: string) {
    settings = settingsStore.update({ turnStyle: key as ReaderSettings["turnStyle"] });
    applyTurnStyle();
  }

  // [REword patch 2026-08-29] PDF 显示设置：更新后由 settingsStore 订阅回调统一 apply（见上方 subscription）
  function onSetPdfViewMode(key: string) {
    settings = settingsStore.update({ pdfViewMode: key as ReaderSettings["pdfViewMode"] });
  }

  function onSetPdfScrollDir(key: string) {
    settings = settingsStore.update({ pdfScrollDir: key as ReaderSettings["pdfScrollDir"] });
  }

  function setPdfInvert(e: Event) {
    settings = settingsStore.update({ pdfInvert: (e.target as HTMLInputElement).checked });
  }

  function setLineHeight(lh: number) {
    settings = settingsStore.update({ lineHeight: lh });
    applyStyles();
  }

  function setClickToTurn(e: Event) {
    settings = settingsStore.update({ clickToTurn: (e.target as HTMLInputElement).checked });
  }

  /** 专注模式开关（2026-08-27 晚 P2.2）：重新注入样式 + 给当前文档加/去 .reword-focus */
  function setFocusMode(e: Event) {
    const v = (e.target as HTMLInputElement).checked;
    settings = settingsStore.update({ focusMode: v });
    applyStyles();
    applyFocusMode();
  }

  function setOverridePublisherFont(e: Event) {
    settings = settingsStore.update({
      overridePublisherFont: (e.target as HTMLInputElement).checked,
    });
    applyStyles();
  }

  /** 统一正文字号开关（2026-08-27）：压平书籍写死字号，让 A+/A- 全局生效 */
  function setOverrideBookFontSize(e: Event) {
    settings = settingsStore.update({
      overrideBookFontSize: (e.target as HTMLInputElement).checked,
    });
    applyStyles();
  }

  /* ================= 2026-08-28 双语 + 阅读增强 handler ================= */

  /** 译文字号（em 倍数，0.6–1.0，步长 0.02） */
  function setTranslationFontSize(v: number) {
    settings = settingsStore.update({
      translationFontSize: clamp(Math.round(v * 100) / 100, 0.6, 1.0),
    });
    applyStyles();
  }

  /** 段落悬停高亮开关（2026-08-28 C2） */
  function setParagraphHover(e: Event) {
    const v = (e.target as HTMLInputElement).checked;
    settings = settingsStore.update({ paragraphHover: v });
    applyStyles();
    applyParagraphHover();
  }

  /** 双语预取页数（0–8，默认 2；值越大越省翻页等待但越费 token） */
  function setBilingualPrefetchPages(v: number) {
    settings = settingsStore.update({
      bilingualPrefetchPages: clamp(Math.round(v * 10) / 10, 0, 8),
    });
    // 预取窗口变化后，下一轮 injectAll（relocate/load）会自动按新值补译；
    // 若已开启双语，立即触发一次增量刷新让后面新范围入缓存。
    if (bilingualOn) ensureBilingualHandle().refresh();
  }

  /* ================= 本书前提上下文（v1.3.0：lite Protyle 富文本编辑） ================= */

  let primerOpen = false;
  let primerEditorEl: HTMLElement | null = null;
  let primerEditor: AnnEditor | null = null;
  let primerChars = 0;
  let primerTokens = 0;
  let primerSaveTimer: any = null;

  /** 本书累计 token（打开设置面板 / 翻译完成后刷新） */
  let bookTokenTotal = 0;
  function refreshBookTokenUsage() {
    const u = getTokenUsage?.(bookId);
    bookTokenTotal = u?.total || 0;
  }
  async function onResetBookTokens() {
    await resetTokenUsage?.(bookId);
    refreshBookTokenUsage();
    toast("本书 Token 统计已重置");
  }

  function fmtTok(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  }

  /* ================= 2026-08-28 翻译缓存统计（按书） ================= */
  /** 当前查看书籍的已缓存译文条数（设置面板展示「已缓存 N 段」） */
  let bilingualCacheCount = 0;
  /** 当前查看书籍已缓存的「节」总数（用于「共缓存 N 页」） */
  let bilingualCachedPages = 0;
  /** 当前查看书籍已缓存连续区间文本（如「第 1-4 页」） */
  let bilingualPageRange = "0 页";
  /** 清空缓存进行中（防重复点击） */
  let clearingCache = false;
  /** 有翻译缓存的书籍列表（bookId + 书名），供「选择书籍」下拉 */
  let cacheBookList: Array<{ bookId: string; title: string }> = [];
  /** 当前下拉选中的书籍（默认本书；可切到其他有缓存的书查看） */
  let selectedCacheBookId = bookId || "";

  /** 拉取有缓存的书籍列表（书名 + bookId） */
  async function refreshCacheBookList() {
    if (!listCachedBooks) return;
    try {
      const list = await listCachedBooks();
      cacheBookList = Array.isArray(list) ? list : [];
    } catch {
      cacheBookList = [];
    }
  }

  /** 拉取某书翻译缓存统计（条数 + 页数 + 区间），写入面板状态。默认本书 */
  async function refreshCacheStats(bid?: string) {
    const target = bid || bookId;
    selectedCacheBookId = target;
    if (!target || !getTranslationCacheStats) {
      bilingualCacheCount = 0;
      bilingualCachedPages = 0;
      bilingualPageRange = "0 页";
      return;
    }
    try {
      const r = await getTranslationCacheStats(target);
      bilingualCacheCount = r?.count || 0;
      bilingualCachedPages = r?.cachedPages || 0;
      bilingualPageRange = r?.pageRangeText || "0 页";
    } catch {
      bilingualCacheCount = 0;
      bilingualCachedPages = 0;
      bilingualPageRange = "0 页";
    }
  }

  /** 下拉切换查看的书籍：刷新该书统计 */
  async function onSelectCacheBook(e: Event) {
    const bid = (e.target as HTMLSelectElement).value;
    await refreshCacheStats(bid);
  }

  /** 清空当前选中书籍的翻译缓存（用户主动点「清空缓存」；正常关闭双语不清） */
  async function onClearBilingualCache() {
    const target = selectedCacheBookId || bookId;
    if (!target || !clearTranslationCache || clearingCache) return;
    clearingCache = true;
    try {
      await clearTranslationCache(target);
      await refreshCacheStats(target);
      await refreshCacheBookList();
      toast(target === bookId ? "本书翻译缓存已清空" : "已清空所选书籍翻译缓存");
    } catch (e) {
      console.warn("[REword] 清空翻译缓存失败:", e);
      toast("清空缓存失败，请重试", 2600, "error" as any);
    } finally {
      clearingCache = false;
    }
  }

  function togglePrimerEditor() {
    primerOpen = !primerOpen;
    if (primerOpen) {
      // 等 {#if} 渲染出容器且有尺寸后挂载（AnnEditor 内部有 rAF 重试兜底）
      setTimeout(() => mountPrimerEditor(), 60);
    } else {
      flushPrimerSave();
      destroyPrimerEditor();
    }
  }

  function mountPrimerEditor() {
    if (!primerEditorEl || primerEditor || !primerStore) return;
    const app = (window as any).siyuan?.ws?.app;
    primerEditor = new AnnEditor(primerEditorEl, {
      app,
      initial: primerStore.get(bookId) || "",
    });
    primerEditor.mount();
    updatePrimerStats();
    // input 冒泡监听：实时更新字数/token + 防抖保存（Kramdown 落盘）
    primerEditorEl.addEventListener("input", () => {
      updatePrimerStats();
      if (primerSaveTimer) clearTimeout(primerSaveTimer);
      primerSaveTimer = setTimeout(() => {
        primerSaveTimer = null;
        savePrimer();
      }, 600);
    });
  }

  function updatePrimerStats() {
    if (!primerEditor) return;
    try {
      const md = primerEditor.read() || "";
      primerChars = md.length;
      primerTokens = estimateTokens(md);
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · updatePrimerStats", "debug"); }
  }

  function savePrimer() {
    if (!primerEditor || !primerStore) return;
    try {
      const md = (primerEditor.read() || "").trim();
      primerStore.set(bookId, md, meta?.title).catch(() => {});
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · savePrimer", "error"); }
  }

  function flushPrimerSave() {
    if (primerSaveTimer) {
      clearTimeout(primerSaveTimer);
      primerSaveTimer = null;
    }
    savePrimer();
  }

  async function clearPrimer() {
    if (!primerStore) return;
    destroyPrimerEditor();
    await primerStore.remove(bookId);
    primerChars = 0;
    primerTokens = 0;
    primerOpen = false;
    toast("已清除本书上下文");
  }

  function destroyPrimerEditor() {
    try {
      primerEditor?.destroy?.();
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · destroyPrimerEditor", "debug"); }
    primerEditor = null;
    primerEditorEl = null;
  }

  /* ================= 生词本导出（v1.3.0：Markdown 表格 → 剪贴板） ================= */

  /**
   * 导出当前书中已显示的双语对照为 Markdown 表格（原文 | 译文 | 章节），
   * 复制到剪贴板后可直接粘贴进思源笔记做成复习文档。
   * 数据源：当前已加载内容文档里带 data-reword-translated 标记的段落（即已注入译文的）。
   */
  async function exportBilingualNotes() {
    try {
      // 直接取 foliate 内容文档（铁律：真 Document 在 .doc 字段）
      const raw = (view?.renderer?.getContents?.() as any[]) || [];
      const docs = raw.map((c) => c?.doc).filter(Boolean) as Document[];
      if (!docs.length) {
        toast("未找到已翻译内容");
        return;
      }
      const rows: Array<{ src: string; dst: string; ch: string }> = [];
      const seen = new Set<string>();
      for (const doc of docs) {
        const chapter = (doc as any).title || "";
        const translated = doc.querySelectorAll("[data-reword-translated]");
        translated.forEach((el) => {
          const dstEl = el.querySelector(":scope > .reword-bilingual");
          if (!dstEl) return;
          // 原文 = 父元素文本去掉译文子节点后的内容
          const clone = el.cloneNode(true) as Element;
          clone.querySelectorAll(":scope > .reword-bilingual").forEach((n) => n.remove());
          const src = (clone.textContent || "").replace(/\s+/g, " ").trim();
          const dst = (dstEl.textContent || "").replace(/\s+/g, " ").trim();
          if (!src || !dst) return;
          const key = src.slice(0, 120);
          if (seen.has(key)) return; // foliate 多列布局下同段可能出现在多个文档，去重
          seen.add(key);
          rows.push({ src, dst, ch: chapter });
        });
      }
      if (!rows.length) {
        toast("当前章节暂无已翻译段落（请先开启双语并滚动加载）");
        return;
      }
      const title = meta?.title || "本书";
      const lines = [
        `# ${title} · 双语生词本`,
        "",
        `> 导出于 ${new Date().toLocaleString()} · 共 ${rows.length} 段`,
        "",
        "| 原文 | 译文 |",
        "| --- | --- |",
        ...rows.map((r) => `| ${r.src.replace(/\|/g, "\\|").slice(0, 300)} | ${r.dst.replace(/\|/g, "\\|")} |`),
      ];
      const md = lines.join("\n");
      await navigator.clipboard.writeText(md);
      toast(`已复制 ${rows.length} 段生词 Markdown，可粘贴进思源笔记`);
    } catch (e: any) {
      console.warn("[REword] 生词本导出失败:", e);
      toast("导出失败：" + String(e?.message || e));
    }
  }

  /* ================= 2026-08-28 分类字体（Readest 同款）handler ================= */

  /** 正文默认走哪条链：衬线 / 无衬线 */
  function setDefaultFontFamily(key: string) {
    settings = settingsStore.update({
      defaultFontFamily: (key === "sans-serif" ? "sans-serif" : "serif") as
        | "serif"
        | "sans-serif",
    });
    applyStyles();
  }

  /**
   * 设置某条链的首选字体。
   * defaultCJKFont 传空串 = 不插入（仅用跨平台 CJK 兜底栈）。
   * applyStyles() 内部已带 rAF → applyFontKeywordRewrite()，无需重复调用。
   */
  function setFontFace(
    field: "serifFont" | "sansSerifFont" | "monospaceFont" | "defaultCJKFont",
    v: string
  ) {
    settings = settingsStore.update({ [field]: v } as Partial<ReaderSettings>);
    applyStyles();
  }

  /* ================= 2026-08-24 新增 4 大设置组 handler ================= */

  /** 通用：clamp + 应用样式 */
  function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
  }

  /* 文本设置 */
  function setTextWeight(v: number) {
    settings = settingsStore.update({ text: { ...settings.text, fontWeight: clamp(Math.round(v / 100) * 100, 100, 900) } });
    applyStyles();
  }
  function setLetterSpacing(v: number) {
    settings = settingsStore.update({ text: { ...settings.text, letterSpacing: clamp(v, -2, 8) } });
    applyStyles();
  }

  /* 段落设置 */
  function setParagraphSpacing(v: number) {
    settings = settingsStore.update({ paragraph: { ...settings.paragraph, paragraphSpacing: clamp(v, 0, 2) } });
    applyStyles();
  }
  function setTextIndent(v: number) {
    settings = settingsStore.update({ paragraph: { ...settings.paragraph, textIndent: clamp(v, 0, 4) } });
    applyStyles();
  }

  /* 页面布局：4 边距 + 分栏间距 + 开关 + 进度样式 + 参考页数 + 时间 + 24h */
  function setMarginPx(side: "marginTopPx" | "marginBottomPx" | "marginLeftPx" | "marginRightPx", v: number) {
    settings = settingsStore.update({ layout: { ...settings.layout, [side]: clamp(v, 0, 100) } });
    applyStyles();
  }
  function setColumnGapPx(v: number) {
    settings = settingsStore.update({ layout: { ...settings.layout, columnGapPx: clamp(v, 0, 40) } });
    applyStyles();
  }
  function setShowHeader(e: Event) {
    settings = settingsStore.update({ layout: { ...settings.layout, showHeader: (e.target as HTMLInputElement).checked } });
  }
  function setShowFooter(e: Event) {
    settings = settingsStore.update({ layout: { ...settings.layout, showFooter: (e.target as HTMLInputElement).checked } });
  }
  function setShowProgress(e: Event) {
    settings = settingsStore.update({ layout: { ...settings.layout, showProgress: (e.target as HTMLInputElement).checked } });
  }
  function setProgressStyle(key: string) {
    settings = settingsStore.update({ layout: { ...settings.layout, progressStyle: key as ReaderProgressStyle } });
  }
  function setReferencePageCount(v: number) {
    settings = settingsStore.update({ layout: { ...settings.layout, referencePageCount: clamp(Math.round(v), 0, 2000) } });
  }
  function setShowCurrentTime(e: Event) {
    settings = settingsStore.update({ layout: { ...settings.layout, showCurrentTime: (e.target as HTMLInputElement).checked } });
  }
  function setUse24Hour(e: Event) {
    settings = settingsStore.update({ layout: { ...settings.layout, use24Hour: (e.target as HTMLInputElement).checked } });
  }

  /* 笔记插入相关函数已移除（2026-08-25） */

  function setCustomColor(kind: "customFg" | "customBg", value: string) {
    settings = settingsStore.update({ [kind]: value } as any);
    if (settings.theme !== "custom") {
      settings = settingsStore.update({ theme: "custom" });
    }
    applyStyles();
  }

  function swatchStyle(bg: string): string {
    return `background:${bg}`;
  }

  function onCustomColor(kind: "customFg" | "customBg", e: Event) {
    setCustomColor(kind, (e.target as HTMLInputElement).value);
  }

  // 2026-08-27 晚（P2.3 自定义背景图）：URL 输入实时预览
  function onCustomBgImage(e: Event) {
    const url = (e.target as HTMLInputElement).value.trim();
    settings = settingsStore.update({ theme: "custom", customBgImage: url || undefined } as any);
    applyStyles();
  }

  function clearCustomBgImage() {
    const input = document.querySelector<HTMLInputElement>(".reader-text-input");
    if (input) input.value = "";
    settings = settingsStore.update({ customBgImage: undefined } as any);
    applyStyles();
  }

  /* ================= 字体 ================= */

  async function refreshFonts() {
    customFonts = fontStore.list;
  }

  async function loadFontBlob(f: CustomFont) {
    try {
      const blob = await getFileBlob(f.path);
      if (blob) {
        if (fontBlobUrl) URL.revokeObjectURL(fontBlobUrl);
        fontBlobUrl = URL.createObjectURL(blob);
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · loadFontBlob", "debug"); }
  }

  async function onSetFontMode(key: string) {
    settings = settingsStore.update({ fontMode: key as ReaderFontMode });
    if (key === "custom" && settings.customFontId) {
      const f = fontStore.get(settings.customFontId);
      if (f) await loadFontBlob(f);
    }
    applyStyles();
  }

  async function onSelectCustomFont(id: string) {
    settings = settingsStore.update({ fontMode: "custom", customFontId: id });
    const f = fontStore.get(id);
    if (f) await loadFontBlob(f);
    applyStyles();
  }

  async function onRemoveFont(id: string) {
    const wasSelected = settings.customFontId === id;
    await fontStore.removeFont(id);
    await refreshFonts();
    if (wasSelected) {
      settings = settingsStore.update({ customFontId: undefined, fontMode: "follow-siyuan" });
    }
    applyStyles();
  }

  async function onFontImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    fontImporting = true;
    try {
      const font = await fontStore.importFont(f);
      await refreshFonts();
      settings = settingsStore.update({ fontMode: "custom", customFontId: font.id });
      await loadFontBlob(font);
      applyStyles();
    } catch (err: any) {
      alert(`导入字体失败：${err?.message || err}`);
    } finally {
      fontImporting = false;
      input.value = "";
    }
  }

  function pickFontMode(key: string) {
    void onSetFontMode(key);
  }

  function pickCustomFont(id: string) {
    void onSelectCustomFont(id);
  }

  function delFont(id: string) {
    void onRemoveFont(id);
  }

  function fmtFontSize(n: number): string {
    const kb = n / 1024;
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
  }

  const LINE_HEIGHT_STEPS = [
    { label: "紧凑", value: 1.5 },
    { label: "标准", value: 1.7 },
    { label: "宽松", value: 2.0 },
  ];

  /* ================= 进度条 ================= */

  function onProgressInput(e: Event) {
    dragging = true;
    const v = Number((e.target as HTMLInputElement).value) / 1000;
    progress = v;
    progressText = fmtPct(v);
  }

  function onProgressChange(e: Event) {
    const v = Number((e.target as HTMLInputElement).value) / 1000;
    dragging = false;
    progress = v;
    progressText = fmtPct(v);
    if (view) {
      try {
        view.goToFraction(v);
      } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · onProgressChange", "debug"); }
    }
  }

  /**
   * 2026-08-23 起：点击浮层「外部」自动收起（之前只能点按钮收起，体验差）。
   * 2026-08-25 补：覆盖三类瞬时浮层 —— 划词工具栏(selToolbar)、批注窗口(noteEditor)、脚注气泡(showFootnote)。
   *   设计依据（心理模型）：用户潜意识认为弹出的浮层是「临时」的，点击背景 = 放弃操作 / 回到主界面。
   *   因此任何落在浮层之外的点击都应将其收起；浮层自身及按钮内的点击保持不变。
   * 实现：mousedown 监听绑到 reader-view 容器（不是 document），避免影响思源原生 UI：
   *   - target 在任一 popover / 工具栏 / 批注卡片内（含子元素）→ 不动（让其自身 click 处理）
   *   - target 在 toolbar 按钮上 → 不动（让 click 触发 toggle，避免先关再开抵消）
   *   - foliate 阅读区内点击 → 工具栏/批注窗口按 A/B 场景处理；脚注（独立浮层）一律收起
   *   - 其他 → 关闭所有 popover + 工具栏 + 批注窗口 + 脚注
   * 用 mousedown 而非 click：保证在按钮 mousedown 时不会先关掉（click toggle 还没触发）
   * 用 reader-view 容器监听（不是 document）的好处：思源顶栏/侧栏/命令面板/dock 的点击
   *   完全不触发本 listener → 不干扰思源原生 UI（如"管理"按钮）的点击时序。
   */
  function closeAllPopovers() {
    showToc = false;
    showSettings = false;
    showSearch = false;
    showFootnote = false;
    dictPopup = { ...dictPopup, visible: false };
    // 编辑态划词工具栏一并收起（重置为 create 态，避免残留 editingId）
    if (selToolbar.visible) closeSelToolbar();
  }

  function onContainerMouseDown(_e: MouseEvent) {
    // 每次点击重置抑制标志（每个点击独立判断）
    suppressNextCreateToolbar = false;
    // 2026-08-27：悬浮（hover）词典弹窗无遮罩，普通点击（如开始划选）应直接收起，避免遮挡。
    //   必须同时检查 dictPopup.visible：scheduleHoverHide 有 220ms 延迟关闭，
    //   在此窗口内 dictPopupSource 仍为 "hover" 但弹窗已不可见，
    //   若不检查 visible 会误拦截工具栏/标注等正常点击（#toolbar-unresponsive）。
    if (dictPopupSource === "hover" && dictPopup.visible) {
      // 点弹窗内部（★/候选词）交给 onDictBodyClick 处理，不在此收起
      const tg = _e.target as Element | null;
      if (tg && tg.closest?.(".reader-dict-popup")) return;
      closeDictPopup();
      return;
    }
    if (!showToc && !showSettings && !showSearch && !showFootnote && !selToolbar.visible && !noteEditor.visible) return;
    const t = _e.target as Element | null;
    if (!t) return;
    dbg.event("onContainerMouseDown", "▶ 入口", { target: t.tagName + "." + (typeof t.className === "string" ? t.className : ""), selVisible: selToolbar.visible, mode: selToolbar.mode });
    // 在 popover 内（含子元素）：不关
    if (t.closest?.(".reader-popover")) return;
    // 在划词工具栏 / 批注编辑卡片（含查看态）内：不关（让其自身 click 处理）
    if (t.closest?.(".reader-sel-toolbar")) return;
    if (t.closest?.(".reader-ann-editor")) return;
    if (t.closest?.(".reader-note-editor")) return;
    // 在 toolbar 按钮上（含返回/章节/设置/目录/搜索/进度条等）：
    // 不关，让 click 自行 toggle（toggle 在 mousedown 之后触发）
    if (t.closest?.(".reader-toolbar")) return;
    // 2026-08-25 修复（回归）：foliate 内容区的点击需区分两种场景：
    //   A) 点了标注/高亮/SVG 绘制层 → 延迟一帧关闭（让 show-annotation / 选区事件先触发，避免竞争）；
    //   B) 点了空白/普通文本 → **立即**关闭工具栏（无需等待，没有 show-annotation 会触发）。
    //   此前 bug：A/B 都走 RAF 延迟，但 B 路径的 RAF 可能被后续事件链意外取消或竞态吞掉，
    //   导致用户感知"点空白不关闭"。现在 B 路径走同步 closeSelToolbar，可靠即时响应。
    const isFoliateArea = !!(
      t.closest?.("reword-foliate-view") || (t as any).tagName === "reword-foliate-view"
    );
    const isAnnotationTarget = !!(
      t.closest?.("foliate-highlight") || (t as any).closest?.("[data-annotation]") ||
      (t as any).namespaceURI === "http://www.w3.org/2000/svg"
    );
    if (isFoliateArea) {
      dbg.step("onContainerMouseDown", "foliate 区域命中", { isAnnotationTarget, tag: t.tagName, cls: typeof t.className === "string" ? t.className : "" });
      if (isAnnotationTarget) {
        // 场景 A：点了标注/SVG → 抑制创建工具栏（show-annotation 会接管，弹 edit 工具栏或批注弹窗）
        suppressNextCreateToolbar = true;
        // 只关工具栏（让 show-annotation 随后处理批注弹窗）。
        // 不关 noteEditor：onShowAnnotation → showViewerForRec 会打开/切换批注弹窗，
        // 若这里用 RAF 关掉会产生竞态（RAF 在 show-annotation 之后执行 → 刚打开的弹窗被关掉）。
        cancelPendingClose();
        pendingCloseRaf = requestAnimationFrame(() => {
          pendingCloseRaf = null;
          if (selToolbar.visible) closeSelToolbar();
          // 注意：不关 noteEditor，由 onShowAnnotation / showViewerForRec 全权控制
        });
      } else {
        // 场景 B：点空白/普通文本 → 立即关闭
        closeSelToolbar();
        if (noteEditor.visible) noteEditor = { ...noteEditor, visible: false, mode: "create", id: null };
      }
      // 脚注是独立瞬时浮层，与标注/工具栏无耦合：在 foliate 阅读区任意点击都视为「点击外部」，
      // 立即收起（符合「点背景 = 放弃操作 / 回到主界面」的心理模型）。
      // 脚注气泡自身（.reader-popover）的点击已在上方提前 return，不会走到这里，故不会误关。
      if (showFootnote) closeFootnote();
      return;
    }
    // 其他区域（空白等）：关闭所有浮层 + 划词工具栏 + 统一批注浮层
    closeAllPopovers();
    if (selToolbar.visible) closeSelToolbar();
    if (noteEditor.visible) noteEditor = { ...noteEditor, visible: false, mode: "create", id: null };
  }

  // ============ 划词悬浮工具栏 + 即时词典（Phase 1） ============
  // 复用 dict-engine / dict-renderer：监听 foliate 内容选区，弹出微信读书 / Readest 式悬浮工具栏。
  // 选区可能落在 foliate 渲染进 iframe 的内容文档里，因此需扫描 view.renderer.getContents()
  // （每项含 { index, doc }），并对 iframe 偏移做坐标换算。
  interface SelRect { left: number; top: number; right: number; bottom: number; }
  interface ReaderSel { text: string; rect: SelRect; index: number; cfi: string | null; range: Range | null; }
  // 2026-08-29 四向避让：工具栏可置于选区的 上/下/左/右 四个方向，
  // 优先上下（视线不跳变），上下均无空间时退到右/左（垂直居中于选区），彻底避开选中文本。
  type ToolbarPlace = "above" | "below" | "left" | "right";
  interface SelToolbarState {
    visible: boolean;
    x: number;
    y: number;
    text: string;
    mode: "create" | "edit";
    editingId: string | null;
    // 工具栏朝向：四向避让结果。'above'/ 'below' 视线不跳变优先；'left'/'right' 上下无空间时退避。
    place: ToolbarPlace;
    // 2026-08-25 readest 风格：第二层样式条（3 样式 + 5 色）是否展开。
    // create 态点「高亮」按钮 toggle 展开；edit 态（点已有高亮）常显。
    stripVisible: boolean;
    // edit 态当前标注（删除 / 即时改样式 / 即时改颜色 用）
    annId: string | null;
    annCfi: string | null;
    // edit 态样式条的「当前样式/颜色」高亮（以 annStore 为唯一真源，进入时快照，改后同步）
    annStyle: AnnotationStyle | null;
    annColor: string | null;
    // 2026-08-24 死锁解除：数据层已无活跃记录、但视觉仍有残留高亮时，
    // 兜底分支置此字段，edit 工具栏显示「清除残留高亮」按钮（onClearGhostHighlight）。
    ghostCfi?: string | null;
  }

  let selToolbar: SelToolbarState = { visible: false, x: 0, y: 0, text: "", mode: "create", editingId: null, place: "above", stripVisible: false, annId: null, annCfi: null, annStyle: null, annColor: null };
  // 工具栏 DOM 引用（用于实测高度，替代写死的 44px）+ 实测高度缓存。
  // 首帧用默认 44 兜底，渲染后实测并缓存，后续翻面判断用真实高度，避免高处选区被裁切。
  let selToolbarEl: HTMLElement | null = null;
  // 预估高度常量：仅主栏（create 态默认）vs 含样式条+颜色条（edit 态/展开样式条）。
  // 2026-08-25 修复：原 toolbarH 写死 44 仅主栏高，样式条展开后实际 ~116px，
  // roomAbove 用 44 判定易假阳性选 above → 工具栏溢出压住选区文字。
  const TOOLBAR_BAR_ONLY_H = 48;
  const TOOLBAR_WITH_STRIP_H = 116;
  // 运行时实测高度缓存（渲染后实测，避免硬估值误差）。
  let toolbarH = TOOLBAR_BAR_ONLY_H;
  // 2026-08-25 延迟关闭：foliate 区域点击不立即关工具栏（避免与 show-annotation 竞争），
  // 而是预约一帧后关闭；若随后触发了选区/批注事件则取消。
  let pendingCloseRaf: number | null = null;
  // 2026-08-25 修复竞态：点批注/高亮时，onShowAnnotation 会打开编辑工具栏或批注弹窗，
  // 但同一次点击的 mouseup 也会触发 scheduleReadSelection → 创建模式工具栏。
  // 此标志告诉选区路径"本次点击已由 show-annotation 接管，不要弹创建工具栏"。
  let suppressNextCreateToolbar = false;
  // 当前选区的锚点信息（Phase 2 高亮 / 批注 / 导出思源将复用）
  let selInfo: { index: number; cfi: string | null; range: Range | null } | null = null;
  // 当前选区矩形（已换算到主文档坐标），供批注编辑器/查看气泡定位使用
  let lastSelRect: SelRect | null = null;
  let dictPopup: { visible: boolean; x: number; y: number; html: string; word?: string; source?: "sel" | "hover" | null } = { visible: false, x: 0, y: 0, html: "", word: "", source: null };
  // 2026-08-27：Option+悬浮取词（英文）相关状态
  let dictPopupEl: HTMLElement | null = null;       // 弹窗 DOM 引用（用于命中检测）
  let dictPopupSource: "sel" | "hover" | null = null; // 当前弹窗来源（sel=划词工具栏, hover=悬浮）

  let hoverHideTimer: any = null;                   // 悬浮弹窗延迟收起计时器
  let hoverWord: string | null = null;             // 当前悬浮命中的单词（去重用）
  let toastMsg = "";
  let toastTimer: any = null;

  // ===== Phase 2：书籍批注（高亮 + 批注）状态 =====
  // 批注数据层单例（index.ts 初始化后注入；懒取，容错）
  let annStore: any = null;
  // cfi → 渲染记录（show-annotation 时反查 note / id）
  // annByValue 只存 {id, cfi, color}：note/style 一律以 annStore 为唯一真源。
  // 避免三处 note 拷贝不一致（2026-08-24 重构）。
  const annByValue = new Map<string, { id: string; cfi: string; color: string }>();
  // cfi → 章节索引 懒缓存：避免每次翻页（create-overlay）都对全书批注做 O(N) 的 resolveNavigation 重解析。
  // 章节 overlay 创建时只重加属于该章节的批注，根除翻页闪烁与性能悬崖。
  const annIndexCache = new Map<string, number>();
  // 上次选用的样式/颜色/分组（高亮/批注复用，贴近微信读书「一键高亮」体验）
  let lastStyle: AnnotationStyle = getDefaultAnnotationStyle();
  let lastColor: string = getDefaultAnnotationColor(); // 默认=用户配置色
  let lastGroup: string = "未分组";
  // 2026-08-24 根治：当前编辑/待删除标注的独立缓存，不随 selToolbar 状态重置而丢失。
  // 修复「删除按钮点击时 selToolbar.editingId 已被选区检测(ws)/关闭逻辑重置为 undefined/null，
  // 导致 onAnnDeleteById 第一行 return 的死锁」。删除时优先读这两个变量。
  let activeAnnId: string | null = null;
  let activeAnnCfi: string | null = null;
  // 统一批注浮层（readest 重设计：创建 / 查看 / 编辑 三态合一，均锚定在选区下方）。
  // - mode='create'：阅读工具栏「批注」按钮打开，新建批注（预填默认色，焦点落在输入框）。
  // - mode='view'：点击书中已有高亮打开，紧凑查看卡（时间 + 原文 + 批注 + 标签 + 即时改色/样式 + 复制/编辑/删除）。
  // - mode='edit'：查看态点「编辑」就地切到编辑态（同一张卡片，位置不跳变）。
  // styleLabel/styleGlyph 预计算，以避开 Svelte4 模板表达式不支持的 ?./?? 运算符。
  let noteEditor: {
    visible: boolean; x: number; y: number;
    mode: "create" | "view" | "edit" | "highlight";
    id: string | null; cfi: string; text: string;
    style: AnnotationStyle; color: string; note: string; group: string;
    time: string; // 格式化时间（view 态展示，updatedAt / createdAt）
    labels: { id: string; name: string; color: string }[]; // view 态展示
    styleLabel: string; // 样式中文名（如「直线」）
    styleGlyph: string; // 样式字形（如 ━）
    place: ToolbarPlace; // 2026-08-29 四向避让（above|below|left|right），绝不压住选中文本
  } = {
    visible: false, x: 0, y: 0, mode: "create",
    id: null, cfi: "", text: "",
    style: getDefaultAnnotationStyle(), color: getDefaultAnnotationColor(), note: "", group: "未分组",
    time: "", labels: [], styleLabel: "直线", styleGlyph: "━",
    place: "below",
  };
  let noteEditorEl: HTMLElement | null = null;

  /** 取消延迟关闭（选区/批注事件触发时调用，防止工具栏被误关） */
  function cancelPendingClose() {
    if (pendingCloseRaf != null) {
      cancelAnimationFrame(pendingCloseRaf);
      pendingCloseRaf = null;
    }
  }

  /**
   * 统一关闭划词工具栏 + 清除选区锚点（P0 R1）。
   * 所有 onSel* 出口、删除、取消、空白处 mousedown 都应走这里。
   * 注意：不重置 lastStyle/lastColor（保留用户上次偏好，贴近微信读书一键高亮体验）。
   */
  function closeSelToolbar() {
    cancelPendingClose(); // 关闭时顺带取消延迟关闭（防重复）
    selToolbar = { visible: false, x: 0, y: 0, text: "", mode: "create", editingId: null, place: "above", stripVisible: false, annId: null, annCfi: null, annStyle: null, annColor: null };
    selInfo = null;
    activeAnnId = null;
    activeAnnCfi = null;
  }

  // 已挂监听的内容文档（用 Set 而非 WeakSet，便于 onDestroy 时遍历移除，避免泄漏）
  // 2026-08-23 修复：foliate-view 使用 shadow DOM，container.querySelectorAll('iframe')
  // 无法找到内容 iframe；改为通过 view.renderer.getContents() 取 doc 直接挂监听。
  const attachedDocs = new Set<Document>();
  // 每个内容文档上注入的全部监听登记在此，便于统一移除（含 setupZoneClick / injectPageTurn 直接绑到 doc 的监听）
  const docCleanups = new Map<Document, Array<{ type: string; fn: EventListenerOrEventListenerObject; opts?: boolean | AddEventListenerOptions }>>();

  /** 给内容文档加监听并登记，确保 detachAllContentDocs 能统一移除（根治重复绑定/翻两页） */
  function trackDocListener(doc: Document, type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) {
    doc.addEventListener(type, fn, opts);
    let arr = docCleanups.get(doc);
    if (!arr) { arr = []; docCleanups.set(doc, arr); }
    arr.push({ type, fn, opts });
  }

  function attachContentDoc(doc: Document | null | undefined) {
    if (!doc || attachedDocs.has(doc)) return;
    attachedDocs.add(doc);
    // mouseup 用 capture 阶段，确保先于 clickToTurn 的 bubble 监听处理
    trackDocListener(doc, "mouseup", onContentMouseUp, true);
    // 2026-08-27：iframe 内 mousedown 补盲区（父容器监听收不到 iframe 点击）→ 点空白立即收工具栏
    trackDocListener(doc, "mousedown", onContentMouseDown, true);
    // selectionchange 在 document 上触发，不会冒泡到 window，必须挂在 doc 上
    trackDocListener(doc, "selectionchange", onContentSelectionChange, true);
    // 2026-08-27 晚（P2.1）：脚注悬停预览——mouseover 委托，命中脚注引用防抖弹气泡
    trackDocListener(doc, "mouseover", onFootnoteHover as EventListener);
    // 2026-08-29：点击脚注气泡外部（内容区）关闭；捕获阶段先于 onBookLink 的 link 事件
    trackDocListener(doc, "pointerdown", onFootnoteOutsidePointerDown as EventListener, true);
    // 2026-08-27 晚（P2.2）：专注模式滚动高亮（capture 捕获内部滚动容器）
    trackDocListener(doc, "scroll", ((_e: Event) => onFocusScroll(doc)) as EventListener, true);
    // [REword patch 2026-08-29] PDF ⌘/Ctrl+滚轮缩放：
    // wheel 事件不跨 iframe 边界，必须挂到内容文档里才能收到页面上的滚轮。
    // 仅 PDF 挂载——EPUB 滚动模式下挂 passive:false 的 wheel 监听会让
    // 浏览器放弃滚轮滚动的合成器优化（滚动要等主线程），是实打实的卡顿源。
    // 必须 capture:true —— foliate 在同一个 doc 上挂了【冒泡阶段】的 wheel
    // （vendor/foliate-js/fixed-layout.js:1082，横向滚动模式转纵向滚轮用）。
    // 捕获阶段先于冒泡阶段执行，我们才能在 foliate 之前拿到事件，
    // 命中后用 stopImmediatePropagation 连它一起挡掉，避免两边各处理一次。
    if (isPdfBook()) {
      trackDocListener(doc, "wheel", onContentWheel as EventListener, { capture: true, passive: false });
    }
    // 翻页/分区点击等交互监听（仅注入一次，guard 由 attachedDocs 保证，避免重复绑定导致翻两页）
    injectPageTurn(doc);
    // 2026-08-27 晚（P2.2）：新文档就绪时按当前专注模式状态应用高亮 class
    if (settings.focusMode) applyFocusMode();
    // 2026-08-28 C2：新文档就绪时按段落悬停开关应用 class
    applyParagraphHover();
    // 2026-08-28 分类字体：新文档就绪时重写 EPUB 内联字体族关键词。
    // 挂在 attachContentDoc 而非 relocate——foliate 翻页会重建内容文档，
    // 只有这里能保证每个新 section 都被处理到（CSS 变量运行时解析，不依赖先后顺序）。
    if (settings.fontMode === "classified") {
      try {
        rewriteFontKeywordsInDocument(doc);
      } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · try { rewriteFontKeywordsInDocument(doc); }", "debug"); }
    }
  }

  /** 卸载所有内容文档上的监听（与 attachContentDoc 对称），反复进出阅读 Tab 不泄漏 */
  function detachAllContentDocs() {
    for (const doc of attachedDocs) {
      const arr = docCleanups.get(doc);
      if (arr) {
        for (const h of arr) {
          try { doc.removeEventListener(h.type, h.fn, h.opts); } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · detachAllContentDocs", "debug"); }
        }
      }
      docCleanups.delete(doc);
    }
    attachedDocs.clear();
  }

  function attachAllContentDocs() {
    if (!view || !view.renderer || typeof view.renderer.getContents !== "function") return;
    let contents: any[] = [];
    try { contents = view.renderer.getContents() || []; } catch { return; }
    contents.forEach((c: any) => {
      try { attachContentDoc(c.doc); } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · attachAllContentDocs", "debug"); }
    });
  }

  // 从 foliate 内容文档中读取当前选区；返回 null 表示无有效选区
  function readReaderSelection(): ReaderSel | null {
    if (!view || !view.renderer || typeof view.renderer.getContents !== "function") return null;
    let contents: any[] = [];
    try { contents = view.renderer.getContents() || []; } catch { return null; }
    for (const c of contents) {
      const doc = c.doc;
      const win = doc?.defaultView;
      if (!win || typeof win.getSelection !== "function") continue;
      const sel = win.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) continue;
      const range = sel.getRangeAt(0);
      const text = (sel.toString() || "").trim();
      if (!text) continue;
      const r = range.getBoundingClientRect();
      // 2026-08-25 优化：锚定到选区「末端」(last client rect)，
      // 即鼠标松开处所在的最后一行，多行选区时工具栏贴近光标释放点、更跟手；
      // 此前用整段 bounding rect 的中心，长段落会把工具栏甩到选区顶端中央、远离光标。
      const rects = range.getClientRects();
      const endRect = (rects && rects.length) ? rects[rects.length - 1] : r;
      // 内容可能在 iframe 内：把 iframe 在视口中的位置换算进主文档坐标
      let left = endRect.left, top = endRect.top, right = endRect.right, bottom = endRect.bottom;
      const frame = (win as any).frameElement as HTMLElement | null;
      if (frame) {
        const fr = frame.getBoundingClientRect();
        left += fr.left; top += fr.top; right += fr.left; bottom += fr.top;
      }
      let cfi: string | null = null;
      try {
        if (typeof c.index === "number" && typeof view.getCFI === "function") {
          cfi = view.getCFI(c.index, range);
        }
      } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · try { if (typeof c.index === \"number\" && typeof view.getCFI ===…", "debug"); }
      return { text, rect: { left, top, right, bottom }, index: c.index, cfi, range };
    }
    return null;
  }

  /** 将划词工具栏定位到指定视口矩形上方/下方（微信读书风格）。
   *  - 坐标契约：rect 为视口坐标（create 路径来自 readReaderSelection，edit 路径来自
   *    onShowAnnotation 已加 iframe 帧偏移），统一经 toContainerCoords 转换为 .reader-view
   *    相对坐标（工具栏绝对定位于 .reader-floating-layer，原点即 reader-view 左上角）。
   *  - 朝向判断用「实测工具栏高度」toolbarH（首帧兜底 44，渲染后实测缓存），替代写死的 44px，
   *    解决顶部选区因高度估计偏差而被裁切的问题（Task #5）。
   *  - transform: translate(-50%,-100%)（上方）/ translate(-50%,0)（下方）由 CSS 按 placeAbove 处理，
   *    故锚点 y 直接取选区上沿-gap（上方）或下沿+gap（下方），无需手算整体高度。
   *  - 2026-08-25 优化：动态获取导航栏/底栏实际高度，确保工具栏不与两者重叠；
   *    上方空间不足时自动翻到下方，反之亦然。 */
  /**
   * 2026-08-29 四向避让核心：给定选区矩形与工具栏尺寸，返回最佳放置方向与锚点（视口坐标）。
   * 避让目标 = 选中文本自身（绝不压住选区），并受导航栏/底栏/视口约束。
   *   优先级：优先上下（视线不跳变，按选区在可读区中部上下偏好），
   *           上下均无空间 → 退到右/左（垂直居中于选区，仅当整条工具栏能容纳于视口内）。
   *   四方向皆无空间（极端小窗口）→ 选溢出最小者，交由 refineToolbarPlacement 兜底夹紧。
   * 返回的 anchor 即 selToolbar.(x,y) 对应的视口锚点：
   *   above → 选区上沿 - gap（工具栏底部贴此，CSS translate(-50%,-100%)）
   *   below → 选区下沿 + gap（工具栏顶部贴此，CSS translate(-50%,0)）
   *   left  → 选区左沿 - gap、垂直居中（CSS translate(-100%,-50%)）
   *   right → 选区右沿 + gap、垂直居中（CSS translate(0,-50%)）
   */
  function toolbarPlacement(
    rect: SelRect, h: number, w: number,
    navBottom: number, bottomTop: number, viewW: number, gap: number
  ): { place: ToolbarPlace; anchorX: number; anchorY: number } {
    const midX = (rect.left + rect.right) / 2;
    const selCenterY = (rect.top + rect.bottom) / 2;
    const PAD = 8;
    // 侧放时整条工具栏需垂直居中于选区且不越导航/底栏
    const vFit = (selCenterY - h / 2) >= navBottom && (selCenterY + h / 2) <= bottomTop;
    const roomAbove = (rect.top - gap - h) >= navBottom;
    const roomBelow = (rect.bottom + gap + h) <= bottomTop;
    const roomLeft = vFit && (rect.left - gap - w) >= PAD;
    const roomRight = vFit && (rect.right + gap + w) <= (viewW - PAD);
    const readableCenter = (navBottom + bottomTop) / 2;
    const preferBelow = selCenterY < readableCenter; // 选区在上半部 → 优先下方

    let place: ToolbarPlace;
    if (preferBelow && roomBelow) place = "below";
    else if (!preferBelow && roomAbove) place = "above";
    else if (roomAbove) place = "above";
    else if (roomBelow) place = "below";
    else if (roomRight) place = "right";
    else if (roomLeft) place = "left";
    else {
      // 四向皆无足够空间：选溢出最小者（best-effort），refine 再做最终夹紧
      const oA = Math.max(0, navBottom - (rect.top - gap - h));
      const oB = Math.max(0, (rect.bottom + gap + h) - bottomTop);
      const oL = Math.max(0, PAD - (rect.left - gap - w));
      const oR = Math.max(0, (rect.right + gap + w) - (viewW - PAD));
      const cand: [ToolbarPlace, number][] = [["above", oA], ["below", oB], ["right", oR], ["left", oL]];
      cand.sort((a, b) => a[1] - b[1]);
      place = cand[0][0];
    }

    let anchorX = midX, anchorY = selCenterY;
    if (place === "above") anchorY = rect.top - gap;
    else if (place === "below") anchorY = rect.bottom + gap;
    else if (place === "left") anchorX = rect.left - gap;
    else anchorX = rect.right + gap; // right
    return { place, anchorX, anchorY };
  }

  function positionToolbarAbove(rect: SelRect, text: string, mode: "create" | "edit", editingId: string | null) {
    cancelPendingClose(); // 选区触发 → 取消延迟关闭
    lastSelRect = rect; // 保存选区矩形，供批注编辑器定位使用
    const gap = 12;
    const viewW = readerViewEl?.clientWidth ?? window.innerWidth;
    // 导航栏/底栏取其在视口中的真实下沿/上沿，与 rect（视口坐标）同基准比较。
    const navBarEl = readerViewEl?.querySelector<HTMLElement>(".reader-toolbar");
    const bottomBarEl = readerViewEl?.querySelector<HTMLElement>(".reader-bottom-bar");
    const navBottom = navBarEl ? navBarEl.getBoundingClientRect().bottom : 40;
    const bottomTop = bottomBarEl ? bottomBarEl.getBoundingClientRect().top : (window.innerHeight - 36);
    // 预估有效高度：edit 态或样式条展开时含整条浮层（主栏+样式条+颜色条），否则仅主栏。
    const stripShown = mode === "edit" || selToolbar.stripVisible;
    const effH = stripShown ? TOOLBAR_WITH_STRIP_H : TOOLBAR_BAR_ONLY_H;
    // 工具栏宽度首帧无实测值 → 用上次实测/兜底估计，refine 会用真实宽度校正。
    const effW = selToolbarEl?.getBoundingClientRect().width || (stripShown ? 420 : 380);
    // ★ 2026-08-29 四向避让：算最佳方向 + 锚点，绝不压住选中文本。
    const { place, anchorX, anchorY } = toolbarPlacement(rect, effH, effW, navBottom, bottomTop, viewW, gap);
    const c = toContainerCoords(anchorX, anchorY);
    selToolbar = { visible: true, x: c.x, y: c.y, text, mode, editingId, place, stripVisible: selToolbar.stripVisible };
    if (DEBUG_READER) {
      console.log("[REword][pos] positionToolbarAbove", {
        mode, editingId,
        rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right) },
        gap, effH, effW, place,
        anchor: { x: Math.round(anchorX), y: Math.round(anchorY) },
        navBottom: Math.round(navBottom), bottomTop: Math.round(bottomTop),
        toContainer: { x: Math.round(c.x), y: Math.round(c.y) },
        final: { x: Math.round(selToolbar.x), y: Math.round(selToolbar.y), place: selToolbar.place, stripVisible: selToolbar.stripVisible },
      });
    }
    void fixToolbarPlacement(rect, gap);
  }

  /**
   * 2026-08-26 重写（v3 锚点坐标系版）：渲染后实测校正工具栏位置。
   *
   * ★ 核心修复：CSS transform 已处理 Y 偏移（上方 -100% 让底部对齐锚点，
   *   下方 place-below 的 0% 让顶部对齐锚点），故所有校正路径
   *   必须计算「锚点 Y」而非「绝对位置 Y」，否则与 CSS transform 叠加导致双重偏移。
   *
   * 锚点定义：
   *   - 上方模式：锚点 = 工具栏底部应在的视口 Y（CSS -100% 后底部恰好在此）
   *   - 下方模式：锚点 = 工具栏顶部应在的视口 Y（CSS 0% 后顶部恰好在此）
   */
  async function fixToolbarPlacement(rect: SelRect, gap: number) {
    try {
      await tick();
      const el = selToolbarEl;
      if (!el) return;
      const box = el.getBoundingClientRect(); // 视口坐标，与 rect 同基准
      const h = box.height;
      const w = box.width;
      if (h > 0) toolbarH = h;
      if (DEBUG_READER) {
        console.log("[REword][fix] 实测", {
          place: selToolbar.place,
          box: { t: Math.round(box.top), b: Math.round(box.bottom), l: Math.round(box.left), r: Math.round(box.right), h: Math.round(h), w: Math.round(w) },
          rect: { t: Math.round(rect.top), b: Math.round(rect.bottom), l: Math.round(rect.left), r: Math.round(rect.right) },
        });
      }
      const viewW = readerViewEl?.clientWidth ?? window.innerWidth;
      const navBarEl = readerViewEl?.querySelector<HTMLElement>(".reader-toolbar");
      const bottomBarEl = readerViewEl?.querySelector<HTMLElement>(".reader-bottom-bar");
      const navBottom = navBarEl ? navBarEl.getBoundingClientRect().bottom : 40;
      const bottomTop = bottomBarEl ? bottomBarEl.getBoundingClientRect().top : (window.innerHeight - 36);
      const midX = (rect.left + rect.right) / 2;
      const selCenterY = (rect.top + rect.bottom) / 2;
      const MIN_GAP = 10;
      const PAD = 8;
      const place = selToolbar.place;
      // 依据当前方向重算锚点（视口坐标）
      let anchorX = midX, anchorY = selCenterY;
      if (place === "above") anchorY = rect.top - gap;
      else if (place === "below") anchorY = rect.bottom + gap;
      else if (place === "left") anchorX = rect.left - gap;
      else anchorX = rect.right + gap; // right

      let newPlace = place;
      if (place === "above" || place === "below") {
        // 水平夹紧（按中心）
        if (w > 0) {
          const half = w / 2 + PAD;
          const clampedX = Math.min(Math.max(anchorX, half), Math.max(half, viewW - half));
          if (clampedX !== anchorX) anchorX = clampedX;
        }
        const spacing = place === "above" ? (rect.top - box.bottom) : (box.top - rect.bottom);
        const withinBars = place === "above" ? (box.top >= navBottom) : (box.bottom <= bottomTop);
        if (spacing >= MIN_GAP && withinBars) {
          // 位置正确，无需校正
        } else {
          const other = place === "above" ? "below" : "above";
          const roomOther = other === "above"
            ? (rect.top - gap - h) >= navBottom
            : (rect.bottom + gap + h) <= bottomTop;
          if (roomOther) {
            newPlace = other;
            anchorY = other === "above" ? (rect.top - gap) : (rect.bottom + gap);
          } else if (place === "above" && box.top < navBottom) {
            anchorY = navBottom + h; newPlace = "above"; // 贴导航栏下沿
          } else if (place === "below" && box.bottom > bottomTop) {
            anchorY = bottomTop - h; newPlace = "below"; // 贴底栏上沿
          } else {
            anchorY = place === "above" ? (rect.top - MIN_GAP) : (rect.bottom + MIN_GAP);
            newPlace = place;
          }
        }
      } else {
        // 左/右：垂直居中并夹在导航栏/底栏之间；水平夹在视口内
        const halfH = h / 2 + PAD;
        if (anchorY - halfH < navBottom) anchorY = navBottom + halfH;
        else if (anchorY + halfH > bottomTop) anchorY = bottomTop - halfH;
        if (place === "left") {
          const minAnchorX = PAD + w; // 工具栏右沿(=anchorX)须 >= PAD+w，整条在视口内
          if (anchorX < minAnchorX) anchorX = minAnchorX;
        } else {
          const maxAnchorX = viewW - PAD; // 工具栏左沿(=anchorX)须 <= viewW-PAD
          if (anchorX > maxAnchorX) anchorX = maxAnchorX;
        }
        newPlace = place;
      }
      const c = toContainerCoords(anchorX, anchorY);
      selToolbar = { ...selToolbar, x: c.x, y: c.y, place: newPlace };
      if (DEBUG_READER) {
        void tick().then(() => {
          const a = el?.getBoundingClientRect();
          console.log("[REword][fix] 校正后", {
            newPlace, anchorX: Math.round(anchorX), anchorY: Math.round(anchorY), cx: Math.round(c.x), cy: Math.round(c.y),
            actual: a ? { t: Math.round(a.top), b: Math.round(a.bottom), l: Math.round(a.left), r: Math.round(a.right) } : null,
          });
        });
      }
    } catch (e) {
      console.warn("[REword][fix] 异常:", e);
    }
  }

  /** 把 ISO 时间格式化为「YYYY-MM-DD HH:mm」便于查看气泡展示 */
  function fmtTime(iso?: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 把标签 id 列表解析为 {id, name, color}（委托插件 LabelStore；缺失时降级为 id 文本） */
  function resolveLabels(ids: string[] | undefined): { id: string; name: string; color: string }[] {
    if (!ids || !ids.length) return [];
    return ids.map((id) => {
      const info = getLabel ? getLabel(id) : null;
      return { id, name: info?.name ?? id, color: info?.color ?? "#9ca3af" };
    });
  }

  /**
   * 统一浮层（批注编辑器 / 查看卡）定位：锚定选区 + 四向避让 + 边界夹紧。
   * 替代此前分散在 editorPosition / openNoteEditor / showViewerForRec 的三套重复逻辑。
   * 机制（参考 readest / Weave 的 popover 思路）：
   *   - 复用工具栏同款 toolbarPlacement 纯函数决策 上/下/左/右 四向，绝不压住选中文本，
   *     同时避让导航栏 / 底栏 / 视口边界。
   *   - 锚点：above=选区上沿-gap（CSS translate(-50%,-100%)）、below=下沿+gap、
   *     left=左沿-gap 垂直居中（translate(-100%,-50%)）、right=右沿+gap 垂直居中（translate(0,-50%)）。
   *   - 上下两向额外做水平夹紧；左右两向额外做垂直夹紧，确保弹窗完整可见。
   * @param rect 选区/高亮矩形（视口坐标，已含 iframe 帧偏移）
   * @param popupW 弹窗宽度 px（必须与 CSS .reader-note-editor width 一致，含 padding）
   * @param popupH 弹窗预估高度 px（用于左右空间判定）
   */
  function positionPopupNear(rect: SelRect | null | undefined, popupW: number, popupH: number): { x: number; y: number; place: ToolbarPlace } {
    if (!rect) {
      // 无矩形（C 跳转后）：顶部居中（下方展开，不被顶栏遮挡）
      return { x: (readerViewEl?.clientWidth ?? window.innerWidth) / 2, y: 80, place: "below" };
    }
    const gap = 8;
    const padding = 8;
    const viewW = readerViewEl?.clientWidth ?? window.innerWidth;
    // 导航栏/底栏取其在视口中的真实下沿/上沿，与 rect（视口坐标）同基准比较。
    const navBarEl = readerViewEl?.querySelector<HTMLElement>(".reader-toolbar");
    const bottomBarEl = readerViewEl?.querySelector<HTMLElement>(".reader-bottom-bar");
    const navBottom = navBarEl ? navBarEl.getBoundingClientRect().bottom : 40;
    const bottomTop = bottomBarEl ? bottomBarEl.getBoundingClientRect().top : (window.innerHeight - 36);
    // 2026-08-29 四向避让：复用工具栏同款决策（绝不压住选中文本 + 避让导航/底栏）。
    const { place, anchorX, anchorY } = toolbarPlacement(rect, popupH, popupW, navBottom, bottomTop, viewW, gap);
    let c = toContainerCoords(anchorX, anchorY);
    if (place === "above" || place === "below") {
      // 水平夹紧：弹窗以 x 为中心（CSS translate(-50%,...)），保证不溢出/不压侧栏
      const half = popupW / 2 + padding;
      const minX = half;
      const maxX = Math.max(half, viewW - half);
      c.x = Math.min(Math.max(c.x, minX), maxX);
    } else {
      // 左右：垂直居中于选区，夹紧 y 使弹窗不越导航/底栏
      const half = popupH / 2 + padding;
      const minY = navBottom + half;                 // 视口坐标
      const maxY = Math.max(minY, bottomTop - half); // 视口坐标
      const clampedAnchorY = Math.min(Math.max(anchorY, minY), maxY);
      c = toContainerCoords(anchorX, clampedAnchorY);
    }
    return { x: c.x, y: c.y, place };
  }

  /** 根据标注记录填充并弹「简易预览卡」（preview 态）。
   *  2026-08-26 用户设计：有笔记批注 → 先弹只读预览（时间+笔记+标签+复制/编辑/删除图标），
   *  点「✏️ 笔记」才展开完整编辑器 (mode="edit")。 */
  function showPreviewViewer(rec: { id: string; cfi: string; color: string }, rect?: SelRect | null) {
    if (!annStore) { try { annStore = getAnnotationStore(); } catch { annStore = null; } }
    const stored = annStore?.get(rec.id);
    dbg.event("showPreviewViewer", "▶ 批注预览卡路径", { id: rec?.id, cfi: rec?.cfi, classify: stored ? classifyAnnotation(stored) : "?" });
    closeSelToolbar();
    const style = (stored?.style as AnnotationStyle) || "highlight";
    const color = stored?.color || rec.color;
    lastStyle = style; lastColor = color; // 同步偏好，供「编辑」复用
    const text = stored?.selectedText ?? stored?.note ?? "";
    const note = stored?.note ?? "";
    const group = stored?.group ?? "未分组";
    const time = fmtTime(stored?.updatedAt || stored?.createdAt);
    const labels = resolveLabels(stored?.labels);
    // 统一用 positionPopupNear（锚定 + 四向避让 + 水平/垂直夹紧）。preview 态预估高度 160。
    const pos = rect
      ? positionPopupNear(rect, 268, 160)
      : { x: (readerViewEl?.clientWidth ?? window.innerWidth) / 2, y: 80, place: "below" as ToolbarPlace };
    const annStyle = ANNOTATION_STYLES[style] || { label: "直线", icon: "━" };
    noteEditor = {
      visible: true, x: pos.x, y: pos.y, mode: "preview",
      id: rec.id, cfi: rec.cfi,
      text, note, style, color, group, time, labels,
      styleLabel: annStyle.label, styleGlyph: annStyle.icon,
      place: pos.place,
    };
  }

  /** 根据标注记录填充并弹「查看浮层」（view 态，保留兼容 C 跳转兜底） */
  function showViewerForRec(rec: { id: string; cfi: string; color: string }, rect?: SelRect | null) {
    showPreviewViewer(rec, rect);
  }

  /**
   * 纯高亮（标注）点击 → 复用 selToolbar 进入 edit 模式（不弹独立浮层）。
   * 设计（2026-08-26 用户确认）：
   *   - 工具栏主栏「高亮」按钮位置 → 替换为「🗑️ 删除」按钮
   *   - 样式条自动展开（样式 + 颜色即时切换）
   *   - 仅「点击已有标注」触发，选新文本不受影响（create 模式不变）
   * 定位：上方空间够则放选区上方（底部贴 rect.top - gap），否则翻下方。
   */
  function openHighlightEditToolbar(rec: { id: string; cfi: string; color: string }, rect?: SelRect | null) {
    if (!annStore) { try { annStore = getAnnotationStore(); } catch { annStore = null; } }
    const stored = annStore?.get(rec.id);
    const style = (stored?.style as AnnotationStyle) || "highlight";
    const color = stored?.color || rec.color;
    lastStyle = style; lastColor = color; // 同步偏好，供样式/颜色切换复用
    const viewW = readerViewEl?.clientWidth ?? window.innerWidth;
    const midX = rect ? (rect.left + rect.right) / 2 : viewW / 2;
    const navBarEl = readerViewEl?.querySelector<HTMLElement>(".reader-toolbar");
    const bottomBarEl = readerViewEl?.querySelector<HTMLElement>(".reader-bottom-bar");
    const navBottom = navBarEl ? navBarEl.getBoundingClientRect().bottom : 40;
    const bottomTop = bottomBarEl ? bottomBarEl.getBoundingClientRect().top : (window.innerHeight - 36);
    // 2026-08-29 四向避让：edit 态含样式条+颜色条（更高更宽），用 toolbarPlacement 统一决策上/下/左/右。
    const gap = 12;
    const effH = TOOLBAR_WITH_STRIP_H;
    const effW = selToolbarEl?.getBoundingClientRect().width || 420;
    const fallbackRect: SelRect = rect ?? { left: midX, top: 80, right: midX, bottom: 80 };
    const { place, anchorX, anchorY } = toolbarPlacement(fallbackRect, effH, effW, navBottom, bottomTop, viewW, gap);
    const c = toContainerCoords(anchorX, anchorY);
    selToolbar = {
      visible: true, x: c.x, y: c.y,
      text: stored?.selectedText ?? "", mode: "edit",
      editingId: rec.id, place,
      stripVisible: true,   // 样式条展开
      annId: rec.id, annCfi: rec.cfi, annStyle: style, annColor: color,
    };
    // 渲染后实测校正，确保不压选区
    void fixToolbarPlacement(fallbackRect, gap);
  }

  /**
   * 纯高亮（标注）样式面板：仅提供「样式切换 + 颜色切换 + 删除」，不含时间/笔记/复制/编辑，
   * 与批注查看卡 (mode:"view") 完全隔离。用于 onShowAnnotation 判定 isPureHighlight 时的入口。
   * 复用 positionPopupNear 定位；预估高度 120（两行 + 删除按钮，比 view 卡矮）。
   * （2026-08-26 已废弃：纯标注改走 openHighlightEditToolbar，保留函数供 C 跳转兜底）
   */
  function showHighlightViewer(rec: { id: string; cfi: string; color: string }, rect?: SelRect | null) {    if (!annStore) { try { annStore = getAnnotationStore(); } catch { annStore = null; } }
    const stored = annStore?.get(rec.id);
    closeSelToolbar();
    const style = (stored?.style as AnnotationStyle) || "highlight";
    const color = stored?.color || rec.color;
    lastStyle = style; lastColor = color; // 同步偏好，供「高亮」复用
    const pos = rect
      ? positionPopupNear(rect, 268, 120)
      : { x: (readerViewEl?.clientWidth ?? window.innerWidth) / 2, y: 80, place: "below" as ToolbarPlace };
    const annStyle = ANNOTATION_STYLES[style] || { label: "直线", icon: "━" };
    noteEditor = {
      visible: true, x: pos.x, y: pos.y, mode: "highlight",
      id: rec.id, cfi: rec.cfi,
      text: "", note: "", style, color, group: stored?.group ?? "未分组", time: "",
      labels: [], styleLabel: annStyle.label, styleGlyph: annStyle.icon,
      place: pos.place,
    };
  }

  /** C 跳转：按 cfi 反查标注记录并弹查看浮层（无矩形则顶部居中） */
  function showViewerForCfi(cfi: string) {
    if (!cfi) return;
    if (!annStore) { try { annStore = getAnnotationStore(); } catch { annStore = null; } }
    let rec: { id: string; cfi: string; color: string } | null = annByValue.get(cfi) ?? null;
    if (!rec && annStore && bookId) {
      const nc = (s: string) => String(s || "").replace(/^epubcfi\(/i, "").replace(/\)+$/, "");
      const target = nc(cfi);
      const hit = annStore.getByBook(bookId).find((it: any) => {
        const a = nc(it.cfi);
        return a === target || (a && (a.startsWith(target) || target.startsWith(a)));
      });
      if (hit) rec = { id: hit.id, cfi: hit.cfi, color: hit.color };
    }
    if (!rec) { toast("未找到该阅读批注"); return; }
    showViewerForRec(rec, null);
  }

  /** 关闭统一批注浮层 */
  function closeNoteEditor() {
    noteEditor = { ...noteEditor, visible: false, mode: "create", id: null, place: "below" };
  }

  /** 通知侧边栏：阅读器内标注数据已变更（新增/更新/删除），需重新渲染 */
  function dispatchAnnotationChanged() {
    try {
      window.dispatchEvent(new CustomEvent("reword:annotation-store-changed"));
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · dispatchAnnotationChanged", "debug"); }
  }

  // 自动聚焦批注输入框（create/edit 态 textarea 渲染后聚焦，readest 批注即打字）
  function focusNoteInput(node: HTMLTextAreaElement) {
    node.focus();
  }

  /** C 跳转定位（由 ReaderTabController.focusAnnotation 调用）：等待 foliate view 就绪 → goTo 跳转 → 弹查看气泡 */
  export async function focusAnnotation(cfi: string) {
    if (!cfi) return;
    // 等待 foliate view 就绪（书籍异步加载，openBookTab 返回时未必已挂载完成）
    let tries = 0;
    while (tries < 25) {
      if (view && typeof (view as any).goTo === "function") break;
      await new Promise((r) => setTimeout(r, 120));
      tries++;
    }
    try {
      await (view as any)?.goTo(cfi);
    } catch (e) {
      console.warn("[REword] focusAnnotation goTo 失败:", e);
    }
    // 跳转后高亮应已在视口；按 cfi 反查记录并弹查看气泡（无矩形 → 顶部居中）
    showViewerForCfi(cfi);
  }

  function showToolbarFor(sel: ReaderSel) {
    // 2026-08-25 竞态防护：若 onContainerMouseDown 已检测到点了标注（suppressNextCreateToolbar=true），
    // 说明 show-annotation 会接管本次点击（弹 edit 工具栏或批注弹窗），跳过创建工具栏。
    if (suppressNextCreateToolbar) {
      console.log("[REword] showToolbarFor: suppressNextCreateToolbar=true，跳过创建工具栏（已由 show-annotation 接管）");
      suppressNextCreateToolbar = false; // 消费后立即重置
      return;
    }
    positionToolbarAbove(sel.rect, sel.text, "create", null);
  }

  function setSelFrom(sel: ReaderSel | null) {
    if (sel) {
      selInfo = { index: sel.index, cfi: sel.cfi, range: sel.range };
      showToolbarFor(sel);
    } else {
      closeSelToolbar();
    }
  }

  // 2026-08-24 修复（问题1）：拖动选词过程中只记录状态、不弹出工具栏。
  // 原先这里直接 scheduleReadSelection() 会在 selectionchange 持续触发时（每产生一个
  // 字符就触发一次）立即弹出工具栏，导致鼠标尚未松开就显示。真正显示交由 mouseup
  // 后的 onContentMouseUp。注意：键盘选区（无 mouseup）仍走 onMainSelectionChange 即时显示。
  function onContentSelectionChange() { /* 拖动中不弹，由 mouseup 触发 */ }
  function onContentMouseUp() {
    // 等选区稳定后再读取；foliate 内容 doc 可能在该刻尚未就绪，加有限重试兜底
    scheduleReadSelection();
  }

  /**
   * 2026-08-27 修复（工具栏点空白不收起）：
   * onContainerMouseDown 绑在父文档 .reader-view 容器上，但 iframe 内 mousedown 不冒泡到
   * 父文档 —— 阅读区（iframe 正文）点空白永远触发不到它。叠加 scheduleReadSelection 对
   * edit 态空选区直接 return、create 态要等 ~600ms 重试梯子才收起，表现为
   * 「点空白工具栏不消失 / 严重滞后」。这里在 iframe doc 上补 mousedown 监听：
   * - 点空白/普通文本 → 同步立即收起工具栏与批注浮层（无 RAF、无重试延迟，流畅灵敏）
   * - 点标注/高亮/SVG 绘制层 → 不在此关（show-annotation 接管，与父文档场景 A 行为一致）
   * capture 阶段触发，先于 foliate 内部 click 处理；随后的拖选/双击选词仍由
   * onContentMouseUp → scheduleReadSelection 正常弹出新工具栏，互不干扰。
   */
  function onContentMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    // 每次点击重置抑制标志（与父文档 onContainerMouseDown 一致，独立判断每次点击）
    suppressNextCreateToolbar = false;
    if (!selToolbar.visible && !noteEditor.visible) return;
    const t = e.target as HTMLElement | null;
    const isAnnotationTarget = !!(
      t?.closest?.("foliate-highlight") || (t as any)?.closest?.("[data-annotation]") ||
      (t as any)?.namespaceURI === "http://www.w3.org/2000/svg"
    );
    if (isAnnotationTarget) {
      // 场景 A：标注点击由 show-annotation 接管（弹 edit 工具栏/查看卡），
      // 抑制随后 mouseup → scheduleReadSelection 的创建工具栏；旧工具栏延迟一帧关闭
      suppressNextCreateToolbar = true;
      cancelPendingClose();
      pendingCloseRaf = requestAnimationFrame(() => {
        pendingCloseRaf = null;
        if (selToolbar.visible) closeSelToolbar();
      });
      return;
    }
    // 场景 B：点空白/普通文本 → 立即收起（同步，无延迟）
    if (selToolbar.visible) closeSelToolbar();
    if (noteEditor.visible) noteEditor = { ...noteEditor, visible: false, mode: "create", id: null };
  }
  function onMainSelectionChange() { scheduleReadSelection(); }

  /**
   * 2026-08-24 修复（P0 #3）：首次选中文本时，foliate 的 overlay/内容 doc 可能尚未
   * 完成挂载，单次 readReaderSelection() 会返回 null → 工具栏不弹。这里做有限重试
   * （最多 ~300ms，阶梯延时），任一帧读到有效选区即弹出，避免"首次选词呼不出工具栏"。
   * 重试全部失败（确实无选区）才隐藏工具栏。
   */
  let selReadTimer: any = null;
  function scheduleReadSelection(attempt = 0) {
    // 批注窗口编辑/新建模式打开时，忽略选区变化：
    // 否则在 textarea 输入时光标移动触发主 document 的 selectionchange，
    // 残留的 foliate 选区会被 readReaderSelection 读到 → 误弹划词工具栏。
    // 注意：仅屏蔽 edit/create（有 textarea 输入），不屏蔽 view（只读查看卡无输入）。
    if (selReadTimer) { clearTimeout(selReadTimer); selReadTimer = null; }
    if (noteEditor.visible && (noteEditor.mode === "edit" || noteEditor.mode === "create")) return;
    const sel = readReaderSelection();
    if (sel) { setSelFrom(sel); return; }
    if (attempt >= 6) {
      // 重试耗尽仍无选区：说明用户确实没选中（或点空白处）。
      // 2026-08-24 修复：edit 模式（点已有高亮弹出的工具栏）下，**不能**因空选区
      // 就关掉工具栏——否则用户在正文轻微移动/点击会让工具栏瞬间消失（"移动鼠标就消失"）。
      // edit 工具栏的关闭只交给显式入口：点空白 onContainerMouseDown / 删除 /
      // 点其他高亮（show-annotation 重设）/ 点样式。create 模式才由选区驱动显隐。
      if (selToolbar.mode === "edit") return;
      setSelFrom(null);
      return;
    }
    // 阶梯延时：10/30/60/100/160/240ms（累计 ≤ 300ms）
    const delays = [10, 30, 60, 100, 160, 240];
    selReadTimer = setTimeout(() => scheduleReadSelection(attempt + 1), delays[attempt] ?? 240);
  }

  /**
   * 2026-08-23 修复：reader-view 内的浮层（划词/词典/批注）原本用 position:fixed
   *   定位，覆盖整个视口会拦截思源顶栏"管理"等原生 UI 点击。改为 absolute
   *   后，left/top 相对容器左上角，需要减去 reader-view 视口偏移。
   *   此函数返回 .reader-view 容器（readerViewEl）的视口位置，浮层出现时统一减掉即可。
   *   注意：之前错误用 container（foliate-view 容器）作为偏移基，导致坐标偏差；
   *   现改用 readerViewEl (.reader-view 容器) 作为正确偏移基。
   */
  type ReaderViewOffset = { left: number; top: number };
  function getReaderViewOffset(): ReaderViewOffset {
    if (!readerViewEl) return { left: 0, top: 0 };
    const rect = readerViewEl.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  /** 把视口坐标转换为容器相对坐标（absolute 定位用） */
  function toContainerCoords(vx: number, vy: number): { x: number; y: number } {
    const off = getReaderViewOffset();
    return { x: vx - off.left, y: vy - off.top };
  }

  /** 返回内容区（.reader-stage）视口位置。
   *  2026-08-25 修复：浮层"上方/下方"避让判定必须以内容区为原点，而非整个 .reader-view
   *  （后者含上方导航栏 ~40px）。否则选区贴内容顶部时，rel.top≈导航栏高度，"上方"判定误以为
   *  有空间，工具栏被算到 y≈0 区域、body 反向上探进导航栏，表现为"工具栏在阅读边框外/不可用"。
   *  stage 不可用时回退到 reader-view 基准，保证降级可用。 */
  function getStageOffset(): ReaderViewOffset {
    if (!readerStageEl) return getReaderViewOffset();
    const rect = readerStageEl.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  /** 把选区视口矩形转换为「内容区相对矩形」。
   *  浮层"上方/下方"判断必须用内容区相对坐标（原点 = .reader-stage 左上角，即正文区域顶边）：
   *  - 选区贴正文顶部时 rel.top≈0，roomAbove 判定直接为 false → 落在下方，工具栏不再反探进导航栏；
   *  - 与 toContainerCoords（仍以 reader-view 为基准、用于绝对定位）分工：
   *    rectToViewRel 只服务"上下空间判定"，toContainerCoords 只服务"浮层绝对定位"，互不串味。
   *  说明：此前用 reader-view 基准，内容顶部被算成 y≈40，导致上方有"伪空间"而误放。 */
  function rectToViewRel(rect: SelRect): SelRect {
    const off = getStageOffset();
    return {
      left: rect.left - off.left,
      top: rect.top - off.top,
      right: rect.right - off.left,
      bottom: rect.bottom - off.top,
    };
  }

  function toast(msg: string) {
    toastMsg = msg;
    toastUndo = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastMsg = ""; toastUndo = false; }, 1800);
  }

  /** 带「撤销」按钮的提示（用于删除标注，3 秒内可恢复） */
  let toastUndo = false;
  let pendingDelete: {
    id: string; cfi: string; style: AnnotationStyle; color: string;
    note: string; selectedText: string; group: string;
  } | null = null;
  let undoTimer: any = null;
  function toastWithUndo(msg: string) {
    toastMsg = msg;
    toastUndo = true;
    if (toastTimer) clearTimeout(toastTimer);
    // 撤销窗口比普通 toast 长一点（3s），与 pendingDelete 超时一致
    toastTimer = setTimeout(() => { toastMsg = ""; toastUndo = false; }, 3000);
  }

  // 查词 → 弹窗渲染卡片（同源 renderDictCard）
  // opts.x/opts.y 指定弹窗容器相对坐标；opts.source 标记来源（sel=划词工具栏, hover=Option 悬浮）
  function runDictLookup(word: string, opts?: { x?: number; y?: number; source?: "sel" | "hover" }) {
    const x = opts?.x ?? selToolbar.x;
    const y = opts?.y ?? (selToolbar.y + toolbarH);
    const source = opts?.source ?? "sel";
    dictPopupSource = source;
    dictPopup = { visible: true, x, y, html: renderLoading(), word, source };
    setTimeout(() => {
      const entry = lookupSmart(word);
      let html: string;
      if (entry) {
        html = renderDictCard(parseDictEntry(entry), { showStar: true, inVocab: isInVocab?.(word) ?? false });
      } else {
        const cands = searchCandidates(word, 3);
        html = renderDictSuggestions(word, cands);
      }
      // 仅当来源未切换时更新（避免悬浮→划词切换时旧异步请求覆盖新弹窗）
      if (dictPopupSource === source) {
        dictPopup = { ...dictPopup, html };
      }
    }, 30);
  }

  function onSelDict() {
    const text = selToolbar.text?.trim();
    if (!text) return;
    runDictLookup(text);
    closeSelToolbar();
  }
  // ============ Phase 2：划词高亮 + 批注（阅读器 / foliate 集成） ============

  /** foliate annotation 事件接入：draw-annotation 画高亮、show-annotation 弹查看、create-overlay 重绘该书批注 */
  function setupAnnotationLayer() {
    if (!view) return;
    // 懒取单例（index.ts 初始化后注入）；失败不阻塞阅读
    if (!annStore) {
      try { annStore = getAnnotationStore(); } catch { annStore = null; }
    }
    // --- v3 诊断 ---
    dbgHud.setupCalled = true;
    dbgHud.annStoreReady = !!annStore;
    dbgHud.bookIdAtSetup = bookId || "(empty)";
    if (annStore && bookId) {
      try { dbgHud.annotCountInStore = annStore.getByBook(bookId).length; } catch { dbgHud.annotCountInStore = -1; }
      // v5 深度诊断：store 总数 + 所有 bookId + 是否包含当前 bookId
      try {
        const all = annStore.getAll();
        dbgHud.totalInStore = all.length;
        const bookIds = [...new Set(all.map((a: any) => a.bookId).filter(Boolean))];
        dbgHud.storeBookIds = bookIds.join(", ") || "(none)";
        dbgHud.bookIdMatch = bookIds.includes(bookId);
      } catch(e: any) { dbgHud.totalInStore = -1; dbgHud.storeBookIds = e.message; }
    }
    // --- /v3 ---
    annByValue.clear();
    annIndexCache.clear();
    // 重绘该书已有批注（每节 overlay 创建时触发）
    view.addEventListener("create-overlay", onCreateOverlay);
    // 绘制高亮（参照 foliate 官方 demo reader.js）：按 style 选择线型
    // 现精简为 3 类：highlight（背景高亮）/ wavy（波浪线）/ solid（直线段/下划线）
    view.addEventListener("draw-annotation", onDrawAnnotation);
    // 点击已有高亮/直线/波浪线 → 弹查看卡
    view.addEventListener("show-annotation", onShowAnnotation);
    // 脚注：监听可取消的 link 事件，命中脚注引用则阻止 foliate 跳转并弹气泡展示
    view.addEventListener("link", onBookLink);
    // 2026-08-25 滚动/翻页跟随：foliate 内容在 iframe 内滚动时选区矩形随之变化，
    // 而工具栏/批注卡坐标是创建时一次性写死的 → 视觉「脱钩」。监听 relocate（滚动/翻页即触发），
    // 统一收起所有瞬时浮层，符合「滚动=放弃临时浮层」心智模型，并消除错位。
    view.addEventListener("relocate", onRelocate);
    // 2026-08-26 退回 foliate 原生管线：高亮由 foliate 的 create-overlay 事件 +
    // view.addAnnotation 内部 overlayer 管理，无需我们自建 SVG 层，也无需初始全量自绘。
    // 页签重新可见时：foliate 的 overlayer 随 iframe 持久存在；若 iframe 被销毁重建，
    // foliate 会重新触发 create-overlay → onCreateOverlay 自动重绘。此处仅作安全兜底：
    // 回到可见区时标记 annotationsDirty，借 relocate 信号用 foliate 原生管线补绘
    // （addReaderAnnotation 内部幂等：foliate 的 addAnnotation 会先 remove 再 add）。
    if (typeof IntersectionObserver !== "undefined" && readerStageEl) {
      visibilityObserver = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            annotationsDirty = true;
            // 兜底：若 foliate 未在重显时触发 relocate，延迟补绘一次
            setTimeout(() => {
              if (annotationsDirty) { redrawBookAnnotations(); annotationsDirty = false; }
            }, 450);
          }
          // 离开可见区：保留 annotationsDirty，下次回到页签再补绘
        }
      }, { threshold: 0 });
      visibilityObserver.observe(readerStageEl);
    }
  }

  /** 卸载 foliate view 上的 annotation 事件监听，避免反复进出阅读 Tab 造成泄漏/悬空回调 */
  function teardownAnnotationLayer() {
    if (!view) return;
    view.removeEventListener("create-overlay", onCreateOverlay);
    view.removeEventListener("draw-annotation", onDrawAnnotation);
    view.removeEventListener("show-annotation", onShowAnnotation);
    view.removeEventListener("link", onBookLink);
    view.removeEventListener("relocate", onRelocate);
    if (visibilityObserver) {
      visibilityObserver.disconnect();
      visibilityObserver = null;
    }
  }

  /** 滚动/翻页时收起所有瞬时浮层：划词工具栏、批注卡、脚注、词典。
   *  根因：这些浮层坐标是创建时一次性写死（absolute 定位于容器），foliate 内容在 iframe 内
   *  滚动后选区矩形已变，浮层仍停在旧坐标 → 视觉「脱钩」错位。收起比错位更可接受，
   *  也契合「滚动=放弃临时浮层」的心理模型。注：此事不含 TOC/设置/搜索等常驻面板。 */
  function onRelocate() {
    dbgHud.relocateCalls++;
    if (selToolbar.visible) closeSelToolbar();
    if (noteEditor.visible) noteEditor = { ...noteEditor, visible: false, mode: "create", id: null, place: "below" };
    if (showFootnote) closeFootnote();
    if (dictPopup.visible) dictPopup = { ...dictPopup, visible: false };
    // 2026-08-26 退回 foliate 原生：高亮归 foliate 的 overlayer 管理，随 iframe 持久存在，
    // 重渲后 foliate 自动 redraw()。仅作安全兜底：若 annotationsDirty（由页签可见性置位），
    // 用 foliate 原生管线幂等重绘该书批注。
    if (annotationsDirty) {
      redrawBookAnnotations();
      if (annStore && bookId && view) annotationsDirty = false;
    }
  }

  /* ================= 脚注气泡（点击脚注引用 → 弹气泡展示内容，不跳转） ================= */

  /** link 事件处理器：foliate-view 点击 <a> 时触发（cancelable）。
   *  命中脚注 → preventDefault 阻止跳转 + 弹气泡；非脚注 → 放行 goTo（目录/普通内链不受影响）。 */
  async function onBookLink(e: any) {
    const a = e.detail?.a;
    const href = e.detail?.href;
    if (!a || !href) return;
    if (!isFootnoteRef(a)) return; // 非脚注：不拦截，foliate 默认 goTo
    // 是脚注：阻止跳转
    e.preventDefault();
    clearTimeout(footnoteHoverTimer);
    footnoteHoverAnchor = a;
    await showFootnoteFor(a, href, { pin: true });
  }

  /** 抽取脚注内容并弹气泡（点击 / 悬停共用）。
   *  - opts.pin：点击触发时锁定气泡（hover 移开不自动收起，点空白才关）；
   *  - 已显示同一锚点时仅更新锁定态、不重抽（避免抖动与重复 IO）；
   *  - footnoteReqToken 防竞态：快速划过多个脚注时，过期请求的异步结果被丢弃。 */
  async function showFootnoteFor(a: any, href: string, opts?: { pin?: boolean }) {
    if (!a || !href) return;
    if (!isFootnoteRef(a)) return; // 非脚注：不拦截，foliate 默认 goTo
    // 点击已显示的同一脚注：仅更新锁定态，不重抽（避免抖动/重复 IO）
    if (showFootnote && footnoteHoverAnchor === a) {
      footnotePinned = opts?.pin ?? footnotePinned;
      return;
    }
    const myToken = ++footnoteReqToken; // 作废任何在途旧请求
    footnoteHoverAnchor = a;
    footnotePinned = opts?.pin ?? false;
    footnoteLoading = true;
    showFootnote = true; // 立即显示 loading 占位气泡（抽取可能异步），给即时反馈
    await tick();
    // ===== 坐标转换（完全对齐工具栏已验证管线）=====
    // a 在 iframe 内容文档内，getBoundingClientRect() 返回 iframe 视口坐标
    // 需加 frameElement 偏移 → 主文档视口坐标 → toContainerCoords → 容器绝对定位坐标
    const r = a.getBoundingClientRect();
    let vx = r.left, vy = r.top, vr = r.right, vb = r.bottom;
    const win = a.ownerDocument?.defaultView;
    if (win) {
      const frame = (win as any).frameElement as HTMLElement | null;
      if (frame) {
        const fr = frame.getBoundingClientRect();
        vx += fr.left; vy += fr.top; vr += fr.left; vb += fr.top;
      }
    }
    // 用脚注号**水平中心**作为锚点（比左上角更自然）
    const anchorX = (vx + vr) / 2;
    const anchorY = vy; // 气泡默认在脚注号下方弹出
    positionFootnoteBubble(anchorX, anchorY, r.width, r.height); // 估算高度先定位（loading 占位较小）
    try {
      const result = await extractFootnote(view?.book, href);
      if (myToken !== footnoteReqToken) return; // 已有更新的请求，丢弃本条过期结果
      if (!result.html) {
        // 抽取失败：降级放行（回退为普通跳转）
        toast("脚注内容获取失败，将跳转到原位置");
        closeFootnote();
        return;
      }
      footnoteHTML = result.html;
      footnoteType = result.type;
      footnoteLoading = false;
      // 内容到达后校正定位（按真实高度避免溢出）
      requestAnimationFrame(() => refineFootnotePosition(anchorX, anchorY, r.height));
    } catch (err) {
      if (myToken !== footnoteReqToken) return;
      footnoteLoading = false;
      console.warn("[REword] 脚注展示失败:", err);
      toast("脚注展示异常");
    }
  }

  /** 悬停脚注引用 → 防抖 350ms 弹气泡；移出 → 延迟收起（除非点击锁定） */
  function onFootnoteHover(e: MouseEvent) {
    // 划词工具栏 / 批注编辑可见时不弹 hover 脚注，避免干扰
    if (selToolbar.visible || noteEditor.visible) {
      clearTimeout(footnoteHoverTimer);
      return;
    }
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a || !isFootnoteRef(a)) {
      scheduleFootnoteHoverHide();
      return;
    }
    // 同一引用已在显示：忽略
    if (showFootnote && footnoteHoverAnchor === a) return;
    clearTimeout(footnoteHoverTimer);
    const el = a as any;
    footnoteHoverTimer = setTimeout(() => {
      footnotePinned = false; // hover 触发不锁定
      footnoteHoverAnchor = el;
      showFootnoteFor(el, el.getAttribute("href") || "");
    }, 350);
  }

  /** 鼠标移出脚注引用：延迟收起（点击锁定的气泡不收起） */
  function scheduleFootnoteHoverHide() {
    clearTimeout(footnoteHoverTimer);
    setTimeout(() => {
      if (showFootnote && !footnotePinned && footnoteHoverAnchor) {
        closeFootnote();
      }
    }, 220);
  }


  /** 定位脚注气泡：基于主文档视口坐标的锚点，智能四向避让
   *  anchorX/Y 已是主文档视口坐标（iframe 偏移已加），内部用 toContainerCoords 转容器相对坐标
   */
  function positionFootnoteBubble(anchorX: number, anchorY: number, anchorW: number, anchorH: number) {
    const el = document.querySelector(".reader-footnote") as HTMLElement | null;
    if (!el) return;
    const viewW = readerStageEl?.clientWidth ?? 800;
    const viewH = readerStageEl?.clientHeight ?? 600;
    const bubbleW = Math.min(360, viewW * 0.8);
    const bubbleHEstimate = 220;
    const gap = 6; // 气泡与脚注号的间距
    const padding = 12; // 与内容区边缘的最小间距

    // 锚点转内容区相对坐标（用于上下左右空间判定）
    const stageOff = getStageOffset();
    const relAnchorX = anchorX - stageOff.left;
    const relAnchorY = anchorY - stageOff.top;

    // 默认：脚注号下方弹出
    let relX = relAnchorX + gap;
    let relY = relAnchorY + anchorH + gap;
    let placeAbove = false;

    // ── 智能四向避让（全部使用内容区相对坐标）──

    // 1. 右边界夹紧
    if (relX + bubbleW > viewW - padding) {
      relX = viewW - bubbleW - padding;
    }
    if (relX < padding) relX = padding;

    // 2. 下边界：空间不足 → 翻到上方
    if (relY + bubbleHEstimate > viewH - padding) {
      relY = relAnchorY - bubbleHEstimate - gap;
      placeAbove = true;
    }
    if (relY < padding && !placeAbove) {
      relY = relAnchorY + anchorH + gap;
      placeAbove = false;
    } else if (relY < padding && placeAbove) {
      relY = padding;
    }

    // 3. 水平优化：优先居中于脚注号，靠右时左对齐
    const centeredX = relAnchorX - bubbleW / 2;
    if (centeredX >= padding && centeredX + bubbleW <= viewW - padding) {
      relX = centeredX;
    } else if (relAnchorX > viewW * 0.6 && relAnchorX - bubbleW > padding) {
      relX = relAnchorX - bubbleW - gap;
    }

    // 内容区相对坐标 → 容器绝对定位坐标（toContainerCoords 同款）
    const c = toContainerCoords(relX + stageOff.left, relY + stageOff.top);
    el.style.left = `${c.x}px`;
    el.style.top = `${c.y}px`;
    el.dataset.placeAbove = String(placeAbove);
  }

  /** 首次渲染后实测气泡高度，校正是否溢出内容区 */
  async function refineFootnotePosition(anchorX: number, anchorY: number, anchorH: number) {
    const el = document.querySelector(".reader-footnote") as HTMLElement | null;
    if (!el) return;
    const viewH = readerStageEl?.clientHeight ?? 600;
    const padding = 12;
    const gap = 6;
    const actualH = el.offsetHeight;
    const stageOff = getStageOffset();
    // 直接用容器的 getBoundingClientRect 反算内容区相对坐标做判定
    const elRect = el.getBoundingClientRect();
    const relY = elRect.top - stageOff.top;
    const placeAbove = el.dataset.placeAbove === "true";
    const relAnchorY = anchorY - stageOff.top;

    if (placeAbove) {
      if (relY < padding) {
        const c = toContainerCoords(stageOff.left + padding, anchorY);
        el.style.top = `${c.y}px`;
      }
    } else {
      if (relY + actualH > viewH - padding) {
        // 尝试翻到上方
        const aboveRelY = relAnchorY - actualH - gap;
        if (aboveRelY >= padding) {
          const c = toContainerCoords(stageOff.left + 12, anchorY - actualH - gap);
          el.style.top = `${c.y}px`;
          el.dataset.placeAbove = "true";
        } else {
          // 上下都不够：限制最大高度
          const c = toContainerCoords(stageOff.left + padding, stageOff.top + padding);
          el.style.top = `${c.y}px`;
          el.style.maxHeight = `${viewH - 2 * padding}px`;
        }
      }
    }
  }

  function closeFootnote() {
    footnoteReqToken++; // 作废在途抽取请求，避免关闭后旧结果回填气泡
    showFootnote = false;
    footnoteHTML = "";
    footnoteType = "脚注";
    footnoteLoading = false;
    footnoteHoverAnchor = null;
    footnotePinned = false;
    if (footnoteHoverTimer) clearTimeout(footnoteHoverTimer);
  }

  /** 点击脚注气泡外部关闭：注册在 main document + 每个内容文档 capture 阶段。
   *  命中脚注引用锚点时忽略（让 onBookLink 打开新脚注，避免先关后闪）；
   *  命中气泡内部忽略。 */
  function onFootnoteOutsidePointerDown(e: PointerEvent) {
    if (!showFootnote) return;
    const target = e.target as Element | null;
    if (!target) return;
    // 点击气泡内部：不关闭
    if (footnoteEl && footnoteEl.contains(target)) return;
    // 点击脚注引用锚点：不关闭（让 onBookLink / onFootnoteHover 处理）
    const a = target.closest?.("a");
    if (a && isFootnoteRef(a)) return;
    closeFootnote();
  }

  /** 把单条批注绘制进 foliate（异步；用返回 index 回填 cfi→章节缓存） */
  async function addReaderAnnotation(it: any): Promise<void> {
    dbgHud.addAnnotationTries++;
    if (!it.cfi || !it.color || !view) return;
    if (it.deletedAt) return; // 软删除项不重绘（最终一致保障：翻页后已删高亮彻底消失）
    const style = normalizeAnnotationStyle(it.style) as AnnotationStyle;
    try {
      const res: any = await view.addAnnotation({ value: it.cfi, color: it.color, style, note: it.note || "" });
      if (res && typeof res.index === "number") annIndexCache.set(it.cfi, res.index);
      // annByValue 只存 {id, cfi, color}：note/style 一律以 annStore 为唯一真源，
      // 避免三处 note 拷贝不一致（2026-08-24 重构）。
      annByValue.set(it.cfi, { id: it.id, cfi: it.cfi, color: it.color });
    } catch (err) {
      dbgHud.addAnnotationErrors++;
      // 2026-08-25 可靠性：原空 catch 静默吞错，无法排查 CFI 无效/overlay 未就绪等问题。
      console.warn("[REword] addReaderAnnotation 失败（id=" + it?.id + ", cfi=" + it?.cfi + "）:", err);
    }
  }

  /**
   * 用 foliate 原生管线重绘该书所有批注（幂等）。
   * 逐条调用 addReaderAnnotation → view.addAnnotation，foliate 内部会
   *   resolveNavigation(cfi) → 找该分节 overlayer → emit draw-annotation → 我们 onDrawAnnotation 画。
   * 不依赖自建 SVG 层。供 onCreateOverlay / 页签可见性兜底 / relocate 兜底复用。
   */
  function redrawBookAnnotations() {
    if (!annStore || !bookId || !view) return;
    const annots = annStore.getByBook(bookId);
    dbgHud.annotCountInStore = annots.length;
    for (const it of annots) {
      if (!it.cfi || it.deletedAt) continue;
      void addReaderAnnotation(it);
    }
  }

  /**
   * 章节 overlay 创建回调（foliate 原生管线）。
   * - create-overlay 事件携带 detail.index（章节索引），此时该分节的 Overlayer 已就绪，
   *   调用 view.addAnnotation 必能命中 #getOverlayer → emit draw-annotation → 绘制。
   * - 性能优化：annIndexCache 缓存 cfi→章节索引。若已缓存且 ≠ 当前章节则跳过
   *   （等该章节 overlay 创建时再画）；未缓存或匹配当前章节则交给 addReaderAnnotation
   *   （内部 resolveNavigation 解析并回填缓存，且幂等：重复 add 只重绘不重复）。
   */
  function onCreateOverlay(e?: any) {
    dbgHud.createOverlayCalls++;
    if (!annStore || !bookId || !view) return;
    const idx = e?.detail?.index;
    dbgHud.ovr_evtIndex = (typeof idx === "number") ? idx : -1;

    const annots = annStore.getByBook(bookId);
    dbgHud.annotCountInStore = annots.length;

    for (const it of annots) {
      if (!it.cfi || it.deletedAt) continue;
      // 章节索引缓存命中且不匹配当前章节 → 跳过（等该章节 overlay 创建时再画）
      const cached = annIndexCache.get(it.cfi);
      if (typeof cached === "number" && typeof idx === "number" && cached !== idx) continue;
      // 否则（未缓存或匹配当前章节）交给 foliate 原生 addAnnotation，
      // 内部解析 CFI、缓存章节索引、emit draw-annotation。
      void addReaderAnnotation(it);
    }
  }

  // 2026-08-26 退回 foliate 原生：自建 SVG 高亮层（getOrCreateRewordOverlay /
  // drawAnnotationDirect / resolveAndDrawAnnotation / rewordOverlays / rewordHighlights）
  // 已全部移除，统一由 foliate 的 Overlayer + view.addAnnotation + draw-annotation 事件承担。

  /**
   * foliate 的 draw-annotation 事件处理器：由 view.addAnnotation 内部 emit，
   * 携带 { draw, annotation, doc, range }。我们用 foliate 自带的 Overlayer 静态方法绘制，
   * 支持 highlight（背景）/ solid（直线段=underline）/ wavy（波浪线=squiggly）三类。
   */
  function onDrawAnnotation(e: any) {
    const detail = e?.detail;
    const draw = detail?.draw;
    const annotation = detail?.annotation;
    const doc = detail?.doc;
    const range = detail?.range;
    if (!draw || !annotation || !range) return;

    const color = annotation.color || "#f5d567";
    const style = normalizeAnnotationStyle(annotation.style) as AnnotationStyle;
    dbgHud.drawnCount++;
    dbgHud.lastDraw = `draw style=${style} color=${color} cf=${String(annotation.value || "").slice(0, 20)}`;

    if (style === "solid") {
      // 直线段：foliate Overlayer.underline（一条横线下沿）
      const wm = getWritingMode(doc, range);
      draw(Overlayer.underline, { color, ...wm });
    } else if (style === "wavy") {
      // 波浪线：foliate Overlayer.squiggly
      const wm = getWritingMode(doc, range);
      draw(Overlayer.squiggly, { color, ...wm });
    } else {
      // 高亮背景：foliate Overlayer.highlight（圆角矩形 + 半透明）
      // 防御：确保 iframe 文档的 --overlayer-highlight-opacity 非 0（否则高亮透明不可见）
      if (doc?.documentElement) {
        const cur = doc.defaultView?.getComputedStyle(doc.documentElement).getPropertyValue("--overlayer-highlight-opacity");
        if (!cur || cur.trim() === "0" || cur.trim() === "0px") {
          doc.documentElement.style.setProperty("--overlayer-highlight-opacity", "0.3");
        }
      }
      draw(Overlayer.highlight, { color });
    }
  }

  /** 取 Range 所在节点的 writing-mode（竖排时需传给 Overlayer 的线型绘制） */
  function getWritingMode(doc: any, range: Range): { writingMode?: string } {
    try {
      const node = range.startContainer;
      const el = node && node.nodeType === 1 ? node : node?.parentElement;
      const wm = doc?.defaultView?.getComputedStyle(el)?.writingMode;
      return wm ? { writingMode: wm } : {};
    } catch {
      return {};
    }
  }

  function onShowAnnotation(e: any) {
    cancelPendingClose(); // 点高亮/批注 → 取消延迟关闭
    // 2026-08-25 机制级修复：点批注/高亮时，立即关闭「创建工具栏」+ 抑制重建。
    // 根因：关闭后 selectionchange 仍触发 scheduleReadSelection → showToolbarFor 重建工具栏。
    // 三路统一：onShowAnnotation / openNoteEditor / onEditAnnotate 均设此标志。
    if (selToolbar.visible) {
      selToolbar = { ...selToolbar, visible: false };
    }
    suppressNextCreateToolbar = true; // 阻止后续 showToolbarFor 重建
    const { value, rect: evRect } = e.detail;
    if (!value) { console.warn("[REword] onShowAnnotation: 无 value，提前返回", e.detail); return; }
    dbg.event("onShowAnnotation", "▶ 入口", { value: value, index: e.detail?.index });
    // 反查标注记录：优先 annByValue（cfi → 记录），未命中时用 annStore 兜底。
    // 2026-08-24 修复：cfi 比较做宽松匹配（去 epubcfi() 包装、互为前缀），
    // 避免 foliate 内部存储的 cfi 与 annStore 存的 cfi 因 wrap/normalize 差异而
    // 精确匹配失败，导致"高亮在但点不出工具栏"的静默失败。
    let rec = annByValue.get(value);
    const normCfi = (s: string) => String(s || "").replace(/^epubcfi\(/i, "").replace(/\)+$/, "");
    dbg.step("onShowAnnotation", "annByValue 快路径命中?", { hit: !!rec, id: rec?.id, cfi: rec?.cfi });
    if (!rec && annStore && bookId) {
      const target = normCfi(value);
      const byBook = annStore.getByBook(bookId);
      const hit =
        byBook.find((it: any) => normCfi(it.cfi) === target) ||
        byBook.find((it: any) => {
          const a = normCfi(it.cfi);
          return a && (a.startsWith(target) || target.startsWith(a));
        });
      if (hit) {
        rec = { id: hit.id, cfi: hit.cfi, color: hit.color };
        // 同步回 annByValue，后续点击走快路径
        annByValue.set(value, rec);
      }
    }
    // ★★ 关键诊断：rec 确定后立即记录路径与内容（用于排查 id=undefined 根因）
    const recPath = (function() {
      const fast = annByValue.get(value);
      if (fast && fast === rec) return "FAST";
      if (rec) return "SLOW(getByBook)";
      return "GHOST";
    })();
    if (!rec) {
      // 兜底：foliate 知道这是高亮但我们没找到活跃记录（数据已软删/损坏）。
      // 2026-08-24 死锁解除：弹 edit 工具栏 +「清除残留高亮」按钮，不再弹 toast（按钮自明）。
      // 居中兜底：工具栏坐标即 .reader-view 相对坐标（.reader-floating-layer 原点=reader-view 左上角），
      // 直接取容器半宽 / 固定 y，不要再经 toContainerCoords（那会多减一次 reader-view 视口偏移）。
      dbg.warn("onShowAnnotation", "★★ GHOST 分支命中！annByValue/annStore 均查不到记录 → annId 将为 null", { value });
      suppressNextCreateToolbar = true;  // ghost 也弹 edit 工具栏，抑制创建工具栏
      const cx = (readerViewEl?.clientWidth ?? window.innerWidth) / 2;
      // 2026-08-25 修复：ghost 分支也必须带上 cfi，否则 applyEditStyle/Color 拿不到定位键 → 样式改不了。
      // foliate 以 CFI 标识标注，无需数据库 id 即可重绘。
      selToolbar = { visible: true, x: cx, y: 80, text: "", mode: "edit", editingId: null, place: "above", ghostCfi: value, annCfi: value };
      selInfo = { index: -1, cfi: value, range: null };
      // 2026-08-24 根治：残留高亮只有视觉、无数据记录，缓存 cfi 供 onClearGhostHighlight 使用
      activeAnnId = null;
      activeAnnCfi = value;
      console.log("[REword] onShowAnnotation ghost 分支: ghostCfi=", value, ", editingId=", selToolbar.editingId);
      return;
    }
    // 2026-08-26 根因修复：annByValue 缓存可能存入 id=undefined 的脏记录（历史代码路径
    // 用 noteEditor.id=null 写入，或旧版代码未校验 id）。此处做防御性补全：
    // 若 rec.id 为空，用 CFI 在 store 中反查真实 id，修复缓存，然后继续正常流程。
    if (!rec.id && annStore && bookId) {
      console.warn("[REword] onShowAnnotation: rec.id 为空！尝试用 CFI 反查 store 补全...", { cfi: rec.cfi, value });
      const byBook = annStore.getByBook(bookId);
      const normCfi = (s: string) => String(s || "").replace(/^epubcfi\(/i, "").replace(/\)+$/, "");
      const target = normCfi(rec.cfi || value);
      const hit =
        byBook.find((it: any) => normCfi(it.cfi) === target) ||
        byBook.find((it: any) => {
          const a = normCfi(it.cfi);
          return a && (a.startsWith(target) || target.startsWith(a));
        });
      if (hit?.id) {
        console.log("[REword] onShowAnnotation: id 补全成功", { oldId: rec.id, newId: hit.id, cfi: target });
        rec = { id: hit.id, cfi: rec.cfi || hit.cfi, color: rec.color || hit.color };
        annByValue.set(value, rec);  // 修复缓存，后续走快路径不再命中脏数据
      } else {
        console.warn("[REword] onShowAnnotation: id 补全失败！store 中也找不到该 CFI 的记录，降级为 ghost", { target, byBookCount: byBook.length });
      }
    }
    const stored = annStore?.get(rec.id);
    const style = (stored?.style as AnnotationStyle) || "highlight";
    const color = stored?.color || rec.color;
    lastStyle = style;
    lastColor = color;
    // 2026-08-24 修复：foliate 返回的 rect 是 iframe 内部 viewport 坐标，
    // 必须加上 iframe 在父文档中的偏移，才能与 positionToolbarAbove 预期的坐标系一致
    // （readReaderSelection 已做同样修正）。否则当 iframe 自身在父文档里有较大负偏移
    // （如多栏分页布局下 x ≈ -50000）时，工具栏 left 会被算成数万像素、飞出视口看不见。
    // 注意：foliate 没有 view.frames API，正确来源是 view.renderer.getContents()，
    // 每个 content 含 doc（iframe document），doc.defaultView.frameElement 即 iframe 元素。
    // 用事件携带的 index 匹配对应 content，取其 frame 偏移。
    let rect = evRect as SelRect | null;
    if (rect) {
      const evIndex = (e.detail?.index as number) ?? undefined;
      let frame: HTMLElement | null = null;
      try {
        for (const c of view?.renderer?.getContents?.() ?? []) {
          if (evIndex !== undefined && c.index !== evIndex) continue;
          const f = (c?.doc?.defaultView as any)?.frameElement as HTMLElement | null;
          if (f) { frame = f; if (evIndex !== undefined) break; }
        }
      } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · try { for (const c of view?.renderer?.getContents?.() ?? []) { …", "debug"); }
      if (!frame) {
        // 没拿到 index 或匹配失败：退而求其次，取第一个可见 content 的 frame
        try {
          const first = (view?.renderer?.getContents?.() ?? [])[0];
          frame = (first?.doc?.defaultView as any)?.frameElement as HTMLElement | null;
        } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · try { const first = (view?.renderer?.getContents?.() ?? [])[0];…", "debug"); }
      }
      if (frame) {
        const fr = frame.getBoundingClientRect();
        rect = {
          left: rect.left + fr.left,
          top: rect.top + fr.top,
          right: rect.right + fr.left,
          bottom: rect.bottom + fr.top,
        };
      }
    }
    // 2026-08-26 标注与批注隔离 v2：
    //   - 纯高亮（无 note）→ 复用 selToolbar 进入 edit 模式（高亮按钮变删除 + 样式条展开）
    //   - 有笔记批注 → 弹「简易预览卡」(mode:"preview")：只读 + 编辑入口
    suppressNextCreateToolbar = true;  // 抑制选区路径的创建工具栏
    // ★ 诊断日志：排查"纯高亮仍弹预览卡"问题 — 打印判定依据的原始数据
    const pure = stored ? isPureHighlight(stored) : false;
    if (DEBUG_READER) {
      console.log("[REword][onShowAnnotation] 判定依据:", {
        hasStored: !!stored,
        recId: rec?.id,
        note: stored?.note,
        noteType: typeof stored?.note,
        noteLength: stored?.note?.length,
        noteTrimmed: (stored?.note || "").trim(),
        selectedText: stored?.selectedText,
        selectedTextTrimmed: (stored?.selectedText || "").trim(),
        isPureHighlight: pure,
        classify: stored ? classifyAnnotation(stored) : "?",
      });
    }
    if (stored && pure) {
      openHighlightEditToolbar(rec, rect);
      console.log("[REword] onShowAnnotation 分支(纯高亮→selToolbar edit): rec.id=", rec.id, ", rec.cfi=", rec.cfi);
    } else {
      showPreviewViewer(rec, rect);
      console.log("[REword] onShowAnnotation 分支(批注→预览卡): rec.id=", rec.id, ", rec.cfi=", rec.cfi, ", hasNote=", !!(stored && classifyAnnotation(stored) === "annotation"), ", reason=", !stored ? "!stored" : "!pure");
    }
  }

  /** 持久化一条书籍批注 + 在 foliate 中渲染高亮（直接接收 style/color/type） */
  async function saveHighlight(cfi: string, selectedText: string, style: AnnotationStyle, color: string, note: string, group?: string, type?: AnnotationType) {
    if (!annStore) {
      try { annStore = getAnnotationStore(); } catch { annStore = null; }
    }
    if (!annStore || !bookId) { toast("批注存储不可用"); return; }
    const input: any = {
      blockId: `book:${bookId}`,   // 派生虚拟块 ID，复用现有去重/聚合逻辑
      docId: bookId,
      bookId,
      cfi,
      sentence: selectedText,       // 书籍场景：上下文即选中文本
      selectedText,
      note,
      origin: "manual",
      color,
      style,
      type: type || (note && note.trim() ? "annotate" : "highlight"), // 缺省按有无 note 推断
      group: group || "未分组",
      scope: style === "highlight" ? "word" : "sentence",
    };
    const created = annStore.upsert(input);
    annByValue.set(cfi, { id: created.id, cfi, color });
    // foliate 原生绘制：addAnnotation 内部 resolveNavigation + 找 overlayer + emit draw-annotation。
    // 若当前章节 overlay 已就绪立即画出；否则等 create-overlay 事件补绘（数据已落库，不回滚）。
    try {
      await addReaderAnnotation({ ...input, id: created.id });
    } catch (err) {
      console.warn("[REword] 绘制失败（批注数据已保存，高亮稍后由 create-overlay 补绘）:", err);
    }
    dispatchAnnotationChanged();
  }

  // 复制选中文本到剪贴板
  function onSelCopy() {
    const text = selToolbar.text?.trim();
    if (!text) return;
    try { navigator.clipboard?.writeText(text); } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · onSelCopy", "warn"); }
    closeSelToolbar();
    toast("已复制");
  }

  // 「高亮」按钮：切换第二层样式条（3 样式 + 5 色）展开/收起。
  // readest 风格：点「高亮」→ 弹出样式条 → 选样式/颜色 → 一步完成标注（不再直接标注）。
  function toggleStyleStrip() {
    if (selToolbar.mode === "edit") return;
    selToolbar = { ...selToolbar, stripVisible: !selToolbar.stripVisible };
    // 2026-08-25 修复：样式条展开/收起会改变浮层总高（约 +68px），必须重算位置，
    // 否则工具栏仍以旧高度定位、溢出压住选区文字。用实测几何做重叠校正。
    if (lastSelRect) void fixToolbarPlacement(lastSelRect, 8);
  }

  // 样式条中点击「样式/颜色」→ 用该组合一步创建高亮（create 态）。
  async function onSelCreate(style: AnnotationStyle, color: string) {
    if (selToolbar.mode === "edit") return;
    const cfi = selInfo?.cfi;
    const text = selToolbar.text?.trim();
    if (!cfi || !text) { toast("请先选中文本"); return; }
    lastStyle = style; lastColor = color; // 同步偏好，供下次「高亮」复用
    await saveHighlight(cfi, text, style, color, "");
    closeSelToolbar();
    toast("已高亮");
  }

  // edit 态「批注」按钮：打开该标注的查看气泡（时间 + 原文 + 批注 + 标签 + 即时改色/样式 + 复制/编辑/删除）。
  function onEditAnnotate() {
    if (selToolbar.mode !== "edit" || !selToolbar.annId) return;
    // 2026-08-25 机制级修复：关闭工具栏 + 抑制 selectionchange 重建
    selToolbar = { ...selToolbar, visible: false };
    suppressNextCreateToolbar = true;
    showViewerForRec({ id: selToolbar.annId, cfi: selToolbar.annCfi || "", color: selToolbar.annColor || "" }, lastSelRect);
  }

  // 「批注」按钮（create 模式）：打开统一批注浮层（mode='create'），文本预览 + 样式/颜色 + note 输入 + 取消/保存。
  // 浮层定位在选中文本**下方**（参考思阅插件），预填默认色、焦点落在输入框。
  function openNoteEditor() {
    cancelPendingClose(); // 打开批注窗 → 取消延迟关闭
    if (selToolbar.mode === "edit") return; // edit 模式由 ghost/删除处理
    // 2026-08-25 修复（机制级）：点创建工具栏「批注」→ 关闭工具栏 + 抑制重建。
    // 根因：click 关闭后，selectionchange 事件仍会触发 scheduleReadSelection → showToolbarFor
    //   重新创建工具栏（因为选区文本仍在）。必须同时设 suppressNextCreateToolbar
    //   阻止后续 showToolbarFor 执行，彻底切断重建链路。
    selToolbar = { ...selToolbar, visible: false };
    suppressNextCreateToolbar = true; // 阻止 selectionchange → showToolbarFor 重建
    const text = selToolbar.text?.trim();
    const cfi = selInfo?.cfi;
    if (!text || !cfi) { toast("请先选中文本"); return }
    // 定位：统一用 positionPopupNear（锚定选区末端 + 四向避让 + 边界夹紧）。
    // 优先用已保存的选区矩形（lastSelRect 已是选区末端 clientRect，跟手）；
    // 极端情况无 rect 时兜底用工具栏当前位置，保证弹窗一定出现。
    let ex = selToolbar.x, ey = selToolbar.y, place: ToolbarPlace = "below";
    if (lastSelRect) {
      const pos = positionPopupNear(lastSelRect, 268, 220);
      ex = pos.x; ey = pos.y; place = pos.place;
    }
    noteEditor = {
      visible: true,
      x: ex,
      y: ey,
      mode: "create",
      id: null,
      cfi,
      text,
      style: lastStyle,
      color: lastColor,
      note: "",
      group: lastGroup,
      time: "",
      labels: [],
      styleLabel: "直线",
      styleGlyph: "━",
      place,
    };
  }

  // 查看态「编辑」→ 同一张卡片就地切到编辑态（位置不跳变，不另开气泡）。
  // 数据已随 view 态载入 noteEditor（text/cfi/id/style/color/note），直接翻转 mode 即可。
  function onViewerEdit() {
    if (noteEditor.mode !== "view" && noteEditor.mode !== "preview") return;
    noteEditor = { ...noteEditor, mode: "edit" };
    // 下一帧 textarea 就绪后聚焦输入框
    void tick().then(() => {
      const ta = noteEditorEl?.querySelector?.("textarea") as HTMLTextAreaElement | null | undefined;
      ta?.focus();
    });
  }

  // 查看气泡「复制」
  // 查看态「复制」：复制原文摘录
  function onViewerCopy() {
    const text = (noteEditor.text || "").trim();
    if (!text) return;
    try { navigator.clipboard?.writeText(text); } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · onViewerCopy", "warn"); }
    closeNoteEditor();
    toast("已复制");
  }

  // 预览卡「导出」：将「原文 + 笔记」组合为 Markdown 复制到剪贴板（轻量导出，后续可接思源文档）
  function onViewerExport() {
    const text = (noteEditor.text || "").trim();
    const note = (noteEditor.note || "").trim();
    const md = [text ? `> ${text}` : "", note ? note : ""].filter(Boolean).join("\n\n");
    if (!md) { toast("无内容可导出"); return; }
    try { navigator.clipboard?.writeText(md); } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · onViewerExport", "warn"); }
    toast("已导出批注到剪贴板");
  }

  /** 共享：软删除一条标注（视觉擦除 + 数据软删 + reconcile），供查看气泡与划词工具栏复用 */
  async function removeAnnotationById(id: string | null, cfi: string): Promise<void> {
    if (!annStore) { try { annStore = getAnnotationStore(); } catch { annStore = null; } }
    let delCfi = cfi ?? "";
    let delId = id ?? null;
    if (!delId && annStore && delCfi) {
      const byBook = annStore.getByBook(bookId || "");
      const nc = (s: string) => String(s || "").replace(/^epubcfi\(/i, "").replace(/\)+$/, "");
      const target = nc(delCfi);
      const found = byBook.find((it: any) => {
        const a = nc(it.cfi);
        return a === target || (a && (a.startsWith(target) || target.startsWith(a)));
      });
      if (found?.id) delId = found.id;
    }
    if (!delId) {
      if (delCfi) { await eraseAnnotationVisual(delCfi); annByValue.delete(delCfi); }
      return;
    }
    const stored = annStore?.get(delId);
    if (stored) delCfi = stored.cfi ?? delCfi;
    if (annStore) await annStore.remove(delId);
    if (delCfi) { await eraseAnnotationVisual(delCfi); annByValue.delete(delCfi); }
    if (annStore) syncVisualWithStore(view, annStore, bookId);
    try {
      const contents = view?.renderer?.getContents?.() || [];
      for (const c of contents) {
        const win = c.doc?.defaultView;
        if (win) { const sel = win.getSelection(); if (sel) sel.removeAllRanges(); }
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · nc", "debug"); }
    // 通知侧边栏：标注已变更，需重新渲染
    dispatchAnnotationChanged();
  }

  // 查看态「删除」
  async function onViewerDelete() {
    const id = noteEditor.id;
    const cfi = noteEditor.cfi;
    closeNoteEditor();
    await removeAnnotationById(id, cfi);
    toast("已删除");
  }

  // 统一批注浮层保存（create 新增 type='annotate'；edit 更新已有记录 id 存在）
  async function onNoteSave() {
    const { cfi, text, style, color, note, group, id } = noteEditor;
    if (!cfi || !text) { toast("请先选中文本"); return; }
    lastStyle = style; lastColor = color; lastGroup = group; // 同步偏好，供「高亮」复用
    const noteVal = note?.trim() || "";
    if (id) {
      // 更新已有标注：upsert(id) 就地更新 note/样式/颜色/类型
      if (!annStore) { try { annStore = getAnnotationStore(); } catch { annStore = null; } }
      if (!annStore) { toast("批注存储不可用"); return; }
      annStore.upsert({
        id,
        style,
        color,
        note: noteVal,
        group,
        type: noteVal ? "annotate" : "highlight",
      });
      // 重绘视觉：擦旧 → 画新（样式/颜色/笔记变化），均走 foliate 原生管线
      await eraseAnnotationVisual(cfi);
      await addReaderAnnotation({ id, cfi, color, style, note: noteVal });
      annByValue.set(cfi, { id, cfi, color });
      noteEditor = { ...noteEditor, visible: false, mode: "create", id: null };
      closeSelToolbar();
      toast("已更新批注");
      dispatchAnnotationChanged(); // 通知侧边栏刷新
      onProtectTab?.(); // 已修改/批注：固定阅读 Tab，避免被数量超限回收顶掉
    } else {
      await saveHighlight(cfi, text, style, color, noteVal, group, "annotate");
      noteEditor = { ...noteEditor, visible: false, mode: "create", id: null };
      closeSelToolbar();
      toast("已保存批注");
      onProtectTab?.(); // 已新增批注/高亮：固定阅读 Tab，避免被数量超限回收顶掉
    }
  }

  // 批注浮层：取消
  function onNoteCancel() {
    noteEditor = { ...noteEditor, visible: false, mode: "create", id: null };
    closeSelToolbar();
  }

  // 查看态：点色板颜色 → 即时改色（readest「颜色即分类」：不改笔记、不关卡片）
  async function applyViewerColor(color: string) {
    // 2026-08-26 放宽守卫：view 态与 highlight 态共用此即时改色逻辑（highlight 面板复用，避免重复代码）
    if (!noteEditor.id) return;
    lastColor = color;
    if (!annStore) { try { annStore = getAnnotationStore(); } catch { annStore = null; } }
    const cfi = noteEditor.cfi;
    if (annStore) annStore.upsert({ id: noteEditor.id, color });
    if (cfi) {
      await eraseAnnotationVisual(cfi);
      await addReaderAnnotation({ id: noteEditor.id, cfi, color, style: noteEditor.style, note: noteEditor.note || "" });
      annByValue.set(cfi, { id: noteEditor.id, cfi, color });
    }
    noteEditor = { ...noteEditor, color };
    dispatchAnnotationChanged(); // 通知侧边栏刷新
  }

  // 查看态/高亮态：点样式 → 即时改样式（与改色同理；highlight 面板复用）
  async function applyViewerStyle(style: AnnotationStyle) {
    if (!noteEditor.id) return;
    lastStyle = style;
    if (!annStore) { try { annStore = getAnnotationStore(); } catch { annStore = null; } }
    const cfi = noteEditor.cfi;
    if (annStore) annStore.upsert({ id: noteEditor.id, style });
    if (cfi) {
      await eraseAnnotationVisual(cfi);
      await addReaderAnnotation({ id: noteEditor.id, cfi, color: noteEditor.color, style, note: noteEditor.note || "" });
      annByValue.set(cfi, { id: noteEditor.id, cfi, color: noteEditor.color });
    }
    noteEditor = { ...noteEditor, style };
    dispatchAnnotationChanged(); // 通知侧边栏刷新
  }

  // edit 态样式条：点样式 → 即时改已有标注的样式（readest 编辑态：样式条常显在工具栏下方）。
  async function applyEditStyle(style: AnnotationStyle) {
    // 2026-08-25 根因修复：旧逻辑首行 `if (!annId) return`，但 onShowAnnotation 查不到记录
    // （CFI 与 annByValue/annStore 不匹配）时 annId 为 null → 整函数第二行就退出，
    // 样式永远改不了（用户反馈"线段/颜色样式一个都点不了"）。
    // foliate 以 CFI 标识标注，无需数据库 id 即可重绘，故改用 CFI 作为主定位键。
    const cfi = selToolbar.annCfi || selToolbar.ghostCfi || activeAnnCfi || "";
    dbg.snapshot("applyEditStyle", { visible: selToolbar.visible, mode: selToolbar.mode, annId: selToolbar.annId, annCfi: selToolbar.annCfi, ghostCfi: selToolbar.ghostCfi, resolvedCfi: cfi });
    if (!cfi) { console.warn("[REword] applyEditStyle: CFI 为空，无法定位标注"); toast("无法定位标注，请重试"); return; }
    const normCfi = (s: string) => String(s || "").replace(/^epubcfi\(/i, "").replace(/\)+$/, "");
    lastStyle = style;
    if (!annStore) { try { annStore = getAnnotationStore(); } catch { annStore = null; } }
    const color = selToolbar.annColor || lastColor;
    // 解析有效 id（用于持久化）：优先 annId；缺失时按 CFI 在 annStore 反查（兼容 annByValue 未命中场景）。
    let effId = selToolbar.annId || "";
    if (!effId && annStore && bookId) {
      const target = normCfi(cfi);
      const hit = (annStore.getByBook?.(bookId) ?? []).find((it: any) =>
        normCfi(it.cfi) === target ||
        (normCfi(it.cfi) && (normCfi(it.cfi).startsWith(target) || target.startsWith(normCfi(it.cfi))))
      );
      if (hit) effId = hit.id;
    }
    const note = (effId && annStore?.get(effId)?.note) || "";
    // 数据层：有 id 则 upsert 最新样式（无 id 的纯 ghost 仅改视觉，不持久化）。
    if (effId && annStore) {
      try {
        const existing = annStore.get(effId);
        if (existing) await annStore.upsert({ ...existing, style });
        else await annStore.upsert({ id: effId, cfi, style, color, bookId } as any);
      } catch (e) {
        console.error("[REword] applyEditStyle upsert 失败:", e);
      }
    }
    // 视觉更新：foliate addAnnotation 即「原子替换」——解析 CFI → overlayer.remove → 按新样式重绘。
    // 无需先 deleteAnnotation：单个 addAnnotation 调用即可完成替换（对标 readest / foliate 官方 view.js:427）。
    if (view) {
      try {
        await addReaderAnnotation({ id: effId, cfi, color, style, note });
        if (effId) annByValue.set(cfi, { id: effId, cfi, color });
        toast(`样式已改为 ${ANNOTATION_STYLES[style]?.label || style}`);
        dbg.step("applyEditStyle", "✅ 视觉更新成功（直接绘制）", { cfi, style, effId });
      } catch (e) {
        console.error("[REword] applyEditStyle 视觉更新失败:", e);
        toast("样式切换失败，请重试");
        dbg.warn("applyEditStyle", "❌ 视觉更新失败", { cfi, style, err: String(e) });
      }
    } else {
      console.warn("[REword] applyEditStyle: view 不可用，仅更新数据层");
      if (effId) annByValue.set(cfi, { id: effId, cfi, color });
    }
    selToolbar = { ...selToolbar, annStyle: style, annId: effId || selToolbar.annId, annCfi: cfi };
    dispatchAnnotationChanged(); // 通知侧边栏刷新
  }

  // edit 态样式条：点颜色 → 即时改已有标注的颜色。
  async function applyEditColor(color: string) {
    // 2026-08-25 同 applyEditStyle：CFI 为主定位键，不再依赖 annId（避免查不到记录时整函数 return）。
    const cfi = selToolbar.annCfi || selToolbar.ghostCfi || activeAnnCfi || "";
    dbg.snapshot("applyEditColor", { visible: selToolbar.visible, mode: selToolbar.mode, annId: selToolbar.annId, annCfi: selToolbar.annCfi, ghostCfi: selToolbar.ghostCfi, resolvedCfi: cfi });
    if (!cfi) { console.warn("[REword] applyEditColor: CFI 为空，无法定位标注"); toast("无法定位标注，请重试"); return; }
    const normCfi = (s: string) => String(s || "").replace(/^epubcfi\(/i, "").replace(/\)+$/, "");
    lastColor = color;
    if (!annStore) { try { annStore = getAnnotationStore(); } catch { annStore = null; } }
    const style = selToolbar.annStyle || lastStyle;
    let effId = selToolbar.annId || "";
    if (!effId && annStore && bookId) {
      const target = normCfi(cfi);
      const hit = (annStore.getByBook?.(bookId) ?? []).find((it: any) =>
        normCfi(it.cfi) === target ||
        (normCfi(it.cfi) && (normCfi(it.cfi).startsWith(target) || target.startsWith(normCfi(it.cfi))))
      );
      if (hit) effId = hit.id;
    }
    const note = (effId && annStore?.get(effId)?.note) || "";
    if (effId && annStore) {
      try {
        const existing = annStore.get(effId);
        if (existing) await annStore.upsert({ ...existing, color });
        else await annStore.upsert({ id: effId, cfi, style, color, bookId } as any);
      } catch (e) {
        console.error("[REword] applyEditColor upsert 失败:", e);
      }
    }
    // 视觉更新：单次 addAnnotation = foliate 原子替换（读 est/readest 一致做法）。
    if (view) {
      try {
        await addReaderAnnotation({ id: effId, cfi, color, style, note });
        if (effId) annByValue.set(cfi, { id: effId, cfi, color });
        toast(`颜色已更改`);
        dbg.step("applyEditColor", "✅ 视觉更新成功（直接绘制）", { cfi, color, effId });
      } catch (e) {
        console.error("[REword] applyEditColor 视觉更新失败:", e);
        toast("颜色切换失败，请重试");
        dbg.warn("applyEditColor", "❌ 视觉更新失败", { cfi, color, err: String(e) });
      }
    } else {
      console.warn("[REword] applyEditColor: view 不可用，仅更新数据层");
      if (effId) annByValue.set(cfi, { id: effId, cfi, color });
    }
    selToolbar = { ...selToolbar, annColor: color, annId: effId || selToolbar.annId, annCfi: cfi };
    dispatchAnnotationChanged(); // 通知侧边栏刷新
  }

  // ============================================================
  // 2026-08-28：连续朗读（参考 Readest 朗读体验）
  // ============================================================

  /** 取当前已加载的内容文档（多节可见时拼接） */
  function getTtsDocs(): Document[] {
    try {
      const raw = (view?.renderer?.getContents?.() as any[]) || [];
      const mapped = raw.map((c) => c?.doc).filter(Boolean) as Document[];
      return mapped;
    } catch {
      return [];
    }
  }

  /** 从 iframe 文档取当前选区 Range（划词「朗读」用） */
  function getCurrentSelectionRange(): Range | null {
    for (const doc of getTtsDocs()) {
      const sel = (doc as any).getSelection?.();
      if (sel && sel.rangeCount > 0 && sel.toString().trim()) return sel.getRangeAt(0) as Range;
    }
    // 回退：主文档选区
    const sel = (typeof window !== "undefined" && window.getSelection?.());
    if (sel && sel.rangeCount > 0 && sel.toString().trim()) return sel.getRangeAt(0);
    return null;
  }

  /** 合并实时语速后的当前设置对象 */
  function ttsSettingsNow(): RewordTtsSettings {
    // Plugin 端的 TtsSettings 只是 RewordTtsSettings 的子集（缺 volume/granularity/scope/
    // enableHighlight/highlightStyle/highlightColor/autoPage/sleepTimerMin）。
    // 用 DEFAULT_REWORD_TTS 兜底合并，保证 Controller 拿到完整字段，
    // 否则 enableHighlight / autoPage / 睡眠定时等会全部失效。
    const raw = (getTtsSettings?.() as Partial<RewordTtsSettings> | null) || null;
    const s: RewordTtsSettings = { ...DEFAULT_REWORD_TTS, ...(raw || {}) };
    s.rate = ttsRate;
    return s;
  }

  /** 懒创建朗读控制器（挂载一次） */
  function ensureTtsController() {
    if (ttsController) { ttsController.setSettings(ttsSettingsNow()); return; }
    const settings = ttsSettingsNow();
    ttsRate = settings.rate;
    ttsController = new ReaderTtsController(getTtsDocs, settings, {
      onState: (st) => { ttsState = st; showTtsBar = st !== "idle"; },
      onProgress: (i, t) => { ttsProgress = { index: i, total: t }; },
      onSentence: (txt) => { ttsCurrentText = txt; },
      onNeedVisible: (range) => { try { view?.renderer?.scrollToAnchor?.(range, true); } catch { /* 忽略 */ } },
      onAutoPage: async () => {
        try { view?.goRight?.(); } catch { return false; }
        await new Promise((r) => setTimeout(r, 350));
        return true;
      },
      onError: (msg) => { try { toast(msg); } catch { /* 忽略 */ } },
    });
  }

  /** 划词工具栏「朗读」：从选区（或当前可视位置）开始连续朗读 */
  function onSelSpeak() {
    ensureTtsController();
    const range = getCurrentSelectionRange();
    if (ttsState !== "idle") ttsController?.stop();
    ttsController?.setSettings(ttsSettingsNow());
    void ttsController?.playFrom(range || undefined);
    closeSelToolbar();
  }

  /** 控制条：播放/暂停切换（无选区则从当前位置开始） */
  function ttsTogglePlay() {
    ensureTtsController();
    ttsController?.setSettings(ttsSettingsNow());
    if (ttsState === "playing") ttsController?.pause();
    else if (ttsState === "paused") ttsController?.resume();
    else void ttsController?.playFrom(getCurrentSelectionRange() || undefined);
  }
  function ttsStop() { ttsController?.stop(); }
  function ttsNext() { ttsController?.next(); }
  function ttsPrev() { ttsController?.prev(); }
  function onTtsRateInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (isNaN(v)) return;
    ttsRate = v;
    ttsController?.setRate(v); // 即时生效，不打断当前朗读
    // 防抖持久化：直接写回设置（不调用 setSettings，避免重启朗读进度）
    ttsCfg = { ...ttsCfg, rate: v };
    if (rateSaveTimer) clearTimeout(rateSaveTimer);
    rateSaveTimer = setTimeout(() => {
      rateSaveTimer = null;
      void saveTtsSettings?.({ ...ttsCfg });
    }, 400);
  }
  function ttsToggleHighlight() {
    ensureTtsController();
    const s = ttsSettingsNow();
    s.enableHighlight = !s.enableHighlight;
    ttsHighlightOn = s.enableHighlight;
    ttsController?.setSettings(s);
    void saveTtsSettings?.(s);
  }
  /** 一键收词：提取当前句英文单词，去重后加入生词本（跳过已存在项） */
  function ttsCollectWords() {
    const txt = ttsCurrentText || "";
    const words = Array.from(
      new Set(
        (txt.match(/[A-Za-z][A-Za-z'-]*/g) || [])
          .map((w) => w.toLowerCase())
          .filter((w) => w.length >= 2)
      )
    );
    if (!words.length) { try { toast("当前句无可收藏的单词"); } catch { /* 忽略 */ } return; }
    let added = 0;
    let skipped = 0;
    for (const w of words) {
      try {
        if (isInVocab?.(w)) { skipped++; continue; }
        onAddToVocab?.(w);
        added++;
      } catch { /* 忽略单项失败 */ }
    }
    try {
      toast(`已加入生词本 ${added} 个${skipped ? `（已存在 ${skipped} 个跳过）` : ""}`);
    } catch { /* 忽略 */ }
  }

  // ============================================================
  // 2026-08-28：朗读设置面板（14 项）处理函数
  // ============================================================
  function syncTtsCfg() {
    // 与 ttsSettingsNow 保持同样的缺字段合并策略（Plugin 端只存子集）
    const raw = (getTtsSettings?.() as Partial<RewordTtsSettings> | null) || null;
    const s: RewordTtsSettings = { ...DEFAULT_REWORD_TTS, ...(raw || {}) };
    ttsCfg = { ...s };
    ttsRate = s.rate;
    ttsHighlightOn = s.enableHighlight;
    loadTtsVoices(); // 打开设置面板时刷新本机可用嗓音列表
  }
  function saveTtsCfg() {
    ttsCfg = { ...ttsCfg };
    void saveTtsSettings?.({ ...ttsCfg });
    ttsController?.setSettings({ ...ttsCfg });
  }
  function setTtsField<K extends keyof RewordTtsSettings>(k: K, v: RewordTtsSettings[K]) {
    ttsCfg = { ...ttsCfg, [k]: v };
    saveTtsCfg();
  }
  function onTtsRateSetting(e: Event) {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (isNaN(v)) return;
    ttsRate = v;
    ttsController?.setRate(v); // 即时生效
    // 持久化（独立落盘，不经由 setTtsField 的 setSettings，避免打断朗读）
    ttsCfg = { ...ttsCfg, rate: v };
    if (rateSaveTimer) clearTimeout(rateSaveTimer);
    rateSaveTimer = setTimeout(() => {
      rateSaveTimer = null;
      void saveTtsSettings?.({ ...ttsCfg });
    }, 400);
  }
  function onTtsPitch(e: Event) { setTtsField("pitch", parseFloat((e.currentTarget as HTMLInputElement).value)); }
  function onTtsVolume(e: Event) { setTtsField("volume", parseFloat((e.currentTarget as HTMLInputElement).value)); }
  function onTtsInterval(e: Event) { setTtsField("interval", parseInt((e.currentTarget as HTMLInputElement).value, 10)); }
  function onTtsEngine(e: Event) { setTtsField("engine", (e.currentTarget as HTMLSelectElement).value as RewordTtsSettings["engine"]); }
  function onTtsAccent(e: Event) { setTtsField("accent", (e.currentTarget as HTMLSelectElement).value as "uk" | "us"); }
  function onTtsVoiceZh(e: Event) { setTtsField("preferVoiceURIZh", (e.currentTarget as HTMLSelectElement).value || undefined); }
  function onTtsVoiceEn(e: Event) { setTtsField("preferVoiceURIEn", (e.currentTarget as HTMLSelectElement).value || undefined); }
  function onTtsIflytekAppId(e: Event) { setTtsField("iflytekAppId", (e.currentTarget as HTMLInputElement).value.trim() || undefined); }
  function onTtsIflytekApiKey(e: Event) { setTtsField("iflytekApiKey", (e.currentTarget as HTMLInputElement).value.trim() || undefined); }
  function onTtsIflytekApiSecret(e: Event) { setTtsField("iflytekApiSecret", (e.currentTarget as HTMLInputElement).value.trim() || undefined); }
  function onTtsIflytekVoice(e: Event) { setTtsField("iflytekVoice", (e.currentTarget as HTMLSelectElement).value || "xiaoyan"); }
  function onTtsGranularity(e: Event) { setTtsField("granularity", (e.currentTarget as HTMLSelectElement).value as "sentence" | "word"); }
  function onTtsScope(e: Event) { setTtsField("scope", (e.currentTarget as HTMLSelectElement).value as "selection" | "section" | "book"); }
  function onTtsHighlightStyle(e: Event) { setTtsField("highlightStyle", (e.currentTarget as HTMLSelectElement).value as RewordTtsSettings["highlightStyle"]); }
  function onTtsHighlightColor(e: Event) { setTtsField("highlightColor", (e.currentTarget as HTMLInputElement).value); }
  function onTtsAutoPage(e: Event) { setTtsField("autoPage", (e.currentTarget as HTMLInputElement).checked); }
  function onTtsHighlightEnabled(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).checked;
    ttsHighlightOn = v;
    setTtsField("enableHighlight", v);
  }
  function onTtsSleep(e: Event) { setTtsField("sleepTimerMin", parseInt((e.currentTarget as HTMLSelectElement).value, 10)); }

  // 翻译选中文本（2026-08-27 原行为：仅发 AI 精读面板；
  // 2026-08-27 晚 改：弹内联即译气泡，展示原文/译文，并保留「发 AI 精读」入口）
  /**
   * 划词工具栏「翻译」按钮（2026-08-27 重设计）：
   * 直接把选中文本拼上 AI 设置里的「翻译预置提示词」，发送并聚焦 AI 精读面板。
   * 不再弹内联即译卡片（内联卡片已移除，译文改为顶栏「双语」开关逐段注入）。
   */
  function onSelTranslate() {
    const text = selToolbar.text?.trim();
    closeSelToolbar();
    if (!text) return;
    if (onTranslateToAi) onTranslateToAi(text);
    else toast("翻译未配置：请先在 AI 设置中开启并填写 API");
  }

  // ========== 2026-08-27 重设计：双语对照开关 ==========
  /** 双语整批失败 toast 冷却时间戳：避免滚动补译时反复弹 */
  let bilingualFailToastAt = 0;

  /** 懒创建双语注入句柄（仅一次） */
  function ensureBilingualHandle(): BilingualHandle {
    if (bilingualHandle) return bilingualHandle;
    const target = settingsStore.get().bilingualTarget || "zh";
    bilingualHandle = createBilingual({
      bookId,
      getContents: () => {
        try {
          // 2026-08-28 致命修复：foliate 的 getContents() 返回的是
          // [{index, overlayer, doc}, ...]，真正的 Document 在 .doc 字段
          // （见 vendor/foliate-js/view.js:288/544/688 均以 { doc } 解构）。
          // 原代码直接把数组元素当 Document 用 → doc.querySelectorAll 抛
          // TypeError → injectAll 在收集段落阶段崩溃 → 译文全空、按钮却绿。
          const raw = (view?.renderer?.getContents?.() as any[]) || [];
          const mapped = raw.map((c) => c?.doc).filter(Boolean) as Document[];
          if (mapped.length === 0) {
            console.warn("[REword] 双语 getContents: 返回空文档数组", {
              hasView: !!view,
              hasRenderer: !!(view?.renderer),
              rawLength: raw.length,
              rawKeys: raw[0] ? Object.keys(raw[0]) : [],
            });
          } else {
            console.log(`[REword] 双语 getContents: ${raw.length} 个分节 → ${mapped.length} 个有效文档`);
          }
          return mapped;
        } catch (e) {
          console.error("[REword] 双语 getContents 异常:", e);
          return [];
        }
      },
      translateBatch: (texts, from, to) =>
        onTranslateBatch ? onTranslateBatch(texts, from, to) : Promise.resolve([]),
      to: target,
      // 2026-08-28：预取页数动态读设置（用户可在面板调 0~8；默认 2）
      getPrefetchPages: () => settingsStore.get().bilingualPrefetchPages ?? 2,
      // 2026-08-28：每批翻译成功入缓存后，回传「节」序号（1-based）+ 书名，刷新「第 X-Y 页」统计
      onSectionsCached: (bid: string, sections: number[]) => {
        recordCachedSections?.(bid, sections, meta?.title || title || "");
        // 若当前查看的正是该书，立即刷新计数与书名列表
        if (!selectedCacheBookId || selectedCacheBookId === bid) {
          refreshCacheStats(bid);
        }
        refreshCacheBookList();
      },
      onProgress: (done, total) => {
        bilingualProgress = { done, total, active: done < total };
        // 2026-08-28 修复：整批翻译失败（total>0 且 done===0）明确告知用户，
        // 否则 AI 配置错误/网络/限流被静默吞掉、用户无感知。8 秒冷却防刷屏。
        if (total > 0 && done === 0 && Date.now() - bilingualFailToastAt > 8000) {
          bilingualFailToastAt = Date.now();
          toast("双语翻译失败：请检查「AI 设置 → AI 服务」配置与网络", 3200, "error" as any);
        }
        if (done >= total) {
          setTimeout(() => {
            bilingualProgress = { ...bilingualProgress, active: false };
            // 翻译完成后读取累计 token 用量（由 index.ts 的 aiTranslateBatch 填充）
            const usage = getLastUsage?.() ?? null;
            if (usage && usage.totalTokens > 0) {
              bilingualTokenUsage = { ...usage };
            }
            // v1.3.0：同步刷新「本书 Token」累计显示
            refreshBookTokenUsage();
            // 2026-08-28：刷新「已缓存 N 段」统计（翻译后缓存条数会变）
            refreshCacheStats(selectedCacheBookId || bookId);
          }, 800);
        }
      },
      onTokenUsage: (usage) => {
        bilingualTokenUsage = { ...usage };
      },
    });
    return bilingualHandle;
  }

  /** 开启双语（前置检查引擎是否已配置） */
  function enableBilingual(): void {
    if (!isTranslationConfigured || isTranslationConfigured()) {
      ensureBilingualHandle().setEnabled(true);
      bilingualOn = true;
      refreshCacheStats(bookId);
      refreshCacheBookList();
    } else {
      toast("请先在「AI 设置 → AI 服务」中配置并启用 AI（翻译默认走 AI）", 3200, "info" as any);
    }
  }

  /** 关闭双语（移除全部注入节点） */
  function disableBilingual(): void {
    // 2026-08-28 修复：先把 UI 状态置回 false，再调 handle。
    // 原顺序下若 setEnabled(false) 内部 removeAll() 抛异常（foliate 分节文档
    // 被部分销毁时可能抛 DOMException），会导致 bilingualOn 永远停在 true，
    // 按钮「关不掉」。现在即使 handle 失败，状态也已正确复位。
    bilingualOn = false;
    bilingualProgress = { done: 0, total: 0, active: false };
    bilingualTokenUsage = null;
    try {
      bilingualHandle?.setEnabled(false);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[REword] 关闭双语时移除注入失败（已忽略）:", e);
    }
  }

  /** 顶栏「双语」按钮：切换并持久化到阅读设置 */
  function toggleBilingual(): void {
    console.log("[REword] 双语按钮点击, 当前状态:", bilingualOn);
    try {
      if (bilingualOn) {
        disableBilingual();
        settingsStore.update({ bilingual: false });
      } else {
        const configured = !isTranslationConfigured || isTranslationConfigured();
        console.log("[REword] 双语: 开启检查, isTranslationConfigured=", configured);
        if (configured) {
          console.log("[REword] 双语: 调用 setEnabled(true)");
          ensureBilingualHandle().setEnabled(true);
          bilingualOn = true;
          settingsStore.update({ bilingual: true });
        } else {
          toast("请先在「AI 设置 → AI 服务」中配置并启用 AI（翻译默认走 AI）", 3200, "info" as any);
        }
      }
    } catch (e) {
      // 2026-08-28 防御：任何异常都不应锁死按钮状态
      console.warn("[REword] 双语切换异常:", e);
      bilingualOn = false;
      bilingualProgress = { done: 0, total: 0, active: false };
      settingsStore.update({ bilingual: false });
      toast("双语功能异常，请重试或重启插件", 2500, "error" as any);
    }
  }


  /**
   * F11 全屏：整块阅读区进入浏览器全屏（Esc 由浏览器原生退出）。
   * reader-shortcuts.ts 的注册表里早就有 toggleFullscreen 这一项，
   * 但此前没有任何地方接它，键位等于空头支票。
   */
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen?.();
      } else {
        void (readerViewEl as any)?.requestFullscreen?.();
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · toggleFullscreen", "warn"); }
  }

  /**
   * 构造「回跳原书」深链（2026-08-29 新增，对齐 Obsidian weave 的双向溯源）。
   * 形如 siyuan://plugins/siyuan-plugin-rewordreader?data={"bookId":"…","cfi":"…"}
   *  - 思源点击该链接 → 派发 open-siyuan-url-plugin 事件（见 index.ts onOpenBookUrl）
   *    → 打开 / 聚焦该书阅读 Tab → goTo 到 CFI，精确定位回原文。
   *  - 同时符合思源自定义协议约定（<插件名><Tab 类型>），即使思源内核先按内置逻辑
   *    开了一次 Tab，也能带上 bookId 命中同一本书，不会产生空白页签。
   * @returns Markdown 链接；cfi/bookId 缺失时返回空串（模板里自然留空，不留死链）
   */
  function buildBookDeepLink(cfi: string): string {
    if (!cfi || !bookId) return "";
    try {
      const data = encodeURIComponent(JSON.stringify({ bookId, cfi }));
      return `[回原文](siyuan://plugins/siyuan-plugin-rewordreader?data=${data})`;
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "ReaderView.svelte · buildBookDeepLink", "warn");
      return "";
    }
  }

  /**
   * 笔记模板渲染（纯函数，2026-08-24 新增）
   * 把 linkFormat 模板里的 {{var}} 变量替换为实际值。
   * 未知变量保留原样（不抛错），便于模板编辑时即时预览。
   */
  function renderNoteTemplate(
    template: string,
    vars: {
      bookTitle?: string;
      author?: string;
      chapter?: string;
      cfi?: string;
      link?: string;
      text?: string;
      note?: string;
      image?: string;
      date?: string;
    }
  ): string {
    if (!template) return vars.text || "";
    return template.replace(/\{\{(\w+)\}\}/g, (m, name) => {
      const v = (vars as any)[name];
      return v === undefined || v === null ? m : String(v);
    });
  }

  // 发送选中文本（2026-08-24 增强：按 linkFormat 模板渲染 + 按 insertPosition 分发）
  function onSelSend() {
    const text = selToolbar.text?.trim();
    if (!text) return;
    closeSelToolbar();
    const noteSettings = settings.note;
    const now = new Date();
    const ts = `${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    // 1. 渲染 markdown（按 linkFormat 模板，缺省时用 simple）
    const template = noteSettings.linkFormat || NOTE_TEMPLATE_PRESETS.simple.template;
    const md = renderNoteTemplate(template, {
      bookTitle: title || "阅读",
      author: bookAuthor || "",
      chapter: chapterLabel || "",
      cfi: selInfo?.cfi || "",
      // 2026-08-29：回跳原书的深链（此前恒为空串，模板里 {{link}} 永远渲染不出东西）
      link: buildBookDeepLink(selInfo?.cfi || ""),
      text,
      note: "",
      image: "",
      date: now.toISOString().slice(0, 10),
    });
    // 2. 按 insertPosition 分发
    const pos = noteSettings.insertPosition;
    if (pos === "clipboard") {
      try {
        navigator.clipboard?.writeText(md);
        toast("已复制到剪贴板");
      } catch {
        toast("复制失败，请检查浏览器剪贴板权限");
      }
      return;
    }
    if (pos === "currentDoc") {
      // 当前文档：降级到 saveToNote（因为 onInsertToCurrentDoc 是可选 callback）
      if (onInsertToCurrentDoc) {
        const r = onInsertToCurrentDoc(md);
        if (r && typeof (r as Promise<string>).then === "function") {
          (r as Promise<string>).then(() => toast("已插入当前文档")).catch(() => toast("插入失败"));
        } else {
          toast("已插入当前文档");
        }
      } else if (onSendToNote) {
        // 降级：写入默认笔记本
        const r = onSendToNote({ markdown: md, title: `${title || "阅读"}摘录 ${ts}` });
        if (r && typeof (r as Promise<string>).then === "function") {
          (r as Promise<string>).then(() => toast("已发送（未配置 currentDoc，降级到笔记本）")).catch(() => toast("发送失败"));
        } else {
          toast("已发送");
        }
      } else {
        toast("未配置发送目标，请在思源笔记的 REword 设置中配置笔记本");
      }
      return;
    }
    // notebook
    if (!onSendToNote) { toast("发送未配置"); return; }
    const r = onSendToNote({ markdown: md, title: `${title || "阅读"}摘录 ${ts}` });
    if (r && typeof (r as Promise<string>).then === "function") {
      (r as Promise<string>).then(() => toast("已发送到笔记本")).catch(() => toast("发送失败"));
    } else {
      toast("已发送到笔记本");
    }
  }

  // 2026-08-24 重构（对标 Readest 删除模型）：删除 = 视觉擦除 + 数据软删除，两步独立。

  // 2026-08-24 重构（对标 Readest 删除模型）：
  // 删除 = 视觉擦除 + 数据软删除，两步独立、互不阻塞。
  //   - 视觉：view.addAnnotation(cfi, true) —— foliate 官方"擦除"语义（true 即删除），
  //           与 readest 的 `view.addAnnotation(existing, true)` 完全一致。
  //   - 数据：annStore.remove(id) —— 软删除（置 deletedAt），所有读取路径已过滤，
  //           翻页重绘（onCreateOverlay）时再过滤一次，残余高亮自动消失。
  // 不再做"是否真的删到"的自验证与多轨暴力兜底——那是 v5 反复失败的根源：
  // foliate 内部静默失败时误判成功会让兜底永远不跑；而 readest 的软删除 + 重绘过滤
  // 天然保证"最终一致"，无需验证。

  // 2026-08-26 退回 foliate 原生：删除即 foliate 的 deleteAnnotation（= addAnnotation(ann, true)），
  // 内部 resolveNavigation(cfi) → 找该分节 overlayer → overlayer.remove(value)。
  // 兜底：若 foliate 静默失败（fixed-layout 页码错位等），用 eraseOverlayKey 遍历所有
  // 已渲染 overlay（foliate 原生 overlayer）按宽松 CFI 匹配强制移除，确保视觉消失。
  async function eraseAnnotationVisual(cfi: string): Promise<boolean> {
    if (!view || !cfi) return false;
    console.log("[REword] eraseAnnotationVisual 开始, cfi=", cfi);
    // 1) foliate 原生删除
    try {
      await view.deleteAnnotation({ value: cfi, color: "", style: "highlight", note: "" });
    } catch (e) {
      console.warn("[REword] foliate deleteAnnotation 抛错:", e);
    }
    // 2) 兜底：按 key 遍历所有已渲染 overlay（foliate 原生）强制移除（宽松 CFI 匹配）
    const removed = eraseOverlayKey(view, cfi);
    const still = hasOverlayKey(view, cfi);
    console.log("[REword] eraseOverlayKey 移除数=", removed, ", 残留=", still);
    if (removed > 0 || !still) {
      console.log("[REword] 删除成功（步骤2）");
      return true;
    }
    // 3) 核选项：清空全部 overlay SVG + 触发重绘（完全不依赖 CFI 匹配）
    console.log("[REword] 步骤2失败，启动核选项 nukeAndRedrawOverlays");
    const nuked = nukeAndRedrawOverlays(view);
    console.log("[REword] 核选项清除 overlay 数=", nuked);
    return nuked > 0;
  }

  /** 清除「残留高亮」（数据层已无记录，仅剩视觉）。兜底分支（onShowAnnotation !rec）的删除出口。 */
  async function onClearGhostHighlight() {
    // 2026-08-24 根治：优先用独立缓存 activeAnnCfi（onShowAnnotation ghost 分支已缓存）
    const cfi = activeAnnCfi ?? selToolbar.ghostCfi ?? "";
    if (!cfi) {
      closeSelToolbar();
      return;
    }
    await eraseAnnotationVisual(cfi);
    // 全量 reconcile 兜底：数据中已无该 cfi，残留必然被清
    if (annStore && bookId) syncVisualWithStore(view, annStore, bookId);
    annByValue.delete(cfi);
    closeSelToolbar();
    toast("已清除残留高亮");
  }

  // 划词工具栏 edit 模式：点击「删除」按钮立即移除该标注并重置界面（P0 B2：删除时清 selInfo，
  // 避免带着已删标注的锚点；统一走 closeSelToolbar 关样式条）。另提供 3 秒内「撤销」（见 P2 O4）。
  async function onAnnDeleteById() {
    // 2026-08-24 根治：优先用独立缓存 activeAnnId（不受 selToolbar.editingId 被重置影响）
    let id = activeAnnId ?? selToolbar?.editingId ?? null;
    console.log("[REword] onAnnDeleteById 开始, id=", id, ", editingId=", selToolbar?.editingId, ", activeAnnId=", activeAnnId, ", activeAnnCfi=", activeAnnCfi);

    // 2026-08-24 兜底：若 id 仍为空但有 CFI，按 CFI 在 annStore 中反查记录取真实 id
    if ((!id || id === "undefined") && annStore && activeAnnCfi) {
      const byBook = annStore.getByBook(bookId || "");
      const nc = (s: string) => String(s || "").replace(/^epubcfi\(/i, "").replace(/\)+$/, "");
      const target = nc(activeAnnCfi);
      const found = byBook.find((it: any) => {
        const a = nc(it.cfi);
        return a === target || (a && (a.startsWith(target) || target.startsWith(a)));
      });
      if (found?.id) {
        id = found.id;
        console.log("[REword] onAnnDeleteById CFI反查成功: id=", id, ", cfi=", activeAnnCfi);
      }
    }

    if (!id || !annStore) {
      // 即使没有 store id，只要有 cfi 就尝试清除视觉高亮（纯视觉残留场景）
      const fallbackCfi = activeAnnCfi ?? selInfo?.cfi ?? "";
      if (fallbackCfi) {
        console.log("[REword] onAnnDeleteById 无store id，尝试纯视觉清除: cfi=", fallbackCfi);
        await eraseAnnotationVisual(fallbackCfi);
        syncVisualWithStore(view, annStore, bookId || "");
        annByValue.delete(fallbackCfi);
        closeSelToolbar();
        toast("已删除");  // 纯视觉清除成功，高亮已消失
        return;
      }
      // 既无 id 也无 cfi：真正无法定位目标
      closeSelToolbar();
      toast("未找到标注记录");
      return;
    }
    // 取目标记录：优先 annStore.get(id)；缺失时经 edit 工具栏锚点（selInfo.cfi）
    // 与 annByValue 兜底反查，确保删除一定命中正确记录。
    let stored = annStore.get(id);
    let cfi = stored?.cfi ?? activeAnnCfi ?? "";
    if (!stored || !cfi) {
      const fallbackCfi = selInfo?.cfi ?? "";
      if (fallbackCfi) {
        const hit = annStore.getByBook(bookId).find((it: any) => it.cfi === fallbackCfi);
        if (hit) { stored = annStore.get(hit.id); cfi = hit.cfi; }
      }
      if ((!stored || !cfi) && fallbackCfi && annByValue.has(fallbackCfi)) {
        const rec = annByValue.get(fallbackCfi)!;
        cfi = rec.cfi;
        if (rec.id) stored = annStore.get(rec.id) ?? stored;
      }
    }
    if (!stored) {
      console.log("[REword] 删除: stored 未找到, id=", id, ", 兜底 cfi=", cfi);
      // 记录层面已缺失：至少清掉 foliate 高亮与映射，避免"数据无但看得见"
      if (cfi) {
        await eraseAnnotationVisual(cfi);
        annByValue.delete(cfi);
      }
      closeSelToolbar();
      toast("标注记录已不存在，已清理高亮");
      return;
    }
    // 缓存用于撤销（软删除后数据仍在，撤销只清 deletedAt）
    const removed = {
      id: stored.id,
      cfi,
      style: (stored?.style as AnnotationStyle) || "highlight",
      color: stored?.color || WHALE_COLORS[2].value,
      note: stored?.note ?? "",
      selectedText: stored?.selectedText ?? "",
      group: stored?.group ?? "未分组",
    };
    // 数据软删除（对标 Readest：置 deletedAt，读取路径自动过滤）
    console.log("[REword] 删除: 找到记录, id=", stored.id, ", cfi=", cfi);
    await annStore.remove(stored.id);
    // 视觉擦除：foliate 官方"擦除"语义（true = 删除）+ 按 key 强制移除兜底。
    // 2026-08-24 根治：不再依赖 foliate 返回值，eraseAnnotationVisual 内部会
    // 用 eraseOverlayKey 遍历所有已渲染 overlay 移除；再全量 reconcile 一次，
    // 保证"数据已软删的 cfi 在当前页视觉上一定消失"（覆盖 key 写法差异/多 view/fixed-layout）。
    if (cfi) {
      await eraseAnnotationVisual(cfi);
      annByValue.delete(cfi);
    }
    if (annStore) syncVisualWithStore(view, annStore, bookId);
    // 清除选区，让界面恢复到未选中、无标注的常规状态
    try {
      const contents = view?.renderer?.getContents?.() || [];
      for (const c of contents) {
        const doc = c.doc;
        const win = doc?.defaultView;
        if (win) {
          const sel = win.getSelection();
          if (sel) sel.removeAllRanges();
        }
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · try { const contents = view?.renderer?.getContents?.() || []; f…", "debug"); }
    closeSelToolbar();
    // 提供撤销：缓存刚删除的记录，3 秒后可恢复（P2 O4）；撤销即清 deletedAt
    pendingDelete = removed;
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { pendingDelete = null; }, 3000);
    toastWithUndo("已删除");
  }

  /** 撤销刚删除的标注（清掉软删除时间戳，数据重新生效并重建高亮） */
  async function undoDelete() {
    if (!pendingDelete || !annStore) return;
    const r = pendingDelete;
    pendingDelete = null;
    if (undoTimer) clearTimeout(undoTimer);
    try {
      // 1) 清软删除标记，恢复数据活跃
      annStore.restore(r.id);
      // 2) 重建视觉高亮（foliate 原生：addAnnotation 解析 CFI 并重绘）
      if (r.cfi) {
        await addReaderAnnotation({ id: r.id, cfi: r.cfi, color: r.color, style: r.style, note: r.note || "" });
        annByValue.set(r.cfi, { id: r.id, cfi: r.cfi, color: r.color });
      }
      toast("已撤销");
    } catch (err) {
      console.warn("[REword] 撤销删除失败:", err);
      toast("撤销失败");
    }
  }


  // 卡片内「相似词候选」可点击二次查词
  function onDictBodyClick(e: MouseEvent) {
    const rawTarget = e.target as HTMLElement;
    // 用 closest 向上查找带 data-action 的祖先（点到按钮内部 span/文字时仍能命中）
    const target = (rawTarget.closest("[data-action]") as HTMLElement) || rawTarget;
    const action = target.dataset.action;
    const word = target.dataset.text || target.dataset.word;

    // ── 朗读 ──
    if (action === "tts" && word) {
      onSpeak?.(word);
      return;
    }

    // ── 加入/移出词库 ★ ──
    if (action === "vocab-star") {
      const w = (target.getAttribute("data-word") || "").trim();
      if (w) {
        const on = target.classList.contains("star-on");
        if (on) {
          onRemoveFromVocab?.(w);
          target.classList.remove("star-on");
          target.textContent = "☆";
          target.title = "加入词库";
        } else {
          onAddToVocab?.(w);
          target.classList.add("star-on");
          target.textContent = "★";
          target.title = "移出词库";
        }
      }
      return;
    }

    // ── 候选词再查 ──
    if (action === "lookup-candidate" && word) {
      runDictLookup(word, { x: dictPopup.x, y: dictPopup.y, source: (dictPopupSource as any) ?? "hover" });
      return;
    }

    // ── 词性区块折叠/展开 ──
    if (action === "toggle-pos") {
      const block = target.closest(".hiword-vb-pos-block") as HTMLElement | null;
      if (block) togglePosCollapsed(block);
      return;
    }

    // ── 释义/词组 section 折叠/展开 ──
    if (action === "toggle-section") {
      const sec = target.closest(".hiword-detail-section") as HTMLElement | null;
      if (sec) sec.classList.toggle("hiword-detail-sec-collapsed");
      return;
    }

    // ──「查看全部 N 个义项」展开/收起 ──
    if (action === "toggle-senses") {
      const full = target.nextElementSibling as HTMLElement | null;
      if (full && full.classList.contains("hiword-dict-senses-full")) {
        const willShow = full.hidden;
        full.hidden = !willShow;
        target.classList.toggle("hiword-dict-senses-open", willShow);
        const arrow = target.querySelector(".hiword-dict-senses-toggle-arrow");
        if (arrow) arrow.textContent = willShow ? "▴" : "▾";
        // 展开全量时隐藏初始 4 条，收起时恢复
        const initial = target.parentElement?.querySelector(".hiword-dict-senses-initial") as HTMLElement | null;
        if (initial) initial.hidden = willShow;
      }
      return;
    }

    // ── 义项内例句展开/收起 ──
    if (action === "toggle-examples") {
      const moreContainer = target.closest(".hiword-dict-sense-ex-more");
      const rest = moreContainer?.querySelector(".hiword-dict-sense-ex-rest") as HTMLElement | null;
      if (moreContainer && rest) {
        const willShow = rest.hidden;
        rest.hidden = !willShow;
        const exCount = moreContainer.querySelectorAll(".hiword-dict-sense-ex-row").length;
        target.innerHTML = `<span class="hiword-dict-sense-toggle-arrow">${willShow ? "▴" : "▾"}</span> ${willShow ? "收起例句" : `展开 ${Math.max(0, exCount - 1)} 条例句`}`;
      }
      return;
    }
  }

  function closeDictPopup() {
    dictPopupSource = null;
    dictPopup = { ...dictPopup, visible: false };
  }

  /** 将当前弹窗单词发送到 REword 侧边栏查词（自动填入输入框并查询，不关闭阅读弹窗） */
  function sendToSidebar() {
    const w = (dictPopup.word || hoverWord || "").trim();
    if (w && onOpenInSidebar) onOpenInSidebar(w);
  }

  // 2026-08-27：悬浮弹窗——光标进入/离开时的收起控制
  function onDictPopupEnter() {
    clearHoverHide();
  }
  function onDictPopupLeave() {
    if (dictPopupSource === "hover") scheduleHoverHide();
  }

  // 订阅阅读设置：设置变更（含其它已开 Tab）即自动重刷样式，
  // 根除"设置不生效 / 多 Tab 样式漂移 / 启动异步竞态用默认设置打开"
  let unsubSettings: (() => void) | undefined;
  // 2026-08-24：dock 批注面板等"旁路删除"广播 → 本 ReaderView 全量 reconcile，
  // 保证当前页被删高亮立即消失（不依赖翻页重绘）
  let unsubAnnChanged: (() => void) | undefined;
  onMount(() => {
    unsubSettings = settingsStore.subscribe((s) => {
      settings = s;
      applyContainerBg();
      if (view) applyStyles();
      // 2026-08-27：双语状态从设置一次性恢复（仅首次订阅时）
      if (!bilingualInitDone) {
        bilingualInitDone = true;
        if (s.bilingual) enableBilingual();
      }
    });
    unsubAnnChanged = subscribeAnnotationsChanged((bid) => {
      if (bid === bookId && view) syncVisualWithStore(view, annStore, bookId);
    });
    // load() 解析后推送最新设置，订阅回调自动 applyStyles（view 就绪时）
    startTimer();
    // 先等待设置/字体加载完成再开书：用用户真实主题打开，避免打开瞬间用默认主题、iframe 透明导致的黑底/错主题闪屏
    void (async () => {
      await Promise.all([settingsStore.load(), fontStore.load()]);
      refreshFonts();
      applyContainerBg();
      await openBook();
      // 2026-08-28：打开书后刷新翻译缓存统计 + 有缓存的书籍列表（默认查看本书）
      refreshCacheStats(bookId);
      refreshCacheBookList();
    })();
    // 2026-08-23 修复：mousedown 监听绑到 readerViewEl 容器（不是 document），
    //   避免影响思源顶栏"管理"等原生 UI 的点击时序（用户在阅读 Tab 时点不动"管理"）。
    //   监听范围严格限定在 .reader-view 内部（toolbar / popover / foliate 内容），
    //   reader-view 外部的点击（思源命令面板、dock、顶栏 Tab 切换）完全不触发。
    if (readerViewEl) {
      readerViewEl.addEventListener("mousedown", onContainerMouseDown);
      // [REword patch 2026-08-29] Phase 3 Apple Pencil 墨迹批注
      // pointer 监听绑到 readerViewEl（不在 iframe doc 内，main 文档级）
      // 拦截 pen / touch pointer 用于墨迹绘制（仅 PDF + ink 模式）
      readerViewEl.addEventListener("pointerdown", onInkPointerDown);
      readerViewEl.addEventListener("pointermove", onInkPointerMove);
      readerViewEl.addEventListener("pointerup", onInkPointerUp);
      readerViewEl.addEventListener("pointercancel", onInkPointerUp);
    }
    // [REword patch 2026-08-29] PDF ⌘/Ctrl+滚轮缩放（页面四周留白区）延迟到 openBook 里、
    // 确认是 PDF 之后再绑（bindStageWheel）：非 PDF 不挂 passive:false 的 wheel，
    // 避免拖累 EPUB 的滚轮滚动性能。页面本体的监听在 attachContentDoc。
    // [REword patch 2026-08-29] 移动端 PDF 适配 Phase 1
    // 设备分级检测 + resize 监听（横竖屏切换时更新设备类）
    deviceClass = getDeviceClass();
    isIphoneMode = isSmallMobile();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", onDeviceClassResize);
      window.addEventListener("orientationchange", onDeviceClassResize);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("selectionchange", onMainSelectionChange);
      // 2026-08-29 修复：方向键翻页失效
      // 在 main document 上 capture 阶段注册 keydown，
      // 不管焦点在 reader-view / iframe / 工具栏 / 批注 / 搜索框，方向键都能稳定翻页。
      // onGlobalKey 内部跳过 input/textarea/contenteditable 保留原生行为。
      document.addEventListener("keydown", onGlobalKey, true);
      // 2026-08-29 双击缩放：PDF 上双击切换 fit-width ↔ 上次缩放
      // 也注册到 main document capture 阶段（iframe 内的 dblclick 也会冒泡）
      document.addEventListener("dblclick", onDblClickToggleZoom, true);
      // 2026-08-29：点击脚注气泡外部（reader UI 空白区）关闭
      document.addEventListener("pointerdown", onFootnoteOutsidePointerDown as EventListener, true);
    }
    // 跟随思源主题（2026-08-25 新增）
    startThemeObserver();
    // 2026-08-28：初始化连续朗读控制器
    ensureTtsController();
  });

  onDestroy(() => {
    if (unsubSettings) unsubSettings();
    if (unsubAnnChanged) unsubAnnChanged();
    if (saveTimer) clearTimeout(saveTimer);
    if (selReadTimer) clearTimeout(selReadTimer);
    if (timeTimer) clearInterval(timeTimer);
    if (attachTimer1) clearTimeout(attachTimer1);
    if (attachTimer2) clearTimeout(attachTimer2);
    if (turnTimer) clearTimeout(turnTimer);
    if (turnInterval) clearInterval(turnInterval);
    if (annotatePressTimer) clearTimeout(annotatePressTimer);
    if (toastTimer) clearTimeout(toastTimer);
    if (undoTimer) clearTimeout(undoTimer);
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    // v1.3.0：本书上下文编辑器销毁 + 落盘未保存内容
    flushPrimerSave();
    destroyPrimerEditor();
    // 2026-08-27：双语注入句柄销毁（移除全部译文节点，零残留）
    try { bilingualHandle?.destroy(); } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · try { bilingualHandle?.destroy(); }", "debug"); }
    bilingualHandle = null;
    if (sessionReadMs > 0) void store.addReadingTime(bookId, sessionReadMs);
    // 2026-08-23 修复：listener 绑在 readerViewEl（不是 document）
    if (readerViewEl) {
      readerViewEl.removeEventListener("mousedown", onContainerMouseDown);
      // [REword patch 2026-08-29] Phase 3 注销 ink pointer 监听
      readerViewEl.removeEventListener("pointerdown", onInkPointerDown);
      readerViewEl.removeEventListener("pointermove", onInkPointerMove);
      readerViewEl.removeEventListener("pointerup", onInkPointerUp);
      readerViewEl.removeEventListener("pointercancel", onInkPointerUp);
    }
    // [REword patch 2026-08-29] 移动端 PDF 适配 Phase 1
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", onDeviceClassResize);
      window.removeEventListener("orientationchange", onDeviceClassResize);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("selectionchange", onMainSelectionChange);
      // 2026-08-29 修复：注销 main document capture 阶段 keydown 监听
      document.removeEventListener("keydown", onGlobalKey, true);
      // 注销双击缩放
      document.removeEventListener("dblclick", onDblClickToggleZoom, true);
      // 注销脚注气泡外部点击关闭
      document.removeEventListener("pointerdown", onFootnoteOutsidePointerDown as EventListener, true);
    }
    // [REword patch 2026-08-29] 注销 PDF 滚轮缩放（页面四周留白）+ 清掉落盘防抖定时器
    if (stageWheelBound && readerViewEl) {
      // 第三个参数必须传 capture:true 才能移除捕获阶段的监听（与 bindStageWheel 对称）
      readerViewEl.removeEventListener("wheel", onStageWheel as EventListener, true);
      stageWheelBound = false;
    }
    if (zoomSaveTimer) { clearTimeout(zoomSaveTimer); zoomSaveTimer = null; }
    // 注销 PDF 滚轮缩放累积的 rAF（组件销毁后回调不该再跑）
    if (wheelRafId != null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(wheelRafId);
      wheelRafId = null;
    }
    wheelAccumDy = 0;
    // 滚动模式缩放预览：清提交定时器；若仍停在预览态，必须复位 foliate 的 #pinching，
    // 否则 #scheduleScrollPages 会永久 return，页面加载/回收全部停摆。
    if (wheelCommitTimer) { clearTimeout(wheelCommitTimer); wheelCommitTimer = null; }
    if (wheelPinchActive) {
      wheelPinchActive = false;
      wheelPinchRatio = 1;
      try {
        (view?.renderer as any)?.pinchEnd?.();
      } catch (__swallowErr) {
        logSwallow(__swallowErr, "ReaderView.svelte · pinchEnd cleanup", "debug");
      }
    }
    // 停止思源主题跟随观察器（2026-08-25 新增）
    stopThemeObserver();
    // 2026-08-24 修复：卸载 foliate view 事件 + 内容文档监听 + 清除搜索高亮，
    // 避免反复进出阅读 Tab 造成的事件泄漏/悬空回调（P0 #1/#2）与残留搜索高亮干扰 hitTest（P1 #7）。
    teardownAnnotationLayer();
    detachAllContentDocs();
    try { view?.clearSearch?.(); } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · try { view?.clearSearch?.(); }", "debug"); }
    try {
      view?.close?.();
    } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · try { view?.close?.(); }", "debug"); }
    // 2026-08-28：朗读控制器清理（停止朗读 + 移除临时高亮，零残留）
    try { ttsController?.dispose(); } catch (__swallowErr) { logSwallow(__swallowErr, "ReaderView.svelte · ttsController.dispose", "debug"); }
    ttsController = null;
    view = null;
  });
</script>

<div
  class="reader-view"
  bind:this={readerViewEl}
  on:mousemove={wakeChrome}
  on:mouseleave={hideChromeNow}
>
  <div class="reader-toolbar" class:reader-toolbar-hidden={!toolbarVisible} class:reader-toolbar-iphone={isIphoneMode}>
    <button
      class="reader-btn"
      title={onCloseTab ? "关闭阅读（书架在侧边栏）" : "返回书架"}
      on:click={() => (onCloseTab ? onCloseTab() : onBack())}
    >‹</button>
    <span class="reader-title" title={title} style="user-select:text;cursor:text">{title}</span>
    {#if chapterLabel}
      <span class="reader-chapter" title={chapterLabel} style="user-select:text;cursor:text">{chapterLabel}</span>
    {/if}
    <span class="reader-spacer"></span>
    <span class="reader-progress">{progressText}</span>
    {#if !isIphoneMode}
      <!-- [REword patch 2026-08-29] 桌面 / iPad 完整模式：双语 + 设置 + 搜索按钮 -->
      <button
        class="reader-btn reader-bilingual-btn"
        class:reader-btn-active={bilingualOn}
        class:reader-btn-busy={bilingualProgress.active}
        title={bilingualTokenUsage
          ? `双语对照 · AI Token: ${bilingualTokenUsage.totalTokens}（输入 ${bilingualTokenUsage.promptTokens} + 输出 ${bilingualTokenUsage.completionTokens}）`
          : "双语对照：在每段正文后注入译文（AI 翻译）"}
        on:click={toggleBilingual}
      >双语{bilingualProgress.active ? ` ${bilingualProgress.done}/${bilingualProgress.total}` : ""}{bilingualTokenUsage && !bilingualProgress.active ? ` · ${bilingualTokenUsage.totalTokens}T` : ""}</button>
      <button
        class="reader-btn reader-settings-btn"
        title="设置"
        class:reader-btn-active={showSettings}
        on:click={toggleSettings}
      >⚙</button>
      <button
        class="reader-btn"
        title="搜索全书（F3 / ⌘F）"
        class:reader-btn-active={showSearch}
        on:click={toggleSearch}
      >🔍</button>
    {/if}
    {#if isPdfBook()}
      <!-- [REword patch 2026-08-29] PDF 缩放工具栏（仅 PDF 显示） -->
      <span class="reader-zoom-group" title="PDF 缩放：⌘/Ctrl + 滚轮（或触控板捏合）连续缩放；⌘/Ctrl + = / - / 0 / 1 / 2 快捷档位；页面内双击切换适应宽度">
        <button
          class="reader-btn reader-zoom-btn"
          title="缩小（⌘/Ctrl + -）"
          on:click={zoomOut}
        >−</button>
        <span class="reader-zoom-label">{zoomPercentLabel()}</span>
        <button
          class="reader-btn reader-zoom-btn"
          title="放大（⌘/Ctrl + =）"
          on:click={zoomIn}
        >+</button>
        <button
          class="reader-btn reader-zoom-btn"
          title="适应宽度（⌘/Ctrl + 1）"
          on:click={fitWidth}
        >↔</button>
        <button
          class="reader-btn reader-zoom-btn"
          title="适应整页（⌘/Ctrl + 2）"
          on:click={fitPage}
        >⊡</button>
      </span>
    {/if}
  </div>

  {#if showToc}
    <div class="reader-popover reader-toc" on:wheel|stopPropagation>
      <div class="reader-popover-title">
        目录
        {#if tocItems.length}
          <span class="reader-toc-count">已读 {tocReadCount}/{tocItems.length}</span>
        {/if}
      </div>
      <div class="reader-toc-list">
        {#each tocItems as item (item.href)}
          <button
            class="reader-toc-item"
            class:reader-toc-active={item.href === activeHref}
            style="padding-left:{item.level * 12 + 4}px"
            on:click={() => goToc(item.href)}
          >
            {#if visitedHrefs.has(item.href)}
              <span class="reader-toc-check">✓</span>
            {/if}
            {item.title}
          </button>
        {:else}
          <div class="reader-toc-empty">本书没有目录</div>
        {/each}
      </div>
    </div>
  {/if}

  {#if showSearch}
    <div class="reader-popover reader-search">
      <div class="reader-search-row">
        <input
          class="reader-search-input"
          type="text"
          placeholder="搜索…（↑/↓ 切换，Enter 搜，Esc 关）"
          bind:value={searchQuery}
          bind:this={searchInput}
          on:input={onSearchInput}
          on:keydown={onSearchKeydown}
        />
        <button class="reader-mini-btn" on:click={startSearch}>搜</button>
        <button class="reader-mini-btn" on:click={closeSearch} title="关闭">✕</button>
      </div>

      <div class="reader-search-options">
        <div class="reader-search-scope">
          <button class="reader-seg reader-seg-sm" class:reader-seg-active={searchScope === "book"} on:click={() => (searchScope = "book")}>全书</button>
          <button class="reader-seg reader-seg-sm" class:reader-seg-active={searchScope === "chapter"} on:click={() => (searchScope = "chapter")}>当前章</button>
        </div>
        <label class="reader-search-opt"><input type="checkbox" bind:checked={searchCaseSensitive} on:change={startSearch} />大小写</label>
        <label class="reader-search-opt"><input type="checkbox" bind:checked={searchWholeWord} on:change={startSearch} />全字</label>
      </div>

      {#if searching}
        <div class="reader-search-status">搜索中…</div>
      {:else if searchResults.length}
        <div class="reader-search-status">
          <span class="reader-search-count">{searchIndex + 1} / {searchResults.length}</span>
          <span class="reader-search-nav">
            <button class="reader-mini-btn" on:click={() => void goSearchResult(-1)}>↑</button>
            <button class="reader-mini-btn" on:click={() => void goSearchResult(1)}>↓</button>
          </span>
        </div>
        <div class="reader-search-list">
          {#each searchResults as hit, i (hit.cfi + "-" + i)}
            <button
              class="reader-search-item"
              class:reader-search-item-active={i === searchIndex}
              on:click={() => void goSearchResultAt(i)}
            >
              <div class="reader-search-item-head">
                <span class="reader-search-item-chapter">{hit.chapterLabel || "正文"}</span>
                <span class="reader-search-item-pct">{hit.progressPercent}%</span>
              </div>
              <div class="reader-search-item-excerpt">{@html highlightExcerpt(hit.excerpt, searchQuery, searchCaseSensitive)}</div>
            </button>
          {/each}
        </div>
      {:else if searchQuery.trim()}
        <div class="reader-search-status">未找到「{searchQuery.trim()}」</div>
      {/if}
    </div>
  {/if}

  {#if showBookmarks}
    <div class="reader-popover reader-bookmarks" on:wheel|stopPropagation>
      <div class="reader-popover-title">
        书签
        {#if bookmarks.length}
          <span class="reader-toc-count">{bookmarks.length} 条</span>
        {/if}
      </div>
      <div class="reader-bm-list">
        <button class="reader-bm-add" on:click={toggleCurrentBookmark}>＋ 在当前页加书签</button>
        {#each bookmarks as bm (bm.id)}
          <div class="reader-bm-item">
            <button class="reader-bm-main" title="跳转到书签" on:click={() => jumpBookmark(bm)}>
              <span class="reader-bm-label">{bm.label || "书签"}</span>
              {#if bm.excerpt}
                <span class="reader-bm-excerpt">{bm.excerpt}</span>
              {/if}
            </button>
            <button class="reader-mini-btn" title="删除书签" on:click={() => removeBookmark(bm)}>✕</button>
          </div>
        {:else}
          <div class="reader-toc-empty">还没有书签，点上面按钮在当前页加一个</div>
        {/each}
      </div>
    </div>
  {/if}

  {#if showAnnots}
    <div class="reader-popover reader-annots" on:wheel|stopPropagation>
      <div class="reader-popover-title">
        本书摘录
        {#if annotsList.length}
          <span class="reader-toc-count">{annotsList.length} 条</span>
          <button class="reader-mini-btn" title="导出全部为 Markdown 到剪贴板" on:click={exportAnnots}>导出</button>
        {/if}
      </div>
      <div class="reader-annots-list">
        {#each annotsList as it (it.id)}
          <div class="reader-annot-item">
            <span class="reader-annot-dot" style="background:{it.color || '#06b6d4'}"></span>
            <button class="reader-annot-main" title="跳转到原文" on:click={() => jumpAnnot(it)}>
              <span class="reader-annot-text">
                {String(it.selectedText || it.sentence || "").trim() || "（无文本）"}
              </span>
              {#if String(it.note || "").trim()}
                <span class="reader-annot-note">{String(it.note || "").trim()}</span>
              {/if}
            </button>
            <button class="reader-mini-btn" title="删除这条摘录" on:click={() => removeAnnot(it)}>✕</button>
          </div>
        {:else}
          <div class="reader-toc-empty">本书还没有摘录，划选文本后点「标注」或「批注」</div>
        {/each}
      </div>
    </div>
  {/if}

  {#if showSettings}
    <div class="reader-popover reader-settings">
      <div class="reader-popover-title">阅读设置</div>

      <!-- 2026-08-25：3 大分类（文本/段落/页面布局），折叠式分组 -->
      <!-- 1. 文本设置：字号（已有）+ 字重 + 字距 -->
      <details class="reader-setting-section">
        <summary class="reader-setting-section-title">📖 文本设置</summary>
        <div class="reader-setting-row">
          <span class="reader-setting-label">字号</span>
          <div class="reader-setting-control">
            <button class="reader-mini-btn" on:click={() => changeFont(-1)}>A-</button>
            <span class="reader-setting-value">{settings.fontSize}px</span>
            <button class="reader-mini-btn" on:click={() => changeFont(1)}>A+</button>
          </div>
        </div>
        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">统一正文字号</span>
          <label class="reader-switch" title="压平书籍自带字号（如 font-size: medium），让字号 A+/A- 全局生效；关闭则保留原书字号">
            <input
              type="checkbox"
              checked={settings.overrideBookFontSize !== false}
              on:change={setOverrideBookFontSize}
            />
            <span class="reader-switch-track"></span>
          </label>
        </div>
        <div class="reader-setting-row">
          <span class="reader-setting-label">字重</span>
          <div class="reader-setting-control">
            <input
              type="range"
              min="100" max="900" step="100"
              value={settings.text.fontWeight}
              on:input={(e) => setTextWeight(+e.currentTarget.value)}
              class="reader-slider"
            />
            <span class="reader-setting-value">{settings.text.fontWeight}</span>
          </div>
        </div>
        <div class="reader-setting-row">
          <span class="reader-setting-label">字距</span>
          <div class="reader-setting-control">
            <input
              type="range"
              min="-2" max="8" step="0.5"
              value={settings.text.letterSpacing}
              on:input={(e) => setLetterSpacing(+e.currentTarget.value)}
              class="reader-slider"
            />
            <span class="reader-setting-value">{settings.text.letterSpacing}px</span>
          </div>
        </div>
      </details>

      <!-- 2. 段落设置：行距（已有）+ 段距 + 首行缩进 -->
      <details class="reader-setting-section">
        <summary class="reader-setting-section-title">📐 段落设置</summary>
        <div class="reader-setting-row">
          <span class="reader-setting-label">行距</span>
          <div class="reader-setting-control">
            {#each LINE_HEIGHT_STEPS as step}
              <button
                class="reader-seg"
                class:reader-seg-active={Math.abs(settings.lineHeight - step.value) < 0.01}
                on:click={() => setLineHeight(step.value)}
              >{step.label}</button>
            {/each}
          </div>
        </div>
        <div class="reader-setting-row">
          <span class="reader-setting-label">段距</span>
          <div class="reader-setting-control">
            <input
              type="range"
              min="0" max="2" step="0.1"
              value={settings.paragraph.paragraphSpacing}
              on:input={(e) => setParagraphSpacing(+e.currentTarget.value)}
              class="reader-slider"
            />
            <span class="reader-setting-value">{settings.paragraph.paragraphSpacing}em</span>
          </div>
        </div>
        <div class="reader-setting-row">
          <span class="reader-setting-label">首行缩进</span>
          <div class="reader-setting-control">
            <input
              type="range"
              min="0" max="4" step="0.5"
              value={settings.paragraph.textIndent}
              on:input={(e) => setTextIndent(+e.currentTarget.value)}
              class="reader-slider"
            />
            <span class="reader-setting-value">{settings.paragraph.textIndent}em</span>
          </div>
        </div>
      </details>

      <!-- 2026-08-28：4. 朗读设置（参考 Readest） -->
      <details class="reader-setting-section">
        <summary class="reader-setting-section-title">🔊 朗读设置</summary>

        <div class="reader-setting-row">
          <span class="reader-setting-label">语音引擎</span>
          <select class="reader-select" value={ttsCfg.engine} on:change={onTtsEngine}>
            <option value="system">系统语音（推荐·离线）</option>
            <option value="youdao">有道真人音</option>
            <option value="edge">Edge 神经音（云端·受限）</option>
            <option value="iflytek">讯飞语记（云端·中文更自然）</option>
            <option value="auto">自动（系统优先）</option>
          </select>
        </div>
        <p class="reader-setting-hint">
          中文朗读质量取决于本机嗓音：系统设置 → 辅助功能 → 语音 → 下载「中文（普通话）」等增强嗓音后，
          「中文嗓音」下拉即可选用，引擎会自动优选 Neural 类嗓音。Edge 云端神经音需微软服务器认证头，
          浏览器环境通常无法连通，会回退系统语音；讯飞语记改用 URL 鉴权可直连，中文质量更自然（需配置密钥）。
        </p>

        {#if ttsCfg.engine === "iflytek"}
        <div class="reader-setting-subblock">
          <div class="reader-setting-subtitle">讯飞语记配置（开放平台免费领取 AppID / APIKey / APISecret）</div>
          <div class="reader-setting-row">
            <span class="reader-setting-label">AppID</span>
            <input class="reader-input" type="text" placeholder="如 12345678" value={ttsCfg.iflytekAppId || ""} on:input={onTtsIflytekAppId} />
          </div>
          <div class="reader-setting-row">
            <span class="reader-setting-label">APIKey</span>
            <input class="reader-input" type="text" placeholder="APIKey" value={ttsCfg.iflytekApiKey || ""} on:input={onTtsIflytekApiKey} />
          </div>
          <div class="reader-setting-row">
            <span class="reader-setting-label">APISecret</span>
            <input class="reader-input" type="password" placeholder="APISecret" value={ttsCfg.iflytekApiSecret || ""} on:input={onTtsIflytekApiSecret} />
          </div>
          <div class="reader-setting-row">
            <span class="reader-setting-label">中文发音人</span>
            <select class="reader-select" value={ttsCfg.iflytekVoice || "xiaoyan"} on:change={onTtsIflytekVoice}>
              <option value="xiaoyan">讯飞小燕（默认）</option>
              <option value="x4_lingfeizhe_assist">灵泽（中文·增强）</option>
              <option value="x4_lingfeichen_assist">灵辰（中文·增强）</option>
              <option value="x4_lingxiaoqi_assist">小琪（中文·增强）</option>
              <option value="xiaoyu">讯飞小鱼（女声）</option>
              <option value="aisjiuxu">讯飞许久（男声）</option>
            </select>
          </div>
          <p class="reader-setting-hint">英文句自动使用讯飞英文神经音（Gavin）。密钥保存在本插件本地配置，仅用于调用讯飞服务。</p>
        </div>
        {/if}

        <div class="reader-setting-row">
          <span class="reader-setting-label">语速</span>
          <div class="reader-setting-control">
            <input type="range" min="0.5" max="3" step="0.1" value={ttsCfg.rate} on:input={onTtsRateSetting} class="reader-slider" />
            <span class="reader-setting-value">{ttsCfg.rate.toFixed(1)}×</span>
          </div>
        </div>

        <div class="reader-setting-row">
          <span class="reader-setting-label">音高</span>
          <div class="reader-setting-control">
            <input type="range" min="0.5" max="2" step="0.1" value={ttsCfg.pitch} on:input={onTtsPitch} class="reader-slider" />
            <span class="reader-setting-value">{ttsCfg.pitch.toFixed(1)}</span>
          </div>
        </div>

        <div class="reader-setting-row">
          <span class="reader-setting-label">音量</span>
          <div class="reader-setting-control">
            <input type="range" min="0" max="1" step="0.05" value={ttsCfg.volume} on:input={onTtsVolume} class="reader-slider" />
            <span class="reader-setting-value">{Math.round(ttsCfg.volume * 100)}%</span>
          </div>
        </div>

        <div class="reader-setting-row">
          <span class="reader-setting-label">口音</span>
          <select class="reader-select" value={ttsCfg.accent} on:change={onTtsAccent}>
            <option value="us">美音</option>
            <option value="uk">英音</option>
          </select>
        </div>

        <div class="reader-setting-row">
          <span class="reader-setting-label">中文嗓音</span>
          <select class="reader-select" value={ttsCfg.preferVoiceURIZh || ""} on:change={onTtsVoiceZh}>
            <option value="">自动（系统中文嗓音）</option>
            {#each ttsVoices.filter((v) => v.lang.toLowerCase().startsWith("zh")) as v (v.uri)}
              <option value={v.uri}>{v.name} ({v.lang})</option>
            {/each}
          </select>
        </div>

        <div class="reader-setting-row">
          <span class="reader-setting-label">英文嗓音</span>
          <select class="reader-select" value={ttsCfg.preferVoiceURIEn || ""} on:change={onTtsVoiceEn}>
            <option value="">自动（系统英文嗓音）</option>
            {#each ttsVoices.filter((v) => v.lang.toLowerCase().startsWith("en")) as v (v.uri)}
              <option value={v.uri}>{v.name} ({v.lang})</option>
            {/each}
          </select>
        </div>

        <div class="reader-setting-row">
          <span class="reader-setting-label">朗读粒度</span>
          <select class="reader-select" value={ttsCfg.granularity} on:change={onTtsGranularity}>
            <option value="sentence">整句</option>
            <option value="word">逐词</option>
          </select>
        </div>

        <div class="reader-setting-row">
          <span class="reader-setting-label">朗读范围</span>
          <select class="reader-select" value={ttsCfg.scope} on:change={onTtsScope}>
            <option value="selection">仅选区</option>
            <option value="section">本节</option>
            <option value="book">全书</option>
          </select>
        </div>

        <div class="reader-setting-row">
          <span class="reader-setting-label">句间停顿</span>
          <div class="reader-setting-control">
            <input type="range" min="0" max="2000" step="50" value={ttsCfg.interval} on:input={onTtsInterval} class="reader-slider" />
            <span class="reader-setting-value">{ttsCfg.interval}ms</span>
          </div>
        </div>

        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">句子高亮</span>
          <label class="reader-switch" title="朗读时高亮当前句（临时，停止即清除，不污染标注）">
            <input type="checkbox" checked={ttsCfg.enableHighlight} on:change={onTtsHighlightEnabled} />
            <span class="reader-switch-track"></span>
          </label>
        </div>

        <div class="reader-setting-row">
          <span class="reader-setting-label">高亮样式</span>
          <select class="reader-select" value={ttsCfg.highlightStyle} on:change={onTtsHighlightStyle}>
            <option value="background">底色</option>
            <option value="underline">下划线</option>
            <option value="wave">波浪线</option>
            <option value="outline">描边</option>
          </select>
        </div>

        <div class="reader-setting-row">
          <span class="reader-setting-label">高亮颜色</span>
          <input type="color" value={ttsCfg.highlightColor} on:input={onTtsHighlightColor} class="reader-color" />
        </div>

        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">自动翻页</span>
          <label class="reader-switch" title="读完当前节自动翻到下一节续读">
            <input type="checkbox" checked={ttsCfg.autoPage} on:change={onTtsAutoPage} />
            <span class="reader-switch-track"></span>
          </label>
        </div>

        <div class="reader-setting-row">
          <span class="reader-setting-label">睡眠定时</span>
          <select class="reader-select" value={ttsCfg.sleepTimerMin} on:change={onTtsSleep}>
            <option value="0">关闭</option>
            <option value="15">15 分钟</option>
            <option value="30">30 分钟</option>
            <option value="45">45 分钟</option>
            <option value="60">60 分钟</option>
            <option value="90">90 分钟</option>
          </select>
        </div>
      </details>

      <!-- 3. 页面布局：4 边距 + 分栏间距 + 3 开关 + 进度样式 + 参考页数 + 时间 + 24h -->
      <details class="reader-setting-section">
        <summary class="reader-setting-section-title">⬜ 页面布局</summary>
        <div class="reader-setting-grid-2col">
          <div class="reader-setting-row">
            <span class="reader-setting-label">上边距</span>
            <input type="range" min="0" max="100" step="2"
              value={settings.layout.marginTopPx}
              on:input={(e) => setMarginPx("marginTopPx", +e.currentTarget.value)}
              class="reader-slider" />
            <span class="reader-setting-value">{settings.layout.marginTopPx}px</span>
          </div>
          <div class="reader-setting-row">
            <span class="reader-setting-label">下边距</span>
            <input type="range" min="0" max="100" step="2"
              value={settings.layout.marginBottomPx}
              on:input={(e) => setMarginPx("marginBottomPx", +e.currentTarget.value)}
              class="reader-slider" />
            <span class="reader-setting-value">{settings.layout.marginBottomPx}px</span>
          </div>
          <div class="reader-setting-row">
            <span class="reader-setting-label">左边距</span>
            <input type="range" min="0" max="100" step="2"
              value={settings.layout.marginLeftPx}
              on:input={(e) => setMarginPx("marginLeftPx", +e.currentTarget.value)}
              class="reader-slider" />
            <span class="reader-setting-value">{settings.layout.marginLeftPx}px</span>
          </div>
          <div class="reader-setting-row">
            <span class="reader-setting-label">右边距</span>
            <input type="range" min="0" max="100" step="2"
              value={settings.layout.marginRightPx}
              on:input={(e) => setMarginPx("marginRightPx", +e.currentTarget.value)}
              class="reader-slider" />
            <span class="reader-setting-value">{settings.layout.marginRightPx}px</span>
          </div>
        </div>
        <div class="reader-setting-row">
          <span class="reader-setting-label">分栏间距</span>
          <div class="reader-setting-control">
            <input type="range" min="0" max="40" step="2"
              value={settings.layout.columnGapPx}
              on:input={(e) => setColumnGapPx(+e.currentTarget.value)}
              class="reader-slider" />
            <span class="reader-setting-value">{settings.layout.columnGapPx}px</span>
          </div>
        </div>
        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">跟随思源文档边距</span>
          <label class="reader-switch"><input type="checkbox" checked={settings.layout.followSiyuanMargin} on:change={setFollowSiyuanMargin} /><span class="reader-switch-track"></span></label>
        </div>
        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">显示页眉</span>
          <label class="reader-switch"><input type="checkbox" checked={settings.layout.showHeader} on:change={setShowHeader} /><span class="reader-switch-track"></span></label>
        </div>
        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">显示页脚</span>
          <label class="reader-switch"><input type="checkbox" checked={settings.layout.showFooter} on:change={setShowFooter} /><span class="reader-switch-track"></span></label>
        </div>
        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">显示阅读进度</span>
          <label class="reader-switch"><input type="checkbox" checked={settings.layout.showProgress} on:change={setShowProgress} /><span class="reader-switch-track"></span></label>
        </div>
        <div class="reader-setting-row">
          <span class="reader-setting-label">进度样式</span>
          <div class="reader-setting-control">
            {#each Object.entries(PROGRESS_STYLE_PRESETS) as [key, preset]}
              <button class="reader-seg" class:reader-seg-active={settings.layout.progressStyle === key}
                on:click={() => setProgressStyle(key)}>{preset.label}</button>
            {/each}
          </div>
        </div>
        <div class="reader-setting-row">
          <span class="reader-setting-label">参考页数</span>
          <div class="reader-setting-control">
            <input type="range" min="0" max="2000" step="10"
              value={settings.layout.referencePageCount}
              on:input={(e) => setReferencePageCount(+e.currentTarget.value)}
              class="reader-slider" />
            <span class="reader-setting-value">{settings.layout.referencePageCount || "不显示"}</span>
          </div>
        </div>
        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">显示当前时间</span>
          <label class="reader-switch"><input type="checkbox" checked={settings.layout.showCurrentTime} on:change={setShowCurrentTime} /><span class="reader-switch-track"></span></label>
        </div>
        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">使用 24 小时制</span>
          <label class="reader-switch"><input type="checkbox" checked={settings.layout.use24Hour} on:change={setUse24Hour} /><span class="reader-switch-track"></span></label>
        </div>
      </details>

      <!-- 笔记插入功能已移除（2026-08-25） -->

      <!-- 已有：主题/字体/行宽/模式/动画/点击翻页 — 2026-08-25 紧凑化：移入「高级设置」二级折叠
           主面板（4 大分组）保持一屏可览，次要项折叠。 -->
      <details class="reader-setting-section">
        <summary class="reader-setting-section-title">⚙ 高级设置</summary>

        <!-- 主题 -->
        <div class="reader-setting-row">
          <span class="reader-setting-label">主题</span>
          <div class="reader-theme-grid">
            {#each Object.entries(THEME_PRESETS) as [key, preset]}
              <button
                class="reader-theme-swatch"
                class:reader-seg-active={settings.theme === key}
                title={preset.label}
                on:click={() => onSetTheme(key)}
              >
                <span class="reader-swatch-dot" style={swatchStyle(preset.bg)}></span>
                <span class="reader-swatch-label">{preset.label}</span>
              </button>
            {/each}
          </div>
        </div>

        {#if settings.theme === "custom"}
          <div class="reader-setting-row">
            <span class="reader-setting-label">文字色</span>
            <input
              type="color"
              value={settings.customFg || "#222222"}
              on:change={(e) => onCustomColor("customFg", e)}
            />
            <span class="reader-setting-label">背景色</span>
            <input
              type="color"
              value={settings.customBg || "#ffffff"}
              on:change={(e) => onCustomColor("customBg", e)}
            />
          </div>
          <div class="reader-setting-row reader-setting-col">
            <span class="reader-setting-label">背景图（URL）</span>
            <input
              class="reader-text-input"
              type="text"
              placeholder="https://… 或 data:image/… 图片地址，留空则只用背景色"
              value={settings.customBgImage || ""}
              on:input={(e) => onCustomBgImage(e)}
            />
            {#if settings.customBgImage}
              <button class="reader-text-clear" title="清除背景图" on:click={clearCustomBgImage}>清除</button>
            {/if}
          </div>
        {/if}

        <!-- 字体 -->
        <div class="reader-setting-row">
          <span class="reader-setting-label">字体</span>
          <div class="reader-setting-control">
            {#each Object.entries(FONT_MODE_PRESETS) as [key, preset]}
              <button
                class="reader-seg"
                class:reader-seg-active={settings.fontMode === key}
                title={preset.hint}
                on:click={() => pickFontMode(key)}
              >{preset.label}</button>
            {/each}
          </div>
        </div>

        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">覆盖书籍字体</span>
          <label class="reader-switch" title="强制正文使用阅读器字体（霞鹜文楷），覆盖书籍自带字体；关闭则保留原书排版">
            <input
              type="checkbox"
              checked={!!settings.overridePublisherFont}
              on:change={setOverridePublisherFont}
            />
            <span class="reader-switch-track"></span>
          </label>
        </div>

        {#if settings.fontMode === "classified"}
          <div class="reader-setting-row">
            <span class="reader-setting-label">默认字体</span>
            <div class="reader-setting-control">
              {#each Object.entries(DEFAULT_FONT_FAMILY_PRESETS) as [key, preset]}
                <button
                  class="reader-seg"
                  class:reader-seg-active={(settings.defaultFontFamily || "serif") === key}
                  title={preset.hint}
                  on:click={() => setDefaultFontFamily(key)}
                >{preset.label}</button>
              {/each}
            </div>
          </div>

          <div class="reader-setting-row reader-setting-row-stack">
            <span class="reader-setting-label">衬线字体</span>
            <select
              class="reader-font-select"
              value={settings.serifFont || ""}
              on:change={(e) => setFontFace("serifFont", e.currentTarget.value)}
            >
              <option value="">未指定（用候选池顺序）</option>
              {#each SERIF_FONT_PRESETS as f}
                <option value={f}>{f}</option>
              {/each}
            </select>
          </div>

          <div class="reader-setting-row reader-setting-row-stack">
            <span class="reader-setting-label">无衬线字体</span>
            <select
              class="reader-font-select"
              value={settings.sansSerifFont || ""}
              on:change={(e) => setFontFace("sansSerifFont", e.currentTarget.value)}
            >
              <option value="">未指定（用候选池顺序）</option>
              {#each SANS_SERIF_FONT_PRESETS as f}
                <option value={f}>{f}</option>
              {/each}
            </select>
          </div>

          <div class="reader-setting-row reader-setting-row-stack">
            <span class="reader-setting-label">等宽字体</span>
            <select
              class="reader-font-select"
              title="代码块 / <pre> / <code> 专用；正文绝不用等宽"
              value={settings.monospaceFont || ""}
              on:change={(e) => setFontFace("monospaceFont", e.currentTarget.value)}
            >
              <option value="">未指定（用候选池顺序）</option>
              {#each MONOSPACE_FONT_PRESETS as f}
                <option value={f}>{f}</option>
              {/each}
            </select>
          </div>

          <div class="reader-setting-row reader-setting-row-stack">
            <span class="reader-setting-label">中文字体</span>
            <select
              class="reader-font-select"
              title="插入每条链的次位；留空则只用跨平台 CJK 兜底栈"
              value={settings.defaultCJKFont || ""}
              on:change={(e) => setFontFace("defaultCJKFont", e.currentTarget.value)}
            >
              <option value="">留空（跨平台兜底）</option>
              {#each CJK_FONT_PRESETS as f}
                <option value={f}>{f}</option>
              {/each}
            </select>
          </div>

          <div class="reader-font-hint">
            三条链各自带跨平台 CJK 兜底，未安装的字体会自动跳过。代码类元素固定走等宽链。
          </div>
        {/if}

        {#if settings.fontMode === "custom"}
          <div class="reader-font-list">
            {#each customFonts as f}
              <div
                class="reader-font-item"
                class:reader-font-item-active={settings.customFontId === f.id}
              >
                <button class="reader-font-pick" title="使用此字体" on:click={() => pickCustomFont(f.id)}>
                  <span class="reader-font-name">{f.name}</span>
                  <span class="reader-font-size">{fmtFontSize(f.size)}</span>
                </button>
                <button class="reader-font-del" title="删除此字体" on:click={() => delFont(f.id)}>✕</button>
              </div>
            {:else}
              <div class="reader-font-empty">还没有自定义字体，点击下方导入</div>
            {/each}
            <button class="reader-font-import" disabled={fontImporting} on:click={() => fontInput?.click()}>
              {fontImporting ? "导入中…" : "+ 导入字体（ttf/otf/woff/woff2）"}
            </button>
            <input
              bind:this={fontInput}
              type="file"
              accept={FONT_ACCEPT}
              style="display:none"
              on:change={onFontImport}
            />
          </div>
        {/if}

        <!-- 页面边距三档预设（铺满 / 正常 / 宽松）+ 自定义 -->
        <div class="reader-setting-row">
          <span class="reader-setting-label">页面边距</span>
          <div class="reader-setting-control">
            {#each Object.entries(LAYOUT_PRESETS) as [key, preset]}
              <button
                class="reader-seg"
                class:reader-seg-active={detectLayoutPreset(settings.layout) === key}
                on:click={() => onSetLayoutPreset(key)}
              >{preset.label}</button>
            {/each}
          </div>
        </div>

        <!-- 模式 -->
        <div class="reader-setting-row">
          <span class="reader-setting-label">模式</span>
          <div class="reader-setting-control">
            {#each Object.entries(FLOW_PRESETS) as [key, preset]}
              <button
                class="reader-seg"
                class:reader-seg-active={settings.flow === key}
                on:click={() => onSetFlow(key)}
              >{preset.label}</button>
            {/each}
          </div>
        </div>

        <!-- 动画 -->
        <div class="reader-setting-row">
          <span class="reader-setting-label">动画</span>
          <div class="reader-setting-control">
            {#each Object.entries(TURN_STYLE_PRESETS) as [key, preset]}
              <button
                class="reader-seg"
                class:reader-seg-active={settings.turnStyle === key}
                on:click={() => onSetTurnStyle(key)}
              >{preset.label}</button>
            {/each}
          </div>
        </div>

        <!-- 点击翻页 -->
        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">点击翻页</span>
          <label class="reader-switch" title="点击页面左右三分之一区域翻页（默认关闭，防误触）">
            <input
              type="checkbox"
              checked={!!settings.clickToTurn}
              on:change={setClickToTurn}
            />
            <span class="reader-switch-track"></span>
          </label>
        </div>

        <!-- 专注模式（P2.2）：滚动时高亮中心段落、其余淡出，仅滚动模式生效 -->
        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">专注模式</span>
          <label class="reader-switch" title="滚动时高亮当前阅读段落、其余淡出，减少干扰（仅「滚动」模式下生效）">
            <input
              type="checkbox"
              checked={!!settings.focusMode}
              on:change={setFocusMode}
            />
            <span class="reader-switch-track"></span>
          </label>
        </div>
      </details>

      <!-- 2026-08-29：PDF 显示设置（视图模式 / 滚动方向 / 反色），仅 PDF 书显示 -->
      {#if isPdfBook()}
      <details class="reader-setting-section">
        <summary class="reader-setting-section-title">📄 PDF 显示</summary>

        <!-- 视图模式：单页 / 双页 / 书籍（映射 foliate spread） -->
        <div class="reader-setting-row">
          <span class="reader-setting-label">视图模式</span>
          <div class="reader-setting-control">
            {#each [["single", "单页"], ["double", "双页"], ["book", "书籍"]] as [key, label]}
              <button
                class="reader-seg"
                class:reader-seg-active={(settings.pdfViewMode ?? "single") === key}
                on:click={() => onSetPdfViewMode(key)}
              >{label}</button>
            {/each}
          </div>
        </div>

        <!-- 滚动方向：仅「滚动」模式生效（映射 foliate scroll-direction） -->
        {#if settings.flow === "scrolled"}
        <div class="reader-setting-row">
          <span class="reader-setting-label">滚动方向</span>
          <div class="reader-setting-control">
            {#each [["vertical", "垂直"], ["horizontal", "水平"]] as [key, label]}
              <button
                class="reader-seg"
                class:reader-seg-active={(settings.pdfScrollDir ?? "vertical") === key}
                on:click={() => onSetPdfScrollDir(key)}
              >{label}</button>
            {/each}
          </div>
        </div>
        {/if}

        <!-- 反色 / 暗色：PDF 画布级 pageColors 反色，独立于阅读器通用主题 -->
        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">反色 / 暗色</span>
          <label class="reader-switch" title="PDF 画布级反色（黑底白字），独立于阅读器主题">
            <input
              type="checkbox"
              checked={!!settings.pdfInvert}
              on:change={setPdfInvert}
            />
            <span class="reader-switch-track"></span>
          </label>
        </div>
      </details>
      {/if}

      <!-- 2026-08-28：双语对照增强（译文字号独立调节 + 段落悬停高亮） -->
      <details class="reader-setting-section">
        <summary class="reader-setting-section-title">🌐 双语对照</summary>

        <!-- 译文字号（em 倍数，相对正文；默认 0.78） -->
        <div class="reader-setting-row">
          <span class="reader-setting-label">译文字号</span>
          <div class="reader-setting-control">
            <button class="reader-mini-btn" on:click={() => setTranslationFontSize((settings.translationFontSize ?? 0.62) - 0.02)}>A-</button>
            <span class="reader-setting-value">{Math.round((settings.translationFontSize ?? 0.62) * 100)}%</span>
            <button class="reader-mini-btn" on:click={() => setTranslationFontSize((settings.translationFontSize ?? 0.62) + 0.02)}>A+</button>
          </div>
        </div>

        <!-- 段落悬停高亮（C2） -->
        <div class="reader-setting-row reader-setting-toggle-row">
          <span class="reader-setting-label">段落悬停高亮</span>
          <label class="reader-switch" title="鼠标悬停段落时轻微底色，提升阅读定位感">
            <input
              type="checkbox"
              checked={settings.paragraphHover !== false}
              on:change={setParagraphHover}
            />
            <span class="reader-switch-track"></span>
          </label>
        </div>

        <!-- 2026-08-28 新增：翻译预取页数（眼前屏 + 后续 N 面） -->
        <div class="reader-setting-row">
          <span class="reader-setting-label" title="当前屏之后额外预译并缓存的页数（默认 2 面）。页数越多翻页越无需等待，但首次翻译越费 token">翻译预取页数</span>
          <div class="reader-setting-control">
            <button class="reader-mini-btn" on:click={() => setBilingualPrefetchPages((settings.bilingualPrefetchPages ?? 2) - 1)}>-</button>
            <span class="reader-setting-value">{(settings.bilingualPrefetchPages ?? 2)} 面</span>
            <button class="reader-mini-btn" on:click={() => setBilingualPrefetchPages((settings.bilingualPrefetchPages ?? 2) + 1)}>+</button>
          </div>
        </div>
        <div class="reader-setting-tip reader-setting-tip-warn">⚠️ 不要填太多：页数越多，首次翻译消耗的 AI Token 越多、也越慢。日常阅读 1–3 面足够。</div>

        <!-- v1.3.0 本书上下文：手写背景/人物/译法，注入 AI 翻译 prompt（解决专有名词前后不一致） -->
        {#if primerStore}
          <div class="reader-setting-row reader-setting-toggle-row">
            <span class="reader-setting-label" title="为本书手写背景/人物/译法对照，AI 翻译时自动参考（如 Sludge=斯拉奇）">本书上下文</span>
            <button class="reader-mini-btn" on:click={togglePrimerEditor}>
              {primerOpen ? "收起" : (primerChars > 0 ? `${primerChars} 字` : "编辑")}
            </button>
          </div>
          {#if primerOpen}
            <div class="reader-primer-box">
              <div class="reader-primer-tip">仅对《{meta?.title || "本书"}》生效 · 支持思源排版（列表/加粗/表格）</div>
              <div class="reader-primer-editor" bind:this={primerEditorEl}></div>
              <div class="reader-primer-foot">
                <span class="reader-primer-stats" class:reader-primer-warn={primerChars > PRIMER_WARN_CHARS}>
                  {primerChars} 字 ≈ {primerTokens}T{primerChars > PRIMER_WARN_CHARS ? " · 过长费token" : " · 建议200~800字"}
                </span>
                <button class="reader-mini-btn" title="清除本书上下文" on:click={clearPrimer}>清除</button>
              </div>
            </div>
          {/if}

          <!-- 本书累计 Token + 生词本导出 -->
          <div class="reader-setting-row reader-setting-toggle-row">
            <span class="reader-setting-label" title="本书双语翻译累计消耗的 AI Token（跨批次累加）">本书 Token</span>
            <div class="reader-setting-control">
              <span class="reader-setting-value">{fmtTok(bookTokenTotal)}</span>
              <button class="reader-mini-btn" title="重置本书累计" on:click={onResetBookTokens}>↺</button>
            </div>
          </div>
          <div class="reader-setting-row reader-setting-toggle-row">
            <span class="reader-setting-label" title="把已显示的双语对照导出为 Markdown 表格（复制到剪贴板，可粘贴进思源笔记）">生词本导出</span>
            <button class="reader-mini-btn" on:click={exportBilingualNotes}>📋 复制</button>
          </div>
        {/if}

        <!-- 2026-08-28 翻译缓存：按书落盘，重开书/翻页不消失；支持「选择书籍」+ 按页统计 -->
        <div class="reader-cache-block">
          <div class="reader-setting-row">
            <span class="reader-setting-label" title="已翻译的段落释义保存在本地（按书），重开本书或翻页后命中缓存秒出，不重复消耗 token">翻译缓存</span>
            {#if cacheBookList.length > 1}
              <div class="reader-setting-control">
                <select
                  class="reader-select"
                  value={selectedCacheBookId}
                  on:change={onSelectCacheBook}
                  title="选择要查看缓存的书籍"
                >
                  {#each cacheBookList as b}
                    <option value={b.bookId}>{b.title || b.bookId}</option>
                  {/each}
                </select>
              </div>
            {/if}
          </div>
          <!-- 明确书名：当前查看书籍（默认本书，可在下拉切换） -->
          <div class="reader-cache-book" title="当前查看缓存的书籍">
            📖 《{selectedCacheBookId === bookId ? (meta?.title || title || "本书") : (cacheBookList.find((b) => b.bookId === selectedCacheBookId)?.title || "所选书籍")}》
          </div>
          <div class="reader-setting-row reader-setting-toggle-row">
            <span class="reader-setting-label">已缓存</span>
            <div class="reader-setting-control">
              <span class="reader-setting-value">共 {bilingualCacheCount} 段 · {bilingualCachedPages} 页</span>
              <button
                class="reader-mini-btn"
                title="清空所选书籍翻译缓存（之后翻页会重新翻译）"
                on:click={onClearBilingualCache}
                disabled={clearingCache || bilingualCacheCount === 0}
              >清空</button>
            </div>
          </div>
          <div class="reader-setting-tip">
            共缓存 {bilingualCachedPages} 页，{bilingualPageRange} 缓存成功。已翻译释义保存在本地，重开书籍与翻页都不会消失；换书互不影响。
          </div>
        </div>
      </details>
    </div>
  {/if}

  <div class="reader-stage" bind:this={readerStageEl}>
    <div class="reader-container" bind:this={container}></div>
    <!-- [REword patch 2026-08-29] Phase 3 Apple Pencil 墨迹批注 SVG 渲染层 -->
    {#if opened && isPdfBook()}
      <InkLayer pageWidth={800} pageHeight={1200} />
    {/if}
    <!-- [REword patch 2026-08-29] Phase 3 墨迹工具栏（浮动在 PDF 上） -->
    {#if opened && isPdfBook()}
      <InkToolbar />
    {/if}
    {#if opened && !errorMsg}
      <div class="reader-side-tap" aria-hidden="false">
        <button
          class="reader-side-arrow reader-side-left reader-ui-transition"
          title="上一页（←/PageUp）"
          aria-label="上一页"
          on:pointerdown={() => arrowDown("prev")}
          on:pointerup={stopArrowRepeat}
          on:pointerleave={stopArrowRepeat}
          on:pointercancel={stopArrowRepeat}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button
          class="reader-side-arrow reader-side-right reader-ui-transition"
          title="下一页（→/PageDown/空格）"
          aria-label="下一页"
          on:pointerdown={() => arrowDown("next")}
          on:pointerup={stopArrowRepeat}
          on:pointerleave={stopArrowRepeat}
          on:pointercancel={stopArrowRepeat}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
    {/if}
  </div>

  <!-- 2026-08-26 调试 HUD：foliate 原生标注管线诊断（DEBUG_READER=true 时显示） -->
  {#if DEBUG_READER}
  <div class="reader-debug-hud">
    <div class="reader-debug-hud-title">🔍 REword 高亮诊断（foliate 原生）</div>
    <div class="reader-debug-hud-row"><b>setup:</b> {dbgHud.setupCalled} <b>annStore:</b> {dbgHud.annStoreReady} <b>bookId:</b> {dbgHud.bookIdAtSetup}</div>
    <div class="reader-debug-hud-row"><b>storeAnnots:</b> {dbgHud.annotCountInStore} <b>totalInStore:</b> {dbgHud.totalInStore} <b>bookIdMatch:</b> {dbgHud.bookIdMatch}</div>
    <div class="reader-debug-hud-row"><b>createOverlay:</b> {dbgHud.createOverlayCalls} <b>relocate:</b> {dbgHud.relocateCalls} <b>evtIdx:</b> {dbgHud.ovr_evtIndex}</div>
    <div class="reader-debug-hud-row"><b>addAnnotation 调用:</b> {dbgHud.addAnnotationTries} <b>失败:</b> {dbgHud.addAnnotationErrors} <b>绘制:</b> {dbgHud.drawnCount}</div>
    <div class="reader-debug-hud-row"><b>lastDraw:</b> {dbgHud.lastDraw}</div>
  </div>
  {/if}

  <!-- 底部控制栏：目录/翻页/进度条/搜索。独立在 .reader-stage 之外（2026-08-25 修复：
       此前误置于 stage 内，被 position:absolute 的 .reader-container 遮挡 + overflow:hidden 裁切导致不可见）。 -->
  <div class="reader-bottom-bar" class:chrome-hidden={chromeHidden}>
    <button class="reader-btn" title="目录" class:reader-btn-active={showToc} on:click={toggleToc}>☰</button>
    <button class="reader-btn" title="第一页（Home）" on:click={goFirstPage}>⏮</button>
    <button class="reader-btn" title="上一页" on:click={turnPrev}>◀</button>
    <div class="reader-progress-wrap">
      {#if chapterMarks.length}
        {#each chapterMarks as m (m.left)}
          <span
            class="reader-chapter-tick"
            style="left:{m.left}%"
            title={m.title}
          ></span>
        {/each}
      {/if}
      <input
        class="reader-progress-bar"
        type="range"
        min="0"
        max="1000"
        value={Math.round(progress * 1000)}
        style="--progress: {progress * 100}%"
        on:input={onProgressInput}
        on:change={onProgressChange}
      />
    </div>
    <span class="reader-progress-text">{progressText}</span>
    {#if etaText}
      <span class="reader-eta" title="按当前阅读速度估算">{etaText}</span>
    {/if}
    <button class="reader-btn" title="下一页" on:click={turnNext}>▶</button>
    <button class="reader-btn" title="最后一页（End）" on:click={goLastPage}>⏭</button>
    <!-- 2026-08-29 新增：书签 / 摘录汇总（对齐 Obsidian weave 的沉淀链） -->
    <button
      class="reader-btn"
      title={bookmarks.length ? `书签（${bookmarks.length}）` : "书签"}
      class:reader-btn-active={showBookmarks}
      on:click={toggleBookmarkDrawer}
    >🔖</button>
    <button
      class="reader-btn"
      title="本书摘录汇总"
      class:reader-btn-active={showAnnots}
      on:click={toggleAnnots}
    >📑</button>
  </div>

  <!-- 2026-08-28：连续朗读控制条（参考 Readest 朗读体验） -->
  {#if showTtsBar}
  <div class="reader-tts-bar">
    <button class="reader-btn reader-tts-btn" title="上一句" on:click={ttsPrev}>⏮</button>
    <button class="reader-btn reader-tts-btn reader-tts-play" title="播放/暂停（Space）" on:click={ttsTogglePlay}>
      {ttsState === "playing" ? "⏸" : "▶"}
    </button>
    <button class="reader-btn reader-tts-btn" title="下一句" on:click={ttsNext}>⏭</button>
    <button class="reader-btn reader-tts-btn" title="停止" on:click={ttsStop}>⏹</button>
    <div class="reader-tts-meta">
      <span class="reader-tts-progress">{ttsProgress.total ? ttsProgress.index + 1 : 0}/{ttsProgress.total}</span>
      <span class="reader-tts-current" title={ttsCurrentText}>{ttsCurrentText}</span>
    </div>
    <div class="reader-tts-rate">
      <span class="reader-tts-rate-label">语速</span>
      <input type="range" min="0.5" max="3" step="0.1" value={ttsRate} on:input={onTtsRateInput} />
      <span class="reader-tts-rate-val">{ttsRate.toFixed(1)}×</span>
    </div>
    <button class="reader-btn reader-tts-btn" class:reader-btn-active={ttsHighlightOn} title="句子高亮跟随" on:click={ttsToggleHighlight}>高亮</button>
    <button class="reader-btn reader-tts-btn" title="收藏本句生词到生词本" on:click={ttsCollectWords}>收词</button>
  </div>
  {/if}

  {#if errorMsg}
    <div class="reader-error">打开失败：{errorMsg}</div>
  {/if}

  {#if showToc || showSettings || showSearch}
    <div class="reader-backdrop" on:click={closeAllPopovers} aria-hidden="true"></div>
  {/if}

  <!-- 2026-08-23 修复：所有浮层（划词/词典/批注/toast）统一放入 .reader-floating-layer
       容器内，避免 position:fixed 覆盖整个视口拦截思源顶栏"管理"等原生 UI 点击。
       容器 pointer-events:none 默认不拦截事件，子元素显式 pointer-events:auto 启用交互。 -->
  <div class="reader-floating-layer" aria-hidden="true">
  <!-- 划词悬浮工具栏（Readest 风格深色胶囊）
       create 态：选中正文 → 主工具栏（复制/高亮/批注/词典/翻译/朗读/发送）；点「高亮」→ 上方展开样式条（3 样式 + 5 色）→ 选样式即一步高亮。
       edit 态（点已有高亮）：主工具栏第 2 按钮变「删除」，下方常显样式条，点样式/颜色即时改该标注。 -->
  {#if selToolbar.visible}
    <div class="reader-sel-toolbar" bind:this={selToolbarEl} class:place-below={selToolbar.place==='below'} class:place-left={selToolbar.place==='left'} class:place-right={selToolbar.place==='right'} style="left:{selToolbar.x}px;top:{selToolbar.y}px">
      <!-- 第二层样式条：始终浮在工具栏上方（readest 风格）。
           create 态需点「高亮」才展开(stripVisible)；edit 态常显（点击已有高亮即出现，无需再点任何按钮）。 -->
      {#if selToolbar.mode === "edit" || selToolbar.stripVisible}
        <div class="reader-sel-strip">
          <div class="reader-style-row">
            {#each ANNOTATION_PANEL_STYLES as s}
              <button
                class="reader-style-btn"
                class:active={(selToolbar.mode === "edit" ? selToolbar.annStyle : lastStyle) === s}
                title={ANNOTATION_STYLES[s].label}
                on:click={() => selToolbar.mode === "edit" ? applyEditStyle(s) : onSelCreate(s, lastColor)}>
                <span class="reader-style-glyph style-{s}" style="--sc:{selToolbar.mode === 'edit' ? (selToolbar.annColor || lastColor) : lastColor}">{ANNOTATION_STYLES[s].icon}</span>
              </button>
            {/each}
          </div>
          <div class="reader-color-row">
            {#each WHALE_COLORS as c}
              <button
                class="reader-color-dot"
                class:active={(selToolbar.mode === 'edit' ? (selToolbar.annColor || lastColor) : lastColor) === c.value}
                style="background:{c.value}"
                title={c.name}
                on:click={() => selToolbar.mode === "edit" ? applyEditColor(c.value) : onSelCreate(lastStyle, c.value)}></button>
            {/each}
          </div>
        </div>
      {/if}
      <!-- 主工具栏：图标 + 文字，始终显示 -->
      <div class="reader-sel-main">
        {#if selToolbar.mode === "edit"}
          {#if selToolbar.ghostCfi}
            <!-- 2026-08-24 死锁解除：数据已无活跃记录但视觉残留时，只给「清除残留高亮」入口 -->
            <button class="reader-sel-item reader-sel-item-danger" title="清除残留高亮" on:click={onClearGhostHighlight}>
              <span class="reader-sel-ico">{@html SEL_ICONS.trash}</span><span class="reader-sel-txt">清除残留</span>
            </button>
          {:else}
          <!-- 2026-08-26 标注 edit 模式：删除按钮替代「高亮」位置（最前），其余功能保留 -->
          <button class="reader-sel-item reader-sel-item-danger" title="删除划线" on:click={onAnnDeleteById}>
            <span class="reader-sel-ico">{@html SEL_ICONS.trash}</span><span class="reader-sel-txt">删除</span>
          </button>
          <button class="reader-sel-item" title="复制" on:click={onSelCopy}>
            <span class="reader-sel-ico">{@html SEL_ICONS.copy}</span><span class="reader-sel-txt">复制</span>
          </button>
          <button class="reader-sel-item" title="批注：升级为带笔记标注" on:click={onEditAnnotate}>
            <span class="reader-sel-ico">{@html SEL_ICONS.annotate}</span><span class="reader-sel-txt">批注</span>
          </button>
          <button class="reader-sel-item" title="词典" on:click={onSelDict}>
            <span class="reader-sel-ico">{@html SEL_ICONS.dict}</span><span class="reader-sel-txt">词典</span>
          </button>
          <button class="reader-sel-item" title="翻译" on:click={onSelTranslate}>
            <span class="reader-sel-ico">{@html SEL_ICONS.translate}</span><span class="reader-sel-txt">翻译</span>
          </button>
          <button class="reader-sel-item" title="朗读" on:click={onSelSpeak}>
            <span class="reader-sel-ico">{@html SEL_ICONS.tts}</span><span class="reader-sel-txt">朗读</span>
          </button>
          <button class="reader-sel-item" title="发送" on:click={onSelSend}>
            <span class="reader-sel-ico">{@html SEL_ICONS.send}</span><span class="reader-sel-txt">发送</span>
          </button>
          {/if}
        {:else}
          <button class="reader-sel-item" title="复制" on:click={onSelCopy}>
            <span class="reader-sel-ico">{@html SEL_ICONS.copy}</span><span class="reader-sel-txt">复制</span>
          </button>
          <button
            class="reader-sel-item reader-sel-item-accent"
            class:active={selToolbar.stripVisible}
            title="标注：展开样式条（高亮/直线/波浪 + 颜色）"
            on:click={toggleStyleStrip}>
            <span class="reader-sel-ico">{@html SEL_ICONS.highlight}</span><span class="reader-sel-txt">标注</span>
          </button>
          <button
            class="reader-sel-item reader-sel-item-accent"
            title="批注：打开批注编辑气泡（样式+颜色+笔记）"
            on:click={openNoteEditor}>
            <span class="reader-sel-ico">{@html SEL_ICONS.annotate}</span><span class="reader-sel-txt">批注</span>
          </button>
          <button class="reader-sel-item" title="词典" on:click={onSelDict}>
            <span class="reader-sel-ico">{@html SEL_ICONS.dict}</span><span class="reader-sel-txt">词典</span>
          </button>
          <button class="reader-sel-item" title="翻译" on:click={onSelTranslate}>
            <span class="reader-sel-ico">{@html SEL_ICONS.translate}</span><span class="reader-sel-txt">翻译</span>
          </button>
          <button class="reader-sel-item" title="朗读" on:click={onSelSpeak}>
            <span class="reader-sel-ico">{@html SEL_ICONS.tts}</span><span class="reader-sel-txt">朗读</span>
          </button>
          <button class="reader-sel-item" title="发送" on:click={onSelSend}>
            <span class="reader-sel-ico">{@html SEL_ICONS.send}</span><span class="reader-sel-txt">发送</span>
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- 统一批注浮层：preview（只读预览）/ view（兼容）/ highlight（纯标注）/ create·edit（编辑） -->
  {#if noteEditor.visible}
    <div class="reader-note-editor" class:place-above={noteEditor.place==='above'} class:place-below={noteEditor.place==='below'} class:place-left={noteEditor.place==='left'} class:place-right={noteEditor.place==='right'} bind:this={noteEditorEl} style="left:{noteEditor.x}px;top:{noteEditor.y}px">
      {#if noteEditor.mode === "preview"}
        <!-- 2026-08-26 简易预览卡：只读笔记 + 图标操作（复制/导出/删除）+ 编辑入口 -->
        <div class="reader-preview-head">
          <span class="reader-viewer-time" title={noteEditor.time}>{noteEditor.time || "未记录时间"}</span>
          <span class="reader-preview-actions">
            <button class="reader-icon-btn" title="复制" on:click={onViewerCopy}>{@html SEL_ICONS.copy}</button>
            <button class="reader-icon-btn" title="导出" on:click={onViewerExport}>⬇️</button>
            <button class="reader-icon-btn reader-icon-btn-danger" title="删除" on:click={onViewerDelete}>{@html SEL_ICONS.trash}</button>
          </span>
        </div>
        {#if noteEditor.note}
          <div class="reader-viewer-note reader-preview-note">{noteEditor.note}</div>
        {:else}
          <div class="reader-preview-empty">（无批注内容）</div>
        {/if}
        {#if noteEditor.labels.length}
          <div class="reader-viewer-labels">
            {#each noteEditor.labels as l}
              <span class="reader-viewer-label" style="--lc:{l.color}">#{l.name}</span>
            {/each}
          </div>
        {/if}
        <div class="reader-preview-foot">
          <button class="reader-viewer-btn reader-viewer-btn-primary" on:click={onViewerEdit}>✏️ 笔记</button>
        </div>
      {:else if noteEditor.mode === "view"}
        <!-- 查看态（兼容保留）：时间 + 原文 + 批注 + 标签 + 即时改色/样式 + 复制/编辑/删除 -->
        <div class="reader-viewer-head">
          <span class="reader-viewer-time" title={noteEditor.time}>{noteEditor.time || "未记录时间"}</span>
          <span class="reader-viewer-style">
            <span class="reader-style-glyph style-{noteEditor.style}" style="--sc:{noteEditor.color}" title={noteEditor.styleLabel}>{noteEditor.styleGlyph}</span>
          </span>
        </div>
        <div class="reader-viewer-excerpt" title={noteEditor.text}>{noteEditor.text}</div>
        {#if noteEditor.note}
          <div class="reader-viewer-note">{noteEditor.note}</div>
        {/if}
        {#if noteEditor.labels.length}
          <div class="reader-viewer-labels">
            {#each noteEditor.labels as l}
              <span class="reader-viewer-label" style="--lc:{l.color}">#{l.name}</span>
            {/each}
          </div>
        {/if}
        <!-- 即时改色 / 改样式（readest 颜色即分类：不改笔记、不关卡片） -->
        <div class="reader-style-row reader-viewer-style-row">
          {#each ANNOTATION_PANEL_STYLES as s}
            <button class="reader-style-btn" class:active={s === noteEditor.style} title={ANNOTATION_STYLES[s].label} on:click={() => applyViewerStyle(s)}>
              <span class="reader-style-glyph style-{s}" style="--sc:{noteEditor.color}">{ANNOTATION_STYLES[s].icon}</span>
            </button>
          {/each}
        </div>
        <div class="reader-color-row">
          {#each WHALE_COLORS as c}
            <button class="reader-color-dot" class:active={c.value === noteEditor.color} style="background:{c.value}" title={c.name} on:click={() => applyViewerColor(c.value)}></button>
          {/each}
        </div>
        <div class="reader-viewer-actions">
          <button class="reader-viewer-btn" on:click={onViewerCopy}>复制</button>
          <button class="reader-viewer-btn" on:click={onViewerEdit}>编辑</button>
          <button class="reader-viewer-btn reader-viewer-btn-danger" on:click={onViewerDelete}>删除</button>
        </div>
      {:else if noteEditor.mode === "highlight"}
        <!-- 纯标注（高亮）面板：与批注查看卡隔离。仅样式/颜色即时切换 + 删除，无时间/笔记/复制/编辑 -->
        <div class="reader-viewer-head">
          <span class="reader-viewer-time">标注</span>
          <span class="reader-viewer-style">
            <span class="reader-style-glyph style-{noteEditor.style}" style="--sc:{noteEditor.color}" title={noteEditor.styleLabel}>{noteEditor.styleGlyph}</span>
          </span>
        </div>
        <div class="reader-style-row reader-viewer-style-row">
          {#each ANNOTATION_PANEL_STYLES as s}
            <button class="reader-style-btn" class:active={s === noteEditor.style} title={ANNOTATION_STYLES[s].label} on:click={() => applyViewerStyle(s)}>
              <span class="reader-style-glyph style-{s}" style="--sc:{noteEditor.color}">{ANNOTATION_STYLES[s].icon}</span>
            </button>
          {/each}
        </div>
        <div class="reader-color-row">
          {#each WHALE_COLORS as c}
            <button class="reader-color-dot" class:active={c.value === noteEditor.color} style="background:{c.value}" title={c.name} on:click={() => applyViewerColor(c.value)}></button>
          {/each}
        </div>
        <div class="reader-viewer-actions">
          <button class="reader-viewer-btn reader-viewer-btn-danger" on:click={onViewerDelete}>删除</button>
        </div>
      {:else}
        <!-- 新建 / 编辑态：文本预览 + 样式/颜色 + 输入框 + 取消/保存 -->
        <div class="reader-note-preview" title={noteEditor.text}>{noteEditor.text}</div>
        <div class="reader-style-row">
          {#each ANNOTATION_PANEL_STYLES as s}
            <button
              class="reader-style-btn"
              class:active={s === noteEditor.style}
              title={ANNOTATION_STYLES[s].label + '：' + ANNOTATION_STYLES[s].hint}
              on:click={() => noteEditor = { ...noteEditor, style: s }}>
              <span class="reader-style-glyph style-{s}" style="--sc:{noteEditor.color}">{ANNOTATION_STYLES[s].icon}</span>
            </button>
          {/each}
        </div>
        <div class="reader-color-row">
          {#each WHALE_COLORS as c}
            <button
              class="reader-color-dot"
              class:active={c.value === noteEditor.color}
              style="background:{c.value}"
              title={c.name}
              on:click={() => noteEditor = { ...noteEditor, color: c.value }}></button>
          {/each}
        </div>
        <textarea
          class="reader-note-input"
          placeholder="写点批注…"
          bind:value={noteEditor.note}
          use:focusNoteInput></textarea>
        <div class="reader-note-actions">
          <button class="reader-note-btn" on:click={onNoteCancel}>取消</button>
          <button class="reader-note-btn reader-note-btn-primary" on:click={onNoteSave}>保存</button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- 脚注气泡（点击脚注引用 → 展示内容，不跳转；2026-08-25 新增） -->
  {#if showFootnote}
    <div class="reader-popover reader-footnote" bind:this={footnoteEl}>
      <div class="reader-footnote-head">
        <span class="reader-footnote-icon">💡</span>
        <span class="reader-footnote-title">{footnoteType}</span>
        <button class="reader-footnote-close" on:click={closeFootnote} title="关闭">✕</button>
      </div>
      <div class="reader-footnote-body">
        {#if footnoteLoading && !footnoteHTML}
          <div class="reader-footnote-loading">⌛ 脚注加载中…</div>
        {:else}
          {@html footnoteHTML}
        {/if}
      </div>
    </div>
  {/if}

  <!-- 即时词典弹窗（复用 .hiword-dict-* 全局样式） -->
  {#if dictPopup.visible}
    <!-- 仅划词工具栏来源（sel）渲染遮罩：悬浮（hover）来源不能遮罩，否则会拦截 iframe 的 mousemove 取词 -->
    {#if dictPopupSource === "sel"}
      <div class="reader-dict-backdrop" on:click={closeDictPopup} aria-hidden="true"></div>
    {/if}
    <div class="reader-dict-popup" bind:this={dictPopupEl} style="left:{dictPopup.x}px; top:{dictPopup.y}px"
         on:mouseenter={onDictPopupEnter} on:mouseleave={onDictPopupLeave}>
      <div class="reader-dict-head">
        <span>词典</span>
        <div class="reader-dict-head-actions">
          <button class="reader-dict-send" on:click={sendToSidebar} title="在 REword 侧边栏查词（自动填入，无需手动输入）">侧边栏</button>
          <button class="reader-dict-close" on:click={closeDictPopup} title="关闭">✕</button>
        </div>
      </div>
      <div class="reader-dict-body" on:click={onDictBodyClick}>{@html dictPopup.html}</div>
    </div>
  {/if}

  <!-- 批注编辑 / 查看浮层已废弃（2026-08-24 重构后点击高亮改弹底部工具栏，annEditor 无调用方），整段移除 -->
      <!-- annEditor 卡片内容已移除（无调用方） -->

  {#if toastMsg}
    <div class="reader-toast">
      <span>{toastMsg}</span>
      {#if toastUndo}
        <button class="reader-toast-undo" on:click={undoDelete}>撤销</button>
      {/if}
    </div>
  {/if}
  </div><!-- /.reader-floating-layer -->
</div>

<style>
  .reader-view {
    display: flex;
    flex-direction: column;
    /* 2026-08-24 修复（方案 B）：改为相对 flex 子项撑满 holder，
       不再使用 absolute inset:0，避免成为覆盖 Tab 的命中拦截层，
       从而解决思源顶栏"管理"菜单在阅读 Tab 下无法 hover/点击的问题。 */
    position: relative;
    flex: 1;
    min-height: 0;
    /* [REword patch 2026-08-29] Phase 2 触屏优化
     * touch-action: manipulation 避免 iOS Safari 350ms 双击延迟 */
    touch-action: manipulation;
    /* 2026-08-25 修复：原 overflow:hidden 用于裁剪浮层，但会连带裁掉划词工具栏
       （工具栏按 reader-view 相对坐标定位，选区靠顶部时会被算到负 Y 区、被裁掉点不到）。
       正文裁剪已由 .reader-container 的 overflow:hidden 负责，故此处改回 visible；
       浮层的上下/左右避让改由定位逻辑（rectToViewRel + 碰撞检测 + 水平夹紧）约束。 */
    overflow: visible;
    background: var(--b3-theme-background, #fff);
    /* 思源主题字体 + 全平台 CJK + emoji 兜底，
       避免 TOC/章节名里的 emoji/罕字因思源字体无字形而显示 □。
       注意：以下字体只影响本组件 DOM（TOC/搜索/设置/底栏），
       不影响 iframe 内正文——iframe 内的字体由 buildStyles() 独立控制。 */
    font-family: var(--b3-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI",
        "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei",
        "Source Han Sans CN", "Noto Sans CJK SC", "Noto Sans", sans-serif),
      "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Symbola", sans-serif;
  }
  .reader-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    /* 2026-08-29 Phase 1：顶部安全区（刘海 / 灵动岛） */
    padding-top: calc(6px + env(safe-area-inset-top, 0px));
    padding-left: calc(8px + env(safe-area-inset-left, 0px));
    padding-right: calc(8px + env(safe-area-inset-right, 0px));
    /* 2026-08-28 B2：柔和底 + 细边 + 轻投影，提升原生感（仍低于思源原生 UI） */
    background: var(--b3-theme-surface, var(--b3-theme-background, #fff));
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
    flex-shrink: 0;
    /* 2026-08-24 修复：position:relative 仍需保留（确保 toolbar 绘制在 stage 之上），
       但 z-index 从 50 降到 1——阅读器内所有层都不应高于思源原生 UI
       （顶栏"管理"菜单等），否则会把菜单压在下层（边框穿过菜单、无法点击）。 */
    position: relative;
    z-index: 1;
  }
  .reader-toolbar-hidden {
    display: none;
  }
  /* 2026-08-29 Phase 1：触屏设备放大点按目标，避免误触（仅 coarse 指针生效） */
  @media (pointer: coarse) {
    .reader-btn { min-height: 36px; padding: 8px 10px; }
    .reader-mini-btn { min-height: 32px; min-width: 32px; }
  }
  .reader-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 5px 7px;
    border-radius: var(--b3-border-radius-s, 6px);
    color: var(--b3-theme-on-background, #333);
    transition: background 150ms ease, color 150ms ease;
  }
  .reader-btn:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.06));
  }
  .reader-btn-active {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.18));
    color: var(--b3-theme-primary, #378add);
  }
  /* 双语按钮：开启态用绿色强调（呼应译文色），翻译进行中显示忙碌态 */
  .reader-bilingual-btn.reader-btn-active {
    background: rgba(47, 158, 68, 0.18);
    color: #2f9e44;
  }
  .reader-btn-busy {
    opacity: 0.85;
  }
  .reader-title {
    font-size: 13px;
    font-weight: 500;
    max-width: 34%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--b3-theme-on-background, #333);
    user-select: auto;
    cursor: text;
  }
  /* [REword patch 2026-08-29] PDF 缩放工具栏（仅 PDF 显示） */
  .reader-zoom-group {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
    border-left: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
    margin-left: 4px;
  }
  .reader-zoom-btn {
    min-width: 28px;
    padding: 4px 8px;
    font-size: 14px;
    font-weight: 500;
  }
  .reader-zoom-label {
    min-width: 64px;
    text-align: center;
    font-size: 12px;
    font-weight: 500;
    color: var(--b3-theme-on-background, #333);
    padding: 0 4px;
    user-select: none;
  }
  /* [REword patch 2026-08-29] 移动端 PDF 适配 Phase 1 · iPhone / Android Phone 降级模式
   * 工具栏改底部 sheet + 触摸区 ≥44px */
  .reader-toolbar-iphone {
    top: auto;
    bottom: 0;
    border-top: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
    border-bottom: none;
    box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.06);
    padding: 6px 8px;
    gap: 4px;
    justify-content: space-between;
  }
  .reader-toolbar-iphone .reader-btn {
    min-width: 44px;
    min-height: 44px;
    padding: 10px 12px;
    font-size: 16px;
  }
  .reader-toolbar-iphone .reader-zoom-btn {
    min-width: 44px;
    min-height: 44px;
    font-size: 18px;
  }
  .reader-toolbar-iphone .reader-zoom-label {
    min-width: 56px;
    font-size: 13px;
  }
  /* iPhone 模式：标题简化（只保留标题，省略章节） */
  .reader-toolbar-iphone .reader-title {
    max-width: 40%;
  }
  .reader-chapter {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
    max-width: 36%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: auto;
    cursor: text;
  }
  .reader-spacer {
    flex: 1;
  }
  .reader-progress {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
    min-width: 36px;
    text-align: right;
  }
  /* 设置按钮移到顶部右侧：与进度百分比 2% 之间留出 2px 间距 */
  .reader-settings-btn {
    margin-left: 2px;
  }
  /* 点击空白收起遮罩：popover 打开时覆盖正文区，把「iframe 内点击」转为「主文档点击」。
     同时 onContainerMouseDown 绑在 .reader-view 容器上（不再监听 document），
     避免影响思源顶栏"管理"等原生 UI 的点击时序。
     transparent 而非无背景，确保可接收点击（pointer-events 默认 auto）。 */
  .reader-backdrop {
    position: absolute;
    top: 34px;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
    background: transparent;
  }

  /* 2026-08-23 修复：浮层容器（划词/词典/批注/toast 全部纳入）
     - position: absolute（相对 .reader-view 容器，不脱离视口）
     - inset: 0（占满容器）
     - pointer-events: none（默认不拦截，让背后 foliate-view / 正文可点）
     - 子元素显式 pointer-events: auto（需要交互时启用）
     - z-index: 2（浮在 foliate-view 之上，但远低于思源原生 UI，不压菜单） */
  .reader-floating-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2;
  }

  .reader-floating-layer > * {
    pointer-events: auto;
  }

  /* 划词工具栏（微信读书式）：定位到选区正上方，主工具栏(图标+文字) + 上方样式条 */
  .reader-sel-toolbar {
    position: absolute;
    left: 0;
    top: 0;
    transform: translate(-50%, -100%);
    z-index: 3;
    display: flex;
    flex-direction: column-reverse;
    align-items: center;
    gap: 8px;
    pointer-events: none; /* 容器不拦截，子元素自动开启 */
  }
  .reader-sel-toolbar > * { pointer-events: auto; }
  /* 顶部空间不足翻到选区下方时：锚点改取选区下沿，工具栏向下延伸（而非向上覆盖选区） */
  .reader-sel-toolbar.place-below { transform: translate(-50%, 0); }
  /* 2026-08-29 四向避让：上下均无空间时退到选区左/右（垂直居中于选区），彻底避开选中文本 */
  .reader-sel-toolbar.place-left { transform: translate(-100%, -50%); }
  .reader-sel-toolbar.place-right { transform: translate(0, -50%); }
  .reader-sel-toolbar.place-left .reader-sel-main,
  .reader-sel-toolbar.place-right .reader-sel-main {
    transform-origin: center center;
  }
  /* 左置：小三角在右边缘、朝右指向选区 */
  .reader-sel-toolbar.place-left .reader-sel-main::after {
    left: auto; right: -7px; top: 50%; bottom: auto;
    transform: translateY(-50%);
    border-top: 7px solid transparent;
    border-bottom: 7px solid transparent;
    border-left: 7px solid var(--reword-glass-bg);
    border-right: none;
  }
  /* 右置：小三角在左边缘、朝左指向选区 */
  .reader-sel-toolbar.place-right .reader-sel-main::after {
    left: -7px; right: auto; top: 50%; bottom: auto;
    transform: translateY(-50%);
    border-top: 7px solid transparent;
    border-bottom: 7px solid transparent;
    border-right: 7px solid var(--reword-glass-bg);
    border-left: none;
  }

  /* 主工具栏：毛玻璃圆角胶囊（2026-08-29 UI 全面优化），图标在上、文字在下 */
  .reader-sel-main {
    display: flex;
    align-items: flex-start;
    gap: 2px;
    padding: 8px 8px 6px;
    box-sizing: border-box;
    background: var(--reword-glass-bg);
    -webkit-backdrop-filter: blur(var(--reword-glass-blur))
      saturate(var(--reword-glass-saturate));
    backdrop-filter: blur(var(--reword-glass-blur))
      saturate(var(--reword-glass-saturate));
    border: 1px solid var(--reword-glass-border);
    border-radius: var(--reword-radius-xl);
    box-shadow: var(--reword-glass-shadow);
    color: var(--reword-glass-fg);
    transform-origin: center bottom;
    animation: readerToolbarIn 0.22s cubic-bezier(0.22, 1, 0.36, 1) both;
    /* 小啾啾三角：默认在底部朝下指向选区文本 */
    position: relative;
  }
  .reader-sel-main::after {
    content: "";
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 0; height: 0;
    border-left: 7px solid transparent;
    border-right: 7px solid transparent;
    border-top-color: var(--reword-glass-bg);
    border-top-style: solid;
    border-top-width: 7px;
    bottom: -7px;
    pointer-events: none;
  }
  /* place-below 时三角翻到顶部朝上 */
  .reader-sel-toolbar.place-below .reader-sel-main {
    transform-origin: center top;
  }
  .reader-sel-toolbar.place-below .reader-sel-main::after {
    top: -7px; bottom: auto;
    border-top: none;
    border-bottom-color: var(--reword-glass-bg);
    border-bottom-style: solid;
    border-bottom-width: 7px;
  }
  @keyframes readerToolbarIn {
    from { opacity: 0; transform: scale(0.9) translateY(4px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
  .reader-sel-item {
    border: none;
    background: transparent;
    color: var(--reword-glass-fg);
    padding: 4px 9px 2px;
    border-radius: 8px;
    cursor: pointer;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 40px;
    transition: background 0.15s ease;
  }
  .reader-sel-item:hover {
    background: var(--reword-glass-fill-hover);
  }
  .reader-sel-item :global(svg) {
    width: 20px;
    height: 20px;
  }
  .reader-sel-ico {
    display: inline-flex;
    line-height: 0;
  }
  .reader-sel-txt {
    font-size: 10px;
    line-height: 1;
    color: #c9c9c9;
    white-space: nowrap;
  }
  /* 主操作（标注/批注）：玻璃底上的浅填充，激活时转主题色实心（方向 A） */
  .reader-sel-item-accent {
    color: #fff;
    background: var(--reword-glass-fill);
  }
  .reader-sel-item-accent:hover {
    background: var(--reword-glass-fill-hover);
  }
  .reader-sel-item-accent .reader-sel-txt {
    color: #fff;
  }
  .reader-sel-item-accent.active {
    background: var(--b3-theme-primary, #378add);
    color: #fff;
  }
  .reader-sel-item-accent.active:hover {
    background: var(--b3-theme-primary, #378add);
    filter: brightness(1.08);
  }
  .reader-sel-item-accent.active .reader-sel-txt {
    color: #fff;
  }
  .reader-sel-item-danger .reader-sel-ico :global(svg),
  .reader-sel-item-danger .reader-sel-txt { color: #ff6b6b; }
  .reader-sel-item-danger:hover { background: rgba(255, 107, 107, 0.18); }

  /* 第二层样式条（readest 风格）：作为 column-reverse flex 子元素，
     DOM 中位于 .reader-sel-main 之前 → 视觉上自动浮在主工具栏正上方。
     create 态需点「高亮」才展开(stripVisible)；edit 态常显。 */
  .reader-sel-strip {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 12px;
    background: var(--reword-glass-bg);
    -webkit-backdrop-filter: blur(var(--reword-glass-blur))
      saturate(var(--reword-glass-saturate));
    backdrop-filter: blur(var(--reword-glass-blur))
      saturate(var(--reword-glass-saturate));
    border: 1px solid var(--reword-glass-border);
    border-radius: var(--reword-radius-lg);
    box-shadow: var(--reword-glass-shadow);
    color: var(--reword-glass-fg);
    white-space: nowrap;
    animation: readerToolbarIn 0.22s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  /* edit 态与 create 态共用「样式条在工具栏上方」语义（2026-08-25 对齐用户澄清） */
  .reader-style-row {
    display: inline-flex;
    gap: 2px;
    padding-right: 14px;
    border-right: 1px solid rgba(255, 255, 255, 0.18);
  }
  .reader-style-btn {
    border: none;
    background: transparent;
    padding: 5px 7px;
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .reader-style-btn:hover { background: rgba(255, 255, 255, 0.14); }
  .reader-style-btn.active { background: rgba(255, 255, 255, 0.22); }
  .reader-color-row {
    display: inline-flex;
    gap: 8px;
  }
  .reader-color-dot {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
    transition: transform 0.12s ease, border-color 0.12s ease;
  }
  .reader-color-dot:hover { transform: scale(1.12); }
  .reader-color-dot.active {
    border-color: #fff;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4);
  }

  /* 样式字形（A 字符 + 装饰线，用于批注卡片的样式按钮预览） */
  .reader-style-glyph {
    display: inline-block;
    font-family: serif;
    font-weight: 600;
    color: var(--sc, #06b6d4);
    text-decoration: underline;
    text-decoration-color: var(--sc, #06b6d4);
  }
  .reader-style-glyph.style-highlight {
    text-decoration: none;
    background: color-mix(in srgb, var(--sc, #06b6d4) 35%, transparent);
    border-radius: 3px;
    padding: 0 2px;
  }
  .reader-style-glyph.style-solid { text-decoration-style: solid; }
  .reader-style-glyph.style-wavy { text-decoration-style: wavy; }

  /* 批注编辑气泡（A-P0）：文本预览 + 样式/颜色 + note 输入 + 取消/保存
     定位在选区下方（思阅风格），top/left 为气泡左上角坐标，transform 仅水平居中 */
  .reader-note-editor {
    position: absolute;
    left: 0;
    top: 0;
    transform: translate(-50%, 0);
    z-index: 4; /* 高于底部工具栏 */
    width: 268px;
    box-sizing: border-box; /* 宽度含 padding，与 JS 夹紧用的 268 一致 */
    max-width: calc(100% - 16px); /* 相对容器（reader-view）而非视口，避免侧栏展开时溢出 */
    margin-top: 10px; /* 与选区拉开间距 */
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--reword-glass-bg);
    -webkit-backdrop-filter: blur(var(--reword-glass-blur))
      saturate(var(--reword-glass-saturate));
    backdrop-filter: blur(var(--reword-glass-blur))
      saturate(var(--reword-glass-saturate));
    border: 1px solid var(--reword-glass-border);
    border-radius: var(--reword-radius-lg);
    box-shadow: var(--reword-glass-shadow);
    color: var(--reword-glass-fg);
    pointer-events: auto;
  }
  /* 2026-08-25 底部空间不足时翻转到选区上方：transform 翻转 Y 轴 + 间距改到底部 */
  .reader-note-editor.place-above {
    transform: translate(-50%, -100%);
    margin-top: 0;
    margin-bottom: 10px;
  }
  /* 2026-08-29 四向避让：below=默认（translate(-50%,0)）；left/right=垂直居中于选区 */
  .reader-note-editor.place-below {
    transform: translate(-50%, 0);
    margin-top: 10px;
  }
  .reader-note-editor.place-left {
    transform: translate(-100%, -50%);
    margin-top: 0;
  }
  .reader-note-editor.place-right {
    transform: translate(0, -50%);
    margin-top: 0;
  }
  /* 小三角指向选中文本（与背景同色） */
  .reader-note-editor::after {
    content: "";
    position: absolute;
    width: 0;
    height: 0;
    border: 7px solid transparent;
    pointer-events: none;
  }
  .reader-note-editor.place-above::after {
    left: 50%;
    bottom: -13px;
    transform: translateX(-50%);
    border-top-color: var(--reword-glass-bg);
  }
  .reader-note-editor.place-below::after {
    left: 50%;
    top: -13px;
    transform: translateX(-50%);
    border-bottom-color: var(--reword-glass-bg);
  }
  .reader-note-editor.place-left::after {
    right: -13px;
    top: 50%;
    transform: translateY(-50%);
    border-left-color: var(--reword-glass-bg);
  }
  .reader-note-editor.place-right::after {
    left: -13px;
    top: 50%;
    transform: translateY(-50%);
    border-right-color: var(--reword-glass-bg);
  }
  .reader-note-preview {
    font-size: 12px;
    line-height: 1.4;
    color: #b9c0c7;
    max-height: 48px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .reader-note-editor .reader-style-row,
  .reader-note-editor .reader-color-row {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .reader-note-input {
    width: 100%;
    min-height: 64px;
    max-height: 160px;
    resize: vertical;
    box-sizing: border-box;
    padding: 8px;
    font-size: 13px;
    line-height: 1.5;
    color: #f2f2f2;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    outline: none;
  }
  .reader-note-input:focus { border-color: rgba(6, 182, 212, 0.7); }
  .reader-note-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .reader-note-btn {
    padding: 5px 14px;
    font-size: 13px;
    color: #e8e8e8;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    cursor: pointer;
  }
  .reader-note-btn:hover { background: rgba(255, 255, 255, 0.18); }
  .reader-note-btn-primary {
    color: #04222a;
    background: #06b6d4;
    border-color: #06b6d4;
    font-weight: 600;
  }
  .reader-note-btn-primary:hover { background: #22c4dd; }

  /* 查看态即时改色/样式行（复用 .reader-style-row / .reader-color-row，紧凑单行） */
  .reader-viewer-style-row {
    padding-right: 0;
    border-right: none;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .reader-viewer-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: #9aa3ab; }
  .reader-viewer-time { opacity: 0.85; }

  /* 2026-08-26 简易预览卡（preview 态）样式 */
  .reader-preview-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: #9aa3ab; }
  .reader-preview-actions { display: flex; gap: 2px; }
  .reader-icon-btn {
    width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
    border: none; background: transparent; border-radius: 6px; cursor: pointer; font-size: 13px; color: #cdd5dd;
    padding: 0;
  }
  .reader-icon-btn:hover { background: rgba(255, 255, 255, 0.12); }
  .reader-icon-btn-danger:hover { background: rgba(255, 80, 80, 0.18); color: #ffb4b4; }
  .reader-preview-note { max-height: 140px; overflow: auto; }
  .reader-preview-empty { font-size: 12px; color: #7a838c; font-style: italic; padding: 4px 0; }
  .reader-preview-foot { display: flex; justify-content: flex-end; margin-top: 4px; }
  .reader-viewer-btn-primary { background: rgba(90, 160, 255, 0.18); border-color: rgba(90, 160, 255, 0.4); color: #aaccff; }
  .reader-viewer-btn-primary:hover { background: rgba(90, 160, 255, 0.3); }
  .reader-viewer-excerpt {
    font-size: 13px;
    line-height: 1.5;
    color: #f2f2f2;
    max-height: 4.5em;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  .reader-viewer-note {
    font-size: 13px;
    line-height: 1.55;
    color: #cfe8ef;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 6px 8px;
    max-height: 120px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .reader-viewer-labels { display: flex; flex-wrap: wrap; gap: 6px; }
  .reader-viewer-label {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 999px;
    color: var(--lc, #9ca3af);
    background: color-mix(in srgb, var(--lc, #9ca3af) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--lc, #9ca3af) 40%, transparent);
  }
  .reader-viewer-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .reader-viewer-btn {
    padding: 4px 12px;
    font-size: 12px;
    color: #e8e8e8;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    cursor: pointer;
  }
  .reader-viewer-btn:hover { background: rgba(255, 255, 255, 0.18); }
  .reader-viewer-btn-danger { color: #ffb4b4; border-color: rgba(255, 120, 120, 0.4); }
  .reader-viewer-btn-danger:hover { background: rgba(255, 80, 80, 0.18); }

  /* 即时词典弹窗：复用全局 .hiword-dict-* 卡片样式 */
  .reader-dict-backdrop {
    /* 2026-08-23 修复：position:fixed → absolute（限定在 .reader-floating-layer 内） */
    position: absolute;
    inset: 0;
    /* 2026-08-24 修复：z-index 降到 3（floating-layer 内部相对顺序，不突破外部） */
    z-index: 3;
    background: transparent;
  }
  .reader-dict-popup {
    /* 2026-08-23 修复：position:fixed → absolute */
    position: absolute;
    /* 2026-08-24 修复：z-index 降到 3 */
    z-index: 3;
    width: 360px;
    max-width: 88vw;
    max-height: 62vh;
    overflow: auto;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.12));
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
    transform: translateX(-50%);
  }
  .reader-dict-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 600;
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    position: sticky;
    top: 0;
    background: var(--b3-theme-background, #fff);
  }
  .reader-dict-head-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .reader-dict-send {
    border: 1px solid var(--b3-theme-primary, #4f6ef7);
    background: var(--b3-theme-primary, #4f6ef7);
    color: #fff;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 4px 8px;
    border-radius: 6px;
    transition: opacity 0.12s ease;
  }
  .reader-dict-send:hover {
    opacity: 0.85;
  }
  .reader-dict-close {
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 14px;
    color: var(--b3-theme-on-background, #666);
  }
  .reader-dict-body {
    padding: 10px 12px;
  }

  .reader-toast {
    /* 2026-08-23 修复：position:fixed → absolute（限定在 .reader-floating-layer 内） */
    position: absolute;
    left: 50%;
    /* 16px 适配 reader-view 容器底部（不再贴视口底部 64px） */
    bottom: 16px;
    transform: translateX(-50%);
    /* 2026-08-24 修复：z-index 降到 3 */
    z-index: 3;
    background: rgba(0, 0, 0, 0.82);
    color: #fff;
    font-size: 13px;
    padding: 8px 14px;
    border-radius: 8px;
    pointer-events: none;
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .reader-toast-undo {
    pointer-events: auto;
    border: none;
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .reader-toast-undo:hover { background: rgba(255, 255, 255, 0.3); }

  /* Phase 2 批注编辑 / 查看浮层 */
  .reader-ann-backdrop {
    /* 2026-08-23 修复：position:fixed → absolute */
    position: absolute;
    inset: 0;
    /* 2026-08-24 修复：z-index 降到 3 */
    z-index: 3;
    background: transparent;
  }
  .reader-ann-editor {
    /* 2026-08-23 修复：position:fixed → absolute */
    position: absolute;
    transform: translateX(-50%);
    /* 2026-08-24 修复：z-index 降到 3 */
    z-index: 3;
    width: 320px;
    max-width: 90vw;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.12));
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
    padding: 12px;
  }
  .reader-ann-date {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #999);
    margin-bottom: 8px;
  }
  .reader-ann-section {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .reader-ann-section-title {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
    flex-shrink: 0;
    width: 28px;
  }
  .reader-ann-groups {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .reader-ann-group {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: transparent;
    border-radius: 14px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
  }
  .reader-ann-group.active {
    border-color: var(--b3-theme-primary, #06b6d4);
    background: color-mix(in srgb, var(--b3-theme-primary, #06b6d4) 16%, transparent);
    font-weight: 600;
  }
  .reader-ann-colors {
    display: flex;
    gap: 6px;
  }
  .reader-ann-color {
    border: 2px solid transparent;
    border-radius: 50%;
    width: 20px;
    height: 20px;
    cursor: pointer;
    padding: 0;
  }
  .reader-ann-color.active {
    border-color: var(--b3-theme-on-background, #333);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.15);
  }
  .reader-ann-styles {
    display: flex;
    gap: 6px;
  }
  .reader-ann-style {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: transparent;
    border-radius: 8px;
    width: 36px;
    height: 32px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .reader-ann-style.active {
    border-color: var(--b3-theme-primary, #06b6d4);
    background: color-mix(in srgb, var(--b3-theme-primary, #06b6d4) 16%, transparent);
  }
  .reader-ann-quote {
    font-size: 13px;
    color: var(--b3-theme-on-background, #555);
    background: var(--b3-theme-surface, rgba(0, 0, 0, 0.04));
    border-left: 3px solid var(--b3-theme-primary, #06b6d4);
    padding: 6px 8px;
    border-radius: 4px;
    margin-bottom: 10px;
    max-height: 60px;
    overflow: auto;
    word-break: break-word;
  }
  .reader-ann-note {
    width: 100%;
    box-sizing: border-box;
    min-height: 64px;
    resize: vertical;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 8px;
    font-size: 13px;
    font-family: inherit;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
  }
  .reader-ann-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .reader-ann-spacer { flex: 1; }
  .reader-ann-btn {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: transparent;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 13px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
  }
  .reader-ann-btn.primary {
    background: var(--b3-theme-primary, #06b6d4);
    border-color: var(--b3-theme-primary, #06b6d4);
    color: #fff;
  }
  .reader-ann-btn.danger {
    color: #e5484d;
    border-color: #e5484d;
  }
  /* 阅读舞台：包住 container + 左右悬浮箭头；绝对定位撑满，容器与箭头同层 */
  .reader-stage {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-height: 240px;
  }
  .reader-container {
    position: absolute;
    inset: 0;
    overflow: hidden;
    /* 兜底背景：iframe 渲染前/透明时透出此色而非思源暗色黑底（黑底闪屏根因之一）。
       实际主题色由 applyContainerBg() 通过 JS 动态覆盖到该元素 background。 */
    background: #ffffff;
  }
  .reader-container reword-foliate-view {
    display: block;
    width: 100%;
    height: 100%;
    /* 兜底：reword-foliate-view 高度依赖容器，给最小可视高度 */
    min-height: 240px;
  }
  /* 批注指示器小圆点（onDrawAnnotation 中有笔记时绘制） */
  .xh-note-indicator {
    pointer-events: none;
    opacity: 0.85;
    transition: opacity 0.15s, r 0.15s;
  }
  .xh-note-indicator:hover {
    opacity: 1;
    r: 3.5;
  }
  /* 左右悬浮翻页箭头：半透明默认态，hover/focus 提升；按住连翻 */
  .reader-side-tap {
    position: absolute;
    inset: 0;
    pointer-events: none;
    /* 2026-08-24 修复：z-index 从 35 降到 1，避免压住思源原生 UI */
    z-index: 1;
  }
  .reader-side-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 34px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 10px;
    background: var(--b3-theme-background, rgba(255, 255, 255, 0.9));
    color: var(--b3-theme-on-surface-light, #888);
    opacity: 0.3;
    cursor: pointer;
    pointer-events: auto;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.12);
  }
  .reader-side-left {
    left: 6px;
  }
  .reader-side-right {
    right: 6px;
  }
  .reader-side-arrow:hover,
  .reader-side-arrow:focus-visible {
    opacity: 0.95;
    color: var(--b3-theme-primary, #378add);
    border-color: var(--b3-theme-primary, #378add);
    background: var(--b3-theme-background, #fff);
  }
  .reader-side-arrow:active {
    transform: translateY(-50%) scale(0.92);
  }
  .reader-side-arrow:focus {
    outline: none;
  }
  .reader-side-arrow:focus-visible {
    outline: 2px solid var(--b3-theme-primary, #378add);
    outline-offset: 2px;
  }
  /* 窄屏隐藏箭头（触屏靠滑动翻页） */
  @media (max-width: 479px) {
    .reader-side-tap {
      display: none;
    }
  }
  /* 设置面板：开关行 + 开关 */
  .reader-setting-toggle-row {
    justify-content: space-between;
  }
  .reader-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    flex-shrink: 0;
  }
  .reader-switch input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .reader-switch-track {
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.12));
    transition: background 200ms ease-out;
    position: relative;
  }
  .reader-switch-track::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    transition: transform 200ms ease-out;
  }
  .reader-switch input:checked + .reader-switch-track {
    background: var(--b3-theme-primary, #378add);
  }
  .reader-switch input:checked + .reader-switch-track::after {
    transform: translateX(16px);
  }

  .reader-popover {
    position: absolute;
    /* 2026-08-24 修复：z-index 从 40 降到 2，保持高于 stage(0)/backdrop(1)，
       但远低于思源原生 UI，避免压住顶栏"管理"菜单 */
    z-index: 2;
    background: var(--b3-theme-background, #fff);
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  }
  .reader-popover-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--b3-theme-on-background, #333);
    padding-bottom: 6px;
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    /* 2026-08-23 修复：标题 sticky 钉在弹层滚动视口顶部，
       滚动时不再随章节内容移动（Readt/思阅 同款固定表头做法） */
    position: sticky;
    top: 0;
    z-index: 2;
    flex: 0 0 auto;
    background: var(--b3-theme-background, #fff);
  }
  .reader-toc {
    top: 34px;
    left: 8px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    padding: 8px;
    width: 260px;
    min-width: 220px;
    /* 2026-08-23 修复：整块 popover 作为滚动容器，标题用 sticky 固定；
       overscroll-behavior 阻止滚动链传导到正文 */
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
  }
  .reader-toc-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
    /* 列表不再独立滚动，交由 popover 滚动；标题由 sticky 固定 */
  }
  .reader-toc-item {
    display: block;
    width: 100%;
    box-sizing: border-box;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.7;
    min-height: 34px;
    color: var(--b3-theme-on-background, #333);
    white-space: nowrap;
    overflow-x: hidden;
    overflow-y: visible;
    text-overflow: ellipsis;
  }
  .reader-toc-item:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.06));
  }
  .reader-toc-active {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.16));
    color: var(--b3-theme-primary, #378add);
  }
  .reader-toc-check {
    color: var(--b3-theme-primary, #378add);
    margin-right: 5px;
    font-size: 11px;
    flex-shrink: 0;
  }
  .reader-toc-count {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    margin-left: 6px;
  }
  .reader-toc-empty {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
    padding: 10px 4px;
  }
  /* 2026-08-29 新增：书签 / 摘录汇总抽屉 */
  .reader-bookmarks,
  .reader-annots {
    min-width: 260px;
    max-width: 340px;
  }
  .reader-bm-list,
  .reader-annots-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
  }
  .reader-bm-add {
    background: none;
    border: 1px dashed var(--b3-border-color, rgba(0, 0, 0, 0.2));
    border-radius: var(--reword-radius-sm, 6px);
    color: var(--b3-theme-primary, #378add);
    font-size: 12px;
    padding: 7px 10px;
    cursor: pointer;
    text-align: left;
  }
  .reader-bm-add:hover {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.1));
  }
  .reader-bm-item,
  .reader-annot-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    border-radius: var(--reword-radius-sm, 6px);
    padding: 2px 4px;
  }
  .reader-bm-item:hover,
  .reader-annot-item:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.05));
  }
  .reader-bm-main,
  .reader-annot-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 6px 4px;
    color: var(--b3-theme-on-background, #333);
  }
  .reader-bm-label {
    font-size: 13px;
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reader-bm-excerpt {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reader-annot-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 10px;
    flex-shrink: 0;
  }
  .reader-annot-text {
    font-size: 13px;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .reader-annot-note {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .reader-eta {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    flex-shrink: 0;
  }

  .reader-search {
    bottom: 44px;
    left: 8px;
    width: 300px;
    max-height: 62vh;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .reader-search-row {
    display: flex;
    gap: 4px;
  }
  .reader-search-input {
    flex: 1;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.2));
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 12px;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    min-width: 0;
  }
  .reader-search-options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .reader-search-scope { display: inline-flex; gap: 2px; }
  .reader-seg-sm {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 6px;
  }
  .reader-search-opt {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    cursor: pointer;
    user-select: none;
  }
  .reader-search-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .reader-search-nav { display: inline-flex; gap: 2px; }
  .reader-search-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    max-height: 40vh;
    margin: 0 -2px;
    padding: 2px;
  }
  .reader-search-item {
    text-align: left;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.12));
    border-radius: 8px;
    background: var(--b3-theme-background, #fff);
    padding: 6px 8px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .reader-search-item:hover { background: var(--b3-theme-surface, #f3f3f3); }
  .reader-search-item-active {
    border-color: var(--b3-theme-primary, #4a7bd0);
    background: color-mix(in srgb, var(--b3-theme-primary, #4a7bd0) 12%, var(--b3-theme-background, #fff));
  }
  .reader-search-item-head {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    margin-bottom: 2px;
  }
  .reader-search-item-pct { flex-shrink: 0; opacity: 0.8; }
  .reader-search-item-excerpt {
    font-size: 12px;
    line-height: 1.5;
    color: var(--b3-theme-on-background, #333);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .reader-search-item-excerpt mark {
    background: #ffe08a;
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
  .reader-search-item-active .reader-search-item-excerpt mark {
    background: #ffb020;
  }

  /* ===== 脚注气泡（2026-08-25 新增，对齐截图设计） ===== */
  .reader-footnote {
    position: absolute;
    width: min(360px, 80%);
    max-height: 60vh;
    background: var(--b3-theme-background, #fff);
    border-radius: 10px;
    border-left: 3px solid #e5484d; /* 红色左边框（截图特征） */
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.08);
    overflow: hidden;
    z-index: 100;
    display: flex;
    flex-direction: column;
    animation: fn-fade-in 0.15s ease-out;
  }
  @keyframes fn-fade-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .reader-footnote-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    flex-shrink: 0;
  }
  .reader-footnote-icon {
    font-size: 14px;
    flex-shrink: 0;
  }
  .reader-footnote-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--b3-theme-on-background, #333);
    flex: 1;
  }
  .reader-footnote-close {
    background: none;
    border: none;
    font-size: 14px;
    color: var(--b3-theme-on-surface-light, #999);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    line-height: 1;
    flex-shrink: 0;
  }
  .reader-footnote-close:hover {
    background: rgba(0, 0, 0, 0.06);
    color: var(--b3-theme-on-background, #333);
  }
  .reader-footnote-body {
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.65;
    color: var(--b3-theme-on-background, #333);
    overflow-y: auto;
    /* 样式隔离：强制显示隐藏脚注块 */
  }
  .reader-footnote-body :global(aside),
  .reader-footnote-body :global([style*="display:none"]),
  .reader-footnote-body :global([style*="display: none"]),
  .reader-footnote-body :global([hidden]) {
    display: block !important;
  }
  .reader-footnote-body :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    margin: 4px 0;
  }
  .reader-footnote-body :global(a) {
    color: var(--b3-theme-primary, #0f6bff);
    text-decoration: none;
    /* 气泡内链接（如脚注里的「返回正文 ↩」锚点）在容器层无目标上下文，点击会触发
       思源页面异常导航；气泡仅为展示，禁用其点击（文字仍可读/可复制）。 */
    pointer-events: none;
    cursor: default;
  }
  .reader-footnote-body :global(a:hover) {
    text-decoration: underline;
  }
  .reader-footnote-loading {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 2px;
    color: var(--b3-theme-on-surface-light, #999);
    font-size: 12px;
  }

  .reader-settings {
    /* 2026-08-25 紧凑化：4 大分组 26+ setting-row 弹窗高度溢出，max-height 提到 80vh、宽度 300px、
       padding/gap 减小 40% 左右，保证 4 大分组一屏可览 70% 内容 */
    top: 34px;
    right: 8px;
    width: 300px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 80vh;
    overflow-y: auto;
  }
  .reader-setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
  }
  .reader-setting-hint {
    margin: -6px 0 8px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--b3-theme-on-background, #555);
    opacity: 0.72;
  }
  /* 2026-08-24：4 大分组（details/summary 折叠） */
  .reader-setting-section {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
    border-radius: 6px;
    padding: 0;
    margin: 2px 0;
  }
  .reader-setting-section[open] {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.02));
  }
  .reader-setting-section-title {
    cursor: pointer;
    padding: 5px 8px;
    font-weight: 600;
    font-size: 12.5px;
    user-select: none;
    list-style: none;
    display: block;
  }
  .reader-setting-section-title::-webkit-details-marker { display: none; }
  .reader-setting-section > .reader-setting-row {
    padding: 2px 8px;
    min-height: 26px;
  }
  /* 2026-08-25：2x2 网格（4 边距等成对属性紧凑布局） */
  .reader-setting-grid-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 8px;
    padding: 2px 8px;
  }
  .reader-setting-grid-2col > .reader-setting-row {
    padding: 0;
    min-height: 24px;
  }
  /* 2026-08-25：2 列网格（label + control） */
  .reader-setting-grid-2col > .reader-setting-row {
    display: grid;
    grid-template-columns: minmax(0, auto) 1fr;
    align-items: center;
    gap: 4px;
  }
  /* slider（input[type=range]） */
  .reader-slider {
    flex: 1;
    min-width: 0;
    accent-color: var(--b3-theme-primary, #3573f0);
    height: 4px;
  }
  .reader-setting-subblock {
    margin: 4px 0 6px;
    padding: 10px 10px 4px;
    border: 1px dashed var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 8px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.03));
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .reader-setting-subtitle {
    font-size: 12px;
    font-weight: 600;
    color: var(--b3-theme-primary, #3573f0);
  }
  .reader-input {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    font-size: 12px;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.12));
    border-radius: 5px;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    box-sizing: border-box;
  }
  /* textarea */
  .reader-setting-textarea {
    flex: 1;
    min-width: 0;
    width: 100%;
    min-height: 32px;
    padding: 4px 6px;
    font-family: var(--b3-font-family, sans-serif);
    font-size: 12px;
    line-height: 1.4;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.12));
    border-radius: 4px;
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    resize: vertical;
    box-sizing: border-box;
  }
  .reader-setting-textarea:focus {
    outline: none;
    border-color: var(--b3-theme-primary, #3573f0);
  }
  .reader-font-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 2px 0 4px;
  }
  .reader-font-item {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.12));
    border-radius: 6px;
    padding: 3px 6px;
  }
  .reader-font-item-active {
    border-color: var(--b3-theme-primary, #378add);
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.08));
  }
  .reader-font-pick {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px;
    text-align: left;
    min-width: 0;
  }
  .reader-font-name {
    font-size: 12px;
    color: var(--b3-theme-on-background, #333);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reader-font-size {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    flex-shrink: 0;
  }
  .reader-font-del {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--b3-theme-error, #e24b4a);
    font-size: 11px;
    padding: 2px 4px;
    flex-shrink: 0;
  }
  .reader-font-empty {
    font-size: 12px;
    color: var(--b3-theme-on-surface-light, #888);
    padding: 2px;
  }
  .reader-font-import {
    border: 1px dashed var(--b3-border-color, rgba(0, 0, 0, 0.25));
    background: none;
    border-radius: 6px;
    padding: 5px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-primary, #378add);
  }
  .reader-font-import:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .reader-setting-label {
    font-size: 12px;
    color: var(--b3-theme-on-surface, #666);
    flex-shrink: 0;
  }
  .reader-setting-col {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .reader-text-input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 12px;
    color: var(--b3-theme-on-background, #333);
    background: var(--b3-theme-background, #fff);
    font-family: var(--b3-font-family, inherit);
  }
  .reader-text-clear {
    align-self: flex-end;
    background: none;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
  }
  .reader-text-clear:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.06));
  }

  /* ---- 2026-08-28 分类字体设置（衬线/无衬线/等宽/中文）---- */
  /* 下拉行：标签在上、选择器在下——长字体名不会挤压标签 */
  .reader-setting-row-stack {
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }
  .reader-font-select {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
    background: var(--b3-theme-background, #fff);
    font-family: var(--b3-font-family, inherit);
  }
  .reader-font-hint {
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.6;
    padding: 2px 0 4px;
  }

  /* v1.3.0 本书上下文（lite Protyle 编辑区） */
  .reader-primer-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.12));
    border-radius: 8px;
    margin: 2px 0 6px;
  }
  .reader-primer-tip {
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.6;
  }
  .reader-primer-editor {
    /* 容器必须有高度才能挂载 lite Protyle（AnnEditor 内部有 rAF 重试兜底） */
    height: 180px;
    overflow-y: auto;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
    border-radius: 6px;
    background: var(--b3-theme-background, #fff);
  }
  .reader-primer-editor :global(.protyle) {
    height: 100%;
  }
  .reader-primer-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .reader-primer-stats {
    font-size: 11px;
    opacity: 0.6;
  }
  .reader-primer-warn {
    color: var(--b3-theme-warning, #d97706);
    opacity: 1;
  }

  .reader-setting-control {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .reader-mini-btn {
    background: none;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
  }
  .reader-mini-btn:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.06));
  }
  .reader-setting-value {
    font-size: 12px;
    min-width: 34px;
    text-align: center;
    color: var(--b3-theme-on-background, #333);
  }
  /* 2026-08-28：设置面板内说明文案（token 警告 / 缓存说明） */
  .reader-setting-tip {
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.62;
    margin: 1px 0 4px;
    padding-left: 2px;
  }
  .reader-setting-tip-warn {
    color: var(--b3-theme-warning, #d97706);
    opacity: 1;
  }
  /* 2026-08-28：翻译缓存块（书名 + 选择器 + 页数统计） */
  .reader-cache-block {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.12));
    border-radius: 8px;
    padding: 8px 10px;
    margin: 4px 0 6px;
    background: var(--b3-list-hover, rgba(127, 127, 127, 0.06));
  }
  .reader-cache-book {
    font-size: 12px;
    font-weight: 600;
    color: var(--b3-theme-on-background, #333);
    margin: 2px 0 6px;
    padding-left: 2px;
    word-break: break-all;
  }
  .reader-select {
    max-width: 160px;
    font-size: 12px;
    padding: 2px 4px;
    border-radius: 6px;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.18));
    background: var(--b3-theme-background, #fff);
    color: var(--b3-theme-on-background, #333);
    cursor: pointer;
  }
  .reader-mini-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .reader-seg {
    background: none;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 3px 9px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
  }
  .reader-seg:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.06));
  }
  .reader-seg-active {
    background: var(--b3-theme-primary, #378add);
    border-color: transparent;
    color: #fff;
  }
  .reader-theme-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
  }
  .reader-theme-swatch {
    background: none;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 6px;
    padding: 3px 2px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .reader-swatch-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.12);
    display: inline-block;
  }
  .reader-swatch-label {
    font-size: 10px;
    color: var(--b3-theme-on-background, #333);
    line-height: 1;
  }

  .reader-bottom-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 8px;
    /* 2026-08-29 Phase 1：底部安全区（Home Indicator） */
    padding-bottom: calc(5px + env(safe-area-inset-bottom, 0px));
    /* 2026-08-28 B2：悬浮药丸条质感——思源 surface 底 + 圆角 + 柔和投影，
       替代原 border-top 直条，更贴合思源原生工具栏观感。 */
    margin: 5px 6px 2px;
    border-radius: var(--b3-border-radius, 8px);
    background: var(--b3-theme-surface, var(--b3-theme-background, #fff));
    box-shadow: var(--b3-point-shadow, 0 2px 10px rgba(0, 0, 0, 0.12));
    flex-shrink: 0;
    /* 2026-08-23 修复：与 toolbar 保持一致，z-index 需配合 position 才生效 */
    position: relative;
    /* 2026-08-24 修复：z-index 从 30 降到 1，避免压住思源原生 UI */
    z-index: 1;
    /* 2026-08-29 UI 全面优化：鼠标静止后自动淡出（Foliate 风格沉浸阅读） */
    transition: opacity var(--reword-dur-base) var(--reword-ease),
      transform var(--reword-dur-base) var(--reword-ease);
  }
  .reader-bottom-bar.chrome-hidden {
    opacity: 0;
    pointer-events: none;
    transform: translateY(6px);
  }
  @media (prefers-reduced-motion: reduce) {
    .reader-bottom-bar {
      transition: none;
    }
  }
  /* 2026-08-28：连续朗读控制条（参考 Readest 朗读体验） */
  .reader-tts-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    /* 2026-08-29 Phase 1：底部安全区（Home Indicator） */
    padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
    margin: 0 6px 6px;
    border-radius: var(--b3-border-radius, 8px);
    background: var(--b3-theme-surface, var(--b3-theme-background, #fff));
    box-shadow: var(--b3-point-shadow, 0 2px 10px rgba(0, 0, 0, 0.12));
    flex-shrink: 0;
    position: relative;
    z-index: 1;
    font-size: 13px;
  }
  .reader-tts-btn {
    min-width: 30px;
    height: 30px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
  }
  .reader-tts-play {
    font-size: 17px;
    color: var(--b3-theme-primary, #378add);
  }
  .reader-tts-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }
  .reader-tts-progress {
    flex-shrink: 0;
    color: var(--b3-theme-on-surface, #666);
    font-variant-numeric: tabular-nums;
  }
  .reader-tts-current {
    flex: 1;
    min-width: 0;
    color: var(--b3-theme-on-surface, #333);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .reader-tts-rate {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .reader-tts-rate-label,
  .reader-tts-rate-val {
    color: var(--b3-theme-on-surface, #666);
    font-size: 12px;
    white-space: nowrap;
  }
  .reader-tts-rate input[type="range"] {
    width: 84px;
  }
  .reader-progress-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    padding: 0 4px;
    position: relative; /* 章节刻度定位基准 */
  }
  /* 章节起始刻度（Foliate 风格）：位置由 JS 按 section 体积累加算出 */
  .reader-chapter-tick {
    position: absolute;
    top: 50%;
    width: 2px;
    height: 9px;
    margin-left: -1px;
    background: var(--b3-theme-on-surface-light, rgba(128, 128, 128, 0.6));
    border-radius: 1px;
    transform: translateY(-50%);
    pointer-events: none;
    opacity: 0.7;
  }
  .reader-progress-bar {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 5px;
    border-radius: 999px;
    background: linear-gradient(to right,
      var(--b3-theme-primary, #378add) 0%,
      var(--b3-theme-primary, #378add) var(--progress, 0%),
      var(--b3-theme-background-light, rgba(0, 0, 0, 0.12)) var(--progress, 0%),
      var(--b3-theme-background-light, rgba(0, 0, 0, 0.12)) 100%
    );
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04);
    cursor: pointer;
    outline: none;
  }
  /* 跨浏览器：细滑块圆点 + 主色填充（webkit / firefox） */
  .reader-progress-bar::-webkit-slider-runnable-track {
    height: 5px;
    border-radius: 999px;
    background: linear-gradient(to right,
      var(--b3-theme-primary, #378add) 0%,
      var(--b3-theme-primary, #378add) var(--progress, 0%),
      var(--b3-theme-background-light, rgba(0, 0, 0, 0.12)) var(--progress, 0%),
      var(--b3-theme-background-light, rgba(0, 0, 0, 0.12)) 100%
    );
  }
  .reader-progress-bar::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 13px;
    height: 13px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--b3-theme-primary, #378add);
    border: 2px solid var(--b3-theme-background, #fff);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  }
  .reader-progress-bar::-moz-range-track {
    height: 5px;
    border-radius: 999px;
    background: linear-gradient(to right,
      var(--b3-theme-primary, #378add) 0%,
      var(--b3-theme-primary, #378add) var(--progress, 0%),
      var(--b3-theme-background-light, rgba(0, 0, 0, 0.12)) var(--progress, 0%),
      var(--b3-theme-background-light, rgba(0, 0, 0, 0.12)) 100%
    );
  }
  .reader-progress-bar::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--b3-theme-primary, #378add);
    border: 2px solid var(--b3-theme-background, #fff);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  }
  .reader-progress-text {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    min-width: 34px;
    text-align: right;
  }

  .reader-error {
    position: absolute;
    inset: 40px 0 0 0;
    /* 2026-08-24 修复：z-index 从 100 降到 3，避免压住思源原生 UI */
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--b3-theme-error, #e24b4a);
    font-size: 13px;
  }

  /* 2026-08-26 调试 HUD：高亮渲染链路诊断 */
  .reader-debug-hud {
    position: fixed;
    bottom: 60px;
    right: 8px;
    z-index: 2147483647;
    background: rgba(0, 0, 0, 0.88);
    color: #00ff88;
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.5;
    padding: 8px 10px;
    border-radius: 6px;
    max-width: 380px;
    word-break: break-all;
    pointer-events: auto;
    box-shadow: 0 2px 12px rgba(0,0,0,0.5);
    user-select: text;
  }
  .reader-debug-hud-title {
    color: #ffcc00;
    font-weight: 700;
    margin-bottom: 4px;
    border-bottom: 1px solid rgba(255,255,255,0.15);
    padding-bottom: 3px;
  }
  .reader-debug-hud-row {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .reader-debug-hud-row b { color: #66ccff; }
</style>
