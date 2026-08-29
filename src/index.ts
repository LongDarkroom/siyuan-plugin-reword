import {
  Plugin,
  showMessage,
  Dialog,
  fetchSyncPost,
  getFrontend,
} from "siyuan";
import { DockManager, SLOT_LABELS, type DockableFeature, type DockSlot } from "./dock/dock-manager.ts";
import * as path from "path";
import * as fs from "node:fs";
import { VocabStore, ALL_BOOK_ID } from "./vocab/vocab-store.ts";
import { LearningStatus, type LearningStatus as LearningStatusT } from "./types.ts";
import { getVocabHighlighter, configureVocabHighlightDeps } from "./vocab/vocab-highlight.ts";
import { MASTERY_MAX } from "./types.ts";
import { getDueQueue, nextReviewState, isDue } from "./review/scheduler.ts";
import { calibrateFromHistory, applyCalibration } from "./review/calibrate.ts";
import { initReviewData } from "./review/review-data.ts";
import { getReviewConfig, setReviewConfig, resetReviewConfig } from "./review/config.ts";
import type { ReviewConfig, DeepPartial } from "./review/config.ts";
import type { WordRecord, VocabSort, VocabBook } from "./types.ts";
import { WordStatus } from "./types.ts";
// 2026-08-23:Console 过滤(降级 iframe sandbox 警告 + ResizeObserver loop,详见 console-filter.ts)
import { installConsoleFilter } from "./core/console-filter.ts";
import * as dictEngine from "./dict/dict-engine.ts";
import * as dictRenderer from "./dict/dict-renderer.ts";
import { maybeFillPhonetic, resetOnlinePhoneticCache } from "./dict/online-phonetic.ts";
import { fetchOnlineDict, renderOnlineDictCard, resetOnlineDictCache } from "./dict/online-dict.ts";
import type { ParsedEntry, SenseItem } from "./dict/dict-renderer.ts";
import { getWordInflections } from "./dict/inflect.ts";
import { normalizePos, parseReviewMeaning, parseWordList, isWordListLike, type ParsedWordListEntry } from "./utils/meaning-parser.ts";
// 许可证模块（2026-08-22 已封存：UI 与门禁隐藏，仅保留状态加载；模块/脚本/测试文件不动，恢复时取消注释即可）
import { initLicense, getStatus } from "./license/license.ts";
import { togglePosCollapsed } from "./dict/pos-toggle.ts";
import { AnnotationStore, WHALE_COLORS, DEFAULT_ANNOTATION_COLOR, DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from "./annotation/annotation-store.ts";
import { getAnnotationConfig, setAnnotationConfig, getAnnotationPalette, getAnnotationTagPresets, getDefaultAnnotationColor, getDefaultAnnotationStyle, initAnnotationConfig, loadAnnotationConfig } from "./annotation/annotation-config.ts";
import { READER_SHORTCUTS, NO_MODIFIER_SHORTCUTS, detectConflicts, type ShortcutSpec } from "./reader/reader-shortcuts.ts";
import { setAnnotationStore } from "./annotation/store-singleton.ts";
import { LabelStore } from "./annotation/label-store.ts";
import { markAnnotatedBlocks, clearBlockMarks } from "./annotation/block-mark.ts";
import { clearInlineMarks, applyInlineMarks } from "./annotation/inline-mark.ts";

/** 判断节点是否为思源块级 UI（图标/提示/属性），其增删不影响批注高亮内容 */
function isSiYuanBlockUi(el: Element): boolean {
  const cls = (el as HTMLElement).className;
  const clsStr = typeof cls === "string" ? cls : "";
  if (
    clsStr.includes("protyle-block__icon") ||
    clsStr.includes("protyle-block__hint") ||
    clsStr.includes("protyle-block__menu") ||
    clsStr.includes("protyle-block__resize") ||
    clsStr.includes("protyle-attr")
  ) return true;
  const dt = (el as HTMLElement).getAttribute?.("data-type");
  return dt === "block-icon" || dt === "block-menu";
}
import { buildAnnotationsMarkdown, buildVocabCsv, downloadTextFile } from "./export/download.ts";
import type { AnnotationItem } from "./annotation/annotation-store.ts";
import { queryAnnotations as queryAnns } from "./annotation/annotation-query.ts";
import type { AnnotationQueryResult } from "./annotation/annotation-query.ts";
// 微阅快速批注
import { WhaleAnnotationManager, type IWhaleHost } from "./annotation/whale-manager.ts";
import { mountAnnEditor, DEFAULT_ANN_TOOLBAR, hasBlockTable, type AnnEditor } from "./annotation/ann-editor.ts";
import { WHALE_COLOR_LIST, WHALE_LINE_STYLES } from "./annotation/whale-manager.ts";
import { confirmDelete } from "./annotation/whale-confirm.ts";
import { renderWhalePanel, renderLabelManagementDialog, renderAnnotationHTML, classifyAnnotation, type WhaleGroupMode } from "./annotation/whale-renderer.ts";
import { stripIal } from "./annotation/annotation-render.ts";
import {
  configurePreviewRegistry, setupPreviews, mountPreview, destroyPreview,
  destroyAllPreviews, disposePreviewRegistry, observeHost, unobserveHost,
  markEditing, unmarkEditing,
} from "./annotation/ann-preview.ts";
import { requestEditSession, releaseEditSession } from "./annotation/edit-session.ts";
// REword AI 精读（适配自 Achuan-2/siyuan-plugin-copilot，裁剪为最小可用对话能力）
import { DEFAULT_AI_SETTINGS, normalizeAiSettings, DEFAULT_MODELS, inferContextWindow } from "./ai/ai-settings.ts";
import type { AiSettings } from "./ai/ai-settings.ts";
import { AiPanel } from "./ai/ai-panel.ts";
import type { AiDeepReadSource, AiHost } from "./ai/ai-panel.ts";
import { runAiDeepRead } from "./ai/ai-orchestrator.ts";
import type { DeepReadWord, DeepReadSentence } from "./ai/ai-orchestrator.ts";
import { AiPresetStore, type AiPreset } from "./ai/ai-preset.ts";
import { PromptTemplateStore, type AiPromptTemplate } from "./ai/ai-prompt-templates.ts";
import { searchDocs as searchAiDocs, getDocText as getAiDocText, type AiDocSearchResult } from "./ai/ai-doc-search.ts";
import { extractDocIdFromDrag } from "./ai/drag-doc-id.ts";
import { sessionStore, type AiSessionData } from "./ai/ai-session-store.ts";
import { getBlockKramdownText as getBlockKramdown } from "./siyuan/api.ts";
import { sqlQuery } from "./siyuan/attrs.ts";
import { lsNotebooks, createDocWithMd, listDocsByPath } from "./siyuan/filetree.ts";
import "./index.less";
import { PersistentStore } from "./core/persist.ts";
import { getLogger } from "./core/logger.ts";
import { openLogViewer, exportLogsCommand } from "./core/log-viewer.ts";
// ===== 阅读器（Phase 1：书架 + EPUB/MOBI/TXT/MD 阅读；内核 foliate-js）=====
// foliate customElement 注册保护（必须在 reader 其他模块之前）—— 防止热重载重复 define 抛错阻断 plugin onload
import "./reader/foliate-shim.ts";
import { ReaderDockController, READER_FEATURE_ID } from "./reader/reader-dock.ts";
// 2026-08-24：dock 批注面板删除后广播 → 各 ReaderView 全量 reconcile 清除当前页残留高亮
import { notifyAnnotationsChanged } from "./reader/annotation-visual.ts";

// ===== Copilot 聊天（照抄自独立 copilot 插件，作为 REword 内第二个 dock）=====
import { CopilotPanel } from "./copilot/copilot/copilot-panel.ts";
import type { CopilotHost, ChatSendResult } from "./copilot/copilot/copilot-host.ts";
// [已移除] import { initCopilotSidebar } —— Copilot 对话入口已禁用（2026-08-17）
// 共享基建（生命周期 / 持久化 / 安全渲染）
import { Disposables } from "./core/disposable.ts";
import { isMobile, isSmallMobile, isLargeMobile } from "./core/env.ts";
import { responsiveDialogSize, isPhoneSize } from "./core/responsive.ts";
import { ConversationStore, type ConversationData } from "./copilot/store/conversation-store.ts";
import {
  normalizeAiSettings as normalizeCopilotSettings,
  DEFAULT_AI_SETTINGS as COPILOT_DEFAULT_AI,
} from "./copilot/ai/ai-settings.ts";
import { fetchDocumentList, fetchDocumentSearch, fetchDocContent } from "./copilot/copilot/doc-context.ts";
import {
  DEFAULT_PROMPTS_RAW as COPILOT_DEFAULT_PROMPTS,
  parsePrompts as parseCopilotPrompts,
} from "./copilot/copilot/prompt-manager.ts";
import { runChat as runCopilotChat } from "./copilot/ai/ai-orchestrator.ts";
import { buildProviders, translateWithFallback } from "./translate/engine";
import { parseNumberedTranslations, parseTranslationsPositional } from "./translate/providers/ai";
import { TranslationCache } from "./translate/cache";
import { BookPrimerStore } from "./reader/book-primer";
import type {
  AiSettings as CopilotAiSettings,
  ChatSession as CopilotSession,
  ContextDoc as CopilotDoc,
  PromptItem as CopilotPrompt,
} from "./copilot/types.ts";
import { logSwallow } from "./core/safe.ts";

const PLUGIN_NAME = "hiword-vocab";

/**
 * AI 翻译调试日志开关（2026-08-28 v1.3.0 收敛裸 console.log，避免每次翻页刷屏）。
 * true = 输出翻译链路流程日志（排查用）；false = 静默（发布默认）。
 * 异常仍走 console.warn / getLogger().warn，不受此开关影响。
 * 与 bilingual.ts 的 DEBUG_BILINGUAL 同一套约定。
 */
const DEBUG_TRANSLATE = false;
function trLog(...args: unknown[]): void {
  if (DEBUG_TRANSLATE) console.log("[REword]", ...args);
}

/**
 * 2026-08-17：内联 SVG 版图标。
 * addTopBar/addDock 传 symbol id 字符串，思源内部用 <use xlink:href="#id"> 渲染，
 * 可绕开 "Icon must be svg id or svg tag" 的 id 查找校验，同时保证多个 Dock 图标可区分。
 */
const INLINE_ICON_REWORD = `<svg viewBox="0 0 1024 1024"><g fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"><path d="M512 220c-90-46-200-58-372-46v600c172-12 282 0 372 46 90-46 200-58 372-46V174c-172-12-282 0-372 46z"/><path d="M512 220v600"/></g></svg>`;
// [已移除] INLINE_ICON_COPILOT 图标常量不再使用（Copilot 对话入口已禁用）

// 2026-08-22：Dock 管理器各功能独立图标（symbol id，addDock 传 id 字符串）
const ICON_REWORD = "iconREword";
const ICON_VOCAB = "iconREwordVocab";
const ICON_DICT = "iconREwordDict";
const ICON_ANN = "iconREwordAnn";
const ICON_AI = "iconREwordAI";
const ICON_REVIEW = "iconREwordReview";
const ICON_READER = "iconREwordReader";

/** 词典元信息 */
interface DictMeta {
  id: string;
  name: string;
  type: "mdx" | "stardict"; // 词典格式类型
  file: string;              // MDX: 相对路径如 dict/xxx.mdx；StarDict: .ifo 路径如 dict/xxx.ifo
  files?: string[];          // StarDict: 所有已保存的伴生文件路径（用于清理删除）
  builtin?: boolean;
  lang?: string;             // 语种标识：en=英文词典, zh=中文词典, auto=自动检测
}

/** 词典清单（持久化在插件数据中） */
interface DictManifest {
  active: string;            // 当前激活词典 ID（多词典模式下为首个激活 ID）
  actives?: string[];        // 多词典模式：所有已启用的词典 ID 列表
  dicts: DictMeta[];
}

/** 朗读引擎 */
type TtsEngine = "system" | "youdao" | "edge" | "auto";

/** 朗读设置（持久化在插件数据中；连续朗读与查词发音共用同一份配置） */
interface TtsSettings {
  engine: TtsEngine;       // system=仅系统语音；youdao=有道真人音；edge=Edge 云端神经音；auto=在线优先回退系统
  rate: number;            // 语速 0.5~3（系统/Edge 生效；有道忽略）
  pitch: number;           // 音高 0.5~2（仅系统语音生效）
  volume: number;          // 音量 0~1
  accent: "uk" | "us";     // 有道口音：uk=英音(type=1)，us=美音(type=2)
  preferVoiceURI?: string; // 系统语音优先 voiceURI
  interval: number;        // 句间停顿（毫秒）
  granularity: "sentence" | "word";                    // 朗读粒度：整句 / 逐词
  scope: "selection" | "section" | "book";            // 范围：选区 / 本节 / 全书
  enableHighlight: boolean;                            // 启用句子高亮
  highlightStyle: "background" | "underline" | "wave" | "outline";
  highlightColor: string;                              // 高亮颜色
  autoPage: boolean;                                   // 读完当前节自动翻页续读
  sleepTimerMin: number;                               // 睡眠定时（分钟，0=关）
}

const DEFAULT_TTS: TtsSettings = {
  engine: "system",
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  accent: "us",
  interval: 350,
  granularity: "sentence",
  scope: "book",
  enableHighlight: true,
  highlightStyle: "background",
  highlightColor: "#ffe082",
  autoPage: true,
  sleepTimerMin: 0,
};

/** 在线词典设置（2026-08-15 新增，持久化在 hiword-online.json） */
interface OnlineSettings {
  /** 是否启用在线兜底（含音标 + 完整释义，欧路网页版，免费无 API key） */
  enabled: boolean;
}

const DEFAULT_ONLINE: OnlineSettings = {
  enabled: true,
};

/** 默认词典清单：内置的示例词典（直接为 .mdx 原包，无需转换） */
const DEFAULT_MANIFEST: DictManifest = {
  active: "ecd2",
  actives: ["ecd2", "hanyu"], // 默认启用：英汉大词典(第2版) + 现代汉语词典
  dicts: [
    { id: "ncecd", name: "新世纪英汉大词典(全量)", type: "mdx", file: "dict/ncecd.mdx", builtin: true, lang: "en" },
    { id: "ecd2", name: "英汉大词典（第2版）", type: "mdx", file: "dict/ecd2.mdx", builtin: true, lang: "en" },
    { id: "hanyu", name: "现代汉语词典（第五版）", type: "mdx", file: "dict/hanyu.mdx", builtin: true, lang: "zh" },
  ],
};

/** ArrayBuffer 转 base64（用于上传词典文件） */
export default class RewordPlugin extends Plugin {
  // 字段在 onload() 中初始化，避免构造函数问题
  private vocabStore!: VocabStore;
  private vocabSort: VocabSort = "time"; // 词库排序方式：time/mastery/custom
  // 2026-08-23 注释:vocabStatusBarExpandedWords 字段在下方,初值从 localStorage 恢复(load 阶段)
  private vocabViewMaster = false; // 是否查看「单词总库」聚合视图（只读）
  private vocabPage = 0; // 词库列表分页当前页（2026-08-27 性能优化 P2）
  private readonly vocabPageSize = 50; // 单页单词卡数量；超过则分页
  private vocabDictCache = new Map<string, { phonetic: string; groups: any; inflections: any }>(); // 词典解析结果缓存（P0-a）
  private vocabDictCacheKey = ""; // 缓存对应的词典版本，切换词典时失效
  private topBarIconId!: string;
  private isReady!: boolean;
  private dockElement!: HTMLElement | null;
  private dockModel!: any;
  /** 2026-08-22 Dock 管理器：统一注册 / 布局 / 持久化 */
  private dockManager!: DockManager;
  /** 独立 Dock 的 element 映射（featureId -> 该 Dock 的根元素） */
  private standaloneElements = new Map<string, HTMLElement>();
  /** 独立 Dock 的 model 映射（featureId -> addDock 返回的 model，用于 showDock 聚焦） */
  private standaloneModels = new Map<string, any>();
  /** 阅读器（书架 + 阅读面板）控制器 */
  private readerDock!: ReaderDockController;
  /** 复习面板当前状态筛选：all/active/archived/ignored */
  private reviewStatusFilter: "all" | "active" | "archived" | "ignored" = "active";
  private dictReady!: boolean;
  private dictManifest!: DictManifest;
  /** 词典切换串行锁：避免快速连点导致多个 loadDictFile 交错、MDX 重复解析与状态残留 */
  private _dictSwitching = false;
  private ttsSettings!: TtsSettings;
  /** 在线词典设置（2026-08-15 新增） */
  private onlineSettings!: OnlineSettings;
  private _floatingPopup: HTMLElement | null = null; // 悬浮词典弹窗引用
  private _floatingPopupMousedown?: (e: MouseEvent) => void; // 弹窗外部点击关闭的全局监听
  private _floatingPopupKeydown?: (e: KeyboardEvent) => void; // 弹窗 ESC 关闭的全局监听
  private _hoverPopup: HTMLElement | null = null; // Alt+悬停取词浮窗引用
  private _hoverWord: string | null = null;       // 当前 hover 浮窗展示的词（去抖：同词不重查）
  private _hoverAltDown: boolean = false;         // Option/Alt 键是否按住
  private _hoverRaf: number = 0;                  // mousemove 节流用的 rAF 句柄
  private _hoverLastX = 0;                        // 上次识别坐标（移动阈值，避免抖动重算）
  private _hoverLastY = 0;
  private _hoverPinned = false;                   // 识别成功后固定，不再随 Alt 松开/移出而消失
  private _hoverOutsideMd?: (e: MouseEvent) => void;  // 外部点击关闭监听（需可靠移除）
  private _hoverOutsideTimer?: ReturnType<typeof setTimeout>;
  private _hoverKeydown?: (e: KeyboardEvent) => void;  // Esc 关闭监听
  // 收藏分类浮窗（从查词弹窗内唤起）状态：用于协调释义窗口的关闭/ESC 逻辑，避免两者互相抢占
  private _vocabPickOpen: boolean = false;
  private _vocabPickEl: HTMLElement | null = null;
  private _vocabPickMd?: (e: MouseEvent) => void;
  private _vocabPickKeydown?: (e: KeyboardEvent) => void;
  private pluginPath: string = ""; // 插件目录绝对路径（onload 时从 this.path 取）
  private fontSize: "small" | "medium" | "large" | "xlarge" = "medium"; // 字体大小设置
  private _sysVoices: SpeechSynthesisVoice[] = []; // 系统语音列表缓存（修复 Chrome 首读为空）
  private annotationStore!: AnnotationStore; // 批注数据层（方案 C：独立存储，正文零污染）

  // ===== 列表朗读状态 =====
  private _listReading: boolean = false;     // 是否正在列表朗读
  private _listPaused: boolean = false;      // 是否暂停
  private _listReadIndex: number = 0;        // 当前读到第几个词（0-based）
  private _listReadWords: string[] = [];      // 当前待读单词列表
  private _listReadTimer: ReturnType<typeof setTimeout> | null = null;
  private _listReadAbort: AbortController | null = null;
  private currentRootId: string = ""; // 当前文档根 ID（switch-protyle 时刷新用）
  private annObserver?: MutationObserver; // 块级标记用的 DOM 变更观察器（#23）
  /** 生命周期托管：统一释放全局监听 / observer / timer（根因修复 #1/#3/#4） */
  private disposables = new Disposables();
  private aiSettings!: AiSettings;       // AI 精读设置（persist: hiword-ai.json）
  private aiPanel?: AiPanel;             // AI 精读 dock 面板控制器
  private translationCache!: TranslationCache; // 双语翻译按书缓存（persist: translations/<bookId>.json）
  /** 本书前提上下文（persist: book-primers.json）——用户手写的背景/人物/译法，注入翻译 prompt */
  private bookPrimerStore!: BookPrimerStore;
  /** 供 UI（阅读器设置面板）读写本书上下文 */
  get bookPrimer() { return this.bookPrimerStore; }
  /** 最近一次双语翻译的累计 token 用量（UI 层读取展示用） */
  private _lastTranslationUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;
  /** 读取最近一次翻译的 token 用量（null 表示无数据 / 未走 AI） */
  get lastTranslationUsage() { return this._lastTranslationUsage; }
  /** 按书累计的 AI token 用量（persist: book-token-usage.json） */
  private bookTokenUsage: Record<string, { total: number; prompt: number; completion: number }> = {};
  /** token 统计持久化键 */
  private static readonly TOKEN_USAGE_KEY = "book-token-usage.json";

  // ===== Copilot 聊天（照抄 copilot 插件，独立第二个 dock）=====
  private copilotConvo!: ConversationStore; // 会话历史存储
  private copilotAi!: CopilotAiSettings;    // Copilot AI 设置（persist: copilot-ai.json）
  private copilotPromptRaw: string = COPILOT_DEFAULT_PROMPTS; // 提示词预设（逗号分隔）
  private copilotConfig: { enableContext: boolean; enablePrompts: boolean; autoTitle: boolean } = {
    enableContext: true,
    enablePrompts: true,
    autoTitle: true,
  };
  private copilotPanel?: CopilotPanel;       // Copilot 面板控制器（入口已禁用，仅保留实例）
  private lastDeepReadBlockId?: string;  // 最近一次精读来源块（句子批注落点）
  private lastDeepReadDocId?: string;    // 最近一次精读来源文档
  private whaleManager?: WhaleAnnotationManager; // 微阅快速批注管理器
  /** v4：行内标记施加期间置 true，供 observer 短路避免自身修改递归 */
  private suppressMarkRefresh = false;
  /** v4：失焦后补施加行内标记的防抖 timer */
  private inlineMarkTimer?: ReturnType<typeof setTimeout>;
  /** 块文本快照（blockId → textContent），用于跳过未变更块、避免每次刷新全量重标（P1 性能 #11） */
  private blockTextSnapshot = new Map<string, string>();
  /** 是否处于输入法合成（IME）中，用于保护正在输入块不被行内重标打断（修复聚焦/输入闪烁） */
  private isComposing = false;
  /** 防抖持久化层（P1 #7/#8：高频变更合并落盘 + 失败重试并上报） */
  private persistVocab!: PersistentStore;
  private persistAnnotations!: PersistentStore;
  private persistConvo!: PersistentStore;
  /** 词库分类标签库（2026-08-15 拆分：hiword-vocab-labels.json，与批注标签各自独立管理） */
  private persistVocabLabels!: PersistentStore;
  private vocabLabelStore!: LabelStore;
  /** 批注分类标签库（2026-08-15 拆分：hiword-annotation-labels.json，与词库标签各自独立） */
  private persistAnnotationLabels!: PersistentStore;
  private annotationLabelStore!: LabelStore;
  /** AI 预设（hiword-ai-presets.json）与提示词模板（hiword-ai-prompts.json） */
  private persistAiPresets!: PersistentStore;
  private persistAiPrompts!: PersistentStore;
  private aiPresetStore!: AiPresetStore;
  private promptTemplateStore!: PromptTemplateStore;
  /** 词库标签横切筛选（2026-08-14 新增：all=全部） */
  private vocabLabelFilter = "all";
  // 2026-08-23 新增 / 2026-08-23 改：词库面板状态条(未掌握/已掌握/需复习/清除)按单词独立收起态。
  // - 默认每个单词的状态条都收起(用户主动展开想看的那些)
  // - 用户点 chevron 单独展开/收起该单词,不影响其他单词
  // - 持久化到 localStorage:reword-vocab-status-expanded (JSON 数组)
  // 根因:之前用全局 boolean 时,点一个全展开,与用户意图"独立控制"不符
  private vocabStatusBarExpandedWords: Set<string> = new Set();
  /** 批注面板标签筛选（2026-08-15 改造：基于 labelStore 自定义标签，"all"=全部） */
  private currentLabel: string = "all";
  /** 2026-08-15 新增：批注/词库面板标签筛选区收起状态（持久化 localStorage） */
  private whaleTagsCollapsed = false;
  private vocabTagsCollapsed = false;
  /** 词库驱动文档高亮总开关(词库面板控制);默认开 */
  private vocabAutoHighlight = true;
  /** 批注面板排序模式（2026-08-15 新增）：time=时间排序 / doc=按文档筛选 / style=按样式筛选 */
  private whaleSortMode: "time" | "doc" | "style" = "time";
  /** 时间排序方向：desc 默认（从新到旧）/ asc（从旧到新） */
  private whaleSortTimeDir: "desc" | "asc" = "desc";
  /** 当前选中的文档（docId），null=不按文档筛选 */
  private whaleSortDoc: string | null = null;
  /** 当前选中的样式组合列表，每项格式 "colorValue|styleKey" */
  private whaleSortStyles: string[] = [];
  /** 2026-08-17 新增：批注面板列表分组方式（time=按时间分组 / doc=按文档分组，默认时间，持久化） */
  private whaleGroupMode: WhaleGroupMode = "time";
  /** v4：全局 dragstart 记录的源块 ID（拖入 AI 面板用，60s 内有效、消费即清） */
  private draggingBlockId: { id: string; ts: number } | null = null;
  /** v5：dragstart 时记录的选中文本（作为块 ID 检测失败时的回退内容） */
  private draggingBlockText: string | null = null;
  /** v6：最近一次有效选区缓存（仅文档 .protyle-wysiwyg 内非空选中）。
   *  根因修复「点击/聚焦面板后选区丢失，导致 getDeepReadSource 取不到文本」的设计断点。 */
  private lastSelectionCache: { text: string; blockId?: string; docId?: string; sentence?: string } | null = null;
  /** 内联批注点击浮层元素引用（点击高亮文字时弹出） */
  private inlinePopoverEl: HTMLElement | null = null;
  /** 内联浮层内批注 note 的原生 Protyle 只读预览实例（随浮层销毁） */
  private popNotePreview: AnnEditor | null = null;

  async onload() {
    getLogger().info("[REword] 插件加载中... (build=2026-08-21-A3-page-v3)");

    // 记录插件目录绝对路径：先取 SiYuan 基类的 this.path，再用确定性探测纠正
    // （SiYuan 运行时 __dirname 可能指向 electron.asar/renderer，this.path 版本间也可能不同）
    this.pluginPath = (this as any).path || "";
    this.pluginPath = this.resolvePluginPath();
    getLogger().info("[REword] 插件目录探测结果:" + this.pluginPath);

    // ========== 0.0 初始化运行日志系统（记录每次操作过程/结果，捕获报错位置与内容）==========
    try {
      const logBase = (this as any).path
        ? path.join((this as any).path, "logs")
        : path.join(this.pluginPath, "logs");
      getLogger().configure({ baseDir: logBase });
      getLogger().installGlobalCapture();
      getLogger().info("插件加载开始", { operation: "插件生命周期", data: { path: this.pluginPath } });
    } catch (e) {
      getLogger().error("[REword] 日志系统初始化失败（不影响主功能）:", { error: e });
    }

    // 2026-08-23:安装 console + window.onerror 过滤(降级 iframe sandbox 警告 + ResizeObserver loop
    // 异常,让真实错误可见)。在 logger 初始化后立即调用,幂等。
    try { installConsoleFilter(); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · onload", "debug"); }

    // ========== 0. 注册自定义图标（必须在 addTopBar/addDock 之前）==========
    // 关键修复（2026-08-17）：原先把 5 个 <symbol> 拼成一条字符串传给 addIcons，
    // 其中 copilotIcon 带 xmlns="http://www.w3.org/2000/svg" 导致整串解析失败、
    // 全部图标未注册；后续 addDock({icon:"copilotIcon"}) 因找不到图标抛出
    // "Icon must be svg id or svg tag"，直接中断 onload —— 所有 UI 改动都不生效。
    // 改为：每个 symbol 单独 addIcons，互不牵连；并去掉 copilotIcon 的 xmlns，
    // 与其它 symbol 保持一致的纯 viewBox 写法。
    const rewordIconSymbols = [
      // 主图标 / 组合栏（容器，承载全部功能）：打开的书
      `<symbol id="iconREword" viewBox="0 0 1024 1024"><g fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"><path d="M512 220c-90-46-200-58-372-46v600c172-12 282 0 372 46 90-46 200-58 372-46V174c-172-12-282 0-372 46z"/><path d="M512 220v600"/></g></symbol>`,
      // 词库：单词卡（圆角卡片 + 三行文字线）—— 与书本 / 放大镜明显区分
      `<symbol id="iconREwordVocab" viewBox="0 0 1024 1024"><g fill="none" stroke="currentColor" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"><rect x="256" y="224" width="512" height="576" rx="56"/><path d="M352 352h320"/><path d="M352 480h320"/><path d="M352 608h208"/></g></symbol>`,
      // 查词典：放大镜（圆圈 + 手柄）—— 语义明确「查询」
      `<symbol id="iconREwordDict" viewBox="0 0 1024 1024"><g fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"><circle cx="448" cy="448" r="240"/><path d="M624 624L840 840"/></g></symbol>`,
      // 新增词条：加号圆（保留）
      `<symbol id="iconREwordAdd" viewBox="0 0 1024 1024"><g fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"><circle cx="512" cy="512" r="392"/><path d="M512 312v400M312 512h400"/></g></symbol>`,
      // 微阅批注：居中短尾对话气泡（方正外形 + 两行文字）—— 修复侧边栏小尺寸下尾巴被裁切/挤压变形
      `<symbol id="iconREwordAnn" viewBox="0 0 1024 1024"><g fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"><rect x="224" y="224" width="576" height="448" rx="64"/><path d="M384 672l-80 128v-128H224a64 64 0 01-64-64V288a64 64 0 0164-64h576a64 64 0 0164 64v320a64 64 0 01-64 64H384z"/><path d="M352 416h320"/><path d="M352 544h224"/></g></symbol>`,
      // AI 精读：四角星（sparkle，通用 AI 符号）+ 小点缀 —— 替代原机器人头，避免渲染异常且辨识度高
      `<symbol id="iconREwordAI" viewBox="0 0 1024 1024"><g fill="none" stroke="currentColor" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"><path d="M512 192c24 160 96 232 256 256-160 24-232 96-256 256-24-160-96-232-256-256 160-24 232-96 256-256z"/><circle cx="768" cy="768" r="40"/></g></symbol>`,
      // 复习：循环箭头（保留）
      `<symbol id="iconREwordReview" viewBox="0 0 1024 1024"><g fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"><path d="M320 320a256 256 0 01562 56"/><path d="M882 376v-96h-96"/><path d="M704 704a256 256 0 01-562-56"/><path d="M142 648v96h96"/></g></symbol>`,
      // 阅读器：展开的书页 + 书签尾（区别于主图标「合拢的书」）
      `<symbol id="iconREwordReader" viewBox="0 0 1024 1024"><g fill="none" stroke="currentColor" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"><path d="M192 256c128-64 256-80 384-48v560c-128-32-256-16-384 48z"/><path d="M832 256c-128-64-256-80-384-48v560c128-32 256-16 384 48z"/><path d="M512 208v560"/></g></symbol>`,
      `<symbol id="copilotIcon" viewBox="0 0 24 24" fill="none"><path d="M12 3a7 7 0 00-4 12.7V18a1 1 0 001 1h6a1 1 0 001-1v-2.3A7 7 0 0012 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 21h6M10 18v3M14 18v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></symbol>`,
    ];
    let iconsOk = 0;
    for (const sym of rewordIconSymbols) {
      try {
        this.addIcons(sym);
        iconsOk++;
      } catch (e) {
        getLogger().warn("[REword] 单个图标注册失败（不影响其它图标）:", { error: e });
      }
    }
    getLogger().info(`[REword] 自定义图标注册完成 ${iconsOk}/${rewordIconSymbols.length}`);

    // ========== 0.1 预热系统语音列表（修复 Chrome 下 getVoices() 首次为空）==========
    try {
      this.warmupSystemVoices();
    } catch (e) {
      getLogger().warn("[REword] 系统语音预热失败（将回退在线真人音）:", { error: e });
    }

    // ========== 1. 最优先注册顶栏图标（确保插件可见）==========
    // 图标万一仍未注册（如 addIcons 在该版本异常），回退内置图标避免 onload 中断。
    try {
      this.topBarIconId = this.addTopBar({
        icon: ICON_REWORD,
        title: "RE word",
        position: "right",
        callback: () => {
          this.showVocabDialog();
        },
      }) as unknown as string;
      getLogger().info("[REword] 顶栏注册成功, id=" + this.topBarIconId);
    } catch (e) {
      getLogger().error("[REword] 顶栏注册失败（回退内置图标）:", { error: e });
      try {
        this.topBarIconId = this.addTopBar({
          icon: "iconFile",
          title: "RE word",
          position: "right",
          callback: () => { this.showVocabDialog(); },
        }) as unknown as string;
      } catch (e2) {
        getLogger().error("[REword] 顶栏回退注册仍失败:", { error: e2 });
      }
    }

    // ========== 1. 初始化字段（容错）==========
    try {
      this.isReady = false;
      this.dockElement = null;
      this.dockModel = null;
      this.dictReady = false;
      // 防抖持久化层（P1 #7/#8）：高频变更合并为一次落盘，失败指数退避重试并上报
      this.persistVocab = new PersistentStore(
        (d) => this.saveData("hiword-vocab.json", d),
        { onError: () => showMessage("词库保存失败，请检查存储空间", 3000, "error") }
      );
      this.persistAnnotations = new PersistentStore(
        (d) => this.saveData("hiword-annotations.json", d),
        { onError: () => showMessage("批注保存失败，请检查存储空间", 3000, "error") }
      );
      this.persistConvo = new PersistentStore(
        (d) => this.saveData("copilot-conversations.json", d),
        { onError: () => showMessage("对话保存失败，请检查存储空间", 3000, "error") }
      );
      this.persistVocabLabels = new PersistentStore(
        (d) => this.saveData("hiword-vocab-labels.json", d),
        { onError: () => showMessage("词库标签保存失败，请检查存储空间", 3000, "error") }
      );
      this.persistAnnotationLabels = new PersistentStore(
        (d) => this.saveData("hiword-annotation-labels.json", d),
        { onError: () => showMessage("批注标签保存失败，请检查存储空间", 3000, "error") }
      );
      this.persistAiPresets = new PersistentStore(
        (d) => this.saveData("hiword-ai-presets.json", d),
        { onError: () => showMessage("预设保存失败，请检查存储空间", 3000, "error") }
      );
      this.persistAiPrompts = new PersistentStore(
        (d) => this.saveData("hiword-ai-prompts.json", d),
        { onError: () => showMessage("提示词模板保存失败，请检查存储空间", 3000, "error") }
      );
      this.vocabStore = new VocabStore(() => this.saveVocab());
      this.annotationStore = new AnnotationStore(() => this.saveAnnotations());
      setAnnotationStore(this.annotationStore); // Phase 2：暴露单例供阅读面板访问
      this.vocabLabelStore = new LabelStore(() => this.persistVocabLabels.update(this.vocabLabelStore.toJSON()));
      this.annotationLabelStore = new LabelStore(() => this.persistAnnotationLabels.update(this.annotationLabelStore.toJSON()));
      this.aiPresetStore = new AiPresetStore(() => this.persistAiPresets.update(this.aiPresetStore.export()));
      this.promptTemplateStore = new PromptTemplateStore(() => this.persistAiPrompts.update(this.promptTemplateStore.export()));
      this.aiSettings = { ...DEFAULT_AI_SETTINGS };
      // 2026-08-28：缓存 hash 拼入当前翻译提示词（salt），提示词改版后旧译文自动失效
      this.translationCache = new TranslationCache(
        this,
        () => this.aiSettings?.translatePrompt || DEFAULT_AI_SETTINGS.translatePrompt
      );
      // 2026-08-28 v1.3.0：本书前提上下文（用户手写的背景/人物/译法，注入翻译 prompt）
      this.bookPrimerStore = new BookPrimerStore(this);
      this.bookPrimerStore.load().catch(() => {
        /* 加载失败则保持空表，不影响翻译主流程 */
      });
      this.loadBookTokenUsage().catch(() => {
        /* 统计加载失败归零即可 */
      });
    } catch (e) {
      getLogger().error("[REword] 字段初始化失败:", { error: e });
    }

    // ========== 0.9 初始化离线许可证模块（2026-08-22 已封存：仅加载内存状态，不提供 UI 与门禁）==========
    try {
      await initLicense({
        load: (k) => this.loadData(k),
        save: (k, v) => this.saveData(k, v),
      });
      getLogger().info("[REword] 许可证模块初始化完成, 状态=" + JSON.stringify(getStatus()));
    } catch (e) {
      getLogger().error("[REword] 许可证模块初始化失败（不影响主功能）:", { error: e });
    }

    // ========== 1.1 全局拖拽源块记录（拖入 AI 面板保留样式用，v5）==========
    // 思源 Protyle 拖拽文本块时可能 stopPropagation，故用 capture 阶段拦截
    // 同时记录 dataTransfer.types 以便 drop 时回溯
    this.disposables.addEventListener(document, "dragstart", (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-node-id]") as HTMLElement | null;
      const id = el?.dataset?.nodeId;
      // 思源块 ID 格式：YYYYMMDDHHmmss-xxxxxx，保留原始连字符（思源 API 不识别去连字符格式）
      if (id && /^[a-z0-9-]{14,}$/i.test(id)) {
        this.draggingBlockId = { id, ts: Date.now() };
        getLogger().info("[REword] dragstart 捕获块 ID:" + id);
      } else {
        this.draggingBlockId = null;
      }
      // 始终记录选中文本作为回退（无论是否找到块 ID）
      const selection = window.getSelection();
      const selText = selection?.toString() || "";
      if (selText) {
        this.draggingBlockText = selText;
        getLogger().info("[REword] dragstart 选中文本:" + selText.slice(0, 100));
      } else {
        this.draggingBlockText = null;
      }
      // 调试：打印 dataTransfer.types
      const dt = (e as DragEvent).dataTransfer;
      if (dt) {
        getLogger().info("[REword] dragstart types:" + [...dt.types]);
      }
    }, true); // capture 阶段
    this.disposables.addEventListener(document, "dragend", () => {
      getLogger().info("[REword] dragend，清理拖拽状态");
      this.draggingBlockId = null;
      this.draggingBlockText = null;
    }, true);

    // ========== 1.2 选区缓存（修复「点击面板后选区丢失」设计断点，v6）==========
    // 用户在 SiYuan 文档中选中非空文本时即时缓存；选区随后被点击/聚焦面板折叠也不影响。
    // 仅缓存位于 .protyle-wysiwyg 内的选区（排除面板自身 contenteditable 输入框），避免误覆盖。
    this.disposables.addEventListener(document, "selectionchange", () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const node = sel.getRangeAt(0).startContainer;
      const el = node.nodeType === 3 ? node.parentElement : (node as Element | null);
      if (!el?.closest(".protyle-wysiwyg")) return; // 仅文档内选区才缓存
      const text = this.getSelectionTextPrecise();
      if (!text) return;
      const blockId = this.getSelectionBlockId();
      const docId = this.getSelectionDocId(blockId) || this.currentRootId || undefined;
      // 2026-08-17：实时选区可用时一并缓存句子上下文，
      // 避免随后点击弹窗导致选区折叠后 sentence 退化为选中词。
      const sentence = this.extractContextSentence() || text;
      this.lastSelectionCache = { text, blockId, docId, sentence };
    });

    // ========== 1.3 Alt(Option)+悬停取词浮窗（容错）==========
    try { this.initHoverLookup(); } catch (e) { getLogger().error("悬停取词初始化失败", { operation: "初始化-悬停取词", error: e }); }

    // ========== 2. 注册 UI（全部容错，单步失败不影响其他）==========
    // 2.0 初始化 Dock 管理器（多 Dock 布局：组合栏 + 可提取独立 Dock）
    try {
      this.dockManager = new DockManager(this);
      const dockFeatures: DockableFeature[] = [
        { id: "vocab", title: "词库", icon: ICON_VOCAB, defaultSlot: "combined" },
        { id: "dict", title: "查词典", icon: ICON_DICT, defaultSlot: "combined" },
        { id: "annotations", title: "微阅批注", icon: ICON_ANN, defaultSlot: "combined" },
        { id: "ai", title: "AI 精读", icon: ICON_AI, defaultSlot: "combined" },
        { id: "review", title: "复习", icon: ICON_REVIEW, defaultSlot: "combined" },
        { id: READER_FEATURE_ID, title: "阅读器", icon: ICON_READER, defaultSlot: "combined" },
      ];
      for (const f of dockFeatures) this.dockManager.registerFeature(f);
      // 一次性迁移：将面板布局重置为「全部收入组合栏」的干净状态（消除旧布局残留的独立 Dock 杂乱）
      try { await this.migrateDockLayoutOnce(); } catch (e) { getLogger().warn("[REword] 面板布局迁移失败", { error: e }); }
      await this.dockManager.load();
    } catch (e) {
      getLogger().error("[REword] Dock 管理器初始化失败（回退单 Dock）", { operation: "初始化-Dock管理器", error: e });
      this.dockManager = new DockManager(this);
    }
    // 2026-08-22：一次性清理旧 Dock 缓存（修复旧图标/位置被 localStorage「local-plugin-docks」覆盖导致不生效）
    try { await this.clearStaleDockCache(); } catch (e) { getLogger().warn("[REword] 清理 Dock 缓存失败", { error: e }); }
    try { this.initDockPanels(); } catch (e) { getLogger().error("侧边栏注册失败", { operation: "初始化-侧边栏", error: e }); }
    // Copilot 聊天 dock（照抄 copilot 插件，作为第二个 dock 引入）
    try { await this.initCopilot(); } catch (e) { getLogger().error("Copilot 初始化失败", { operation: "初始化-Copilot", error: e }); }
    // 阅读器（书架索引加载；面板随 dock 渲染按需初始化）
    try {
      this.readerDock = new ReaderDockController(this);
      await this.readerDock.init();
    } catch (e) {
      getLogger().warn("[REword] 阅读器初始化失败（阅读器面板将不可用）", { error: e });
    }
    try { await this.initDictionary(); } catch (e) { getLogger().error("词典引擎初始化失败", { operation: "初始化-词典", error: e }); }
    // 词典就绪后按当前激活 Tab 刷新（避免覆盖非词库 Tab 的内容）
    if (this.dictReady) {
      this.refreshActivePanel();
    }
    try { this.ttsSettings = await this.loadTtsSettings(); } catch (e) { this.ttsSettings = { ...DEFAULT_TTS }; }
    try { this.onlineSettings = await this.loadOnlineSettings(); } catch (e) { this.onlineSettings = { ...DEFAULT_ONLINE }; }
    try { this.fontSize = await this.loadFontSize(); } catch (e) { this.fontSize = "medium"; }
    // 应用字体大小到侧边栏
    this.applyFontSize();
    // 工具栏查词按钮通过重写 updateProtyleToolbar 注入（框架渲染浮动工具栏时自动回调），无需在此注册

    // ========== 3. 注册命令（容错）==========
    const commands = [
      { langKey: "addWord", langText: "RE word: 添加选中单词到词库", cb: () => this.addSelectedWord() },
      { langKey: "showVocab", langText: "RE word: 显示词库列表", cb: () => this.showVocabDialog() },
      { langKey: "lookupDict", langText: "RE word: 查词典（选中单词）", cb: () => this.lookupSelectedWord() },
      { langKey: "quickLookup", langText: "RE word: 选中文本一键填入侧边栏查词", hotkey: "⌥⌘L", cb: () => this.fillSelectionToSidebar() },
      { langKey: "extractWords", langText: "RE word: 框选提取单词到词库", hotkey: "⌥⌘E", cb: () => this.extractWordsFromSelection() },
      { langKey: "aiDeepRead", langText: "RE word: AI 精读（当前块/选区）", hotkey: "⌥⌘A", cb: () => this.showAiPanel() },
      { langKey: "aiSettings", langText: "RE word: AI 设置", cb: () => this.openAiSettings() },
      { langKey: "openDictManager", langText: "RE word: 词典管理（添加离线词典）", cb: () => this.openDictManager() },
      { langKey: "exportVocab", langText: "RE word: 导出词库为 CSV", cb: () => this.exportVocabCSV() },
      { langKey: "pruneOrphanAnn", langText: "RE word: 清理失效批注（来源块已删除）", cb: () => this.pruneOrphanAnnotations() },
      { langKey: "startReview", langText: "RE word: 开始复习（自研 SRS）", cb: () => this.startReviewSession() },
      { langKey: "calibrateReview", langText: "RE word: 校准复习算法（基于历史）", cb: () => this.calibrateReview() },
      { langKey: "restoreReviewWords", langText: "RE word: 恢复被忽略/归档的单词", cb: () => this.restoreReviewWords() },
      { langKey: "resetReviewConfig", langText: "RE word: 重置复习算法配置（恢复默认）", cb: () => this.resetReviewConfigCmd() },
    ];
    for (const c of commands) {
      try {
        // 用日志包裹每个命令回调：自动记录「操作开始 / 完成（含耗时）/ 失败（含错误位置与内容）」
        const wrapped = () => {
          const r = (c.cb as () => unknown)();
          if (r && typeof (r as any).then === "function") {
            return getLogger().operation(c.langText, () => r as Promise<unknown>);
          }
          return getLogger().operationSync(c.langText, () => r as unknown);
        };
        this.addCommand({ langKey: c.langKey, langText: c.langText, hotkey: "", callback: wrapped });
      } catch (e) {
        getLogger().error(`命令注册失败 (${c.langKey})`, { operation: "初始化-命令", error: e });
      }
    }

    // ========== 3.1 日志相关命令（查看 / 导出运行日志）==========
    try {
      this.addCommand({
        langKey: "viewLogs",
        langText: "RE word: 查看运行日志",
        hotkey: "",
        callback: () => openLogViewer(),
      });
      this.addCommand({
        langKey: "exportLogs",
        langText: "RE word: 导出运行日志（文件+剪贴板）",
        hotkey: "",
        callback: () => { void exportLogsCommand(); },
      });
    } catch (e) {
      getLogger().error("日志命令注册失败", { operation: "初始化-命令", error: e });
    }

    // ========== 4. 容错初始化词库（失败不影响 UI）==========
    // 4.0 先加载持久化的复习校准配置，再注入 AWL/词频数据（让难度计算能用到），随后初始化词库并回填难度
    try { this.loadReviewConfig(); } catch (e) { getLogger().warn("[REword] 复习配置加载失败（用默认）:", { error: e }); }
    // 4.1 加载标注默认配置（默认颜色/线型/调色板/标签预设），供设置面板与新建批注统一读取
    try { initAnnotationConfig(this); await loadAnnotationConfig(); } catch (e) { getLogger().warn("[REword] 标注配置加载失败（用默认）:", { error: e }); }
    try { initReviewData(); } catch (e) { getLogger().warn("[REword] 复习数据注入失败:", { error: e }); }
    // 2026-08-23:从 fire-and-forget 改为 await + try/catch,确保 vocabStore.load() 完成后
    // 才进入后续步骤(避免初始化竞态窗口内空数据被 persist 写盘覆盖磁盘)。
    // 注意:vocabStore 内部也有 loaded 守卫(双保险),即便此 await 未起作用也不会丢数据。
    try {
      await this.initVocabStore();
    } catch (err) {
      getLogger().error("词库初始化失败（收词功能暂不可用，查词仍可用）", { operation: "初始化-词库", error: err });
    }

    // ========== 4.01 初始化分类标签库（2026-08-15 拆分：词库标签 / 批注标签 各自独立）==========
    this.initLabelStores().catch((err) => {
      getLogger().error("标签库初始化失败（标签暂不可用）", { operation: "初始化-标签库", error: err });
    });

    // ========== 4.1 初始化批注数据层（方案 C，独立于词库）==========
    this.initAnnotationStore().catch((err) => {
      getLogger().error("批注数据层初始化失败（批注功能暂不可用）", { operation: "初始化-批注", error: err });
    });

    // ========== 4.2 初始化 AI 精读设置（独立于词库/批注）==========
    this.initAiSettings().catch((err) => {
      getLogger().error("AI 设置初始化失败（AI 精读暂不可用）", { operation: "初始化-AI设置", error: err });
    });

    // 事件监听（统一经 Disposables 托管，onunload 逆序释放，根因修复 #1/#4）
    this.disposables.addEventBus(
      () => this.eventBus.on("switch-protyle", this.onSwitchProtyle),
      () => this.eventBus.off("switch-protyle", this.onSwitchProtyle)
    );

    // 编辑器右键菜单：选中文本时追加「REword → 发送到 AI 分析」入口
    this.disposables.addEventBus(
      () => this.eventBus.on("open-menu-content", this.onOpenContentMenu),
      () => this.eventBus.off("open-menu-content", this.onOpenContentMenu)
    );

    // 2026-08-29：阅读器深链（siyuan://plugins/siyuan-plugin-rewordreader?data={…}）
    // 摘录插入思源文档后，点「回原文」即回到书里对应位置
    this.disposables.addEventBus(
      () => this.eventBus.on("open-siyuan-url-plugin", this.onOpenBookUrl as any),
      () => this.eventBus.off("open-siyuan-url-plugin", this.onOpenBookUrl as any)
    );

    // 初始文档兜底：onload 收尾后建立观察器并刷新一次（此时数据层通常已就绪）
    const initTimer = setTimeout(() => {
      this.ensureAnnotationObserver();
      this.applyAnnotationBlockMarks();
    }, 320);
    this.disposables.addTimer(initTimer);

    // 2026-08-22 词库驱动文档高亮：注入 store 依赖并启动观察器
    // 注意：必须在 vocabStore 已赋值之后（onload 段尾 4.2.1）
    configureVocabHighlightDeps({
      getAllWords: () => this.vocabStore.getAllWords(),
      onLearningStatusChange: (cb) => this.vocabStore.onLearningStatusChange(cb),
    });
    const vocabInitTimer = setTimeout(() => {
      const wysiwyg = document.querySelector(".protyle-wysiwyg") as HTMLElement | null;
      if (wysiwyg) {
        const hl = getVocabHighlighter();
        hl.start(wysiwyg);
        // 按开关状态启用/暂停高亮(关闭时不扫、不显示)
        hl.setEnabled(this.vocabAutoHighlight);
        hl.refreshAll();
      }
    }, 480);
    this.disposables.addTimer(vocabInitTimer);

    // 正文内联批注点击浮层（查看/编辑/定位/删除）
    this.bindInlineAnnotationClick();

    // IME 合成状态跟踪：输入中文等时保护光标所在块不被行内重标打断（修复聚焦/输入闪烁）
    this.disposables.addEventListener(document, "compositionstart", () => { this.isComposing = true; });
    this.disposables.addEventListener(document, "compositionend", () => {
      this.isComposing = false;
      this.scheduleInlineMarksAfterFocusLoss();
    });

    // 阅读器标注变更→侧边栏刷新：监听阅读器派发的事件。
    // 2026-08-27 修复（Tab 覆盖）：原实现无差别 renderAnnotationsPanel 会把当前正显示的
    // 词库 / AI 精读等 Tab 内容直接覆盖成微阅批注面板。改为 renderDockIfTab：
    // 仅批注 Tab 激活时刷新，否则标记脏、切回该 Tab 时由 tab handler 重渲染。
    this.disposables.addEventListener(window, "reword:annotation-store-changed", () => {
      this.renderDockIfTab("annotations");
    });
  }

  /** 持久化词库 */
  private async saveVocab() {
    this.persistVocab.update(this.vocabStore.export());
  }

  // ========== 复习算法配置（ReviewConfig）持久化 ==========
  /** 加载持久化的复习校准配置（不存在则保持默认）。在注入词频/AWL 数据之前调用。 */
  private async loadReviewConfig(): Promise<void> {
    const raw = await this.loadData("hiword-review-config.json").catch(() => null);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      setReviewConfig(raw as DeepPartial<ReviewConfig>);
    }
  }
  /** 持久化当前复习配置（用于校准后落盘） */
  private async saveReviewConfig(): Promise<void> {
    await this.saveData("hiword-review-config.json", getReviewConfig());
  }
  /** 命令：重置复习算法配置到默认初值 */
  private resetReviewConfigCmd(): void {
    resetReviewConfig();
    void this.saveReviewConfig();
    showMessage("复习算法配置已恢复默认", 2200, "success" as any);
  }

  /**
   * 命令：基于复习历史回拟合间隔倍率与难度修正系数（calibrate.ts）。
   * 历史不足时提示先积累；否则应用校准结果并落盘 hiword-review-config.json。
   */
  private calibrateReview(): void {
    if (!this.vocabStore) { showMessage("词库尚未就绪", 2000, "info"); return; }
    const events = this.vocabStore.getReviewEvents();
    if (events.length < 9) {
      showMessage(`复习历史不足（${events.length} 条，需 ≥9 才能校准）；先多用一阵复习功能再回来校准`, 2800, "info");
      return;
    }
    const res = calibrateFromHistory(events, { targetRetention: 0.9 });
    applyCalibration(res);
    void this.saveReviewConfig();
    const summary = [
      `样本量：${res.eventsUsed} 条`,
      `目标留存：${(res.targetRetention * 100).toFixed(0)}%`,
      ...res.notes,
    ].join("\n");
    new Dialog({
      title: "复习算法校准结果",
      width: responsiveDialogSize(440, "width"),
      content: `<div class="hiword-review-cfg">
        <pre class="hiword-review-cfg__pre">${this.escapeHtml(summary)}</pre>
        <div class="hiword-review-cfg__hint">已写入 hiword-review-config.json 并立即生效。重置入口：RE word: 重置复习算法配置</div>
      </div>`,
    });
  }

  /**
   * 命令：恢复被忽略/归档的单词。列出 archived + ignored 单词，可逐个或全部恢复为 active。
   */
  private restoreReviewWords(): void {
    if (!this.vocabStore) { showMessage("词库尚未就绪", 2000, "info"); return; }
    const list = [
      ...this.vocabStore.getWordsByStatus(WordStatus.Archived),
      ...this.vocabStore.getWordsByStatus(WordStatus.Ignored),
    ];
    if (list.length === 0) { showMessage("没有需要恢复的单词（忽略/归档列表为空）", 2200, "info"); return; }

    const rows = list
      .map(
        (r) => `<div class="hiword-restore-row" data-word="${this.escapeHtml(r.word)}">
          <span class="hiword-restore-word">${this.escapeHtml(r.word)}</span>
          <span class="hiword-restore-tag">${r.status === "archived" ? "已归档" : "已忽略"}</span>
          <button class="b3-button b3-button--small" data-action="restore-one">恢复</button>
        </div>`
      )
      .join("");

    const dialog = new Dialog({
      title: `恢复单词（${list.length} 个）`,
      width: responsiveDialogSize(420, "width"),
      height: "440px",
      content: `<div class="hiword-restore" id="hiword-restore">
        <div class="hiword-restore-list">${rows}</div>
        <div class="hiword-restore-foot"><button class="b3-button" data-action="restore-all">全部恢复</button></div>
      </div>`,
    });
    const root = dialog.element.querySelector("#hiword-restore") as HTMLElement | null;
    if (!root) return;

    const doRestore = (word: string) => {
      void this.vocabStore!.reactivateWord(word);
      root.querySelectorAll(".hiword-restore-row").forEach((el) => {
        if ((el as HTMLElement).dataset.word === word) el.remove();
      });
      const remaining = root.querySelector(".hiword-restore-row");
      if (!remaining) {
        const listEl = root.querySelector(".hiword-restore-list") as HTMLElement | null;
        if (listEl) listEl.innerHTML = `<div class="hiword-review__done">已全部恢复</div>`;
      }
    };

    root.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
      if (!t) return;
      const action = t.dataset.action;
      if (action === "restore-one") {
        const row = t.closest(".hiword-restore-row") as HTMLElement | null;
        if (row?.dataset.word) doRestore(row.dataset.word);
      } else if (action === "restore-all") {
        for (const r of list) doRestore(r.word);
      }
    });
  }

  /**
   * 容错初始化词库（JSON 存储）
   */
  private async initVocabStore() {
    try {
      const raw = await this.loadData("hiword-vocab.json");
      this.vocabStore.load(raw);
    } catch {
      this.vocabStore.load(null);
    }
    this.isReady = true;
    getLogger().info("[REword] 词库加载完成");

    // 回填历史单词的固有难度（旧词库无 difficulty 字段；新收词已在收词时计算）
    try {
      const n = await this.vocabStore.ensureDifficulties();
      if (n > 0) getLogger().info(`[REword] 已为 ${n} 个单词补算固有难度`);
    } catch (e) {
      getLogger().warn("[REword] 难度回填失败（不影响其余功能）:", { error: e });
    }

    // 词库就绪后，若侧边栏已打开则刷新显示
    if (this.dockElement) {
      this.renderVocabPanel(this.dockElement);
    }
  }

  /** 持久化批注（方案 C：独立文件，正文零污染） */
  private async saveAnnotations() {
    this.persistAnnotations.update(this.annotationStore.toJSON());
  }

  /**
   * 容错初始化分类标签库（2026-08-15 拆分：词库标签 / 批注标签 各自独立）。
   * 一次性迁移：若旧的共享 hiword-labels.json 存在且对应拆分文件尚不存在，则继承其内容，
   * 之后两域各自独立增删、互不干扰。
   */
  private async initLabelStores() {
    const sharedRaw = await this.loadData("hiword-labels.json").catch(() => null);

    // —— 词库标签 ——
    let vocabRaw = await this.loadData("hiword-vocab-labels.json").catch(() => null);
    if (!vocabRaw && sharedRaw) vocabRaw = sharedRaw;
    this.vocabLabelStore.load(vocabRaw);
    if (this.vocabLabelStore.size > 0) {
      this.persistVocabLabels.update(this.vocabLabelStore.toJSON());
    }

    // —— 批注标签 ——
    let annRaw = await this.loadData("hiword-annotation-labels.json").catch(() => null);
    if (!annRaw && sharedRaw) annRaw = sharedRaw;
    this.annotationLabelStore.load(annRaw);
    if (this.annotationLabelStore.size > 0) {
      this.persistAnnotationLabels.update(this.annotationLabelStore.toJSON());
    }

    getLogger().info(`[REword] 标签库加载完成（词库 ${this.vocabLabelStore.size} 个 / 批注 ${this.annotationLabelStore.size} 个）`);
  }

  /**
   * 容错初始化批注数据层（JSON 存储）
   */
    private async initAnnotationStore() {
    try {
      const raw = await this.loadData("hiword-annotations.json");
      this.annotationStore.load(raw);
    } catch {
      // 无历史数据：以空库启动
    }
    getLogger().info(`[REword] 批注数据层加载完成（共 ${this.annotationStore.size} 条）`);

    // ========== 2026-08-18：存量数据清洗，剥离裸 kramdown IAL（{.: id="…" updated="…"} 等）==========
    try {
      const cleaned = await this.annotationStore.cleanIal();
      if (cleaned > 0) getLogger().info(`[REword] 存量批注 IAL 清洗完成（${cleaned} 条被清理）`);
    } catch (e) {
      getLogger().warn("[REword] 存量批注 IAL 清洗失败（不影响使用）:", { error: e });
    }

    // ========== 4.2.0 旧 category/tags → labels 一次性迁移（2026-08-15 新增）==========
    try {
      // category → 中文标签名映射
      const catNameMap = { important: "重点", hard: "困难", todo: "待办", schedule: "行程" };
      const labelNameToId = (name: string) => this.annotationLabelStore.getAll().find((l) => l.name === name)?.id;
      const changed = await this.annotationStore.migrateLegacyCategoriesToLabels(
        (cat) => (catNameMap as any)[cat] || null,
        labelNameToId
      );
      if (changed > 0) getLogger().info(`[REword] 旧 category/tags 迁移到 labels 完成（${changed} 条）`);
    } catch (e) {
      getLogger().warn("[REword] 旧批注迁移失败:", { error: e });
    }

    // ========== 4.2.1 初始化微阅快速批注管理器 ==========
    try {
      this.whaleManager = new WhaleAnnotationManager(this.createWhaleHost());
      this.whaleManager.init();
      getLogger().info("[REword] 微阅快速批注管理器已初始化");
    } catch (e) {
      getLogger().warn("[REword] 微阅批注管理器初始化失败:", { error: e });
    }

    // 加载 UI 持久化状态（2026-08-15 新增：批注/词库标签筛选区收起状态 + 排序维度）
    try {
      this.whaleTagsCollapsed = localStorage.getItem("hiword-whale-tags-collapsed") === "true";
      this.vocabTagsCollapsed = localStorage.getItem("hiword-vocab-tags-collapsed") === "true";
      this.vocabAutoHighlight = localStorage.getItem("hiword-vocab-autohighlight") !== "false";
      // 2026-08-23 新增 / 2026-08-23 改:词库面板状态条按单词独立展开态
      // (旧 key "reword-vocab-status-collapsed" 弃用,新 key "reword-vocab-status-expanded" 存 JSON 数组)
      try {
        const raw = localStorage.getItem("reword-vocab-status-expanded");
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            this.vocabStatusBarExpandedWords = new Set(arr.filter((w) => typeof w === "string"));
          }
        }
        // 兼容旧 key:如果用户有旧的 collapsed=true 设置,迁移为全部展开(避免数据丢失)
        // 注:旧版语义"全局折叠",新版默认折叠,所以这里不迁移,直接忽略
      } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { const raw = localStorage.getItem(\"reword-vocab-status-exp…", "debug"); }
      const mode = localStorage.getItem("hiword-annotation-sort-mode");
      if (mode === "time" || mode === "doc" || mode === "style") this.whaleSortMode = mode;
      const dir = localStorage.getItem("hiword-annotation-sort-time-dir");
      if (dir === "desc" || dir === "asc") this.whaleSortTimeDir = dir;
      const doc = localStorage.getItem("hiword-annotation-sort-doc");
      this.whaleSortDoc = doc || null;
      const styles = localStorage.getItem("hiword-annotation-sort-styles");
      if (styles) {
        try {
          // 2026-08-24 迁移：旧线型（dashed/double→solid, dotted→wavy）在过滤 key 中降级，避免已存筛选失效
          const raw: string[] = JSON.parse(styles);
          this.whaleSortStyles = raw.map((k) => {
            const [c, s] = k.split("|");
            const ns = s === "dotted" ? "wavy" : s === "dashed" || s === "double" ? "solid" : s;
            return `${c}|${ns}`;
          });
        } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { // 2026-08-24 迁移：旧线型（dashed/double→solid, dotted→wavy）在过滤…", "debug"); }
      }
      const gm = localStorage.getItem("hiword-annotation-group-mode");
      if (gm === "time" || gm === "doc") this.whaleGroupMode = gm;
    } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { // 2026-08-24 迁移：旧线型（dashed/double→solid, dotted→wavy）在过滤…", "debug"); }
  }

  // ========== AI 精读（适配 copilot，最小可用对话能力）==========

  /** 持久化 AI 设置 */
  private async saveAiSettings() {
    try {
      await this.saveData("hiword-ai.json", this.aiSettings);
    } catch (e) {
      getLogger().warn("[REword] 保存 AI 设置失败:", { error: e });
    }
    // 设置变更后实时刷新 AI 输出字体大小（面板未挂载时 applyAiFontSize 内部会空转）
    this.aiPanel?.applyAiFontSize?.();
  }

  /** 容错初始化 AI 设置（JSON 存储），并实例化面板控制器（实现 AiHost） */
  private async initAiSettings() {
    try {
      const raw = await this.loadData("hiword-ai.json");
      this.aiSettings = normalizeAiSettings(raw);
    } catch {
      this.aiSettings = { ...DEFAULT_AI_SETTINGS };
    }
    // 加载预设与提示词模板（容错：空/损坏时用默认）
    try {
      this.aiPresetStore.load(await this.loadData("hiword-ai-presets.json"));
    } catch {
      this.aiPresetStore.load(null);
    }
    try {
      this.promptTemplateStore.load(await this.loadData("hiword-ai-prompts.json"));
    } catch {
      this.promptTemplateStore.load(null);
    }
    // 插件自身即 AiHost 实现
    this.aiPanel = new AiPanel(this);
    getLogger().info("[REword] AI 设置加载完成（enabled=" + this.aiSettings.enabled + "）");
  }

  /** 渲染 AI 精读 dock 面板 */
  private renderAiPanel(dockElement: HTMLElement) {
    if (!this.aiPanel) this.aiPanel = new AiPanel(this);
    this.aiPanel.render(dockElement);
  }

  /** 聚焦 dock 的「AI 精读」Tab（供命令 / 快捷入口） */
  private showAiPanel() {
    this.focusFeatureDock("ai");
    const el = this.getFeatureElement("ai");
    if (!el) {
      showMessage("请先打开 RE word 侧边栏", 2000, "info");
      return;
    }
    this.renderFeatureInto("ai", el);
    // 2026-08-26：仅在显式打开（⌥⌘A / 右键「发送到 AI」）时预填当前选区文本；
    // 切回 AI 精读 Tab 等被动渲染不再自动灌入「先前选中文本」，避免覆盖已输入内容。
    this.aiPanel?.prefillSelection();
  }

  // ===================== Copilot 聊天（照抄 copilot 插件）=====================

  /** 初始化 Copilot：加载持久化数据 → 实例化会话存储与面板 → 注册 dock / 顶栏 / 命令 */
  private async initCopilot(): Promise<void> {
    const ai = (await this.loadData("copilot-ai.json")) as CopilotAiSettings | null;
    this.copilotAi = normalizeCopilotSettings(ai ?? COPILOT_DEFAULT_AI);

    const prompts = (await this.loadData("copilot-prompts.json")) as string | null;
    this.copilotPromptRaw = typeof prompts === "string" && prompts.trim() ? prompts : COPILOT_DEFAULT_PROMPTS;

    const cfg = (await this.loadData("copilot-config.json")) as any;
    if (cfg && typeof cfg === "object") {
      this.copilotConfig = {
        enableContext: typeof cfg.enableContext === "boolean" ? cfg.enableContext : this.copilotConfig.enableContext,
        enablePrompts: typeof cfg.enablePrompts === "boolean" ? cfg.enablePrompts : this.copilotConfig.enablePrompts,
        autoTitle: typeof cfg.autoTitle === "boolean" ? cfg.autoTitle : this.copilotConfig.autoTitle,
      };
    }

    this.copilotConvo = new ConversationStore(() => {
      void this.saveCopilotConversations();
    });
    const convRaw = (await this.loadData("copilot-conversations.json")) as ConversationData | null;
    this.copilotConvo.load(convRaw);
    if (!this.copilotConvo.list().length) this.copilotConvo.createSession();

    // REword AI 会话历史持久化：变更即 saveData；首次进入保证至少有一个会话
    sessionStore.onChange = () => { void this.saveData("hiword-ai-sessions.json", sessionStore.toJSON()); };
    const aiSessRaw = (await this.loadData("hiword-ai-sessions.json")) as AiSessionData | null;
    sessionStore.load(aiSessRaw);
    if (!sessionStore.list().length) sessionStore.create();

    const host: CopilotHost = {
      getStore: () => this.copilotConvo,
      getSettings: () => this.copilotAi,
      newSession: () => this.copilotConvo.createSession(),
      selectSession: (id) => this.copilotConvo.setActive(id),
      deleteSession: (id) => this.copilotConvo.deleteSession(id),
      renameSession: (id, t) => this.copilotConvo.renameSession(id, t),
      togglePin: (id) => this.copilotConvo.togglePin(id),
      addContextDoc: (doc) => this.copilotAddContextDoc(doc),
      removeContextDoc: (id) => this.copilotConvo.removeContextDoc(id),
      getPrompts: () => this.copilotGetPrompts(),
      sendToAI: (text, stream) => this.copilotSendToAI(text, stream),
      fetchDocs: () => fetchDocumentList(300),
      searchDocs: (kw) => fetchDocumentSearch(kw),
      openSettings: () => this.openCopilotSettings(),
      copyText: (text) => this.copilotCopy(text),
      confirmDialog: (msg) => this.copilotConfirmDialog(msg),
      promptDialog: (msg, def) => this.copilotPromptDialog(msg, def),
    };
    this.copilotPanel = new CopilotPanel(host);

    // [已移除] Copilot 对话入口（dock / 顶栏按钮 / 命令）按用户要求于 2026-08-17 删除。
    // 仅保留上方数据初始化（copilotConvo / sessionStore 等）；AI 精读面板依赖 sessionStore，故不删。
    getLogger().info("[REword] Copilot 数据初始化完成（对话入口已禁用）");
  }

  // [已移除] openCopilotDock() —— Copilot dock 入口已禁用（2026-08-17）

  /** 加入上下文文档（受功能开关约束） */
  private copilotAddContextDoc(doc: CopilotDoc): void {
    if (!this.copilotConfig.enableContext) {
      showMessage("文档上下文功能已关闭，请在 ⚙ 设置中开启");
      return;
    }
    this.copilotConvo.addContextDoc(doc);
  }

  /** 预设提示词（受功能开关约束） */
  private copilotGetPrompts(): CopilotPrompt[] {
    if (!this.copilotConfig.enablePrompts) return [];
    return parseCopilotPrompts(this.copilotPromptRaw);
  }

  /** 复制文本 */
  private copilotCopy(text: string): void {
    navigator.clipboard?.writeText(text).then(
      () => showMessage("已复制"),
      () => showMessage("复制失败")
    );
  }

  /** 发送一条消息并请求 AI（内部已写入会话存储） */
  private async copilotSendToAI(
    userText: string,
    stream?: import("./copilot/copilot/copilot-host.ts").ChatStream
  ): Promise<ChatSendResult> {
    const session = this.copilotConvo.getActive();
    this.copilotConvo.appendMessage("user", userText, { origin: "chat" });

    let ctxDocs: Awaited<ReturnType<typeof fetchDocContent>>[] = [];
    if (this.copilotConfig.enableContext && session.contextDocs.length) {
      try {
        ctxDocs = await Promise.all(session.contextDocs.map((d) => fetchDocContent(d)));
      } catch {
        ctxDocs = [];
      }
    }

    const history = this.copilotConvo.get(session.id)?.messages ?? [];

    // 累积流式内容：既回调给面板做实时渲染，也留存用于最终落盘
    let acc = "";
    const res = await runCopilotChat(this.copilotAi, ctxDocs, history, undefined, {
      signal: stream?.signal,
      onToken: (chunk) => {
        acc += chunk;
        stream?.onToken?.(chunk);
      },
    });

    if (res.aborted) {
      // 用户主动停止：保留已生成的部分内容
      this.copilotConvo.appendMessage("assistant", acc || "（已停止生成）", { origin: "chat" });
    } else if (res.ok) {
      this.copilotConvo.appendMessage("assistant", res.content, { origin: "chat" });
    } else {
      this.copilotConvo.appendMessage("assistant", "⚠️ 请求失败：" + (res.error || "未知错误"), { origin: "chat" });
    }
    await this.saveCopilotConversations();
    return { ok: res.ok, content: res.content, error: res.error, aborted: res.aborted };
  }

  /**
   * 批量翻译（双语注入核心）：先查按书缓存，未命中走引擎链。
   * @param texts 待译文本数组
   * @param from  源语言（"auto" 或 ISO 代码）
   * @param to    目标语言（默认 "zh"）
   * @param bookId 书籍 ID（用于按书缓存；传空串则不落盘缓存）
   */
  public async translateBatch(
    texts: string[],
    from: string,
    to: string,
    bookId: string
  ): Promise<string[]> {
    if (!Array.isArray(texts) || texts.length === 0) return [];
    const out: string[] = new Array(texts.length).fill("");

    // 1) 查缓存（按书）
    const { hits, misses } = await this.translationCache.getBatch(bookId, texts);
    for (const k in hits) out[+k] = hits[k];
    trLog(`translateBatch: 缓存命中 ${Object.keys(hits).length}, 未命中 ${misses.length}/${texts.length}`);

    // 2) 未命中部分走引擎链（2026-08-28：AI 首选 + 批量模式）
    if (misses.length) {
      const reqTexts = misses.map((i) => texts[i]);
      try {
        trLog("translateBatch: buildProviders...");
        const providers = buildProviders(this.aiSettings, {
          translateOne: (t, f, t2, bid) => this.aiTranslateText(t, f, t2, bid),
          translateBatch: (ts, f, t2, bid) => this.aiTranslateBatch(ts, f, t2, bid),
        });
        trLog(`translateBatch: ${providers.length} 个引擎, 调用 translateWithFallback...`);
        const res = await translateWithFallback(providers, { texts: reqTexts, from, to, bookId });
        const tr = res.texts || [];
        trLog(`translateBatch: 引擎返回 provider=${res.provider}, ${tr.length} 条译文, 非空 ${tr.filter(t=>t?.trim()).length} 条`);
        const pairs: Array<[string, string]> = [];
        misses.forEach((idx, j) => {
          const translation = (tr[j] || "").trim();
          out[idx] = translation;
          if (translation) pairs.push([texts[idx], translation]);
        });
        if (pairs.length) await this.translationCache.setBatch(bookId, pairs);
      } catch (e) {
        console.error("[REword] translateBatch: 引擎链异常:", e);
        getLogger().error("[REword] 批量翻译失败:", { error: e });
      }
    }
    trLog(`translateBatch: 最终返回 ${out.length} 条, 非空 ${out.filter(t=>t?.trim()).length} 条`);
    return out;
  }

  /**
   * 翻译缓存统计（用于阅读器设置面板展示「本书已缓存 N 段」+ 页码范围）。
   * @param bookId 书籍 ID
   * @returns 已缓存段落译文条数 + 已缓存节总数 + 连续区间文本（如「第 1-4 页」）
   */
  public async getTranslationCacheStats(
    bookId: string
  ): Promise<{ count: number; cachedPages: number; pageRangeText: string; title: string }> {
    if (!bookId) return { count: 0, cachedPages: 0, pageRangeText: "0 页", title: "" };
    const count = await this.translationCache.size(bookId);
    const sec = await this.translationCache.getCachedSections(bookId);
    return { count, cachedPages: sec.total, pageRangeText: sec.rangeText, title: sec.title };
  }

  /**
   * 记录某书已成功缓存的「节」序号（1-based），用于 UI「第 X-Y 页缓存成功」。
   * 由双语注入管线在每批翻译入缓存后回调触发。
   * @param bookId 书籍 ID
   * @param sections 本次涉及的书「节」序号（1-based，升序）
   * @param title 书名（用于「选择书籍」下拉展示），可选
   */
  public recordCachedSections(bookId: string, sections: number[], title?: string): void {
    if (!bookId || !sections || !sections.length) return;
    this.translationCache.recordSections(bookId, sections, title);
  }

  /**
   * 列出所有有翻译缓存的书籍（bookId + 书名），供阅读器设置面板「选择书籍」下拉。
   */
  public async listCachedBooks(): Promise<Array<{ bookId: string; title: string }>> {
    return this.translationCache.listCachedBooks();
  }

  /**
   * 清空某书的翻译缓存（翻页/重开书后释义会重新按提示词翻译）。
   * 仅在用户主动点击「清空缓存」时调用；正常关闭双语不清除缓存，
   * 以实现「重开书籍与翻页之前释义不消失」的持久化语义。
   * @param bookId 书籍 ID
   */
  public async clearTranslationCache(bookId: string): Promise<void> {
    if (!bookId) return;
    await this.translationCache.clear(bookId);
  }

  /**
   * 自有 AI 兜底翻译（单条）：直接走对话编排，不污染 AI 精读面板会话。
   * 用 AI 设置里的「翻译预置提示词」作为系统提示，关闭 JSON 输出，求纯译文。
   * 2026-08-28 修复：改读 AI 精读设置（this.aiSettings，即用户实际配置的
   * baseUrl/apiKey/model）——原读 copilotAi（独立 Copilot 设置）导致未配置
   * Copilot 时翻译永远空转。temperature 覆写 0.2 抑制润色倾向。
   */
  /* ================= 本书前提上下文 + Token 统计（2026-08-28 v1.3.0） ================= */
  // 翻译流程日志走模块级 trLog（DEBUG_TRANSLATE 控制），异常仍走 warn。

  /**
   * 组装翻译 prompt：把用户为本书手写的「前提上下文」拼在最前面。
   * 这是解决专有名词前后不一致（如 Sludge 先译「斯拉奇」后译「烂泥」）的关键——
   * AI 批量翻译本身无状态，只能看到当前这批发过去的段落。
   *
   * 上下文用 **Markdown 原文**而非 Lute 渲染的 HTML：
   *  - 省 60%+ token（`- Nate` vs `<ul><li>Nate</li></ul>`）；
   *  - 模型完全理解 Markdown，无需渲染。
   *
   * @param basePrompt 基础翻译指令（AI 设置里的「翻译预置提示词」）
   * @param bookId 书籍 ID（空则不加上下文）
   */
  private buildTranslatePrompt(basePrompt: string, bookId?: string): string {
    const base = (basePrompt || "").trim();
    const primer = bookId ? (this.bookPrimerStore?.get(bookId) || "").trim() : "";
    if (!primer) return base;
    return (
      `【本书背景资料（用户提供的上下文，翻译时必须遵循其中的专有名词译法）】\n${primer}\n\n` +
      `【翻译要求】\n${base}\n` +
      `【重要】若上文「本书背景资料」中已给出某专有名词的译法，必须严格采用该译法，不得另译。`
    );
  }

  /** 读取本书累计 token 用量（无数据返回零值对象） */
  public getBookTokenUsage(bookId: string): { total: number; prompt: number; completion: number } {
    if (!bookId) return { total: 0, prompt: 0, completion: 0 };
    const v = this.bookTokenUsage[bookId];
    return v ? { ...v } : { total: 0, prompt: 0, completion: 0 };
  }

  /** 累计本书 token 用量（内部调用，自动防抖落盘） */
  private addBookTokenUsage(
    bookId: string,
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  ): void {
    if (!bookId) return;
    const cur = this.bookTokenUsage[bookId] || { total: 0, prompt: 0, completion: 0 };
    const p = usage?.promptTokens || 0;
    const c = usage?.completionTokens || 0;
    this.bookTokenUsage[bookId] = {
      total: cur.total + (usage?.totalTokens || p + c),
      prompt: cur.prompt + p,
      completion: cur.completion + c,
    };
    this.scheduleTokenUsageSave();
  }

  /** 重置本书 token 统计 */
  public async resetBookTokenUsage(bookId: string): Promise<void> {
    if (!bookId) return;
    delete this.bookTokenUsage[bookId];
    await this.persistBookTokenUsage();
  }

  /** 重置全部书籍的 token 统计 */
  public async resetAllTokenUsage(): Promise<void> {
    this.bookTokenUsage = {};
    await this.persistBookTokenUsage();
  }

  private tokenUsageTimer: any = null;

  private scheduleTokenUsageSave(): void {
    if (this.tokenUsageTimer) clearTimeout(this.tokenUsageTimer);
    this.tokenUsageTimer = setTimeout(() => {
      this.tokenUsageTimer = null;
      this.persistBookTokenUsage().catch(() => {
        /* 统计落盘失败无妨：仅影响重启后的累计值 */
      });
    }, 1500);
  }

  private async persistBookTokenUsage(): Promise<void> {
    try {
      await this.saveData(RewordPlugin.TOKEN_USAGE_KEY, this.bookTokenUsage);
    } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · persistBookTokenUsage", "error"); }
  }

  private async loadBookTokenUsage(): Promise<void> {
    try {
      const raw = await this.loadData(RewordPlugin.TOKEN_USAGE_KEY);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        this.bookTokenUsage = raw as Record<string, { total: number; prompt: number; completion: number }>;
      } else if (typeof raw === "string" && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") this.bookTokenUsage = parsed;
      }
    } catch {
      this.bookTokenUsage = {};
    }
  }

  private async aiTranslateText(text: string, from: string, to: string, bookId?: string): Promise<string> {
    if (!this.aiSettings?.enabled || !this.aiSettings?.apiKey) return ""; // AI 未配置则放弃
    const basePrompt = (this.aiSettings?.translatePrompt || DEFAULT_AI_SETTINGS.translatePrompt).trim();
    // v1.3.0：注入本书前提上下文，保证专有名词与用户手写译法一致
    const prompt = this.buildTranslatePrompt(basePrompt, bookId);
    const settings = { ...this.aiSettings, systemPrompt: prompt, jsonMode: false, temperature: this.aiSettings?.trTemperature ?? 0.2 } as any;
    const body = bookId ? `请翻译以下内容：\n\n${text}` : text;
    const res = await runCopilotChat(settings, [], [{ role: "user", content: body } as any], undefined, {});
    return res?.content || "";
  }

  /** AI 批量翻译分桶参数：段数上限 / 字符预算（防超长 prompt 与输出截断） */
  private static readonly AI_TR_CHUNK = 8;
  private static readonly AI_TR_CHUNK_CHARS = 3000;
  /** 桶间并发数与 429 退避等待 */
  private static readonly AI_TR_CONCURRENCY = 2;
  private static readonly AI_TR_RETRY_WAIT = 1500;

  /**
   * 2026-08-28：AI 批量翻译（双语首选路径）。
   * 一批段落按 [[序号]] 编号后合并进尽量少的请求，要求模型按序号逐段
   * 回传译文，解析对齐后回填；漏译空位再逐段 aiTranslateText 兜底。
   * 复用 AI 精读同一模型与设置（仅覆写 systemPrompt/temperature/jsonMode），
   * 不落盘会话、不污染精读面板。
   */
  private async aiTranslateBatch(
    texts: string[],
    from: string,
    to: string,
    bookId?: string
  ): Promise<string[]> {
    const out: string[] = new Array(texts.length).fill("");
    if (!Array.isArray(texts) || !texts.length) return out;
    if (!this.aiSettings?.enabled || !this.aiSettings?.apiKey) {
      console.warn("[REword] aiTranslateBatch: AI 未配置(enabled/apiKey)，返回空");
      return out;
    }

    // 重置 token 用量累计器
    this._lastTranslationUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // v1.3.0：注入本书前提上下文（用户手写的背景/人物/译法）
    const basePrompt = (this.aiSettings?.translatePrompt || DEFAULT_AI_SETTINGS.translatePrompt).trim();
    const prompt = this.buildTranslatePrompt(basePrompt, bookId);
    const settings = { ...this.aiSettings, systemPrompt: prompt, jsonMode: false, temperature: this.aiSettings?.trTemperature ?? 0.2 } as any;
    trLog(`aiTranslateBatch: 入参 ${texts.length} 段, bookId=${bookId || "(无)"}, 上下文=${bookId && this.bookPrimerStore?.get(bookId) ? "有" : "无"}, model=${settings.model || "(空)"}`);

    // 分桶：段数 + 字符双预算
    const chunks: Array<{ start: number; texts: string[] }> = [];
    let cur: { start: number; texts: string[] } | null = null;
    let curChars = 0;
    texts.forEach((t, i) => {
      const len = t.length;
      if (!cur || cur.texts.length >= (this.aiSettings?.trBatchSize ?? RewordPlugin.AI_TR_CHUNK) || curChars + len > RewordPlugin.AI_TR_CHUNK_CHARS) {
        cur = { start: i, texts: [] };
        curChars = 0;
        chunks.push(cur);
      }
      cur.texts.push(t);
      curChars += len;
    });
    trLog(`aiTranslateBatch: 分桶完成，${chunks.length} 个桶`);

    const runChunk = async (chunk: { start: number; texts: string[] }): Promise<void> => {
      const numbered = chunk.texts.map((t, j) => `[[${j + 1}]]\n${t}`).join("\n\n");
      const userContent =
        `请把下面 ${chunk.texts.length} 段各自翻译成中文直译。每段以 [[序号]] 开头标记，` +
        `回答时同样用 [[序号]] 开头逐段给出译文，序号与原文一一对应，` +
        `不要合并、不要遗漏、不要添加任何解释或额外内容。\n\n${numbered}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          trLog(`aiTranslateBatch: 桶#${chunks.indexOf(chunk)} 调用 runCopilotChat (attempt=${attempt})...`);
          const res = await runCopilotChat(
            settings,
            [],
            [{ role: "user", content: userContent } as any],
            undefined,
            {}
          );
          trLog(`aiTranslateBatch: runCopilotChat 返回 ok=${res?.ok}, content长度=${(res?.content||"").length}, 内容预览="${(res?.content||"").slice(0,120)}", error=${res?.error||"无"}`);
          // 累计 token 用量（部分 AI 服务商返回 usage，缺失则跳过）
          if (res?.usage) {
            this._lastTranslationUsage!.promptTokens += res.usage.promptTokens || 0;
            this._lastTranslationUsage!.completionTokens += res.usage.completionTokens || 0;
            this._lastTranslationUsage!.totalTokens += res.usage.totalTokens || 0;
            // v1.3.0：按书累计（供 UI 展示「本书累计 Token」）
            if (bookId) this.addBookTokenUsage(bookId, res.usage);
            trLog(`aiTranslateBatch: 桶#${chunks.indexOf(chunk)} token 用量 prompt=${res.usage.promptTokens} completion=${res.usage.completionTokens} total=${res.usage.totalTokens}`);
          }
          let pairs = parseNumberedTranslations(res?.content || "");
          // 2026-08-28 兜底：模型未遵守 [[序号]] 格式（返回纯译文 / 数字编号）时，
          // 按位置顺序回填到 1..N，避免整批译文因格式不符而静默全丢。
          if (pairs.length === 0 && chunk.texts.length > 0 && (res?.content || "").trim()) {
            pairs = parseTranslationsPositional(res.content, chunk.texts.length);
            console.warn(`[REword] aiTranslateBatch: 未命中[[序号]]格式，位置兜底得 ${pairs.length} 对`);
            getLogger().warn("[REword] AI 批量翻译未命中 [[序号]] 格式，启用位置兜底", {
              data: { start: chunk.start, size: chunk.texts.length, got: pairs.length },
            });
          }
          for (const [idx, tr] of pairs) {
            if (idx >= 1 && idx <= chunk.texts.length) out[chunk.start + idx - 1] = tr;
          }
          trLog(`aiTranslateBatch: 桶#${chunks.indexOf(chunk)} 完成，out 非空 ${out.filter(Boolean).length}/${texts.length}`);
          return; // 桶完成（漏译序号交给下方逐段兜底）
        } catch (e: any) {
          const msg = String(e?.message || e);
          console.warn(`[REword] aiTranslateBatch: 桶#${chunks.indexOf(chunk)} 异常: ${msg}`);
          if (attempt === 0 && /429|rate|too many/i.test(msg)) {
            await new Promise((r) => setTimeout(r, RewordPlugin.AI_TR_RETRY_WAIT));
            continue; // 限流退避后重试一次
          }
          getLogger().warn("[REword] AI 批量翻译桶失败:", {
            data: { start: chunk.start, size: chunk.texts.length, error: msg },
          });
          return;
        }
      }
    };

    // 桶间并发 2：串行太慢、并发过高易触发限流
    const queue = [...chunks];
    trLog(`aiTranslateBatch: 启动 ${Math.min(this.aiSettings?.trConcurrency ?? RewordPlugin.AI_TR_CONCURRENCY, queue.length)} 个 worker 处理 ${queue.length} 个桶`);
    const workers = Array.from(
      { length: Math.min(this.aiSettings?.trConcurrency ?? RewordPlugin.AI_TR_CONCURRENCY, queue.length) },
      async () => {
        while (queue.length) {
          const c = queue.shift();
          if (c) await runChunk(c);
        }
      }
    );
    await Promise.all(workers);

    trLog(`aiTranslateBatch: 所有桶完成，out 非空 ${out.filter(Boolean).length}/${texts.length}`);

    // 漏译逐段兜底：仅当大部分桶成功（空位 ≤ 一半）时执行，
    // 避免批量整体失败（断网/欠费）时触发连环逐段请求。
    const missIdx: number[] = [];
    for (let i = 0; i < texts.length; i++) if (!out[i]) missIdx.push(i);
    if (missIdx.length && missIdx.length <= texts.length / 2) {
      for (const i of missIdx) {
        try {
          out[i] = (await this.aiTranslateText(texts[i], from, to, bookId)) || "";
        } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { out[i] = (await this.aiTranslateText(texts[i], from, to, …", "debug"); }
      }
    } else if (missIdx.length) {
      getLogger().warn("[REword] AI 批量翻译大面积失败，跳过逐段兜底:", {
        data: { total: texts.length, missed: missIdx.length },
      });
    }
    return out;
  }

  /**
   * 是否已配置任一可用的翻译引擎（供阅读器双语开关前置提示）。
   * 2026-08-28：AI（精读设置）为首选引擎；微软/LibreTranslate 仅在
   * 「开关开启 + 已配置」时才计入。
   */
  public isTranslationConfigured(): boolean {
    return (
      !!(this.aiSettings?.enabled && this.aiSettings?.apiKey) ||
      !!(this.aiSettings?.msEnabled && this.aiSettings?.msKey && this.aiSettings?.msRegion) ||
      !!(this.aiSettings?.libreEnabled && this.aiSettings?.libreUrl)
    );
  }

  /**
   * 2026-08-27：阅读器「翻译」按钮入口。
   * 把选中文本拼上 AI 设置里的「翻译预置提示词」，打开并聚焦 AI 精读面板，预填后自动发送。
   */
  public translateToAi(text: string): void {
    if (!text?.trim()) return;
    if (!this.aiSettings?.enabled || !this.aiSettings?.apiKey) {
      showMessage("翻译未配置：请先在 AI 设置中开启并填写 API", 2600, "info" as any);
      return;
    }
    const prompt = (this.aiSettings.translatePrompt || DEFAULT_AI_SETTINGS.translatePrompt).trim();
    const full = prompt ? `${prompt}\n\n${text}` : text;
    // 打开/聚焦 AI 精读面板（会 render 面板），再发送
    this.showAiPanel();
    // render 是异步（focusFeatureDock + renderFeatureInto），给一帧确保输入框就绪
    setTimeout(() => {
      try {
        this.aiPanel?.sendText(full);
      } catch (e) {
        getLogger().error("[REword] 发送到 AI 精读失败:", { error: e });
      }
    }, 60);
  }

  /** 阅读器划词朗读（公开包装 TTS 引擎，自动适配中英文 voice） */
  public speakText(text: string) {
    this.speak(text);
  }

  /** 阅读器划词发送到设置笔记本（默认 REword/阅读摘录，可在 localStorage 配置） */
  public async sendReaderSelection(opts: { markdown: string; title: string }): Promise<string> {
    try {
      let notebookId = (typeof localStorage !== "undefined" && localStorage.getItem("hiword-reader-send-notebook")) || "";
      if (!notebookId) {
        const nbs = await this.listNotebooks();
        notebookId = nbs[0]?.id || "";
      }
      if (!notebookId) return "";
      const path = (typeof localStorage !== "undefined" && localStorage.getItem("hiword-reader-send-path")) || "/REword/阅读摘录";
      return await this.saveToNote({ markdown: opts.markdown, notebookId, path, title: opts.title, openAfterSave: false });
    } catch (e) {
      getLogger().error("[REword] 发送摘录失败:", { error: e });
      return "";
    }
  }

  /**
   * 阅读器划词插入到当前打开的思源文档（2026-08-24 新增）
   * 思源不提供"当前文档"API，从 localStorage 读最近打开的 docId；
   * 找不到时降级到 saveToNote（写入默认笔记本）。
   */
  public async insertReaderSelectionToCurrentDoc(opts: { markdown: string }): Promise<string> {
    try {
      // 思源在 localStorage 存最近打开的 docId（key 形如 /workspace/xxx/yyy.sy 等）
      // 取最近一个 .sy 结尾的 id 作为目标
      let currentDocId = "";
      if (typeof localStorage !== "undefined") {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && /\/[0-9]{14}-[a-z0-9]{7}$/.test(k)) {
            currentDocId = k;
            break;
          }
        }
      }
      if (!currentDocId) {
        getLogger().warn("[REword] 找不到当前文档 ID，降级到 saveToNote");
        return await this.sendReaderSelection({ markdown: opts.markdown, title: "阅读摘录" });
      }
      const { appendBlock } = await import("./siyuan/api");
      const ops = await appendBlock("markdown", opts.markdown, currentDocId);
      return ops && ops[0] ? ops[0].doOperations?.[0]?.id || currentDocId : currentDocId;
    } catch (e) {
      getLogger().error("[REword] 插入当前文档失败:", { error: e });
      return "";
    }
  }

  /* ===================== Copilot 持久化 ===================== */
  private async saveCopilotConversations(): Promise<void> {
    this.persistConvo.update(this.copilotConvo.toJSON());
  }
  private async saveCopilotAi(): Promise<void> {
    try { await this.saveData("copilot-ai.json", this.copilotAi); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · saveCopilotAi", "error"); }
  }
  private async saveCopilotPrompts(): Promise<void> {
    try { await this.saveData("copilot-prompts.json", this.copilotPromptRaw); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · saveCopilotPrompts", "error"); }
  }
  private async saveCopilotConfig(): Promise<void> {
    try { await this.saveData("copilot-config.json", this.copilotConfig); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · saveCopilotConfig", "error"); }
  }

  /** HTML 转义（属性用） */
  private cpEscAttr(s: string): string {
    return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  private cpEscHtml(s: string): string {
    return this.cpEscAttr(s);
  }

  /* ===================== Copilot AI 设置对话框 ===================== */
  private openCopilotSettings(): void {
    const s = this.copilotAi;
    const c = this.copilotConfig;
    const content = `
      <div class="cp-set">
        <div class="cp-set-section">
          <div class="cp-set-title">AI 配置</div>
          <label class="cp-set-row">
            <span>启用 AI</span>
            <input type="checkbox" id="cp-set-enabled" ${s.enabled ? "checked" : ""}/>
          </label>
          <label class="cp-set-row">
            <span>Base URL</span>
            <input type="text" id="cp-set-baseurl" value="${this.cpEscAttr(s.baseUrl)}" placeholder="https://api.openai.com/v1"/>
          </label>
          <label class="cp-set-row">
            <span>API Key</span>
            <input type="password" id="cp-set-key" value="${this.cpEscAttr(s.apiKey)}" placeholder="sk-..."/>
          </label>
          <label class="cp-set-row">
            <span>模型</span>
            <input type="text" id="cp-set-model" value="${this.cpEscAttr(s.model)}" placeholder="gpt-4o-mini"/>
          </label>
          <label class="cp-set-row">
            <span>温度 (0~2)</span>
            <input type="number" step="0.1" min="0" max="2" id="cp-set-temp" value="${s.temperature}"/>
          </label>
          <label class="cp-set-row">
            <span>最大 Token</span>
            <input type="number" step="16" min="16" max="32768" id="cp-set-maxtok" value="${s.maxTokens}"/>
          </label>
          <label class="cp-set-row cp-set-row--col">
            <span>系统提示词</span>
            <textarea id="cp-set-sys" rows="5">${this.cpEscHtml(s.systemPrompt)}</textarea>
          </label>
        </div>

        <div class="cp-set-section">
          <div class="cp-set-title">功能模块</div>
          <label class="cp-set-row">
            <span>文档上下文</span>
            <input type="checkbox" id="cp-set-ctx" ${c.enableContext ? "checked" : ""}/>
          </label>
          <label class="cp-set-row">
            <span>提示词库</span>
            <input type="checkbox" id="cp-set-prompt" ${c.enablePrompts ? "checked" : ""}/>
          </label>
          <label class="cp-set-row">
            <span>自动生成标题</span>
            <input type="checkbox" id="cp-set-autotitle" ${c.autoTitle ? "checked" : ""}/>
          </label>
        </div>

        <div class="cp-set-section">
          <div class="cp-set-title">提示词预设（逗号分隔）</div>
          <textarea id="cp-set-prompts" rows="3" placeholder="总结要点,翻译,润色…">${this.cpEscHtml(this.copilotPromptRaw)}</textarea>
          <div class="cp-set-hint">多个提示词用逗号隔开，点击底部「提示词」按钮即可插入。</div>
        </div>

        <div class="cp-set-actions">
          <button class="cp-set-btn cp-set-btn--ghost" id="cp-set-cancel">取消</button>
          <button class="cp-set-btn cp-set-btn--primary" id="cp-set-save">保存</button>
        </div>
      </div>
    `;

    const dialog = new Dialog({
      title: "Copilot · AI 设置",
      content,
      width: responsiveDialogSize(480, "width"),
      height: "520px",
    });

    const root = dialog.element;
    root.querySelector("#cp-set-cancel")?.addEventListener("click", () => dialog.destroy());

    root.querySelector("#cp-set-save")?.addEventListener("click", async () => {
      const getVal = (id: string) => (root.querySelector("#" + id) as HTMLInputElement | HTMLTextAreaElement)?.value ?? "";
      const getChk = (id: string) => (root.querySelector("#" + id) as HTMLInputElement)?.checked ?? false;

      this.copilotAi = normalizeCopilotSettings({
        enabled: getChk("cp-set-enabled"),
        baseUrl: getVal("cp-set-baseurl"),
        apiKey: getVal("cp-set-key"),
        model: getVal("cp-set-model"),
        temperature: getVal("cp-set-temp"),
        maxTokens: getVal("cp-set-maxtok"),
        systemPrompt: getVal("cp-set-sys"),
        jsonMode: false,
      });
      this.copilotConfig.enableContext = getChk("cp-set-ctx");
      this.copilotConfig.enablePrompts = getChk("cp-set-prompt");
      this.copilotConfig.autoTitle = getChk("cp-set-autotitle");
      this.copilotPromptRaw = getVal("cp-set-prompts").trim() || COPILOT_DEFAULT_PROMPTS;

      await Promise.all([this.saveCopilotAi(), this.saveCopilotConfig(), this.saveCopilotPrompts()]);
      showMessage("设置已保存");
      dialog.destroy();

      // 注意：Copilot dock 现在由 Svelte AISidebar（initCopilotSidebar）接管，
      // 其生命周期与设置响应由 Svelte store 自行管理，无需再渲染旧的 CopilotPanel。
    });
  }

  // ----- AiHost 实现（桥接插件能力到面板）-----

  getAiSettings(): AiSettings {
    return this.aiSettings;
  }

  /** 获取词库存储实例（AI 精读词库自动闭环用） */
  getVocabStore(): VocabStore {
    return this.vocabStore;
  }

  /** 在词典面板中查询某词（AI 输出右键菜单「查词」用） */
  lookupWordInDict(word: string): void {
    if (!word || !word.trim()) return;
    this.lookupWordInDock(word.trim());
  }

  /** 读取当前块 / 选区的精读原文（同步可获取部分；整块正文由面板按钮异步拉取） */
  getDeepReadSource(): AiDeepReadSource | null {
    const sel = this.getSelectionTextPrecise();
    const blockId = this.getSelectionBlockId();
    const docId = this.getSelectionDocId(blockId) || this.currentRootId || undefined;
    if (sel) {
      this.lastDeepReadBlockId = blockId;
      this.lastDeepReadDocId = docId;
      return { title: docId ? this.docTitleHint(docId) : undefined, text: sel, blockId, docId };
    }
    if (blockId) {
      this.lastDeepReadBlockId = blockId;
      this.lastDeepReadDocId = docId;
      // 无选区但有焦点块：文本为空，由面板「读取当前块」按钮异步补全
      return { title: docId ? this.docTitleHint(docId) : undefined, text: "", blockId, docId };
    }
    // v6：实时选区已丢失（点击/聚焦面板导致折叠）→ 回退到最近一次有效选区缓存
    const cache = this.lastSelectionCache;
    if (cache?.text) {
      this.lastDeepReadBlockId = cache.blockId;
      this.lastDeepReadDocId = cache.docId;
      return {
        title: cache.docId ? this.docTitleHint(cache.docId) : undefined,
        text: cache.text,
        blockId: cache.blockId,
        docId: cache.docId,
      };
    }
    return null;
  }

  /**
   * 异步读取整块正文作为精读输入（拖拽块 / 读取当前块共用）。
   * 降级链：textmark → md 模式 → blocks 表 markdown 字段；全空才返回 null，
   * 由调用方（expandBlockRefs）静默退化为锚文本，绝不把 ((id)) 发给 AI。
   * 列表块在思源 getBlockKramdown(textmark) 下往往返回空，md 模式 / SQL 兜底可取到完整正文。
   */
  async fetchBlockText(blockId: string): Promise<string | null> {
    if (!blockId) return null;
    try {
      // 1) 默认 textmark（标准 kramdown）
      const t1 = await getBlockKramdown(blockId);
      if (t1 && t1.trim()) return t1;
      // 2) 降级 md 模式（对列表/表格等块更可靠）
      const t2 = await getBlockKramdown(blockId, "md");
      if (t2 && t2.trim()) return t2;
      // 3) 再降级：直接取 blocks 表 markdown 字段（列表块正文通常在子块，父块可能为空，此处兜底）
      try {
        const rows = await sqlQuery<{ markdown: string }>(
          `SELECT markdown FROM blocks WHERE id='${blockId}'`
        );
        const md = rows?.[0]?.markdown;
        if (md && md.trim()) return md;
      } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · fetchBlockText", "debug"); }
      return null;
    } catch (e) {
      getLogger().debug("[REword] 读取块正文失败（已静默降级）:", { error: e });
      return null;
    }
  }

  /** 读取块类型：用于 AI 面板拖入卡片按类型显示差异化图标（段落/列表/标题/代码/引用） */
  async fetchBlockType(blockId: string): Promise<string | null> {
    if (!blockId) return null;
    try {
      const rows = await sqlQuery<{ type: string }>(
        `SELECT type FROM blocks WHERE id='${blockId}'`
      );
      const t = rows?.[0]?.type;
      return t || null;
    } catch (e) {
      getLogger().debug("[REword] 读取块类型失败:", { error: e });
      return null;
    }
  }

  /**
   * 从拖拽事件中解析思源块 ID（v5 增强）
   *
   * 检测策略（按优先级）：
   * 0. 全局 dragstart 记录的源块 ID（capture 阶段拦截）
   * 1. dataTransfer 自定义类型中的块 ID（思源内部拖拽）
   * 2. text/plain 中匹配 siyuan:// 块链接或纯 blockId 格式
   * 3. 拖拽目标元素的 data-node-id 属性
   *
   * @returns 块 ID 字符串，若无法识别为块拖拽则返回 null
   */
  resolveDragBlockId(e: DragEvent): string | null {
    if (!e.dataTransfer) { getLogger().debug("[REword] resolveDragBlockId: 无 dataTransfer"); return null; }

    getLogger().info("[REword] resolveDragBlockId types:" + [...e.dataTransfer.types]);

    // 策略 0（v5 capture）：全局 dragstart 记录的源块（本拖拽 60s 内有效，消费即清）
    const src = this.draggingBlockId;
    if (src && Date.now() - src.ts < 60_000) {
      this.draggingBlockId = null; // 一次性消费，防跨面板污染
      getLogger().info("[REword] ✅ 策略0命中（dragstart 全局记录）:" + src.id);
      return src.id;
    }
    getLogger().info("[REword] 策略0未命中，draggingBlockId=" + (src ? `${src.id} (age=${Date.now()-src.ts}ms)` : "null"));

    // 策略 1: 检查思源可能使用的各种自定义数据类型
    const customTypes = [
      "siyuan/block-id", "text/x-siyuan-block", "block/id",
      "text/x-siyuan-dnd", "application/siyuan-block",
      "siyuan_block_id", "text/x-siyuan-block-id",
    ];
    for (const type of customTypes) {
      try {
        const raw = e.dataTransfer.getData(type);
        if (!raw) continue;
        getLogger().info(`[REword] 策略1 类型 [${type}] 数据:`+ raw.slice(0, 200));
        // 可能是纯 ID 或 JSON {id: "..."} 格式
        // 思源块 ID 格式不限于十六进制（可能含 w/x/y/z 等字母），仅校验长度
        const trimmed = raw.trim();
        if (/^[a-z0-9_-]{14,}$/i.test(trimmed)) { getLogger().debug("[REword] ✅ 策略1命中(纯ID): " + trimmed); return trimmed; }
        // 尝试 JSON 解析
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id && /^[a-z0-9_-]{14,}$/i.test(parsed.id)) { getLogger().debug("[REword] ✅ 策略1命中(JSON.id): " + parsed.id); return parsed.id; }
          if (parsed.blockId && /^[a-z0-9_-]{14,}$/i.test(parsed.blockId)) { getLogger().debug("[REword] ✅ 策略1命中(JSON.blockId): " + parsed.blockId); return parsed.blockId; }
        } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { const parsed = JSON.parse(trimmed); if (parsed.id && /^[a…", "debug"); }
      } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { const parsed = JSON.parse(trimmed); if (parsed.id && /^[a…", "debug"); }
    }

    // 策略 2: 从 text/plain 中提取
    try {
      const plainText = e.dataTransfer.getData("text/plain") || "";
      getLogger().info("[REword] 策略2 text/plain:" + plainText.slice(0, 200));
      // siyuan:// 块链接: siyuan://blocks/<blockId>
      const blockLink = plainText.match(/siyuan:\/\/blocks\/([a-z0-9_-]{14,})/i);
      if (blockLink) { getLogger().debug("[REword] ✅ 策略2命中(siyuan链接): " + blockLink[1]); return blockLink[1]; }
      // 纯 blockId 格式（14+ 位字母数字）
      const plainMatch = plainText.match(/\b([a-z0-9_-]{18,})\b/i);
      if (plainMatch) { getLogger().debug("[REword] ✅ 策略2命中(纯ID): " + plainMatch[1]); return plainMatch[1]; }
    } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { const plainText = e.dataTransfer.getData(\"text/plain\") ||…", "debug"); }

    // 策略 3: 尝试从拖拽源元素获取（部分浏览器支持）
    try {
      const target = e.target as HTMLElement | null;
      const dragEl = target?.closest("[data-node-id]") as HTMLElement | null;
      if (dragEl) {
        const nodeId = dragEl.dataset.nodeId || "";
        // 保留原始连字符（思源 API 不识别去连字符格式，否则列表块等拉不到正文）
        if (/^[a-z0-9-]{14,}$/i.test(nodeId)) { getLogger().debug("[REword] ✅ 策略3命中(目标元素nodeId): " + nodeId); return nodeId; }
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { const target = e.target as HTMLElement | null; const drag…", "debug"); }

    getLogger().info("[REword] 所有策略均未命中，返回 null");
    return null;
  }

  /**
   * 获取拖拽事件的回退文本内容（当无法解析为块 ID 时使用）
   * 优先级：dragstart 记录的选中文本 > dataTransfer text/plain
   */
  resolveDragFallbackText(e: DragEvent): string | null {
    // 优先使用 dragstart 记录的文本
    if (this.draggingBlockText) {
      const text = this.draggingBlockText;
      this.draggingBlockText = null; // 一次性消费
      return text.trim() || null;
    }
    // 回退到 dataTransfer
    if (!e.dataTransfer) return null;
    try {
      return (
        e.dataTransfer.getData("text/plain")?.trim() ||
        e.dataTransfer.getData("text/x-siyuan-text")?.trim() ||
        null
      );
    } catch {
      return null;
    }
  }

  /**
   * 从 HTML 片段（text/html）中按文档顺序解析所有思源块 ID。
   * 思源复制/拖拽多块时，text/html 内含多个带 data-node-id 的元素。
   * 依次提取、去重并去除连字符（与 resolveDragBlockId 的清洗规则一致）。
   */
  resolveBlockIdsFromHtml(html: string): string[] {
    if (!html) return [];
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const ids: string[] = [];
      const seen = new Set<string>();
      doc.querySelectorAll("[data-node-id]").forEach((el) => {
        const raw = el.getAttribute("data-node-id") || "";
        // 保留原始连字符（思源 API 不识别去连字符格式，否则列表块等拉不到正文）
        if (/^[a-z0-9-]{14,}$/i.test(raw) && !seen.has(raw)) {
          seen.add(raw);
          ids.push(raw);
        }
      });
      getLogger().info("[REword] resolveBlockIdsFromHtml 解析到块 ID:" + ids);
      return ids;
    } catch (e) {
      getLogger().warn("[REword] 解析 HTML 块 ID 失败:", { error: e });
      return [];
    }
  }

  /**
   * 从拖拽事件中解析思源文档 ID（A 任务：思源页签拖入识别）
   *
   * 实际识别逻辑在 src/ai/drag-doc-id.ts（纯函数模块，便于单测）。
   * 本方法仅做"日志 + 委托"。
   *
   * 适用场景：
   *  - 顶部页签栏拖出（.layout-tab-bar 内 li[data-id]）
   *  - 文档树节点拖出（.sy__file / .b3-list .file-tree 容器内的 li[data-id]）
   *  - 任何不在 [data-node-id] 块链上、但 ancestor 在 tab-bar/file-tree 内的 [data-id] 元素
   */
  resolveDragDocId(e: DragEvent): string | null {
    if (!e.dataTransfer) return null;
    getLogger().info("[REword] resolveDragDocId types:" + [...e.dataTransfer.types]);
    const id = extractDocIdFromDrag(e);
    if (id) getLogger().info("[REword] ✅ resolveDragDocId 命中: " + id);
    return id;
  }

  /**
   * 读取整篇文档正文（拼装 markdown，截断 12k）。
   * A 任务：页签拖入时使用。
   *
   * 2026-08-21 P0 修复：先做 SQL 探针看 docId 在思源里到底是什么角色（根/子块/不存在）,
   * 然后再调 getDocText;同时让 getDocText 抛错而非静默。
   */
  async fetchDocText(docId: string): Promise<string | null> {
    if (!docId) return null;
    try {
      // SQL 探针:看 docId 在 blocks 表里是否真的有这一行
      try {
        const { sqlQuery } = await import("./siyuan/attrs.ts");
        const probe = await sqlQuery<{ id: string; type: string; root_id: string; markdown: string; content: string }>(
          `SELECT id, type, root_id, markdown, content FROM blocks WHERE id='${docId}' LIMIT 1`
        );
        if (probe && probe.length > 0) {
          const r = probe[0];
          getLogger().info(
            `[REword] fetchDocText 探针: docId=${docId} type=${r.type} root_id=${r.root_id} content_len=${(r.content || "").length} markdown_len=${(r.markdown || "").length}`
          );
        } else {
          getLogger().warn(`[REword] fetchDocText 探针: docId=${docId} 在 blocks 表中 0 行（页签 data-id 可能不是块 ID）`);
        }
      } catch (probeErr) {
        getLogger().warn(`[REword] fetchDocText 探针失败: ${(probeErr as Error)?.message || probeErr}`);
      }
      const { getDocText } = await import("./ai/ai-doc-search.ts");
      const text = await getDocText(docId);
      if (!text) {
        getLogger().warn("[REword] fetchDocText 返回空: docId=" + docId + " len=" + docId.length);
        return null;
      }
      return text;
    } catch (e) {
      getLogger().error("[REword] fetchDocText 异常: docId=" + docId + " len=" + docId.length + " err=" + ((e as Error)?.message || e), { error: e });
      return null;
    }
  }

  /** 文档标题提示（用于结果展示；取不到则返回 undefined） */
  private docTitleHint(docId: string): string | undefined {
    // 轻量：直接用 rootID 前若干位作为占位；如需真实标题可由 getDocInfo 扩展
    return undefined;
  }

  /**
   * 收藏单词到词库(联动 vocabStore);支持字符串或 DeepReadWord,可选目标本 + 例句/标签关联
   * 2026-08-22 释义偏好:单点 AI 精读收藏,弹偏好选择窗(用 DeepReadWord.definitions 归一化)
   */
  async collectWord(
    word: string | DeepReadWord,
    bookId?: string,
    themeId?: string,
    opts?: { example?: string; markUnmastered?: boolean; inheritThemeTags?: boolean; skipDefinitionPick?: boolean }
  ): Promise<{ added: boolean }> {
    if (!this.isReady) throw new Error("词库未就绪");
    let w: DeepReadWord;
    let sensesForPick: SenseItem[] = [];
    if (typeof word === "string") {
      const meta = this.extractWordMeta(word);
      w = { word, phonetic: meta.phonetic, pos: meta.pos, meaning: meta.meaning || "" };
      sensesForPick = meta.senses;
    } else {
      w = word;
      sensesForPick = this.normalizeSensesForPick(w.word, w);
    }
    // 2026-08-22 释义偏好:弹窗(可跳过,例如批量场景)
    let preferredDefinitions: string[] = [];
    if (!opts?.skipDefinitionPick && sensesForPick.length > 0) {
      const pick = await this.showPickDefinitionsDialog(w.word, sensesForPick);
      preferredDefinitions = pick.preferredDefinitions;
    }
    const labelIds: string[] = [];
    if (opts?.markUnmastered) {
      try { labelIds.push(this.vocabLabelStore.add("未掌握").id); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { labelIds.push(this.vocabLabelStore.add(\"未掌握\").id); }", "debug"); }
    }
    if (opts?.inheritThemeTags) {
      const docId = this.lastDeepReadDocId || "";
      const tags = await this.getDocTagLabels(docId);
      for (const t of tags) {
        try { labelIds.push(this.vocabLabelStore.add(t).id); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { labelIds.push(this.vocabLabelStore.add(t).id); }", "debug"); }
      }
    }
    const r = await this.vocabStore.addWord(
      w.word,
      {
        phonetic: w.phonetic,
        pos: w.pos,
        meaning: w.meaning,
        labels: labelIds.length ? labelIds : undefined,
        example: opts?.example ? opts.example : undefined,
        preferredDefinitions: preferredDefinitions.length ? preferredDefinitions : undefined,
      },
      bookId,
      themeId
    );
    this.refreshVocabPanelIfVisible();
    return { added: r.added };
  }

  /**
   * 词库变更后，仅在侧边栏当前停留在「词库」Tab 时才重绘词库面板。
   * 避免从 AI 精读/查词典/批注等 Tab 中执行收藏后，把整个 dock 内容覆盖成词库列表。
   */
  private refreshVocabPanelIfVisible(): void {
    if (!this.dockElement) return;
    const activeTab = this.dockElement.querySelector(".hiword-dock-tab.active") as HTMLElement | null;
    if (activeTab?.dataset.tab === "vocab") {
      this.renderVocabPanel(this.dockElement);
    }
  }

  /**
   * 创建微阅批注管理器的宿主适配器（IWhaleHost 实现）
   * 将插件能力桥接为标准接口，解耦 whale-manager 与 index.ts 细节。
   */
  private createWhaleHost(): IWhaleHost {
    const self = this; // 避免箭头函数中的 this 问题
    return {
      getSelectionText() {
        const selected = self.getSelectionTextPrecise()?.trim() || self.lastSelectionCache?.text;
        if (!selected) return null;
        const blockId = self.getSelectionBlockId() || self.lastSelectionCache?.blockId;
        if (!blockId) return null;
        // 实时选区可用则取句上下文；已折叠（如点击弹窗后）回退缓存的句子
        const liveSentence = self.extractContextSentence();
        const sentence = liveSentence || self.lastSelectionCache?.sentence || selected;
        const docId = self.getSelectionDocId(blockId) || self.lastSelectionCache?.docId || "";
        return { text: selected, blockId, docId, sentence };
      },
      async upsertAnnotation(params) {
        // 2026-08-17：落库时计算选中文本在块内的字符偏移，
        // 供行内标记优先按偏移稳定定位（文本被编辑后再回退文本匹配）。
        let start: number | undefined;
        let end: number | undefined;
        if (params.blockId && params.selectedText) {
          const blockEl = document.querySelector(
            `[data-node-id="${self.escapeAttr(params.blockId)}"]`
          ) as HTMLElement | null;
          const t = blockEl?.textContent || "";
          const i = t.indexOf(params.selectedText);
          if (i !== -1) {
            start = i;
            end = i + params.selectedText.length;
          }
        }
        const result = await self.annotationStore.upsert({
          id: params.id,
          blockId: params.blockId,
          docId: params.docId,
          sentence: params.sentence,
          selectedText: params.selectedText,
          start,
          end,
          note: params.note,
          origin: "manual",
          color: params.color || getDefaultAnnotationColor(), // 默认=用户配置色
          style: params.style || getDefaultAnnotationStyle(),
          scope: params.scope || "word",
          lineColor: params.lineColor || params.color || getDefaultAnnotationColor(),
          labels: params.labels || [],
          tags: params.tags || [],
          category: params.category,
        });
        self.applyAnnotationBlockMarks();
        self.renderDockIfTab("annotations");
        // 直接返回 upsert 结果（已含准确 id，避免按 sentence 误匹配）
        return result;
      },
      async removeAnnotation(id: string) {
        const ann = self.annotationStore.get(id); // remove 前取（remove 后 get 已过滤软删）
        const ok = await self.annotationStore.remove(id);
        if (ok) {
          self.refreshAnnotationMarkers();
          self.renderDockIfTab("annotations");
          // 2026-08-24：广播 → 打开中的阅读面板立即清除该高亮
          if (ann?.bookId) notifyAnnotationsChanged(ann.bookId);
        }
        return ok;
      },
      jumpToBlock(blockId: string) { self.openAnnotationBlock(blockId); },
      copyText(text: string) { self.copyText(text); },
      showMessage(msg: string, type?: "info" | "success" | "error") {
        showMessage(msg, 2500, type as any);
      },
      // 2026-08-14 修：思源 Electron 禁用 window.prompt，桥接到自定义输入弹窗
      promptInput: (msg: string, def?: string) => self.copilotPromptDialog(msg, def ?? ""),
      // 2026-08-15 拆分：批注标签库桥接（独立于词库标签）
      getLabels: () => self.annotationLabelStore.getAll(),
      addLabel: async (name: string) => self.annotationLabelStore.add(name),
      // 2026-08-15 新增：管理标签弹窗（重命名/删除/换色）
      renameLabel: async (id: string, name: string) => self.annotationLabelStore.rename(id, name),
      removeLabel: async (id: string) => self.annotationLabelStore.remove(id),
      cycleLabelColor: async (id: string) => self.annotationLabelStore.cycleColor(id),
      manageLabels: () => self.openLabelManagementDialog("annotation"),
      // 2026-08-22 新增：微阅批注 AI 助手桥接
      getAiSettings: () => self.aiSettings,
      openAiSettings: () => self.openAiSettings(),
      // 动态 import 避免 ai 模块反向依赖 index.ts
      openAnnoAiDialog: (aopts) => {
        import("./ai/anno-ai-dialog.ts").then((m) => {
          m.openAnnoAiDialog({
            selectedText: aopts.selectedText,
            sentence: aopts.sentence,
            blockId: aopts.blockId,
            docId: aopts.docId,
            existingNote: aopts.existingNote,
            // 2026-08-22 改:透传 parentDialog(原批注弹窗),AI 弹窗贴它旁边
            parentDialog: aopts.parentDialog,
            onFillBack: aopts.onFillBack,
            getAiSettings: () => self.aiSettings,
            openAiSettings: () => self.openAiSettings(),
            showMessage: (msg, type) => {
              // 桥接到思源 showMessage(type 与思源枚举对齐)
              if (type === "success") showMessage(msg, 2500, "info" as any);
              else if (type === "error") showMessage(msg, 3000, "error" as any);
              else showMessage(msg, 2500, "info" as any);
            },
          });
        }).catch((err) => {
          getLogger().error("[REword-AnnoAI] 动态 import anno-ai-dialog 失败:", err);
          showMessage("打开 AI 助手失败：模块加载错误", 3000, "error" as any);
        });
      },
    };
  }

  /** 把句子加入批注（联动 annotationStore，并刷新块标记） */
  async annotateSentence(
    sentence: string,
    blockId?: string,
    note?: string,
    color?: string,
    style?: string,
    tags?: string[]
  ): Promise<void> {
    const bid = blockId || this.lastDeepReadBlockId;
    const docId = this.lastDeepReadDocId || this.getSelectionDocId(bid) || "";
    if (!bid) {
      showMessage("无法定位来源块，句子批注失败", 2500, "error" as any);
      return;
    }
    await this.annotationStore.upsert({
      blockId: bid,
      docId,
      sentence,
      selectedText: sentence, // 整句作为行内高亮锚点
      note: note || "",
      origin: "manual",
      color: color || "#4285f4", // 默认蓝色
      style: (style as any) || "solid", // 默认单实线
      tags: tags || [],
    });
    this.applyAnnotationBlockMarks();
    showMessage("已添加句子批注", 2000, "success" as any);
    // 2026-08-27 修复（Tab 覆盖）：按 Tab 刷新，不再覆盖非批注 Tab 的当前内容
    this.renderDockIfTab("annotations");
  }

  /**
   * 清理失效批注：回收「来源块已从文档中删除」的孤儿批注（2026-08-17 新增）。
   * 仅以当前已渲染的编辑区 DOM 为存在性判据（未打开的文档块不计入），
   * 因此建议在文档均已打开后执行；可通过命令「RE word: 清理失效批注」触发。
   */
  async pruneOrphanAnnotations(): Promise<number> {
    const present = new Set<string>();
    document.querySelectorAll(".protyle-wysiwyg [data-node-id]").forEach((el) => {
      const id = (el as HTMLElement).dataset?.nodeId;
      if (id) present.add(id);
    });
    const count = await this.annotationStore.pruneOrphans((bid) => present.has(bid));
    if (count > 0) {
      this.applyAnnotationBlockMarks();
      this.renderDockIfTab("annotations");
      showMessage(`已清理 ${count} 条失效批注（来源块已删除）`, 2500, "info" as any);
    } else {
      showMessage("没有需要清理的失效批注", 2000, "info" as any);
    }
    return count;
  }

  /** 打开微阅风格批注弹窗（AI 面板「插入批注」与工具栏入口统一） */
  openAnnotationDialog(opts: {
    blockId?: string;
    docId?: string;
    sentence: string;
    selectedText: string;
    existing?: AnnotationItem;
  }): void {
    // 兜底：优先用本次来源块，其次用最近精读块；仍为空则提示先定位块
    const blockId = opts.blockId || this.lastDeepReadBlockId || "";
    if (!blockId) {
      showMessage("未定位到来源块：请先在文档中点击该文段，再插入批注", 3000, "info" as any);
      return;
    }

    if (this.whaleManager) {
      this.whaleManager.showWhaleDialog({
        blockId,
        docId: opts.docId || this.lastDeepReadDocId || "",
        sentence: opts.sentence,
        selectedText: opts.selectedText,
        existing: opts.existing,
      });
    } else {
      // 兜底：whaleManager 未就绪时直接落一条默认批注
      void this.annotateSentence(opts.sentence, blockId, opts.selectedText);
    }
  }

  /** 复制文本到剪贴板 */
  copyText(text: string): void {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      showMessage("已复制", 1500, "info" as any);
    } catch {
      showMessage("复制失败", 1500, "error" as any);
    }
  }

  /** 将 Markdown 保存为思源笔记文档 */
  async saveToNote(opts: {
    markdown: string;
    notebookId: string;
    path: string;
    title: string;
    openAfterSave: boolean;
  }): Promise<string> {
    const { markdown, notebookId, path, title, openAfterSave } = opts;
    if (!notebookId) throw new Error("未选择笔记本");
    if (!markdown.trim()) throw new Error("内容为空");

    const now = new Date();
    const defaultTitle = `AI 对话 ${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const docTitle = title.trim() || defaultTitle;
    const docPath = path.trim() ? `${path.replace(/\/$/, "")}/${docTitle}` : `/${docTitle}`;

    const docId = await createDocWithMd(notebookId, docPath, markdown);
    if (!docId) throw new Error("创建文档失败");

    if (openAfterSave) {
      try {
        // 通过思源协议打开文档
        window.open(`siyuan://blocks/${docId}`);
      } catch {
        // 忽略打开失败
      }
    }
    return docId;
  }

  /** 列出所有笔记本 */
  async listNotebooks(): Promise<{ id: string; name: string }[]> {
    try {
      const nbs = await lsNotebooks();
      return nbs.filter((n) => !n.closed).map((n) => ({ id: n.id, name: n.name }));
    } catch (e) {
      getLogger().warn("[REword] 列出笔记本失败:", { error: e });
      return [];
    }
  }

  /** 列出文档树（递归一层） */
  async listDocTree(notebookId: string, path = ""): Promise<{ id: string; name: string; path: string; children?: any[] }[]> {
    try {
      const nodes = await listDocsByPath(notebookId, path);
      const build = (arr: any[]): any[] => arr.map((n) => ({
        id: n.id,
        name: n.name || n.title || "未命名",
        path: n.path || `${path}/${n.name || n.title || "未命名"}`,
        children: n.children?.length ? build(n.children) : undefined,
      }));
      return build(nodes);
    } catch (e) {
      getLogger().warn("[REword] 列出文档树失败:", { error: e });
      return [];
    }
  }

  /** 自定义确认弹窗（替代原生 window.confirm，避免阻塞/丑陋的原生对话框） */
  private copilotConfirmDialog(message: string): Promise<boolean> {
    return confirmDelete(message);
  }

  /** 自定义输入弹窗（替代原生 window.prompt，返回输入值或 null） */
  private copilotPromptDialog(message: string, defaultValue = ""): Promise<string | null> {
    return new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "whale-dlg-overlay";
      ov.innerHTML = `
        <div class="whale-dlg whale-confirm" role="dialog" aria-modal="true">
          <div class="whale-dlg-head">
            <span class="whale-dlg-title">${this.escapeHtml(message)}</span>
            <div class="whale-dlg-head-right">
              <button class="whale-dlg-close" id="cp-pd-cancel" title="取消">✕</button>
            </div>
          </div>
          <div class="whale-confirm-body">
            <input class="hiword-ann-prompt-input" id="cp-pd-input" value="${this.escapeHtml(defaultValue)}" autocomplete="off" />
          </div>
          <div class="whale-dlg-foot">
            <span class="whale-dlg-spacer"></span>
            <button class="whale-dlg-btn" id="cp-pd-cancel2">取消</button>
            <button class="whale-dlg-btn whale-dlg-btn--primary" id="cp-pd-ok">确定</button>
          </div>
        </div>
      `;
      document.body.appendChild(ov);

      const input = ov.querySelector("#cp-pd-input") as HTMLInputElement;
      const done = (val: string | null) => {
        ov.remove();
        resolve(val);
      };

      // 自动聚焦并全选
      setTimeout(() => { input?.focus(); input?.select(); }, 30);
      input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); done(input.value.trim()); }
        else if (e.key === "Escape") { e.preventDefault(); done(null); }
      });
      ov.addEventListener("mousedown", (e) => { if (e.target === ov) done(null); });
      ov.querySelector("#cp-pd-cancel")?.addEventListener("click", () => done(null));
      ov.querySelector("#cp-pd-cancel2")?.addEventListener("click", () => done(null));
      ov.querySelector("#cp-pd-ok")?.addEventListener("click", () => done(input.value.trim()));
    });
  }

  /**
   * 主题 chip 的右键菜单（2026-08-14 新增）：
   *  弹出菜单提供「重命名 / 删除」两项操作，弥补之前主题只能增不能管的缺口。
   *  使用简单 Menu 而非 popup，定位自适应不超出视口。
   * @returns 用户选择 "rename" | "delete" | null（取消）
   */
  private showThemeContextMenu(theme: { id: string; name: string; words: unknown[] }, anchor: HTMLElement): Promise<"rename" | "delete" | null> {
    return new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "whale-dlg-overlay hiword-theme-menu-overlay";
      ov.innerHTML = `
        <div class="hiword-theme-menu" role="menu">
          <button class="hiword-theme-menu-item" data-act="rename">✎ 重命名</button>
          <button class="hiword-theme-menu-item hiword-theme-menu-item--danger" data-act="delete">🗑 删除（${(theme as any).words.length} 词）</button>
          <button class="hiword-theme-menu-item" data-act="cancel">取消</button>
        </div>
      `;
      document.body.appendChild(ov);

      // 定位（参考 showInlineAnnotationPopover 的避裁切策略）
      const r = anchor.getBoundingClientRect();
      const mw = 200;
      const mh = 120;
      let top = r.bottom + 4;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
      let left = Math.min(r.left, window.innerWidth - mw - 8);
      left = Math.max(8, left);
      const menu = ov.querySelector(".hiword-theme-menu") as HTMLElement;
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;

      const done = (val: "rename" | "delete" | null) => {
        ov.remove();
        resolve(val);
      };

      ov.addEventListener("mousedown", (e) => { if (e.target === ov) done(null); });
      ov.querySelector('[data-act="rename"]')?.addEventListener("click", () => done("rename"));
      ov.querySelector('[data-act="delete"]')?.addEventListener("click", () => done("delete"));
      ov.querySelector('[data-act="cancel"]')?.addEventListener("click", () => done(null));
    });
  }

  /** 查询批注（本地过滤，基于 AnnotationStore） */
  async queryAnnotations(query?: import("./annotation/annotation-query.ts").AnnotationQuery): Promise<AnnotationQueryResult> {
    return queryAnns(this.annotationStore.getAll(), query);
  }

  /** 获取所有被批注过的文档 ID 列表 */
  async getAnnotatedDocIds(): Promise<string[]> {
    const ids = new Set(this.annotationStore.getAll().map((a) => a.docId).filter(Boolean));
    return [...ids];
  }

  // ========== AI 精读 · 模型 / 文档 / 模板 / 预设（P0，对标 Copilot） ==========

  /** 切换当前模型并持久化（header 模型下拉） */
  async setModel(model: string): Promise<void> {
    const m = (model || "").trim();
    if (!m) return;
    this.aiSettings.model = m;
    // 若不在预设列表，则追加，便于下次下拉直接选择
    if (!this.aiSettings.models.includes(m)) {
      this.aiSettings.models = [m, ...this.aiSettings.models];
    }
    await this.saveAiSettings();
  }

  /** 搜索文档（标题+路径模糊匹配；空关键词返回最近更新的文档列表） */
  async searchDocs(keyword: string): Promise<AiDocSearchResult[]> {
    try {
      return await searchAiDocs(keyword, 50);
    } catch (e) {
      getLogger().warn("[REword] 文档搜索失败:", { error: e });
      return [];
    }
  }

  /** 读取文档正文（用于添加上下文） */
  async getDocText(docId: string): Promise<string> {
    try {
      return await getAiDocText(docId, 12000);
    } catch {
      return "";
    }
  }

  /** 读取文档的标签（SiYuan 块属性 tags，逗号分隔），用于批量入库时继承主题标签 */
  async getDocTagLabels(docId: string): Promise<string[]> {
    if (!docId) return [];
    try {
      const resp: any = await fetchSyncPost("/api/attr/getBlockAttrs", { id: docId });
      const raw = resp?.data?.tags || "";
      if (!raw) return [];
      return String(raw).split(",").map((s: string) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** 提示词模板 CRUD */
  listPromptTemplates(): AiPromptTemplate[] {
    return this.promptTemplateStore.list();
  }
  async savePromptTemplate(tpl: AiPromptTemplate): Promise<void> {
    await this.promptTemplateStore.upsert(tpl);
  }
  async deletePromptTemplate(id: string): Promise<void> {
    await this.promptTemplateStore.remove(id);
  }

  /** 预设 CRUD */
  listPresets(): AiPreset[] {
    return this.aiPresetStore.list();
  }
  getActivePreset(): AiPreset | undefined {
    return this.aiPresetStore.getActive();
  }
  async savePreset(p: AiPreset): Promise<void> {
    await this.aiPresetStore.upsert(p);
  }
  async deletePreset(id: string): Promise<void> {
    await this.aiPresetStore.remove(id);
  }
  async setActivePreset(id: string): Promise<void> {
    await this.aiPresetStore.setActive(id);
  }

  /** 获取词库目标（单词本/主题两级，供批量入库下拉） */
  getVocabTargets(): {
    books: { id: string; name: string; themes: { id: string; name: string }[] }[];
  } {
    return {
      books: this.vocabStore.getBooks().filter((b) => b.id !== ALL_BOOK_ID).map((b) => ({
        id: b.id,
        name: b.name,
        themes: b.themes.map((t) => ({ id: t.id, name: t.name })),
      })),
    };
  }

  /** 批量入库单词（含音标/词性/释义） */
  async collectWords(
    words: DeepReadWord[],
    bookId?: string,
    themeId?: string
  ): Promise<{ added: number; skipped: number }> {
    if (!this.isReady) throw new Error("词库未就绪");
    let added = 0;
    let skipped = 0;
    for (const w of words) {
      if (!w.word) continue;
      // 2026-08-27 优化词典释义：把用户整理的释义按中文标点切分为首选数组，
      // 写入 preferredDefinitions → 查词卡命中 isPreferredSense 加 ⭐ 置顶、复习卡也用用户的释义。
      const preferred = (w.meaning || "")
        .split(/[，,；;／/、]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await this.vocabStore.addWord(
        w.word,
        {
          phonetic: w.phonetic,
          pos: w.pos,
          meaning: w.meaning,
          preferredDefinitions: preferred.length ? preferred : undefined,
        },
        bookId,
        themeId
      );
      if (r.added) added++;
      else skipped++;
    }
    if (this.dockElement) this.renderVocabPanel(this.dockElement);
    return { added, skipped };
  }

  /** 将标签名列表解析为已存在/新建的标签 id 列表（批量入库用，操作词库标签域） */
  resolveLabelNames(names: string[]): string[] {
    const ids: string[] = [];
    for (const n of names) {
      const name = (n || "").trim();
      if (!name) continue;
      try { ids.push(this.vocabLabelStore.add(name).id); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · resolveLabelNames", "debug"); }
    }
    return ids;
  }

  /** 批量写入句子批注（note = 结构 + 译文），返回成功数 */
  async annotateSentences(
    sents: DeepReadSentence[],
    blockId?: string,
    opts?: { category?: string; labels?: string[]; fillNote?: boolean }
  ): Promise<number> {
    const bid = blockId || this.lastDeepReadBlockId || "";
    if (!bid) {
      showMessage("无法定位来源块，请先在文档中定位再批量批注", 3000, "error" as any);
      return 0;
    }
    const docId = this.lastDeepReadDocId || this.getSelectionDocId(bid) || "";
    const model = this.aiSettings.model;
    const fillNote = opts?.fillNote ?? true;
    const extraLabels: string[] = opts?.labels ? [...opts.labels] : [];
    const CATEGORY_COLOR: Record<string, string> = {
      important: "#4285f4",
      hard: "#ea4335",
      todo: "#fbbc04",
      schedule: "#34a853",
    };
    const color = opts?.category ? (CATEGORY_COLOR[opts.category] || "#4285f4") : "#4285f4";
    let ok = 0;
    for (const s of sents) {
      if (!s.sentence) continue;
      const structure = s.structure ? `结构：${s.structure}` : "";
      const translation = s.translation ? `译文：${s.translation}` : "";
      const note = fillNote ? [structure, translation].filter(Boolean).join("；") : "";
      await this.annotationStore.upsert({
        blockId: bid,
        docId,
        sentence: s.sentence,
        selectedText: s.sentence,
        note,
        origin: "ai",
        color,
        style: "solid",
        category: (opts?.category as any) || undefined,
        labels: extraLabels.length ? extraLabels : undefined,
        ai: model ? { model } : undefined,
      });
      ok++;
    }
    this.applyAnnotationBlockMarks();
    showMessage(`已批量添加 ${ok} 条 AI 批注`, 2000, "success" as any);
    // 2026-08-27 修复（Tab 覆盖）：按 Tab 刷新，不覆盖非批注 Tab 的当前内容
    this.renderDockIfTab("annotations");
    return ok;
  }

  /**
   * 初始化侧边栏 Dock（Plan A：组合栏为主，独立 Dock 按需）。
   *  - 组合栏（主功能侧边栏）：始终注册，承载「收入组合栏」的全部功能 Tab；
   *  - 独立 Dock：仅为「停靠到左/右/下栏」的功能注册，按 slot 落在对应角落；
   *  - combined / hidden 功能【不注册】独立 Dock —— 从根上杜绝「所有图标都跑出来」的杂乱。
   * 布局由 this.dockManager 决定，持久化于 hiword-dock-layout.json。
   */
  private initDockPanels() {
    // 2026-08-29 移动端适配 Phase 5：dock 初始宽度按屏幕尺寸折算
    // - 桌面 320（沿用旧默认）
    // - 平板（iPad/Android Tablet）360（更宽一点方便触屏点击）
    // - 手机（iPhone/Android Phone）取视口宽度的 92%
    const dockWidth = isSmallMobile()
      ? Math.round((typeof window !== "undefined" ? window.innerWidth : 320) * 0.92)
      : isLargeMobile() ? 360 : 320;
    // ===== 组合 Dock（始终注册，承载 combined 功能的 Tab；保证 this.dockElement 有效）=====
    try {
      const combinedIds = this.dockManager.getCombinedFeatureIds();
      const dockResult: any = this.addDock({
        config: {
          position: "RightBottom" as const,
          size: { width: dockWidth, height: 0 },
          icon: ICON_REWORD,
          title: "RE word",
        },
        data: {},
        type: "hiword-sidebar",
        init: (dock?: any) => {
          this.dockElement = dock.element;
          this.renderCombinedDockShell(dock.element, combinedIds);
        },
        update: () => { this.refreshActivePanel(); },
        destroy: () => { destroyAllPreviews(); this.dockElement = null; },
      });
      this.dockModel = (dockResult as any)?.model;
    } catch (e) {
      getLogger().error("[REword] 组合 Dock 注册失败:", { operation: "初始化-侧边栏", error: e });
    }

    // ===== 独立 Dock（仅注册非 combined/非 hidden 的功能；按 slot 停靠到对应侧栏）=====
    for (const { feature, slot } of this.dockManager.getStandaloneFeatures()) {
      try {
        this.registerStandaloneDock(feature, slot, dockWidth);
      } catch (e) {
        getLogger().error(`[REword] 独立 Dock 注册失败 (${feature.id}):`, { operation: "初始化-侧边栏", error: e });
      }
    }
    // 兜底修正已渲染的独立/组合 dock 图标（缓存乱码双保险）
    requestAnimationFrame(() => this.fixStandaloneDockIcons());
  }

  /** 注册一个功能的独立 Dock（幂等：已注册则跳过）。用于初始化与「拖出到角落」运行时扩展 */
  private registerStandaloneDock(f: DockableFeature, slot: DockSlot, dockWidth = 320): void {
    if (this.standaloneElements.has(f.id)) return;
    if (slot === "combined" || slot === "hidden") return;
    const dockResult: any = this.addDock({
      config: {
        position: slot as any,
        // 独立 dock 沿用组合 dock 同样的响应式宽度（避免侧栏左右宽度不一致）
        size: { width: dockWidth, height: 0 },
        icon: f.icon,
        title: f.title,
        show: true,
      },
      data: {},
      type: "hiword-standalone-" + f.id,
      init: (dock?: any) => {
        this.standaloneElements.set(f.id, dock.element);
        dock.element.innerHTML = `<div class="hiword-dock-panel"><div class="hiword-dock-content" id="hiword-dock-content"></div></div>`;
        this.exposeDockContentDelegation(dock.element);
        this.renderFeatureInto(f.id, dock.element);
        this.applyFontSize();
      },
      update: () => {
        const el = this.standaloneElements.get(f.id);
        if (el) this.renderFeatureInto(f.id, el);
      },
      destroy: () => { destroyAllPreviews(); this.standaloneElements.delete(f.id); this.standaloneModels.delete(f.id); },
    });
    this.standaloneModels.set(f.id, (dockResult as any)?.model);
  }

  /** 渲染组合栏外壳（Tab 栏 + 内容区 + 头部按钮），combined 功能作为 Tab 呈现 */
  private renderCombinedDockShell(dockElement: HTMLElement, combinedIds: string[]) {
    const tabsHtml = combinedIds.length
      ? combinedIds.map((id, i) => `<button class="hiword-dock-tab${i === 0 ? " active" : ""}" data-tab="${id}">${this.featureTitle(id)}</button>`).join("")
      : `<div class="hiword-dock-empty">所有功能已移至独立侧边栏</div>`;
    dockElement.innerHTML = `
      <div class="hiword-dock-panel">
        <div class="hiword-dock-header">
          <div class="hiword-dock-tabs">${tabsHtml}</div>
          <div class="hiword-dock-header-actions">
            <button class="hiword-dock-settings-btn" id="hiword-settings-btn" title="全局设置">⚙️</button>
            <button class="hiword-dock-settings-btn" id="hiword-dock-layout-btn" title="面板布局管理（可拖拽功能到角落 / 组合栏）">📐</button>
            <button class="hiword-dock-settings-btn" id="hiword-reload-btn" data-action="reload-plugin" title="重载插件">🔄</button>
          </div>
        </div>
        <div class="hiword-dock-content" id="hiword-dock-content"></div>
      </div>`;

    dockElement.querySelector(".hiword-dock-tabs")?.addEventListener("click", (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("hiword-dock-tab")) {
        destroyAllPreviews();
        dockElement.querySelectorAll(".hiword-dock-tab").forEach((t: Element) => t.classList.remove("active"));
        target.classList.add("active");
        this.renderFeatureInto(target.dataset.tab!, dockElement);
      }
    });

    dockElement.querySelector("#hiword-settings-btn")?.addEventListener("click", () => this.openUnifiedSettings());
    dockElement.querySelector("#hiword-dock-layout-btn")?.addEventListener("click", () => this.openDockManagerPanel());

    if (combinedIds.length > 0) this.renderFeatureInto(combinedIds[0], dockElement);
    this.exposeDockContentDelegation(dockElement);
    this.applyFontSize();
  }

  /** 重新渲染组合栏 Tab（功能在组合栏 / 独立栏之间移动后调用） */
  private refreshCombinedDock(): void {
    if (!this.dockElement) return;
    const combinedIds = this.dockManager.getCombinedFeatureIds();
    const activeTab = this.dockElement.querySelector(".hiword-dock-tab.active") as HTMLElement | null;
    const activeId = activeTab?.dataset.tab ?? undefined;
    this.renderCombinedDockShell(this.dockElement, combinedIds);
    // 恢复此前激活的 Tab（若该功能仍在组合栏内），避免拖动功能时组合栏内容乱跳
    if (activeId && combinedIds.includes(activeId)) {
      const dockEl = this.dockElement;
      const tab = dockEl.querySelector(`.hiword-dock-tab[data-tab="${activeId}"]`) as HTMLElement | null;
      if (tab) {
        dockEl.querySelectorAll(".hiword-dock-tab").forEach((t: Element) => t.classList.remove("active"));
        tab.classList.add("active");
        this.renderFeatureInto(activeId, dockEl);
      }
    }
  }

  /** 给某个 Dock 根元素绑定 #hiword-dock-content 的点击委托（词库/批注等交互） */
  private exposeDockContentDelegation(dockElement: HTMLElement) {
    dockElement.querySelector("#hiword-dock-content")?.addEventListener("click", (e: Event) => {
      this.handleDockClick(e, dockElement);
    });
  }

  /** 取功能显示名 */
  private featureTitle(id: string): string {
    return this.dockManager.getFeatures().find((f) => f.id === id)?.title ?? id;
  }

  /** 将指定功能渲染进给定 Dock 元素（各功能共用 #hiword-dock-content 结构） */
  private renderFeatureInto(id: string, dockElement: HTMLElement) {
    let contentEl = dockElement.querySelector("#hiword-dock-content") as HTMLElement | null;
    if (!contentEl) {
      dockElement.innerHTML = `<div class="hiword-dock-panel"><div class="hiword-dock-content" id="hiword-dock-content"></div></div>`;
      contentEl = dockElement.querySelector("#hiword-dock-content");
    }
    if (id === "vocab") this.renderVocabPanel(dockElement);
    else if (id === "dict") this.renderDictPanel(dockElement);
    else if (id === "annotations") this.renderAnnotationsPanel(dockElement);
    else if (id === "ai") this.renderAiPanel(dockElement);
    else if (id === "review") this.renderReviewPanel(dockElement);
    else if (id === READER_FEATURE_ID) {
      try {
        this.readerDock?.render(dockElement);
      } catch (e) {
        getLogger().warn("[REword] 渲染阅读器面板失败", { error: e });
      }
    }
  }

  /**
   * 每次加载都清空【本插件】在「local-plugin-docks」中的缓存。
   *
   * 为什么必须每次清空（而非一次性）：
   * 思源在插件初始化（In）时会用该缓存【整体覆盖】每个 dock 的 config（含 icon / title /
   * position）。旧版本残留的过期 icon id 会让 genButton 渲染的 <use xlink:href="#旧id"> 指向
   * 不存在的 symbol，导致侧边栏独立 dock 图标渲染成乱码（> / #）。
   * 本函数在 onload 中、且早于思源的 In 渲染执行，因此清空后 In 必然采用本插件当前的 config
   * （正确图标），从根上消除乱码。
   * 插件自身的停靠位置由 hiword-dock-layout.json + moveFeatureToSlot 管理，与思源原生缓存无关，
   * 清空本插件缓存不影响布局持久化。
   */
  private async clearStaleDockCache(): Promise<void> {
    try {
      const root = (window as any).siyuan?.storage?.["local-plugin-docks"];
      if (root && typeof root === "object" && root[this.name] && typeof root[this.name] === "object") {
        for (const k of Object.keys(root[this.name])) delete root[this.name][k];
      }
      getLogger().info("[REword] 已清空本插件 Dock 缓存（local-plugin-docks），确保图标/位置采用当前配置");
    } catch (e) {
      getLogger().warn("[REword] 清理 Dock 缓存失败", { error: e });
    }
  }

  /** 修正已渲染 dock 图标的兜底：强制把 <use> 指向本功能正确的 symbol id。
   *  思源会用 local-plugin-docks 缓存整体覆盖 config.icon，若缓存残留旧 id 会渲染乱码；
   *  本函数直接修正 DOM，与 clearStaleDockCache 双保险，且覆盖「插件热重载不重跑 In」的场景。 */
  private fixStandaloneDockIcons(): void {
    const apply = (type: string, iconId: string) => {
      const use = document.querySelector(`.dock__item[data-type="${type}"] svg use`) as SVGUseElement | null;
      if (use) {
        const href = "#" + iconId;
        use.setAttribute("xlink:href", href);
        use.setAttribute("href", href);
      }
    };
    const prefix = this.name;
    for (const { feature } of this.dockManager.getStandaloneFeatures()) {
      apply(prefix + "hiword-standalone-" + feature.id, feature.icon);
    }
    apply(prefix + "hiword-sidebar", ICON_REWORD);
  }

  /**
   * 一次性面板布局迁移（v2）：将布局重置为「全部收入组合栏」的干净状态。
   * 解决此前「所有功能独立图标都跑出来、侧边栏杂乱」的问题——组合栏是功能的默认归宿，
   * 只有用户主动拖出到角落时才生成独立 Dock。旧布局（hiword-dock-layout.json）可能残留
   * standalone 配置导致杂乱，重置一次即可让新的默认值（全部 combined）生效。
   */
  private async migrateDockLayoutOnce(): Promise<void> {
    const marker = "hiword-dock-layout-migrated-v2";
    let done = false;
    try { done = !!(await this.loadData(marker)); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · migrateDockLayoutOnce", "debug"); }
    if (done) return;
    try {
      await this.saveData("hiword-dock-layout.json", {});
      getLogger().info("[REword] 已重置面板布局为组合栏默认（全部功能收入组合栏）");
    } catch (e) {
      getLogger().warn("[REword] 面板布局迁移失败", { error: e });
    }
    try { await this.saveData(marker, true); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · migrateDockLayoutOnce", "error"); }
  }

  /** 根据 data-type 找到承载该 dock 的思源 Dock 实例（left/right/bottom） */
  private findDockByType(type: string): any {
    const layout = (window as any).siyuan?.layout;
    if (!layout) return null;
    for (const d of [layout.leftDock, layout.rightDock, layout.bottomDock]) {
      if (d && d.data && d.data[type]) return d;
    }
    return null;
  }

  /** 仅控制独立 dock 栏图标的显隐（不触碰面板内容，避免误开/误关） */
  private setStandaloneDockVisible(id: string, visible: boolean): void {
    const type = this.name + "hiword-standalone-" + id;
    const item = document.querySelector(`.dock__item[data-type="${type}"]`) as HTMLElement | null;
    if (!item) return;
    if (visible) {
      item.classList.remove("fn__none");
      item.style.display = "";
    } else {
      item.classList.add("fn__none");
      item.style.display = "none";
    }
  }

  /** 强制关闭某功能的独立 dock 面板 */
  private closeStandaloneDockPanel(id: string): void {
    const type = this.name + "hiword-standalone-" + id;
    const dock = this.findDockByType(type);
    if (!dock) return;
    try {
      // 思源 toggleModel(ge, xe, Ze, at, ot)：关闭逻辑位于 `if (pt.active || at)` 内，
      // 仅传 (type,false,true) 时 at=false，面板未处于 active 则整段跳过 → 关不掉（死面板）。
      // 第 4 参 at=true 强制进入关闭分支，无论面板当前是否 active。
      dock.toggleModel?.(type, false, true, true);
    } catch (e) {
      getLogger().warn(`[REword] 关闭独立 Dock 面板失败 (${id})`, { error: e });
    }
  }

  /** 解析 slot 对应的思源 Dock 实例与分栏 index（0=上/左分组，1=下/右分组） */
  private resolveTargetDock(slot: DockSlot): { dock: any; index: number } {
    const layout = (window as any).siyuan?.layout;
    switch (slot) {
      case "LeftTop": return { dock: layout.leftDock, index: 0 };
      case "LeftBottom": return { dock: layout.leftDock, index: 1 };
      case "RightTop": return { dock: layout.rightDock, index: 0 };
      case "RightBottom": return { dock: layout.rightDock, index: 1 };
      // 底部栏「底部」落区：与 registerStandaloneDock 用 position:"Bottom"（经思源 genButton 得 index 0）保持一致，
      // 统一落在底部左侧，避免「首次拖放=左下、再次拖放=右下」的左右跳变。
      case "Bottom": return { dock: layout.bottomDock, index: 0 };
      default: return { dock: layout.rightDock, index: 1 };
    }
  }

  /**
   * 运行时即时移动某功能 dock 到目标位置（无需重载思源）。
   * - combined / hidden：隐藏独立 dock（若存在），并刷新组合栏 Tab 将其收纳为组合栏入口；
   * - Left/Right/Bottom：确保独立 dock 已注册（combined → 角落时按需创建），再用思源原生
   *   Dock.add() 跨栏迁移图标与面板（自动持久化）。
   * 返回 "moved" 表示即时生效；"reload-needed" 表示无法运行时完成。
   */
  private moveFeatureToSlot(id: string, slot: DockSlot): "moved" | "reload-needed" {
    const f = this.dockManager.getFeatures().find((x) => x.id === id);
    if (!f) return "reload-needed";
    if (slot === "combined" || slot === "hidden") {
      // 收入组合栏 / 隐藏：先关闭可能仍打开的独立面板，再隐藏图标，最后把功能作为 Tab 收纳进组合栏
      this.closeStandaloneDockPanel(id);
      this.setStandaloneDockVisible(id, false);
      this.refreshCombinedDock();
      return "moved";
    }
    // 独立停靠：确保独立 Dock 已注册（combined → 角落时按需创建），再跨栏迁移
    const alreadyRegistered = this.standaloneElements.has(id);
    try {
      this.registerStandaloneDock(f, slot);
    } catch (e) {
      getLogger().warn(`[REword] 注册独立 Dock 失败 (${id} -> ${slot})`, { error: e });
      return "reload-needed";
    }
    this.setStandaloneDockVisible(id, true);
    // 移动后立即兜底修正图标（覆盖思源 local-plugin-docks 缓存污染的 icon）
    requestAnimationFrame(() => this.fixStandaloneDockIcons());
    if (alreadyRegistered) {
      const type = this.name + "hiword-standalone-" + id;
      const item = document.querySelector(`.dock__item[data-type="${type}"]`) as HTMLElement | null;
      const { dock: targetDock, index } = this.resolveTargetDock(slot);
      if (item && targetDock) {
        try {
          targetDock.add(index, item);
        } catch (e) {
          getLogger().warn(`[REword] 移动 Dock 失败 (${id} -> ${slot})`, { error: e });
        }
      }
    }
    // 若原在组合栏，刷新移除其 Tab
    this.refreshCombinedDock();
    return "moved";
  }

  /** 布局完全就绪后，隐藏「组合栏/隐藏」功能的独立 dock 图标（避免与组合栏总览重复显示） */
  public onLayoutReady() {
    try {
      for (const f of this.dockManager.getFeatures()) {
        const slot = this.dockManager.getSlot(f.id);
        if (slot === "combined" || slot === "hidden") {
          // 关闭残留的独立面板（避免「有面板没图标」的死面板），再隐藏图标
          this.closeStandaloneDockPanel(f.id);
          this.setStandaloneDockVisible(f.id, false);
        }
      }
      // 布局就绪后再兜底修正一次独立 Dock 图标（缓存污染兜底）
      requestAnimationFrame(() => this.fixStandaloneDockIcons());
    } catch (e) {
      getLogger().warn("[REword] onLayoutReady 隐藏组合栏独立 Dock 失败", { error: e });
    }
  }

  /** 聚焦某功能的承载 Dock（组合栏切 Tab / 独立 Dock 调 showDock） */
  private focusFeatureDock(id: string) {
    const slot = this.dockManager.getSlot(id);
    if (slot !== "combined" && slot !== "hidden") {
      this.standaloneModels.get(id)?.showDock?.();
    } else {
      this.dockModel?.showDock?.();
      const tab = this.dockElement?.querySelector(`.hiword-dock-tab[data-tab="${id}"]`) as HTMLElement | null;
      tab?.click();
    }
  }

  /** 取某功能当前承载它的 Dock 根元素（独立 Dock 优先，否则组合栏） */
  private getFeatureElement(id: string): HTMLElement | null {
    const slot = this.dockManager.getSlot(id);
    if (slot !== "combined" && slot !== "hidden") {
      return this.standaloneElements.get(id) ?? this.dockElement;
    }
    return this.dockElement;
  }

  /** 刷新某功能（在其承载 Dock 中重绘；组合栏仅在对应 Tab 激活时才重绘，避免覆盖其它 Tab） */
  private refreshFeature(id: string) {
    const slot = this.dockManager.getSlot(id);
    if (slot !== "combined" && slot !== "hidden") {
      const el = this.standaloneElements.get(id);
      if (el) this.renderFeatureInto(id, el);
      return;
    }
    if (this.dockElement) {
      const activeTab = this.dockElement.querySelector(".hiword-dock-tab.active") as HTMLElement | null;
      if (!activeTab || activeTab.dataset.tab === id) {
        this.renderFeatureInto(id, this.dockElement);
      }
    }
  }

  /**
   * 面板布局管理（Phase 2 + Phase 3）：
   *  - 每个功能用下拉框选择停靠位置，改动即时生效（无需重载）；
   *  - 也可直接拖动功能行到屏幕对应角落（主侧边栏 / 左上 / 左下 / 右上 / 右下 / 底部）即时停靠。
   */
  private openDockManagerPanel() {
    const features = this.dockManager.getFeatures();
    const rows = features.map((f) => {
      const cur = this.dockManager.getSlot(f.id);
      const opts = SLOT_LABELS
        .map((s) => `<option value="${s.value}"${s.value === cur ? " selected" : ""}>${s.label}</option>`)
        .join("");
      return `<div class="hiword-dm-row" draggable="true" data-feature="${f.id}">
        <span class="hiword-dm-drag" title="拖动到屏幕角落以停靠">⠿</span>
        <span class="hiword-dm-name"><span class="hiword-dm-icon" data-feature="${f.id}"></span>${f.title}</span>
        <select class="hiword-dm-select b3-select" data-feature="${f.id}">${opts}</select>
      </div>`;
    }).join("");
    const dialog = new Dialog({
      title: "面板布局管理",
      content: `<div class="hiword-dm">
        <div class="hiword-dm-tip">选择停靠位置<strong>即时生效</strong>，无需重载；也可直接<strong>拖动功能行到屏幕对应角落</strong>（主侧边栏 / 左上 / 左下 / 右上 / 右下 / 底部）。同侧多个面板在思源中为堆叠互斥，需同时查看请分到不同侧。</div>
        ${rows}
        <div class="hiword-dm-actions">
          <button class="b3-button b3-button--outline hiword-dm-close" id="hiword-dm-close">关闭</button>
        </div>
      </div>`,
      width: responsiveDialogSize(460, "width"),
    });
    const content = dialog.element.querySelector(".hiword-dm") as HTMLElement;

    // 为每个功能名渲染对应图标（管理器内也能区分）
    content?.querySelectorAll<HTMLElement>(".hiword-dm-icon").forEach((ico) => {
      const fid = ico.dataset.feature!;
      const f = features.find((x) => x.id === fid);
      if (f) ico.innerHTML = `<svg class="hiword-dm-inline-icon"><use xlink:href="#${f.icon}"></use></svg>`;
    });

    // 下拉框：即时移动
    content?.querySelectorAll(".hiword-dm-select").forEach((sel) => {
      sel.addEventListener("change", async (e: Event) => {
        const target = e.target as HTMLSelectElement;
        const fid = target.dataset.feature!;
        const slot = target.value as DockSlot;
        await this.dockManager.setSlot(fid, slot);
        const res = this.moveFeatureToSlot(fid, slot);
        showMessage(res === "moved" ? "布局已即时应用" : "需重载思源生效", 1800, "info" as any);
      });
    });

    // 拖拽停靠：功能行可拖到屏幕角落
    content?.addEventListener("dragstart", (e: DragEvent) => {
      const row = (e.target as HTMLElement).closest(".hiword-dm-row") as HTMLElement | null;
      if (!row) return;
      (e.dataTransfer as any)?.setData("text/plain", row.dataset.feature || "");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      this.showDockDropZones();
    });
    content?.addEventListener("dragend", () => this.hideDockDropZones());

    content?.querySelector("#hiword-dm-close")?.addEventListener("click", () => dialog.destroy());
  }

  /** 显示拖拽落区 overlay（全屏六角） */
  private showDockDropZones() {
    let overlay = document.getElementById("hiword-dock-zones") as HTMLElement | null;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "hiword-dock-zones";
      overlay.className = "hiword-dock-zones";
      overlay.innerHTML = `
        <div class="hiword-dz hiword-dz-combined" data-slot="combined"><span>主侧边栏</span><em>组合栏总览</em></div>
        <div class="hiword-dz hiword-dz-lt" data-slot="LeftTop"><span>左上</span></div>
        <div class="hiword-dz hiword-dz-lb" data-slot="LeftBottom"><span>左下</span></div>
        <div class="hiword-dz hiword-dz-rt" data-slot="RightTop"><span>右上</span></div>
        <div class="hiword-dz hiword-dz-rb" data-slot="RightBottom"><span>右下</span></div>
        <div class="hiword-dz hiword-dz-bottom" data-slot="Bottom"><span>底部</span></div>`;
      document.body.appendChild(overlay);
      overlay.querySelectorAll<HTMLElement>(".hiword-dz").forEach((zone) => {
        zone.addEventListener("dragover", (e: DragEvent) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          zone.classList.add("hiword-dz--over");
        });
        zone.addEventListener("dragleave", () => zone.classList.remove("hiword-dz--over"));
        zone.addEventListener("drop", async (e: DragEvent) => {
          e.preventDefault();
          zone.classList.remove("hiword-dz--over");
          const fid = (e.dataTransfer as any)?.getData("text/plain") || "";
          const slot = zone.dataset.slot as DockSlot;
          this.hideDockDropZones();
          if (fid && slot) {
            await this.dockManager.setSlot(fid, slot);
            const res = this.moveFeatureToSlot(fid, slot);
            const sel = document.querySelector(`.hiword-dm-select[data-feature="${fid}"]`) as HTMLSelectElement | null;
            if (sel) sel.value = slot;
            showMessage(
              res === "moved"
                ? `${this.featureTitle(fid)} 已停靠到${this.slotLabel(slot)}`
                : "需重载思源生效",
              2000, "info" as any);
          }
        });
      });
    }
    requestAnimationFrame(() => overlay!.classList.add("hiword-dz-show"));
  }

  /** 隐藏拖拽落区 overlay */
  private hideDockDropZones() {
    const overlay = document.getElementById("hiword-dock-zones");
    if (overlay) overlay.classList.remove("hiword-dz-show");
  }

  /** slot 的中文标签 */
  private slotLabel(slot: DockSlot): string {
    return SLOT_LABELS.find((s) => s.value === slot)?.label ?? slot;
  }

  /**
   * 刷新词库面板（词典就绪后调用，确保简洁模式能显示实时释义）
   * 注意：此方法仅用于明确需要刷新词库的场景（如单词入库后）。
   * 词典切换后的通用刷新请使用 refreshActivePanel()，避免覆盖非词库 Tab 的内容。
   */
  private refreshVocabPanel() {
    if (this.dockElement) {
      this.renderVocabPanel(this.dockElement);
    }
  }

  /**
   * 智能刷新当前活跃 Tab 面板（词典切换/设置变更后调用）
   * 检测当前选中的 Tab 按钮，只重绘对应面板，避免词库内容覆盖查词典/AI 等界面
   */
  private refreshActivePanel() {
    // 组合栏：刷新当前激活 Tab
    if (this.dockElement) {
      destroyAllPreviews();   // 各 Tab 共用 #hiword-dock-content，刷新前先销毁只读预览防 detached 崩溃
      const activeTab = this.dockElement.querySelector(".hiword-dock-tab.active") as HTMLElement | null;
      const tab = activeTab?.dataset.tab;
      if (tab === "vocab") {
        this.renderVocabPanel(this.dockElement);
      } else if (tab === "dict") {
        this.renderDictPanel(this.dockElement);
      } else if (tab === "annotations") {
        this.renderAnnotationsPanel(this.dockElement);
      } else if (tab === "ai") {
        this.renderAiPanel(this.dockElement);
      } else if (tab === "review") {
        this.renderReviewPanel(this.dockElement);
      } else if (tab === READER_FEATURE_ID) {
        try {
          this.readerDock?.render(this.dockElement);
        } catch (e) {
          getLogger().warn("[REword] 刷新阅读器面板失败", { error: e });
        }
      }
    }
    // 独立 Dock（2026-08-22）：逐个重绘
    for (const [id, el] of this.standaloneElements) {
      this.renderFeatureInto(id, el);
    }
  }

  /**
   * 渲染词库面板内容（两级：单词本 > 主题；支持排序/掌握度星/拖拽）
   */
  private renderVocabPanel(dockElement: HTMLElement) {
    // 切换面板时自动停止列表朗读
    if (this._listReading) this.stopListReading();
    const contentEl = dockElement.querySelector("#hiword-dock-content") as HTMLElement;
    if (!contentEl) return;

    if (!this.isReady) {
      contentEl.innerHTML = `<div class="hiword-empty">插件尚未就绪</div>`;
      return;
    }

    const currentBookIsAll = this.vocabViewMaster;
    const book = currentBookIsAll ? this.vocabStore.getBook(ALL_BOOK_ID) : this.vocabStore.getActiveBook();
    const theme = currentBookIsAll ? book?.themes[0] : this.vocabStore.getActiveTheme();
    if (!book || !theme) {
      contentEl.innerHTML = `<div class="hiword-empty">词库为空</div>`;
      return;
    }

    const books = this.vocabStore.getBooks();
    const realBooks = books.filter((b) => b.id !== ALL_BOOK_ID);
    const words = this.vocabStore.getSortedWords(theme, this.vocabSort);
    this.vocabPage = 0;
    const visibleWords = this.applyVocabLabelFilter(words);

    contentEl.innerHTML = `
      <div class="hiword-vb-bar">
        <select class="b3-select hiword-vb-book" id="hiword-vb-book">
          ${books.map((b) => `<option value="${b.id}" ${b.id === book.id ? "selected" : ""}>${this.escapeHtml(b.name)}</option>`).join("")}
        </select>
        ${currentBookIsAll ? `<span class="hiword-vb-master-badge" title="总库为只读聚合，包含所有单词本与全部状态（已收藏/已毕业/已忽略）">总库只读</span>` : ""}
        <button class="b3-button b3-button--small b3-button--outline" id="hiword-vb-add-book" title="新建单词本" ${currentBookIsAll ? "style=\"display:none\"" : ""}>＋本</button>
        <button class="b3-button b3-button--small hiword-vb-del-book-btn" id="hiword-vb-del-book" title="删除当前单词本" ${currentBookIsAll || realBooks.length <= 1 ? "style=\"display:none\"" : ""}>✕</button>
      </div>
      <div class="hiword-vb-themes" id="hiword-vb-themes">
        ${book.themes
          .map((t) => `<span class="hiword-vb-theme ${t.id === theme.id ? "active" : ""}" data-theme="${t.id}">
            <span class="hiword-vb-theme-name">${this.escapeHtml(t.name)}</span>${!currentBookIsAll && t.name !== "未分类" ? `<button type="button" class="hiword-vb-theme-del" data-action="theme-delete" data-theme="${t.id}" title="删除分类（单词移至未分类）">✕</button>` : ""}
          </span>`)
          .join("")}
        ${currentBookIsAll ? "" : `<span class="hiword-vb-addtheme" id="hiword-vb-add-theme" title="新建主题">＋</span>`}
      </div>
      <!-- 2026-08-23 新增：文档内自动高亮词库单词开关 -->
      <div class="hiword-vb-autohighlight-row">
        <label class="hiword-vb-switch">
          <input type="checkbox" id="hiword-vb-autohighlight" ${this.vocabAutoHighlight ? "checked" : ""} />
          <span class="hiword-vb-switch-graph"></span>
        </label>
        <span class="hiword-vb-autohighlight-label">文档内自动高亮词库单词</span>
      </div>
      <!-- 2026-08-14 新增：标签横切筛选（不限词本/主题） -->
      ${this.renderVocabLabelFilterRow()}
      <div class="hiword-vb-toolbar">
        <input class="b3-text-field" id="hiword-vb-search" placeholder="搜索单词..." />
        <select class="b3-select" id="hiword-vb-sort" title="排序方式">
          <option value="time" ${this.vocabSort === "time" ? "selected" : ""}>纳入时间</option>
          <option value="mastery" ${this.vocabSort === "mastery" ? "selected" : ""}>熟悉程度</option>
          <option value="custom" ${this.vocabSort === "custom" ? "selected" : ""}>自定义</option>
        </select>
        <button class="b3-button b3-button--small hiword-vb-batch-btn" id="hiword-vb-batch" title="批量将选中单词分类到指定单词本 / 子类">⬚ 批量分类</button>
        <button class="b3-button b3-button--small hiword-vb-import-btn" id="hiword-vb-import" title="从思源文档/块拖入，或粘贴文本批量导入单词（含一级单词本 + 二级分类选择）">⬇ 导入</button>
        <div class="hiword-vb-readctrl" id="hiword-vb-readctrl">
          <button class="b3-button b3-button--small b3-button--primary" id="hiword-vb-readall" title="列表朗读（顺序播放所有单词）">▶ 朗读列表</button>
          <button class="b3-button b3-button--small" id="hiword-vb-readstop" title="停止朗读" style="display:none;">⏹ 停止</button>
          <span class="hiword-vb-readprog" id="hiword-vb-readprog" style="display:none;"></span>
        </div>
      </div>
      <div class="hiword-vb-list ${currentBookIsAll ? "hiword-vb-list--master" : ""}" id="hiword-vb-list">
        ${this.renderVocabWordRows(this.paginate(visibleWords))}
      </div>
      ${this.renderVocabPager(visibleWords.length)}
    `;

    // P4 在线音标兜底（词库列表：仅对缺音标且可见的行补写，静默降级）
    this.fillVocabListPhonetics(contentEl);
    this.bindVocabPager(contentEl, words);

    // 单词本切换（含「单词总库」聚合视图）
    contentEl.querySelector("#hiword-vb-book")?.addEventListener("change", (e) => {
      const id = (e.target as HTMLSelectElement).value;
      if (id === ALL_BOOK_ID) {
        this.vocabViewMaster = true;
      } else {
        this.vocabViewMaster = false;
        this.vocabStore.setActiveBook(id).then(() => this.renderVocabPanel(dockElement));
        return;
      }
      this.renderVocabPanel(dockElement);
    });
    // 文档内自动高亮开关(2026-08-23)
    contentEl.querySelector("#hiword-vb-autohighlight")?.addEventListener("change", (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.setVocabAutoHighlight(on);
    });
    // 新建单词本（2026-08-14 改：window.prompt 在思源 Electron 中常被禁用，改用自定义弹窗）
    contentEl.querySelector("#hiword-vb-add-book")?.addEventListener("click", async () => {
      const name = await this.copilotPromptDialog("新建单词本名称：", "我的单词本");
      if (name) this.vocabStore.addBook(name).then(() => this.renderVocabPanel(dockElement));
    });
    // 删除单词本（2026-08-15 新增；至少保留一个）
    contentEl.querySelector("#hiword-vb-del-book")?.addEventListener("click", async () => {
      if (realBooks.length <= 1) {
        showMessage("至少保留一个单词本，无法删除", 2000, "info");
        return;
      }
      const ok = await confirmDelete(`删除单词本「${book.name}」？\n该单词本及其下所有分类与单词将被删除。`);
      if (ok) {
        await this.vocabStore.removeBook(book.id);
        this.renderVocabPanel(dockElement);
      }
    });
    // 主题切换 / 删除（事件委托到 themes 容器）
    contentEl.querySelector("#hiword-vb-themes")?.addEventListener("click", async (e) => {
      // 删除分类按钮（优先处理，阻止冒泡以免触发切换）
      const delBtn = (e.target as HTMLElement).closest(".hiword-vb-theme-del") as HTMLElement | null;
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        const themeId = delBtn.dataset.theme || "";
        const theme = book.themes.find((x) => x.id === themeId);
        if (!theme) return;
        const ok = await confirmDelete(
          `删除分类「${theme.name}」？\n该分类下的 ${theme.words.length} 个单词会移入「未分类」（不删除单词）。`
        );
        if (ok) {
          await this.vocabStore.removeTheme(book.id, themeId);
          this.renderVocabPanel(dockElement);
        }
        return;
      }
      const t = (e.target as HTMLElement).closest(".hiword-vb-theme") as HTMLElement;
      if (t && t.dataset.theme) {
        this.vocabStore.setActiveTheme(t.dataset.theme).then(() => this.renderVocabPanel(dockElement));
      } else if ((e.target as HTMLElement).id === "hiword-vb-add-theme") {
        // 新建主题（同样改用自定义弹窗）
        const name = await this.copilotPromptDialog(
          "新建主题名称（如 工作职业/国家政绩/商业娱乐）：",
          "新主题"
        );
        if (name) {
          this.vocabStore.addTheme(book.id, name).then(() => this.renderVocabPanel(dockElement));
        }
      }
    });
    // 主题右键菜单（重命名 / 删除）—— 2026-08-14 新增，弥补之前缺少主题管理 UI
    contentEl.querySelector("#hiword-vb-themes")?.addEventListener("contextmenu", async (e) => {
      const t = (e.target as HTMLElement).closest(".hiword-vb-theme") as HTMLElement;
      if (!t || !t.dataset.theme) return;
      e.preventDefault();
      const themeId = t.dataset.theme;
      const theme = book.themes.find((x) => x.id === themeId);
      if (!theme) return;
      const action = await this.showThemeContextMenu(theme, t);
      if (action === "rename") {
        const newName = await this.copilotPromptDialog("重命名主题：", theme.name);
        if (newName) {
          await this.vocabStore.renameTheme(book.id, themeId, newName);
          this.renderVocabPanel(dockElement);
        }
      } else if (action === "delete") {
        const ok = await confirmDelete(
          `删除分类「${theme.name}」？\n该分类下的 ${theme.words.length} 个单词会移入「未分类」（不删除单词）。`
        );
        if (ok) {
          await this.vocabStore.removeTheme(book.id, themeId);
          this.renderVocabPanel(dockElement);
        }
      }
    });
    // 排序切换
    contentEl.querySelector("#hiword-vb-sort")?.addEventListener("change", (e) => {
      this.vocabSort = (e.target as HTMLSelectElement).value as VocabSort;
      this.renderVocabPanel(dockElement);
    });
    // 搜索（仅重渲染列表 + 150ms 防抖，P0-b / P1）
    const searchInput = contentEl.querySelector("#hiword-vb-search") as HTMLInputElement;
    let _vocabSearchTimer: number | undefined;
    searchInput?.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase().trim();
      if (_vocabSearchTimer) window.clearTimeout(_vocabSearchTimer);
      _vocabSearchTimer = window.setTimeout(() => {
        this.vocabPage = 0;
        const visible = this.applyVocabLabelFilter(words);
        const filtered = q
          ? visible.filter((w) => w.word.includes(q) || (w.meaning && w.meaning.includes(q)))
          : visible;
        this.refreshVocabList(contentEl, filtered);
      }, 150);
    });

    // ===== 标签横切筛选（2026-08-14 新增）=====
    contentEl.querySelectorAll("#hiword-vb-labels .hiword-vb-label").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.vocabLabelFilter = (btn as HTMLElement).dataset.filter || "all";
        this.renderVocabPanel(dockElement);
      });
    });

    // ===== 标签区收起/展开按钮（2026-08-15 新增，与批注面板 toggle 同样的交互）=====
    contentEl.querySelector("#hiword-vb-tags-collapse-btn")?.addEventListener("click", () => {
      this.toggleTagsCollapse("vocab", dockElement);
    });
    // ===== 词库标签管理弹窗入口（2026-08-15 拆分：独立词库标签域）=====
    contentEl.querySelector('[data-action="vocab-manage-labels"]')?.addEventListener("click", () => {
      this.openLabelManagementDialog("vocab");
    });

    // ===== 词卡标签交互（2026-08-14 新增：编辑/展开/折叠）=====
    contentEl.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("[data-action]") as HTMLElement;
      if (!t) return;
      const action = t.dataset.action;
      const word = (t.dataset.word || t.closest(".hiword-vb-row")?.getAttribute("data-word")) || "";
      if (action === "vocab-label-edit" && word) {
        e.stopPropagation();
        this.showVocabLabelEditDialog(word);
      } else if (action === "vocab-tags-expand" || action === "vocab-tags-collapse") {
        e.stopPropagation();
        const id = t.dataset.id || "";
        const row = contentEl.querySelector(`.hiword-vb-row[data-id="${id}"]`);
        if (!row) return;
        const hiddenWrap = row.querySelector(".hiword-vb-tag-chip--hidden") as HTMLElement | null;
        if (hiddenWrap) hiddenWrap.style.display = action === "vocab-tags-expand" ? "" : "none";
        // 切换按钮文字
        if (action === "vocab-tags-expand") {
          t.setAttribute("data-action", "vocab-tags-collapse");
          t.textContent = "收起";
          t.setAttribute("title", "折叠标签");
        } else {
          const hidden = hiddenWrap?.children.length || 0;
          t.setAttribute("data-action", "vocab-tags-expand");
          t.textContent = `+${hidden} 展开`;
          t.setAttribute("title", `展开全部标签`);
        }
      } else if (action === "vocab-status-set" && word) {
        // 2026-08-22 新增 / 2026-08-23 改:词库面板"未掌握/已掌握/需复习/清除"切换
        // 2026-08-23 性能改:**不**调用 renderVocabPanel(否则会重建所有 chip + 触发 highlighter 全扫)
        // 改为只更新该单词行内的 4 颗 chip 的 active 状态(局部 DOM 更新,微秒级)
        e.stopPropagation();
        const raw = t.dataset.status ?? "";
        const nextStatus: LearningStatusT | "" = raw as any;
        if (nextStatus === "" || Object.values(LearningStatus).includes(nextStatus as any)) {
          const arg: LearningStatusT | null = nextStatus === "" ? null : (nextStatus as LearningStatusT);
          this.vocabStore.setLearningStatus(word, arg).then(() => {
            // 局部刷新:只更新目标行的 chip active 状态
            const safe = (window as any).CSS?.escape ? (window as any).CSS.escape(word) : word.replace(/"/g, '\\"');
            const row = contentEl.querySelector(
              `.hiword-vb-row[data-word="${safe}"]`
            ) as HTMLElement | null;
            if (row) {
              row.querySelectorAll(".hiword-vb-status-chip").forEach((chip) => {
                const cs = (chip as HTMLElement).dataset.status ?? "";
                // arg === null 表示清除态,与 data-status="" 匹配
                const isActive =
                  (cs === "" && arg === null) ||
                  (cs !== "" && cs === arg);
                chip.classList.toggle("active", !!isActive);
              });
            }
            // highlighter 会通过 store emit 自动重扫,无需手动触发
          });
        }
      } else if (action === "vocab-status-collapse") {
        // 2026-08-23 改:状态条**按单词独立**收起/展开(全局默认收起)
        // 2026-08-23 性能改:**不**重渲染整个面板(避免卡顿),只切该单词的 class + chevron
        // 根因(早期 bug):之前用全局 boolean 时,点一个全展开 — 与用户意图"独立控制"不符
        // 修复:用 Set<string> 记录已展开的单词,只切该单词的 DOM,其他单词完全不受影响
        e.stopPropagation();
        const word = t.dataset.word || "";
        if (!word) return;
        const willExpand = !this.vocabStatusBarExpandedWords.has(word);
        if (willExpand) {
          this.vocabStatusBarExpandedWords.add(word);
        } else {
          this.vocabStatusBarExpandedWords.delete(word);
        }
        // 持久化
        try {
          localStorage.setItem(
            "reword-vocab-status-expanded",
            JSON.stringify(Array.from(this.vocabStatusBarExpandedWords))
          );
        } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { localStorage.setItem( \"reword-vocab-status-expanded\", JSO…", "debug"); }
        // 局部刷新:只切该单词那根 bar 的 class 与 chevron
        const safe = (window as any).CSS?.escape ? (window as any).CSS.escape(word) : word.replace(/"/g, '\\"');
        const bar = contentEl.querySelector(
          `.hiword-vb-status-bar[data-status-bar-word="${safe}"]`
        ) as HTMLElement | null;
        if (bar) {
          bar.classList.toggle("hiword-vb-status-bar--collapsed", !willExpand);
          const btn = bar.querySelector(".hiword-vb-status-collapse") as HTMLElement | null;
          if (btn) {
            const text = willExpand ? "▴" : "▾";
            const t = willExpand ? "收起状态条" : "展开状态条";
            btn.textContent = text;
            btn.setAttribute("title", t);
            btn.setAttribute("aria-label", t);
          }
        }
      }
    });

    // ===== 列表朗读控制 =====
    const readAllBtn = contentEl.querySelector("#hiword-vb-readall") as HTMLButtonElement;
    const readStopBtn = contentEl.querySelector("#hiword-vb-readstop") as HTMLButtonElement;
    const readProg = contentEl.querySelector("#hiword-vb-readprog") as HTMLElement;

    readAllBtn?.addEventListener("click", () => {
      if (this._listReading) {
        // 正在朗读 → 切换暂停/继续
        this.toggleListReadPause();
      } else {
        // 开始新的列表朗读
        const currentWords = this.getCurrentVocabWords();
        if (currentWords.length === 0) {
          showMessage("当前列表没有单词", 2000, "info" as any);
          return;
        }
        this.startListReading(currentWords, dockElement);
      }
    });

    readStopBtn?.addEventListener("click", () => {
      this.stopListReading();
    });

    // 单词导入：拖入文档/块（或粘贴文本）→ 自动识别 → 选 L1 单词本 + L2 子类 → 批量入库
    contentEl.querySelector("#hiword-vb-import")?.addEventListener("click", () => this.showVocabImportDialog());
    this.bindVocabDropZone(contentEl);
    // 拖拽排序（仅在自定义排序下可拖；总库聚合视图禁用，避免对只读数据误操作）
    if (!currentBookIsAll) this.bindVocabDrag(dockElement, contentEl, theme.id);

    // ===== 批量分类（对话框，2026-08-18 重构：从面板内联批量态改为独立弹窗）=====
    contentEl.querySelector("#hiword-vb-batch")?.addEventListener("click", () => {
      this.showBatchClassifyDialog();
    });

    // 应用字体大小设置（每次渲染后重新应用，确保 class 不丢失）
    this.applyFontSize();
  }


  /**
   * 2026-08-22 新增 / 2026-08-23 扩：词库面板单词行下"未掌握/已掌握/需复习/清除"4 选 1 状态切换条 + 收起按钮。
   * 由 renderVocabWordRows 内联调用生成 HTML（不暴露到外部）。
   *  - 默认 active = learning（保持旧行为兼容）
   *  - 第 4 颗 ✕ = "清除样式"，点击 setLearningStatus(word, undefined) → 文档内不再高亮
   *  - 2026-08-23 改:右侧 ▾ 按钮切换**该单词的**展开/收起态(全局默认收起)
   *    - 展开集合 this.vocabStatusBarExpandedWords 持久化到 localStorage
   *    - 不在集合内 → 默认收起(只显示 chevron ▾)
   *    - 在集合内 → 展开(显示 4 颗 chip + chevron ▴)
   *  - 点击 chip 调 setLearningStatus → store emit → highlighter 自动重扫
   */
  private renderVocabStatusBar(w: { word: string; learningStatus?: string }): string {
    const cur = w.learningStatus as LearningStatusT | undefined; // undefined = 清除态
    // 2026-08-23 改:4 项 = 3 颜色 + 1 清除;status 为空字符串时,语义上视为 undefined
    const items: Array<{ status: LearningStatusT | ""; label: string; title: string }> = [
      { status: LearningStatus.Learning, label: "未掌握", title: "未掌握(黄色高亮)" },
      { status: LearningStatus.Mastered, label: "已掌握", title: "已掌握(绿色高亮)" },
      { status: LearningStatus.Review,    label: "需复习", title: "需复习(紫色高亮)" },
      { status: "" /* sentinel = 清除 */,     label: "✕",      title: "清除样式(文档内不再高亮)" },
    ];
    const word = this.escapeAttr(w.word);
    const chips = items.map((it) => {
      // 清除态:cur === undefined 且 status === ""
      const isActive = (it.status === "" && !cur) || (it.status !== "" && cur === it.status);
      // data-status 用空串表示"清除"
      const dataStatus = it.status;
      return `<button type="button"
              class="hiword-vb-status-chip${isActive ? " active" : ""}${it.status === "" ? " hiword-vb-status-chip--clear" : ""}"
              data-action="vocab-status-set"
              data-word="${word}"
              data-status="${dataStatus}"
              title="${it.title}">${it.label}</button>`;
    }).join("");
    // 2026-08-23 改:按单词独立判断 collapsed(不在 expanded 集合 = 收起)
    const isExpanded = this.vocabStatusBarExpandedWords.has(w.word);
    const collapsed = !isExpanded;
    const chevron = collapsed ? "▾" : "▴";
    const chevronTitle = collapsed ? "展开状态条" : "收起状态条";
    // collapsed class 控制 4 颗 chip 隐藏 / chevron 单独显示
    return `<div class="hiword-vb-status-bar${collapsed ? " hiword-vb-status-bar--collapsed" : ""}" data-status-bar-word="${word}">
      ${chips}
      <button type="button"
              class="hiword-vb-status-collapse"
              data-action="vocab-status-collapse"
              data-word="${word}"
              title="${chevronTitle}"
              aria-label="${chevronTitle}">${chevron}</button>
    </div>`;
  }

  /**
   * 2026-08-22 新增：把词库面板定位到指定 word,找不到时 showMessage 提示。
   * 先清空可能把目标过滤掉的 label 筛选。
   */
  private scrollVocabPanelToWord(word: string): void {
    // 1) 清空当前标签筛选(可能把目标过滤掉了)
    if (this.vocabLabelFilter && this.vocabLabelFilter !== "all") {
      this.vocabLabelFilter = "all";
      if (this.dockElement) this.renderVocabPanel(this.dockElement);
    }
    // 2) 找目标行
    const safe = (window as any).CSS?.escape ? (window as any).CSS.escape(word) : word.replace(/"/g, '\\"');
    const row = this.dockElement?.querySelector(
      `.hiword-vb-row[data-word="${safe}"]`
    ) as HTMLElement | null;
    if (!row) {
      showMessage(`「${word}」不在当前词本/主题中`, 2000, "info");
      return;
    }
    // 3) 滚动 + 闪烁
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.remove("whale-card--flash", "hiword-vb-row--flash");
    void row.offsetWidth;  // 强制 reflow 重新触发动画
    row.classList.add("whale-card--flash", "hiword-vb-row--flash");
    setTimeout(() => {
      row.classList.remove("whale-card--flash", "hiword-vb-row--flash");
    }, 2200);
  }

  /** 渲染单词行（一列一个：拖拽柄 + 单词 + 词性 + 意思 + 朗读 + 掌握度星 + 操作） */
  /**
   * 渲染词库单词列表——双模式卡片（简洁 / 详细）
   *
   * 简洁模式（默认）：单词 + 音标 + 按词性分组的 3-4 个释义
   * 详细模式：点击 📖 按钮展开完整词典内容
   *
   * 关键：词性与释义严格配对，不同词性的义项不会混淆
   */
  private renderVocabWordRows(words: WordRecord[], withSelect = false): string {
    if (words.length === 0) {
      // 2026-08-14 优化：「无标签」筛选时的空状态文案引导添加
      if (this.vocabLabelFilter === "__no_label__") {
        return `<div class="hiword-empty">这些词卡还没打标签<br/>点击任一词卡的「＋ 添加标签」按钮开始分类</div>`;
      }
      return `<div class="hiword-empty">该主题还没有单词<br/>查词时点 ★ 即可收藏到这里</div>`;
    }
    return words
      .map((w) => {
        try {
        // P0-a：优先命中词典解析缓存，避免每行同步查词导致卡顿
        const _cacheKey = this.dictManifest?.active || (this.dictReady ? "ready" : "none");
        if (_cacheKey !== this.vocabDictCacheKey) { this.vocabDictCache.clear(); this.vocabDictCacheKey = _cacheKey; }
        let cached = this.vocabDictCache.get(w.word);
        if (!cached && this.dictReady) {
          const entry = dictEngine.lookupSmart(w.word);
          if (entry) {
            const parsedEntry = dictRenderer.parseDictEntry(entry);
            const _phon = parsedEntry.phonetic || w.phonetic || "";
            const _groups = dictRenderer.extractSensesByPos(entry.definition, 1, 4, 90);
            const _infl = getWordInflections(w.word, _groups.map((g) => g.pos));
            cached = { phonetic: _phon, groups: _groups, inflections: _infl };
            this.vocabDictCache.set(w.word, cached);
          }
        }
        const groups: dictRenderer.PosSenseGroup[] = cached?.groups || [];
        const phonetic = cached?.phonetic || w.phonetic || "";
        const inflections = cached?.inflections;
        const hit = !!cached;

        // 主内容区：
        //   - 命中词典 → 展示完整简洁卡片（含实时释义/音标/变形）
        //   - 未命中但词典就绪 → 仍展示紧凑卡片（用已保存的 word/phonetic/meaning），
        //     附加小徽标提示"当前词典未收录"，不再显示联想词框（联想词框仅用于词典查询 Tab）
        //   - 词典未就绪 → 展示基础卡片（纯本地数据）
        const mainHtml = hit
          ? dictRenderer.renderVocabCompactCard(w.word, phonetic, groups, w.mastery, w.id, inflections, w.queryCount)
          : dictRenderer.renderVocabCompactCard(w.word, phonetic, groups, w.mastery, w.id, inflections, w.queryCount)
            + (this.dictReady ? `<div class="hiword-vb-dict-miss">当前词典未收录</div>` : "");

        // 掌握度星
        const starsHtml = this.renderMasteryStars(w.word, w.mastery);

        // 2026-08-14 新增：词卡标签行（可折叠 + 编辑入口）
        const tagsHtml = this.renderVocabRowTags(w);
        // 2026-08-22 新增：学习状态切换条（未掌握/已掌握/需复习）
        const statusBarHtml = this.renderVocabStatusBar(w);

        return `
        <div class="hiword-vb-row" draggable="${this.vocabSort === "custom" && !withSelect}" data-id="${w.id}" data-word="${this.escapeAttr(w.word)}">
          ${withSelect ? `<label class="hiword-vb-sel-wrap"><input type="checkbox" class="hiword-vb-sel" data-word="${this.escapeAttr(w.word)}"></label>` : `<span class="hiword-vb-drag" title="拖动排序">⋮⋮</span>`}
          <div class="hiword-vb-main">
            ${mainHtml}
            ${tagsHtml}
            ${statusBarHtml}
          </div>
          <div class="hiword-vb-right">
            ${starsHtml}
            <div class="hiword-vb-actions">
              <button class="hiword-vb-btn" data-action="tts" data-word="${this.escapeAttr(w.word)}" title="朗读">🔊</button>
              <button class="hiword-vb-btn" data-action="vocab-detail" data-word="${this.escapeAttr(w.word)}" title="详细释义">📖</button>
              <button class="hiword-vb-btn" data-action="unvocab" data-word="${this.escapeAttr(w.word)}" title="移出词库">✕</button>
            </div>
          </div>
        </div>
        <div class="hiword-vb-detail-panel" id="vb-detail-${this.escapeAttr(w.id)}" style="display:none;"></div>
        `;
        } catch (err) {
          getLogger().error("[REword] 渲染词卡失败: " + w.word, { error: err });
          return `<div class="hiword-vb-row hiword-vb-row--error" data-word="${this.escapeAttr(w.word)}"><span class="hiword-vb-card-word">${this.escapeHtml(w.word)}</span><span class="hiword-vb-dict-miss">词卡渲染失败</span></div>`;
        }
      })
      .join("");
  }

  /**
   * P4 在线音标兜底：遍历词库列表各行，对缺音标的行异步补写（静默降级）。
   * 每行容器为 `.hiword-vb-row`（data-word 携带单词），批量触发经
   * online-phonetic 模块的 MAX_CONCURRENT=3 限流 + 内存缓存，不会打爆内核代理。
   */
  private fillVocabListPhonetics(contentEl: HTMLElement): void {
    // 2026-08-15：在线兜底受设置开关控制
    if (!this.onlineSettings?.enabled) return;
    const rows = contentEl.querySelectorAll<HTMLElement>(".hiword-vb-row");
    for (const row of rows) {
      const w = row.dataset.word;
      if (!w) continue;
      // 行内已有音标文本 → 跳过
      const phonEl = row.querySelector<HTMLElement>(".hiword-vb-card-phon, .hiword-vb-detail-phon");
      if (phonEl && phonEl.textContent && phonEl.textContent.trim()) continue;
      maybeFillPhonetic(row, w);
    }
  }

  /** 词库列表分页：超过 pageSize 时只取当前页（P2 性能优化） */
  private paginate(words: WordRecord[]): WordRecord[] {
    if (words.length <= this.vocabPageSize) return words;
    const pages = Math.ceil(words.length / this.vocabPageSize);
    if (this.vocabPage >= pages) this.vocabPage = pages - 1;
    if (this.vocabPage < 0) this.vocabPage = 0;
    const start = this.vocabPage * this.vocabPageSize;
    return words.slice(start, start + this.vocabPageSize);
  }

  /** 分页器 HTML（词数 ≤ pageSize 时不渲染） */
  private renderVocabPager(total: number): string {
    if (total <= this.vocabPageSize) return "";
    const pages = Math.ceil(total / this.vocabPageSize);
    const cur = this.vocabPage + 1;
    return `<div class="hiword-vb-pager" id="hiword-vb-pager">
      <button class="b3-button b3-button--small" id="hiword-vb-prev" ${this.vocabPage <= 0 ? "disabled" : ""}>‹ 上一页</button>
      <span class="hiword-vb-pager-info">第 ${cur} / ${pages} 页 · 共 ${total} 词</span>
      <button class="b3-button b3-button--small" id="hiword-vb-next" ${this.vocabPage >= pages - 1 ? "disabled" : ""}>下一页 ›</button>
    </div>`;
  }

  /** 绑定分页器按钮（每次列表刷新后重绑） */
  private bindVocabPager(dockElement: HTMLElement, baseWords: WordRecord[]): void {
    const prev = dockElement.querySelector("#hiword-vb-prev") as HTMLButtonElement | null;
    const next = dockElement.querySelector("#hiword-vb-next") as HTMLButtonElement | null;
    const total = this.applyVocabLabelFilter(baseWords).length;
    if (total <= this.vocabPageSize) return;
    const pages = Math.ceil(total / this.vocabPageSize);
    prev?.addEventListener("click", () => {
      if (this.vocabPage > 0) { this.vocabPage--; this.refreshVocabList(dockElement, baseWords); }
    });
    next?.addEventListener("click", () => {
      if (this.vocabPage < pages - 1) { this.vocabPage++; this.refreshVocabList(dockElement, baseWords); }
    });
  }

  /** 仅重渲染词卡列表 + 分页器（搜索/翻页时调用，避免重建整面板，P1） */
  private refreshVocabList(dockElement: HTMLElement, baseWords: WordRecord[]): void {
    const listEl = dockElement.querySelector("#hiword-vb-list") as HTMLElement | null;
    const pagerEl = dockElement.querySelector("#hiword-vb-pager") as HTMLElement | null;
    const visible = this.applyVocabLabelFilter(baseWords);
    if (listEl) listEl.innerHTML = this.renderVocabWordRows(this.paginate(visible));
    if (pagerEl) pagerEl.outerHTML = this.renderVocabPager(visible.length);
    this.fillVocabListPhonetics(dockElement);
    this.bindVocabPager(dockElement, baseWords);
  }

  /**
   * 批量分类（2026-08-18 重构）：点击「批量分类」后弹出独立对话框，
   * 以紧凑单词卡片网格展示当前面板视图下的词库列表，用户在对话框内勾选目标单词并选择目标分类。
   * 风格与「提取单词到词库」弹窗（showExtractDialog）保持一致。
   */
  private showBatchClassifyDialog(): void {
    const currentBookIsAll = this.vocabViewMaster;
    const book = currentBookIsAll ? this.vocabStore.getBook(ALL_BOOK_ID) : this.vocabStore.getActiveBook();
    const theme = currentBookIsAll ? book?.themes[0] : this.vocabStore.getActiveTheme();
    if (!book || !theme) {
      showMessage("词库为空，无法批量分类", 2000, "info" as any);
      return;
    }
    const realBooks = this.vocabStore.getBooks().filter((b) => b.id !== ALL_BOOK_ID);
    if (realBooks.length === 0) {
      showMessage("尚未创建单词本，无法批量分类", 2000, "info" as any);
      return;
    }
    const words = this.applyVocabLabelFilter(this.vocabStore.getSortedWords(theme, this.vocabSort));

    // 目标默认：当前真实本（若是总库则第一个真实本）+ 其首个子类
    const initialBook = (!currentBookIsAll && book.id !== ALL_BOOK_ID ? book : realBooks[0]);
    const initialBookId = initialBook.id;
    const initialThemeId = initialBook.themes[0]?.id ?? "";

    const dialog = new Dialog({
      title: `批量分类（共 ${words.length} 词）`,
      width: responsiveDialogSize(560, "width"),
      height: "72vh",
      content: this.renderBatchClassifyDialogHtml(words, realBooks, initialBookId, initialThemeId),
    });

    this.bindBatchClassifyDialog(dialog.element, words, dialog);
  }

  /** 批量分类对话框 HTML 骨架：顶部目标分类区 + 搜索 + 卡片网格 + 底部操作栏 */
  private renderBatchClassifyDialogHtml(
    words: WordRecord[],
    realBooks: VocabBook[],
    bookId: string,
    themeId: string,
  ): string {
    const bookOptions = realBooks
      .map((b) => `<option value="${this.escapeAttr(b.id)}" ${b.id === bookId ? "selected" : ""}>${this.escapeHtml(b.name)}</option>`)
      .join("");
    const themeChips = this.renderBatchClassifyThemeChips(bookId, themeId);
    const cards = words.map((w) => this.renderBatchClassifyCard(w)).join("");
    return `
      <div class="hiword-bc-dialog">
        <div class="hiword-bc-toolbar">
          <span class="hiword-bc-label">目标单词本</span>
          <select class="b3-select hiword-bc-book" id="hiword-bc-book">${bookOptions}</select>
          <span class="hiword-bc-label">子类</span>
          <span class="hiword-bc-themes" id="hiword-bc-themes">${themeChips}</span>
          <button class="hiword-bc-toggle" id="hiword-bc-toggle" title="选中/取消当前可见全部单词">全选</button>
        </div>
        <input class="b3-text-field hiword-bc-search" id="hiword-bc-search" placeholder="搜索单词..." />
        <div class="hiword-bc-grid" id="hiword-bc-grid">${cards}</div>
        <div class="hiword-bc-footer">
          <span class="hiword-bc-count">已选 <b id="hiword-bc-count">0</b> 词</span>
          <div class="hiword-bc-actions">
            <button class="b3-button b3-button--small" id="hiword-bc-cancel">取消</button>
            <button class="b3-button b3-button--small b3-button--primary" id="hiword-bc-confirm">确认分类</button>
          </div>
        </div>
      </div>
    `;
  }

  /** 批量分类：渲染目标子类 chips（目标高亮） */
  private renderBatchClassifyThemeChips(bookId: string, themeId: string): string {
    const book = this.vocabStore.getBook(bookId);
    if (!book || book.themes.length === 0) {
      return `<span class="hiword-bc-themes-empty">暂无子类</span>`;
    }
    return book.themes
      .map(
        (t) =>
          `<button type="button" class="hiword-ex-theme ${t.id === themeId ? "active" : ""}" data-theme-id="${this.escapeAttr(t.id)}">${this.escapeHtml(t.name)}</button>`,
      )
      .join("");
  }

  /** 批量分类：单张紧凑单词卡片（label 包裹，点击任意位置切换勾选） */
  private renderBatchClassifyCard(w: WordRecord): string {
    const phon = w.phonetic ? `/${this.escapeHtml(w.phonetic)}/` : "";
    const meaningRaw = w.meaning ? w.meaning.split(/[;；]/)[0].trim() : "";
    const meaningHtml = meaningRaw
      ? `<div class="hiword-bc-meaning" title="${this.escapeAttr(meaningRaw)}">${this.escapeHtml(meaningRaw)}</div>`
      : "";
    return `
      <label class="hiword-bc-card" data-word="${this.escapeAttr(w.word)}">
        <input type="checkbox" class="hiword-bc-check" value="${this.escapeAttr(w.word)}" />
        <div class="hiword-bc-card-body">
          <div class="hiword-bc-word">${this.escapeHtml(w.word)}</div>
          ${phon ? `<div class="hiword-bc-phon">${phon}</div>` : ""}
          ${meaningHtml}
        </div>
      </label>
    `;
  }

  /** 批量分类：绑定对话框内全部交互（目标本/子类级联、全选、搜索、确认归类） */
  private bindBatchClassifyDialog(root: HTMLElement, _words: WordRecord[], dialog: Dialog): void {
    const bookSel = root.querySelector("#hiword-bc-book") as HTMLSelectElement | null;
    const themesWrap = root.querySelector("#hiword-bc-themes") as HTMLElement | null;
    const grid = root.querySelector("#hiword-bc-grid") as HTMLElement | null;
    const countEl = root.querySelector("#hiword-bc-count") as HTMLElement | null;
    const searchInput = root.querySelector("#hiword-bc-search") as HTMLInputElement | null;
    const toggleBtn = root.querySelector("#hiword-bc-toggle") as HTMLButtonElement | null;
    const checks = Array.from(root.querySelectorAll<HTMLInputElement>(".hiword-bc-check"));

    let pickedBookId = bookSel ? bookSel.value : "";
    let pickedThemeId = (themesWrap?.querySelector(".hiword-ex-theme.active") as HTMLElement | null)?.dataset.themeId || "";

    const updateCount = () => {
      const n = checks.filter((c) => c.checked).length;
      if (countEl) countEl.textContent = String(n);
      if (toggleBtn) toggleBtn.textContent = n === checks.length && checks.length > 0 ? "全不选" : "全选";
      checks.forEach((c) => {
        const card = c.closest(".hiword-bc-card") as HTMLElement | null;
        if (card) card.classList.toggle("hiword-bc-card--selected", c.checked);
      });
    };

    const bindThemes = (wrap: HTMLElement) => {
      wrap.querySelectorAll<HTMLElement>(".hiword-ex-theme").forEach((chip) => {
        chip.addEventListener("click", () => {
          pickedThemeId = chip.dataset.themeId || "";
          wrap.querySelectorAll(".hiword-ex-theme").forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
        });
      });
    };
    if (themesWrap) bindThemes(themesWrap);

    bookSel?.addEventListener("change", () => {
      pickedBookId = bookSel.value;
      const b = this.vocabStore.getBook(pickedBookId);
      pickedThemeId = b?.themes[0]?.id ?? "";
      if (themesWrap) {
        themesWrap.innerHTML = this.renderBatchClassifyThemeChips(pickedBookId, pickedThemeId);
        bindThemes(themesWrap);
      }
    });

    toggleBtn?.addEventListener("click", () => {
      const visibleChecks = checks.filter(
        (c) => (c.closest(".hiword-bc-card") as HTMLElement | null)?.style.display !== "none",
      );
      const allOn = visibleChecks.length > 0 && visibleChecks.every((c) => c.checked);
      visibleChecks.forEach((c) => (c.checked = !allOn));
      updateCount();
    });

    checks.forEach((c) => c.addEventListener("change", updateCount));

    searchInput?.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase().trim();
      const cardList = grid ? Array.from(grid.querySelectorAll<HTMLElement>(".hiword-bc-card")) : [];
      cardList.forEach((card) => {
        const word = (card.dataset.word || "").toLowerCase();
        card.style.display = !q || word.includes(q) ? "" : "none";
      });
    });

    root.querySelector("#hiword-bc-cancel")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("#hiword-bc-confirm")?.addEventListener("click", async () => {
      if (!pickedBookId || !pickedThemeId) {
        showMessage("请先选择目标单词本与子类", 2000, "info" as any);
        return;
      }
      const chosen = checks.filter((c) => c.checked).map((c) => c.value);
      if (chosen.length === 0) {
        showMessage("请先勾选要分类的单词", 2000, "info" as any);
        return;
      }
      const btn = root.querySelector("#hiword-bc-confirm") as HTMLButtonElement | null;
      if (btn) {
        btn.disabled = true;
        btn.textContent = "归类中…";
      }
      let moved = 0;
      for (const w of chosen) {
        const ok = await this.vocabStore.moveWord(w, pickedBookId, pickedThemeId);
        if (ok) moved++;
      }
      const bName = this.vocabStore.getBook(pickedBookId)?.name ?? "";
      const tName = this.vocabStore.getTheme(pickedBookId, pickedThemeId)?.name ?? "";
      dialog.destroy();
      if (this.dockElement) this.renderVocabPanel(this.dockElement);
      showMessage(`已将 ${moved} 个单词归类到「${bName}」/「${tName}」`, 3000, "success" as any);
    });
  }

  /** 词库标签横切筛选行（2026-08-14 新增：全部 + 各标签 chips；2026-08-15 改用独立词库标签域） */
  private renderVocabLabelFilterRow(): string {
    const labels = this.vocabLabelStore?.getAll() ?? [];
    if (labels.length === 0) return "";
    const chips = labels
      .map((l) => `<button type="button" class="hiword-vb-label ${this.vocabLabelFilter === l.id ? "active" : ""}" data-filter="${l.id}" style="--tag-color:${l.color}">#${this.escapeHtml(l.name)}</button>`)
      .join("");
    // 2026-08-14 新增：「无标签」筛选（labelStore 中不存在的特殊 filter id：__no_label__）
    const noLabelActive = this.vocabLabelFilter === "__no_label__" ? "active" : "";
    // 2026-08-15 新增：标签筛选区可折叠/展开（按钮始终可见）
    return `<div class="hiword-vb-labels-wrap ${this.vocabTagsCollapsed ? 'hiword-vb-labels-wrap--collapsed' : ''}">
      <button type="button" class="hiword-vb-tags-collapse-btn" id="hiword-vb-tags-collapse-btn"
              aria-expanded="${this.vocabTagsCollapsed ? 'false' : 'true'}" title="收起/展开标签筛选">
        ${this.vocabTagsCollapsed ? '🏷️ 标签 ▸ 展开' : '🏷️ 标签 ▾ 收起'}
      </button>
      <div class="hiword-vb-labels" id="hiword-vb-labels">
        <button type="button" class="hiword-vb-label ${this.vocabLabelFilter === "all" ? "active" : ""}" data-filter="all">全部</button>
        ${chips}
        <button type="button" class="hiword-vb-label hiword-vb-label--no-label ${noLabelActive}" data-filter="__no_label__" title="未打标签的词卡">🏷️ 无标签</button>
        <button type="button" class="hiword-vb-label-manage-btn" data-action="vocab-manage-labels" title="管理词库标签">⚙ 管理</button>
      </div>
    </div>`;
  }

  /** 2026-08-23 新增:词库驱动文档高亮总开关(词库面板控制) */
  private setVocabAutoHighlight(on: boolean): void {
    this.vocabAutoHighlight = on;
    try {
      localStorage.setItem("hiword-vocab-autohighlight", String(on));
    } catch {}
    const hl = getVocabHighlighter();
    hl.setEnabled(on);
  }

  /** 按当前标签筛选过滤单词（all=全部；no-label=无标签） */
  private applyVocabLabelFilter(words: WordRecord[]): WordRecord[] {
    if (this.vocabLabelFilter === "all" || this.vocabLabelFilter === "__all__" || !this.vocabLabelFilter) return words;
    if (this.vocabLabelFilter === "__no_label__") {
      return words.filter((w) => !(w.labels && w.labels.length > 0));
    }
    return words.filter((w) => (w.labels || []).includes(this.vocabLabelFilter));
  }

  /** 2026-08-15 新增：toggle 面板标签筛选区收起状态 + 持久化 */
  private toggleTagsCollapse(key: "whale" | "vocab", dockElement?: HTMLElement): void {
    if (key === "whale") {
      this.whaleTagsCollapsed = !this.whaleTagsCollapsed;
      try { localStorage.setItem("hiword-whale-tags-collapsed", String(this.whaleTagsCollapsed)); } catch {}
    } else {
      this.vocabTagsCollapsed = !this.vocabTagsCollapsed;
      try { localStorage.setItem("hiword-vocab-tags-collapsed", String(this.vocabTagsCollapsed)); } catch {}
    }
    // 不重渲染整个面板，只 toggle class + 按钮文字（避免破坏搜索/筛选状态）
    const wrapSelector = key === "whale" ? ".whale-panel-tabs-wrap" : ".hiword-vb-labels-wrap";
    const btnSelector = key === "whale" ? "#whale-tags-collapse-btn" : "#hiword-vb-tags-collapse-btn";
    const wrap = (dockElement || this.dockElement)?.querySelector(wrapSelector) as HTMLElement | null;
    const btn = (dockElement || this.dockElement)?.querySelector(btnSelector) as HTMLElement | null;
    if (!wrap || !btn) {
      // 找不到 wrap 时回退到重渲染（兜底）
      if (dockElement) this.renderVocabPanel(dockElement);
      else if (this.dockElement) {
        if (key === "whale") this.renderAnnotationsPanel(this.dockElement);
        else this.renderVocabPanel(this.dockElement);
      }
      return;
    }
    const collapsed = key === "whale" ? this.whaleTagsCollapsed : this.vocabTagsCollapsed;
    wrap.classList.toggle(`${wrapSelector.slice(1)}--collapsed`, collapsed);
    btn.textContent = collapsed ? "🏷️ 标签 ▸ 展开" : "🏷️ 标签 ▾ 收起";
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  /** 2026-08-14 新增：词卡标签行（可折叠，默认前 2 个 + 展开/编辑入口） */
  private renderVocabRowTags(w: WordRecord): string {
    const labels = this.vocabLabelStore?.getAll() ?? [];
    const wordLabels = w.labels || [];
    // 词卡已选标签的完整定义（取 id+name+color）
    const tagged = labels.filter((l) => wordLabels.includes(l.id));
    // 默认折叠：仅显示前 2 个
    const COLLAPSED_COUNT = 2;
    const visible = tagged.slice(0, COLLAPSED_COUNT);
    const hiddenCount = tagged.length - visible.length;
    const wEsc = this.escapeAttr(w.word);

    if (tagged.length === 0) {
      // 未打标签：占位引导
      return `<div class="hiword-vb-row-tags hiword-vb-row-tags--empty">
        <button type="button" class="hiword-vb-tag-empty-btn" data-action="vocab-label-edit" data-word="${wEsc}" title="为该词卡添加标签">＋ 添加标签</button>
      </div>`;
    }

    // 已打标签：chips + 折叠/展开 + 编辑入口
    const chipsHtml = visible.map((l) =>
      `<span class="hiword-vb-tag-chip" style="--tag-color:${l.color}" title="#${this.escapeHtml(l.name)}">#${this.escapeHtml(l.name)}</span>`
    ).join("");
    const expandBtn = hiddenCount > 0
      ? `<button type="button" class="hiword-vb-tags-expand" data-action="vocab-tags-expand" data-id="${this.escapeAttr(w.id)}" data-state="collapsed" title="展开全部 ${tagged.length} 个标签">+${hiddenCount} 展开</button>`
      : (tagged.length > COLLAPSED_COUNT
        ? `<button type="button" class="hiword-vb-tags-expand" data-action="vocab-tags-collapse" data-id="${this.escapeAttr(w.id)}" title="折叠">收起</button>`
        : "");
    const hiddenChips = hiddenCount > 0
      ? `<span class="hiword-vb-tag-chip hiword-vb-tag-chip--hidden" data-id="${this.escapeAttr(w.id)}" style="display:none;">${tagged.slice(COLLAPSED_COUNT).map((l) =>
          `<span class="hiword-vb-tag-chip" style="--tag-color:${l.color}">#${this.escapeHtml(l.name)}</span>`).join("")}</span>`
      : "";

    return `<div class="hiword-vb-row-tags" data-id="${this.escapeAttr(w.id)}">
      <span class="hiword-vb-tags-count" title="已选 ${tagged.length} 个标签">🏷️ ${tagged.length}</span>
      <span class="hiword-vb-tag-chips">${chipsHtml}${hiddenChips}</span>
      ${expandBtn}
      <button type="button" class="hiword-vb-tag-edit-btn" data-action="vocab-label-edit" data-word="${wEsc}" title="编辑标签">✎</button>
    </div>`;
  }

  /**
   * 词卡标签编辑弹窗（2026-08-14 新增）。
   * 顶部：当前已选标签 chips（可点击移除）
   * 中部：搜索框 + 已有标签列表（按字母排序，已选/未选视觉区分）
   * 底部：新建标签输入 + 创建按钮
   */
  private async showVocabLabelEditDialog(word: string): Promise<void> {
    const wordEsc = this.escapeHtml(word);
    // 获取当前词的已选标签（id 集合）—— 词库标签域
    const all = this.vocabLabelStore?.getAll() ?? [];
    const wordRecord = this.vocabStore.getAllWords().find((w: WordRecord) => w.word === word.toLowerCase());
    const selected: Set<string> = new Set(wordRecord?.labels || []);

    // 关闭已有同型弹窗
    document.querySelector(".hiword-vb-label-edit-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "hiword-vb-label-edit-overlay whale-dlg-overlay";
    overlay.id = "hiword-vb-label-edit-dialog";
    overlay.innerHTML = `
      <div class="whale-dlg" style="width:480px;">
        <div class="whale-dlg-head">
          <span class="whale-dlg-title">🏷️ 给「${wordEsc}」打标签</span>
          <button type="button" class="whale-dlg-iconbtn" data-action="close" title="关闭">✕</button>
        </div>
        <div class="hiword-vb-label-edit-body">
          <div class="hiword-vb-label-current">
            <span class="hiword-vb-section-tag whale-card-tag-primary">
              <span class="whale-card-section-icon">✏️</span><span>当前标签</span>
              <span class="hiword-vb-label-current-count" id="hiword-vb-label-current-count">${selected.size}</span>
            </span>
            <div class="hiword-vb-label-current-chips" id="hiword-vb-label-current-chips">
              ${[...selected].map((id) => {
                const l = all.find((x) => x.id === id);
                const name = l?.name || id;
                return `<span class="hiword-vb-tag-chip hiword-vb-tag-chip--active" style="--tag-color:${l?.color || "#9ca3af"}" data-id="${this.escapeAttr(id)}" title="点击移除">#${this.escapeHtml(name)} ✕</span>`;
              }).join("") || `<span class="hiword-vb-label-empty-hint">还没选任何标签，从下方选择或新建</span>`}
            </div>
          </div>
          <div class="hiword-vb-label-search">
            <span class="whale-card-section-icon">🔍</span>
            <input type="text" id="hiword-vb-label-search-input" class="b3-text-field" placeholder="搜索标签…" />
          </div>
          <div class="hiword-vb-section-tag whale-card-tag-readonly">
            <span class="whale-card-section-icon">📚</span><span>已有标签（点击切换）</span>
          </div>
          <div class="hiword-vb-label-list" id="hiword-vb-label-list">
            ${all.map((l) => {
              const on = selected.has(l.id);
              return `<button type="button" class="hiword-vb-label-pick ${on ? "active" : ""}" data-id="${this.escapeAttr(l.id)}" data-name="${this.escapeAttr(l.name)}" style="--tag-color:${l.color}">
                <span class="hiword-vb-label-pick-check">${on ? "✓" : "＋"}</span>
                <span>#${this.escapeHtml(l.name)}</span>
              </button>`;
            }).join("")}
          </div>
          <div class="hiword-vb-label-new">
            <span class="whale-card-section-icon">➕</span>
            <input type="text" id="hiword-vb-label-new-input" class="b3-text-field" placeholder="新建标签名称（如 口语 / 作文素材）" />
            <button type="button" class="b3-button b3-button--small b3-button--outline" id="hiword-vb-label-new-btn">创建</button>
          </div>
        </div>
        <div class="whale-dlg-foot">
          <div class="whale-dlg-foot-left"></div>
          <button type="button" class="b3-button b3-button--primary" id="hiword-vb-label-save">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 关闭按钮
    overlay.querySelector('[data-action="close"]')?.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape" && document.body.contains(overlay)) {
        overlay.remove();
        document.removeEventListener("keydown", escHandler);
      }
    });

    // 搜索过滤
    const searchInput = overlay.querySelector<HTMLInputElement>("#hiword-vb-label-search-input")!;
    const renderList = () => {
      const q = searchInput.value.trim().toLowerCase();
      overlay.querySelectorAll<HTMLButtonElement>(".hiword-vb-label-pick").forEach((btn) => {
        const name = (btn.dataset.name || "").toLowerCase();
        btn.style.display = !q || name.includes(q) ? "" : "none";
      });
    };
    searchInput.addEventListener("input", renderList);

    // 标签点击切换
    overlay.querySelectorAll<HTMLButtonElement>(".hiword-vb-label-pick").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id || "";
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        btn.classList.toggle("active");
        btn.querySelector(".hiword-vb-label-pick-check")!.textContent = selected.has(id) ? "✓" : "＋";
        // 同步顶部已选区
        updateCurrentChips();
      });
    });

    const updateCurrentChips = () => {
      const wrap = overlay.querySelector("#hiword-vb-label-current-chips")!;
      const countEl = overlay.querySelector("#hiword-vb-label-current-count")!;
      countEl.textContent = String(selected.size);
      wrap.innerHTML = [...selected].map((id) => {
        const l = all.find((x) => x.id === id);
        const name = l?.name || id;
        return `<span class="hiword-vb-tag-chip hiword-vb-tag-chip--active" style="--tag-color:${l?.color || "#9ca3af"}" data-id="${this.escapeAttr(id)}" title="点击移除">#${this.escapeHtml(name)} ✕</span>`;
      }).join("") || `<span class="hiword-vb-label-empty-hint">还没选任何标签，从下方选择或新建</span>`;
      // 绑定移除
      wrap.querySelectorAll<HTMLElement>(".hiword-vb-tag-chip").forEach((c) => {
        c.addEventListener("click", () => {
          const id = c.dataset.id || "";
          if (selected.delete(id)) {
            // 同步下方标签列表 active 状态
            const peer = overlay.querySelector(`.hiword-vb-label-pick[data-id="${CSS.escape(id)}"]`);
            if (peer) {
              peer.classList.remove("active");
              peer.querySelector(".hiword-vb-label-pick-check")!.textContent = "＋";
            }
            updateCurrentChips();
          }
        });
      });
    };

    // 新建标签
    const newInput = overlay.querySelector<HTMLInputElement>("#hiword-vb-label-new-input")!;
    const newBtn = overlay.querySelector<HTMLButtonElement>("#hiword-vb-label-new-btn")!;
    const doCreate = async () => {
      const name = newInput.value.trim();
      if (!name) return;
      const created = this.vocabLabelStore.add(name);
      // 追加到当前弹窗列表 + 选中
      selected.add(created.id);
      // 重建列表 + 选中区（labelStore 已落盘）
      rebuildList();
      newInput.value = "";
      showMessage(`已新建标签 #${created.name}`, 1500, "info");
    };
    newBtn.addEventListener("click", doCreate);
    newInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doCreate(); } });

    // 重建列表（用于新建标签后刷新）
    const rebuildList = () => {
      const fresh = this.vocabLabelStore.getAll();
      const listEl = overlay.querySelector("#hiword-vb-label-list")!;
      listEl.innerHTML = fresh.map((l) => {
        const on = selected.has(l.id);
        return `<button type="button" class="hiword-vb-label-pick ${on ? "active" : ""}" data-id="${this.escapeAttr(l.id)}" data-name="${this.escapeAttr(l.name)}" style="--tag-color:${l.color}">
          <span class="hiword-vb-label-pick-check">${on ? "✓" : "＋"}</span>
          <span>#${this.escapeHtml(l.name)}</span>
        </button>`;
      }).join("");
      listEl.querySelectorAll<HTMLButtonElement>(".hiword-vb-label-pick").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id || "";
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          btn.classList.toggle("active");
          btn.querySelector(".hiword-vb-label-pick-check")!.textContent = selected.has(id) ? "✓" : "＋";
          updateCurrentChips();
        });
      });
      renderList();
      // 同步 fresh 引用到 all
      all.length = 0; all.push(...fresh);
      updateCurrentChips();
    };

    // 保存
    overlay.querySelector("#hiword-vb-label-save")?.addEventListener("click", async () => {
      try {
        await this.vocabStore.updateWordLabels(word.toLowerCase(), [...selected]);
        showMessage(`已保存 ${selected.size} 个标签到「${word}」`, 1800, "success" as any);
        overlay.remove();
        if (this.dockElement) this.renderVocabPanel(this.dockElement);
      } catch (err: any) {
        showMessage(`保存失败：${err?.message || err}`, 3000, "error");
      }
    });
  }

  /**
   * 打开「标签管理」弹窗（2026-08-15 新增；2026-08-15 拆分：domain 区分词库标签 / 批注标签）。
   * 顶部：所有标签列表（每行：颜色方块 + 名称 + ID 后缀 + ✎ 改名 + ✕ 删除）
   * 中部：新建标签输入 + 创建按钮
   * 操作：点击颜色方块循环换色，点击名称改名，点击 ✕ 删除
   * @param domain "vocab"=词库标签域；"annotation"=批注标签域（默认）
   */
  private openLabelManagementDialog(domain: "vocab" | "annotation" = "annotation"): void {
    const store = domain === "vocab" ? this.vocabLabelStore : this.annotationLabelStore;
    const isVocab = domain === "vocab";
    const title = isVocab ? "⚙️ 管理词库标签" : "⚙️ 管理批注标签";
    const domainName = isVocab ? "词卡" : "批注";
    document.querySelector(".whale-dlg-label-mgmt-overlay")?.remove();
    const render = () => {
      const labels = store.getAll();
      const overlay = document.createElement("div");
      overlay.className = "whale-dlg-label-mgmt-overlay whale-dlg-overlay";
      overlay.innerHTML = `
        <div class="whale-dlg" style="width:560px;">
          <div class="whale-dlg-head">
            <span class="whale-dlg-title">${title}</span>
            <button type="button" class="whale-dlg-iconbtn" data-action="close" title="关闭">✕</button>
          </div>
          <div class="whale-dlg-body">${renderLabelManagementDialog(labels)}</div>
          <div class="whale-dlg-foot">
            <span class="whale-dlg-section-label">${labels.length} 个标签</span>
            <span class="hiword-vb-labels-foot-spacer"></span>
            <button type="button" class="b3-button b3-button--primary" data-action="close">完成</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // 关闭
      overlay.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener("click", () => overlay.remove()));
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) overlay.remove(); });
      document.addEventListener("keydown", function escH(e) {
        if (e.key === "Escape" && document.body.contains(overlay)) {
          overlay.remove();
          document.removeEventListener("keydown", escH);
        }
      });

      // 循环换色
      overlay.querySelectorAll('[data-action="label-cycle-color"]').forEach((sw) => {
        sw.addEventListener("click", () => {
          const row = sw.closest(".hiword-vb-label-mgmt-row") as HTMLElement;
          const id = row?.dataset.id || "";
          if (id) {
            const next = store.cycleColor(id);
            if (next) (sw as HTMLElement).style.background = next;
          }
        });
      });

      // 改名（点击 → input 出现，回车/失焦保存，Esc 取消）
      overlay.querySelectorAll('.hiword-vb-label-mgmt-row').forEach((row) => {
        const id = (row as HTMLElement).dataset.id || "";
        const nameSpan = row.querySelector('[data-action="label-rename"]') as HTMLElement;
        const input = row.querySelector('[data-action="label-rename-input"]') as HTMLInputElement;
        if (!nameSpan || !input) return;
        const startEdit = () => {
          nameSpan.style.display = "none";
          input.style.display = "";
          input.focus();
          input.select();
        };
        const commit = () => {
          const newName = input.value.trim();
          if (newName) {
            store.rename(id, newName);
            nameSpan.textContent = newName;
          }
          nameSpan.style.display = "";
          input.style.display = "none";
          rerender();
        };
        const cancel = () => {
          input.value = nameSpan.textContent || "";
          nameSpan.style.display = "";
          input.style.display = "none";
        };
        nameSpan.addEventListener("click", startEdit);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        });
        input.addEventListener("blur", commit);
      });

      // 删除
      overlay.querySelectorAll('[data-action="label-delete"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          const row = btn.closest(".hiword-vb-label-mgmt-row") as HTMLElement;
          const id = row?.dataset.id || "";
          const name = row?.querySelector('[data-action="label-rename"]')?.textContent || id;
          const ok = await confirmDelete(`删除标签「${name}」？\n已标注的${domainName}/词条中残留引用会保留（显示灰色 #id 后缀）。`);
          if (!ok) return;
          store.remove(id);
          showMessage(`已删除标签 #${name}`, 1500, "info");
          rerender();
        });
      });

      // 新建标签
      const newInput = overlay.querySelector<HTMLInputElement>("#hiword-vb-label-mgmt-new-input")!;
      const newBtn = overlay.querySelector<HTMLButtonElement>("#hiword-vb-label-mgmt-new-btn")!;
      const doCreate = () => {
        const name = newInput.value.trim();
        if (!name) return;
        const created = store.add(name);
        newInput.value = "";
        showMessage(`已新建标签 #${created.name}`, 1500, "info");
        rerender();
      };
      newBtn.addEventListener("click", doCreate);
      newInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doCreate(); } });
    };
    const rerender = () => {
      document.querySelector(".whale-dlg-label-mgmt-overlay")?.remove();
      render();
      // 同时刷新对应面板（如有打开）
      if (this.dockElement) {
        if (isVocab) this.renderVocabPanel(this.dockElement);
        else if (this.dockElement.querySelector(".whale-panel") || this.dockElement.querySelector("#hiword-dock-tab-annotations")) {
          this.renderAnnotationsPanel(this.dockElement);
        }
      }
    };
    render();
  }

  /** 5 星掌握度（DOM 逆序 + CSS row-reverse 实现悬浮预览） */
  private renderMasteryStars(word: string, mastery: number): string {
    let stars = "";
    for (let i = MASTERY_MAX; i >= 1; i--) {
      stars += `<span class="hiword-star ${i <= mastery ? "filled" : ""}" data-action="mastery" data-word="${this.escapeAttr(word)}" data-level="${i}">★</span>`;
    }
    return `<span class="hiword-stars" data-word="${this.escapeAttr(word)}">${stars}</span>`;
  }

  /** 单词列表拖拽绑定 */
  private bindVocabDrag(dockElement: HTMLElement, contentEl: HTMLElement, themeId: string) {
    if (this.vocabSort !== "custom") return;
    const listEl = contentEl.querySelector("#hiword-vb-list") as HTMLElement;
    if (!listEl) return;

    listEl.addEventListener("dragstart", (e) => {
      const row = (e.target as HTMLElement).closest(".hiword-vb-row") as HTMLElement;
      if (!row) return;
      row.classList.add("dragging");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    listEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = listEl.querySelector(".hiword-vb-row.dragging") as HTMLElement;
      if (!dragging) return;
      const after = getDragAfterElement(listEl, (e as DragEvent).clientY);
      if (after == null) listEl.appendChild(dragging);
      else listEl.insertBefore(dragging, after);
    });
    listEl.addEventListener("drop", (e) => {
      e.preventDefault();
      const dragging = listEl.querySelector(".hiword-vb-row.dragging") as HTMLElement;
      if (!dragging) return;
      const rows = [...listEl.querySelectorAll(".hiword-vb-row")];
      const newIdx = rows.indexOf(dragging);
      const id = dragging.dataset.id || "";
      dragging.classList.remove("dragging");
      this.vocabStore.reorderInTheme(themeId, id, newIdx).then(() => {
        this.renderVocabPanel(dockElement);
      });
    });
  }

  /**
   * 渲染词典查询面板
   */
  private renderDictPanel(dockElement: HTMLElement) {
    const contentEl = dockElement.querySelector("#hiword-dock-content") as HTMLElement;
    if (!contentEl) return;

    const dictStatus = dictEngine.getStatus();
    const activeInfo = dictEngine.listDicts().find((d) => d.active);

    // 「管理词典」「朗读设置」按钮与搜索框始终显示，确保任何状态下都能进入词典管理
    contentEl.innerHTML = `
      <div class="hiword-dict-head">
        <span class="hiword-dict-current" title="当前词典">📚 ${activeInfo ? activeInfo.name : "未加载"}</span>
        <button class="b3-button b3-button--outline b3-button--small" id="hiword-dict-manage" title="管理词典">管理词典</button>
        <button class="b3-button b3-button--outline b3-button--small" id="hiword-tts-setting" title="朗读设置">🔊</button>
      </div>
      <div class="hiword-dict-search">
        <input class="b3-text-field" id="hiword-dict-input" placeholder="输入单词查询..." autofocus />
        <button class="b3-button" id="hiword-dict-btn" title="查询单词">查询</button>
      </div>
      <div class="hiword-dict-result" id="hiword-dict-result">
        ${dictStatus === "ready"
          ? `<p class="hiword-dict-hint">输入单词后按回车或点击查询</p>`
          : dictRenderer.renderInitRequired()}
      </div>
    `;

    // 绑定「管理词典」按钮（始终可用）
    const manageBtn = contentEl.querySelector("#hiword-dict-manage");
    manageBtn?.addEventListener("click", () => this.openDictManager());

    // 绑定「朗读设置」按钮
    // 绑定「朗读设置」按钮：2026-08-27 起统一跳主设置「朗读设置」页（旧版独立小窗已删除）
    const ttsBtn = contentEl.querySelector("#hiword-tts-setting");
    ttsBtn?.addEventListener("click", () => this.openUnifiedSettings("tts"));

    // 绑定搜索事件
    const input = contentEl.querySelector("#hiword-dict-input") as HTMLInputElement;
    const btn = contentEl.querySelector("#hiword-dict-btn");

    const doLookup = () => {
      const word = input.value.trim();
      if (!word) return;
      this.doDictLookup(word, contentEl);
    };

    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLookup();
    });
    btn?.addEventListener("click", doLookup);

    // 联想搜索
    input?.addEventListener("input", () => {
      const prefix = input.value.trim().toLowerCase();
      if (prefix.length < 2) return;
      const suggestions = dictEngine.searchPrefix(prefix, 5);
      // 可以显示联想下拉，暂时省略保持简洁
    });

    input?.focus();

    // 绑定「去导入词典」按钮（词典未就绪时显示的空状态区域）
    const importBtn = contentEl.querySelector("#hiword-dict-manage-btn");
    importBtn?.addEventListener("click", () => this.openDictManager());
  }

  /**
   * 执行词典查询并渲染结果
   */
  private doDictLookup(word: string, container: HTMLElement) {
    // 复习信号：每次查词都记录一次查询次数（仅对词库内单词生效，调度优先级最高信号）
    void this.vocabStore?.recordQuery(word);

    const resultEl = container.querySelector("#hiword-dict-result");
    if (!resultEl) return;

    resultEl.innerHTML = dictRenderer.renderLoading();

    setTimeout(() => {
      const entry = dictEngine.lookupSmart(word);
      if (entry) {
        const parsed = dictRenderer.parseDictEntry(entry);
        resultEl.innerHTML = dictRenderer.renderDictCard(parsed, {
          showStar: true,
          inVocab: this.vocabStore.hasWord(word),
          queryCount: this.vocabStore.getQueryCount(word),
        });
        // P4 在线音标兜底：离线无音标时异步补写（欧路接口，内存缓存，静默降级）
        if (this.onlineSettings?.enabled) {
          maybeFillPhonetic(resultEl as HTMLElement, word);
        }
      } else {
        // 离线查不到 → 在线词典兜底（2026-08-15 新增：欧路网页版完整释义）
        if (this.onlineSettings?.enabled) {
          this.doOnlineDictFallback(word, resultEl as HTMLElement);
        } else {
          // 在线兜底关闭：展示最相似候选 + 引导用户手动输入原型
          const candidates = dictEngine.searchCandidates(word, 3);
          resultEl.innerHTML = dictRenderer.renderDictSuggestions(word, candidates);
        }
      }
    }, 50); // 短暂延迟让 loading 动画显示
  }

  /**
   * 在线词典兜底（2026-08-15 新增）：离线词典查不到时，抓欧路网页版完整释义。
   *  - 先显示 loading 态「在线词典查询中…」
   *  - 成功 → renderOnlineDictCard（含「在线词典」来源徽标）
   *  - 失败/未收录 → toast 提示 + 回退 renderDictSuggestions（相似候选）
   */
  private async doOnlineDictFallback(word: string, resultEl: HTMLElement): Promise<void> {
    resultEl.innerHTML = `<div class="hiword-online-loading">🌐 在线词典查询中…</div>`;
    const r = await fetchOnlineDict(word);
    // 用户可能已切换到其它词 → 结果元素已不是当前词，直接放弃
    if (!resultEl.isConnected) return;
    if (r) {
      resultEl.innerHTML = renderOnlineDictCard(r, this.vocabStore.hasWord(word));
      return;
    }
    // 在线也查不到 → toast 提示 + 回退相似候选
    showMessage(`「${word}」离线与在线词典均未收录`, 2500, "info");
    const candidates = dictEngine.searchCandidates(word, 3);
    resultEl.innerHTML = dictRenderer.renderDictSuggestions(word, candidates);
  }

  /**
   * 处理侧边栏点击事件
   */
  private async handleDockClick(e: Event, dockElement: HTMLElement) {
    const rawTarget = e.target as HTMLElement;
    // 关键修复：用 closest 向上查找带 data-action 的祖先元素
    // 否则点到按钮内部的 span/文字等子元素时，target 没有 action，导致 toggle 失效
    const target = (rawTarget.closest("[data-action]") as HTMLElement) || rawTarget;
    const action = target.dataset.action;
    // 朗读文本：例句行带 data-text，单词带 data-word；优先 data-text（点击例句朗读该句）
    const word = target.dataset.text || target.dataset.word;

    // 重载插件：调用思源 Plugin 基类的 onDataChanged，
    // 会卸载当前插件实例并重新拉取磁盘上最新的 index.js / index.css 重新加载。
    // 整个过程在当前窗口内完成，无需退出思源，也不会刷新整个应用。
    if (action === "reload-plugin") {
      this.onDataChanged();
      return;
    }

    // 批注面板：跳转定位到原文块
    if (action === "ann-jump") {
      const blockId = target.dataset.block;
      const docId = target.dataset.doc;
      if (blockId) this.openAnnotationBlock(blockId, docId);
      return;
    }

    // 批注面板：删除批注
    if (action === "ann-delete") {
      const id = target.dataset.id;
      if (id) {
        void this.deleteAnnotation(id, dockElement);
      }
      return;
    }

    // 批注面板：展开含表格批注的完整视图（居中 Dialog，表格可横向滚动）
    if (action === "expand-table") {
      const id = target.dataset.annId;
      if (id) this.openAnnotationTable(id);
      return;
    }

    if (action === "tts" && word) {
      this.speak(word);
    } else if (action === "dict-jump" && word) {
      // 点击蓝色高亮变形词 / 查询结果下方相关词 → 跳转查词窗口并自动查询该词
      this.lookupWordInDock(word);
    } else if ((action === "lookup" || action === "lookup-candidate") && word) {
      // 词库卡片内的候选选择：就地重查该卡片（不切换 Tab）
      const row = target.closest(".hiword-vb-row") as HTMLElement;
      if (action === "lookup-candidate" && row) {
        this.relookupWithinCard(row, word);
      } else {
        // 切换到词典 Tab 并查询
        const tabBtn = dockElement.querySelector('[data-tab="dict"]') as HTMLElement;
        tabBtn?.click();
        setTimeout(() => {
          const input = dockElement.querySelector("#hiword-dict-input") as HTMLInputElement;
          if (input) {
            input.value = word;
            this.doDictLookup(word, dockElement);
          }
        }, 100);
      }
    } else if (action === "mastery" && word) {
      // 5 星掌握度：点击第 k 个点设 k；再次点当前最大值则归零
      const cur = this.vocabStore.findRecord(word)?.mastery ?? 0;
      const lvl = Number(target.dataset.level);
      const next = cur === lvl ? 0 : lvl;
      this.vocabStore.updateMastery(word, next).then(() => {
        this.renderVocabPanel(dockElement);
      });
    } else if (action === "unvocab" && word) {
      this.vocabStore.removeWord(word).then(() => {
        showMessage(`已移出词库：「${word}」`, 2000, "info");
        this.renderVocabPanel(dockElement);
      });
    } else if (action === "vocab-detail" && word) {
      // 📖 展开/收起详细释义面板
      const row = target.closest(".hiword-vb-row") as HTMLElement;
      const wordId = row?.dataset.id || "";
      const panelId = `vb-detail-${wordId}`;
      const panel = document.getElementById(panelId) as HTMLElement;
      if (!panel) return;
      if (panel.style.display === "none") {
        // 展开：查词典渲染详细内容
        panel.style.display = "";
        if (this.dictReady && !panel.dataset.rendered) {
          const entry = dictEngine.lookupSmart(word);
          if (entry) {
            const parsed = dictRenderer.parseDictEntry(entry);
            panel.innerHTML = dictRenderer.renderVocabDetailCard(parsed, 0, wordId, true);
            // P4 在线音标兜底（详细释义面板，受设置开关控制）
            if (this.onlineSettings?.enabled) maybeFillPhonetic(panel, word);
          } else {
            // 词库详情离线查不到 → 在线词典兜底（2026-08-15 新增）
            if (this.onlineSettings?.enabled) {
              panel.innerHTML = `<div class="hiword-online-loading">🌐 在线词典查询中…</div>`;
              fetchOnlineDict(word).then((r) => {
                if (!panel.isConnected) return;
                panel.innerHTML = r ? renderOnlineDictCard(r, false) : `<div class="hiword-vb-detail-empty">未找到「${this.escapeHtml(word)}」的详细释义</div>`;
              });
            } else {
              panel.innerHTML = `<div class="hiword-vb-detail-empty">未找到「${this.escapeHtml(word)}」的详细释义</div>`;
            }
          }
          panel.dataset.rendered = "1";
        }
        target.classList.add("active");
        target.title = "收起详情";
      } else {
        // 收起
        panel.style.display = "none";
        target.classList.remove("active");
        target.title = "详细释义";
      }
    } else if (action === "toggle-pos") {
      // 简洁/详细模式共用：独立展开/收起某个词性区块（互不影响，不自动收起其他）
      const block = (target.closest(".hiword-vb-pos-block") as HTMLElement) || null;
      if (block) togglePosCollapsed(block);
    } else if (action === "toggle-section") {
      // 详细模式：独立展开/收起「单词意思」或「词组」层
      const sec = (target.closest(".hiword-detail-section") as HTMLElement) || null;
      if (sec) sec.classList.toggle("hiword-detail-sec-collapsed");
    } else if (action === "toggle-senses") {
      // 查词卡义项展开：按钮后紧跟隐藏的全量义项容器，切换 hidden；
      // 同时切换初始列表容器的可见性，避免展开后初始 4 条与全量列表重复显示
      const full = target.nextElementSibling as HTMLElement | null;
      if (full && full.classList.contains("hiword-dict-senses-full")) {
        const willShow = full.hidden;
        full.hidden = !willShow;
        target.classList.toggle("hiword-dict-senses-open", willShow);
        const arrow = target.querySelector(".hiword-dict-senses-toggle-arrow");
        if (arrow) arrow.textContent = willShow ? "▴" : "▾";
        // 同步隐藏/显示初始列表（展开全量时隐藏初始 4 条，收起时恢复）
        const initial = target.parentElement?.querySelector(".hiword-dict-senses-initial") as HTMLElement | null;
        if (initial) initial.hidden = willShow;
      }
    } else if (action === "toggle-examples") {
      // 义项内例句展开/收起：按钮父容器内的 .hiword-dict-sense-ex-rest 切换 hidden
      const moreContainer = target.closest(".hiword-dict-sense-ex-more");
      const rest = moreContainer?.querySelector(".hiword-dict-sense-ex-rest") as HTMLElement | null;
      if (moreContainer && rest) {
        const willShow = rest.hidden;
        rest.hidden = !willShow;
        const exCount = moreContainer.querySelectorAll(".hiword-dict-sense-ex-row").length;
        target.innerHTML = `<span class="hiword-dict-sense-toggle-arrow">${willShow ? "▴" : "▾"}</span> ${willShow ? "收起例句" : `展开 ${Math.max(0, exCount - 1)} 条例句`}`;
      }
    } else if (action === "add-vocab" && word && this.isReady) {
      this.addWordToVocab(word).then(() => {
        this.renderVocabPanel(dockElement);
      });
    } else if (action === "vocab-star" && word) {
      // 侧边栏查词卡片的收藏星：两级选择（词本→子类），内部已就地刷新星态
      await this.toggleVocabStar(word, target);
    }
  }

  /**
   * 词库卡片内「候选词」点选后就地重查并渲染该卡片。
   *
   * 命中则显示该原型词的简洁释义，并标注「由 X 推断」的来源；
   * 仍查不到则展示新一轮候选（递归），直到用户找到正确原型或词典中确实无此词。
   *
   * @param row  待更新的词库卡片行（.hiword-vb-row）
   * @param cand 候选词（用户点选的相近词）
   */
  private relookupWithinCard(row: HTMLElement, cand: string) {
    if (!this.dictReady) return;
    const main = row.querySelector(".hiword-vb-main") as HTMLElement;
    if (!main) return;
    const wordId = row.dataset.id || "";
    const orig = row.dataset.word || cand;

    const entry = dictEngine.lookupSmart(cand);
    if (entry) {
      const parsed = dictRenderer.parseDictEntry(entry);
      const groups = dictRenderer.extractSensesByPos(entry.definition, 1, 4, 90);
      const inflections = getWordInflections(cand, groups.map((g) => g.pos));
      const mastery = this.vocabStore.findRecord(orig)?.mastery ?? 0;
      let html = dictRenderer.renderVocabCompactCard(cand, parsed.phonetic, groups, mastery, wordId, inflections, this.vocabStore.getQueryCount(cand));
      if (cand.toLowerCase() !== orig.toLowerCase()) {
        html += `<div class="hiword-vb-infer-note">⟵ 由「${this.escapeHtml(orig)}」推断</div>`;
      }
      main.innerHTML = html;
    } else {
      const c2 = dictEngine.searchCandidates(cand, 3);
      main.innerHTML = dictRenderer.renderVocabSuggestionBox(cand, c2, orig);
    }
    // 应用字体大小设置
    this.applyFontSize();
  }

  /**
   * 判断词典文件是否在磁盘上真实存在（用于容错：缺失文件不应被激活）
   */
  private dictFileExists(meta: DictMeta): boolean {
    try {
      if (meta.type === "stardict") {
        return (meta.files && meta.files.length ? meta.files : [meta.file]).every((f) =>
          fs.existsSync(this.resolveDictPath(f))
        );
      }
      return fs.existsSync(this.resolveDictPath(meta.file));
    } catch {
      return false;
    }
  }

  /**
   * 加载词典清单（持久化于插件数据），首次运行时写入默认清单。
   * 容错策略（保证内置词典开箱即用）：
   *   1) 内置词典（ncecd）始终存在，被误删/清单损坏时自动补回；
   *   2) 清理磁盘文件已丢失的非内置词典（避免显示无法启用的死条目）；
   *   3) 激活项必须指向文件真实存在的词典，否则回退到内置词典。
   */
  private async loadDictManifest(): Promise<DictManifest> {
    let m: any = null;
    try {
      const raw = await this.loadData("hiword-dicts.json");
      if (raw && Array.isArray(raw.dicts) && raw.dicts.length) {
        m = raw as DictManifest;
        // 迁移：旧版以 .sqlite/.db 注册的词典自动指向同名 .mdx 原包；补 type/id 字段
        let migrated = false;
        for (const d of m.dicts as DictMeta[]) {
          if (/\.(sqlite|db)$/i.test(d.file)) {
            d.file = d.file.replace(/\.(sqlite|db)$/i, ".mdx");
            migrated = true;
          }
          if (!d.type) {
            d.type = /\.ifo$/i.test(d.file) ? "stardict" : "mdx";
            migrated = true;
          }
          if (!d.id) {
            d.id = "dict-" + Math.random().toString(36).slice(2, 8);
            migrated = true;
          }
        }
        if (migrated) await this.saveData("hiword-dicts.json", m);
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · loadDictManifest", "error"); }

    if (!m) {
      await this.saveData("hiword-dicts.json", DEFAULT_MANIFEST);
      m = JSON.parse(JSON.stringify(DEFAULT_MANIFEST));
    }

    // 确保内置词典始终存在（用户可能被误删 / 清单损坏）
    let manifestChanged = false;
    for (const builtin of DEFAULT_MANIFEST.dicts) {
      if (!m.dicts.some((d: DictMeta) => d.id === builtin.id)) {
        m.dicts.push({ ...builtin });
        manifestChanged = true;
      }
    }
    if (manifestChanged) await this.saveData("hiword-dicts.json", m);

    // 清理磁盘文件已丢失的非内置词典（避免显示无法启用的死条目）
    const before = m.dicts.length;
    m.dicts = m.dicts.filter((d: DictMeta) => d.builtin || this.dictFileExists(d));
    if (m.dicts.length !== before) await this.saveData("hiword-dicts.json", m);

    // 确保 active 指向一个文件真实存在的词典（优先内置）
    if (!m.dicts.some((d: DictMeta) => d.id === m.active && this.dictFileExists(d))) {
      const fallback =
        m.dicts.find((d: DictMeta) => d.builtin && this.dictFileExists(d)) ||
        m.dicts.find((d: DictMeta) => this.dictFileExists(d));
      // 注意：fallback 为 undefined（所有文件缺失）时保留原 active，不要降级为 ""，
      // 否则会导致 m.actives 变成 [""]，进而漏掉全部词典加载
      if (fallback) {
        m.active = fallback.id;
        await this.saveData("hiword-dicts.json", m);
      }
    }

    // 修复 actives：过滤空字符串与不存在的 dict id，缺失时从 active / 内置词典推导
    const validIds = new Set(m.dicts.map((d: DictMeta) => d.id));
    let actives = (m.actives && Array.isArray(m.actives) ? m.actives : [])
      .filter((id: string) => id && validIds.has(id));
    if (actives.length === 0) {
      if (m.active && validIds.has(m.active)) {
        actives = [m.active];
      } else {
        const builtins = (m.dicts as DictMeta[]).filter((d) => d.builtin);
        actives = builtins.length ? builtins.map((d) => d.id) : (m.dicts.length ? [m.dicts[0].id] : []);
      }
      m.actives = actives;
      await this.saveData("hiword-dicts.json", m);
    }
    m.actives = actives;

    // 按语种组单选归一化：每组仅保留第一个启用项（清理历史多选残留）
    this.normalizeDictSingleSelect(m);
    if (m.actives.length !== actives.length) {
      await this.saveData("hiword-dicts.json", m);
    }

    return m;
  }

  /** 加载朗读设置 */
  private async loadTtsSettings(): Promise<TtsSettings> {
    try {
      const s = await this.loadData("hiword-tts.json");
      if (s && typeof s.engine === "string") {
        // 兼容旧版 engine 枚举（offline/online → 新 system/youdao）
        const norm: TtsEngine =
          s.engine === "offline" || s.engine === "system" ? "system"
          : s.engine === "online" ? "youdao"
          : s.engine === "edge" ? "edge"
          : s.engine === "auto" ? "auto"
          : "system";
        return { ...DEFAULT_TTS, ...s, engine: norm };
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · loadTtsSettings", "debug"); }
    return { ...DEFAULT_TTS };
  }

  /** 公开读取当前朗读设置（供阅读器朗读控制器透传） */
  public getTtsSettings(): TtsSettings {
    return { ...(this.ttsSettings || DEFAULT_TTS) };
  }

  /** 保存朗读设置（公开，供阅读器朗读控制器透传） */
  public async saveTtsSettings(s: TtsSettings) {
    this.ttsSettings = s;
    try {
      await this.saveData("hiword-tts.json", s);
    } catch (e) {
      getLogger().error("[REword] 保存朗读设置失败:", { error: e });
    }
  }

  /** 加载在线词典设置（2026-08-15 新增） */
  private async loadOnlineSettings(): Promise<OnlineSettings> {
    try {
      const s = await this.loadData("hiword-online.json");
      if (s && typeof s.enabled === "boolean") {
        return { ...DEFAULT_ONLINE, ...s };
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · loadOnlineSettings", "debug"); }
    return { ...DEFAULT_ONLINE };
  }

  /** 保存在线词典设置（2026-08-15 新增） */
  private async saveOnlineSettings(s: OnlineSettings) {
    this.onlineSettings = s;
    try {
      await this.saveData("hiword-online.json", s);
    } catch (e) {
      getLogger().error("[REword] 保存在线词典设置失败:", { error: e });
    }
  }

  /** 加载字体大小设置 */
  private async loadFontSize(): Promise<"small" | "medium" | "large" | "xlarge"> {
    try {
      const s = await this.loadData("hiword-font.json");
      if (s && typeof s.size === "string" && ["small", "medium", "large", "xlarge"].includes(s.size)) {
        return s.size;
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · loadFontSize", "debug"); }
    return "medium";
  }

  /** 保存字体大小设置 */
  private async saveFontSize(size: "small" | "medium" | "large" | "xlarge") {
    this.fontSize = size;
    try {
      await this.saveData("hiword-font.json", { size });
    } catch (e) {
      getLogger().error("[REword] 保存字体设置失败:", { error: e });
    }
  }

  /** 应用字体大小到侧边栏面板（通过 CSS class 切换） */
  private applyFontSize() {
    // 2026-08-22：多 Dock 下需覆盖组合栏 + 所有独立 Dock 的面板
    const panels = document.querySelectorAll(".hiword-dock-panel") as NodeListOf<HTMLElement>;
    panels.forEach((panel) => {
      panel.classList.remove("hiword-font-small", "hiword-font-medium", "hiword-font-large", "hiword-font-xlarge");
      panel.classList.add("hiword-font-" + this.fontSize);
    });
  }

  /**
   * 确定性探测插件目录绝对路径。
   *
   * 不依赖 this.path / __dirname 等运行时变量（SiYuan 运行时 __dirname 会指向
   * electron.asar/renderer，this.path 版本间也可能不同），而是：
   *   1) 收集候选根目录（this.path / __dirname / 从 workspace.json 推导的插件目录 / cwd 推导）
   *   2) 实际扫描每个候选的 dict/ 子目录，找到真正含有 .mdx 的那个作为插件目录
   *
   * @returns 含 dict/*.mdx 的插件根目录；找不到时返回最可能的候选（仍按 file 拼接）
   */
  /**
   * 探测插件根目录（绝对路径，含 dict/*.mdx 的目录）
   *
   * 探测策略（按优先级，最先成功者即返回）：
   *   1. 缓存：this.pluginPath 已通过则复用
   *   2. **从 __dirname 向上遍历 N 层**，每层检查 siyuan-plugin-reword/dict/*.mdx
   *      ——这是最可靠的方式，完全不依赖任何环境变量
   *   3. 扫描 workspace.json：尝试 ~/.config/siyuan、~/Library/Application Support/siyuan、
   *      /Applications/SiYuan.app/Contents/Resources/app/config 等等多个候选
   *   4. 兜底：this.pluginPath(this.path)
   */
  private resolvePluginPath(): string {
    const path = require("path");
    const clean = (p: string) => path.normalize(p);

    // 严格校验：必须同时满足"含 dict/*.mdx"且"含标记此插件的 package.json"
    // ——避免误命中 renderer/dict（用户曾导入词典时遗留的文件）
    const PLUGIN_NAME = "siyuan-plugin-reword";
    const isPluginRoot = (dir: string): boolean => {
      try {
        // 1. 必须有 package.json 且 name === siyuan-plugin-reword
        const pkg = path.join(dir, "package.json");
        if (!fs.existsSync(pkg)) return false;
        try {
          const data = JSON.parse(fs.readFileSync(pkg, "utf-8"));
          if (data.name !== PLUGIN_NAME) return false;
        } catch { return false; }
        // 2. 必须有 dict/ 且含至少一个 .mdx（内置词典之一）
        const d = path.join(dir, "dict");
        if (!fs.existsSync(d)) return false;
        const mdx = fs.readdirSync(d).filter((f: string) => f.endsWith(".mdx"));
        if (mdx.length === 0) return false;
        // 3. 至少包含一个我们已知的内置词典（ncecd/ecd2/hanyu）作为额外保险
        const known = ["ncecd.mdx", "ecd2.mdx", "hanyu.mdx"];
        return mdx.some((f: string) => known.includes(f));
      } catch { return false; }
    };

    // 1. 缓存（先重新校验，防止被错误缓存）
    if (this.pluginPath && isPluginRoot(this.pluginPath)) {
      return this.pluginPath;
    }

    // 2. 从 __dirname 向上遍历（最可靠，与环境变量无关）
    const candidates: string[] = [];
    if (typeof __dirname !== "undefined" && __dirname && __dirname !== ".") {
      let cur = clean(__dirname);
      // 最多向上 8 层（足够覆盖任何异常的 asar 嵌套结构）
      for (let i = 0; i < 8; i++) {
        candidates.push(cur);
        // 常见的 siyuan-plugin-reword 路径：cur/data/plugins/siyuan-plugin-reword
        candidates.push(clean(path.join(cur, "data", "plugins", PLUGIN_NAME)));
        // 直接就是插件目录的情况
        candidates.push(clean(path.join(cur, PLUGIN_NAME)));
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
    }

    // 3. 多个候选的 workspace.json 路径（跨平台：Windows / macOS / Linux 各自标准位置）
    const os = require("os");
    // 优先用 os.homedir()（三平台通用），环境变量的回退仅作保险
    const home = (os.homedir && os.homedir()) || process.env.HOME || process.env.USERPROFILE || "";
    const wsCandidates: string[] = [];
    // Linux / 通用：~/.config/{siyuan,SiYuan}
    if (home) {
      wsCandidates.push(
        path.join(home, ".config", "siyuan", "workspace.json"),
        path.join(home, ".config", "SiYuan", "workspace.json"),
      );
    }
    if (process.platform === "darwin") {
      // macOS：~/Library/Application Support/siyuan、~/Documents/SiYuan、/Applications 内置
      wsCandidates.push(
        path.join(home, "Library", "Application Support", "siyuan", "workspace.json"),
        path.join(home, "Documents", "SiYuan", "workspace.json"),
        "/Applications/SiYuan.app/Contents/Resources/app/config/workspace.json",
        "/Applications/SiYuan.app/Contents/Resources/config/workspace.json",
      );
    } else if (process.platform === "win32") {
      // Windows：%APPDATA% / %LOCALAPPDATA% / 用户文档目录下的 SiYuan
      const appData = process.env.APPDATA || "";
      const localAppData = process.env.LOCALAPPDATA || "";
      if (appData) wsCandidates.push(path.join(appData, "SiYuan", "workspace.json"));
      if (localAppData) wsCandidates.push(path.join(localAppData, "SiYuan", "workspace.json"));
      if (home) {
        wsCandidates.push(
          path.join(home, "Documents", "SiYuan", "workspace.json"),
          path.join(home, "AppData", "Roaming", "SiYuan", "workspace.json"),
          path.join(home, "AppData", "Local", "SiYuan", "workspace.json"),
        );
      }
    }
    for (const wsFile of wsCandidates) {
      try {
        if (!fs.existsSync(wsFile)) continue;
        const raw = JSON.parse(fs.readFileSync(wsFile, "utf-8"));
        const list = Array.isArray(raw) ? raw : raw.workspaces || [];
        for (const ws of list) {
          const p = typeof ws === "string" ? ws : (ws && ws.path) || "";
          if (p) candidates.push(clean(path.join(p, "data", "plugins", PLUGIN_NAME)));
        }
      } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { if (!fs.existsSync(wsFile)) continue; const raw = JSON.pa…", "debug"); }
    }

    // 4. cwd 相对路径
    candidates.push(clean(path.join(process.cwd(), "data", "plugins", PLUGIN_NAME)));
    candidates.push(clean(path.join(process.cwd(), "..", "data", "plugins", PLUGIN_NAME)));

    // 5. this.path 也加入候选
    if ((this as any).path) candidates.push(clean((this as any).path));

    // 遍历所有候选，找第一个**严格符合插件目录特征**的
    for (const r of candidates) {
      if (!r) continue;
      if (isPluginRoot(r)) {
        this.pluginPath = r;
        getLogger().info("[REword] 插件目录探测成功:" + r);
        return r;
      }
    }

    // 兜底：保留之前的 pluginPath（可能是 __dirname），让上层报错更明确
    const fallback = this.pluginPath
      || (typeof __dirname !== "undefined" && __dirname ? __dirname : "")
      || ".";
    this.pluginPath = fallback;
    getLogger().warn("[REword] 插件目录探测失败，兜底使用: " + fallback + " 候选数: " + candidates.length);
    return fallback;
  }

  /**
   * 将相对插件目录的文件路径解析为磁盘绝对路径。
   * 优先使用 resolvePluginPath() 探测出的真实插件目录。
   */
  private resolveDictPath(file: string): string {
    const base = this.resolvePluginPath();
    return path.join(base, file);
  }

  /**
   * 收集诊断信息（词典加载失败时显示给用户）
   */
  private getDiagnosticInfo(): string {
    const lines: string[] = [];
    try {
      lines.push(`=== 环境诊断 ===`);
      lines.push(`pluginPath(this.path) = ${this.pluginPath || "EMPTY"}`);
      lines.push(`__dirname = ${typeof __dirname !== "undefined" ? __dirname : "UNDEFINED"}`);
      lines.push(`cwd = ${process.cwd()}`);
      lines.push(`platform = ${process.platform}`);
      lines.push(`arch = ${process.arch}`);
      lines.push(`node = ${process.version}`);
      lines.push(``);
      lines.push(`=== 词典文件 ===`);
      for (const meta of this.dictManifest.dicts) {
        const fp = this.resolveDictPath(meta.file);
        try {
          const stat = fs.statSync(fp);
          lines.push(`${meta.file} → EXISTS (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
        } catch (e: any) {
          lines.push(`${meta.file} → MISSING (${e?.code || e?.message || "unknown"})`);
        }
      }
      lines.push(``);
      lines.push(`=== 引擎状态 ===`);
      const dicts = dictEngine.listDicts();
      lines.push(`已加载词典: ${dicts.length}`);
      for (const d of dicts) {
        lines.push(`  - ${d.name} (${d.id}): ${d.count} 条 [${d.backend}]`);
      }
      lines.push(`激活: ${dictEngine.getActiveId() || "无"}`);
      lines.push(`dictReady: ${this.dictReady}`);
      lines.push(`active in manifest: ${this.dictManifest.active}`);
      if (this.lastDictError) {
        lines.push(``);
        lines.push(`=== 最后错误 ===`);
        lines.push(this.lastDictError);
      }
    } catch (e: any) {
      lines.push(`诊断异常: ${e?.message || e}`);
    }
    return lines.join("\n");
  }

  /** 最近一次词典加载的错误信息（用于 UI 显示） */
  private lastDictError: string = "";

  /**
   * 从磁盘加载某个词典并注册到引擎（支持 MDX 和 StarDict 两种格式）
   * @returns 是否加载成功
   */
  private async loadDictFile(meta: DictMeta): Promise<boolean> {
    this.lastDictError = "";
    try {
      const fsPath = this.resolveDictPath(meta.file);

      // 路径诊断：文件是否存在、大小、权限
      let diag: string[] = [`路径: ${fsPath}`];
      try {
        const stat = fs.statSync(fsPath);
        diag.push(`大小: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
      } catch {
        diag.push("⚠ 文件不存在或无法访问！");
      }
      getLogger().info(`[REword] 正在加载词典「${meta.name}」... ${diag.join(", ")}`);

      if (meta.type === "stardict") {
        await dictEngine.initStarDict(fsPath, meta.id, meta.name, (meta.lang || "en") as any);
      } else {
        await dictEngine.initDict(fsPath, meta.id, meta.name, (meta.lang || "en") as any);
      }

      dictEngine.setActiveDict(meta.id);
      this.refreshActivePanel();
      return true;
    } catch (err: any) {
      const msg = err?.message || String(err);
      this.lastDictError = msg;
      getLogger().error(`[REword] 词典「${meta.name}」加载失败: ` + msg + " " + (err?.stack || ""), { error: err });
      return false;
    }
  }

  /**
   * 初始化词典引擎：多词典模式。
   * 加载所有内置 + 用户激活的词典文件，保证开箱即用。
   */
  private async initDictionary() {
    this.dictManifest = await this.loadDictManifest();

    // 确定需要加载的词典列表（优先 actives 多词典模式，回退到 active 单词典）
    const activeIds = this.dictManifest.actives && this.dictManifest.actives.length > 0
      ? this.dictManifest.actives
      : [this.dictManifest.active];

    let loadedCount = 0;
    for (const id of activeIds) {
      const meta = this.dictManifest.dicts.find((d) => d.id === id);
      if (!meta || !this.dictFileExists(meta)) continue;
      try {
        const ok = await this.loadDictFile(meta);
        if (ok) loadedCount++;
      } catch (e) {
        getLogger().warn("[REword] 词典「${meta.name}」加载失败:", { error: e });
      }
    }

    // 若激活项均未加载，尝试自动回退到任一可用内置词典
    if (loadedCount === 0) {
      getLogger().warn("[REword] 激活词典均不可用，尝试自动回退...");
      for (const meta of this.dictManifest.dicts) {
        if (!this.dictFileExists(meta)) continue;
        try {
          const ok = await this.loadDictFile(meta);
          if (ok) { loadedCount++; break; } // 至少加载一个
        } catch (e) { logSwallow(e, "index.ts · initDictionary", "debug"); }
      }
    }

    // 对齐 manifest.active 指针：英文组优先（英文为主查），回退 actives[0]
    const actives = this.dictManifest.actives;
    if (actives && actives.length) {
      const enMeta = actives.find((aid) => {
        const m = this.dictManifest.dicts.find((d) => d.id === aid);
        return m && this.dictLangGroup(m) === "en";
      });
      this.dictManifest.active = enMeta || actives[0] || this.dictManifest.active || "";
    }

    if (loadedCount > 0) {
      this.dictReady = true;
      getLogger().info(`[REword] 词典引擎就绪，已加载 ${loadedCount} 个词典`);
      this.refreshActivePanel();
    } else {
      getLogger().warn("[REword] 没有可用的词典文件，可使用「词典管理」添加");
    }
  }

  /**
   * 重写 SiYuan Protyle 工具栏渲染钩子
   * 框架每次显示「选中文字后的浮动工具栏」时都会调用此方法，
   * 我们在末尾追加一个「查词典」按钮。
   * 2026-08-17：批注编辑器打开（弹窗/汇总面板编辑态）时跳过，防嵌套「批注」入口 + 防工具栏被污染。
   */
  updateProtyleToolbar(toolbar: any[]): any[] {
    if (WhaleAnnotationManager.editorOpen) return toolbar;
    toolbar.push({
      name: "hiword-dict-lookup",
      icon: "iconREwordDict",
      tip: "RE word 查词典",
      click: () => {
        const selection = window.getSelection()?.toString()?.trim();
        if (selection) {
          const btn = document.querySelector(
            '.protyle-toolbar__item[data-type="hiword-dict-lookup"]'
          ) as HTMLElement;
          this.showFloatingDictPopup(selection, btn || undefined);
        } else {
          showMessage("请先选中一个单词", 2000, "info");
        }
      },
    });
    toolbar.push({
      name: "hiword-extract",
      icon: "iconREwordAdd",
      tip: "RE word 提取单词到词库",
      click: () => {
        const btn = document.querySelector(
          '.protyle-toolbar__item[data-type="hiword-extract"]'
        ) as HTMLElement;
        this.extractWordsFromSelection(btn || undefined);
      },
    });
    toolbar.push({
      name: "hiword-annotate",
      icon: "iconREwordAnn",
      tip: "RE word 批注（弹窗内可选快速标注 / 详细标注）",
      click: () => {
        this.addAnnotationFromSelection();
      },
    });
    // 2026-08-15 合并：「快速标记」功能并入批注弹窗顶部「快速/详细」tab 切换，
    // 浮动工具栏只保留单一「批注」入口。
    return toolbar;
  }

  /**
   * 快速标记 mini 色板（2026-08-15 新增）：只上色/画线，不写文字。
   *  - 6 色：背景高亮（scope=word）
   *  - 3 线型：下划线（scope=sentence）
   * 点选任意项 → 直接 annotationStore.upsert(note:"") 上色并关闭，不打开批注弹窗。
   */
  private showQuickMarkPopover(selection: string, anchor?: HTMLElement) {
    // 关闭已有 popover
    document.querySelector(".hiword-quick-mark-pop")?.remove();

    const blockId = this.getSelectionBlockId();
    if (!blockId) {
      showMessage("无法定位选中内容所在的块", 3000, "error");
      return;
    }
    const sentence = this.extractContextSentence() || selection;
    const docId = this.getSelectionDocId(blockId) || "";

    const pop = document.createElement("div");
    pop.className = "hiword-quick-mark-pop";
    const colors = WHALE_COLOR_LIST; // 5 色：黄/绿/青/粉/紫
    const lines: Array<[string, string, string]> = [
      ["highlight", "高亮", "▮"],
      ["solid", "直线段", "━"],
      ["wavy", "波浪", "﹏"],
    ];
    pop.innerHTML = `
      <div class="hiword-quick-mark-head">🎨 快速标记（不写文字）</div>
      <div class="hiword-quick-mark-row" data-kind="color">
        ${colors.map((c) => `<button type="button" class="hiword-quick-mark-swatch" data-color="${c.value}" title="背景高亮 · ${c.name}" style="background:${c.value}"></button>`).join("")}
      </div>
      <div class="hiword-quick-mark-row" data-kind="line">
        ${lines.map(([k, label, icon]) => `<button type="button" class="hiword-quick-mark-line" data-style="${k}" title="${label}" ${k === "highlight" ? `style="background:#06b6d4;color:#fff"` : `style="text-decoration:underline;text-decoration-style:${k === "wavy" ? "wavy" : "solid"}"`}>Aa</button>`).join("")}
      </div>
    `;
    document.body.appendChild(pop);

    // 定位：锚点下方；无锚点居中偏上
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      let left = rect.left;
      let top = rect.bottom + 6;
      if (left + 240 > window.innerWidth - 10) left = window.innerWidth - 250;
      if (top + 90 > window.innerHeight) top = rect.top - 90;
      pop.style.left = `${Math.max(8, left)}px`;
      pop.style.top = `${Math.max(8, top)}px`;
    } else {
      pop.style.left = "50%";
      pop.style.transform = "translateX(-50%)";
      pop.style.top = "80px";
    }

    const doMark = async (color?: string, style?: string) => {
      try {
        await this.annotationStore.upsert({
          blockId,
          docId,
          sentence,
          selectedText: selection,
          note: "", // 纯标注：无文字
          origin: "manual",
          color: color || WHALE_COLOR_LIST[2].value, // 默认青蓝
          style: (style as any) || "highlight",
          scope: style ? "sentence" : "word",
        });
        this.applyAnnotationBlockMarks();
        this.renderDockIfTab("annotations");
        showMessage("已标记", 1500, "success" as any);
      } catch (e: any) {
        showMessage(`标记失败：${e?.message || e}`, 3000, "error");
      }
      pop.remove();
    };

    pop.querySelectorAll("[data-color]").forEach((btn) => {
      btn.addEventListener("click", () => doMark((btn as HTMLElement).dataset.color, undefined));
    });
    pop.querySelectorAll("[data-style]").forEach((btn) => {
      btn.addEventListener("click", () => doMark(undefined, (btn as HTMLElement).dataset.style));
    });

    // 点击外部关闭（一次性监听，避免污染全局）
    const onDocDown = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node)) {
        pop.remove();
        document.removeEventListener("mousedown", onDocDown, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);
  }

  /**
   * 显示悬浮词典弹窗（在工具栏按钮附近）
   */
  private showFloatingDictPopup(word: string, anchor?: HTMLElement) {
    // 先关闭已有弹窗
    this.closeFloatingPopup();

    const popup = document.createElement("div");
    popup.className = "hiword-float-popup";
    popup.innerHTML = `
      <div class="hiword-float-popup-header">
        <span class="hiword-float-popup-word">${this.escapeHtml(word)}</span>
        <div class="hiword-float-popup-actions">
          <button class="hiword-float-btn" data-action="tts" title="朗读">🔊</button>
          <button class="hiword-float-btn hiword-float-lookup" data-action="lookup-in-sidebar" data-word="${this.escapeAttr(word)}" title="在侧边栏查词并展示完整释义">🔍</button>
          <button class="hiword-float-btn hiword-float-star ${this.vocabStore.hasWord(word) ? "star-on" : ""}" data-action="vocab-star" title="${this.vocabStore.hasWord(word) ? "移出词库" : "加入词库"}">${this.vocabStore.hasWord(word) ? "★" : "☆"}</button>
          <button class="hiword-float-btn hiword-float-close" data-action="close" title="关闭">✕</button>
        </div>
      </div>
      <div class="hiword-float-popup-body" id="hiword-float-body">
        <div class="hiword-float-loading">
          <div class="hiword-dict-spinner"></div>
          <span>查询中...</span>
        </div>
      </div>
    `;
    document.body.appendChild(popup);
    this._floatingPopup = popup;

    // 2026-08-18 修复滚动时图层割裂：动画结束后挂 settled class，
    // 强制清理 transform/动画，让合成器不再把弹窗视作独立合成层，
    // 内部文字层与背景层随之保持同步渲染。
    const onFloatInEnd = (ev: AnimationEvent) => {
      if (ev.animationName === "hiword-float-in") {
        popup.classList.add("hiword-float-popup--settled");
        popup.removeEventListener("animationend", onFloatInEnd);
      }
    };
    popup.addEventListener("animationend", onFloatInEnd);
    // 兜底：若动画未触发（例如 prefers-reduced-motion），200ms 后强制 settled
    setTimeout(() => popup.classList.add("hiword-float-popup--settled"), 220);

    // 定位：锚点在按钮附近
    this.positionFloatingPopup(popup, anchor);
    // 拖拽移动（2026-08-14 新增：工具栏唤起弹窗可拖动）
    this.bindFloatingPopupDrag(popup);

    // 查询词典
    setTimeout(() => {
      const body = popup.querySelector("#hiword-float-body");
      if (!body) return;
      const status = dictEngine.getStatus();
      if (status !== "ready") {
        body.innerHTML = dictRenderer.renderInitRequired();
        body.querySelector("#hiword-dict-manage-btn")?.addEventListener("click", () => {
          this.closeFloatingPopup();
          this.openDictManager();
        });
        return;
      }
      const entry = dictEngine.lookupSmart(word);
      if (entry) {
        const parsed = dictRenderer.parseDictEntry(entry);
        body.innerHTML = dictRenderer.renderDictCard(parsed, {
          showStar: false,
          queryCount: this.vocabStore.getQueryCount(word),
        });
        // P4 在线音标兜底（悬浮弹窗，受设置开关控制）
        if (this.onlineSettings?.enabled) maybeFillPhonetic(body as HTMLElement, word);
      } else {
        // 悬浮弹窗离线查不到 → 在线词典兜底（2026-08-15 新增）
        if (this.onlineSettings?.enabled) {
          body.innerHTML = `<div class="hiword-online-loading">🌐 在线词典查询中…</div>`;
          fetchOnlineDict(word).then((r) => {
            if (!body.isConnected) return;
            body.innerHTML = r ? renderOnlineDictCard(r, false) : dictRenderer.renderNotFound(word);
          });
        } else {
          body.innerHTML = dictRenderer.renderNotFound(word);
        }
      }
    }, 80);

    // 绑定事件（点击交互逻辑抽成 bindDictPopupClick，悬浮弹窗与 hover 弹窗共用）
    this.bindDictPopupClick(popup, word);

    // 点击外部关闭（全局 mousedown 监听，需可靠移除，根因修复 #1）
    const closeOnOutside = (ev: MouseEvent) => {
      if (this._vocabPickOpen) return; // 收藏分类浮窗打开时，保留释义窗口不被误关
      if (!popup.contains(ev.target as Node)) {
        this.closeFloatingPopup();
      }
    };
    // 延迟注册：避免刚弹出时「触发弹出」的那次 mousedown 立刻把它关掉
    const outsideTimer = setTimeout(() => {
      document.addEventListener("mousedown", closeOnOutside);
      this._floatingPopupMousedown = closeOnOutside;
    }, 100);
    this.disposables.addTimer(outsideTimer);

    // ESC 关闭（全局 keydown 监听，记录 handler 以便可靠移除）
    const onEsc = (e: KeyboardEvent) => {
      if (this._vocabPickOpen) return; // 优先让收藏分类浮窗处理 Esc
      if (e.key === "Escape") {
        this.closeFloatingPopup();
      }
    };
    document.addEventListener("keydown", onEsc);
    this._floatingPopupKeydown = onEsc;
  }

  /**
   * 词典类弹窗（悬浮弹窗 / hover 取词弹窗）的通用点击交互。
   * 涵盖：朗读 / 收藏星 / 跳转侧边栏 / 展开全量义项 / 展开例句 / 折叠词组短语区块 /
   * 相关词跳转(dict-jump) / 相似词候选(lookup-candidate)。
   * @param popup 弹窗根元素
   * @param word  当前弹窗查询的词（作为 data 缺失时的回退）
   */
  private bindDictPopupClick(popup: HTMLElement, word: string): void {
    popup.addEventListener("click", async (e) => {
      // 用 closest 向上查找带 data-action 的祖先：点例句里的文字/🔊 小图标也能命中
      const target = (e.target as HTMLElement).closest("[data-action]") as HTMLElement || (e.target as HTMLElement);
      const action = target.dataset.action;
      if (!action) return;
      // 例句行带 data-text（优先朗读整句），单词头部按钮带 data-word；都没有则退化为查询词
      const ttsText = target.dataset.text || target.dataset.word || word;
      if (action === "close") {
        this.closeFloatingPopup();
        this.closeHoverPopup();
      } else if (action === "tts") {
        if (ttsText) this.speak(ttsText);
      } else if (action === "vocab-star") {
        // 悬浮弹窗收藏星：两级选择（词本→子类），内部刷新星态。
        // 关键：用按钮自身 data-word（相似词跳转后即为跳转目标词），而非闭包里的原词，
        // 否则在原窗口跳转后点星标会把「原词」而非「当前展示的相似词」加入词库。
        const starWord = target.dataset.word || word;
        await this.toggleVocabStar(starWord, target);
      } else if (action === "lookup-in-sidebar" || action === "open-in-sidebar") {
        // 弹窗 → 侧边栏：一键把当前查询词送到侧边栏查词卡，即时展示完整释义（不打断编辑状态）
        const sendWord = target.dataset.word || word;
        this.openWordInSidebar(sendWord);
      } else if (action === "dict-jump" || action === "lookup-candidate") {
        // 相关词 / 相似词跳转：在同类弹窗内重新查询
        const jumpWord = target.dataset.word || "";
        if (jumpWord) this.relookupInPopup(popup, jumpWord);
      } else if (action === "toggle-senses") {
        // 「查看全部 N 个义项」按钮：全量列表显隐 + 初始列表同步隐藏
        const full = target.nextElementSibling as HTMLElement | null;
        if (full && full.classList.contains("hiword-dict-senses-full")) {
          const willShow = full.hidden;
          full.hidden = !willShow;
          target.classList.toggle("hiword-dict-senses-open", willShow);
          const arrow = target.querySelector(".hiword-dict-senses-toggle-arrow");
          if (arrow) arrow.textContent = willShow ? "▴" : "▾";
          const initial = target.parentElement?.querySelector(".hiword-dict-senses-initial") as HTMLElement | null;
          if (initial) initial.hidden = willShow;
        }
      } else if (action === "toggle-examples") {
        // 义项内例句展开/收起
        const moreContainer = target.closest(".hiword-dict-sense-ex-more");
        const rest = moreContainer?.querySelector(".hiword-dict-sense-ex-rest") as HTMLElement | null;
        if (moreContainer && rest) {
          const willShow = rest.hidden;
          rest.hidden = !willShow;
          const exCount = moreContainer.querySelectorAll(".hiword-dict-sense-ex-row").length;
          target.innerHTML = `<span class="hiword-dict-sense-toggle-arrow">${willShow ? "▴" : "▾"}</span> ${willShow ? "收起例句" : `展开 ${Math.max(0, exCount - 1)} 条例句`}`;
        }
      } else if (action === "toggle-section") {
        // 「词组·短语」层折叠/展开
        const sec = (target.closest(".hiword-detail-section") as HTMLElement) || null;
        if (sec) sec.classList.toggle("hiword-detail-sec-collapsed");
      }
    });
  }

  /** 在已有弹窗（悬浮 / hover）内重新查询另一个词（相关词/相似词跳转）。 */
  private relookupInPopup(popup: HTMLElement, word: string): void {
    const body = popup.querySelector(".hiword-float-popup-body, .hiword-hover-popup-body") as HTMLElement | null;
    if (!body) return;
    // 若弹窗带独立关闭按钮（hover 无），保持；否则仅替换释义区
    void this.vocabStore?.recordQuery(word);
    const entry = dictEngine.lookupSmart(word);
    if (entry) {
      const parsed = dictRenderer.parseDictEntry(entry);
      // 相似词 / 相关词跳转后重渲染：与原窗口保持一致，必须带收藏星（showStar:true）
      // 并据词库归属显示 ★/☆，否则新窗口缺失星标、无法收藏（用户反馈）。
      body.innerHTML = dictRenderer.renderDictCard(parsed, {
        showStar: true,
        inVocab: this.vocabStore.hasWord(word),
        queryCount: this.vocabStore.getQueryCount(word),
      });
    } else if (this.onlineSettings?.enabled) {
      body.innerHTML = `<div class="hiword-online-loading">🌐 在线词典查询中…</div>`;
      fetchOnlineDict(word).then((r) => {
        if (!body.isConnected) return;
        body.innerHTML = r ? renderOnlineDictCard(r, false) : dictRenderer.renderNotFound(word);
      });
    } else {
      body.innerHTML = dictRenderer.renderNotFound(word);
    }
    // 更新弹窗标题与查询词上下文
    const wordEl = popup.querySelector(".hiword-float-popup-word, .hiword-hover-popup-word") as HTMLElement | null;
    if (wordEl) wordEl.textContent = word;
    popup.dataset.word = word.toLowerCase();
  }

  /** 定位悬浮窗到锚点下方 */
  private positionFloatingPopup(popup: HTMLElement, anchor?: HTMLElement) {
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(420, window.innerWidth - 20);
      popup.style.width = `${width}px`;
      // 默认显示在锚点下方偏右
      let left = rect.right - width + 10;
      let top = rect.bottom + 6;
      // 边界修正
      if (left < 10) left = 10;
      if (left + width > window.innerWidth - 10) left = window.innerWidth - width - 10;
      if (top + 400 > window.innerHeight && rect.top > 400) {
        // 空间不够时改到上方
        top = rect.top - 6; // 后面用 bottom 定位
        popup.style.bottom = `${window.innerHeight - top + 6}px`;
        popup.style.top = "auto";
        popup.style.maxHeight = `${Math.min(450, rect.top - 20)}px`;
        return;
      }
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
      popup.style.maxHeight = `${Math.min(450, window.innerHeight - top - 20)}px`;
    } else {
      // 无锚点时居中偏上
      popup.style.left = "50%";
      popup.style.transform = "translateX(-50%)";
      popup.style.top = "80px";
    }
  }

  /**
   * 悬浮弹窗拖拽（2026-08-14 新增）。
   * 基于 mousedown/mousemove/mouseup 的经典拖拽：
   *  - 仅头部（header）可拖，避免误拖正文里的例句/按钮；
   *  - 拖拽时统一用 left/top 定位（清除可能存在的 bottom / translateX(-50%)）；
   *  - 视口边界限制：不拖出屏幕；
   *  - 拖拽期间 document 级 user-select:none，防止选中文字污染选区。
   */
  private bindFloatingPopupDrag(popup: HTMLElement): void {
    const header = popup.querySelector(".hiword-float-popup-header") as HTMLElement | null;
    if (!header) return;

    let dragging = false;
    let startX = 0, startY = 0;
    let originLeft = 0, originTop = 0;

    const onMove = (e: MouseEvent): void => {
      if (!dragging) return;
      e.preventDefault();
      const rect = popup.getBoundingClientRect();
      const w = rect.width || 420;
      const h = rect.height || 200;
      // 边界限制（留 6px 安全边距，不拖出屏幕）
      let left = originLeft + (e.clientX - startX);
      let top = originTop + (e.clientY - startY);
      left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
      top = Math.max(6, Math.min(top, window.innerHeight - h - 6));
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
      popup.style.bottom = "auto";
      popup.style.transform = "none";
    };

    const onUp = (): void => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("hiword-dragging");
    };

    header.addEventListener("mousedown", (e) => {
      // 点头部按钮（关闭/朗读/收藏等）不触发拖拽
      if ((e.target as HTMLElement).closest("button")) return;
      // 多选文本时也不触发（用户可能想复制词头）
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = popup.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      // 立即固化 left/top 定位，避免拖拽过程中 bottom/translate 干扰
      popup.style.left = `${originLeft}px`;
      popup.style.top = `${originTop}px`;
      popup.style.bottom = "auto";
      popup.style.transform = "none";
      document.body.classList.add("hiword-dragging");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      e.preventDefault(); // 防止拖拽过程选中词头文本
    });
  }

  /** 关闭悬浮弹窗 */
  private closeFloatingPopup() {
    // 先移除弹窗持有的全局监听，避免跨重载累积（根因修复 #1）
    if (this._floatingPopupMousedown) {
      document.removeEventListener("mousedown", this._floatingPopupMousedown);
      this._floatingPopupMousedown = undefined;
    }
    if (this._floatingPopupKeydown) {
      document.removeEventListener("keydown", this._floatingPopupKeydown);
      this._floatingPopupKeydown = undefined;
    }
    if (this._floatingPopup) {
      this._floatingPopup.remove();
      this._floatingPopup = null;
    }
  }

  // ================= Alt(Option)+悬停取词浮窗 =================
  /**
   * 初始化 Alt(Option)+鼠标悬停取词：按住 Option 键并将光标移到文档单词上即弹出取词浮窗。
   * 与工具栏悬浮弹窗共用渲染/定位/点击交互，但拥有独立生命周期（松开 Option 或移出单词即关闭）。
   */
  private initHoverLookup(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight") {
        this._hoverAltDown = true;
      }
      // 固定态下按 Esc 直接关闭
      if (e.key === "Escape" && this._hoverPopup) {
        this.closeHoverPopup();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight") {
        // 关键改动：松开 Option 不再关闭——识别成功后浮窗「固定」，需显式关闭（× / Esc / 点外部）
        this._hoverAltDown = false;
      }
    };
    // 窗口失焦仅复位 Option 状态；固定中的浮窗保留（用户明确要「固定下来」）
    const onBlur = () => {
      this._hoverAltDown = false;
    };

    const onMove = (e: MouseEvent) => {
      // 光标已在浮窗自身内：保持（便于点击内部按钮、滚动、朗读）
      if (this._hoverPopup && this._hoverPopup.contains(e.target as Node)) return;
      if (!this._hoverAltDown) {
        // 未按住 Option：固定态浮窗保持，不自动关闭（同时跟踪位置，避免重新按 Alt 时阈值误判）
        this._hoverLastX = e.clientX;
        this._hoverLastY = e.clientY;
        return;
      }
      const x = e.clientX;
      const y = e.clientY;
      // 移动阈值：小幅抖动不重算，仅跟随定位，提升流畅度
      if (this._hoverPopup && Math.abs(x - this._hoverLastX) < 4 && Math.abs(y - this._hoverLastY) < 4) {
        this.positionHoverPopup(this._hoverPopup, x, y);
        return;
      }
      this._hoverLastX = x;
      this._hoverLastY = y;
      const tEl = e.target as HTMLElement;
      if (this._hoverRaf) cancelAnimationFrame(this._hoverRaf);
      this._hoverRaf = requestAnimationFrame(() => {
        this._hoverRaf = 0;
        if (!this._hoverAltDown) return;
        // 仅文档编辑区(.protyle-wysiwyg)内的单词才触发，避免插件自身 UI 自触发
        if (tEl && tEl.closest(".protyle-wysiwyg")) {
          const word = this.wordAtPoint(x, y);
          // 识别到词→展示/刷新；未识别到（标点/空白/非英文）→保持当前固定浮窗，不再关闭
          if (word) this.showHoverDictPopup(word, x, y);
        }
        // 命中插件 UI 等非文档区：保持固定浮窗
      });
    };

    this.disposables.addEventListener(document, "keydown", onKeyDown);
    this.disposables.addEventListener(document, "keyup", onKeyUp);
    this.disposables.addEventListener(window, "blur", onBlur);
    this.disposables.addEventListener(document, "mousemove", onMove);

    // 2026-08-22 词库高亮：点击已高亮单词直接跳转词库面板(不弹浮窗,不依赖 Alt 键)
    // 用 capture 阶段,确保比 Alt+hover 浮窗逻辑更早触发
    const onVocabMarkClick = (e: MouseEvent) => {
      if (this._vocabPickOpen) return; // 词库分类浮窗打开时,避免冲突
      const t = e.target as HTMLElement;
      if (!t) return;
      const markEl = t.closest(".hiword-vocab-mark") as HTMLElement | null;
      if (!markEl) return;
      const word = markEl.dataset.vocabWord;
      if (!word) return;
      e.preventDefault();
      e.stopPropagation();
      this.focusFeatureDock("vocab");
      this.scrollVocabPanelToWord(word);
    };
    this.disposables.addEventListener(document, "click", onVocabMarkClick, true);
  }

  /** 取光标下单词（基于 caretRangeFromPoint/caretPositionFromPoint，含边界容差与元素兜底）。无英文单词则返回 null。 */
  private wordAtPoint(x: number, y: number): string | null {
    let node: Node | null = null;
    let offset = 0;
    const anyDoc = document as any;
    if (typeof anyDoc.caretRangeFromPoint === "function") {
      const range = anyDoc.caretRangeFromPoint(x, y) as Range | null;
      if (range) { node = range.startContainer; offset = range.startOffset; }
    } else if (typeof anyDoc.caretPositionFromPoint === "function") {
      const pos = anyDoc.caretPositionFromPoint(x, y) as { offsetNode: Node; offset: number } | null;
      if (pos) { node = pos.offsetNode; offset = pos.offset; }
    }
    // 1) caret 落在文本节点：在 offset 处（及 ±1 容差）取英文词，避免刚好停在词边界/标点处漏识别
    if (node && node.nodeType === 3) {
      const text = node.textContent || "";
      const w =
        this.wordInText(text, offset) ??
        this.wordInText(text, offset - 1) ??
        this.wordInText(text, offset + 1);
      if (w) return w.toLowerCase();
    }
    // 2) 兜底：caret 落在元素节点（链接、样式标签边界等）→ 用 elementFromPoint 取该元素内最近的英文词
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (el) {
      const target = (el.closest("[data-type], .protyle-wysiwyg *") as HTMLElement) || el;
      const w = this.wordNearPoint(target, x, y);
      if (w) return w.toLowerCase();
    }
    return null;
  }

  /** 在文本串中按偏移取出覆盖该位置的英文单词（含连字符/撇号）；越界返回 null。 */
  private wordInText(text: string, offset: number): string | null {
    if (offset < 0 || offset > text.length) return null;
    const WORD_RE = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text)) !== null) {
      if (offset >= m.index && offset <= m.index + m[0].length) return m[0];
    }
    return null;
  }

  /** 兜底：从某元素内取最靠近光标 x 的英文单词（单 token 直接返回；多 token 用 Range 测距取最近）。 */
  private wordNearPoint(el: HTMLElement, x: number, _y: number): string | null {
    const tokens = (el.textContent || "").match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g);
    if (!tokens || tokens.length === 0) return null;
    if (tokens.length === 1) return tokens[0];
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if ((n.textContent || "").trim().length > 0) textNodes.push(n as Text);
    }
    let best: string | null = null;
    let bestDist = Infinity;
    for (const tok of tokens) {
      for (const tn of textNodes) {
        const idx = (tn.textContent || "").indexOf(tok);
        if (idx < 0) continue;
        try {
          range.setStart(tn, idx);
          range.setEnd(tn, idx + tok.length);
          const r = range.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          const dist = Math.abs(r.left + r.width / 2 - x);
          if (dist < bestDist) { bestDist = dist; best = tok; }
        } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · wordNearPoint", "debug"); }
        break; // 该 token 已在某文本节点找到，跳出文本节点循环
      }
    }
    return best;
  }

  /** 将悬停浮窗定位到光标附近（带视口边界修正）。 */
  private positionHoverPopup(popup: HTMLElement, x: number, y: number): void {
    const width = Math.min(380, window.innerWidth - 20);
    popup.style.width = `${width}px`;
    const margin = 12;
    let left = x + 16;
    let top = y + 16;
    const h = popup.offsetHeight || 200;
    if (left + width > window.innerWidth - margin) left = Math.max(margin, x - width - 16);
    if (top + h > window.innerHeight - margin) top = Math.max(margin, y - h - 16);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.maxHeight = `${Math.min(420, window.innerHeight - top - margin)}px`;
  }

  /** 显示/刷新 Alt+悬停取词浮窗（与工具栏悬浮弹窗同源渲染）。 */
  private showHoverDictPopup(word: string, x: number, y: number): void {
    // 同词：仅跟随光标定位，不重查（去抖）
    if (this._hoverWord === word && this._hoverPopup) {
      this.positionHoverPopup(this._hoverPopup, x, y);
      return;
    }
    this.closeHoverPopup();

    const popup = document.createElement("div");
    popup.className = "hiword-hover-popup";
    popup.dataset.word = word;
    popup.innerHTML =
      '<div class="hiword-hover-popup-head">' +
        '<span class="hiword-hover-popup-word">' + this.escapeHtml(word) + "</span>" +
        '<button class="hiword-hover-popup-close" data-action="close" title="关闭（Esc 或点击外部）" aria-label="关闭">×</button>' +
      "</div>" +
      '<div class="hiword-hover-popup-body">' +
        '<div class="hiword-float-loading"><div class="hiword-dict-spinner"></div><span>查询中…</span></div>' +
      "</div>";
    document.body.appendChild(popup);
    this._hoverPopup = popup;
    this._hoverWord = word;

    // 2026-08-18 修复滚动时图层割裂：与浮动弹窗相同 —— 动画结束后挂
    // settled class 清理 transform，让合成器不再把弹窗视作独立合成层。
    const onHoverInEnd = (ev: AnimationEvent) => {
      if (ev.animationName === "hiword-float-in") {
        popup.classList.add("hiword-hover-popup--settled");
        popup.removeEventListener("animationend", onHoverInEnd);
      }
    };
    popup.addEventListener("animationend", onHoverInEnd);
    setTimeout(() => popup.classList.add("hiword-hover-popup--settled"), 220);
    this._hoverPinned = true;
    this.positionHoverPopup(popup, x, y);

    // 固定态：点击外部 / Esc 关闭（延迟注册，避免触发瞬间的误关）
    const closeOnOutside = (ev: MouseEvent) => {
      if (this._vocabPickOpen) return; // 收藏分类浮窗打开时，保留释义窗口不被误关
      if (this._hoverPopup && !this._hoverPopup.contains(ev.target as Node)) {
        this.closeHoverPopup();
      }
    };
    const onEsc = (ev: KeyboardEvent) => {
      if (this._vocabPickOpen) return; // 优先让收藏分类浮窗处理 Esc
      if (ev.key === "Escape" && this._hoverPopup) this.closeHoverPopup();
    };
    this._hoverOutsideTimer = setTimeout(() => {
      document.addEventListener("mousedown", closeOnOutside);
      this._hoverOutsideMd = closeOnOutside;
      document.addEventListener("keydown", onEsc);
      this._hoverKeydown = onEsc;
    }, 120);

    const body = popup.querySelector(".hiword-hover-popup-body") as HTMLElement;
    const status = dictEngine.getStatus();
    if (status !== "ready") {
      body.innerHTML = dictRenderer.renderInitRequired();
      body.querySelector("#hiword-dict-manage-btn")?.addEventListener("click", () => {
        this.closeHoverPopup();
        this.openDictManager();
      });
    } else {
      const entry = dictEngine.lookupSmart(word);
      if (entry) {
        const parsed = dictRenderer.parseDictEntry(entry);
        body.innerHTML = dictRenderer.renderDictCard(parsed, {
          showStar: true,
          inVocab: this.vocabStore.hasWord(word),
          queryCount: this.vocabStore.getQueryCount(word),
        });
        if (this.onlineSettings?.enabled) maybeFillPhonetic(body, word);
      } else if (this.onlineSettings?.enabled) {
        body.innerHTML = `<div class="hiword-online-loading">🌐 在线词典查询中…</div>`;
        fetchOnlineDict(word).then((r) => {
          if (!body.isConnected) return;
          body.innerHTML = r ? renderOnlineDictCard(r, false) : dictRenderer.renderNotFound(word);
        });
      } else {
        body.innerHTML = dictRenderer.renderNotFound(word);
      }
    }

    // 记录查询次数（仅词库内单词生效），绑定点击交互
    void this.vocabStore?.recordQuery(word);
    this.bindDictPopupClick(popup, word);
  }

  /** 关闭 Alt+悬停取词浮窗（同时移除固定态的全局监听，避免跨重载累积）。 */
  private closeHoverPopup(): void {
    if (this._hoverOutsideTimer) {
      clearTimeout(this._hoverOutsideTimer);
      this._hoverOutsideTimer = undefined;
    }
    if (this._hoverOutsideMd) {
      document.removeEventListener("mousedown", this._hoverOutsideMd);
      this._hoverOutsideMd = undefined;
    }
    if (this._hoverKeydown) {
      document.removeEventListener("keydown", this._hoverKeydown);
      this._hoverKeydown = undefined;
    }
    if (this._hoverPopup) {
      this._hoverPopup.remove();
      this._hoverPopup = null;
    }
    this._hoverWord = null;
    this._hoverPinned = false;
  }

  /**
   * 弹窗 → 侧边栏：把当前查询词一键送到侧边栏查词卡并即时展示。
   * 流程：关闭弹窗（保持编辑器编辑状态）→ 呼出 Dock（siyuan dock.show，静默降级）
   * → 切到「查词典」Tab → 填充输入框 → 执行查询渲染。
   * 侧边栏展示内容与弹窗同源（renderDictCard），且支持继续输入其他单词切换查询。
   */
  private openWordInSidebar(w: string) {
    this.closeFloatingPopup();
    const dockEl = this.dockElement;
    if (!dockEl) return;

    // 确保侧边栏 Dock 可见：SiYuan 前端 dock.show(type) 按注册 type 呼出
    try {
      const ws: any = (window as any).siyuan?.ws;
      if (ws && typeof ws.call === "function") {
        ws.call("dock.show", ["hiword-sidebar"]);
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · openWordInSidebar", "debug"); }

    // 切到「查词典」Tab（renderDictPanel 会重建输入框，因此先切 Tab 再填充）
    const tabBtn = dockEl.querySelector('[data-tab="dict"]') as HTMLElement;
    tabBtn?.click();

    setTimeout(() => {
      const input = dockEl.querySelector("#hiword-dict-input") as HTMLInputElement;
      if (input) {
        input.value = w;
        this.doDictLookup(w, dockEl);
      }
    }, 60);
  }

  /** HTML 转义 */
  private escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /** 属性转义（用于 HTML 属性值） */
  private escapeAttr(s: string): string {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /** 批注 note 渲染（2026-08-17：与 whale-renderer.renderAnnotationHTML 保持一致，含彩色高亮兜底） */
  private renderNoteFlex(note: string): string {
    return renderAnnotationHTML(note);
  }

  /** 在原文句子中高亮用户精确选中的文字（首处匹配），其余正常转义 */

  /** 从统一设置对话框读取 AI 设置（容错合并） */
  private readAiSettingsFromDialog(dlg: HTMLElement): AiSettings {
    const q = (sel: string) => dlg.querySelector(sel) as HTMLInputElement | null;
    const enabled = !!q("#us-ai-enabled")?.checked;
    const baseUrl = q("#us-ai-baseurl")?.value?.trim() || DEFAULT_AI_SETTINGS.baseUrl;
    const apiKey = q("#us-ai-apikey")?.value?.trim() || "";
    const model = q("#us-ai-model")?.value?.trim() || DEFAULT_AI_SETTINGS.model;
    const temperature = parseFloat(q("#us-ai-temp")?.value || "0.3");
    const maxTokens = parseInt(q("#us-ai-maxtok")?.value || "2048", 10);
    const jsonMode = !!q("#us-ai-json")?.checked;
    const promptTemplate = q("#us-ai-prompt")?.value || DEFAULT_AI_SETTINGS.promptTemplate;
    return normalizeAiSettings({
      enabled, baseUrl, apiKey, model, temperature, maxTokens, jsonMode, promptTemplate,
    });
  }

  /** 测试 AI 连接：用最小请求探测端点可达性与鉴权 */
  private async testAiConnection(s: AiSettings): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await runAiDeepRead(
        { title: "test", text: "Hello, this is a connection test." },
        { ...s, jsonMode: false, maxTokens: 32 }
      );
      if (res.ok && res.raw) return { ok: true };
      return { ok: false, error: res.error || "服务返回空内容" };
    } catch (e: any) {
      getLogger().warn("[REword] AI 连接测试失败:", { error: e });
      const msg: string = (e?.message || String(e) || "").toLowerCase();
      let hint = "请检查 base URL、API Key 与网络";
      if (msg.includes("401") || msg.includes("unauthorized")) hint = "API Key 无效或已失效";
      else if (msg.includes("429")) hint = "请求过于频繁（429），稍后再试";
      else if (msg.includes("402") || msg.includes("quota")) hint = "账户额度不足（402）";
      else if (msg.includes("timeout") || msg.includes("fetch") || msg.includes("network")) hint = "无法连接服务，检查网络与 base URL";
      return { ok: false, error: hint };
    }
  }

  /** 调用 OpenAI 兼容的 /models 接口获取可用模型列表 */
  private async fetchModelsFromApi(baseUrl: string, apiKey: string): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    try {
      // 规范化 URL：去掉末尾 /models 等路径，只保留 base
      let normalized = baseUrl.trim().replace(/\/+$/, "");
      // 如果用户输入的是完整 /models 路径，去掉它
      normalized = normalized.replace(/\/models$/, "");
      // 确保 /v1 后缀（OpenAI 兼容接口通常在 /v1/models）
      if (!/\/v\d+$/.test(normalized)) {
        normalized = normalized.replace(/\/+$/, "") + "/v1";
      }
      const url = normalized + "/models";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
      const res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let hint = `请求失败 (${res.status})`;
        if (res.status === 401 || res.status === 403) hint = "API Key 无效或无权限";
        else if (res.status === 404) hint = "接口地址不存在（请检查 Base URL）";
        else if (res.status === 429) hint = "请求过于频繁";
        return { ok: false, error: hint + (text ? ": " + text.slice(0, 100) : "") };
      }
      const json = await res.json();
      // OpenAI 兼容格式：{ data: [{ id: "..." }, ...] }
      const data = json?.data;
      if (!Array.isArray(data) || data.length === 0) {
        return { ok: false, error: "未返回模型数据（响应格式可能不兼容）" };
      }
      const ids = data
        .map((item: any) => item?.id || item?.name || "")
        .filter((id: string) => typeof id === "string" && id.length > 0)
        .sort();
      if (ids.length === 0) return { ok: false, error: "解析不到有效模型 ID" };
      return { ok: true, models: ids };
    } catch (e: any) {
      getLogger().warn("[REword] 获取模型列表失败:", { error: e });
      const msg = (e?.message || String(e) || "").toLowerCase();
      let hint = "网络错误，请检查地址与网络";
      if (msg.includes("timeout") || msg.includes("aborted")) hint = "请求超时（15s）";
      else if (msg.includes("fetch") || msg.includes("network") || msg.includes("failed")) hint = "无法连接服务器";
      else if (msg.includes("cors")) hint = "CORS 跨域被拒绝（部分服务商不支持浏览器直连）";
      return { ok: false, error: hint };
    }
  }

  /**
   * 在侧边栏中查询单词（2026-08-22：兼容组合栏 / 独立 Dock 两种停靠方式）
   */
  private lookupWordInDock(word: string) {
    this.focusFeatureDock("dict");
    const el = this.getFeatureElement("dict");
    if (!el) {
      // 侧边栏未打开时，用对话框显示
      this.showDictDialog(word);
      return;
    }
    setTimeout(() => {
      const input = el.querySelector("#hiword-dict-input") as HTMLInputElement | null;
      if (input) {
        input.value = word.trim();
        this.doDictLookup(word.trim(), el);
      } else {
        this.showDictDialog(word);
      }
    }, 150);
  }

  /**
   * 查询选中单词（命令入口）
   */
  private lookupSelectedWord() {
    const selection = window.getSelection()?.toString()?.trim();
    if (!selection) {
      showMessage("请先选中一个单词", 3000, "info");
      return;
    }
    this.lookupWordInDock(selection);
  }

  /**
   * 复习面板（dock「复习」Tab）：展示调度概览 + 入口。
   *  - 4 张指标卡：今日待复习 / 逾期 / 本周已复习 / 估计保留率
   *  - 「开始复习」按钮（唤起 startReviewSession）、「⚙️ 算法设置」按钮（唤起 openReviewSettings）
   *  - 状态筛选（学习中/已归档/已忽略/全部）+ 单词列表（按到期升序，含倒计时/间隔/保留率）
   *  - 空态友好提示
   */
  private renderReviewPanel(dockElement: HTMLElement) {
    if (this._listReading) this.stopListReading();
    const contentEl = dockElement.querySelector("#hiword-dock-content") as HTMLElement;
    if (!contentEl) return;
    if (!this.isReady || !this.vocabStore) {
      contentEl.innerHTML = `<div class="hiword-empty">插件尚未就绪</div>`;
      return;
    }

    const m = this.computeReviewMetrics();
    const all = this.vocabStore.getAllWords();
    const filtered = all.filter(
      (w) => this.reviewStatusFilter === "all" || w.status === this.reviewStatusFilter
    );
    const now = Date.now();
    const list = [...filtered]
      .sort((a, b) => this.dueTimeValue(a, now) - this.dueTimeValue(b, now))
      .slice(0, 60);

    const filters: { key: "all" | "active" | "archived" | "ignored"; label: string }[] = [
      { key: "active", label: "学习中" },
      { key: "archived", label: "已归档" },
      { key: "ignored", label: "已忽略" },
      { key: "all", label: "全部" },
    ];

    const rows = list
      .map((w) => {
        const due = this.dueLabel(w, now);
        const iv = w.intervalDays ? `${w.intervalDays}天` : "—";
        const retStr = (!w.intervalDays || !w.lastReview)
          ? `<span class="hiword-rp-ret hiword-rp-ret--new" title="尚未安排过复习">新</span>`
          : `<span class="hiword-rp-ret" title="估计记忆保留率">${Math.round(this.wordRetention(w, now) * 100)}%</span>`;
        const statusTag =
          w.status === "archived" ? `<span class="hiword-rp-tag hiword-rp-tag--arc">已归档</span>`
          : w.status === "ignored" ? `<span class="hiword-rp-tag hiword-rp-tag--ig">已忽略</span>`
          : "";
        // 词性兜底：已有 pos → meaning 反提 → 本地词典实时反查；查到后异步回填词库
        const posResolved = this.resolvePosWithFallback(w.word, w.pos, w.meaning);
        if (posResolved.fromDict && !this.posBackfillCache.has(w.word)) {
          this.posBackfillCache.add(w.word);
          void this.vocabStore!.upsertWord(w.word, { pos: posResolved.pos });
        }
        const parsed = parseReviewMeaning(w.meaning, posResolved.pos);
        const posText = parsed.pos || "";
        const concise = parsed.senses.slice(0, 2).join("；") || "（暂无释义）";
        const fullSenses = parsed.senses.map((s, i) => `${i + 1}. ${s}`).join("　");
        return `<div class="hiword-rp-row" data-rp-word="${this.escapeHtml(w.word)}">
          <button class="hiword-rp-toggle" type="button" title="展开 / 收起释义">▸</button>
          <div class="hiword-rp-main">
            <div class="hiword-rp-line1">
              <span class="hiword-rp-word">${this.escapeHtml(w.word)}</span>
              ${posText ? `<span class="hiword-rp-pos">${this.escapeHtml(posText)}</span>` : `<span class="hiword-rp-pos hiword-rp-pos--unknown">词性未知</span>`}
              ${statusTag}
            </div>
            <div class="hiword-rp-line2">${this.escapeHtml(concise)}</div>
            <div class="hiword-rp-detail" hidden>
              <div class="hiword-rp-detail-meaning">${this.escapeHtml(fullSenses)}</div>
            </div>
          </div>
          <span class="hiword-rp-due">${this.escapeHtml(due)}</span>
          <span class="hiword-rp-iv">${iv}</span>
          ${retStr}
          <button class="hiword-rp-open" type="button" data-action="rp-open" title="在词典中打开">🔍</button>
        </div>`;
      })
      .join("");

    const emptyHint =
      all.length === 0
        ? `<div class="hiword-empty">词库还没有单词，先添加一些再来复习吧</div>`
        : filtered.length === 0
        ? `<div class="hiword-empty">该筛选下暂无单词</div>`
        : "";

    // 今日已达标：有活跃词但当前无到期项
    const doneBanner = m.active > 0 && m.dueCount === 0
      ? `<div class="hiword-rp-done-banner">🎉 今天没有到期单词，去学点新词或稍后再来</div>`
      : "";

    contentEl.innerHTML = `
      <div class="hiword-review-panel">
        <div class="hiword-rp-metrics">
          <div class="hiword-rp-metric"><div class="hiword-rp-metric-val">${m.dueToday}</div><div class="hiword-rp-metric-label">今日待复习</div></div>
          <div class="hiword-rp-metric hiword-rp-metric--warn"><div class="hiword-rp-metric-val">${m.overdue}</div><div class="hiword-rp-metric-label">逾期</div></div>
          <div class="hiword-rp-metric"><div class="hiword-rp-metric-val">${m.weekReviewed}</div><div class="hiword-rp-metric-label">本周已复习</div></div>
          <div class="hiword-rp-metric"><div class="hiword-rp-metric-val">${m.retention}%</div><div class="hiword-rp-metric-label">估计保留率</div></div>
        </div>
        ${doneBanner}
        <div class="hiword-rp-import-hint" title="将思源笔记中的文档或块拖到本面板，自动识别其中的英文单词并加入复习">⬇ 把思源文档 / 块拖到此处，自动导入英文单词</div>
        <div class="hiword-rp-actions">
          <button class="b3-button hiword-rp-start" data-action="review-start">▶ 开始复习${m.dueCount ? ` (${m.dueCount})` : ""}</button>
          <button class="b3-button" data-action="review-settings" title="调试复习算法参数">⚙️ 算法设置</button>
          <button class="b3-button" data-action="review-add-vocab" title="从单词库挑选单词加入复习队列">＋ 从单词库添加</button>
        </div>
        <div class="hiword-rp-filters">
          ${filters
            .map(
              (f) =>
                `<button class="hiword-rp-filter ${this.reviewStatusFilter === f.key ? "active" : ""}" data-rp-filter="${f.key}">${f.label}</button>`
            )
            .join("")}
        </div>
        <div class="hiword-rp-list">
          ${emptyHint || rows}
        </div>
      </div>
    `;

    // 开始复习
    contentEl.querySelector('[data-action="review-start"]')?.addEventListener("click", () => {
      this.startReviewSession();
    });
    // 算法设置
    contentEl.querySelector('[data-action="review-settings"]')?.addEventListener("click", () => {
      this.openReviewSettings();
    });
    // 状态筛选
    contentEl.querySelectorAll<HTMLElement>("[data-rp-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.reviewStatusFilter = (btn.dataset.rpFilter as typeof this.reviewStatusFilter) ?? "active";
        this.renderReviewPanel(dockElement);
      });
    });
    // 从单词库添加
    contentEl.querySelector('[data-action="review-add-vocab"]')?.addEventListener("click", () => {
      this.showAddFromVocabDialog();
    });
    // 拖入文档 / 块 → 自动识别英文词并加入复习
    const rpPanel = contentEl.querySelector(".hiword-review-panel") as HTMLElement | null;
    if (rpPanel) this.bindReviewDropZone(rpPanel);
    // 列表行：点击单词行就地展开/收起释义；仅 🔍 按钮跳转到词典 Tab
    contentEl.querySelectorAll<HTMLElement>("[data-rp-word]").forEach((row) => {
      const w = row.dataset.rpWord;
      if (!w) return;
      const main = row.querySelector(".hiword-rp-main") as HTMLElement | null;
      const toggle = row.querySelector(".hiword-rp-toggle") as HTMLElement | null;
      const openBtn = row.querySelector('[data-action="rp-open"]') as HTMLElement | null;
      const toggleDetail = () => {
        const detail = row.querySelector(".hiword-rp-detail") as HTMLElement | null;
        if (!detail) return;
        detail.toggleAttribute("hidden");
        row.classList.toggle("hiword-rp-row--expanded", !detail.hasAttribute("hidden"));
      };
      main?.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest('[data-action="rp-open"]')) return;
        toggleDetail();
      });
      toggle?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleDetail();
      });
      openBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.lookupWordInDock(w);
      });
    });
  }

  /**
   * 复习概览指标：今日待复习 / 逾期 / 本周已复习 / 估计保留率。
   * 估计保留率：对活跃词用遗忘曲线 0.9^(已过去天数 / 上次间隔)，新词（无间隔）记 1。
   */
  private computeReviewMetrics(): { dueToday: number; dueCount: number; active: number; overdue: number; weekReviewed: number; retention: number } {
    const now = Date.now();
    const DAY = 86_400_000;
    const sod = new Date();
    sod.setHours(0, 0, 0, 0);
    const startOfDay = sod.getTime();
    const endOfDay = startOfDay + DAY;
    const active = this.vocabStore!.getReviewCandidates();
    let dueToday = 0;
    let dueCount = 0;
    let overdue = 0;
    let weekReviewed = 0;
    let retSum = 0;
    for (const w of active) {
      const due = w.due ? Date.parse(w.due) : NaN;
      if (Number.isNaN(due)) { dueToday++; dueCount++; } // 空 due = 立即可复习（= 今日 + 当前到期）
      else {
        if (due <= endOfDay) dueToday++;
        if (due <= now) dueCount++;
        if (due < startOfDay) overdue++;
      }
      if (w.lastReview) {
        const lr = Date.parse(w.lastReview);
        if (!Number.isNaN(lr) && now - lr <= 7 * DAY) weekReviewed++;
      }
      retSum += this.wordRetention(w, now);
    }
    const retention = active.length ? Math.round((retSum / active.length) * 100) : 100;
    return { dueToday, dueCount, active: active.length, overdue, weekReviewed, retention };
  }

  /** 单词「估计记忆保留率」（0~1）。新词记 1；否则 0.9^(已过去天数 / 上次有效间隔)。 */
  private wordRetention(w: WordRecord, now: number): number {
    if (!w.lastReview || !w.intervalDays) return 1;
    const lr = Date.parse(w.lastReview);
    if (Number.isNaN(lr)) return 1;
    const elapsed = Math.max(0, (now - lr) / 86_400_000);
    const I = Math.max(0.5, w.intervalDays);
    return Math.pow(0.9, elapsed / I);
  }

  /** 排序用：把到期时间映射为数值（空 due / 非法 = 0，即最靠前）。 */
  private dueTimeValue(w: WordRecord, now: number): number {
    if (!w.due) return 0;
    const d = Date.parse(w.due);
    if (Number.isNaN(d)) return 0;
    return d;
  }

  /** 到期文案（倒计时）。 */
  private dueLabel(w: WordRecord, now: number): string {
    if (!w.due) return "立即可复习";
    const d = Date.parse(w.due);
    if (Number.isNaN(d)) return "立即可复习";
    const diff = d - now;
    const DAY = 86_400_000;
    if (diff <= 0) {
      const days = Math.ceil(-diff / DAY);
      return days <= 0 ? "今天到期" : `逾期 ${days} 天`;
    }
    const days = Math.floor(diff / DAY);
    if (days === 0) return "今天到期";
    if (days === 1) return "明天到期";
    return `${days} 天后`;
  }

  /**
   * 复习算法设置（调试参数）：可视化 ReviewConfig 全部可调字段，
   * 提供「保存 / 立即校准 / 重置默认」三动作，保存即落盘并刷新面板。
   */
  private openReviewSettings() {
    if (!this.vocabStore) { showMessage("词库尚未就绪", 2000, "info"); return; }

    // 数字/复选框输入生成器（data-cfg 为嵌套路径，保存时回写）
    const num = (label: string, path: string, val: number, step = "any", min = "", max = "") =>
      `<div class="hiword-rs-field"><label>${label}</label><input type="number" class="b3-text-field" data-cfg="${path}" value="${val}" step="${step}" ${min !== "" ? `min="${min}"` : ""} ${max !== "" ? `max="${max}"` : ""} /></div>`;
    const chk = (label: string, path: string, val: boolean) =>
      `<div class="hiword-rs-field hiword-rs-field--chk"><label>${label}</label><input type="checkbox" class="b3-switch" data-cfg="${path}" ${val ? "checked" : ""} /></div>`;

    // 表单 body：从当前 ReviewConfig 生成（校准/重置后重建即可反映最新值）
    const buildBody = (cfg: ReviewConfig): string => `
      <div class="hiword-rs-group">
        <div class="hiword-rs-group-name">核心调度</div>
        ${num("每日复习上限（0=不限）", "dailyLimit", cfg.dailyLimit, "1", "0")}
        ${num("难度修正系数 c", "difficultyCorrection", cfg.difficultyCorrection, "0.05", "0", "0.8")}
        ${num("词频表规模", "frequencyCorpusSize", cfg.frequencyCorpusSize, "1", "100")}
        ${chk("启用高频词种子", "enableFrequencySeed", cfg.enableFrequencySeed)}
      </div>
      <div class="hiword-rs-group">
        <div class="hiword-rs-group-name">间隔倍率（gradeMultiplier）</div>
        ${num("again", "gradeMultiplier.again", cfg.gradeMultiplier.again, "0.1", "0")}
        ${num("hard", "gradeMultiplier.hard", cfg.gradeMultiplier.hard, "0.1", "0")}
        ${num("good", "gradeMultiplier.good", cfg.gradeMultiplier.good, "0.1", "0")}
        ${num("easy", "gradeMultiplier.easy", cfg.gradeMultiplier.easy, "0.1", "0")}
      </div>
      <div class="hiword-rs-group">
        <div class="hiword-rs-group-name">初始间隔（天，initInterval）</div>
        ${num("hard", "initInterval.hard", cfg.initInterval.hard, "1", "0")}
        ${num("good", "initInterval.good", cfg.initInterval.good, "1", "0")}
        ${num("easy", "initInterval.easy", cfg.initInterval.easy, "1", "0")}
      </div>
      <div class="hiword-rs-group">
        <div class="hiword-rs-group-name">Ease 参数（SM-2）</div>
        ${num("default", "ease.default", cfg.ease.default, "0.1", "1", "4")}
        ${num("min", "ease.min", cfg.ease.min, "0.1", "1", "4")}
        ${num("max", "ease.max", cfg.ease.max, "0.1", "1", "4")}
        ${num("again 降幅", "ease.againDelta", cfg.ease.againDelta, "0.05", "0")}
        ${num("hard 降幅", "ease.hardDelta", cfg.ease.hardDelta, "0.05", "0")}
        ${num("easy 升幅", "ease.easyDelta", cfg.ease.easyDelta, "0.05", "0")}
      </div>
      <div class="hiword-rs-group">
        <div class="hiword-rs-group-name">优先级权重（weights）</div>
        ${num("查询 query", "weights.query", cfg.weights.query, "0.1", "0")}
        ${num("星标 star", "weights.star", cfg.weights.star, "0.1", "0")}
        ${num("时间 time", "weights.time", cfg.weights.time, "0.1", "0")}
        ${num("易度 ease", "weights.ease", cfg.weights.ease, "0.1", "0")}
        ${num("遗忘 lapse", "weights.lapse", cfg.weights.lapse, "0.1", "0")}
        ${num("难度 difficulty", "weights.difficulty", cfg.weights.difficulty, "0.1", "0")}
        ${num("记忆 recall(负向)", "weights.recall", cfg.weights.recall, "0.1", "0")}
      </div>
      <div class="hiword-rs-group">
        <div class="hiword-rs-group-name">难度因子权重（difficultyWeights）</div>
        ${num("稀有度 rarity", "difficultyWeights.rarity", cfg.difficultyWeights.rarity, "0.05", "0")}
        ${num("长度 length", "difficultyWeights.length", cfg.difficultyWeights.length, "0.05", "0")}
        ${num("AWL awl", "difficultyWeights.awl", cfg.difficultyWeights.awl, "0.05", "0")}
        ${num("多义 polysemy", "difficultyWeights.polysemy", cfg.difficultyWeights.polysemy, "0.05", "0")}
      </div>`;

    const dialog = new Dialog({
      title: "复习算法设置（调试参数）",
      width: responsiveDialogSize(760, "width"),
      height: "620px",
      content: `<div class="hiword-rs">
        <div class="hiword-rs-body">${buildBody(getReviewConfig())}</div>
        <div class="hiword-rs-status" data-rs-status style="display:none"></div>
        <div class="hiword-rs-foot">
          <button class="b3-button" data-action="rs-save">保存</button>
          <button class="b3-button b3-button--outline" data-action="rs-calibrate">立即校准</button>
          <button class="b3-button b3-button--outline" data-action="rs-reset">重置默认</button>
          <span class="hiword-rs-hint">保存即写入 hiword-review-config.json 并立即生效</span>
        </div>
      </div>`,
    });

    const root = dialog.element.querySelector(".hiword-rs") as HTMLElement | null;
    if (!root) return;
    const bodyEl = root.querySelector(".hiword-rs-body") as HTMLElement;
    const statusEl = root.querySelector("[data-rs-status]") as HTMLElement;

    const setStatus = (msg: string, kind: "ok" | "warn" | "info" = "ok") => {
      statusEl.textContent = msg;
      statusEl.className = `hiword-rs-status hiword-rs-status--${kind}`;
      statusEl.style.display = "block";
    };

    const readForm = (): DeepPartial<ReviewConfig> => {
      const out: any = {};
      bodyEl.querySelectorAll<HTMLInputElement>("[data-cfg]").forEach((el) => {
        const path = (el.dataset.cfg ?? "").split(".");
        let cur = out;
        for (let i = 0; i < path.length - 1; i++) {
          cur[path[i]] = cur[path[i]] ?? {};
          cur = cur[path[i]];
        }
        const key = path[path.length - 1];
        if (el.type === "checkbox") cur[key] = el.checked;
        else if (el.type === "number") cur[key] = Number(el.value);
        else cur[key] = el.value;
      });
      return out as DeepPartial<ReviewConfig>;
    };

    root.querySelector('[data-action="rs-save"]')?.addEventListener("click", () => {
      setReviewConfig(readForm());
      void this.saveReviewConfig();
      this.refreshActivePanel();
      setStatus("✓ 复习参数已保存并立即生效", "ok");
    });
    root.querySelector('[data-action="rs-calibrate"]')?.addEventListener("click", () => {
      const before = { ...getReviewConfig().gradeMultiplier };
      this.calibrateReview();
      // 校准（如样本足够）会改写配置；重建表单以反映最新倍率
      bodyEl.innerHTML = buildBody(getReviewConfig());
      const after = getReviewConfig().gradeMultiplier;
      const changed = (["hard", "good", "easy"] as const).some((g) => before[g] !== after[g]);
      setStatus(
        changed
          ? `✓ 已校准：good ${before.good.toFixed(2)}→${after.good.toFixed(2)}，hard ${before.hard.toFixed(2)}→${after.hard.toFixed(2)}，easy ${before.easy.toFixed(2)}→${after.easy.toFixed(2)}（详见结果弹窗）`
          : "已尝试校准：历史数据不足或无需调整，保持原值（详见提示）",
        changed ? "ok" : "warn"
      );
    });
    root.querySelector('[data-action="rs-reset"]')?.addEventListener("click", () => {
      this.resetReviewConfigCmd();
      bodyEl.innerHTML = buildBody(getReviewConfig());
      setStatus("已重置为研究级默认值", "info");
    });
  }

  /**
   * 开始复习会话（自研 SRS 入口）：取调度队列候选，逐张卡片评分并回写 SRS 状态。
   * 单词按优先级降序呈现；每张卡先回忆（隐藏释义），点「显示释义」后再评分。
   */
  private startReviewSession() {
    if (!this.isReady || !this.vocabStore) {
      showMessage("词库尚未就绪", 2000, "info");
      return;
    }
    const candidates = this.vocabStore.getReviewCandidates();
    // 每日复习上限（来自 ReviewConfig.dailyLimit；0 = 不限）
    const dailyLimit = getReviewConfig().dailyLimit;
    const queue = getDueQueue(candidates, { includeNotDue: true, limit: dailyLimit > 0 ? dailyLimit : undefined });
    const dueCount = candidates.filter((w) => isDue(w)).length;
    if (queue.length === 0) {
      showMessage("词库还没有单词，先添加一些再来复习吧", 2600, "info");
      return;
    }

    const dialog = new Dialog({
      title: `RE word 复习（${queue.length}${dailyLimit > 0 ? " / 每日 " + dailyLimit : ""} 个候选）`,
      width: responsiveDialogSize(480, "width"),
      height: "520px",
      content: `<div class="hiword-review" id="hiword-review"></div>`,
    });
    const root = dialog.element.querySelector("#hiword-review") as HTMLElement | null;
    if (!root) return;

    let index = 0;
    let revealed = false;
    let archivedCount = 0;
    let ignoredCount = 0;

    // 各档位提示的「安排后预期留存」（与 calibrate 的 targetRetention 概念一致，用于 UI 引导）
    const GRADE_HINT: Record<string, { label: string; retention: string; key: string }> = {
      again: { label: "忘记", retention: "立刻重来", key: "1" },
      hard: { label: "困难", retention: "约 65%", key: "2" },
      good: { label: "良好", retention: "约 90%", key: "3" },
      easy: { label: "简单", retention: "约 98%", key: "4" },
    };

    // 2026-08-22 释义偏好:复习卡片只显示首选,可切回完整 meaning
    let showAllMeaning = false;
    const renderCard = () => {
      const rec = queue[index];
      if (!rec) {
        const done = index;
        const remain = dueCount - done > 0 ? Math.max(0, dueCount - done) : 0;
        const sub = [
          `已复习 ${done} 个`,
          archivedCount ? `归档 ${archivedCount}` : "",
          ignoredCount ? `忽略 ${ignoredCount}` : "",
          remain ? `剩余待复习 ${remain}` : "",
        ].filter(Boolean).join(" · ");
        root!.innerHTML = `<div class="hiword-review__done">
          <div class="hiword-review__done-emoji">✅</div>
          <div>本轮复习完成！</div>
          <div class="hiword-review__done-sub">${sub}</div>
          <button class="b3-button" data-action="review-exit">关闭</button>
        </div>`;
        return;
      }
      // 词性兜底：已有 pos → meaning 反提 → 本地词典实时反查；查到后异步回填词库
      const posResolved = this.resolvePosWithFallback(rec.word, rec.pos, rec.meaning);
      if (posResolved.fromDict && !this.posBackfillCache.has(rec.word)) {
        this.posBackfillCache.add(rec.word);
        void this.vocabStore!.upsertWord(rec.word, { pos: posResolved.pos });
      }
      const parsedReview = parseReviewMeaning(rec.meaning, posResolved.pos);
      const posText = parsedReview.pos || "词性未知";
      // 2026-08-22 释义偏好:有 preferredDefinitions 时默认只显示首选,除非用户点"显示全部"
      const preferred = rec.preferredDefinitions || [];
      const hasPreferred = preferred.length > 0;
      const allMeaningHtml = parsedReview.senses.length
        ? parsedReview.senses.map((s, i) => `<div class="hiword-review__sense"><span class="hiword-review__sense-num">${i + 1}.</span>${this.escapeHtml(s)}</div>`).join("")
        : this.escapeHtml(rec.meaning || "（暂无释义）");
      const preferredMeaningHtml = hasPreferred
        ? preferred.map((z) => `<div class="hiword-review__sense hiword-review__sense--preferred">⭐ ${this.escapeHtml(z)}</div>`).join("")
        : "";
      const meaningHtml = (hasPreferred && !showAllMeaning) ? preferredMeaningHtml : allMeaningHtml;
      // 提示行(只在有偏好时显示):"⭐ 已应用偏好 (N/M) · [切换]"
      const prefHint = hasPreferred
        ? `<div class="hiword-review__pref-hint">
             <span class="hiword-review__pref-info">⭐ 已应用偏好 (${preferred.length} / ${rec.senseCount || preferred.length})</span>
             <a class="hiword-review__pref-toggle" data-action="review-toggle-all">${showAllMeaning ? "只看 ⭐ 偏好" : "📚 显示全部释义"}</a>
           </div>`
        : "";
      const phonetic = rec.phonetic ? `/${rec.phonetic}/` : "";
      const pct = Math.round(((index) / queue.length) * 100);
      root!.innerHTML = `
        <div class="hiword-review__head">
          <span class="hiword-review__counter">${index + 1} / ${queue.length}</span>
          <span class="hiword-review__due">待复习 ${dueCount}</span>
          <button class="b3-button b3-button--small" data-action="review-exit">退出</button>
        </div>
        <div class="hiword-review__progress"><div class="hiword-review__progress-bar" style="width:${pct}%"></div></div>
        <div class="hiword-review__card" title="点击卡片朗读单词">
          <div class="hiword-review__word-row">
            <div class="hiword-review__word">${this.escapeHtml(rec.word)}</div>
            <button class="b3-button hiword-review__speak" data-action="review-tts" title="朗读 ${this.escapeHtml(rec.word)}">🔊</button>
          </div>
          <div class="hiword-review__phon">${this.escapeHtml(phonetic)}</div>
          <div class="hiword-review__pos">${this.escapeHtml(posText)}</div>
          <div class="hiword-review__meaning" ${revealed ? "" : "hidden"}>${meaningHtml}</div>
          ${prefHint}
          <button class="b3-button hiword-review__reveal" data-action="review-reveal" ${revealed ? "hidden" : ""}>显示释义 <span class="hiword-review__kbd">空格</span></button>
        </div>
        <div class="hiword-review__manage">
          <button class="b3-button b3-button--small hiword-review__ignore" data-action="review-ignore">忽略</button>
          <button class="b3-button b3-button--small hiword-review__archive" data-action="review-archive">已掌握·归档</button>
        </div>
        <div class="hiword-review__grades">
          ${(["again", "hard", "good", "easy"] as const).map((g) => `
            <button class="hiword-grade hiword-grade--${g}" data-grade="${g}">
              <span class="hiword-grade__label">${GRADE_HINT[g].label}</span>
              <span class="hiword-grade__retention">${GRADE_HINT[g].retention}</span>
              <span class="hiword-grade__key">${GRADE_HINT[g].key}</span>
            </button>`).join("")}
        </div>`;
    };

    const grade = (g: "again" | "hard" | "good" | "easy") => {
      const rec = queue[index];
      if (!rec) return;
      const patch = nextReviewState(rec, g);
      void this.vocabStore!.updateReviewStats(rec.word, patch);
      index++;
      revealed = false;
      renderCard();
    };

    const advance = () => { index++; revealed = false; renderCard(); };

    root.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest("[data-action],[data-grade]") as HTMLElement | null;
      if (target) {
        const action = target.dataset.action;
        const g = target.dataset.grade as "again" | "hard" | "good" | "easy" | undefined;
        const rec = queue[index];
        if (action === "review-exit") { dialog.destroy(); this.refreshActivePanel(); return; }
        if (action === "review-tts") { if (rec) this.speak(rec.word); return; }
        if (action === "review-reveal") { revealed = true; renderCard(); return; }
        if (action === "review-toggle-all") {
          // 2026-08-22 释义偏好:切换 meaning 区域是显示 ⭐ 首选 还是全部
          showAllMeaning = !showAllMeaning;
          renderCard();
          return;
        }
        if (action === "review-ignore") {
          if (rec) { void this.vocabStore!.ignoreWord(rec.word); ignoredCount++; }
          advance();
          return;
        }
        if (action === "review-archive") {
          if (rec) { void this.vocabStore!.archiveWord(rec.word); archivedCount++; }
          advance();
          return;
        }
        if (g) grade(g);
        return;
      }
      // 点击卡片空白区域朗读当前单词
      const card = (e.target as HTMLElement).closest(".hiword-review__card");
      if (card) {
        const rec = queue[index];
        if (rec) this.speak(rec.word);
      }
    });

    // 键盘快捷键：1-4 评分，空格揭示释义，Esc 退出
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { dialog.destroy(); this.refreshActivePanel(); return; }
      if (e.key === " " || e.code === "Space") { e.preventDefault(); if (!revealed) { revealed = true; renderCard(); } return; }
      const map: Record<string, "again" | "hard" | "good" | "easy"> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
      if (map[e.key]) grade(map[e.key]);
    };
    dialog.element.addEventListener("keydown", onKey);

    renderCard();
  }

  /**
   * 用对话框显示词典结果(备用方案)
   * 2026-08-22 释义偏好:把该词在词库中的 preferredDefinitions 传入 renderDictCard 让命中 sense 高亮 ⭐
   */
  private showDictDialog(word: string) {
    void this.vocabStore?.recordQuery(word);
    const entry = dictEngine.lookupSmart(word);
    // 2026-08-22 释义偏好:从词库拿该词的首选释义
    const rec = this.vocabStore?.findRecord(word);
    const preferredDefinitions = rec?.preferredDefinitions;
    const dialog = new Dialog({
      title: `词典: ${word}`,
      width: responsiveDialogSize(600, "width"),
      height: "500px",
      content: entry
        ? dictRenderer.renderDictCard(dictRenderer.parseDictEntry(entry), {
            showStar: false,
            queryCount: this.vocabStore.getQueryCount(word),
            preferredDefinitions,
          })
        : dictRenderer.renderNotFound(word),
    });

    // 绑定对话框内事件
    dialog.element.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action;
      const w = target.dataset.word;

      if (action === "tts" && w) this.speak(w);
      if (action === "add-vocab" && w && this.isReady) {
        this.addWordToVocab(w);
      }
    });
  }

  /**
   * 选中文本后一键填入右侧边栏并查词（框选快捷键 ⌥⌘L 入口）
   */
  private fillSelectionToSidebar() {
    const selection = window.getSelection()?.toString()?.trim();
    if (!selection) {
      showMessage("请先选中一个单词", 2000, "info");
      return;
    }
    const word = selection;

    const fillAndLookup = () => {
      this.focusFeatureDock("dict");
      const el = this.getFeatureElement("dict");
      if (!el) {
        // Dock 尚未初始化，降级为对话框
        this.showDictDialog(word);
        return;
      }
      setTimeout(() => {
        const input = el.querySelector("#hiword-dict-input") as HTMLInputElement | null;
        if (input) {
          input.value = word;
          this.doDictLookup(word, el);
          input.focus();
        } else {
          this.showDictDialog(word);
        }
      }, 120);
    };

    // Dock 若刚被点击，需等待其 init 渲染完成
    if (this.dockElement) fillAndLookup();
    else setTimeout(fillAndLookup, 250);
  }

  /**
   * 打开「词典管理」对话框（离线词典添加接口）
   */
  private openDictManager() {
    const dialog = new Dialog({
      title: "RE word 词典管理",
      width: responsiveDialogSize(640, "width"),
      height: "480px",
      content: `<div class="hiword-dict-manager" id="hiword-dict-manager"></div>`,
    });
    this.renderDictManagerContent(dialog);
  }

  /**
   * 统一全局设置界面（多模块 Tab：朗读 | 阅读 | 查词典 | AI 精读 | 标注与批注 | 复习计划 | 快捷键 | 数据与备份 | 关于）
   * @param initialTab 打开时定位到的导航页（如 "tts"）；缺省停在第一页
   */
  public openUnifiedSettings(initialTab?: string) {
    const s = this.ttsSettings || { ...DEFAULT_TTS };
    const fs = this.fontSize || "medium";
    const ai = this.aiSettings;
    const fsSizeMap: Record<number, "small" | "medium" | "large" | "xlarge"> = { 0: "small", 1: "medium", 2: "large", 3: "xlarge" };
    const fsLabels: Record<string, string> = { small: "小", medium: "默认", large: "大", xlarge: "特大" };

    const dialog = new Dialog({
      title: "RE word 设置",
      width: responsiveDialogSize(720, "width"),
      height: "580px",
      content: `
        <div class="hiword-unified-panel">
          <!-- 左侧导航 -->
          <nav class="hiword-up-nav">
            <!-- 2026-08-22 许可证已封存：原「🔑 许可证」nav 项在此（恢复时加回）
            <div class="hiword-up-nav-item" data-up-tab="license">
              <span class="hiword-up-nav-icon">🔑</span>许可证
            </div>
            -->
            <div class="hiword-up-nav-item active" data-up-tab="tts">
              <span class="hiword-up-nav-icon">🎤</span>朗读设置
            </div>
            <div class="hiword-up-nav-item" data-up-tab="reader">
              <span class="hiword-up-nav-icon">📚</span>阅读设置
            </div>
            <div class="hiword-up-nav-item" data-up-tab="dict">
              <span class="hiword-up-nav-icon">📖</span>查词典管理
            </div>
            <div class="hiword-up-nav-item" data-up-tab="ai">
              <span class="hiword-up-nav-icon">🤖</span>AI 精读
            </div>
            <div class="hiword-up-nav-item" data-up-tab="annotation">
              <span class="hiword-up-nav-icon">🖍️</span>标注与批注
            </div>
            <div class="hiword-up-nav-item" data-up-tab="review">
              <span class="hiword-up-nav-icon">📅</span>复习计划
            </div>
            <div class="hiword-up-nav-item" data-up-tab="shortcuts">
              <span class="hiword-up-nav-icon">⌨️</span>快捷键
            </div>
            <div class="hiword-up-nav-item" data-up-tab="data">
              <span class="hiword-up-nav-icon">💾</span>数据与备份
            </div>
            <div class="hiword-up-nav-item" data-up-tab="about">
              <span class="hiword-up-nav-icon">ℹ️</span>关于
            </div>
            <!-- 2026-08-21 精简：AI 设置从顶栏 cog 直接进 openAiSettings(更专注/更现代) -->
          </nav>

          <!-- 右侧内容区 -->
          <main class="hiword-up-main">

            <!-- ===== Tab 1: 朗读设置 ===== -->
            <section class="hiword-up-page active" data-page="tts">
              <div class="hiword-up-group">
                <div class="hiword-up-group-label"><span class="hiword-up-group-name">界面字体</span></div>
                <fieldset class="hiword-fs-fieldset">
                  <div class="hiword-fs-slider-wrap">
                    <span class="hiword-fs-label">小</span>
                    <div class="hiword-fs-track-wrap">
                      <input id="up-font-size" class="hiword-fs-slider" type="range" min="0" max="3" step="1" value="${fs === "small" ? "0" : fs === "large" ? "2" : fs === "xlarge" ? "3" : "1"}" />
                      <output class="hiword-fs-thumblabel" id="up-fs-thumb-label" style="left:${(fs === "small" ? 0 : fs === "large" ? 2 : fs === "xlarge" ? 3 : 1) / 3 * 100}%">${fsLabels[fs]}</output>
                    </div>
                    <span class="hiword-fs-label">特大</span>
                  </div>
                  <div class="hiword-fs-ticks">
                    <span class="hiword-fs-tick"></span>
                    <span class="hiword-fs-tick"></span>
                    <span class="hiword-fs-tick"></span>
                    <span class="hiword-fs-tick"></span>
                  </div>
                </fieldset>
                <div class="us-font-preview">
                  <p class="us-preview-label">预览效果：</p>
                  <div class="us-preview-card">
                    <span class="us-pw">world</span> <span class="us-pp">/wɜːld/</span>
                    <div class="us-pos-row"><span class="us-pos-chip">n.</span> <span class="us-meaning">1. 世界；地球</span></div>
                  </div>
                </div>
              </div>

              <div class="hiword-up-group">
                <div class="hiword-up-group-label"><span class="hiword-up-group-name">语音引擎</span></div>
                <div class="hiword-up-field">
                  <label class="hiword-up-field-label" for="up-tts-engine">朗读引擎</label>
                  <select id="up-tts-engine" class="hiword-up-select">
                    <option value="auto" ${(!s.engine || s.engine === "auto") ? "selected" : ""}>自动（在线优先，离线回退，推荐）</option>
                    <option value="system" ${s.engine === "system" ? "selected" : ""}>仅系统语音（离线，最稳）</option>
                    <option value="youdao" ${s.engine === "youdao" ? "selected" : ""}>仅在线真人音（有道）</option>
                    <option value="edge" ${s.engine === "edge" ? "selected" : ""}>Edge 云端神经音（2024 起公开端点已下线，慎选）</option>
                  </select>
                </div>
                <div class="hiword-up-field">
                  <label class="hiword-up-field-label" for="up-tts-accent">口音（在线真人音）</label>
                  <select id="up-tts-accent" class="hiword-up-select">
                    <option value="us" ${s.accent === "us" ? "selected" : ""}>美音 (American)</option>
                    <option value="uk" ${s.accent === "uk" ? "selected" : ""}>英音 (British)</option>
                  </select>
                </div>
                <div class="hiword-up-field">
                  <label class="hiword-up-field-label" for="up-tts-rate">语速 <em id="up-rate-val">${s.rate}</em></label>
                  <input id="up-tts-rate" class="hiword-up-slider" type="range" min="0.5" max="2" step="0.1" value="${s.rate}" />
                </div>
                <div class="hiword-up-field">
                  <label class="hiword-up-field-label" for="up-tts-pitch">音高 <em id="up-pitch-val">${s.pitch}</em>（系统语音）</label>
                  <input id="up-tts-pitch" class="hiword-up-slider" type="range" min="0.5" max="2" step="0.1" value="${s.pitch}" />
                </div>
              </div>

              <div class="hiword-up-group">
                <div class="hiword-up-group-label"><span class="hiword-up-group-name">📋 列表朗读</span></div>
                <div class="hiword-up-field">
                  <label class="hiword-up-field-label" for="up-tts-interval">朗读间隔 <em id="up-interval-val">${s.interval ?? 800}ms</em></label>
                  <input id="up-tts-interval" class="hiword-up-slider" type="range" min="200" max="3000" step="100" value="${s.interval ?? 800}" />
                </div>
                <div class="hiword-up-field">
                  <label class="hiword-up-field-label" for="up-tts-voice">系统语音音色</label>
                  <select id="up-tts-voice" class="hiword-up-select">
                    <option value="">（自动优选最佳英文发音）</option>
                  </select>
                </div>
                <button class="b3-button b3-button--outline" id="up-tts-test" style="margin-top:8px;">试听 "Hello"</button>
              </div>

              <div class="hiword-up-group">
                <div class="hiword-up-group-label"><span class="hiword-up-group-name">在线词典兜底</span><span class="hiword-up-group-desc">离线词典查不到时自动抓取欧路词典网页版</span></div>
                <div class="hiword-up-field">
                  <label class="hiword-up-switch-row">
                    <input type="checkbox" id="up-online-enabled" class="b3-switch" ${this.onlineSettings?.enabled ? "checked" : ""} />
                    <span>启用在线词典兜底</span>
                  </label>
                </div>
                <button class="b3-button b3-button--outline b3-button--small" id="up-online-test">测试在线词典（查 "mastery"）</button>
              </div>

              <div class="hiword-up-group">
                <div class="hiword-up-group-label"><span class="hiword-up-group-name">单词导入</span><span class="hiword-up-group-desc">从 CSV 文件批量导入单词到词库</span></div>
                <div class="hiword-up-field">
                  <input id="up-csv-file" type="file" accept=".csv,.txt" />
                </div>
                <div class="us-import-preview" id="up-import-preview">
                  <p class="us-empty-hint">选择文件后在此预览内容</p>
                </div>
                <button class="b3-button b3-button--outline b3-button--small" id="up-import-btn" disabled>导入到词库</button>
              </div>
            </section>

            <!-- ===== Tab 2: 阅读设置（2026-08-27 统一：与阅读器内文本面板共用同一 ReaderSettingsStore，改动即时生效到已开 Tab） ===== -->
            <section class="hiword-up-page" data-page="reader" style="display:none;">
              <div id="up-reader-settings"><p style="color:#888;padding:20px;text-align:center;">加载中…</p></div>
            </section>

            <!-- ===== Tab 3: 查词典管理 ===== -->
            <section class="hiword-up-page" data-page="dict" style="display:none;">
              <div class="hiword-dict-manager" id="up-dict-manager">
                <p style="color:#888;padding:20px;text-align:center;">加载中…</p>
              </div>
            </section>

            <!-- ===== Tab 4: AI 精读（2026-08-27 统一：复用 renderAiSettingsInto，与独立入口同源） ===== -->
            <section class="hiword-up-page" data-page="ai" style="display:none;">
              <div id="up-ai-settings"><p style="color:#888;padding:20px;text-align:center;">加载中…</p></div>
            </section>

            <!-- ===== Tab 5: 标注与批注 ===== -->
            <section class="hiword-up-page" data-page="annotation" style="display:none;">
              <div id="up-annotation-settings"><p style="color:#888;padding:20px;text-align:center;">加载中…</p></div>
            </section>

            <!-- ===== Tab 4: 复习计划 ===== -->
            <section class="hiword-up-page" data-page="review" style="display:none;">
              <div id="up-review-settings"><p style="color:#888;padding:20px;text-align:center;">加载中…</p></div>
            </section>

            <!-- ===== Tab 5: 快捷键 ===== -->
            <section class="hiword-up-page" data-page="shortcuts" style="display:none;">
              <div id="up-shortcut-settings"><p style="color:#888;padding:20px;text-align:center;">加载中…</p></div>
            </section>

            <!-- ===== Tab 6: 数据与备份 ===== -->
            <section class="hiword-up-page" data-page="data" style="display:none;">
              <div id="up-data-settings"><p style="color:#888;padding:20px;text-align:center;">加载中…</p></div>
            </section>

            <!-- ===== Tab 7: 关于 ===== -->
            <section class="hiword-up-page" data-page="about" style="display:none;">
              <div id="up-about-settings"><p style="color:#888;padding:20px;text-align:center;">加载中…</p></div>
            </section>

            <!-- 2026-08-22 许可证已封存：原「data-page="license"」页面 section 在此（恢复时加回，含 Hero/设备码/激活码/答疑交流） -->

            <!-- 2026-08-21 精简：unified panel 不再含 AI 精读 Tab。
                 AI 设置从顶栏 cog 直接进 openAiSettings(独立对话框,更专注)。 -->

            <!-- 底部操作栏（粘在 main 底部） -->
            <div class="hiword-up-footer">
              <button class="b3-button b3-button--outline" id="up-cancel">取消</button>
              <button class="b3-button b3-button--primary" id="up-save">保存所有设置</button>
            </div>

          </main><!-- /main -->
        </div>
      `,
    });

    // 2026-08-27 视觉：收敛思源弹窗容器默认投影（过重，左侧出现明显暗带），
    // 统一容器圆角与面板一致，避免角落露底
    const dlgShell = dialog.element.closest(".b3-dialog__container") as HTMLElement | null;
    if (dlgShell) dlgShell.classList.add("hw-settings-dialog");

    setTimeout(() => {
      const dlg = dialog.element as HTMLElement;

      // ========== 左侧导航切换 ==========
      dlg.querySelectorAll(".hiword-up-nav-item").forEach((item) => {
        item.addEventListener("click", () => {
          dlg.querySelectorAll(".hiword-up-nav-item").forEach(i => i.classList.remove("active"));
          dlg.querySelectorAll(".hiword-up-page").forEach(p => (p as HTMLElement).style.display = "none");
          item.classList.add("active");
          const page = dlg.querySelector(`.hiword-up-page[data-page="${(item as HTMLElement).dataset.upTab}"]`) as HTMLElement;
          if (page) page.style.display = "";
          // 切到对应 tab 时懒渲染内容（首次渲染后由各自 rendered 标记防止重复）
          const tab = (item as HTMLElement).dataset.upTab;
          if (tab === "dict") this.renderUnifiedDictPanel(dlg, dialog);
          else if (tab === "reader") this.renderReaderSettings(dlg);
          else if (tab === "ai") this.renderAiSettingsInto(dlg.querySelector("#up-ai-settings") as HTMLElement);
          else if (tab === "annotation") this.renderAnnotationSettings(dlg, dialog);
          else if (tab === "review") this.renderReviewSettings(dlg, dialog);
          else if (tab === "shortcuts") this.renderShortcutSettings(dlg, dialog);
          else if (tab === "data") this.renderDataSettings(dlg, dialog);
          else if (tab === "about") this.renderAboutSettings(dlg, dialog);
        });
      });

      // 2026-08-27：支持外部入口指定初始页（如查词面板 🔊 → 朗读设置）
      if (initialTab) {
        (dlg.querySelector(`.hiword-up-nav-item[data-up-tab="${initialTab}"]`) as HTMLElement | null)?.click();
      }

      // 2026-08-22 许可证已封存：原「打开时定位到指定 tab（requireLicense 引导到许可证）」逻辑已移除

      // 2026-08-21 精简：双模式切换器已删除

      // ========== Tab 1: 朗读 - 字体大小 ==========
      const upFsSlider = dlg.querySelector("#up-font-size") as HTMLInputElement;
      const upFsLabel = dlg.querySelector("#up-fs-thumb-label") as HTMLElement;
      upFsSlider?.addEventListener("input", () => {
        const v = parseInt(upFsSlider.value, 10);
        const size = fsSizeMap[v] || "medium";
        if (upFsLabel) {
          upFsLabel.textContent = fsLabels[size];
          // 标签跟随滑块位置（百分比定位，配合 .hiword-fs-thumblabel 绝对居中）
          upFsLabel.style.left = `${(v / 3) * 100}%`;
        }
        this.fontSize = size;
        this.applyFontSize();
        const previewCard = dlg.querySelector(".us-preview-card") as HTMLElement;
        if (previewCard) previewCard.style.fontSize = size === "small" ? "0.85em" : size === "large" ? "1.25em" : size === "xlarge" ? "1.4em" : "1em";
      });

      // ========== Tab 1: 朗读 - TTS 设置 ==========
      const upVoiceSel = dlg.querySelector("#up-tts-voice") as HTMLSelectElement;
      if (upVoiceSel && "speechSynthesis" in window) {
        const fillVoices = () => {
          const voices = window.speechSynthesis.getVoices() || [];
          upVoiceSel.innerHTML = `<option value="">（自动优选最佳英文发音）</option>` +
            voices.map(v => `<option value="${v.voiceURI}" ${v.voiceURI === s.preferVoiceURI ? "selected" : ""}>${v.name} (${v.lang})</option>`).join("");
        };
        fillVoices();
        window.speechSynthesis.onvoiceschanged = fillVoices;
      }
      const upRateInput = dlg.querySelector("#up-tts-rate") as HTMLInputElement;
      const upRateVal = dlg.querySelector("#up-rate-val") as HTMLElement;
      upRateInput?.addEventListener("input", () => { if (upRateVal) upRateVal.textContent = upRateInput.value; });
      const upPitchInput = dlg.querySelector("#up-tts-pitch") as HTMLInputElement;
      const upPitchVal = dlg.querySelector("#up-pitch-val") as HTMLElement;
      upPitchInput?.addEventListener("input", () => { if (upPitchVal) upPitchVal.textContent = upPitchInput.value; });
      const upIntervalInput = dlg.querySelector("#up-tts-interval") as HTMLInputElement;
      const upIntervalVal = dlg.querySelector("#up-interval-val") as HTMLElement;
      upIntervalInput?.addEventListener("input", () => { if (upIntervalVal) upIntervalVal.textContent = upIntervalInput.value + "ms"; });
      const upAccentSel = dlg.querySelector("#up-tts-accent") as HTMLSelectElement;

      dlg.querySelector("#up-tts-test")?.addEventListener("click", () => {
        const engine = (dlg.querySelector("#up-tts-engine") as HTMLSelectElement).value as TtsEngine;
        const rate = parseFloat(upRateInput?.value || "1");
        const pitch = parseFloat(upPitchInput?.value || "1");
        const accent = (upAccentSel?.value as "uk" | "us") || "us";
        const voiceURI = upVoiceSel?.value || undefined;
        const cfg: TtsSettings = { ...(this.ttsSettings || DEFAULT_TTS), engine, rate, pitch, accent, preferVoiceURI: voiceURI, interval: parseFloat(upIntervalInput?.value || "800") };
        if (engine === "system") { this.speakSystem("Hello world", cfg); }
        else if (engine === "youdao") { this.speakOnline("Hello world", accent); }
        else if (engine === "edge") { this.speakOnline("Hello world", accent).then(ok => { if (!ok) this.speakSystem("Hello world", cfg); }); }
        else { this.speakOnline("Hello world", accent).then(ok => { if (!ok) this.speakSystem("Hello world", cfg); }); }
      });

      // ========== 在线词典测试 ==========
      dlg.querySelector("#up-online-test")?.addEventListener("click", async () => {
        showMessage("正在查询在线词典（mastery）…", 1500, "info");
        const r = await fetchOnlineDict("mastery");
        if (r) showMessage(`在线词典可用：${r.phonetic || "无音标"} · ${r.meanings.length} 条释义`, 3000, "success" as any);
        else showMessage("在线词典不可达，请打开控制台查看 [REword] 日志", 4000, "error");
      });

      // ========== CSV 单词导入 ==========
      let csvWords: string[] = [];
      const csvFileInput = dlg.querySelector("#up-csv-file") as HTMLInputElement;
      const importPreview = dlg.querySelector("#up-import-preview") as HTMLElement;
      const importBtn = dlg.querySelector("#up-import-btn") as HTMLButtonElement;
      csvFileInput?.addEventListener("change", async () => {
        const file = csvFileInput.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
          csvWords = lines.map(l => l.split(/[,\t]/)[0].trim()).filter(w => w && /^[a-zA-Z]/.test(w));
          if (csvWords.length > 0) {
            importPreview.innerHTML = `<p>检测到 <b>${csvWords.length}</b> 个单词：</p><ul>${csvWords.slice(0, 20).map(w => `<li>${w}</li>`).join("")}${csvWords.length > 20 ? `<li>... 等 ${csvWords.length - 20} 个</li>` : ""}</ul>`;
            importBtn.disabled = false;
          } else {
            importPreview.innerHTML = `<p class="us-empty-hint">未检测到有效单词</p>`;
            importBtn.disabled = true;
          }
        } catch { importPreview.innerHTML = `<p class="us-empty-hint">文件读取失败</p>`; }
      });
      importBtn?.addEventListener("click", async () => {
        if (!csvWords.length) return;
        let added = 0;
        for (const w of csvWords) { try { await this.vocabStore.addWord(w); added++; } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { await this.vocabStore.addWord(w); added++; }", "debug"); } }
        showMessage(`已导入 ${added}/${csvWords.length} 个单词`, 3000, "success" as any);
        this.renderVocabPanel(this.dockElement!);
        csvWords = [];
        importPreview.innerHTML = `<p class="us-empty-hint">导入完成！可继续选择新文件</p>`;
        importBtn.disabled = true;
        csvFileInput.value = "";
      });

      // ========== Tab 2: 词典管理（延迟渲染） ==========
      // 渲染在 nav 切换时触发

      // ========== Tab 3: AI - 平台配置事件 ==========
      // API Key 显示/隐藏
      dlg.querySelector("#up-ai-toggle-key")?.addEventListener("click", () => {
        const inp = dlg.querySelector("#up-ai-apikey") as HTMLInputElement;
        if (inp) { inp.type = inp.type === "password" ? "text" : "password"; }
      });

      // 模型搜索过滤
      const upModelSearch = dlg.querySelector("#up-ai-model-search") as HTMLInputElement;
      const upModelList = dlg.querySelector("#up-ai-model-list") as HTMLElement;
      upModelSearch?.addEventListener("input", () => {
        const q = upModelSearch.value.toLowerCase().trim();
        upModelList.querySelectorAll(".hiword-ai-model-item").forEach(item => {
          (item as HTMLElement).style.display = (!q || (item as HTMLElement).textContent!.toLowerCase().includes(q)) ? "" : "none";
        });
      });

      // 获取模型按钮
      dlg.querySelector("#up-ai-fetch-models")?.addEventListener("click", async () => {
        const baseUrl = (dlg.querySelector("#up-ai-baseurl") as HTMLInputElement)?.value?.trim();
        const apiKey = (dlg.querySelector("#up-ai-apikey") as HTMLInputElement)?.value?.trim();
        if (!baseUrl || !apiKey) { this.setTestMsg(dlg, "请先填写 API 地址与 API Key", "error"); return; }
        const btn = dlg.querySelector("#up-ai-fetch-models") as HTMLButtonElement;
        btn.disabled = true; btn.textContent = "获取中…";
        try {
          const r = await this.fetchModelsFromApi(baseUrl, apiKey);
          if (r.ok && r.models && r.models.length > 0) {
            // 显示模型选择浮层
            const existing = new Set(Array.from(upModelList.querySelectorAll(".hiword-ai-model-item")).map(el => (el as HTMLElement).dataset.model || ""));
            const available = r.models.filter(m => !existing.has(m));
            if (available.length > 0) this.showModelPickerOverlay(dlg, available, upModelList);
            else this.setTestMsg(dlg, `已获取 ${r.models.length} 个模型，但全部已在列表中`, "ok");
          } else {
            this.setTestMsg(dlg, "未获取到任何模型" + (r.error ? "：" + r.error : ""), "error");
          }
        } catch (e: any) {
          this.setTestMsg(dlg, "获取失败：" + (e.message || String(e)), "error");
        } finally { btn.disabled = false; btn.textContent = "🔍 获取模型"; }
      });

      // 手动添加模型
      dlg.querySelector("#up-ai-model-add")?.addEventListener("click", () => {
        const name = prompt("输入模型名称（如 gpt-4o-mini）：");
        if (!name?.trim()) return;
        const existing = Array.from(upModelList.querySelectorAll(".hiword-ai-model-name")).some(el => el.textContent === name.trim());
        if (existing) { showMessage("该模型已在列表中", 2000, "info"); return; }
        const div = document.createElement("div");
        div.className = "hiword-ai-model-item";
        div.dataset.model = name.trim();
        div.innerHTML = `<span class="hiword-ai-model-name">${this.escapeHtml(name.trim())}</span><button class="hiword-ai-model-del" title="删除">&times;</button>`;
        div.querySelector(".hiword-ai-model-del")?.addEventListener("click", () => div.remove());
        upModelList.appendChild(div);
      });

      // 模型列表删除
      upModelList?.addEventListener("click", e => {
        const target = e.target as HTMLElement;
        if (target.classList.contains("hiword-ai-model-del")) target.closest(".hiword-ai-model-item")?.remove();
      });

      // 温度滑块值
      dlg.querySelector("#up-ai-temp")?.addEventListener("input", () => {
        const val = dlg.querySelector("#up-ai-temp-val");
        if (val) val.textContent = (dlg.querySelector("#up-ai-temp") as HTMLInputElement).value;
      });

      // 模型变化时自动推断上下文窗口（仅在用户未手动修改过时）
      const upModelInput = dlg.querySelector("#up-ai-model") as HTMLInputElement;
      const upCtxWindowInput = dlg.querySelector("#up-ai-ctxwindow") as HTMLInputElement;
      let upCtxWindowTouched = false;
      upCtxWindowInput?.addEventListener("input", () => { upCtxWindowTouched = true; });
      upModelInput?.addEventListener("change", () => {
        if (upCtxWindowTouched) return;
        const inferred = inferContextWindow(upModelInput.value);
        if (upCtxWindowInput) upCtxWindowInput.value = String(inferred);
      });

      // 测试连接
      dlg.querySelector("#up-ai-test")?.addEventListener("click", async () => {
        const cfg = this.readAiSettingsFromDlg(dlg, "up-ai-");
        if (!cfg.apiKey) { this.setTestMsg(dlg, "请先填写 API Key", "error"); return; }
        const testBtn = dlg.querySelector("#up-ai-test") as HTMLButtonElement;
        testBtn.disabled = true; testBtn.textContent = "测试中…";
        this.setTestMsg(dlg, "正在连接…", "");
        const r = await this.testAiConnection(cfg);
        testBtn.disabled = false; testBtn.textContent = "测试连接";
        this.setTestMsg(dlg, r.ok ? "连接成功 ✓" : ("失败：" + (r.error || "请检查配置")), r.ok ? "ok" : "error");
      });

      // ========== Tab 3: AI - 学习模式事件 ==========
      // SOUL 验证
      dlg.querySelector("#up-ai-soul-verify")?.addEventListener("click", async () => {
        const soulId = (dlg.querySelector("#up-ai-soul-id") as HTMLInputElement)?.value?.trim() || "";
        const soulStatus = dlg.querySelector("#up-ai-soul-status") as HTMLElement;
        if (!soulId) { soulStatus.innerHTML = '<span style="color:var(--b3-theme-error,#e00)">请输入文档 ID</span>'; return; }
        soulStatus.innerHTML = '<span style="color:#888">验证中…</span>';
        try {
          const block = await getBlockKramdown(soulId);
          if (block) soulStatus.innerHTML = '<span style="color:#2e7d32;font-weight:500">✓ 有效文档</span>';
          else soulStatus.innerHTML = '<span style="color:#e00">✗ 未找到该文档</span>';
        } catch { soulStatus.innerHTML = '<span style="color:#e00">✗ 验证失败</span>'; }
      });

      // 2026-08-22 许可证已封存：原「Tab 3: 许可证」事件绑定（renderLicenseStatus / 复制设备码 / 激活 / 解除激活）已移除

      // ========== 底部：保存 / 取消 ==========
      dlg.querySelector("#up-cancel")?.addEventListener("click", () => { dialog.destroy(); });

      dlg.querySelector("#up-save")?.addEventListener("click", async () => {
        // --- 保存 TTS ---
        const engine = (dlg.querySelector("#up-tts-engine") as HTMLSelectElement).value as TtsEngine;
        const rate = parseFloat(upRateInput?.value || "1");
        const pitch = parseFloat(upPitchInput?.value || "1");
        const accent = (upAccentSel?.value as "uk" | "us") || "us";
        const voiceURI = upVoiceSel?.value || undefined;
        const interval = parseFloat(upIntervalInput?.value || "800");
        await this.saveTtsSettings({ ...(this.ttsSettings || DEFAULT_TTS), engine, rate, pitch, accent, preferVoiceURI: voiceURI, interval });

        // --- 保存在线词典 ---
        const onlineEnabled = (dlg.querySelector("#up-online-enabled") as HTMLInputElement)?.checked ?? true;
        await this.saveOnlineSettings({ enabled: onlineEnabled });

        // --- 保存字体 ---
        const fsVal = upFsSlider ? parseInt(upFsSlider.value, 10) : 1;
        await this.saveFontSize(fsSizeMap[fsVal] || "medium");

        // 2026-08-21 精简：unified panel 不再保存 AI 设置(已搬到独立对话框 openAiSettings)

        dialog.destroy();
        showMessage("所有设置已保存", 2000, "success" as any);
      });
    }, 50);
  }

  /** 在统一面板中渲染词典管理内容 */
  private renderUnifiedDictPanel(dlg: HTMLElement, dialog: Dialog) {
    const container = dlg.querySelector("#up-dict-manager") as HTMLElement;
    if (!container) return;
    if (container.dataset.rendered === "true") return; // 已渲染过不重复
    container.dataset.rendered = "true";

    const loaded = new Map(dictEngine.listDicts().map(d => [d.id, d]));
    const enDicts = this.dictManifest.dicts.filter(d => d.lang !== "zh");
    const zhDicts = this.dictManifest.dicts.filter(d => d.lang === "zh");
    const actives = this.dictManifest.actives || [this.dictManifest.active];

    const renderGroup = (title: string, icon: string, dicts: DictMeta[]) => {
      if (dicts.length === 0) return "";
      const rows = dicts.map(meta => {
        const info = loaded.get(meta.id);
        const isActive = actives.includes(meta.id);
        const count = info ? `${info.count} 词` : "未加载";
        const typeLabel = meta.type === "stardict" ? "StarDict" : "MDX";
        return `
        <div class="hiword-dm-row" data-id="${meta.id}">
          <div class="hiword-dm-ico">${icon}</div>
          <div class="hiword-dm-info">
            <span class="hiword-dm-name">${meta.name}</span>
            <span class="hiword-dm-meta">${typeLabel}${meta.builtin ? " · 内置" : ""}</span>
          </div>
          <div class="hiword-dm-right">
            <span class="hiword-dm-count ${info ? "is-loaded" : "is-unloaded"}">${count}</span>
            <label class="hiword-dm-toggle ${isActive ? "is-active" : ""}" title="点击启用/停用">
              <input type="checkbox" data-action="toggle-dict" data-id="${meta.id}" ${isActive ? "checked" : ""} />
              <span>${isActive ? "已启用" : "未启用"}</span>
            </label>
            ${meta.builtin ? "" : `<button class="b3-button b3-button--small b3-button--outline hiword-dm-del" data-action="delete" data-id="${meta.id}">删除</button>`}
          </div>
        </div>`;
      }).join("");
      return `<div class="hiword-dm-section"><div class="hiword-dm-section-title">${icon} ${title} (${dicts.length})</div><div class="hiword-dm-list">${rows}</div></div>`;
    };

    container.innerHTML = `
      <div class="hiword-dm-header">
        <div class="hiword-dm-title">
          <svg class="hiword-dm-title-ico"><use xlink:href="#iconREwordDict"></use></svg>
          <div class="hiword-dm-title-text">
            <div class="hiword-dm-h">词典管理</div>
            <div class="hiword-dm-sub">英文词典与中文词典独立管理 · 各常驻一本</div>
          </div>
        </div>
      </div>
      <div class="hiword-dm-hint">选中文本后按 <kbd>⌥⌘L</kbd> 可一键在右侧边栏查词 · <kbd>⌥⌘E</kbd> 框选提取单词</div>
      ${renderGroup("英文词典", "🔤", enDicts)}
      ${renderGroup("中文词典", "🀄", zhDicts)}
      ${this.lastDictError ? `<div class="hiword-dm-diag"><details open><summary>🔍 诊断信息</summary><pre class="hiword-dm-diag-body">${this.escapeHtml(this.getDiagnosticInfo())}</pre></details></div>` : ""}
      <div class="hiword-dm-add">
        <button class="hiword-dm-add-btn" id="up-dm-add-mdx"><span class="hiword-dm-add-ico">📥</span><span class="hiword-dm-add-body"><span class="hiword-dm-add-t">导入 MDX 词典</span><span class="hiword-dm-add-d">选择 .mdx 原包</span></span></button>
        <button class="hiword-dm-add-btn hiword-dm-add-btn--ghost" id="up-dm-add-stardict"><span class="hiword-dm-add-ico">📚</span><span class="hiword-dm-add-body"><span class="hiword-dm-add-t">导入 StarDict</span><span class="hiword-dm-add-d">多选 .ifo/.idx/.dict 包</span></span></button>
        <input type="file" id="up-dm-file-mdx" accept=".mdx" style="display:none" />
        <input type="file" id="up-dm-file-stardict" accept=".ifo,.idx,.dict,.dict.dz,.syn" multiple style="display:none" />
      </div>
      <div class="hiword-dm-tip"><strong>支持格式：</strong><br/>• <strong>MDX</strong>：直接选择 .mdx 原包<br/>• <strong>StarDict</strong>：需同时选择 .ifo/.idx/.dict 或 .dict.dz（.syn 可选）<br/>选择文件后将自动写入插件 dict/ 目录并立即建索引。</div>
      <div class="hiword-dm-footer"><button class="b3-button b3-button--outline b3-button--small" id="up-dm-refresh">刷新</button></div>
    `;

    // MDX 导入
    const addMdxBtn = container.querySelector("#up-dm-add-mdx") as HTMLButtonElement;
    const mdxInput = container.querySelector("#up-dm-file-mdx") as HTMLInputElement;
    addMdxBtn?.addEventListener("click", () => mdxInput?.click());
    mdxInput?.addEventListener("change", async () => {
      const file = mdxInput.files?.[0]; if (file) await this.onDictFileChosen(file, dialog); mdxInput.value = "";
    });

    // StarDict 导入
    const addSdBtn = container.querySelector("#up-dm-add-stardict") as HTMLButtonElement;
    const sdInput = container.querySelector("#up-dm-file-stardict") as HTMLInputElement;
    addSdBtn?.addEventListener("click", () => sdInput?.click());
    sdInput?.addEventListener("change", async () => {
      const files = sdInput.files; if (files && files.length > 0) await this.onStarDictFilesChosen(Array.from(files), dialog); sdInput.value = "";
    });

    // 分区折叠
    container.querySelectorAll(".hiword-dm-section-title").forEach(title => {
      title.addEventListener("click", () => {
        const sec = title.closest(".hiword-dm-section") as HTMLElement; if (sec) sec.classList.toggle("collapsed");
      });
    });

    // 操作委托
    let _toggleDebounce = 0;
    container.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action || (target.closest("[data-action]") as HTMLElement)?.dataset.action;
      const id = target.dataset.id || (target.closest("[data-id]") as HTMLElement)?.dataset.id;
      if (!action || !id) return;
      if (action === "toggle-dict") {
        e.preventDefault(); e.stopPropagation();
        const now = Date.now(); if (now - _toggleDebounce < 300) return; _toggleDebounce = now;
        await this.toggleDictActive(id, dialog); return;
      }
      if (action === "delete") await this.deleteDict(id, dialog);
    });

    // 刷新
    container.querySelector("#up-dm-refresh")?.addEventListener("click", async () => {
      const active = this.dictManifest.dicts.find(d => d.id === this.dictManifest.active) || this.dictManifest.dicts[0];
      if (active) await this.loadDictFile(active);
      (container as HTMLElement).dataset.rendered = "false"; // 重置以便重新渲染
      this.renderUnifiedDictPanel(dlg, dialog);
      showMessage("已刷新", 2000, "info");
    });
  }

  /**
   * 统一设置面板 - 阅读设置（2026-08-27 新增）。
   * 直接读写 ReaderSettingsStore：变更经 svelte store 即时推送到所有已打开的阅读 Tab 并自动持久化，
   * 与阅读器内「文本设置」浮层同源同步，双入口互不冲突。
   */
  private renderReaderSettings(dlg: HTMLElement) {
    const host = dlg.querySelector("#up-reader-settings") as HTMLElement | null;
    if (!host) return;
    if (!this.readerDock) {
      host.innerHTML = '<p style="color:#888;padding:20px;text-align:center;">阅读器未就绪</p>';
      return;
    }
    const st = this.readerDock.settingsStoreRef.get();
    type RdPatch = Partial<import("./reader/reader-settings").ReaderSettings>;
    const apply = (patch: RdPatch) => {
      try { this.readerDock!.settingsStoreRef.update(patch); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · apply", "debug"); }
    };

    const sel = (id: string, label: string, options: Array<[string, string]>, cur: string) => `
      <div class="hiword-up-field">
        <label class="hiword-up-field-label" for="${id}">${label}</label>
        <select id="${id}" class="hiword-up-select">
          ${options.map(([v, n]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${n}</option>`).join("")}
        </select>
      </div>`;
    const rng = (id: string, label: string, min: number, max: number, step: number, val: number, suffix = "") => `
      <div class="hiword-up-field">
        <label class="hiword-up-field-label" for="${id}">${label} <em id="${id}-val">${val}${suffix}</em></label>
        <input id="${id}" class="hiword-up-slider" type="range" min="${min}" max="${max}" step="${step}" value="${val}" />
      </div>`;
    const sw = (id: string, label: string, on: boolean) => `
      <label class="hiword-up-switch-row"><input type="checkbox" id="${id}" class="b3-switch" ${on ? "checked" : ""} /><span>${label}</span></label>`;

    host.innerHTML = `
      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">主题与字体</span><span class="hiword-up-group-desc">修改即时生效到所有已打开的阅读 Tab</span></div>
        ${sel("up-rd-theme", "阅读主题", [
          ["auto", "跟随思源"], ["light", "默认"], ["almond", "杏仁黄"], ["autumn", "秋叶褐"],
          ["green", "青草绿"], ["blue", "海天蓝"], ["night", "夜间"], ["dark", "暗黑"],
          ["gold", "赤金"], ["custom", "自定义（在阅读器内调色）"],
        ], String(st.theme))}
        ${sel("up-rd-fontmode", "正文字体", [
          ["follow-siyuan", "跟随思源（霞鹜文楷等）"], ["custom", "自定义导入字体"], ["system", "系统默认"],
        ], String(st.fontMode))}
        ${sel("up-rd-linewidth", "正文行宽", [["narrow", "窄"], ["normal", "标准"], ["wide", "宽"]], String(st.lineWidth))}
      </div>

      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">字号与排版</span></div>
        ${rng("up-rd-fontsize", "正文字号", 12, 28, 1, st.fontSize, "px")}
        ${rng("up-rd-lineheight", "行距", 1.4, 2.2, 0.05, st.lineHeight)}
        ${sw("up-rd-ovpub", "覆盖出版商字体（强制使用所选字体）", st.overridePublisherFont !== false)}
        ${sw("up-rd-ovfs", "统一正文字号（压平书籍写死字号，A+/A- 全局生效）", st.overrideBookFontSize !== false)}
      </div>

      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">文本与段落</span></div>
        ${rng("up-rd-fw", "字重", 100, 900, 100, st.text?.fontWeight ?? 400)}
        ${rng("up-rd-ls", "字距", -2, 8, 0.5, st.text?.letterSpacing ?? 0, "px")}
        ${rng("up-rd-ps", "段距", 0, 2, 0.1, st.paragraph?.paragraphSpacing ?? 0.8, "em")}
        ${rng("up-rd-ti", "首行缩进", 0, 4, 0.5, st.paragraph?.textIndent ?? 0, "em")}
      </div>

      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">阅读模式</span></div>
        ${sel("up-rd-flow", "阅读模式", [["paginated", "分页"], ["scrolled", "连续滚动"]], String(st.flow))}
        ${sel("up-rd-turn", "翻页动画", [["default", "默认"], ["slide", "滑动"], ["curl", "卷页"]], String(st.turnStyle))}
        ${sw("up-rd-clickturn", "点击正文左右区域翻页", !!st.clickToTurn)}
      </div>

      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">页面布局</span></div>
        ${sw("up-rd-header", "显示页眉（书名 · 章节）", st.layout?.showHeader !== false)}
        ${sw("up-rd-footer", "显示页脚（底部工具栏）", st.layout?.showFooter !== false)}
        ${sw("up-rd-progress", "显示阅读进度", st.layout?.showProgress !== false)}
        ${sel("up-rd-progstyle", "进度样式", [["fraction", "分数（如 5/100）"], ["page", "页码（如 12）"], ["percent", "百分比（如 5%）"]], String(st.layout?.progressStyle ?? "fraction"))}
        ${sw("up-rd-time", "页眉显示当前时间", !!st.layout?.showCurrentTime)}
        <div class="hiword-up-field">
          <label class="hiword-up-field-label">页面边距（px，上下左右）</label>
          <div style="display:flex;gap:8px;">
            <input id="up-rd-mt" class="b3-text-field" type="number" min="0" max="120" value="${st.layout?.marginTopPx ?? 16}" title="上边距" style="width:64px;" />
            <input id="up-rd-mb" class="b3-text-field" type="number" min="0" max="120" value="${st.layout?.marginBottomPx ?? 16}" title="下边距" style="width:64px;" />
            <input id="up-rd-ml" class="b3-text-field" type="number" min="0" max="160" value="${st.layout?.marginLeftPx ?? 16}" title="左边距" style="width:64px;" />
            <input id="up-rd-mr" class="b3-text-field" type="number" min="0" max="160" value="${st.layout?.marginRightPx ?? 16}" title="右边距" style="width:64px;" />
          </div>
        </div>
      </div>
    `;

    // ---- 绑定（全部改动即写即存即推送） ----
    // 嵌套键更新助手：每次从 store 取最新值做合并，避免用渲染时快照导致的互相覆盖
    const setNested = (path: string, value: unknown) => {
      const [top, sub] = path.split(".");
      const cur = this.readerDock!.settingsStoreRef.get() as any;
      const base = cur[top] ?? {};
      apply({ [top]: { ...base, [sub]: value } } as RdPatch);
    };
    const bindSel = (id: string, key: string) => {
      const el = host.querySelector("#" + id) as HTMLSelectElement | null;
      el?.addEventListener("change", () => {
        if (key.includes(".")) setNested(key, el.value);
        else apply({ [key]: el.value } as RdPatch);
      });
    };
    const bindSw = (id: string, key: string) => {
      const el = host.querySelector("#" + id) as HTMLInputElement | null;
      el?.addEventListener("change", () => {
        if (key.includes(".")) setNested(key, el.checked);
        else apply({ [key]: el.checked } as RdPatch);
      });
    };
    const bindRng = (id: string, key: string, suffix = "") => {
      const el = host.querySelector("#" + id) as HTMLInputElement | null;
      const valEl = host.querySelector("#" + id + "-val") as HTMLElement | null;
      el?.addEventListener("input", () => {
        if (valEl) valEl.textContent = el.value + suffix;
        const v = parseFloat(el.value);
        if (key.includes(".")) setNested(key, v);
        else apply({ [key]: v } as RdPatch);
      });
    };
    bindSel("up-rd-theme", "theme");
    bindSel("up-rd-fontmode", "fontMode");
    bindSel("up-rd-linewidth", "lineWidth");
    bindRng("up-rd-fontsize", "fontSize", "px");
    bindRng("up-rd-lineheight", "lineHeight");
    bindSw("up-rd-ovpub", "overridePublisherFont");
    bindSw("up-rd-ovfs", "overrideBookFontSize");
    bindRng("up-rd-fw", "text.fontWeight");
    bindRng("up-rd-ls", "text.letterSpacing", "px");
    bindRng("up-rd-ps", "paragraph.paragraphSpacing", "em");
    bindRng("up-rd-ti", "paragraph.textIndent", "em");
    bindSel("up-rd-flow", "flow");
    bindSel("up-rd-turn", "turnStyle");
    bindSw("up-rd-clickturn", "clickToTurn");
    bindSw("up-rd-header", "layout.showHeader");
    bindSw("up-rd-footer", "layout.showFooter");
    bindSw("up-rd-progress", "layout.showProgress");
    bindSel("up-rd-progstyle", "layout.progressStyle");
    bindSw("up-rd-time", "layout.showCurrentTime");

    // 页面边距（4 个数字输入，input 时合并写回）
    const bindMargin = (id: string, key: string) => {
      const el = host.querySelector("#" + id) as HTMLInputElement | null;
      el?.addEventListener("change", () => {
        const v = Math.max(0, parseInt(el.value, 10) || 0);
        el.value = String(v);
        setNested("layout." + key, v);
      });
    };
    bindMargin("up-rd-mt", "marginTopPx");
    bindMargin("up-rd-mb", "marginBottomPx");
    bindMargin("up-rd-ml", "marginLeftPx");
    bindMargin("up-rd-mr", "marginRightPx");
  }

  /** 统一设置面板 - 标注与批注（默认色/线型/调色板/标签预设） */
  private renderAnnotationSettings(dlg: HTMLElement, dialog: Dialog) {
    const container = dlg.querySelector("#up-annotation-settings") as HTMLElement;
    if (!container) return;
    if (container.dataset.rendered === "true") return;
    container.dataset.rendered = "true";

    const cfg = getAnnotationConfig();
    const STYLE_OPTS: Array<{ v: AnnotationStyle; label: string; desc: string }> = [
      { v: "highlight", label: "背景高亮", desc: "半透明色块铺底" },
      { v: "solid", label: "线段", desc: "文本下方实线" },
      { v: "wavy", label: "波浪线", desc: "文本下方波浪线" },
    ];
    const swatch = (hex: string, active: boolean) =>
      `<button class="hiword-ann-swatch ${active ? "is-active" : ""}" data-ann-color="${hex}" style="--sw:${hex}" title="${hex}"></button>`;

    container.innerHTML = `
      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">默认标注样式</span>
          <span class="hiword-up-group-hint">新建高亮/批注时自动套用，可在创建工具栏随时改</span></div>
        <div class="hiword-up-row">
          <span class="hiword-up-row-k">默认线型</span>
          <div class="hiword-ann-styles" id="up-ann-styles">
            ${STYLE_OPTS.map(o => `<label class="hiword-ann-style ${cfg.defaultStyle === o.v ? "is-active" : ""}" data-ann-style="${o.v}">
              <input type="radio" name="up-ann-style" value="${o.v}" ${cfg.defaultStyle === o.v ? "checked" : ""} />
              <span class="hiword-ann-style-name">${o.label}</span>
              <span class="hiword-ann-style-desc">${o.desc}</span>
            </label>`).join("")}
          </div>
        </div>
        <div class="hiword-up-row">
          <span class="hiword-up-row-k">默认颜色</span>
          <div class="hiword-ann-colors" id="up-ann-colors">
            ${cfg.palette.map(c => swatch(c, c.toLowerCase() === cfg.defaultColor.toLowerCase())).join("")}
            <input type="color" id="up-ann-custom" value="${cfg.defaultColor}" class="hiword-ann-custom" title="自定义默认色" />
          </div>
        </div>
      </div>

      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">调色板</span>
          <span class="hiword-up-group-hint">创建工具栏与高亮卡可选择的颜色组</span></div>
        <div class="hiword-up-row hiword-up-row--block">
          <div class="hiword-ann-palette" id="up-ann-palette">
            ${cfg.palette.map(c => `<div class="hiword-ann-pitem" data-pal="${c}">
              <span class="hiword-ann-pdot" style="background:${c}"></span>
              <button class="hiword-ann-pdel" data-pal-del="${c}" title="移除">×</button>
            </div>`).join("")}
          </div>
          <div class="hiword-ann-addrow">
            <input type="color" id="up-ann-add-color" value="#ff6b6b" class="hiword-ann-custom" />
            <button class="b3-button b3-button--small" id="up-ann-add">加入调色板</button>
          </div>
        </div>
      </div>

      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">标签预设</span>
          <span class="hiword-up-group-hint">每行一个，创建批注时作为可选项</span></div>
        <div class="hiword-up-row hiword-up-row--block">
          <textarea id="up-ann-tags" class="hiword-up-textarea" rows="5" placeholder="每行一个标签，如：生词 / 句法 / 文化">${cfg.tagPresets.join("\n")}</textarea>
        </div>
      </div>
    `;

    container.querySelectorAll<HTMLInputElement>('input[name="up-ann-style"]').forEach(r => {
      r.addEventListener("change", () => {
        if (!r.checked) return;
        setAnnotationConfig({ defaultStyle: r.value as AnnotationStyle });
        container.querySelectorAll(".hiword-ann-style").forEach(el => el.classList.toggle("is-active", (el as HTMLElement).dataset.annStyle === r.value));
        showMessage("默认线型已更新", 1500, "info");
      });
    });

    container.querySelectorAll<HTMLElement>(".hiword-ann-swatch").forEach(btn => {
      btn.addEventListener("click", () => {
        const hex = btn.dataset.annColor!;
        setAnnotationConfig({ defaultColor: hex });
        container.querySelectorAll(".hiword-ann-swatch").forEach(el => el.classList.toggle("is-active", (el as HTMLElement).dataset.annColor!.toLowerCase() === hex.toLowerCase()));
        (container.querySelector("#up-ann-custom") as HTMLInputElement).value = hex;
        showMessage("默认颜色已更新", 1500, "info");
      });
    });
    const customColor = container.querySelector("#up-ann-custom") as HTMLInputElement;
    customColor?.addEventListener("input", () => {
      const hex = customColor.value;
      setAnnotationConfig({ defaultColor: hex });
      container.querySelectorAll(".hiword-ann-swatch").forEach(el => el.classList.toggle("is-active", (el as HTMLElement).dataset.annColor!.toLowerCase() === hex.toLowerCase()));
    });

    container.querySelectorAll<HTMLElement>("[data-pal-del]").forEach(btn => {
      btn.addEventListener("click", () => {
        const hex = btn.dataset.palDel!;
        const pal = getAnnotationPalette().filter(c => c.toLowerCase() !== hex.toLowerCase());
        setAnnotationConfig({ palette: pal });
        btn.closest(".hiword-ann-pitem")?.remove();
      });
    });
    const addColorI = container.querySelector("#up-ann-add-color") as HTMLInputElement;
    container.querySelector("#up-ann-add")?.addEventListener("click", () => {
      const hex = (addColorI?.value || "#ff6b6b").toLowerCase();
      const pal = getAnnotationPalette();
      if (pal.some(c => c.toLowerCase() === hex)) { showMessage("该颜色已在调色板中", 1500, "info"); return; }
      pal.push(hex);
      setAnnotationConfig({ palette: pal });
      container.dataset.rendered = "false";
      this.renderAnnotationSettings(dlg, dialog);
    });

    const tagsTa = container.querySelector("#up-ann-tags") as HTMLTextAreaElement;
    tagsTa?.addEventListener("change", () => {
      const tags = tagsTa.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      setAnnotationConfig({ tagPresets: tags });
      showMessage("标签预设已保存", 1500, "info");
    });
  }

  /** 统一设置面板 - 复习计划（SRS 调参 UI） */
  private renderReviewSettings(dlg: HTMLElement, dialog: Dialog) {
    const container = dlg.querySelector("#up-review-settings") as HTMLElement;
    if (!container) return;
    if (container.dataset.rendered === "true") return;
    container.dataset.rendered = "true";

    const c = getReviewConfig();
    const persist = () => void this.saveReviewConfig();

    container.innerHTML = `
      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">复习节奏</span>
          <span class="hiword-up-group-hint">影响每天复习队列规模与间隔增长</span></div>
        <div class="hiword-up-row">
          <span class="hiword-up-row-k">每日复习上限</span>
          <div class="hiword-up-slider-row">
            <input type="range" id="up-rv-daily" min="0" max="100" step="5" value="${c.dailyLimit}" />
            <span class="hiword-up-slider-val" id="up-rv-daily-v">${c.dailyLimit === 0 ? "不限" : c.dailyLimit + " 个"}</span>
          </div>
        </div>
        <div class="hiword-up-row">
          <span class="hiword-up-row-k">首次「良好」间隔</span>
          <div class="hiword-up-slider-row">
            <input type="range" id="up-rv-good" min="1" max="14" step="1" value="${c.initInterval.good}" />
            <span class="hiword-up-slider-val" id="up-rv-good-v">${c.initInterval.good} 天</span>
          </div>
        </div>
        <div class="hiword-up-row">
          <span class="hiword-up-row-k">首次「轻松」间隔</span>
          <div class="hiword-up-slider-row">
            <input type="range" id="up-rv-easy" min="1" max="21" step="1" value="${c.initInterval.easy}" />
            <span class="hiword-up-slider-val" id="up-rv-easy-v">${c.initInterval.easy} 天</span>
          </div>
        </div>
        <div class="hiword-up-row hiword-up-row--block">
          <span class="hiword-up-row-k">难度折减系数</span>
          <div class="hiword-up-slider-row">
            <input type="range" id="up-rv-diff" min="0" max="0.6" step="0.05" value="${c.difficultyCorrection}" />
            <span class="hiword-up-slider-val" id="up-rv-diff-v">${c.difficultyCorrection.toFixed(2)}</span>
          </div>
          <span class="hiword-up-row-sub">越难的词，有效复习间隔被压缩的比例（0~0.6）</span>
        </div>
        <div class="hiword-up-row hiword-up-row--switch">
          <label class="hiword-up-switch"><input type="checkbox" id="up-rv-seed" ${c.enableFrequencySeed ? "checked" : ""} /><span>启用内置高频词种子（无外部词频表时回退）</span></label>
        </div>
      </div>

      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">校准与重置</span></div>
        <div class="hiword-up-row hiword-up-row--actions">
          <button class="b3-button b3-button--small" id="up-rv-calib">基于复习历史校准</button>
          <button class="b3-button b3-button--small b3-button--outline" id="up-rv-reset">恢复默认参数</button>
        </div>
      </div>
    `;

    const dailyI = container.querySelector("#up-rv-daily") as HTMLInputElement;
    const dailyV = container.querySelector("#up-rv-daily-v") as HTMLElement;
    dailyI?.addEventListener("input", () => {
      const v = parseInt(dailyI.value, 10);
      dailyV.textContent = v === 0 ? "不限" : v + " 个";
      setReviewConfig({ dailyLimit: v }); persist();
    });
    const goodI = container.querySelector("#up-rv-good") as HTMLInputElement;
    const goodV = container.querySelector("#up-rv-good-v") as HTMLElement;
    goodI?.addEventListener("input", () => {
      const v = parseInt(goodI.value, 10);
      goodV.textContent = v + " 天";
      setReviewConfig({ initInterval: { ...getReviewConfig().initInterval, good: v } }); persist();
    });
    const easyI = container.querySelector("#up-rv-easy") as HTMLInputElement;
    const easyV = container.querySelector("#up-rv-easy-v") as HTMLElement;
    easyI?.addEventListener("input", () => {
      const v = parseInt(easyI.value, 10);
      easyV.textContent = v + " 天";
      setReviewConfig({ initInterval: { ...getReviewConfig().initInterval, easy: v } }); persist();
    });
    const diffI = container.querySelector("#up-rv-diff") as HTMLInputElement;
    const diffV = container.querySelector("#up-rv-diff-v") as HTMLElement;
    diffI?.addEventListener("input", () => {
      const v = parseFloat(diffI.value);
      diffV.textContent = v.toFixed(2);
      setReviewConfig({ difficultyCorrection: v }); persist();
    });
    const seedI = container.querySelector("#up-rv-seed") as HTMLInputElement;
    seedI?.addEventListener("change", () => { setReviewConfig({ enableFrequencySeed: seedI.checked }); persist(); });

    container.querySelector("#up-rv-calib")?.addEventListener("click", () => this.calibrateReview());
    container.querySelector("#up-rv-reset")?.addEventListener("click", () => {
      this.resetReviewConfigCmd();
      container.dataset.rendered = "false";
      this.renderReviewSettings(dlg, dialog);
      showMessage("复习参数已恢复默认", 1500, "info");
    });
  }

  /** 统一设置面板 - 快捷键（查看当前键位与冲突，v1 只读） */
  private renderShortcutSettings(dlg: HTMLElement, dialog: Dialog) {
    const container = dlg.querySelector("#up-shortcut-settings") as HTMLElement;
    if (!container) return;
    if (container.dataset.rendered === "true") return;
    container.dataset.rendered = "true";

    const fmt = (s: ShortcutSpec): string => {
      const p: string[] = [];
      if (s.ctrl) p.push("Ctrl");
      if (s.cmd) p.push("⌘");
      if (s.shift) p.push("Shift");
      if (s.alt) p.push("Alt");
      const key = s.key === " " ? "Space" : s.key.length === 1 ? s.key.toUpperCase() : s.key;
      p.push(key);
      return p.join(" + ");
    };
    const siyuanReserved = [
      { ctrl: true, key: "f" }, { ctrl: true, key: "b" }, { ctrl: true, key: "s" },
      { ctrl: true, key: "t" }, { ctrl: true, key: "l" }, { ctrl: true, key: "p" },
      { ctrl: true, key: "e" }, { ctrl: true, key: "k" }, { ctrl: true, key: "=" },
      { ctrl: true, key: "-" },
    ];
    const conflicts = detectConflicts(siyuanReserved).map(s => s.action);

    const rows = (list: Array<{ action: ShortcutSpec["action"]; label: string; key: string }>) =>
      list.map(item => {
        const isC = conflicts.includes(item.action);
        return `<div class="hiword-sc-row ${isC ? "is-conflict" : ""}">
          <span class="hiword-sc-keys"><kbd>${item.key}</kbd></span>
          <span class="hiword-sc-label">${item.label}</span>
          ${isC ? `<span class="hiword-sc-badge">与思源冲突</span>` : ""}
        </div>`;
      }).join("");

    const modList = READER_SHORTCUTS.map(s => ({ action: s.action, label: s.label, key: fmt(s) }));
    const plainList = NO_MODIFIER_SHORTCUTS.map(s => ({ action: s.action, label: s.label, key: s.key === "?" ? "?" : s.key }));

    container.innerHTML = `
      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">阅读器快捷键</span>
          <span class="hiword-up-group-hint">Mac 上 Ctrl 组合键对应 ⌘；与思源冲突时阅读器自动让行</span></div>
        <div class="hiword-sc-list">${rows(modList)}</div>
      </div>
      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">无修饰键</span></div>
        <div class="hiword-sc-list">${rows(plainList)}</div>
      </div>
      <div class="hiword-up-group hiword-up-group--note">
        当前版本以只读查看为主。如需自定义键位，可后续版本支持重映射。
      </div>
    `;
  }

  /** 统一设置面板 - 数据与备份 */
  private renderDataSettings(dlg: HTMLElement, dialog: Dialog) {
    const container = dlg.querySelector("#up-data-settings") as HTMLElement;
    if (!container) return;
    if (container.dataset.rendered === "true") return;
    container.dataset.rendered = "true";

    const EXPORT_KEYS = [
      "hiword-vocab.json", "hiword-annotations.json", "hiword-vocab-labels.json",
      "hiword-annotation-labels.json", "hiword-labels.json", "hiword-ai.json",
      "hiword-ai-presets.json", "hiword-ai-prompts.json", "hiword-ai-sessions.json",
      "copilot-ai.json", "copilot-prompts.json", "copilot-config.json", "copilot-conversations.json",
      "hiword-review-config.json", "hiword-annotation-config.json", "hiword-reader-settings.json",
      "hiword-dock-layout.json", "hiword-dicts.json", "hiword-tts.json",
    ];

    container.innerHTML = `
      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">备份与恢复</span></div>
        <div class="hiword-up-row hiword-up-row--actions">
          <button class="b3-button b3-button--small" id="up-data-export">导出全部数据</button>
          <button class="b3-button b3-button--small b3-button--outline" id="up-data-import">从备份导入</button>
          <input type="file" id="up-data-file" accept=".json" style="display:none" />
        </div>
        <span class="hiword-up-row-sub">导出会把批注 / 生词 / 复习配置 / AI 设置等打包成一个 JSON；导入会覆盖同名数据，重启插件后完全生效。</span>
      </div>

      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">清理与重置</span></div>
        <div class="hiword-up-row hiword-up-row--actions">
          <button class="b3-button b3-button--small b3-button--outline" id="up-data-clearcache">清空在线词典缓存</button>
          <button class="b3-button b3-button--small b3-button--outline" id="up-data-resetreader">重置阅读设置</button>
        </div>
      </div>
    `;

    container.querySelector("#up-data-export")?.addEventListener("click", async () => {
      const bundle: Record<string, unknown> = {};
      let n = 0;
      for (const k of EXPORT_KEYS) {
        const d = await this.loadData(k).catch(() => null);
        if (d !== null && d !== undefined) { bundle[k] = d; n++; }
      }
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reword-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showMessage(`已导出 ${n} 项数据`, 2000, "success" as any);
    });

    const fileInput = container.querySelector("#up-data-file") as HTMLInputElement;
    container.querySelector("#up-data-import")?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const bundle = JSON.parse(text) as Record<string, unknown>;
        let n = 0;
        for (const k of Object.keys(bundle)) { await this.saveData(k, bundle[k]); n++; }
        showMessage(`已导入 ${n} 项数据，重启插件后生效`, 2600, "success" as any);
      } catch (err) {
        showMessage("导入失败：文件不是有效的备份 JSON", 2600, "error" as any);
      }
      fileInput.value = "";
    });

    container.querySelector("#up-data-clearcache")?.addEventListener("click", () => {
      resetOnlineDictCache();
      resetOnlinePhoneticCache();
      showMessage("在线词典缓存已清空", 2000, "info");
    });
    container.querySelector("#up-data-resetreader")?.addEventListener("click", () => {
      this.readerDock?.resetReaderSettings();
      showMessage("阅读设置已重置为默认，重新打开阅读器生效", 2400, "info");
    });
  }

  /** 统一设置面板 - 关于 */
  private renderAboutSettings(dlg: HTMLElement, dialog: Dialog) {
    const container = dlg.querySelector("#up-about-settings") as HTMLElement;
    if (!container) return;
    if (container.dataset.rendered === "true") return;
    container.dataset.rendered = "true";

    container.innerHTML = `
      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">关于 RE word</span></div>
        <div class="hiword-about">
          <div class="hiword-about-logo">RE<span>word</span></div>
          <div class="hiword-about-meta">
            <div class="hiword-about-ver">版本 <strong>v0.1.0</strong></div>
            <div class="hiword-about-desc">离线词典 · 批注精读 · 间隔复习 · EPUB 阅读</div>
          </div>
        </div>
      </div>
      <div class="hiword-up-group">
        <div class="hiword-up-group-label"><span class="hiword-up-group-name">更新日志</span></div>
        <ul class="hiword-changelog">
          <li><b>v0.1.0</b> 阅读器标注层重构：自建 SVG overlay，彻底修复高亮不显示</li>
          <li><b>v0.1.0</b> 统一设置面板：标注与批注 / 复习计划 / 快捷键 / 数据与备份</li>
          <li><b>v0.1.0</b> 批注默认样式、SRS 参数、数据导入导出可配置化</li>
        </ul>
      </div>
      <div class="hiword-up-group hiword-up-group--note">
        反馈与建议：在思源笔记「RE word」对话框或 GitHub Issue 提交。
      </div>
    `;
  }

  /**
   * 思源管理菜单「RE word → 设置」入口。
   * 覆盖 Plugin.openSetting，确保在阅读器 Tab、普通文档 Tab 等任意场景下都能打开统一设置面板。
   */
  public openSetting() {
    this.openUnifiedSettings();
  }

  /**
   * AI 设置（独立对话框，仿 copilot openSetting 模式）
   * 从 AI 面板工具栏 ⚙ 或命令「RE word: AI 设置」打开
   */
  /** 打开 AI 精读设置面板（Copilot 风格：左侧导航 + 右侧内容） */
  /**
   * AI 精读设置渲染核心（2026-08-27 重构）：模板与绑定抽为可复用方法，
   * 主设置「AI 精读」页与独立入口共用一套实现，避免双份维护漂移。
   * @param host 渲染容器（清空后填充）
   * @param onClose 关闭回调：独立对话框模式销毁弹窗；嵌入主设置模式不传（保存后停留在面板）
   */
  private renderAiSettingsInto(host: HTMLElement, onClose?: () => void) {
    if (!host) return;
    // 嵌入主设置时容器跨 Tab 持久存在：已渲染过则跳过（避免切 Tab 往返丢失未保存的编辑）
    if ((host as HTMLElement).dataset.rendered === "1" && onClose == null) return;
    (host as HTMLElement).dataset.rendered = "1";
    const s = this.aiSettings;
    const dlg = host;
    dlg.innerHTML = `
        <div class="hiword-ai-settings-panel">
          <!-- 左侧导航 -->
          <nav class="hiword-ai-settings-nav">
            <div class="hiword-ai-settings-tab active" data-tab="general">通用</div>
            <div class="hiword-ai-settings-tab" data-tab="service">AI 服务</div>
            <div class="hiword-ai-settings-tab" data-tab="prompt">精读提示词</div>
            <div class="hiword-ai-settings-tab" data-tab="memory">记忆与导出</div>
            <div class="hiword-ai-settings-tab" data-tab="translate">翻译引擎</div>
            <!-- 2026-08-22 调整：许可证已迁到总设置面板 -->
          </nav>
          <!-- 右侧内容区 -->
          <main class="hiword-ai-settings-main">

            <!-- ===== Tab 1: 精读提示词 ===== -->
            <section class="hiword-ai-settings-page" data-page="prompt" style="display:none;">
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">精读系统提示词</span>
                  <span class="hiword-ai-setting-desc">变量：&#123;&#123;text&#125;&#125;（原文）&#123;&#123;title&#125;&#125;（标题）</span>
                </div>
                <textarea id="ais-prompt" class="hiword-ai-setting-textarea" spellcheck="false">${this.escapeHtml(s.promptTemplate)}</textarea>
              </div>
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">输出模式</span>
                </div>
                <div class="hiword-ai-setting-row">
                  <label class="hiword-ai-switch">
                    <input type="checkbox" id="ais-json" ${s.jsonMode ? "checked" : ""} />
                    <span class="hiword-ai-switch-track"></span>
                  </label>
                  <span>结构化 JSON（关闭则直出 Markdown）</span>
                </div>
              </div>
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">阅读器「翻译」预置提示词</span>
                  <span class="hiword-ai-setting-desc">在阅读器选中文本点「翻译」时，此提示词会预填进 AI 精读输入框并自动发送</span>
                </div>
                <textarea id="ais-translate-prompt" class="hiword-ai-setting-textarea" spellcheck="false">${this.escapeHtml(s.translatePrompt)}</textarea>
              </div>
            </section>

            <!-- ===== Tab 2: AI 服务 ===== -->
            <section class="hiword-ai-settings-page" data-page="service" style="display:none;">
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">API 地址</span>
                </div>
                <div class="hiword-ai-field">
                  <input id="ais-baseurl" class="hiword-ai-input" value="${this.escapeAttr(s.baseUrl)}" placeholder="https://api.openai.com/v1" />
                  <span class="hiword-ai-field-hint">以 / 结尾忽略 v1；以 # 结尾强制使用输入地址</span>
                </div>
              </div>
              <!-- 2026-08-21 精简：删除「接口格式」「上下文窗口」「Top P/频率惩罚/存在惩罚」「超时」「截断自动续传」「流式传输模式」字段(用代码默认) -->
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">API Key</span>
                </div>
                <div class="hiword-ai-field">
                  <div class="hiword-ai-input-wrap">
                    <input id="ais-apikey" class="hiword-ai-input" type="password" value="${this.escapeAttr(s.apiKey)}" placeholder="sk-..." />
                    <button class="hiword-ai-icon-btn" id="ais-toggle-key" title="显示/隐藏">👁</button>
                  </div>
                </div>
              </div>
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">当前模型</span>
                </div>
                <div class="hiword-ai-field">
                  <input id="ais-model" class="hiword-ai-input" value="${this.escapeAttr(s.model)}" placeholder="gpt-4o-mini" />
                </div>
              </div>
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">模型列表</span>
                </div>
                <div class="hiword-ai-model-mgr">
                  <div class="hiword-ai-model-search">
                    <input id="ais-model-search" class="hiword-ai-input" placeholder="搜索模型..." />
                    <button class="hiword-ai-btn hiword-ai-btn--ghost hiword-ai-btn--sm" id="ais-fetch-models">获取模型</button>
                    <button class="hiword-ai-btn hiword-ai-btn--ghost hiword-ai-btn--sm" id="ais-model-add">+ 添加</button>
                  </div>
                  <div class="hiword-ai-model-list" id="ais-model-list">
                    ${(s.models || DEFAULT_MODELS).map(m => `
                      <div class="hiword-ai-model-item" data-model="${this.escapeAttr(m)}">
                        <span class="hiword-ai-model-name">${this.escapeHtml(m)}</span>
                        <button class="hiword-ai-model-del" title="删除">&times;</button>
                      </div>
                    `).join("")}
                  </div>
                </div>
              </div>
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">生成参数</span>
                </div>
                <div class="hiword-ai-field-row">
                  <div class="hiword-ai-field half">
                    <label class="hiword-ai-field-label" for="ais-temp">温度 <em id="ais-temp-val">${s.temperature}</em></label>
                    <input id="ais-temp" class="hiword-ai-slider" type="range" min="0" max="2" step="0.1" value="${s.temperature}" />
                  </div>
                  <div class="hiword-ai-field half">
                    <label class="hiword-ai-field-label" for="ais-maxtok">最大 Token</label>
                    <input id="ais-maxtok" class="hiword-ai-input" type="number" min="16" max="32768" step="16" value="${s.maxTokens}" />
                  </div>
                </div>
              </div>
              <div class="hiword-ai-test-row">
                <button class="b3-button b3-button--outline" id="ais-test">测试连接</button>
                <span class="hiword-ai-test-msg" id="ais-test-msg"></span>
              </div>
            </section>

            <!-- ===== Tab 3: 通用 ===== -->
            <section class="hiword-ai-settings-page" data-page="general">
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-row">
                  <label class="hiword-ai-switch">
                    <input type="checkbox" id="ais-enabled" ${s.enabled ? "checked" : ""} />
                    <span class="hiword-ai-switch-track"></span>
                  </label>
                  <span>启用 AI 精读</span>
                </div>
              </div>
              <!-- 2026-08-21 精简：删除「发送快捷键」「默认模式」字段(用思源约定 + jsonMode 控制) -->
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">消息字号</span>
                </div>
                <div class="hiword-ai-field">
                  <input id="ais-fontsize" class="hiword-ai-input" type="number" min="10" max="24" step="1" value="${s.fontSize}" />
                </div>
              </div>
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">输入框字号</span>
                </div>
                <div class="hiword-ai-field">
                  <input id="ais-input-fontsize" class="hiword-ai-input" type="number" min="10" max="24" step="1" value="${s.inputFontSize}" />
                </div>
              </div>
            </section>

            <!-- ===== Tab 4: 记忆与导出 ===== -->
            <section class="hiword-ai-settings-page" data-page="memory" style="display:none;">
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">SOUL 文档</span>
                  <span class="hiword-ai-setting-desc">用于持久化记忆上下文的思源文档 ID</span>
                </div>
                <div class="hiword-ai-soul-row">
                  <input id="ais-soul-id" class="hiword-ai-input" value="${this.escapeAttr(s.soulDocId)}" placeholder="输入思源文档 ID" />
                  <button class="b3-button b3-button--outline" id="ais-soul-verify">验证</button>
                </div>
                <div class="hiword-ai-soul-status" id="ais-soul-status"></div>
              </div>
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">导出笔记本</span>
                </div>
                <div class="hiword-ai-field">
                  <select id="ais-export-nb" class="hiword-ai-select">
                    <option value="" ${!s.exportNotebookId ? "selected" : ""}>收集箱「待整理」</option>
                  </select>
                </div>
              </div>
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">导出路径模板</span>
                  <span class="hiword-ai-setting-desc">支持 sprig 语法，如 /&#123;&#123;now | date "2006/200601"&#125;&#125;/</span>
                </div>
                <div class="hiword-ai-field">
                  <input id="ais-export-path" class="hiword-ai-input" value="${this.escapeAttr(s.exportSavePath)}" placeholder="留空则使用当前文档路径" />
                </div>
              </div>
            </section>

            <!-- ===== Tab 5: 翻译引擎（2026-08-28：AI 首选，免费引擎默认关闭、可开关兜底） ===== -->
            <section class="hiword-ai-settings-page" data-page="translate" style="display:none;">
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">翻译引擎说明</span>
                  <span class="hiword-ai-setting-desc">双语对照 / 划词翻译默认使用上方「AI 服务」中配置的模型（AI 首选，批量直译）。以下免费引擎默认关闭，仅作为 AI 失败时的兜底。</span>
                </div>
              </div>
              <!-- ===== 2026-08-28 AI 翻译参数（首选引擎，默认同 index.ts 常量） ===== -->
              <div class="hiword-ai-setting-group" style="border: 0.5px solid var(--b3-theme-primary, #4285f4); border-radius: 8px; padding: 14px 16px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                  <span class="hiword-ai-setting-name" style="font-size: 14px; font-weight: 500;">AI 翻译参数</span>
                  <span style="font-size: 11px; background: var(--b3-theme-primary, #4285f4); color: #fff; padding: 1px 7px; border-radius: 10px;">首选引擎</span>
                </div>
                <p class="hiword-ai-setting-desc" style="margin-bottom: 12px;">调节 AI 批量翻译的行为。大部分情况保持默认即可；模型较弱或网络不稳时可降低每批段数。以下参数与「精读提示词」Tab 共用同一翻译提示词。</p>
                <div class="hiword-ai-field">
                  <label class="hiword-ai-field-label" for="ais-tr-prompt">翻译提示词</label>
                  <textarea id="ais-tr-prompt" class="hiword-ai-setting-textarea" spellcheck="false">${this.escapeHtml(s.translatePrompt)}</textarea>
                  <span class="hiword-ai-setting-desc" style="display: block; margin-top: 3px;">发送给模型的系统提示词，控制翻译风格与输出格式（与「精读提示词」Tab 同步）。</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px;">
                  <div class="hiword-ai-field">
                    <label class="hiword-ai-field-label" for="ais-tr-batch-size">每批段数</label>
                    <input id="ais-tr-batch-size" class="hiword-ai-input" type="number" min="2" max="20" step="1" value="${s.trBatchSize ?? 8}" />
                    <span class="hiword-ai-setting-desc" style="display: block; margin-top: 3px;">每次 API 请求合并的段落数（默认 8）。值越大越省 token 但易截断。</span>
                  </div>
                  <div class="hiword-ai-field">
                    <label class="hiword-ai-field-label" for="ais-tr-temperature">翻译温度</label>
                    <input id="ais-tr-temperature" class="hiword-ai-input" type="number" min="0" max="1" step="0.1" value="${s.trTemperature ?? 0.2}" />
                    <span class="hiword-ai-setting-desc" style="display: block; margin-top: 3px;">直译建议 0~0.3（低=稳定）；调高会增加润色/改写。</span>
                  </div>
                </div>
                <div class="hiword-ai-field" style="margin-top: 12px;">
                  <label class="hiword-ai-field-label" for="ais-tr-concurrency">并发请求数：<span id="ais-tr-concurrency-val">${s.trConcurrency ?? 2}</span></label>
                  <input id="ais-tr-concurrency" class="hiword-ai-input" type="range" min="1" max="5" step="1" value="${s.trConcurrency ?? 2}" style="width: 100%; accent-color: var(--b3-theme-primary, #4285f4);" />
                  <span class="hiword-ai-setting-desc" style="display: block; margin-top: 3px;">同时发送的批次数（默认 2）。网络好可提高到 3~4 加速。</span>
                </div>
              </div>
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">Microsoft Translator</span>
                  <span class="hiword-ai-setting-desc">Azure 认知服务翻译，免费 200 万字符/月。默认关闭。</span>
                </div>
                <div class="hiword-ai-field-row">
                  <label class="hiword-ai-check">
                    <input type="checkbox" id="ais-ms-enabled" ${s.msEnabled ? "checked" : ""} />
                    <span>启用（AI 失败时兜底）</span>
                  </label>
                </div>
                <div class="hiword-ai-field">
                  <label class="hiword-ai-field-label" for="ais-ms-key">订阅 Key</label>
                  <input id="ais-ms-key" class="hiword-ai-input" type="password" value="${this.escapeAttr(s.msKey || "")}" placeholder="xxxxxxxxxxxxxxxx" />
                </div>
                <div class="hiword-ai-field">
                  <label class="hiword-ai-field-label" for="ais-ms-region">区域</label>
                  <input id="ais-ms-region" class="hiword-ai-input" value="${this.escapeAttr(s.msRegion || "")}" placeholder="如 eastasia / westeurope" />
                </div>
              </div>
              <div class="hiword-ai-setting-group">
                <div class="hiword-ai-setting-label">
                  <span class="hiword-ai-setting-name">LibreTranslate</span>
                  <span class="hiword-ai-setting-desc">开源免费翻译，可填公共实例（如 https://libretranslate.com）。限流/隐私较弱。默认关闭。</span>
                </div>
                <div class="hiword-ai-field-row">
                  <label class="hiword-ai-check">
                    <input type="checkbox" id="ais-libre-enabled" ${s.libreEnabled ? "checked" : ""} />
                    <span>启用（AI 失败时兜底）</span>
                  </label>
                </div>
                <div class="hiword-ai-field">
                  <label class="hiword-ai-field-label" for="ais-libre-url">实例地址</label>
                  <input id="ais-libre-url" class="hiword-ai-input" value="${this.escapeAttr(s.libreUrl || "")}" placeholder="https://libretranslate.com" />
                </div>
              </div>
            </section>

          </main>
        </div>
      `;
      const nav = dlg.querySelector(".hiword-ai-settings-nav") as HTMLElement;
      const pages = dlg.querySelectorAll(".hiword-ai-settings-page");
      const tabs = dlg.querySelectorAll(".hiword-ai-settings-tab");

      // ---- Tab 切换 ----
      nav.addEventListener("click", (e) => {
        const target = (e.target as HTMLElement)?.closest(".hiword-ai-settings-tab") as HTMLElement | null;
        if (!target || !target.dataset.tab) return;
        const tab = target.dataset.tab;
        tabs.forEach(t => t.classList.toggle("active", t === target));
        pages.forEach(p => {
          const pe = p as HTMLElement;
          pe.style.display = (pe as any).dataset?.page === tab ? "" : "none";
        });
      });

      // 2026-08-22 调整：许可证已移到总设置面板(openUnifiedSettings)

      // ---- Tab 1: 提示词（无需额外事件） ----

      // ---- Tab 2: 平台管理 ----
      // API Key 显示/隐藏切换
      const apiKeyInput = dlg.querySelector("#ais-apikey") as HTMLInputElement;
      const toggleKeyBtn = dlg.querySelector("#ais-toggle-key") as HTMLButtonElement;
      toggleKeyBtn?.addEventListener("click", () => {
        const isPassword = apiKeyInput.type === "password";
        apiKeyInput.type = isPassword ? "text" : "password";
        toggleKeyBtn.textContent = isPassword ? "🙈" : "👁";
      });

      // 温度滑块实时值
      const tempSlider = dlg.querySelector("#ais-temp") as HTMLInputElement;
      const tempVal = dlg.querySelector("#ais-temp-val") as HTMLElement;
      tempSlider?.addEventListener("input", () => { if (tempVal) tempVal.textContent = tempSlider.value; });

      // 2026-08-28 AI 翻译并发滑块实时值
      const trConcSlider = dlg.querySelector("#ais-tr-concurrency") as HTMLInputElement;
      const trConcVal = dlg.querySelector("#ais-tr-concurrency-val") as HTMLElement;
      trConcSlider?.addEventListener("input", () => { if (trConcVal) trConcVal.textContent = trConcSlider.value; });

      // 模型变化时自动推断上下文窗口（仅在用户未手动修改过时）
      const aisModelInput = dlg.querySelector("#ais-model") as HTMLInputElement;
      const aisCtxWindowInput = dlg.querySelector("#ais-ctxwindow") as HTMLInputElement;
      let aisCtxWindowTouched = false;
      aisCtxWindowInput?.addEventListener("input", () => { aisCtxWindowTouched = true; });
      aisModelInput?.addEventListener("change", () => {
        if (aisCtxWindowTouched) return;
        const inferred = inferContextWindow(aisModelInput.value);
        if (aisCtxWindowInput) aisCtxWindowInput.value = String(inferred);
      });

      // 模型列表：删除
      const modelList = dlg.querySelector("#ais-model-list") as HTMLElement;
      modelList?.querySelectorAll(".hiword-ai-model-del").forEach(btn => {
        btn.addEventListener("click", () => {
          const item = btn.closest(".hiword-ai-model-item") as HTMLElement;
          item?.remove();
        });
      });

      // 模型列表：手动添加
      const addModelBtn = dlg.querySelector("#ais-model-add") as HTMLButtonElement;
      addModelBtn?.addEventListener("click", () => {
        const name = prompt("请输入模型名称（如 gpt-4o）：");
        if (!name?.trim()) return;
        const trimmed = name.trim();
        // 检查重复
        if (modelList.querySelector(`[data-model="${trimmed}"]`)) { showMessage("模型已存在", 1500, "warning" as any); return; }
        const el = document.createElement("div");
        el.className = "hiword-ai-model-item";
        el.dataset.model = trimmed;
        el.innerHTML = `<span class="hiword-ai-model-name">${this.escapeHtml(trimmed)}</span><button class="hiword-ai-model-del" title="删除">&times;</button>`;
        el.querySelector(".hiword-ai-model-del")?.addEventListener("click", () => el.remove());
        modelList.appendChild(el);
      });

      // 模型搜索过滤
      const modelSearch = dlg.querySelector("#ais-model-search") as HTMLInputElement;
      modelSearch?.addEventListener("input", () => {
        const q = modelSearch.value.toLowerCase();
        modelList.querySelectorAll(".hiword-ai-model-item").forEach(item => {
          const name = (item as HTMLElement).dataset.model?.toLowerCase() || "";
          (item as HTMLElement).style.display = name.includes(q) ? "" : "none";
        });
      });

      // 获取模型（从 API /models 接口拉取）
      const fetchModelsBtn = dlg.querySelector("#ais-fetch-models") as HTMLButtonElement;
      fetchModelsBtn?.addEventListener("click", async () => {
        const baseUrl = (dlg.querySelector("#ais-baseurl") as HTMLInputElement)?.value?.trim() || "";
        const apiKey = (dlg.querySelector("#ais-apikey") as HTMLInputElement)?.value?.trim() || "";
        if (!baseUrl) { showMessage("请先填写 API 地址", 1500, "warning" as any); return; }
        if (!apiKey) { showMessage("请先填写 API Key", 1500, "warning" as any); return; }
        fetchModelsBtn.disabled = true;
        fetchModelsBtn.textContent = "获取中…";
        this.setTestMsg(dlg, "正在获取模型列表…", "");
        const r = await this.fetchModelsFromApi(baseUrl, apiKey);
        fetchModelsBtn.disabled = false;
        fetchModelsBtn.textContent = "🔍 获取模型";
        if (!r.ok || !r.models) {
          this.setTestMsg(dlg, "获取失败: " + (r.error || "未知错误"), "error");
          return;
        }
        // 显示模型选择弹窗
        const existing = new Set(
          Array.from(modelList.querySelectorAll(".hiword-ai-model-item"))
            .map(el => (el as HTMLElement).dataset.model || "")
        );
        const available = r.models.filter(m => !existing.has(m));
        if (available.length === 0) {
          this.setTestMsg(dlg, `已获取 ${r.models.length} 个模型，但全部已在列表中`, "ok");
          return;
        }
        // 创建选择浮层
        const picker = document.createElement("div");
        picker.className = "hiword-ai-model-picker-overlay";
        picker.innerHTML = `
          <div class="hiword-ai-model-picker">
            <div class="hiword-ai-picker-header">
              <span>获取到 ${r.models.length} 个模型</span>
              <span class="hiword-ai-picker-sub">可选 ${available.length} 个新模型</span>
              <button class="hiword-ai-picker-close">&times;</button>
            </div>
            <div class="hiword-ai-picker-search">
              <input placeholder="筛选模型..." value="" />
            </div>
            <div class="hiword-ai-picker-actions">
              <button class="hiword-ai-btn hiword-ai-btn--primary hiword-ai-btn--sm" data-act="select-all">全选</button>
              <button class="hiword-ai-btn hiword-ai-btn--outline hiword-ai-btn--sm" data-act="deselect-all">取消全选</button>
              <button class="hiword-ai-btn hiword-ai-btn--primary" data-act="confirm">添加选中 (0)</button>
            </div>
            <div class="hiword-ai-picker-list">
              ${available.map(m => `
                <label class="hiword-ai-picker-item" data-model="${this.escapeAttr(m)}">
                  <input type="checkbox" />
                  <span class="hiword-ai-picker-name">${this.escapeHtml(m)}</span>
                </label>
              `).join("")}
            </div>
          </div>`;
        dlg.appendChild(picker);

        const pickerList = picker.querySelector(".hiword-ai-picker-list") as HTMLElement;
        const confirmBtn = picker.querySelector("[data-act='confirm']") as HTMLButtonElement;
        const pickerSearch = picker.querySelector(".hiword-ai-picker-search input") as HTMLInputElement;

        // 筛选
        pickerSearch?.addEventListener("input", () => {
          const q = pickerSearch.value.toLowerCase();
          pickerList.querySelectorAll(".hiword-ai-picker-item").forEach(item => {
            const name = (item as HTMLElement).dataset.model?.toLowerCase() || "";
            (item as HTMLElement).style.display = name.includes(q) ? "" : "none";
          });
        });
        // 全选（仅可见项）
        picker.querySelector("[data-act='select-all']")?.addEventListener("click", () => {
          pickerList.querySelectorAll(".hiword-ai-picker-item").forEach(item => {
            if ((item as HTMLElement).style.display !== "none") {
              const cb = item.querySelector("input") as HTMLInputElement;
              cb.checked = true;
              item.classList.add("checked");
            }
          });
          updateConfirmText();
        });
        // 取消全选（仅可见项）
        picker.querySelector("[data-act='deselect-all']")?.addEventListener("click", () => {
          pickerList.querySelectorAll(".hiword-ai-picker-item").forEach(item => {
            if ((item as HTMLElement).style.display !== "none") {
              const cb = item.querySelector("input") as HTMLInputElement;
              cb.checked = false;
              item.classList.remove("checked");
            }
          });
          updateConfirmText();
        });
        // 单项切换
        pickerList.querySelectorAll(".hiword-ai-picker-item input").forEach(cb => {
          cb.addEventListener("change", () => {
            (cb as HTMLElement).closest(".hiword-ai-picker-item")?.classList.toggle("checked", (cb as HTMLInputElement).checked);
            updateConfirmText();
          });
        });
        const updateConfirmText = () => {
          const checked = pickerList.querySelectorAll(".hiword-ai-picker-item input:checked").length;
          confirmBtn.textContent = `添加选中 (${checked})`;
        };
        // 关闭
        picker.querySelector(".hiword-ai-picker-close")?.addEventListener("click", () => picker.remove());
        // 确认添加
        confirmBtn?.addEventListener("click", () => {
          const toAdd: string[] = [];
          pickerList.querySelectorAll(".hiword-ai-picker-item input:checked").forEach(cb => {
            const item = (cb as HTMLElement).closest(".hiword-ai-picker-item") as HTMLElement;
            const m = item.dataset.model || "";
            if (m && !modelList.querySelector(`[data-model="${m}"]`)) {
              toAdd.push(m);
            }
          });
          toAdd.forEach(m => {
            const el = document.createElement("div");
            el.className = "hiword-ai-model-item";
            el.dataset.model = m;
            el.innerHTML = `<span class="hiword-ai-model-name">${this.escapeHtml(m)}</span><button class="hiword-ai-model-del" title="删除">&times;</button>`;
            el.querySelector(".hiword-ai-model-del")?.addEventListener("click", () => el.remove());
            modelList.appendChild(el);
          });
          this.setTestMsg(dlg, `已添加 ${toAdd.length} 个模型`, "ok");
          picker.remove();
        });
      });

      // 测试连接
      const testBtn = dlg.querySelector("#ais-test") as HTMLButtonElement;
      testBtn?.addEventListener("click", async () => {
        const cfg = this.readAiSettingsFromDlg(dlg, "ais-");
        if (!cfg.apiKey) { this.setTestMsg(dlg, "请先填写 API Key", "error"); return; }
        testBtn.disabled = true;
        testBtn.textContent = "测试中…";
        this.setTestMsg(dlg, "正在连接…", "");
        const r = await this.testAiConnection(cfg);
        testBtn.disabled = false;
        testBtn.textContent = "测试连接";
        this.setTestMsg(dlg, r.ok ? "连接成功 ✓" : ("失败：" + (r.error || "请检查配置")), r.ok ? "ok" : "error");
      });

      // ---- Tab 5: SOUL 文档验证 ----
      const soulVerifyBtn = dlg.querySelector("#ais-soul-verify") as HTMLButtonElement;
      const soulStatus = dlg.querySelector("#ais-soul-status") as HTMLElement;
      soulVerifyBtn?.addEventListener("click", async () => {
        const soulId = (dlg.querySelector("#ais-soul-id") as HTMLInputElement)?.value?.trim() || "";
        if (!soulId) { soulStatus.innerHTML = '<span style="color:var(--b3-theme-error,#e00)">请输入文档 ID</span>'; return; }
        soulStatus.innerHTML = '<span style="color:#888">验证中…</span>';
        try {
          const block = await getBlockKramdown(soulId);
          if (block) {
            soulStatus.innerHTML = '<span style="color:#2e7d32;font-weight:500">✓ 有效文档</span>';
          } else {
            soulStatus.innerHTML = '<span style="color:#e00">✗ 未找到该文档</span>';
          }
        } catch {
          soulStatus.innerHTML = '<span style="color:#e00">✗ 验证失败（网络错误或 ID 无效）</span>';
        }
      });

      // 2026-08-22 调整：许可证事件已迁到总设置面板(openUnifiedSettings)

      // ---- 保存按钮（放在右侧内容区底部，Copilot 风格内联） ----
      const saveBar = document.createElement("div");
      saveBar.className = "hiword-ai-settings-savebar";
      saveBar.innerHTML = `
        <button class="b3-button b3-button--outline" id="ais-cancel">取消</button>
        <button class="b3-button b3-button--primary" id="ais-save">保存设置</button>
      `;
      dlg.querySelector(".hiword-ai-settings-main")?.appendChild(saveBar);

      dlg.querySelector("#ais-save")?.addEventListener("click", () => {
        this.aiSettings = this.readAiSettingsFromDlg(dlg, "ais-");
        this.saveAiSettings();
        onClose?.();
        showMessage("AI 设置已保存", 2000, "success" as any);
      });
      dlg.querySelector("#ais-cancel")?.addEventListener("click", () => {
        onClose?.();
      });
  }

  /** 独立 AI 设置入口（顶栏 cog / 命令 / whale 面板桥接）：薄壳包一层 Dialog，内容复用 renderAiSettingsInto */
  public openAiSettings() {
    const dialog = new Dialog({
      title: "AI 精读设置",
      width: responsiveDialogSize(720, "width"),
      height: "520px",
      content: `<div class="hw-ai-settings-host"></div>`,
    });
    const host = dialog.element.querySelector(".hw-ai-settings-host") as HTMLElement;
    if (host) this.renderAiSettingsInto(host, () => dialog.destroy());
  }

  /** 从 AI 设置对话框读取值（prefix 区分统一设置 vs 独立对话框的 ID） */
  private readAiSettingsFromDlg(dlg: HTMLElement, prefix: string = "us-ai-"): AiSettings {
    const q = (sel: string) => dlg.querySelector("#" + prefix + sel) as HTMLElement | null;
    const inputVal = (sel: string) => (q(sel) as HTMLInputElement)?.value?.trim() || "";
    const selectVal = (sel: string) => (q(sel) as HTMLSelectElement)?.value || "";
    const checkboxVal = (sel: string) => !!(q(sel) as HTMLInputElement)?.checked;
    // 2026-08-28 AI 翻译参数：数字输入容错
    const inputNum = (sel: string): number | null => {
      const raw = (q(sel) as HTMLInputElement)?.value?.trim();
      if (raw == null || raw === "") return null;
      const n = parseFloat(raw);
      return isFinite(n) ? n : null;
    };
    const numOr = (v: number | null, fallback: number, min: number, max: number): number => {
      if (v == null || !isFinite(v)) return fallback;
      return Math.min(max, Math.max(min, Math.round(v)));
    };
    // 翻译提示词：精读提示词 Tab(ais-translate-prompt) 与翻译引擎 Tab(ais-tr-prompt) 共用，取有改动的那个
    const resolveTranslatePrompt = (): string => {
      const cur = this.aiSettings?.translatePrompt || DEFAULT_AI_SETTINGS.translatePrompt;
      const trVal = (q("tr-prompt") as HTMLTextAreaElement)?.value?.trim();
      const deepVal = (q("translate-prompt") as HTMLTextAreaElement)?.value?.trim();
      if (trVal && trVal !== cur) return trVal;
      if (deepVal && deepVal !== cur) return deepVal;
      return cur;
    };

    // 模型列表：从 DOM 列表项读取
    const modelListEl = dlg.querySelector("#" + prefix + "model-list") as HTMLElement | null;
    const models: string[] = [];
    if (modelListEl) {
      modelListEl.querySelectorAll(".hiword-ai-model-item").forEach(item => {
        const name = (item as HTMLElement).dataset.model?.trim();
        if (name) models.push(name);
      });
    }

    return {
      enabled: checkboxVal("enabled"),
      baseUrl: inputVal("baseurl") || DEFAULT_AI_SETTINGS.baseUrl,
      apiKey: inputVal("apikey"),
      // 2026-08-21 精简：删除 chatApi 字段保存(默认 openai-completion 唯一)
      model: inputVal("model") || DEFAULT_AI_SETTINGS.model,
      models: models.length ? models : [...DEFAULT_MODELS],
      temperature: parseFloat(inputVal("temp")) || DEFAULT_AI_SETTINGS.temperature,
      maxTokens: parseInt(inputVal("maxtok"), 10) || DEFAULT_AI_SETTINGS.maxTokens,
      // 2026-08-21 精简：contextWindow/topP/frequencyPenalty/presencePenalty 已删除(自动推断或用默认)
      // 2026-08-21 精简：timeoutSec/autoContinue/transportMode 已删除(用代码默认)
      jsonMode: checkboxVal("json"),
      promptTemplate: (q("prompt") as HTMLTextAreaElement)?.value || DEFAULT_AI_SETTINGS.promptTemplate,
      // 显示与操作
      fontSize: parseInt(inputVal("fontsize"), 10) || DEFAULT_AI_SETTINGS.fontSize,
      inputFontSize: parseInt(inputVal("input-fontsize"), 10) || DEFAULT_AI_SETTINGS.inputFontSize,
      // 2026-08-21 精简：sendShortcut 已删除(用思源约定 Ctrl/⌘+Enter)
      // 对话导出
      exportNotebookId: selectVal("export-nb"),
      exportSavePath: inputVal("export-path"),
      // 记忆文档
      soulDocId: inputVal("soul-id"),
      // 2026-08-27 阅读器「翻译」预置提示词（与「翻译引擎」Tab 的 ais-tr-prompt 共用同一字段，取有改动的那个）
      translatePrompt: resolveTranslatePrompt(),
      // 2026-08-28 AI 翻译参数（翻译引擎 Tab 可调）
      trBatchSize: numOr(inputNum("tr-batch-size"), 8, 1, 30),
      trTemperature: numOr(inputNum("tr-temperature"), 0.2, 0, 1),
      trConcurrency: numOr(inputNum("tr-concurrency"), 2, 1, 8),
      // 2026-08-27 翻译引擎配置（2026-08-28：开关默认关闭，AI 首选；优先级固定 微软→Libre）
      msKey: inputVal("ms-key"),
      msRegion: inputVal("ms-region"),
      msEnabled: checkboxVal("ms-enabled"),
      libreUrl: inputVal("libre-url").replace(/\/+$/, ""),
      libreEnabled: checkboxVal("libre-enabled"),
      translatePriority: ["microsoft", "libretranslate"],
      // 2026-08-21 精简：defaultMode 已删除
    } as AiSettings;
  }

  /** 设置测试消息 */
  private setTestMsg(dlg: HTMLElement, text: string, cls: string): void {
    const el = dlg.querySelector(".hiword-ai-test-msg") as HTMLElement;
    if (el) { el.textContent = text; el.className = "hiword-ai-test-msg" + (cls ? " " + cls : ""); }
  }

  /** 显示模型选择浮层（从 API 获取的可用模型中选择添加） */
  private showModelPickerOverlay(dlg: HTMLElement, available: string[], modelList: HTMLElement): void {
    const picker = document.createElement("div");
    picker.className = "hiword-ai-model-picker-overlay";
    picker.innerHTML = `
      <div class="hiword-ai-model-picker">
        <div class="hiword-ai-picker-header">
          <span>获取到 ${available.length} 个可用模型</span>
          <button class="hiword-ai-picker-close">&times;</button>
        </div>
        <div class="hiword-ai-picker-search"><input placeholder="筛选模型..." value="" /></div>
        <div class="hiword-ai-picker-actions">
          <button class="hiword-ai-btn hiword-ai-btn--primary hiword-ai-btn--sm" data-act="select-all">全选</button>
          <button class="hiword-ai-btn hiword-ai-btn--outline hiword-ai-btn--sm" data-act="deselect-all">取消全选</button>
          <button class="hiword-ai-btn hiword-ai-btn--primary" data-act="confirm">添加选中 (0)</button>
        </div>
        <div class="hiword-ai-picker-list">
          ${available.map(m => `
            <label class="hiword-ai-picker-item" data-model="${this.escapeAttr(m)}">
              <input type="checkbox" />
              <span class="hiword-ai-picker-name">${this.escapeHtml(m)}</span>
            </label>
          `).join("")}
        </div>
      </div>`;
    dlg.appendChild(picker);

    const pickerList = picker.querySelector(".hiword-ai-picker-list") as HTMLElement;
    const confirmBtn = picker.querySelector("[data-act='confirm']") as HTMLButtonElement;
    const pickerSearch = picker.querySelector(".hiword-ai-picker-search input") as HTMLInputElement;

    pickerSearch?.addEventListener("input", () => {
      const q = pickerSearch.value.toLowerCase();
      pickerList.querySelectorAll(".hiword-ai-picker-item").forEach(item => {
        const name = ((item as HTMLElement).dataset.model || "").toLowerCase();
        (item as HTMLElement).style.display = name.includes(q) ? "" : "none";
      });
    });
    picker.querySelector("[data-act='select-all']")?.addEventListener("click", () => {
      pickerList.querySelectorAll(".hiword-ai-picker-item").forEach(item => {
        if ((item as HTMLElement).style.display !== "none") {
          (item.querySelector("input") as HTMLInputElement).checked = true;
          item.classList.add("checked");
        }
      });
      updateConfirmText();
    });
    picker.querySelector("[data-act='deselect-all']")?.addEventListener("click", () => {
      pickerList.querySelectorAll(".hiword-ai-picker-item").forEach(item => {
        if ((item as HTMLElement).style.display !== "none") {
          (item.querySelector("input") as HTMLInputElement).checked = false;
          item.classList.remove("checked");
        }
      });
      updateConfirmText();
    });
    pickerList.querySelectorAll(".hiword-ai-picker-item input").forEach(cb => {
      cb.addEventListener("change", () => {
        (cb as HTMLElement).closest(".hiword-ai-picker-item")?.classList.toggle("checked", (cb as HTMLInputElement).checked);
        updateConfirmText();
      });
    });
    const updateConfirmText = () => {
      const checked = pickerList.querySelectorAll(".hiword-ai-picker-item input:checked").length;
      confirmBtn.textContent = `添加选中 (${checked})`;
    };
    picker.querySelector(".hiword-ai-picker-close")?.addEventListener("click", () => picker.remove());
    confirmBtn?.addEventListener("click", () => {
      const toAdd: string[] = [];
      pickerList.querySelectorAll(".hiword-ai-picker-item input:checked").forEach(cb => {
        const item = (cb as HTMLElement).closest(".hiword-ai-picker-item") as HTMLElement;
        const m = item.dataset.model || "";
        if (m && !modelList.querySelector(`[data-model="${m}"]`)) toAdd.push(m);
      });
      toAdd.forEach(m => {
        const div = document.createElement("div");
        div.className = "hiword-ai-model-item";
        div.dataset.model = m;
        div.innerHTML = `<span class="hiword-ai-model-name">${this.escapeHtml(m)}</span><button class="hiword-ai-model-del" title="删除">&times;</button>`;
        div.querySelector(".hiword-ai-model-del")?.addEventListener("click", () => div.remove());
        modelList.appendChild(div);
      });
      this.setTestMsg(dlg, `已添加 ${toAdd.length} 个模型`, "ok");
      picker.remove();
    });
  }

  /**
   * 渲染词典管理对话框内容
   */
  private renderDictManagerContent(dialog: Dialog) {
    const container = dialog.element.querySelector("#hiword-dict-manager");
    if (!container) return;

    const loaded = new Map(
      dictEngine.listDicts().map((d) => [d.id, d])
    );

    // 按语种分组：英文词典(lang=en/auto/空) vs 中文词典(lang=zh)
    const enDicts = this.dictManifest.dicts.filter((d) => d.lang !== "zh");
    const zhDicts = this.dictManifest.dicts.filter((d) => d.lang === "zh");
    const actives = this.dictManifest.actives || [this.dictManifest.active];

    const renderGroup = (title: string, icon: string, dicts: DictMeta[]) => {
      if (dicts.length === 0) return "";
      const rows = dicts
        .map((meta) => {
          const info = loaded.get(meta.id);
          const isActive = actives.includes(meta.id);
          const count = info ? `${info.count} 词` : "未加载";
          const typeLabel = meta.type === "stardict" ? "StarDict" : "MDX";
          const errHtml =
            isActive && !info && this.lastDictError
              ? `<div class="hiword-dm-err">⚠ ${this.escapeHtml(this.lastDictError)}</div>`
              : "";
          return `
          <div class="hiword-dm-row" data-id="${meta.id}">
            <div class="hiword-dm-ico">${icon}</div>
            <div class="hiword-dm-info">
              <span class="hiword-dm-name">${meta.name}</span>
              <span class="hiword-dm-meta">${typeLabel}${meta.builtin ? " · 内置" : ""}</span>
              ${errHtml}
            </div>
            <div class="hiword-dm-right">
              <span class="hiword-dm-count ${info ? "is-loaded" : "is-unloaded"}">${count}</span>
              <label class="hiword-dm-toggle ${isActive ? "is-active" : ""}" title="点击启用/停用">
                <input type="checkbox" data-action="toggle-dict" data-id="${meta.id}" ${isActive ? "checked" : ""} />
                <span>${isActive ? "已启用" : "未启用"}</span>
              </label>
              ${meta.builtin
                ? ""
                : `<button class="b3-button b3-button--small b3-button--outline hiword-dm-del" data-action="delete" data-id="${meta.id}">删除</button>`}
            </div>
          </div>`;
        })
        .join("");
      return `
        <div class="hiword-dm-section">
          <div class="hiword-dm-section-title">${icon} ${title} (${dicts.length})</div>
          <div class="hiword-dm-list">${rows}</div>
        </div>`;
    };

    container.innerHTML = `
      <div class="hiword-dm-header">
        <div class="hiword-dm-title">
          <svg class="hiword-dm-title-ico"><use xlink:href="#iconREwordDict"></use></svg>
          <div class="hiword-dm-title-text">
            <div class="hiword-dm-h">词典管理</div>
            <div class="hiword-dm-sub">英文词典与中文词典独立管理 · 各常驻一本</div>
          </div>
        </div>
      </div>
      <div class="hiword-dm-hint">
        选中文本后按 <kbd>⌥⌘L</kbd> 可一键在右侧边栏查词 · <kbd>⌥⌘E</kbd> 框选提取单词
      </div>
      ${renderGroup("英文词典", "🔤", enDicts)}
      ${renderGroup("中文词典", "🀄", zhDicts)}
      ${this.lastDictError ? `
      <div class="hiword-dm-diag">
        <details open>
          <summary>🔍 诊断信息</summary>
          <pre class="hiword-dm-diag-body">${this.escapeHtml(this.getDiagnosticInfo())}</pre>
        </details>
      </div>` : ""}
      <div class="hiword-dm-add">
        <button class="hiword-dm-add-btn" id="hiword-dm-add-mdx">
          <span class="hiword-dm-add-ico">📥</span>
          <span class="hiword-dm-add-body">
            <span class="hiword-dm-add-t">导入 MDX 词典</span>
            <span class="hiword-dm-add-d">选择 .mdx 原包</span>
          </span>
        </button>
        <button class="hiword-dm-add-btn hiword-dm-add-btn--ghost" id="hiword-dm-add-stardict">
          <span class="hiword-dm-add-ico">📚</span>
          <span class="hiword-dm-add-body">
            <span class="hiword-dm-add-t">导入 StarDict</span>
            <span class="hiword-dm-add-d">多选 .ifo/.idx/.dict 包</span>
          </span>
        </button>
        <input type="file" id="hiword-dm-file-mdx" accept=".mdx" style="display:none" />
        <input type="file" id="hiword-dm-file-stardict" accept=".ifo,.idx,.dict,.dict.dz,.syn" multiple style="display:none" />
      </div>
      <div class="hiword-dm-tip">
        <strong>支持格式：</strong><br/>
        &bull; <strong>MDX</strong>：直接选择 <code>.mdx</code> 原包即可<br/>
        &bull; <strong>StarDict</strong>：需同时选择词典包内所有文件（<code>.ifo</code>、<code>.idx</code>、<code>.dict</code> 或 <code>.dict.dz</code>；<code>.syn</code> 可选）<br/>
        选择文件后将自动写入插件 <code>dict/</code> 目录并立即建索引，全程无需手动操作。
      </div>
      <div class="hiword-dm-footer">
        <button class="b3-button b3-button--outline b3-button--small" id="hiword-dm-refresh">刷新</button>
      </div>
    `;

    // MDX 导入按钮
    const addMdxBtn = container.querySelector("#hiword-dm-add-mdx") as HTMLButtonElement;
    const mdxInput = container.querySelector("#hiword-dm-file-mdx") as HTMLInputElement;
    addMdxBtn?.addEventListener("click", () => mdxInput?.click());
    mdxInput?.addEventListener("change", async () => {
      const file = mdxInput.files?.[0];
      if (file) await this.onDictFileChosen(file, dialog);
      // 重置以允许重复选择同一文件
      mdxInput.value = "";
    });

    // StarDict 导入按钮
    const addSdBtn = container.querySelector("#hiword-dm-add-stardict") as HTMLButtonElement;
    const sdInput = container.querySelector("#hiword-dm-file-stardict") as HTMLInputElement;
    addSdBtn?.addEventListener("click", () => sdInput?.click());
    sdInput?.addEventListener("change", async () => {
      const files = sdInput.files;
      if (files && files.length > 0) await this.onStarDictFilesChosen(Array.from(files), dialog);
      sdInput.value = "";
    });

    // 分区标题点击：折叠 / 展开词典列表
    container.querySelectorAll(".hiword-dm-section-title").forEach((title) => {
      title.addEventListener("click", () => {
        const section = title.closest(".hiword-dm-section") as HTMLElement;
        if (section) {
          section.classList.toggle("collapsed");
        }
      });
    });

    // 列表操作（启用 / 删除）
    // 词典列表事件委托（启用/停用/删除）——监听整个 container 以覆盖多个分区
    let _toggleDebounce = 0;
    container.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action || (target.closest("[data-action]") as HTMLElement)?.dataset.action;
      const id = target.dataset.id || (target.closest("[data-id]") as HTMLElement)?.dataset.id;
      if (!action || !id) return;

      // 防抖：防止快速连续点击
      if (action === "toggle-dict") {
        e.preventDefault();
        e.stopPropagation();
        const now = Date.now();
        if (now - _toggleDebounce < 300) return; // 300ms 内不重复处理
        _toggleDebounce = now;
        await this.toggleDictActive(id, dialog);
        return;
      }
      if (action === "activate") await this.activateDict(id, dialog);
      if (action === "delete") await this.deleteDict(id, dialog);
    });

    // 刷新
    container.querySelector("#hiword-dm-refresh")?.addEventListener("click", async () => {
      const active =
        this.dictManifest.dicts.find((d) => d.id === this.dictManifest.active) ||
        this.dictManifest.dicts[0];
      if (active) await this.loadDictFile(active);
      this.renderDictManagerContent(dialog);
      showMessage("已刷新", 2000, "info");
    });
  }

  /**
   * 用户选择本地 .mdx 词典原包后：原样写入插件目录并注册（无需任何转换）
   */
  private async onDictFileChosen(file: File, dialog: Dialog) {
    const id = "user-" + Date.now().toString(36);
    const safeBase = file.name
      .replace(/\.mdx$/i, "")
      .replace(/[^\w一-龥-]+/g, "_")
      .slice(0, 40);
    const name = safeBase || "我的词典";
    const meta: DictMeta = { id, name, type: "mdx", file: `dict/${id}.mdx` };

    showMessage(`正在导入「${name}」(.mdx 原包)...`, 3000, "info");

    // 1) 将 .mdx 原包直接写入插件 dict 目录（node:fs 直写，零转换、无需手动）
    let savedToDisk = false;
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      fs.mkdirSync(this.resolveDictPath("dict"), { recursive: true });
      fs.writeFileSync(this.resolveDictPath(meta.file), buf);
      savedToDisk = true;
    } catch (err) {
      getLogger().warn("[REword] 写入词典文件失败:", { error: err });
      showMessage("自动写入失败，请检查插件目录写权限后重试", 6000, "error" as any);
    }

    // 2) 无论是否写入磁盘，都先登记到清单（便于后续刷新加载）
    this.dictManifest.dicts.push(meta);
    this.dictManifest.active = id;
    await this.saveData("hiword-dicts.json", this.dictManifest);

    // 3) 若已写入磁盘则立即加载并启用
    if (savedToDisk) {
      const ok = await this.loadDictFile(meta);
      if (ok) {
        this.dictReady = true;
        showMessage(`已添加并启用词典「${name}」`, 3000, "success" as any);
      } else {
        showMessage("文件已保存但加载失败，可点「刷新」重试", 4000, "error");
      }
    }

    this.renderDictManagerContent(dialog);
  }

  /**
   * 用户选择 StarDict 词典包文件后（.ifo + .idx + .dict/.dict.dz）：
   *   1) 识别文件类型并分组
   *   2) 全部写入插件 dict/ 目录
   *   3) 注册到引擎
   */
  private async onStarDictFilesChosen(files: File[], dialog: Dialog) {
    // 按扩展名分类
    const ifoFile = files.find((f) => /\.ifo$/i.test(f.name));
    const idxFile = files.find((f) => /\.idx$/i.test(f.name));
    const dictFile = files.find((f) => /\.dict(\.dz)?$/i.test(f.name));
    const synFile = files.find((f) => /\.syn$/i.test(f.name));

    if (!ifoFile) {
      showMessage("StarDict 导入需要 .ifo 文件，请重新选择", 4000, "error");
      return;
    }

    const id = "sd-" + Date.now().toString(36);
    // 从 .ifo 文件名推导词典名
    const safeBase = ifoFile.name
      .replace(/\.ifo$/i, "")
      .replace(/[^\w一-龥-]+/g, "_")
      .slice(0, 40);
    const name = safeBase || "StarDict 词典";

    showMessage(`正在导入 StarDict「${name}」...`, 3000, "info");

    // 写入所有文件到插件 dict/ 目录
    const savedFiles: string[] = [];
    let allSaved = true;

    const saveFile = async (file: File | undefined, ext: string): Promise<string | null> => {
      if (!file) return null;
      const destPath = `dict/${id}${ext}`;
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        fs.mkdirSync(this.resolveDictPath("dict"), { recursive: true });
        fs.writeFileSync(this.resolveDictPath(destPath), buf);
        return destPath;
      } catch (err) {
        getLogger().warn("[REword] 写入 ${file.name} 失败:", { error: err });
        return null;
      }
    };

    const ifoPath = await saveFile(ifoFile, ".ifo");
    if (ifoPath) savedFiles.push(ifoPath); else allSaved = false;

    const idxPath = await saveFile(idxFile, ".idx");
    if (idxPath) savedFiles.push(idxPath); else allSaved = false;

    // dict 文件：优先 .dict.dz，其次 .dict
    if (dictFile) {
      const ext = /\.dict\.dz$/i.test(dictFile.name) ? ".dict.dz" : ".dict";
      const dp = await saveFile(dictFile, ext);
      if (dp) savedFiles.push(dp); else allSaved = false;
    }

    if (synFile) {
      const sp = await saveFile(synFile, ".syn");
      if (sp) savedFiles.push(sp);
    }

    // 构建元信息
    const meta: DictMeta = {
      id,
      name,
      type: "stardict",
      file: `dict/${id}.ifo`, // StarDict 以 .ifo 为主文件
      files: savedFiles,
    };

    // 登记到清单
    this.dictManifest.dicts.push(meta);
    this.dictManifest.active = id;
    await this.saveData("hiword-dicts.json", this.dictManifest);

    // 尝试加载
    if (allSaved && ifoPath) {
      const ok = await this.loadDictFile(meta);
      if (ok) {
        this.dictReady = true;
        showMessage(`已添加并启用 StarDict「${name}」(${savedFiles.length} 个文件)`, 3000, "success" as any);
      } else {
        showMessage("文件已保存但加载失败，可点「刷新」重试", 4000, "error");
      }
    } else {
      showMessage("部分文件写入失败，请手动将词典包放入 dict/ 目录后点「刷新」", 5000, "error");
    }

    this.renderDictManagerContent(dialog);
  }

  /**
   * 切换词典启用/停用状态（按语种组单选：启用一本会自动关闭同组其它本）
   * 性能/稳定性优化：
   *  - 串行锁防止快速连点导致状态交错或 MDX 重复重建；
   *  - 停用（disable）时真正调用引擎层 deactivateAndRemove 释放 MDX 实例资源并同步激活指针，
   *    杜绝"词典无法正确关闭、停留在启用状态"的状态残留；
   *  - 启用（enable）时若引擎已加载该词典则跳过 MDX 重复解析。
   */

  /**
   * 词典语种分组：中文组 zh，其余（英文/未知）组 en。按语种组单选。
   */
  private dictLangGroup(meta: DictMeta): "zh" | "en" {
    return meta.lang === "zh" ? "zh" : "en";
  }

  /**
   * 启用某词典并强制同语种组单选：关闭同组其它已启用项（真释放 MDX 资源），
   * 重算 actives（每组至多一个）与 active 指针（英文组优先，回退 actives[0]）。
   */
  private enableDictSingle(id: string): void {
    const meta = this.dictManifest.dicts.find((d) => d.id === id);
    if (!meta) return;
    if (!this.dictManifest.actives || !Array.isArray(this.dictManifest.actives)) {
      this.dictManifest.actives = [this.dictManifest.active].filter(Boolean);
    }
    const group = this.dictLangGroup(meta);
    // 关闭同组其它已启用项（真释放引擎 MDX 资源，避免内存堆积与状态残留）
    const peers = this.dictManifest.actives.filter((aid) => {
      if (aid === id) return false;
      const pm = this.dictManifest.dicts.find((d) => d.id === aid);
      return pm && this.dictLangGroup(pm) === group;
    });
    for (const pid of peers) {
      dictEngine.deactivateAndRemove(pid, this.dictManifest.active);
    }
    this.dictManifest.actives = this.dictManifest.actives.filter((aid) => !peers.includes(aid));
    if (!this.dictManifest.actives.includes(id)) this.dictManifest.actives.push(id);
    // active 指针：英文组优先（英文为主查场景），否则 actives[0]
    const enActive = this.dictManifest.actives.find((aid) => {
      const m = this.dictManifest.dicts.find((d) => d.id === aid);
      return m && this.dictLangGroup(m) === "en";
    });
    this.dictManifest.active = enActive || this.dictManifest.actives[0] || "";
  }

  /** 按语种组单选归一化 actives：每组仅保留第一个，多余项从清单移除（不在此处释放引擎资源，由加载流程决定） */
  private normalizeDictSingleSelect(m: DictManifest): void {
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const aid of (m.actives || [])) {
      const meta = (m.dicts as DictMeta[]).find((d) => d.id === aid);
      if (!meta) continue;
      const g = meta.lang === "zh" ? "zh" : "en";
      if (seen.has(g)) continue;
      seen.add(g);
      kept.push(aid);
    }
    m.actives = kept;
  }

  private async toggleDictActive(id: string, dialog: Dialog) {
    if (this._dictSwitching) return;
    this._dictSwitching = true;
    try {
      const meta = this.dictManifest.dicts.find((d) => d.id === id);
      if (!meta) return;
      // 确保 actives 数组存在
      if (!this.dictManifest.actives || !Array.isArray(this.dictManifest.actives)) {
        this.dictManifest.actives = [this.dictManifest.active].filter(Boolean);
      }
      const idx = this.dictManifest.actives.indexOf(id);
      const isActivating = idx < 0;

      if (isActivating) {
        // 启用：强制同语种组单选（自动关闭同组其它本），重算 actives / active
        this.enableDictSingle(id);
      } else {
        // 停用：从 actives 移除（保证至少保留一个词典）
        this.dictManifest.actives.splice(idx, 1);
        if (this.dictManifest.actives.length === 0) {
          // 不允许全部停用：恢复当前词典
          this.dictManifest.actives.push(id);
          showMessage("至少需要保持一本词典启用", 1500, "warn" as any);
          return;
        }
        // 同步 active 指针（英文组优先）
        const enActive = this.dictManifest.actives.find((aid) => {
          const m = this.dictManifest.dicts.find((d) => d.id === aid);
          return m && this.dictLangGroup(m) === "en";
        });
        this.dictManifest.active = enActive || this.dictManifest.actives[0] || "";
      }

      await this.saveData("hiword-dicts.json", this.dictManifest);

      if (isActivating) {
        // 启用：仅当引擎尚未加载该词典时才解析（已加载则跳过，消除卡顿）
        if (!dictEngine.isDictLoaded(id)) {
          await this.loadDictFile(meta);
          // 加载完成后显式设为当前激活（确保 activeId 指向新启用词典，而非被关闭的同组旧本）
          dictEngine.setActiveDict(id);
        } else {
          dictEngine.setActiveDict(id);
          this.refreshActivePanel();
        }
        this.dictReady = true;
      } else {
        // 停用：真正释放引擎资源（关闭 MDX 实例），并同步激活指针，
        // 避免"无法正确关闭、停在启用状态"的状态残留
        dictEngine.deactivateAndRemove(id, this.dictManifest.active);
      }

      // 统一刷新：当前活跃面板（词库面板实时查词依赖新激活词典）+ 词典管理面板
      this.refreshActivePanel();
      this.renderDictManagerContent(dialog);
      showMessage(`「${meta.name}」${isActivating ? "已启用" : "已停用"}`, 1200, "info");
    } finally {
      this._dictSwitching = false;
    }
  }

  /**
   * 启用某个词典（加载并设为当前）
   * 性能优化：若引擎已加载该词典，仅切换激活指针、跳过 MDX 重复解析（消除切换卡顿）；
   * 串行锁防止快速连点导致多个 loadDictFile 交错、MDX 重建与状态残留。
   */
  private async activateDict(id: string, dialog: Dialog) {
    if (this._dictSwitching) return;
    this._dictSwitching = true;
    try {
      const meta = this.dictManifest.dicts.find((d) => d.id === id);
      if (!meta) return;
      // 强制同语种组单选：启用该本会自动关闭同组其它本
      this.enableDictSingle(id);
      await this.saveData("hiword-dicts.json", this.dictManifest);

      if (dictEngine.isDictLoaded(id)) {
        // 已加载：仅切换激活指针，跳过 MDX 重解析（核心性能优化）
        dictEngine.setActiveDict(id);
        this.refreshActivePanel();
      } else {
        const ok = await this.loadDictFile(meta);
        if (!ok) {
          showMessage("该词典文件缺失，请确认 dict/ 目录存在该文件", 4000, "error");
          return;
        }
      }
      this.dictReady = true;
      showMessage(`已切换至「${meta.name}」`, 2000, "success" as any);
      // 同步刷新当前活跃面板（词卡实时查词依赖 lookupSmart，需重绘才体现新词典释义）
      this.refreshActivePanel();
    } finally {
      this._dictSwitching = false;
      this.renderDictManagerContent(dialog);
    }
  }

  /**
   * 删除一个用户词典（仅从清单移除，不删磁盘文件）
   */
  private async deleteDict(id: string, dialog: Dialog) {
    const idx = this.dictManifest.dicts.findIndex((d) => d.id === id);
    if (idx < 0) return;
    const [removed] = this.dictManifest.dicts.splice(idx, 1);
    if (this.dictManifest.active === id) {
      this.dictManifest.active = this.dictManifest.dicts[0]?.id || "";
    }
    await this.saveData("hiword-dicts.json", this.dictManifest);
    dictEngine.removeDict(id);

    // 清理磁盘文件（MDX 单文件 / StarDict 多个伴生文件）
    const filesToRemove: string[] = removed.type === "stardict" && removed.files
      ? removed.files
      : [removed.file];
    let removedFiles = 0;
    for (const f of filesToRemove) {
      try {
        fs.rmSync(this.resolveDictPath(f), { force: true });
        removedFiles++;
      } catch (e) {
        getLogger().warn("[REword] 清理文件 ${f} 失败:", { error: e });
      }
    }
    showMessage(
      `已移除「${removed.name}」${removedFiles ? `（含 ${removedFiles} 个磁盘文件）` : ""}`,
      3000,
      "info"
    );

    this.renderDictManagerContent(dialog);
  }

  onunload() {
    getLogger().info("[REword] 插件卸载");
    getLogger().info("插件卸载", { operation: "插件生命周期" });
    // 逆序释放全部托管资源：全局监听 + eventBus 订阅 + 定时器
    this.disposables.dispose();
    // 各子模块独立持有的全局/文档级监听器
    this.whaleManager?.destroy();
    this.annObserver?.disconnect();
    // P0.5 防污染：卸载前剥离编辑器内批注标记（行内 span 解包 + 块 class 移除），
    // 避免标记残留于 DOM、在用户保存时被序列化进 .sy 块内容。
    // 多文档/多编辑器实例：querySelectorAll 覆盖全部已挂载 protyle。
    try {
      clearBlockMarks();
      document.querySelectorAll(".protyle-wysiwyg [data-node-id]").forEach((el) => {
        clearInlineMarks(el as HTMLElement);
      });
    } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · onunload", "debug"); }
    this.aiPanel?.destroy();
    this.copilotPanel?.destroy();
    // 阅读器：销毁挂载组件（触发 foliate-view close 释放 blob URL）
    try { this.readerDock?.dispose(); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · onunload", "debug"); }
    // 彻底断开预览实例池与 IntersectionObserver（2026-08-18）
    disposePreviewRegistry();
    // 关闭可能残留的浮层
    this.closeFloatingPopup();
    this.closeInlineAnnotationPopover();
    // 词典引擎与对话落盘（防抖层在卸载时强制落盘，避免防抖窗口内数据丢失，根因修复 #8）
    dictEngine.dispose();
    void this.persistVocab.flush();
    void this.persistAnnotations.flush();
    void this.persistConvo.flush();
    void this.persistVocabLabels.flush();
    void this.persistAnnotationLabels.flush();
    void this.persistAiPresets.flush();
    void this.persistAiPrompts.flush();
  }

  /** 从词典结果提取单词元数据(音标/词性/释义摘要),用于填充词库记录。
   *  2026-08-22 释义偏好:senses 全量返回供收词弹窗展示多选,labels 透传上层。 */
  private extractWordMeta(word: string): {
    phonetic: string; pos: string; meaning: string;
    senseCount?: number; labels?: string[];
    senses: SenseItem[];
    preferredDefinitions: string[];
  } {
    const entry = dictEngine.lookupSmart(word);
    if (!entry) return { phonetic: "", pos: "", meaning: "", senses: [], preferredDefinitions: [] };
    const parsed = dictRenderer.parseDictEntry(entry);
    // 词性：优先 <span class="class">(NCECD),其次首个带词性的义项
    // (ECD2 用 <span class="cx">/<span class="cxb">,已由 extractSenses 解析进 sense.pos)
    const allSenses = dictRenderer.extractSenses(entry.definition, 999);
    const posMatch = entry.definition.match(/<span class="class"[^>]*>([^<]+)<\/span>/i);
    const pos = posMatch ? posMatch[1].trim() : (allSenses.find((s) => s.pos)?.pos || "");
    // 义项：取全部义项用于统计多义性(senseCount),展示时用前 4 个
    const senseCount = allSenses.length || undefined;
    const senses = allSenses.slice(0, 4);
    let meaning: string;
    if (senses.length) {
      meaning = senses
        .map((s) => `${s.num ? s.num + " " : ""}${s.zh}`)
        .join("　"); // 全角空格分隔各义项
    } else {
      meaning = parsed.plainText.slice(0, 80);
    }
    return { phonetic: parsed.phonetic, pos, meaning, senseCount, senses: allSenses, preferredDefinitions: [] };
  }

  /** 2026-08-22 缓存最近一次查词结果,供查词卡片渲染时拿 preferredDefinitions / senses */
  private lastQueryRecord: WordRecord | null = null;
  /** 缓存最近一次查词的完整 senses,供查词卡片高亮命中对比 */
  private lastQuerySenses: SenseItem[] = [];

  /**
   * 2026-08-22 释义偏好:把 DeepReadWord.definitions 格式化为 SenseItem,统一弹窗数据结构
   * - 优先用 definitions(AI 精读结果中已结构化)
   * - 落空时回退到词典查 senses
   */
  private normalizeSensesForPick(
    word: string,
    dw?: DeepReadWord | { word: string; definitions?: Array<{ pos?: string; def?: string }>; meanings?: string[] }
  ): SenseItem[] {
    if (dw) {
      const defs = (dw as any).definitions as Array<{ pos?: string; def?: string }> | undefined;
      if (Array.isArray(defs) && defs.length) {
        return defs
          .filter((d) => d && (d.def || "").trim())
          .map((d, i) => ({
            num: `${i + 1}.`,
            zh: (d.def || "").trim(),
            pos: d.pos || "",
          }));
      }
    }
    return this.extractWordMeta(word).senses;
  }

  /**
   * 2026-08-22 释义偏好:收词偏好选择弹窗(单点收词)
   * - 列出该词全部 sense,checkbox 多选
   * - "默认第一个" 走 fallback 行为(只存第一个)
   * - "用此选择" 把勾选 zh 列表回传
   * - "取消" 等同 fallback
   * @returns preferredDefinitions: string[]  永远返回数组(空数组=未选)
   */
  private async showPickDefinitionsDialog(
    word: string,
    senses: SenseItem[]
  ): Promise<{ preferredDefinitions: string[]; cancelled: boolean }> {
    // 无 sense 或只有一个 → 直接返回第一个(等同原行为)
    if (!senses.length) {
      return { preferredDefinitions: [], cancelled: false };
    }
    if (senses.length === 1) {
      return { preferredDefinitions: [senses[0].zh.trim()], cancelled: false };
    }

    const defaultZh = (senses[0].zh || "").trim();

    return new Promise((resolve) => {
      const rows = senses
        .map(
          (s, i) => `
        <label class="hiword-pdef-row" data-i="${i}">
          <input type="checkbox" class="hiword-pdef-cb" data-i="${i}" ${i === 0 ? "checked" : ""} />
          <span class="hiword-pdef-zh">${this.escapeHtml((s.zh || "").trim())}</span>
          ${s.pos ? `<span class="hiword-pdef-pos">${this.escapeHtml(s.pos)}</span>` : ""}
          ${s.exampleEn ? `<span class="hiword-pdef-ex">${this.escapeHtml(s.exampleEn)}</span>` : ""}
        </label>`
        )
        .join("");

      const html = `
        <div class="hiword-pdef-dialog">
          <div class="hiword-pdef-hint">
            共 <b>${senses.length}</b> 个释义,挑 1-3 个你关心的高亮收藏,复习 / 查词卡会优先显示。
            <br/><span class="hiword-pdef-tip">不选则按原行为(默认第一个 sense)</span>
          </div>
          <div class="hiword-pdef-actions-row">
            <button class="b3-button b3-button--text b3-button--small" data-act="pdef-all">全选</button>
            <button class="b3-button b3-button--text b3-button--small" data-act="pdef-none">全不选</button>
            <span class="hiword-pdef-count">已选 <b id="pdef-count">1</b> / ${senses.length}</span>
          </div>
          <div class="hiword-pdef-list">${rows}</div>
          <div class="hiword-pdef-footer">
            <button class="b3-button" data-act="pdef-default">默认第一个(原行为)</button>
            <button class="b3-button" data-act="pdef-cancel">取消</button>
            <button class="b3-button b3-button--primary" data-act="pdef-confirm">用此选择</button>
          </div>
        </div>`;

      const dialog = new Dialog({
        title: `📖 选择释义偏好 — ${this.escapeHtml(word)}`,
        content: html,
        width: responsiveDialogSize(560, "width"),
        height: "auto",
      });

      setTimeout(() => {
        const el = dialog.element as HTMLElement;
        const cbs = Array.from(el.querySelectorAll<HTMLInputElement>(".hiword-pdef-cb"));
        const countEl = el.querySelector("#pdef-count") as HTMLElement;

        const updateCount = () => {
          const n = cbs.filter((c) => c.checked).length;
          if (countEl) countEl.textContent = String(n);
        };

        cbs.forEach((cb) => cb.addEventListener("change", updateCount));

        el.querySelector('[data-act="pdef-all"]')?.addEventListener("click", () => {
          cbs.forEach((c) => (c.checked = true));
          updateCount();
        });
        el.querySelector('[data-act="pdef-none"]')?.addEventListener("click", () => {
          cbs.forEach((c) => (c.checked = false));
          updateCount();
        });
        el.querySelector('[data-act="pdef-default"]')?.addEventListener("click", () => {
          // 默认第一个 = 返回 [defaultZh] 不弹,等同原行为
          dialog.destroy();
          resolve({ preferredDefinitions: [defaultZh], cancelled: false });
        });
        el.querySelector('[data-act="pdef-cancel"]')?.addEventListener("click", () => {
          dialog.destroy();
          resolve({ preferredDefinitions: [], cancelled: true });
        });
        el.querySelector('[data-act="pdef-confirm"]')?.addEventListener("click", () => {
          const selected = cbs
            .filter((c) => c.checked)
            .map((c) => {
              const i = parseInt(c.dataset.i || "0", 10);
              return (senses[i]?.zh || "").trim();
            })
            .filter((z) => z.length > 0);
          dialog.destroy();
          // 如果用户没勾选任何 → 等同"取消"(回退 fallback)
          if (selected.length === 0) {
            resolve({ preferredDefinitions: [], cancelled: true });
          } else {
            resolve({ preferredDefinitions: selected, cancelled: false });
          }
        });
      }, 30);
    });
  }

  /**
   * 解析单词词性，三级兜底：
   * 1) 词库记录已有 pos；2) 从 meaning 文本反提；3) 从本地词典实时反查。
   * 若从词典反查成功，会异步回填词库记录（避免下次仍为空）。
   */
  private posBackfillCache = new Set<string>();
  private resolvePosWithFallback(word: string, recordPos = "", recordMeaning = ""): { pos: string; fromDict: boolean } {
    if (recordPos) return { pos: normalizePos(recordPos), fromDict: false };
    const parsed = parseReviewMeaning(recordMeaning || "", "");
    if (parsed.pos) return { pos: parsed.pos, fromDict: false };
    const meta = this.extractWordMeta(word);
    if (meta.pos) return { pos: normalizePos(meta.pos), fromDict: true };
    return { pos: "", fromDict: false };
  }

  /** 添加单词到词库(从词典结果/收藏星调用);自动用词典元数据填充
   *  2026-08-22 释义偏好:单点收词入口,弹偏好选择窗
   */
  private async addWordToVocab(word: string): Promise<void> {
    const cleanWord = word.toLowerCase().trim();
    if (!this.isReady) return;
    if (this.vocabStore.hasWord(cleanWord)) {
      showMessage(`"${cleanWord}" 已在词库中`, 2000, "info");
      return;
    }
    try {
      const meta = this.extractWordMeta(cleanWord);
      // 2026-08-22 释义偏好:弹窗让用户挑选 ⭐ 优先 sense
      const pick = await this.showPickDefinitionsDialog(cleanWord, meta.senses);
      meta.preferredDefinitions = pick.preferredDefinitions;
      const r = await this.vocabStore.addWord(cleanWord, meta);
      if (r.added) {
        const prefHint = pick.preferredDefinitions.length > 0
          ? `,已应用 ${pick.preferredDefinitions.length} 个偏好`
          : "";
        showMessage(`已添加 "${cleanWord}" 到词库(未分类)${prefHint}`, 2000, "success" as any);
      }
    } catch (err) {
      showMessage(`添加失败: ${err}`, 2000, "error");
    }
  }

  /**
   * 收藏星两级选择（2026-08-14 新增）。
   * 点击收藏星时：
   *  - 词已在词库 → 直接移出（原 toggle 行为）；
   *  - 词不在词库 → 弹出「一级单词本 + 二级子类」级联选择弹窗，
   *    选完后加入指定词本的指定子类，不再只能进「未分类」。
   */
  private async toggleVocabStar(word: string, starEl?: HTMLElement | null, labels?: string[]): Promise<void> {
    const cleanWord = word.toLowerCase().trim();
    if (!cleanWord || !this.isReady) return;
    const meta = this.extractWordMeta(cleanWord);
    if (labels?.length) meta.labels = labels;

    // 已在词库 → 移出
    if (this.vocabStore.hasWord(cleanWord)) {
      await this.vocabStore.removeWord(cleanWord);
      if (starEl) {
        starEl.textContent = "☆";
        starEl.classList.remove("star-on");
        starEl.title = "加入词库";
      }
      showMessage(`已移出词库：「${cleanWord}」`, 1500, "info");
      return;
    }

    // 防止重复唤起收藏分类浮窗(快速连点星标时)
    if (this._vocabPickOpen) return;
    // 不在词库 → 两级级联选择
    const dest = await this.showVocabPickDialog(cleanWord);
    if (!dest) return; // 用户取消
    // 2026-08-22 释义偏好:弹窗让用户挑选 ⭐ 优先 sense(快速路径用,没 senses 直接走原行为)
    if (meta.senses.length > 0) {
      const pick = await this.showPickDefinitionsDialog(cleanWord, meta.senses);
      meta.preferredDefinitions = pick.preferredDefinitions;
    }
    await this.vocabStore.addWord(cleanWord, meta, dest.bookId, dest.themeId);
    if (starEl) {
      starEl.textContent = "★";
      starEl.classList.add("star-on");
      starEl.title = "移出词库";
    }
    const bookName = this.vocabStore.getBook(dest.bookId)?.name ?? "";
    const themeName = this.vocabStore.getTheme(dest.bookId, dest.themeId)?.name ?? "";
    const labelHint = labels?.length ? `（标签 ${labels.map(l => `#${l}`).join(" ") }）` : "";
    showMessage(`已加入词库：「${cleanWord}」→ ${bookName} / ${themeName}${labelHint}`, 2200, "success" as any);
    this.refreshVocabPanelIfVisible();
  }

  /**
   * 两级级联选择弹窗：一级单词本（下拉）→ 二级子类（chips）。
   * @returns {bookId, themeId} 或 null（取消）
   */
  private showVocabPickDialog(word: string): Promise<{ bookId: string; themeId: string } | null> {
    return new Promise((resolve) => {
      const books = this.vocabStore.getBooks().filter((b) => b.id !== ALL_BOOK_ID);
      if (books.length === 0) { resolve(null); return; }
      const defaultBook = books.find((b) => b.id === this.vocabStore.getActiveBook()?.id) ?? books[0];

      const ov = document.createElement("div");
      ov.className = "whale-dlg whale-vpick whale-vpick-floating";
      ov.setAttribute("role", "dialog");
      ov.setAttribute("aria-modal", "false"); // 非模态：释义窗口保持可见且可交互
      ov.innerHTML = `
        <div class="whale-dlg-head">
          <span class="whale-dlg-title">收藏「${this.escapeHtml(word)}」</span>
          <div class="whale-dlg-head-right">
            <button class="whale-dlg-close" id="vp-cancel" title="取消">✕</button>
          </div>
        </div>
        <div class="whale-vpick-body">
          <div class="whale-vpick-label">一级 · 单词本</div>
          <select class="b3-select whale-vpick-book" id="vp-book">
            ${books.map((b) => `<option value="${b.id}" ${b.id === defaultBook.id ? "selected" : ""}>${this.escapeHtml(b.name)}</option>`).join("")}
          </select>
          <div class="whale-vpick-label">二级 · 子类</div>
          <div class="whale-vpick-themes" id="vp-themes">
            ${this.renderVpickThemeChips(defaultBook.id, defaultBook.themes[0]?.id)}
          </div>
          <div class="whale-vpick-hint">单词将加入所选子类；子类可在侧边栏词库「＋」或右键主题管理。</div>
        </div>
        <div class="whale-dlg-foot">
          <span class="whale-dlg-spacer"></span>
          <button class="whale-dlg-btn" id="vp-cancel2">取消</button>
          <button class="whale-dlg-btn whale-dlg-btn--primary" id="vp-ok">加入</button>
        </div>
      `;
      document.body.appendChild(ov);
      // 记录浮窗状态并相对释义窗口偏移定位，确保两者互不遮挡
      this._vocabPickEl = ov;
      this._vocabPickOpen = true;
      this.positionVocabPick(ov, this._floatingPopup ?? this._hoverPopup);

      let pickedBookId = defaultBook.id;
      let pickedThemeId = defaultBook.themes[0]?.id ?? "";

      const themesWrap = ov.querySelector("#vp-themes") as HTMLElement;
      const rerenderThemes = (bookId: string) => {
        pickedBookId = bookId;
        const book = this.vocabStore.getBook(bookId);
        const first = book?.themes[0]?.id ?? "";
        pickedThemeId = first;
        themesWrap.innerHTML = this.renderVpickThemeChips(bookId, first);
        // 绑定主题 chips 点击
        themesWrap.querySelectorAll(".whale-vpick-theme").forEach((chip) => {
          chip.addEventListener("click", () => {
            pickedThemeId = (chip as HTMLElement).dataset.themeId || "";
            themesWrap.querySelectorAll(".whale-vpick-theme").forEach((c) => c.classList.remove("active"));
            chip.classList.add("active");
          });
        });
      };

      const done = (val: { bookId: string; themeId: string } | null) => {
        if (this._vocabPickMd) { document.removeEventListener("mousedown", this._vocabPickMd); this._vocabPickMd = undefined; }
        if (this._vocabPickKeydown) { document.removeEventListener("keydown", this._vocabPickKeydown); this._vocabPickKeydown = undefined; }
        ov.remove();
        this._vocabPickEl = null;
        this._vocabPickOpen = false;
        resolve(val);
      };

      // 一级切换 → 级联重渲染二级
      const bookSel = ov.querySelector("#vp-book") as HTMLSelectElement;
      bookSel?.addEventListener("change", () => rerenderThemes(bookSel.value));
      // 初始绑定二级 chips
      rerenderThemes(pickedBookId);

      // 取消按钮
      ov.querySelector("#vp-cancel")?.addEventListener("click", () => done(null));
      ov.querySelector("#vp-cancel2")?.addEventListener("click", () => done(null));

      // 点击空白处关闭收藏浮窗；但点在释义窗口（查词弹窗）内时两者都保留，互不关闭
      const onOutside = (ev: MouseEvent) => {
        if (!this._vocabPickEl) return;
        if (this._vocabPickEl.contains(ev.target as Node)) return;
        const anchor = this._floatingPopup ?? this._hoverPopup;
        if (anchor && anchor.contains(ev.target as Node)) return;
        done(null);
      };
      document.addEventListener("mousedown", onOutside);
      this._vocabPickMd = onOutside;

      // ESC 关闭收藏浮窗（释义窗口的 Esc 已让位给本浮窗）
      const onEsc = (ev: KeyboardEvent) => { if (ev.key === "Escape") done(null); };
      document.addEventListener("keydown", onEsc);
      this._vocabPickKeydown = onEsc;

      // 确认
      ov.querySelector("#vp-ok")?.addEventListener("click", () => {
        if (!pickedThemeId) { showMessage("请选择一个子类", 1500, "info"); return; }
        done({ bookId: pickedBookId, themeId: pickedThemeId });
      });
    });
  }

  /**
   * 收藏分类浮窗定位：相对释义窗口（查词弹窗）偏移展示，确保两者互不遮挡。
   * 优先放在释义窗口右侧；右侧放不下则放左侧；都不行则放下方。最后统一做视口夹紧。
   */
  private positionVocabPick(panel: HTMLElement, anchor?: HTMLElement | null) {
    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panelW = panel.offsetWidth || 340;
    const panelH = panel.offsetHeight || 260;
    let left: number;
    let top: number;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      if (r.right + margin + panelW <= vw - margin) {
        left = r.right + margin;            // 右
        top = r.top;
      } else if (r.left - margin - panelW >= margin) {
        left = r.left - margin - panelW;     // 左
        top = r.top;
      } else {
        left = Math.min(r.left, vw - panelW - margin); // 下
        top = r.bottom + margin;
      }
    } else {
      left = (vw - panelW) / 2;              // 无锚点（如侧边栏唤起）居中
      top = 80;
    }
    // 视口夹紧
    if (top < margin) top = margin;
    if (top + panelH > vh - margin) top = Math.max(margin, vh - panelH - margin);
    if (left < margin) left = margin;
    if (left + panelW > vw - margin) left = Math.max(margin, vw - panelW - margin);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  /** 渲染二级子类 chips（供级联弹窗复用） */
  private renderVpickThemeChips(bookId: string, activeThemeId?: string): string {
    const book = this.vocabStore.getBook(bookId);
    if (!book || book.themes.length === 0) return `<div class="whale-vpick-empty">暂无子类，请先在词库新建</div>`;
    return book.themes
      .map((t) => `<button type="button" class="whale-vpick-theme ${t.id === activeThemeId ? "active" : ""}" data-theme-id="${t.id}">${this.escapeHtml(t.name)}</button>`)
      .join("");
  }

  /** 添加选中文本到词库 */
  private async addSelectedWord() {
    if (!this.isReady) {
      showMessage("RE word 尚未就绪", 3000, "error");
      return;
    }

    // 获取选中文本
    const selection = window.getSelection()?.toString()?.trim();
    if (!selection) {
      showMessage("请先选中一个单词", 3000, "info");
      return;
    }

    const word = selection.toLowerCase().trim();
    // 简单词性检查：只接受英文单词
    if (!/^[a-z]+(?:[-'][a-z]+)*$/i.test(word)) {
      showMessage(`"${word}" 不像是一个有效的英文单词`, 3000, "info");
      return;
    }

    if (this.vocabStore.hasWord(word)) {
      showMessage(`"${word}" 已在词库中`, 3000, "info");
      return;
    }

    try {
      const meta = this.extractWordMeta(word);
      const r = await this.vocabStore.addWord(word, meta);
      showMessage(r.added ? `已添加 "${word}" 到词库` : `"${word}" 已在词库中`, 3000, "success" as any);
    } catch (err) {
      showMessage(`添加失败: ${err}`, 3000, "error");
    }
  }

  // ============ 框选提取单词 ============

  /**
   * 从选区精确获取文本。
   * 直接取浏览器原生选区文本（SiYuan 文档即 Protyle，选区即 window.getSelection()），
   * 并把不间断空格归一化，去掉首尾空白。多块选区会以换行分隔。
   */
  /**
   * 精确获取选区文本（2026-08-15 修复：只做字符串级 trim，不做 DOM 级单词补全）。
   * 旧版 DOM 级「补齐半截英文单词」把连字符 `-`/撇号误当词内字符，
   * 导致用户精确选中 "Anki"（在 "Anki-compatible" 中）时被向右吞成 "Anki-compatible"。
   * 用户预期「选什么就是什么」，故删除 DOM 级补全，仅去掉首尾非字母/数字/汉字字符。
   */
  private getSelectionTextPrecise(): string {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return "";

    const clean = (s: string): string =>
      s.replace(/\u00A0/g, " ").replace(/\u200B/g, "").trim();
    const raw = clean(sel.toString());
    if (!raw) return "";

    // 字符串级：去首尾非词字符（保留字母/数字/汉字）
    const trimmed = raw
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/[^\p{L}\p{N}]+$/u, "");
    return trimmed || raw;
  }

  /** 解析选区所属 SiYuan 块 ID（用于溯源到具体文档/块） */
  private getSelectionBlockId(): string | undefined {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return undefined;
    const node = sel.getRangeAt(0).startContainer;
    const el = node.nodeType === 3 ? node.parentElement : (node as Element | null);
    const blk = el?.closest("[data-node-id]") as HTMLElement | null;
    return blk?.dataset.nodeId || undefined;
  }

  /** 从选区定位所属文档根 ID（root_id），用于批注聚合与跳转 */
  private getSelectionDocId(blockId?: string): string | undefined {
    // 1) 优先从选区所在块的 DOM 向上找到文档根节点（data-type="NodeDocument"）
    const sel = window.getSelection();
    const node = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null;
    const el = node?.nodeType === 3 ? node.parentElement : (node as Element | null);
    const blk = (el?.closest("[data-node-id]") as HTMLElement | null)
      || (blockId ? document.querySelector(`[data-node-id="${this.escapeAttr(blockId)}"]`) as HTMLElement | null : null);
    if (blk) {
      const wysiwyg = blk.closest(".protyle-wysiwyg") as HTMLElement | null;
      const docRoot = (wysiwyg?.querySelector(":scope > [data-node-id]") as HTMLElement | null)
        || (blk.closest('[data-type="NodeDocument"]') as HTMLElement | null);
      const id = docRoot?.dataset.nodeId;
      if (id) return id;
    }
    // 2) 兜底：使用最近一次 switch-protyle 记录的 rootID
    return this.currentRootId || undefined;
  }

  /**
   * 按语种切分文本为单词（核心：精确识别框选内容）。
   * - 英文：正则抽取，去重转小写。
   * - 中文：使用 Intl.Segmenter('zh', { granularity: 'word' }) 精确分词，
   *   仅保留 isWordLike 的词语（SiYuan 基于 Electron，原生支持，无需额外词典）。
   */
  private tokenizeText(text: string): { en: string[]; zh: string[] } {
    const enSet = new Set<string>();
    const zhSet = new Set<string>();

    const enRe = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
    let m: RegExpExecArray | null;
    while ((m = enRe.exec(text))) {
      const w = m[0].toLowerCase();
      enSet.add(w);
    }

    const SegCtor = (Intl as unknown as { Segmenter?: any }).Segmenter;
    const seg = SegCtor ? new SegCtor("zh", { granularity: "word" }) : null;

    const zhRe = /[㐀-䶿一-鿿豈-﫿]+/g;
    let zm: RegExpExecArray | null;
    while ((zm = zhRe.exec(text))) {
      const run = zm[0];
      if (seg) {
        for (const tok of seg.segment(run)) {
          if (tok.isWordLike) {
            const w = (tok.segment as string).trim();
            if (w) zhSet.add(w);
          }
        }
      } else {
        // 无 Intl.Segmenter 时的兜底：整段中文作为一个候选，由用户自行取舍
        zhSet.add(run);
      }
    }

    return { en: [...enSet], zh: [...zhSet] };
  }

  /**
   * 导入智能筛选（2026-08-27）：
   * - 中文词汇直接剔除（词库仅收英文单词）
   * - 词形校验：仅允许英文字母（含 ' ’ - 连接符），数字/夹杂符号的识别噪声剔除
   * - 严格词典校验：每个词必须在离线词典查得到释义（lookupSmart 命中且 definition 非空），
   *   识别错误 / 词典未收录的词直接筛除，不写入词库；词典未就绪时跳过该项避免误杀
   * - 大小写去重
   * 返回有效列表与分类计数，供反馈提示。
   */
  private filterImportWords<T>(items: T[], getWord: (item: T) => string): {
    valid: T[]; zhCount: number; noDictCount: number; dupCount: number;
  } {
    const valid: T[] = [];
    let zhCount = 0;
    let noDictCount = 0;
    let dupCount = 0;
    const seen = new Set<string>();
    const dictReady = dictEngine.getStatus() === "ready";
    for (const it of items) {
      const w = (getWord(it) || "").trim();
      if (!w) { noDictCount++; continue; }
      // 含中文 → 非英文单词，直接筛除
      if (/[\u4e00-\u9fff]/.test(w)) { zhCount++; continue; }
      // 词形校验：字母开头、仅字母与常见连接符
      if (!/^[A-Za-z][A-Za-z'’\-]*$/.test(w)) { noDictCount++; continue; }
      const key = w.toLowerCase();
      if (seen.has(key)) { dupCount++; continue; }
      seen.add(key);
      // 严格校验：词典必须查得到该词且释义非空，否则筛除
      let hasDict = true;
      if (dictReady) {
        try {
          const entry = dictEngine.lookupSmart(w);
          hasDict = !!(entry && entry.definition && String(entry.definition).trim());
        } catch {
          hasDict = false;
        }
      }
      if (!hasDict) { noDictCount++; continue; }
      valid.push(it);
    }
    return { valid, zhCount, noDictCount, dupCount };
  }

  /** 筛选计数 → 反馈文案（无筛除返回空串） */
  private importFilterNote(r: { zhCount: number; noDictCount: number; dupCount: number }): string {
    const parts: string[] = [];
    if (r.zhCount) parts.push(`${r.zhCount} 个中文词汇`);
    if (r.noDictCount) parts.push(`${r.noDictCount} 个词典未收录`);
    if (r.dupCount) parts.push(`${r.dupCount} 个重复`);
    return parts.length ? `已自动筛除 ${parts.join("、")}` : "";
  }

  /**
   * AI 面板「加入到词库」入口：接收 AI 面板选中的文本，自动识别英文/中文单词，
   * 复用现有「提取单词到词库」对话框（与文档框选/拖放共享同一套交互与视觉）。
   * 调用方无需提供选区上下文，由本方法独立完成 tokenize → 弹窗 → 批量入库。
   */
  openVocabExtractDialog(text: string): void {
    if (!text || !text.trim()) {
      showMessage("未识别到可加入词库的文本", 2200, "info" as any);
      return;
    }
    if (!this.isReady) {
      showMessage("RE word 尚未就绪", 2200, "error" as any);
      return;
    }
    const { en, zh } = this.tokenizeText(text);
    if (en.length === 0 && zh.length === 0) {
      showMessage("未从选区识别到英文/中文单词", 3000, "info" as any);
      return;
    }
    // 无 blockId 时不展示「来源块」行，视觉与其它无来源路径一致
    this.showExtractDialog(en, zh);
  }

  /** 框选提取入口（浮动工具栏按钮 / 命令调用） */
  private extractWordsFromSelection(anchor?: HTMLElement) {
    const text = this.getSelectionTextPrecise();
    if (!text) {
      showMessage("请先框选文档内容", 3000, "info");
      return;
    }
    const { en, zh } = this.tokenizeText(text);
    if (en.length === 0 && zh.length === 0) {
      showMessage("未从选区内识别到单词（英文或中文）", 3000, "info");
      return;
    }
    const blockId = this.getSelectionBlockId();
    this.showExtractDialog(en, zh, blockId);
  }

  /** 提取预览对话框：列出识别到的单词（可勾选），选择目标单词本与二级子类后批量加入 */
  private showExtractDialog(enWords: string[], zhWords: string[], blockId?: string) {
    if (!this.isReady) {
      showMessage("RE word 尚未就绪", 3000, "error");
      return;
    }
    // 2026-08-27 智能筛选：中文词不入库（仅保留有效英文单词）；词典查无释义的词剔除；去重
    const zhAll = zhWords.length; // 中文词一律不计入候选
    const fr = this.filterImportWords(enWords, (w) => w);
    if (fr.valid.length === 0) {
      const note = this.importFilterNote({ zhCount: zhAll + fr.zhCount, noDictCount: fr.noDictCount, dupCount: fr.dupCount });
      showMessage(`没有可导入的有效单词${note ? `（${note}）` : ""}`, 3500, "info");
      return;
    }
    enWords = fr.valid;
    zhWords = [];
    const filterTotal = zhAll + fr.zhCount + fr.noDictCount + fr.dupCount;
    if (filterTotal > 0) {
      showMessage(
        `${this.importFilterNote({ zhCount: zhAll + fr.zhCount, noDictCount: fr.noDictCount, dupCount: fr.dupCount })}，保留有效单词 ${fr.valid.length} 个`,
        3000,
        "info"
      );
    }
    const total = enWords.length + zhWords.length;

    const books = this.vocabStore.getBooks().filter((b) => b.id !== ALL_BOOK_ID);
    const activeBook = this.vocabStore.getActiveBook();
    const bookOptions = books
      .map(
        (b) =>
          `<option value="${this.escapeAttr(b.id)}" ${activeBook && b.id === activeBook.id ? "selected" : ""}>${this.escapeHtml(b.name)}</option>`
      )
      .join("");

    const renderChips = (words: string[], type: string) =>
      words
        .map(
          (w) =>
            `<label class="hiword-ex-chip hiword-ex-${type}"><input type="checkbox" class="hiword-ex-check" checked data-word="${this.escapeAttr(w)}" data-type="${type}"><span class="hiword-ex-word">${this.escapeHtml(w)}</span></label>`
        )
        .join("");

    // 二级子类 chips 渲染（2026-08-14 新增）：供 book 切换时级联重渲染
    const renderThemeChipsHtml = (bookId: string, activeId?: string): string => {
      const book = this.vocabStore.getBook(bookId);
      if (!book || book.themes.length === 0) {
        return `<span class="hiword-ex-themes-empty">暂无子类</span>`;
      }
      return book.themes
        .map(
          (t) =>
            `<button type="button" class="hiword-ex-theme ${t.id === activeId ? "active" : ""}" data-theme-id="${this.escapeAttr(t.id)}">${this.escapeHtml(t.name)}</button>`
        )
        .join("");
    };
    const initialBookId = activeBook?.id ?? books[0]?.id ?? "";
    const initialThemeId = activeBook?.themes[0]?.id ?? "";

    const dialog = new Dialog({
      title: "提取单词到词库",
      width: responsiveDialogSize(580, "width"),
      height: "72vh",
      content: `
        <div class="hiword-ex-dialog">
          <div class="hiword-ex-bar">
            <span class="hiword-ex-count">共识别 <b>${total}</b> 个词（英文 ${enWords.length} · 中文 ${zhWords.length}）</span>
            <span class="hiword-ex-book-wrap">目标单词本
              <select class="b3-select hiword-ex-book" id="hiword-ex-book">${bookOptions}</select>
            </span>
            <span class="hiword-ex-themes-wrap">子类
              <span class="hiword-ex-themes" id="hiword-ex-themes">${renderThemeChipsHtml(initialBookId, initialThemeId)}</span>
            </span>
            <button class="hiword-ex-toggle" id="hiword-ex-toggle">全不选</button>
          </div>
          ${enWords.length ? `<div class="hiword-ex-section"><div class="hiword-ex-sec-title">英文</div><div class="hiword-ex-chips">${renderChips(enWords, "en")}</div></div>` : ""}
          ${zhWords.length ? `<div class="hiword-ex-section"><div class="hiword-ex-sec-title">中文</div><div class="hiword-ex-chips">${renderChips(zhWords, "zh")}</div></div>` : ""}
          ${blockId ? `<div class="hiword-ex-src">来源块：<code>${this.escapeHtml(blockId)}</code></div>` : ""}
          <div class="hiword-ex-footer">
            <button class="hiword-ex-cancel" id="hiword-ex-cancel">取消</button>
            <button class="hiword-ex-confirm b3-button b3-button--text" id="hiword-ex-confirm">添加到词库</button>
          </div>
        </div>
      `,
    });

    const root = dialog.element;
    const bookSel = root.querySelector("#hiword-ex-book") as HTMLSelectElement;
    const themesWrap = root.querySelector("#hiword-ex-themes") as HTMLElement;
    const checks = Array.from(root.querySelectorAll(".hiword-ex-check")) as HTMLInputElement[];
    const toggleBtn = root.querySelector("#hiword-ex-toggle") as HTMLButtonElement;

    // 当前选中：bookId + themeId（chips 点击会更新）
    let pickedBookId = initialBookId;
    let pickedThemeId = initialThemeId;

    const rerenderThemes = (bookId: string) => {
      pickedBookId = bookId;
      const book = this.vocabStore.getBook(bookId);
      const first = book?.themes[0]?.id ?? "";
      pickedThemeId = first;
      themesWrap.innerHTML = renderThemeChipsHtml(bookId, first);
      // 绑定新生成的 chips 点击事件
      themesWrap.querySelectorAll(".hiword-ex-theme").forEach((chip) => {
        chip.addEventListener("click", () => {
          pickedThemeId = (chip as HTMLElement).dataset.themeId || "";
          themesWrap.querySelectorAll(".hiword-ex-theme").forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
        });
      });
    };
    // 初始绑定 chips
    themesWrap.querySelectorAll(".hiword-ex-theme").forEach((chip) => {
      chip.addEventListener("click", () => {
        pickedThemeId = (chip as HTMLElement).dataset.themeId || "";
        themesWrap.querySelectorAll(".hiword-ex-theme").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
      });
    });

    let allOn = true;
    toggleBtn.addEventListener("click", () => {
      allOn = !allOn;
      checks.forEach((c) => (c.checked = allOn));
      toggleBtn.textContent = allOn ? "全不选" : "全选";
    });

    // 一级切换 → 级联刷新二级
    bookSel?.addEventListener("change", () => rerenderThemes(bookSel.value));

    root.querySelector("#hiword-ex-cancel")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("#hiword-ex-confirm")?.addEventListener("click", async () => {
      const bookId = pickedBookId;
      const themeId = pickedThemeId;
      const chosen = checks.filter((c) => c.checked).map((c) => c.dataset.word!);
      if (chosen.length === 0) {
        showMessage("请至少勾选一个单词", 2000, "info");
        return;
      }
      let added = 0;
      let skipped = 0;
      for (const word of chosen) {
        const meta = this.extractWordMeta(word);
        const r = await this.vocabStore.addWord(word, meta, bookId, themeId);
        if (r.added) added++;
        else skipped++;
      }
      const bookName = this.vocabStore.getBook(bookId)?.name ?? "词库";
      const themeName = this.vocabStore.getTheme(bookId, themeId)?.name ?? "未分类";
      dialog.destroy();
      showMessage(
        `已添加 ${added} 个单词到「${bookName}」/「${themeName}」${skipped ? `，${skipped} 个已存在` : ""}`,
        3000,
        "success" as any
      );
      // 加入词库后：仅当 dock 当前停在「词库」Tab 时才重绘它，
      // 避免覆盖用户正在编辑的其它 Tab（如 AI 精读面板），造成编辑中断 / 误以为"切到词库界面"。
      const activeTab = this.dockElement?.querySelector(".hiword-dock-tab.active") as HTMLElement | null;
      if (this.dockElement && activeTab?.dataset.tab === "vocab") {
        this.renderVocabPanel(this.dockElement);
      }
    });
  }

  /**
   * 复习面板拖放区：把思源文档/块拖进来后，自动解析块 → 取 kramdown 正文 →
   * 抽英文词 → 复用「提取单词」对话框让用户勾选确认后加入复习。
   * （拖入纯文本时直接抽词，作为块解析失败时的兜底。）
   */
  private bindReviewDropZone(panel: HTMLElement) {
    let depth = 0;
    panel.addEventListener("dragenter", (e) => {
      e.preventDefault();
      depth++;
      panel.classList.add("hiword-rp-dragover");
    });
    panel.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    panel.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) panel.classList.remove("hiword-rp-dragover");
    });
    panel.addEventListener("drop", async (e) => {
      depth = 0;
      panel.classList.remove("hiword-rp-dragover");
      await this.handleReviewDrop(e);
    });
  }

  /** 拖放落点处理：优先解析思源块，否则回退纯文本 */
  private async handleReviewDrop(e: DragEvent) {
    e.preventDefault();
    const blockId = this.resolveDragBlockId(e);
    let text = "";
    if (blockId) {
      try {
        text = (await getBlockKramdown(blockId)) || "";
      } catch (err) {
        getLogger().warn("[REword] 拖入导入失败:" + String(err));
        showMessage("读取块内容失败", 3000, "error");
        return;
      }
    } else {
      text = this.resolveDragFallbackText(e) || "";
    }
    if (!text.trim()) {
      showMessage("未识别到思源块，请直接拖入文档或块", 3000, "info");
      return;
    }
    // 2026-08-27 优化词典释义：结构化单词表（word pos 释义）优先走单词表导入弹窗，
    // 否则回退原散文分词 → 提取单词对话框。
    if (isWordListLike(text)) {
      const { entries } = parseWordList(text);
      this.showWordListImportDialog(entries);
      return;
    }
    const { en, zh } = this.tokenizeText(text);
    if (en.length === 0 && zh.length === 0) {
      showMessage(blockId ? "该块未识别到英文/中文单词" : "未从拖入内容识别到单词", 3000, "info");
      return;
    }
    this.showExtractDialog(en, zh, blockId ?? undefined);
  }

  /**
   * 词库面板拖放区：把思源文档/块拖到词库面板 → 复用 handleReviewDrop
   * （解析块 → 取 kramdown 正文 → 分词 → 弹出「提取单词」对话框，让用户选 L1 单词本 + L2 子类后批量入库）。
   * 绑定在持久容器 #hiword-dock-content 上，仅当词库 Tab 激活时接管，避免与复习面板的拖放处理器重复触发。
   */
  private bindVocabDropZone(panel: HTMLElement) {
    if ((panel as HTMLElement).dataset.vbDropBound) return; // 仅绑定一次（容器持久，防重复绑定）
    (panel as HTMLElement).dataset.vbDropBound = "1";
    let depth = 0;
    const isVocabTab = () => !!panel.querySelector(".hiword-vb-list");
    panel.addEventListener("dragenter", (e) => {
      if (!isVocabTab()) return; // 仅词库 Tab 激活时高亮，避免干扰其它 Tab
      e.preventDefault();
      depth++;
      panel.classList.add("hiword-vb-dragover");
    });
    panel.addEventListener("dragover", (e) => {
      if (!isVocabTab()) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    panel.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) panel.classList.remove("hiword-vb-dragover");
    });
    panel.addEventListener("drop", async (e) => {
      depth = 0;
      panel.classList.remove("hiword-vb-dragover");
      // 复习 Tab 激活时由其自身处理器接管，避免重复触发导致双重入库
      if (panel.querySelector(".hiword-review-panel")) return;
      if (!isVocabTab()) return;
      await this.handleReviewDrop(e);
    });
  }

  /**
   * 词库导入：粘贴文本 / 文本块内容 → 自动识别英文/中文单词 →
   * 复用「提取单词」对话框（L1 单词本 + L2 子类 + 批量勾选）完成入库。
   * （也可直接把思源块拖到词库面板，见 bindVocabDropZone。）
   */
  private showVocabImportDialog() {
    if (!this.isReady) {
      showMessage("RE word 尚未就绪", 3000, "error");
      return;
    }
    const dialog = new Dialog({
      title: "导入单词到词库",
      width: responsiveDialogSize(520, "width"),
      height: "60vh",
      content: `
        <div class="hiword-imp-dialog">
          <p class="hiword-imp-hint">把思源文档或文本块的内容粘贴到下方，点击「识别单词」自动提取其中的英文/中文词；随后在弹出的对话框里为它们选择 <b>一级单词本</b> 与 <b>二级分类</b>，即可批量入库。也可以直接把思源块拖到左侧词库面板。</p>
          <textarea class="hiword-imp-text" id="hiword-imp-text" placeholder="在此粘贴文本 / 文本块内容…"></textarea>
          <div class="hiword-imp-footer">
            <button class="hiword-imp-cancel" id="hiword-imp-cancel">取消</button>
            <button class="b3-button b3-button--text hiword-imp-confirm" id="hiword-imp-confirm">识别单词</button>
          </div>
        </div>`,
    });
    const root = dialog.element;
    const textEl = root.querySelector("#hiword-imp-text") as HTMLTextAreaElement;
    root.querySelector("#hiword-imp-cancel")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("#hiword-imp-confirm")?.addEventListener("click", () => {
      const text = (textEl.value || "").trim();
      if (!text) {
        showMessage("请先粘贴要导入的文本", 2000, "info");
        return;
      }
      // 2026-08-27 优化词典释义：优先识别「结构化单词表」（word pos 释义），
      // 命中则走单词表导入弹窗（用户释义作首选 ⭐），否则回退原散文分词流程。
      if (isWordListLike(text)) {
        const { entries } = parseWordList(text);
        dialog.destroy();
        this.showWordListImportDialog(entries);
        return;
      }
      const { en, zh } = this.tokenizeText(text);
      if (en.length === 0 && zh.length === 0) {
        showMessage("未从文本中识别到英文/中文单词", 3000, "info");
        return;
      }
      dialog.destroy();
      this.showExtractDialog(en, zh);
    });
  }

  /**
   * 结构化单词表导入：列出解析出的「单词 / 词性 / 释义」条目（可勾选），
   * 选择目标单词本与二级子类后，调用 collectWords 入库——用户整理的释义会作为
   * preferredDefinitions 写入，查词卡以 ⭐ 置顶显示，复习卡也用用户的释义。
   */
  private showWordListImportDialog(entries: ParsedWordListEntry[]) {
    if (!this.isReady) {
      showMessage("RE word 尚未就绪", 3000, "error");
      return;
    }
    // 2026-08-27 智能筛选：中文词 / 词典查无释义的词条直接剔除（不写入词库），并反馈筛选结果
    const fr = this.filterImportWords(entries, (e) => e.word);
    if (fr.valid.length === 0) {
      const note = this.importFilterNote(fr);
      showMessage(`没有可导入的有效单词${note ? `（${note}）` : ""}`, 3500, "info");
      return;
    }
    entries = fr.valid;
    if (fr.zhCount + fr.noDictCount + fr.dupCount > 0) {
      showMessage(`${this.importFilterNote(fr)}，保留有效词条 ${fr.valid.length} 个`, 3000, "info");
    }
    const books = this.vocabStore.getBooks().filter((b) => b.id !== ALL_BOOK_ID);
    const activeBook = this.vocabStore.getActiveBook();
    const bookOptions = books
      .map(
        (b) =>
          `<option value="${this.escapeAttr(b.id)}" ${activeBook && b.id === activeBook.id ? "selected" : ""}>${this.escapeHtml(b.name)}</option>`
      )
      .join("");
    const renderThemes = (bookId: string, activeId?: string): string => {
      const book = this.vocabStore.getBook(bookId);
      if (!book || book.themes.length === 0) return `<span class="hiword-ex-themes-empty">暂无子类</span>`;
      return book.themes
        .map(
          (t) =>
            `<button type="button" class="hiword-ex-theme ${t.id === activeId ? "active" : ""}" data-theme-id="${this.escapeAttr(t.id)}">${this.escapeHtml(t.name)}</button>`
        )
        .join("");
    };
    const initialBookId = activeBook?.id ?? books[0]?.id ?? "";
    const initialThemeId = activeBook?.themes[0]?.id ?? "";

    const rows = entries
      .map(
        (e, i) => `
        <label class="hiword-wl-row" data-i="${i}">
          <input type="checkbox" class="hiword-wl-check" data-i="${i}" checked>
          <span class="hiword-wl-word">${this.escapeHtml(e.word)}</span>
          <span class="hiword-wl-pos">${this.escapeHtml(e.pos || "—")}</span>
          <span class="hiword-wl-meaning">${this.escapeHtml(e.meaning)}</span>
        </label>`
      )
      .join("");

    const dialog = new Dialog({
      title: "导入单词表到词库",
      width: responsiveDialogSize(560, "width"),
      height: "72vh",
      content: `
        <div class="hiword-wl-dialog">
          <p class="hiword-imp-hint">检测到 <b>${entries.length}</b> 个结构化词条（单词 + 词性 + 释义）。勾选要导入的，选择目标单词本与子类；导入后你整理的释义将作为<b>首选释义</b>（查词卡 ⭐ 置顶，复习卡也用你的释义）。</p>
          <div class="hiword-wl-bar">
            <span class="hiword-ex-book-wrap">单词本
              <select class="b3-select hiword-ex-book" id="hiword-wl-book">${bookOptions}</select>
            </span>
            <span class="hiword-ex-themes-wrap">子类
              <span class="hiword-ex-themes" id="hiword-wl-themes">${renderThemes(initialBookId, initialThemeId)}</span>
            </span>
            <button class="hiword-ex-toggle" id="hiword-wl-toggle">全不选</button>
          </div>
          <div class="hiword-wl-list" id="hiword-wl-list">${rows}</div>
          <div class="hiword-wl-footer">
            <span class="hiword-wl-count" id="hiword-wl-count">已选 ${entries.length} / ${entries.length}</span>
            <button class="hiword-wl-cancel" id="hiword-wl-cancel">取消</button>
            <button class="b3-button b3-button--text hiword-wl-confirm" id="hiword-wl-confirm">导入 ${entries.length} 个词</button>
          </div>
        </div>`,
    });

    const root = dialog.element;
    const bookSel = root.querySelector("#hiword-wl-book") as HTMLSelectElement;
    const themesWrap = root.querySelector("#hiword-wl-themes") as HTMLElement;
    const checks = Array.from(root.querySelectorAll(".hiword-wl-check")) as HTMLInputElement[];
    const countEl = root.querySelector("#hiword-wl-count") as HTMLElement;
    const confirmBtn = root.querySelector("#hiword-wl-confirm") as HTMLButtonElement;
    let pickedBookId = initialBookId;
    let pickedThemeId = initialThemeId;

    const updateCount = () => {
      const sel = checks.filter((c) => c.checked).length;
      countEl.textContent = `已选 ${sel} / ${entries.length}`;
      confirmBtn.textContent = `导入 ${sel} 个词`;
    };

    const bindThemes = (bookId: string, activeId?: string) => {
      themesWrap.innerHTML = renderThemes(bookId, activeId);
      themesWrap.querySelectorAll(".hiword-ex-theme").forEach((chip) => {
        chip.addEventListener("click", () => {
          pickedThemeId = (chip as HTMLElement).dataset.themeId || "";
          themesWrap.querySelectorAll(".hiword-ex-theme").forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
        });
      });
    };
    bindThemes(initialBookId, initialThemeId);

    let allOn = true;
    root.querySelector("#hiword-wl-toggle")?.addEventListener("click", () => {
      allOn = !allOn;
      checks.forEach((c) => (c.checked = allOn));
      (root.querySelector("#hiword-wl-toggle") as HTMLElement).textContent = allOn ? "全不选" : "全选";
      updateCount();
    });
    bookSel?.addEventListener("change", () => {
      pickedBookId = bookSel.value;
      const book = this.vocabStore.getBook(pickedBookId);
      const first = book?.themes[0]?.id ?? "";
      pickedThemeId = first;
      bindThemes(pickedBookId, first);
    });
    checks.forEach((c) => c.addEventListener("change", updateCount));

    root.querySelector("#hiword-wl-cancel")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("#hiword-wl-confirm")?.addEventListener("click", async () => {
      const chosenIdx = checks.filter((c) => c.checked).map((c) => Number(c.dataset.i));
      if (chosenIdx.length === 0) {
        showMessage("请至少勾选一个单词", 2000, "info");
        return;
      }
      const chosen = chosenIdx.map((i) => entries[i]);
      const r = await this.collectWords(chosen, pickedBookId, pickedThemeId);
      const bookName = this.vocabStore.getBook(pickedBookId)?.name ?? "词库";
      const themeName = this.vocabStore.getTheme(pickedBookId, pickedThemeId)?.name ?? "未分类";
      dialog.destroy();
      showMessage(
        `已导入 ${r.added} 个单词到「${bookName}」/「${themeName}」${r.skipped ? `，${r.skipped} 个已存在` : ""}（你的释义已置为首选 ⭐）`,
        3500,
        "success" as any
      );
      const activeTab = this.dockElement?.querySelector(".hiword-dock-tab.active") as HTMLElement | null;
      if (this.dockElement && activeTab?.dataset.tab === "vocab") {
        this.renderVocabPanel(this.dockElement);
      }
    });
  }

  /** 从单词库挑选单词，批量加入复习（置为活跃 + 立即可复习） */
  private showAddFromVocabDialog() {
    if (!this.isReady || !this.vocabStore) {
      showMessage("RE word 尚未就绪", 3000, "error");
      return;
    }
    const words = this.vocabStore.getAllWords();
    if (words.length === 0) {
      showMessage("词库还没有单词，先添加一些再来复习吧", 3000, "info");
      return;
    }

    const statusText = (s: string) => (s === "archived" ? "已归档" : s === "ignored" ? "已忽略" : "学习中");
    const rowHtml = (w: WordRecord) => {
      const meaning = (w.meaning || "").replace(/\s+/g, " ").slice(0, 36);
      return `<label class="hiword-av-row" data-word="${this.escapeAttr(w.word)}">
        <input type="checkbox" class="hiword-av-check" data-word="${this.escapeAttr(w.word)}">
        <span class="hiword-av-word">${this.escapeHtml(w.word)}</span>
        <span class="hiword-av-meaning">${this.escapeHtml(meaning)}</span>
        <span class="hiword-av-pill hiword-av-status--${this.escapeAttr(w.status)}">${statusText(w.status)}</span>
      </label>`;
    };

    const dialog = new Dialog({
      title: "从单词库加入复习",
      width: responsiveDialogSize(480, "width"),
      height: "74vh",
      content: `
        <div class="hiword-av-dialog">
          <div class="hiword-av-bar">
            <input class="b3-text-field hiword-av-search" id="hiword-av-search" placeholder="搜索单词…">
            <span class="hiword-av-count" id="hiword-av-count"></span>
            <button class="hiword-av-toggle" id="hiword-av-toggle">全选</button>
          </div>
          <div class="hiword-av-list" id="hiword-av-list">
            ${words.map(rowHtml).join("")}
          </div>
          <div class="hiword-av-footer">
            <button class="hiword-av-cancel" id="hiword-av-cancel">取消</button>
            <button class="b3-button b3-button--text hiword-av-confirm" id="hiword-av-confirm">加入复习</button>
          </div>
        </div>
      `,
    });

    const root = dialog.element;
    const list = root.querySelector("#hiword-av-list") as HTMLElement;
    const search = root.querySelector("#hiword-av-search") as HTMLInputElement;
    const countEl = root.querySelector("#hiword-av-count") as HTMLElement;
    const toggleBtn = root.querySelector("#hiword-av-toggle") as HTMLButtonElement;

    const updateCount = () => {
      const total = list.querySelectorAll(".hiword-av-check").length;
      const sel = list.querySelectorAll(".hiword-av-check:checked").length;
      countEl.textContent = `已选 ${sel} / ${total}`;
    };
    search?.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      list.querySelectorAll<HTMLElement>(".hiword-av-row").forEach((r) => {
        const w = (r.dataset.word || "").toLowerCase();
        r.style.display = !q || w.includes(q) ? "" : "none";
      });
    });
    list.querySelectorAll<HTMLInputElement>(".hiword-av-check").forEach((c) =>
      c.addEventListener("change", updateCount)
    );
    toggleBtn?.addEventListener("click", () => {
      const visible = Array.from(list.querySelectorAll<HTMLElement>(".hiword-av-row")).filter(
        (r) => r.style.display !== "none"
      );
      const allOn = visible.length > 0 && visible.every(
        (r) => (r.querySelector(".hiword-av-check") as HTMLInputElement).checked
      );
      visible.forEach((r) => {
        (r.querySelector(".hiword-av-check") as HTMLInputElement).checked = !allOn;
      });
      toggleBtn.textContent = allOn ? "全选" : "全不选";
      updateCount();
    });
    root.querySelector("#hiword-av-cancel")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("#hiword-av-confirm")?.addEventListener("click", async () => {
      const chosen = Array.from(list.querySelectorAll<HTMLInputElement>(".hiword-av-check:checked")).map(
        (c) => c.dataset.word!
      );
      if (chosen.length === 0) {
        showMessage("请至少勾选一个单词", 2000, "info");
        return;
      }
      const nowIso = new Date().toISOString();
      let n = 0;
      for (const w of chosen) {
        await this.vocabStore!.reactivateWord(w);
        await this.vocabStore!.updateReviewStats(w, { due: nowIso });
        n++;
      }
      dialog.destroy();
      showMessage(`已将 ${n} 个单词加入复习（立即可复习）`, 3200, "success" as any);
      if (this.dockElement) this.renderReviewPanel(this.dockElement);
    });
    updateCount();
  }

  /** 提取选中文本所在的句子作为上下文 */
  /**
   * 提取选区所在完整句子（2026-08-15 重写修复）。
   *
   * 【旧 bug】range.startOffset/endOffset 是相对 startContainer/endContainer
   * （text node）的偏移，但旧代码用它们在 container.textContent（整个父容器
   * 文本）上做 substring —— 思源 protyle 常把一句话拆进多个 span/text node，
   * 选区跨节点时两个坐标系不一致，提取出的句子会错位到无关文本（用户反馈
   * 「已选原文」显示固定文案而非所选单词）。
   *
   * 【新实现】不依赖 range 偏移，而是：
   *  1) 用 selection.toString() 拿准确选中文本；
   *  2) 在容器文本中用 indexOf 定位（折叠空白容错）；
   *  3) 向前/向后找句边界，返回【完整句子（含选中文本）】。
   * 若定位失败，返回 undefined 让调用方回退到 selected 本身。
   */
  private extractContextSentence(): string | undefined {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return undefined;
    const selected = selection.toString().trim();
    if (!selected) return undefined;

    const range = selection.getRangeAt(0);
    // 2026-08-17 修复：向上取到最近的 [data-node-id] 块容器，
    // 避免选区跨 inline 元素（如 **foo** bar 起点在 <strong> 内）时被截断为局部文本。
    const startNode = range.startContainer;
    const startEl = startNode.nodeType === 3 ? startNode.parentElement : (startNode as Element | null);
    const blockEl = startEl?.closest("[data-node-id]") as HTMLElement | null;
    const container = blockEl || startEl;
    if (!container) return undefined;
    const text = container.textContent || "";

    // 在容器文本中定位选中文本（容错：折叠多余空白后再试）
    let idx = text.indexOf(selected);
    if (idx === -1) {
      const compactText = text.replace(/\s+/g, " ");
      const compactSel = selected.replace(/\s+/g, " ");
      idx = compactText.indexOf(compactSel);
      if (idx === -1) return selected; // 无法定位 → 退化为选中文本本身
      const end = idx + compactSel.length;
      return this.buildSentence(text, idx, end) || selected;
    }

    const end = idx + selected.length;
    return this.buildSentence(text, idx, end) || selected;
  }

  /**
   * 根据选中文本在容器文本中的起止索引，截取所在「句子」上下文。
   * 句边界支持中英文标点：. ! ? 。 ！ ？ 以及换行（2026-08-17 新增中文断句）。
   */
  private buildSentence(text: string, idx: number, end: number): string | undefined {
    const start = this.lastSentenceBoundary(text, idx);
    const stop = this.nextSentenceBoundary(text, end);
    const sentence = text.substring(start, stop).trim();
    return sentence || undefined;
  }

  /** 选中起点之前最近的句末边界（返回该边界之后的索引，即句子真正的起点） */
  private lastSentenceBoundary(text: string, pos: number): number {
    const puncts = [".", "!", "?", "。", "！", "？"];
    let best = 0;
    for (const p of puncts) {
      const i = text.lastIndexOf(p, Math.max(0, pos - 1));
      if (i !== -1) {
        let b = i + 1;
        // 跳过标点后的单个空格/全角空格/制表符
        if (text[b] === " " || text[b] === "　" || text[b] === "\t") b++;
        if (b > best) best = b;
      }
    }
    const nl = text.lastIndexOf("\n", Math.max(0, pos - 1));
    if (nl !== -1 && nl + 1 > best) best = nl + 1;
    return best;
  }

  /** 选中终点之后最近的句末边界（返回包含该标点的索引，即句子真正的终点） */
  private nextSentenceBoundary(text: string, pos: number): number {
    const puncts = [".", "!", "?", "。", "！", "？"];
    let best = text.length;
    for (const p of puncts) {
      const i = text.indexOf(p, pos);
      if (i !== -1 && i + 1 < best) best = i + 1;
    }
    const nl = text.indexOf("\n", pos);
    if (nl !== -1 && nl < best) best = nl;
    return best;
  }

  /**
   * 从当前选区发起「添加批注」：定位块与文档，打开微阅风格批注弹窗。
   * 若同一块同一句子已存在批注则进入编辑态（预填 note）。
   * v2：改用 whaleManager.showWhaleDialog（截图 1 风格：头部 5 线型 Aa +
   *     富文本编辑区 + 底部 3 功能按钮/保存）。
   */
  private addAnnotationFromSelection() {
    // 2026-08-17：选区落在批注编辑器内时直接忽略（防在批注编辑区误建批注）
    const selAnchor = window.getSelection()?.anchorNode as Node | null;
    if (selAnchor && selAnchor.parentElement?.closest?.("#whale-dlg-editor, .whale-ann-inline-editor")) {
      showMessage("批注编辑区内不可再创建批注", 2000, "info");
      return;
    }
    if (!this.isReady) {
      showMessage("RE word 尚未就绪", 3000, "error");
      return;
    }
    const selected = this.getSelectionTextPrecise()?.trim();
    if (!selected) {
      showMessage("请先框选要批注的内容", 2500, "info");
      return;
    }

    const blockId = this.getSelectionBlockId();
    if (!blockId) {
      showMessage("无法定位选中内容所在的块", 3000, "error");
      return;
    }

    const sentence = this.extractContextSentence() || selected;
    const docId = this.getSelectionDocId(blockId) || "";

    // 查找是否已有同块同句同选中文本的批注（进入编辑态，2026-08-17：精确到词）
    const existing = this.annotationStore.getByBlock(blockId)
      .find((a) => a.sentence === sentence && (a.selectedText || "") === selected);

    if (this.whaleManager) {
      this.whaleManager.showWhaleDialog({
        blockId,
        docId,
        sentence,
        selectedText: selected, // 精确选中文字，用于行内高亮
        existing,
      });
      return;
    }
    // 兜底：whaleManager 未就绪（初始化失败）时给出明确提示，不再回退旧版 textarea 对话框
    showMessage("批注管理器未就绪，请重载插件后重试", 3000, "error");
  }


  /** 录入/删除后刷新块级标记（#23） */
  /**
   * 刷新批注标记（v4：恢复正文视觉标记）。
   * 正文编辑器施加 块级淡背景 + 行内下划线（波浪线/虚线等），
   * 配合三层防护避免破坏 Protyle 选区机制（见 applyAnnotationBlockMarks）。
   */
  private refreshAnnotationMarkers() {
    this.applyAnnotationBlockMarks();
  }

  /**
   * 块级视觉标记（方案 C）：给所有已批注的块元素加 `.hiword-ann-block` 类。
   *  - 仅动 class + 行内 span，绝不修改正文文本内容 → 删除插件后零正文污染。
   *  - 限定在编辑区 `.protyle-wysiwyg` 内扫描，避免误标大纲/文档树。
   *  - 自动清除「数据已删、但 DOM 上仍残留」的标记，保持标记与数据一致。
   *
   * v4（恢复行内高亮 + 三层防护）：历史问题「波浪线后无法框选」根因是
   * surroundContents 拆分文本节点 + observer 递归重建打断选区。v4 采取：
   *  1) 失焦施加：光标仍在编辑区（正在打字/框选）时跳过 inline，blur/mouseup
   *     后防抖 300ms 补施加，避免打字/框选被打断；
   *  2) observer 短路：suppressMarkRefresh 置 true 期间，MutationObserver 回调
   *     直接 return，防止我们自己的 DOM 修改触发递归重建；
   *  3) span user-select:text：保证被包裹文字仍可被鼠标框选。
   */
  private applyAnnotationBlockMarks() {
    const ids = new Set(this.annotationStore.annotatedBlockIds());

    if (ids.size === 0) {
      // 无批注：清掉所有残留（仅清实际存在的行内标记，O(残留) 而非 O(全文档块数)）
      clearBlockMarks();
      this.blockTextSnapshot.clear();
      document.querySelectorAll(".hiword-ann-inline").forEach((el) => {
        const blockEl = (el as HTMLElement).closest("[data-node-id]") as HTMLElement | null;
        if (blockEl) clearInlineMarks(blockEl);
      });
      return;
    }

    // ── 第 1 层：块级淡背景指示器（markAnnotatedBlocks 内部会清理已无批注的块 class）──
    markAnnotatedBlocks(ids);

    // ── 第 2 层：行内精确高亮（v4 恢复 + 聚焦/闪烁修复）──
    // 仅「保护当前正在操作的块」，避免打断选区/拼音输入；其余块（含刚退出聚焦、
    // 光标仅折叠停留的块）照常施加，修复「退出聚焦后波浪线丢失」（旧逻辑只要编辑器
    // 聚焦就整体跳过，导致重渲染后行内标记永不补回）。
    const sel = window.getSelection();
    let protectedBlockId: string | null = null;
    if (sel && sel.type === "range") {
      // 用户正在框选：跳过选区所在块，避免 span 拆分打断拖蓝
      protectedBlockId =
        ((sel.anchorNode as HTMLElement | null)?.closest?.("[data-node-id]") as HTMLElement | null)?.dataset?.nodeId || null;
    } else if (this.isComposing) {
      // 正在输入法合成：跳过光标所在块，避免打断拼音上屏
      protectedBlockId =
        ((document.activeElement as HTMLElement | null)?.closest?.("[data-node-id]") as HTMLElement | null)?.dataset?.nodeId || null;
    }

    // 防护2：自身修改期间短路 observer
    this.suppressMarkRefresh = true;
    try {
      const roots = document.querySelectorAll(".protyle-wysiwyg");
      const seen = new Set<string>();
      roots.forEach((root) => {
        // 性能：仅遍历「已批注的块」，复杂度从 O(全文档块数) 降到 O(批注块数)。
        // 文档越大、批注越少，收益越明显；避免 Copilot 等实时渲染时全文档重扫卡顿。
        ids.forEach((nid) => {
          const el = root.querySelector<HTMLElement>(`[data-node-id="${nid}"]`);
          if (!el) return;
          seen.add(nid);

          const anns = this.annotationStore.getByBlock(nid);
          if (anns.length === 0) {
            // 已无批注：清除可能残留的行内标记与快照，保持数据/视图一致（修复潜在残留 #11）
            if (el.querySelector(".hiword-ann-inline")) clearInlineMarks(el);
            this.blockTextSnapshot.delete(nid);
            return;
          }

          // 保护当前正在操作的块：正在框选(range)或输入法合成时跳过其行内重标，
          // 避免 span 拆分打断选区/拼音；其余块（含刚退出聚焦、光标仅折叠的块）照常施加。
          if (nid === protectedBlockId) {
            this.blockTextSnapshot.set(nid, el.textContent || "");
            return;
          }

          const text = el.textContent || "";
          const prev = this.blockTextSnapshot.get(nid);
          // P1 性能：文本未变且标记已存在 → 跳过整块重标（根因修复 #11），
          // 避免每次刷新（含 observer 触发）对全文档已批注块做 O(N) 全量重新包裹。
          if (prev === text && el.querySelector(".hiword-ann-inline")) return;

          applyInlineMarks(el, anns);
          this.blockTextSnapshot.set(nid, text);
        });
      });
      // 清理已不在文档中 / 已无批注的块快照及残留行内标记，避免无限增长
      for (const nid of [...this.blockTextSnapshot.keys()]) {
        if (!seen.has(nid)) {
          const el = document.querySelector<HTMLElement>(`[data-node-id="${nid}"]`);
          if (el && el.querySelector(".hiword-ann-inline")) clearInlineMarks(el);
          this.blockTextSnapshot.delete(nid);
        }
      }
    } finally {
      this.suppressMarkRefresh = false;
    }
  }

  /** 失焦/框选/输入结束后防抖补施加行内标记（防护1 的配套） */
  private scheduleInlineMarksAfterFocusLoss(): void {
    if (this.inlineMarkTimer !== undefined) clearTimeout(this.inlineMarkTimer);
    this.inlineMarkTimer = setTimeout(() => {
      const sel = window.getSelection();
      // 仍在框选或输入合成 → 继续等待，不打断
      if (sel && sel.type === "range") return;
      if (this.isComposing) return;
      this.applyAnnotationBlockMarks();
    }, 300);
  }

  /**
   * 建立块标记 DOM 观察器：当编辑区发生结构性变化（增删块、折叠展开等）时，
   * 防抖后自动重扫标记，避免思源重渲染把 class 冲掉。
   *  - 仅监听 childList + subtree（不监听 attributes / characterData），
   *    因此纯打字（改文本字符）不会触发，也不会因我们改 class 而递归。
   *  - 每次切换文档时重建（旧文档 DOM 已不在，observer 自动失效，但显式 disconnect 更稳）。
   */
  private ensureAnnotationObserver() {
    this.annObserver?.disconnect();
    this.annObserver = undefined;

    // 观察更稳定的容器 .layout__center：聚焦/重渲染时 .protyle-wysiwyg 可能被替换，
    // 仅观察它会令观察器失效、退出聚焦后标记丢失；降级到 .protyle-wysiwyg / body。
    const root =
      (document.querySelector(".layout__center") as HTMLElement | null) ||
      (document.querySelector(".protyle-wysiwyg") as HTMLElement | null) ||
      document.body;
    if (!root) return;

    let timer: number | undefined;
    const observer = new MutationObserver((mutations) => {
      // v4：自身施加行内标记期间的 DOM 变化不触发重扫（防递归）
      if (this.suppressMarkRefresh) return;
      // 只在结构变化（节点增删）时刷新；纯文本/属性变化忽略
      let structural = false;
      let onlyUi = true;
      for (const m of mutations) {
        if (m.type !== "childList") continue;
        structural = true;
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && !isSiYuanBlockUi(n as Element)) onlyUi = false;
        }
        for (const n of m.removedNodes) {
          if (n.nodeType === 1 && !isSiYuanBlockUi(n as Element)) onlyUi = false;
        }
      }
      if (!structural) return;
      // 仅思源块级 UI（图标/提示/属性）增删、不影响批注内容时跳过刷新，避免悬浮闪烁
      if (onlyUi) return;
      // 输入法合成期间跳过：不打断拼音上屏，合成结束由 focus/mouseup 防抖补扫
      if (this.isComposing) return;
      // 防抖：流式输出/连续编辑期间持续重置计时，仅在「变化停止 ~600ms 后」才排一次扫描，
      // 避免思源 Copilot 等插件实时渲染每个 token 都触发全文档重扫，与渲染争抢主线程导致卡顿。
      // 此外把实际扫描重活放到 requestIdleCallback（浏览器空闲）执行，绝不主动抢占实时渲染。
      if (timer !== undefined) clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        if ("requestIdleCallback" in window) {
          (window as any).requestIdleCallback(
            () => this.applyAnnotationBlockMarks(),
            { timeout: 800 }
          );
        } else {
          this.applyAnnotationBlockMarks();
        }
      }, 600);
    });

    observer.observe(root, { childList: true, subtree: true });
    this.annObserver = observer;
  }

  /** 若 dock 正停在指定 Tab，重新渲染对应面板（批注录入/删除后即时刷新） */
  private renderDockIfTab(tab: string) {
    if (tab !== "annotations") return;
    // 优先从 DOM 找当前可见的 REword dock；this.dockElement 可能因 dock 重建而指向旧容器，
    // 导致删除/新增后右侧面板不刷新（删除后 DOM 残留旧卡片）。
    const dock =
      this.dockElement ||
      document.querySelector('[data-type="hiword-sidebar"]') ||
      document.querySelector(".hiword-dock-panel")?.parentElement;
    if (!dock) return;
    try {
      const active = dock.querySelector(
        '.hiword-dock-tab.active[data-tab="annotations"]'
      );
      if (active) {
        this._annotationsDirty = false;
        this.renderAnnotationsPanel(dock);
      } else {
        // 非激活态：标记脏，切回 tab 时（tab 切换 handler）必重渲染
        this._annotationsDirty = true;
      }
    } catch (e) {
      getLogger().error("[REword] renderDockIfTab 异常", { error: e });
    }
  }

  /** 预览实例挂载防抖定时器（搜索边打字边重渲染时避免反复创建/销毁 Protyle） */
  private _previewSetupTimer?: number;

  /**
   * 统一的面板 HTML 覆写入口：先销毁全部只读预览实例（否则 detached Protyle 崩溃），
   * 再覆写 innerHTML，最后登记懒挂载。
   * 2026-08-18（D6）：编辑态（`inlineCard` 非空）跳过整表重写，避免内联编辑器指向 detached 节点。
   */
  private applyWhalePanelHTML(contentEl: HTMLElement, html: string): void {
    if (this.inlineCard) {
      // 2026-08-18 修复：内联编辑中跳过整表重写，但记下待刷新
      this._annotationsDirty = true;
      return;
    }
    destroyAllPreviews();
    contentEl.innerHTML = html;
    this.setupWhalePreviews(contentEl);
  }

  /** 配置注册表并登记本次渲染的全部预览宿主（app 不可用时保持静态兜底） */
  private setupWhalePreviews(contentEl: HTMLElement): void {
    const app = (window as any).siyuan?.ws?.app;
    if (!app) return;
    // 只读预览实例池参数（D5：固定，不暴露设置）
    const PREVIEW_CONST = { maxLive: 12, unmountDelay: 600, rootMargin: "320px 0px" };
    configurePreviewRegistry({
      app,
      getNote: (id) => this.annotationStore.get(id)?.note || "",
      onBlockRefClick: (blockId) => this.openAnnotationBlock(blockId),
      maxLive: PREVIEW_CONST.maxLive,
      unmountDelay: PREVIEW_CONST.unmountDelay,
      rootMargin: PREVIEW_CONST.rootMargin,
    });
    // 搜索边输入边重渲染时防抖，避免每个按键都创建/销毁 N 个 Protyle
    if (this._previewSetupTimer) clearTimeout(this._previewSetupTimer);
    this._previewSetupTimer = window.setTimeout(() => setupPreviews(contentEl), 120);
  }

  /**
   * 渲染 dock「批注」Tab 面板（#21）—— 微阅风格 v4。
   * 使用 renderWhalePanel 替代旧版 renderAnnotationsList。
   */
  private renderAnnotationsPanel(dockElement: HTMLElement) {
    let contentEl = dockElement.querySelector("#hiword-dock-content") as HTMLElement | null;
    if (!contentEl) {
      // 兜底：传入的 dockElement 可能失效（dock 重建后 this.dockElement 指向旧容器），
      // 从 DOM 找当前可见的 REword 内容区，确保删除/新增后右侧面板一定刷新。
      const dock =
        document.querySelector('[data-type="hiword-sidebar"]') ||
        document.querySelector(".hiword-dock-panel")?.parentElement;
      contentEl = dock?.querySelector("#hiword-dock-content") as HTMLElement | null;
    }
    if (!contentEl) return;
    const items = this.annotationStore.getAll();

    // 2026-08-15 新增：聚合 docInfos（按 docId 分组，含文档名/计数）
    const docInfos = this.getAnnotationDocInfos(items);

    // 使用微阅渲染器（含 sort 维度参数：mode / timeDir / doc / styles）
    this.applyWhalePanelHTML(contentEl, renderWhalePanel(
      items,
      this.currentLabel,
      "",
      this.annotationLabelStore.colorMap(),
      this.annotationLabelStore.getAll(),
      this.whaleTagsCollapsed,
      this.whaleSortMode,
      this.whaleSortTimeDir,
      this.whaleSortDoc,
      this.whaleSortStyles,
      docInfos,
      false,
      this.whaleGroupMode
    ));

    // 绑定搜索事件
    this.bindWhaleSearch(contentEl, items, dockElement);
    // 绑定分类 tab 切换（含 sort 维度按钮、文档下拉、样式面板入口）
    this.bindWhaleTabs(contentEl, items, dockElement);
    // 绑定卡片操作（跳转/编辑/删除）
    this.bindWhaleCardActions(contentEl);
  }

  /**
   * 聚合文档列表（2026-08-15 新增）：按 docId 分组统计批注数。
   * 文档名从思源 getDocTitle（异步获取，失败降级为 ID 前 8 位）。
   */
  private getAnnotationDocInfos(items: any[]): { id: string; name: string; count: number }[] {
    const map = new Map<string, number>();
    for (const a of items) {
      if (!a.docId) continue;
      map.set(a.docId, (map.get(a.docId) || 0) + 1);
    }
    return [...map.entries()].map(([id, count]) => ({
      id,
      name: id.slice(0, 8) || id, // 占位：真实文档名异步获取（待优化）
      count,
    })).sort((a, b) => b.count - a.count);
  }

  /** 绑定微阅面板搜索框 */
  private bindWhaleSearch(contentEl: HTMLElement, allItems: AnnotationItem[], dockElement?: HTMLElement): void {
    const input = contentEl.querySelector("#whale-search-input") as HTMLInputElement;
    const clearBtn = contentEl.querySelector("#whale-search-clear") as HTMLElement;
    let currentCat: any = this.currentLabel;

    input?.addEventListener("input", () => {
      const kw = input.value;
      if (clearBtn) clearBtn.style.display = kw ? "flex" : "none";
      this.applyWhalePanelHTML(contentEl, renderWhalePanel(allItems, this.currentLabel, kw, this.annotationLabelStore.colorMap(), this.annotationLabelStore.getAll(), this.whaleTagsCollapsed, this.whaleSortMode, this.whaleSortTimeDir, this.whaleSortDoc, this.whaleSortStyles, this.getAnnotationDocInfos(allItems), false, this.whaleGroupMode));
      // 重新绑定事件
      this.bindWhaleSearch(contentEl, allItems, dockElement);
      this.bindWhaleTabs(contentEl, allItems, dockElement);
      this.bindWhaleCardActions(contentEl);
      // 恢复搜索框值和焦点
      const newInput = contentEl.querySelector("#whale-search-input") as HTMLInputElement;
      if (newInput) { newInput.value = kw; newInput.focus(); }
    });

    clearBtn?.addEventListener("click", () => {
      input.value = "";
      clearBtn.style.display = "none";
      this.applyWhalePanelHTML(contentEl, renderWhalePanel(allItems, this.currentLabel, "", this.annotationLabelStore.colorMap(), this.annotationLabelStore.getAll(), this.whaleTagsCollapsed, this.whaleSortMode, this.whaleSortTimeDir, this.whaleSortDoc, this.whaleSortStyles, this.getAnnotationDocInfos(allItems), false, this.whaleGroupMode));
      this.bindWhaleSearch(contentEl, allItems, dockElement);
      this.bindWhaleTabs(contentEl, allItems, dockElement);
      this.bindWhaleCardActions(contentEl);
    });
  }

  /** 绑定微阅面板分类 tabs */
  private bindWhaleTabs(contentEl: HTMLElement, allItems: AnnotationItem[], dockElement?: HTMLElement): void {
    const searchInput = (contentEl.querySelector("#whale-search-input") as HTMLInputElement)?.value || "";
    contentEl.querySelectorAll("#whale-panel-tabs .whale-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const cat = (tab as HTMLElement).dataset.cat || "all";
        this.currentLabel = cat;
        this.applyWhalePanelHTML(contentEl, renderWhalePanel(allItems, cat, searchInput, this.annotationLabelStore.colorMap(), this.annotationLabelStore.getAll(), this.whaleTagsCollapsed, this.whaleSortMode, this.whaleSortTimeDir, this.whaleSortDoc, this.whaleSortStyles, this.getAnnotationDocInfos(allItems), false, this.whaleGroupMode));
        this.bindWhaleSearch(contentEl, allItems, dockElement);
        this.bindWhaleTabs(contentEl, allItems, dockElement);
        this.bindWhaleCardActions(contentEl);
        // 恢复搜索值
        const newInput = contentEl.querySelector("#whale-search-input") as HTMLInputElement;
        if (newInput) newInput.value = searchInput;
      });
    });

    // 「⚙ 管理」按钮 → 打开标签管理弹窗
    contentEl.querySelector('[data-action="whale-manage-labels"]')?.addEventListener("click", () => {
      this.openLabelManagementDialog();
    });

    // 「🏷️ 标签 ▾ 收起 / ▸ 展开」按钮（2026-08-15 新增）
    contentEl.querySelector("#whale-tags-collapse-btn")?.addEventListener("click", () => {
      this.toggleTagsCollapse("whale", dockElement);
    });

    // ====== 2026-08-15 新增：3 维度 sort 按钮 + 文档下拉 ======
    this.bindWhaleSort(contentEl, allItems, dockElement);
  }

  /**
   * 绑定 3 维度 sort 按钮 + 文档下拉 + 样式面板入口（2026-08-15 新增）。
   *  - 时间：单击切换升降序（已激活时）或进入时间模式
   *  - 文档：单击进入文档模式（renderWhalePanel 渲染下拉），下拉内点击 docId 切换 sortDoc
   *  - 样式：单击进入样式模式，弹出样式多选 popover
   */
  private bindWhaleSort(contentEl: HTMLElement, allItems: any[], dockElement?: HTMLElement): void {
    const rerender = () => {
      const kw = (contentEl.querySelector("#whale-search-input") as HTMLInputElement)?.value || "";
      this.applyWhalePanelHTML(contentEl, renderWhalePanel(
        allItems, this.currentLabel, kw,
        this.annotationLabelStore.colorMap(), this.annotationLabelStore.getAll(), this.whaleTagsCollapsed,
        this.whaleSortMode, this.whaleSortTimeDir, this.whaleSortDoc, this.whaleSortStyles,
        this.getAnnotationDocInfos(allItems), false, this.whaleGroupMode
      ));
      this.bindWhaleSearch(contentEl, allItems, dockElement);
      this.bindWhaleTabs(contentEl, allItems, dockElement);
      this.bindWhaleCardActions(contentEl);
      // 恢复搜索值
      const ni = contentEl.querySelector("#whale-search-input") as HTMLInputElement;
      if (ni) ni.value = kw;
    };
    const persistSort = () => {
      try {
        localStorage.setItem("hiword-annotation-sort-mode", this.whaleSortMode);
        localStorage.setItem("hiword-annotation-sort-time-dir", this.whaleSortTimeDir);
        localStorage.setItem("hiword-annotation-sort-doc", this.whaleSortDoc || "");
        localStorage.setItem("hiword-annotation-sort-styles", JSON.stringify(this.whaleSortStyles));
      } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · persistSort", "error"); }
    };

    contentEl.querySelectorAll("[data-sort-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = (btn as HTMLElement).dataset.sortAction as "time" | "doc" | "style";
        if (action === "time") {
          // 已激活时切换方向，否则进入时间模式
          if (this.whaleSortMode === "time") {
            this.whaleSortTimeDir = this.whaleSortTimeDir === "desc" ? "asc" : "desc";
          } else {
            this.whaleSortMode = "time";
            this.whaleSortTimeDir = "desc";
          }
        } else if (action === "doc") {
          if (this.whaleSortMode !== "doc") {
            this.whaleSortMode = "doc";
            this.whaleSortDoc = null; // 进入时清空选择，让用户选
          } else {
            // 再次点击 doc 按钮 → 退出 doc 模式回 time
            this.whaleSortMode = "time";
            this.whaleSortDoc = null;
          }
        } else if (action === "style") {
          if (this.whaleSortMode !== "style") {
            this.whaleSortMode = "style";
            this.whaleSortStyles = []; // 进入时清空
          } else {
            this.whaleSortMode = "time";
            this.whaleSortStyles = [];
          }
          // 样式模式：弹出样式选择 popover
          if (this.whaleSortMode === "style") this.showStyleFilterPopover();
        }
        persistSort();
        rerender();
      });
    });

    // 文档下拉：点击某个文档按钮切换 sortDoc
    contentEl.querySelectorAll("#whale-doc-filter [data-doc-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).dataset.docId || "";
        this.whaleSortDoc = id || null;
        persistSort();
        rerender();
      });
    });
    // 文档下拉：清除
    contentEl.querySelector("#whale-doc-filter [data-doc-clear]")?.addEventListener("click", () => {
      this.whaleSortDoc = null;
      persistSort();
      rerender();
    });

    // ====== 2026-08-15 新增：面包屑单维清除 ======
    contentEl.querySelectorAll("#whale-filter-breadcrumb [data-filter-clear]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const dim = (chip as HTMLElement).dataset.filterClear;
        if (dim === "label") this.currentLabel = "all";
        else if (dim === "search") {
          const si = contentEl.querySelector("#whale-search-input") as HTMLInputElement;
          if (si) si.value = "";
        } else if (dim === "doc") this.whaleSortDoc = null;
        else if (dim === "style") this.whaleSortStyles = [];
        else if (dim === "time") this.whaleSortTimeDir = "desc";
        persistSort();
        rerender();
      });
    });

    // ====== 2026-08-15 新增：一键重置所有筛选 ======
    contentEl.querySelector("#whale-filter-reset")?.addEventListener("click", () => {
      this.resetWhaleFilters();
    });
  }

  /**
   * 一键重置所有筛选维度（2026-08-15 新增）。
   * 标签 → all、搜索清空、模式 → time、时间 → desc、文档 → null、样式 → []，
   * 并同步清空对应 localStorage 键，然后重渲染批注面板。
   */
  private resetWhaleFilters(): void {
    this.currentLabel = "all";
    this.whaleSortMode = "time";
    this.whaleSortTimeDir = "desc";
    this.whaleSortDoc = null;
    this.whaleSortStyles = [];
    try {
      localStorage.removeItem("hiword-annotation-sort-mode");
      localStorage.removeItem("hiword-annotation-sort-time-dir");
      localStorage.removeItem("hiword-annotation-sort-doc");
      localStorage.removeItem("hiword-annotation-sort-styles");
    } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · resetWhaleFilters", "debug"); }
    // 重渲染（清空搜索框）
    if (this.dockElement) {
      const contentEl = this.dockElement.querySelector("#hiword-dock-content") as HTMLElement | null;
      if (contentEl) {
        const items = this.annotationStore.getAll();
        this.applyWhalePanelHTML(contentEl, renderWhalePanel(
          items, this.currentLabel, "",
          this.annotationLabelStore.colorMap(), this.annotationLabelStore.getAll(), this.whaleTagsCollapsed,
          this.whaleSortMode, this.whaleSortTimeDir, this.whaleSortDoc, this.whaleSortStyles,
          this.getAnnotationDocInfos(items), false, this.whaleGroupMode
        ));
        this.bindWhaleSearch(contentEl, items, this.dockElement);
        this.bindWhaleTabs(contentEl, items, this.dockElement);
        this.bindWhaleCardActions(contentEl);
      }
    }
  }

  /**
   * 样式选择 popover（2026-08-15 新增）：点击样式按钮进入样式模式后弹出。
   * 多选 color + style 组合，点击 swatch 切换选中状态，实时预览筛选数。
   */
  private showStyleFilterPopover(): void {
    // 关闭已有
    document.querySelector(".hiword-style-filter-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "hiword-style-filter-pop";
    const presets = [
      { color: "#facc15", style: "wavy", label: "生词" },
      { color: "#22c55e", style: "solid", label: "模糊" },
      { color: "#06b6d4", style: "solid", label: "文化" },
      { color: "#ec4899", style: "solid", label: "易错" },
      { color: "#8b5cf6", style: "wavy", label: "逻辑" },
      { color: "#facc15", style: "highlight", label: "重点" },
      { color: "#06b6d4", style: "highlight", label: "金句" },
    ];
    pop.innerHTML = `
      <div class="hiword-style-filter-head">🎨 勾选样式（${this.whaleSortStyles.length} / ${presets.length}）</div>
      <div class="hiword-style-filter-grid">
        ${presets.map((p) => {
          const key = `${p.color}|${p.style}`;
          const active = this.whaleSortStyles.includes(key);
          return `<button type="button" class="hiword-style-filter-cell ${active ? "active" : ""}" data-style-key="${key}" title="${p.label}">
            <span class="hiword-style-filter-preview" style="${p.style === "highlight" ? `background:${p.color};color:#fff` : `text-decoration:underline;text-decoration-style:${p.style === "wavy" ? "wavy" : "solid"};text-decoration-color:${p.color};color:${p.color}`}">Aa</span>
            <span class="hiword-style-filter-label">${p.label}</span>
          </button>`;
        }).join("")}
      </div>
      <div class="hiword-style-filter-foot">
        <button class="hiword-style-filter-clear" data-style-clear>清空</button>
        <button class="hiword-style-filter-done" data-style-done>完成</button>
      </div>
    `;
    document.body.appendChild(pop);
    // 定位：固定在 dock 右侧上方（如果 dock 存在）
    if (this.dockElement) {
      const rect = this.dockElement.getBoundingClientRect();
      pop.style.left = `${rect.right - 320}px`;
      pop.style.top = `${rect.top + 80}px`;
    } else {
      pop.style.left = "50%";
      pop.style.transform = "translateX(-50%)";
      pop.style.top = "120px";
    }

    // 切换选中
    pop.querySelectorAll("[data-style-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = (btn as HTMLElement).dataset.styleKey || "";
        const idx = this.whaleSortStyles.indexOf(key);
        if (idx >= 0) this.whaleSortStyles.splice(idx, 1);
        else this.whaleSortStyles.push(key);
        // 重新渲染 popover head 计数
        const head = pop.querySelector(".hiword-style-filter-head");
        if (head) head.textContent = `🎨 勾选样式（${this.whaleSortStyles.length} / ${presets.length}）`;
        btn.classList.toggle("active");
        // 实时写 localStorage 并刷新批注面板
        try { localStorage.setItem("hiword-annotation-sort-styles", JSON.stringify(this.whaleSortStyles)); } catch {}
        if (this.dockElement) {
          const kw = (this.dockElement.querySelector("#whale-search-input") as HTMLInputElement)?.value || "";
          const items = this.annotationStore.getAll();
          const ce = this.dockElement.querySelector("#hiword-dock-content") as HTMLElement | null;
          if (ce) this.applyWhalePanelHTML(ce, renderWhalePanel(
            items, this.currentLabel, kw,
            this.annotationLabelStore.colorMap(), this.annotationLabelStore.getAll(), this.whaleTagsCollapsed,
            this.whaleSortMode, this.whaleSortTimeDir, this.whaleSortDoc, this.whaleSortStyles,
            this.getAnnotationDocInfos(items), false, this.whaleGroupMode
          ));
          this.bindWhaleSearch(this.dockElement, items, this.dockElement);
          this.bindWhaleTabs(this.dockElement, items, this.dockElement);
          this.bindWhaleCardActions(this.dockElement);
          if (kw) {
            const ni = this.dockElement.querySelector("#whale-search-input") as HTMLInputElement;
            if (ni) ni.value = kw;
          }
        }
      });
    });
    // 清空
    pop.querySelector("[data-style-clear]")?.addEventListener("click", () => {
      this.whaleSortStyles = [];
      try { localStorage.setItem("hiword-annotation-sort-styles", "[]"); } catch {}
      pop.remove();
      if (this.dockElement) this.renderAnnotationsPanel(this.dockElement);
    });
    // 完成
    pop.querySelector("[data-style-done]")?.addEventListener("click", () => pop.remove());
    // 点击外部关闭
    const onDocDown = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node)) {
        pop.remove();
        document.removeEventListener("mousedown", onDocDown, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);
  }

  /** 绑定微阅卡片操作按钮 */
  private bindWhaleCardActions(contentEl: HTMLElement): void {
    // 2026-08-25：分区头部点击收起/展开
    contentEl.querySelectorAll(".whale-section-head[data-toggle='section']").forEach((head) => {
      head.addEventListener("click", () => {
        const section = head.closest(".whale-section") as HTMLElement;
        if (section) section.classList.toggle("collapsed");
      });
    });

    // 定位 → 编辑区平滑滚动到标注文字（居中显示）；2026-08-17：原文引用条整条也可点击；
    // 2026-08-17 新增：笔记化面板的「原文：xxx」元信息行同样可点击定位
    const jumpHandler = (btn: Element) => {
      const card = btn.closest(".whale-card, .whale-notes-item") as HTMLElement;
      if (!card) return;
      // C 跳转定位：阅读批注（带 data-book + data-cfi）→ 打开/聚焦阅读 Tab 并跳转到对应位置弹气泡
      const bookId = card.dataset.book;
      const cfi = card.dataset.cfi;
      if (bookId && cfi) {
        void this.jumpToReading(bookId, cfi);
        return;
      }
      const annId = card.dataset.id;
      if (annId) this.scrollEditorToAnnotation(annId);
    };
    contentEl.querySelectorAll(".whale-card-btn[data-action='jump']").forEach((btn) => {
      btn.addEventListener("click", () => jumpHandler(btn));
    });
    contentEl.querySelectorAll("blockquote.whale-card-sentence[data-action='jump']").forEach((q) => {
      q.addEventListener("click", () => jumpHandler(q));
    });
    contentEl.querySelectorAll(".whale-notes-source[data-action='jump']").forEach((q) => {
      q.addEventListener("click", () => jumpHandler(q));
    });

    // 编辑 → 卡片/笔记条目内联 lite Protyle 编辑（2026-08-17：替代弹窗；样式/标签走「样式」入口）
    const startEdit = (item: HTMLElement) => {
      const id = item.dataset.id;
      if (!id) return;
      const ann = this.annotationStore.get(id);
      if (!ann) return;
      this.editAnnotationInline(item, ann, contentEl);
    };
    contentEl.querySelectorAll(".whale-card-btn[data-action='edit']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".whale-card") as HTMLElement;
        if (card) startEdit(card);
      });
    });
    contentEl.querySelectorAll(".whale-notes-act[data-action='edit']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = btn.closest(".whale-notes-item") as HTMLElement;
        if (item) startEdit(item);
      });
    });
    // 2026-08-17：笔记化面板「双击正文直接进入内联编辑」（用户拍板：方案B）
    contentEl.querySelectorAll(".whale-notes-item").forEach((item) => {
      item.addEventListener("dblclick", (e) => {
        const target = e.target as HTMLElement;
        if (target.closest(".whale-notes-acts") || target.closest(".whale-notes-source")) return;
        startEdit(item as HTMLElement);
      });
    });

    // 删除（v4：自定义确认弹窗 + 即时刷新）——卡片 + 笔记条目
    const deleteItem = async (item: HTMLElement) => {
      const id = item.dataset.id;
      if (!id) {
        getLogger().warn("[REword] 删除批注失败：未找到 item.dataset.id", { data: { item: item?.outerHTML?.slice(0, 200) } });
        return;
      }
      const ok = await confirmDelete("确定删除这条批注？");
      if (!ok) return;
      // 若当前有任何内联编辑态，先安全退出，避免 applyWhalePanelHTML 因 inlineCard 存在
      // 跳过重渲染，导致被删除的卡片仍残留在面板上（用户误以为删除无效）。
      if (this.inlineCard) {
        getLogger().info("[REword] 删除批注前退出内联编辑态", { data: { id } });
        this.cancelInlineEdit(false);
      }
      try {
        // 传 this.dockElement（根节点），而非 contentEl——修复删除后不即时刷新的 bug
        await this.deleteAnnotation(id, this.dockElement ?? contentEl);
      } catch (e: any) {
        getLogger().error("[REword] 删除批注异常", { data: { id }, error: e });
        showMessage(`删除失败：${e?.message || e}`, 3000, "error");
      }
    };
    contentEl.querySelectorAll(".whale-card-btn[data-action='delete']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".whale-card") as HTMLElement;
        if (card) await deleteItem(card);
      });
    });
    contentEl.querySelectorAll(".whale-notes-act[data-action='delete']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const item = btn.closest(".whale-notes-item") as HTMLElement;
        if (item) await deleteItem(item);
      });
    });

    // ===== 2026-08-17 修复：底部 footer 工具栏（导出 / 清空全部 / 重置筛选）======
    // 此前这三个按钮只渲染 HTML、从未绑定事件，点击无反应。
    // 导出批注 → Markdown 文件下载
    contentEl.querySelector("#whale-export")?.addEventListener("click", () => {
      this.exportAnnotationsMD();
    });
    // 清空全部批注（二次确认，不可恢复）
    contentEl.querySelector("#whale-clear-all")?.addEventListener("click", async () => {
      if (this.annotationStore.size === 0) {
        showMessage("批注为空", 2000, "info" as any);
        return;
      }
      if (await confirmDelete("确定清空全部批注？此操作不可恢复")) {
        await this.annotationStore.clearAll();
        this.renderAnnotationsPanel(this.dockElement ?? contentEl);
        this.refreshAnnotationMarkers();
        showMessage("已清空全部批注", 2000, "success" as any);
      }
    });
    // 重置所有筛选条件（含搜索框清空）
    contentEl.querySelector("#whale-filter-reset")?.addEventListener("click", () => {
      this.resetWhaleFilters();
    });

    // ===== 2026-08-17 新增：列表分组切换（时间 / 文档，默认时间）=====
    contentEl.querySelectorAll("[data-group-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = (btn as HTMLElement).dataset.groupAction as WhaleGroupMode;
        if (mode !== "time" && mode !== "doc") return;
        this.whaleGroupMode = mode;
        try { localStorage.setItem("hiword-annotation-group-mode", mode); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { localStorage.setItem(\"hiword-annotation-group-mode\", mode…", "debug"); }
        const kw = (contentEl.querySelector("#whale-search-input") as HTMLInputElement)?.value || "";
        const allItems = this.annotationStore.getAll();
        this.applyWhalePanelHTML(contentEl, renderWhalePanel(
          allItems, this.currentLabel, kw,
          this.annotationLabelStore.colorMap(), this.annotationLabelStore.getAll(), this.whaleTagsCollapsed,
          this.whaleSortMode, this.whaleSortTimeDir, this.whaleSortDoc, this.whaleSortStyles,
          this.getAnnotationDocInfos(allItems), false, this.whaleGroupMode
        ));
        this.bindWhaleSearch(contentEl, allItems);
        this.bindWhaleTabs(contentEl, allItems);
        this.bindWhaleCardActions(contentEl);
        const ni = contentEl.querySelector("#whale-search-input") as HTMLInputElement;
        if (ni) ni.value = kw;
      });
    });
  }

  // ====== 2026-08-17：汇总面板卡片内联编辑（lite Protyle，与弹窗共用内核）======
  private inlineEditor: AnnEditor | null = null;
  private inlineCard: HTMLElement | null = null;
  private inlineActionBar: HTMLElement | null = null;
  /** 批注面板是否需要重新渲染（解决内联编辑期 / 非激活 tab 时后台更新被吞） */
  private _annotationsDirty = false;

  /** 卡片内联编辑：隐藏展示区 → 挂载 lite Protyle → 保存/取消 */
  private editAnnotationInline(card: HTMLElement, ann: AnnotationItem, contentEl: HTMLElement): void {
    // 同一卡片已在编辑态 → 忽略
    if (this.inlineCard === card && this.inlineEditor) return;
    // 其他卡片正在编辑 → 先取消（防多实例打架）
    if (this.inlineCard && this.inlineCard !== card) {
      this.cancelInlineEdit();
    }
    const noteEl = card.querySelector(".whale-card-note, .whale-notes-text") as HTMLElement | null;
    if (!noteEl) return;
    // 只读预览与编辑器互斥：显示态隐藏前先销毁预览实例，避免 display:none 容器内 Protyle 失效/报错
    destroyPreview(ann.id);
    unobserveHost(noteEl.querySelector(".whale-notes-protyle") as HTMLElement | null);
    const app = (window as any).siyuan?.ws?.app;
    if (!app) {
      showMessage("思源编辑器不可用，无法内联编辑", 3000, "error");
      return;
    }
    // 2026-08-18（D6/D8）：申请全局编辑会话，面板/弹窗/浮层同一时刻仅一个编辑会话
    if (!requestEditSession("panel")) {
      showMessage("已在别处编辑，请先完成当前编辑", 2500, "info");
      return;
    }
    markEditing(ann.id);

    // 隐藏展示区，插入编辑器容器 + 操作条
    noteEl.style.display = "none";
    const host = document.createElement("div");
    host.className = "whale-ann-inline-editor";
    noteEl.insertAdjacentElement("afterend", host);
    // 2026-08-19：含表格的批注在 lite 编辑态下仅支持单元格文本编辑，给出能力提示
    if (hasBlockTable(ann.note || "")) {
      const hint = document.createElement("div");
      hint.className = "ann-table-edit-hint";
      hint.textContent = "表格支持单元格文字编辑；增删行列请在文档中编辑。";
      host.insertAdjacentElement("beforebegin", hint);
    }

    const bar = document.createElement("div");
    bar.className = "whale-ann-inline-actions";
    bar.innerHTML = `
      <button type="button" class="b3-button b3-button--small b3-button--outline" data-act="cancel">取消</button>
      <span class="whale-footer-spacer"></span>
      <button type="button" class="b3-button b3-button--small b3-button--outline" data-act="style" title="颜色/线段/标签">样式</button>
      <button type="button" class="b3-button b3-button--small b3-button--emphasize" data-act="save">保存</button>
    `;
    host.insertAdjacentElement("afterend", bar);

    this.inlineCard = card;
    this.inlineActionBar = bar;
    card.classList.add("whale-card--editing", "whale-notes-item--editing");
    // 编辑打开标志改由 requestEditSession 统一维护（D6/D8），此处不再直接赋值

    this.inlineEditor = mountAnnEditor(host, {
      app,
      initial: ann.note || "",
      // 原生浮动工具栏（选中文字唤起）；REword 按钮经 editorOpen 守卫跳过
      toolbar: DEFAULT_ANN_TOOLBAR,
    });

    // 保存（按钮）
    bar.querySelector('[data-act="save"]')?.addEventListener("click", () => {
      void this.saveInlineEdit(contentEl, ann);
    });
    // 卡片空白双击 → 自动保存退出（2026-08-18 新增；编辑器内文本双击不触发）
    const blankDbl = (e: MouseEvent) => {
      const tg = e.target as HTMLElement;
      if (tg.closest(".whale-ann-inline-actions")) return;                 // 操作条按钮
      if (tg.closest(".whale-ann-inline-editor") && tg.closest(".protyle-wysiwyg")) return; // 编辑器内文本
      void this.saveInlineEdit(contentEl, ann);
    };
    card.addEventListener("dblclick", blankDbl);
    (bar as any).__blankDbl = blankDbl;
    // 取消
    bar.querySelector('[data-act="cancel"]')?.addEventListener("click", () => this.cancelInlineEdit());
    // 样式 → 打开弹窗（完整样式/标签编辑）
    bar.querySelector('[data-act="style"]')?.addEventListener("click", () => {
      this.cancelInlineEdit();
      this.whaleManager?.showWhaleDialog({
        selectedText: ann.selectedText,
        sentence: ann.sentence,
        blockId: ann.blockId,
        docId: ann.docId,
        existing: ann,
      });
    });
    // ESC 取消
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.inlineEditor) this.cancelInlineEdit();
    };
    document.addEventListener("keydown", escHandler);
    (bar as any).__escHandler = escHandler;
  }

  /** 内联编辑保存：读取内容 → 空校验 → upsert → 退出编辑并刷新面板/标记（保存按钮与卡片空白双击共用） */
  private async saveInlineEdit(contentEl: HTMLElement, ann: AnnotationItem): Promise<void> {
    if (!this.inlineEditor) return;
    const md = this.inlineEditor.read() || "";
    if (!md || !md.replace(/<[^>]*>/g, "").trim()) {
      showMessage("批注内容不能为空", 2500, "info");
      this.inlineEditor.focus();
      return;
    }
    try {
      await this.annotationStore.upsert({ ...ann, note: md });
      showMessage("批注已更新", 2000, "success" as any);
      this.cancelInlineEdit(false);   // 保存后由下方整表重渲染重新挂载预览
      this.renderAnnotationsPanel(this.dockElement ?? contentEl);
      this.refreshAnnotationMarkers();
    } catch (e: any) {
      showMessage(`保存失败：${e?.message || e}`, 3000, "error");
    }
  }

  /** 取消/结束内联编辑：销毁编辑器、恢复展示。
   *  @param remountPreview 取消后是否重挂只读预览（保存路径由整表重渲染接管，传 false） */
  private cancelInlineEdit(remountPreview = true): void {
    if (!this.inlineCard) return;
    this.inlineEditor?.destroy();
    this.inlineEditor = null;
    const card = this.inlineCard;
    const editingId = card.dataset.id || "";
    card.querySelector(".whale-ann-inline-editor")?.remove();
    const bar = this.inlineActionBar;
    if (bar) {
      const eh = (bar as any).__escHandler;
      if (eh) document.removeEventListener("keydown", eh);
      const bd = (bar as any).__blankDbl;
      if (bd) { card.removeEventListener("dblclick", bd); (bar as any).__blankDbl = undefined; }
      bar.remove();
    }
    this.inlineActionBar = null;
    const noteEl = card.querySelector(".whale-card-note, .whale-notes-text") as HTMLElement | null;
    if (noteEl) noteEl.style.display = "";
    card.classList.remove("whale-card--editing", "whale-notes-item--editing");
    this.inlineCard = null;
    // 2026-08-18（D6/D8）：所有出口统一释放全局编辑会话 + 编辑锁，避免会话泄漏
    releaseEditSession("panel");
    if (editingId) unmarkEditing(editingId);
    // 取消（非保存）：恢复显示后重挂该卡片的只读预览
    if (remountPreview && noteEl) {
      const host = noteEl.querySelector(".whale-notes-protyle") as HTMLElement | null;
      const id = card.dataset.id || "";
      if (host && id) { observeHost(host); mountPreview(host, id); }
    }
    // 2026-08-18 修复：内联编辑期间若有后台更新被 applyWhalePanelHTML 跳过，
    // 此处统一补一次面板重渲染，避免 stale。
    if (this._annotationsDirty && this.dockElement) {
      this._annotationsDirty = false;
      this.renderAnnotationsPanel(this.dockElement);
    }
  }

  /**
   * 跳转定位到批注所在块（#22 + 2026-08-14 修订）。
   *  - 优先使用官方 `window.siyuan.openBlock`，action=cb-get-hl 仅高亮不聚焦
   *    （原 action:"focus" 会进入编辑器聚焦模式，对只想看原文的用户太重）。
   *  - 回退：通过 `siyuan://blocks/{id}` 协议链接打开（不进入聚焦模式）。
   */
  private openAnnotationBlock(blockId: string, _docId?: string) {
    const s = (window as any).siyuan;
    if (s && typeof s.openBlock === "function") {
      try {
        // cb-get-hl = scroll + highlight，**不**进入编辑器聚焦模式
        const r = s.openBlock({ id: blockId, action: ["cb-get-hl"] });
        if (r && typeof r.catch === "function") {
          r.catch((err: unknown) => {
            getLogger().warn("[REword] openBlock 失败，回退协议链接:", { error: err });
            window.open(`siyuan://blocks/${blockId}`);
          });
        }
        return;
      } catch (err) {
        getLogger().warn("[REword] openBlock 抛错，回退协议链接:", { error: err });
      }
    }
    // 回退方案
    window.open(`siyuan://blocks/${blockId}`);
  }

  /** 展开含表格批注：居中 Dialog 完整渲染 note（表格可横向滚动查看） */
  private openAnnotationTable(id: string): void {
    const ann = this.annotationStore.get(id);
    if (!ann) return;
    // 渲染已在外部 import 的 renderAnnotationHTML；Dialog 容器带 b3-typography 继承排版
    new Dialog({
      title: "批注内容",
      content: `<div class="whale-table-expand b3-typography" style="max-height:70vh;overflow:auto;">${renderAnnotationHTML(ann.note)}</div>`,
      width: responsiveDialogSize(680, "width"),
    });
  }

  /** 删除一条批注（#22）：更新数据层 + 刷新面板 + 刷新正文块标记 + 广播阅读器视觉同步 */
  private async deleteAnnotation(id: string, dockElement: HTMLElement) {
    const ann = this.annotationStore.get(id); // remove 前取（remove 后 get 已过滤软删）
    if (await this.annotationStore.remove(id)) {
      showMessage("批注已删除", 2000, "success" as any);
      this.renderAnnotationsPanel(dockElement);
      this.refreshAnnotationMarkers();
      // 2026-08-24：广播 → 打开中的阅读面板立即清除该高亮（不依赖翻页重绘）
      if (ann?.bookId) notifyAnnotationsChanged(ann.bookId);
    }
  }

  // ==================== 内联批注点击浮层 ====================

  /** switch-protyle 事件：刷新当前文档根 ID 并重建块标记观察器（经 Disposables 托管） */
  private onSwitchProtyle = (e: CustomEvent): void => {
    const protyle = (e.detail as any)?.protyle;
    const rootID = protyle?.rootID;
    if (rootID) this.currentRootId = rootID;
    if (this.isReady) {
      // 文档切换后：重建块标记观察器（新文档 DOM 全新），并延迟刷新标记
      // （思源切换后内容异步渲染，延迟确保 DOM 就绪）
      this.ensureAnnotationObserver();
      const t = setTimeout(() => this.applyAnnotationBlockMarks(), 280);
      this.disposables.addTimer(t);
      // 2026-08-22 词库高亮:切文档时重启 highlighter(绑到新 protyle DOM)+ 立即全扫
      const t2 = setTimeout(() => {
        const wysiwyg = document.querySelector(".protyle-wysiwyg") as HTMLElement | null;
        if (wysiwyg) {
          const hl = getVocabHighlighter();
          hl.start(wysiwyg);
          hl.setEnabled(this.vocabAutoHighlight);
          hl.refreshAll();
        }
      }, 360);
      this.disposables.addTimer(t2);
    }
  };

  /**
   * 编辑器内容区右键菜单（open-menu-content）注入「发送到 AI 分析」入口。
   * 仅在存在文本选区时追加，不干扰原生右键菜单（复制/粘贴等）。
   * 点击后调用 showAiPanel()，面板会读取当前选区文本并预填输入框。
   */
  private onOpenContentMenu = (e: CustomEvent): void => {
    try {
      const selText = window.getSelection()?.toString()?.trim() || "";
      if (!selText) return; // 仅当选中文本时才提供该入口
      const detail = (e as any)?.detail;
      const menu = detail?.menu;
      if (!menu || typeof menu.addItem !== "function") return;
      menu.addItem({
        icon: "iconREword",
        label: "📤 发送到 AI 分析（REword）",
        click: () => { this.showAiPanel(); },
      });
    } catch (err) {
      getLogger().warn("[REword] 右键菜单注入失败:", { error: err });
    }
  };

  /** mousedown 时的坐标（用于区分点击与拖拽选区） */
  private _mousedownPos = { x: 0, y: 0 };

  /**
   * 监听正文点击：单击高亮批注词 → 弹出查看/操作浮层；双击 → 直接打开批注编辑弹窗
   * （2026-08-17 用户拍板：方案B，跳过中间浮层，更直觉）。
   *
   * 2026-08-17 修复「<code> 内点击不稳」：
   *   思源 <code> 元素有自己的事件处理（复制/工具栏等），可能导致 click 冒泡被截断。
   *   改用捕获阶段先于思源处理；同时加 elementFromPoint 兜底，确保一定能找到高亮 span。
   * 全局监听经 Disposables 托管。
   */
  private bindInlineAnnotationClick(): void {
    // mousedown 捕获阶段记录坐标（用于区分拖拽选区与点击）
    this.disposables.addEventListener(document, "mousedown", (e: MouseEvent) => {
      this._mousedownPos = { x: e.clientX, y: e.clientY };
    }, true);
    // click 用捕获阶段（先于思源 bubble handler，避免被 stopPropagation 截断）
    this.disposables.addEventListener(document, "click", this.onInlineAnnotationClick, true);
    // 双击：直接打开编辑弹窗（不再经过「编辑/定位/删除」小浮层）
    this.disposables.addEventListener(document, "dblclick", (e: MouseEvent) => {
      // 跳过我们自己的弹窗/对话框/侧边栏容器内的双击（避免误开编辑）
      if (this.isInsideOurUI(e)) return;
      const span = this.findInlineAnnotationSpan(e) ?? this.findInlineAnnotationSpanByPoint(e);
      if (!span) return;
      const annId = span.dataset.annId;
      if (!annId) return;
      const ann = this.annotationStore.get(annId);
      if (!ann) return;
      e.preventDefault();
      e.stopPropagation();
      this.closeInlineAnnotationPopover();
      this.whaleManager?.showWhaleDialog({
        selectedText: ann.selectedText,
        sentence: ann.sentence,
        blockId: ann.blockId,
        docId: ann.docId,
        existing: ann,
      });
      // 同步联动：侧边栏面板定位并高亮对应条目
      this.focusAnnotationCardInDock(annId);
    }, true);
  }

  /** 用 composedPath 向上查找高亮 span（抗思源 DOM 重建） */
  private findInlineAnnotationSpan(e: MouseEvent): HTMLElement | null {
    const path = (e as MouseEvent).composedPath?.() || [];
    for (const node of path) {
      const el = node as HTMLElement;
      if (el?.classList?.contains?.("hiword-ann-inline")) return el;
    }
    return null;
  }

  /**
   * 兜底：用 document.elementFromPoint 查找点击位置的最顶层元素，再向上找高亮 span。
   * 解决 <code> 内批注点击不稳（思源 <code> 元素的 click 可能在 composedPath 中间被截断，
   * 但 elementFromPoint 始终返回视口最顶层元素，不受事件传播影响）。
   */
  private findInlineAnnotationSpanByPoint(e: MouseEvent): HTMLElement | null {
    try {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!el) return null;
      return el.closest?.(".hiword-ann-inline") as HTMLElement | null;
    } catch {
      return null;
    }
  }

  /**
   * 判断点击事件是否发生在我们自己的 UI 容器内（弹窗/对话框/侧边栏），
   * 用于在捕获阶段跳过，避免破坏我们自己的内部交互（按钮点击/输入框焦点等）。
   */
  private isInsideOurUI(e: MouseEvent): boolean {
    const path = (e.composedPath?.() || []) as Element[];
    for (const n of path) {
      const el = n as HTMLElement;
      if (!el?.classList) continue;
      if (
        el.classList.contains("hiword-ann-popover") ||
        el.classList.contains("whale-dlg-overlay") ||
        el.classList.contains("whale-dlg") ||
        el.classList.contains("hiword-dock-panel") ||
        el.classList.contains("hiword-dock-content") ||
        el.classList.contains("hiword-ann-inline-editor") ||
        el.classList.contains("cp-dock-host")
      ) {
        return true;
      }
    }
    return false;
  }

  private onInlineAnnotationClick = (e: MouseEvent): void => {
    // 捕获阶段：先判断是否是我们自己的弹窗/对话框/侧边栏的点击，是则直接放行不处理
    if (this.isInsideOurUI(e)) return;
    // composedPath → elementFromPoint 兜底（解决 <code> 内点击不稳）
    const span = this.findInlineAnnotationSpan(e) ?? this.findInlineAnnotationSpanByPoint(e);
    if (!span) {
      // 点击其它位置关闭浮层
      this.closeInlineAnnotationPopover();
      return;
    }
    const annId = span.dataset.annId;
    if (!annId) {
      this.closeInlineAnnotationPopover();
      return;
    }
    const sel = window.getSelection();
    // 仅当存在真实拖拽选区（鼠标位移 > 5px）才拦截；
    // 双击选词 / 快速连击产生的 range 不再误拦截————原「连续点击难呼出」的主因。
    // 阈值从 3px 放宽到 5px（<code> 等小元素点击更容易产生微小位移）。
    if (sel && sel.type === "range") {
      const dx = Math.abs(e.clientX - this._mousedownPos.x);
      const dy = Math.abs(e.clientY - this._mousedownPos.y);
      if (dx > 5 || dy > 5) return; // 真正的拖拽选区，不弹窗
    }
    const ann = this.annotationStore.get(annId);
    if (ann) {
      // 第二级对象态判定：纯高亮（无批注内容）走「改样式/色 + 删除」浮层，
      // 批注（带内容）走「查看卡片」。两端共用 classifyAnnotation，口径一致。
      const kind = classifyAnnotation(ann);
      this.showInlineAnnotationPopover(span, ann, kind);
      // 同步联动：打开侧边栏批注面板并精确定位+高亮对应条目
      // （用户阅读时点批注词 → 一键看到这条在所有批注中的位置）
      this.focusAnnotationCardInDock(annId);
      return;
    }
    // 批注已被删除等异常情况
    this.closeInlineAnnotationPopover();
  };

  /**
   * 在侧边栏批注面板中精准定位并高亮指定 ID 的卡片（2026-08-14 新增）。
   *  1. 若侧边栏折叠则自动展开；
   *  2. 切换到「批注」Tab 并重新渲染；
   *  3. 滚动到对应卡片并短暂闪烁背景，提示用户「这条就在这里」。
   * 在文档中点中高亮批注词时调用，形成「点词 → 看到批注卡」的双向闭环。
   */
  private focusAnnotationCardInDock(annId: string): void {
    if (!annId) return;
    // 1) 展开承载批注的 Dock（如果折叠）
    this.focusFeatureDock("annotations");
    // 2) 取批注承载的 Dock 元素（组合栏 / 独立 Dock）
    const dockEl = this.getFeatureElement("annotations");
    if (!dockEl) return;
    // 若批注仍在组合栏且当前非激活，切到批注 Tab
    const annTab = dockEl.querySelector('.hiword-dock-tab[data-tab="annotations"]') as HTMLElement | null;
    if (annTab && !annTab.classList.contains("active")) {
      annTab.click(); // 复用现有 tab 切换逻辑（会触发 renderAnnotationsPanel）
    } else if (!annTab) {
      // 独立 Dock：确保已渲染
      this.renderAnnotationsPanel(dockEl);
    }
    // 3) 滚动 + 高亮目标条目（卡片或笔记化条目）
    // 下一帧等 DOM 完成
    requestAnimationFrame(() => {
      const card = dockEl.querySelector(
        `.whale-card[data-id="${CSS.escape(annId)}"], .whale-notes-item[data-id="${CSS.escape(annId)}"]`
      ) as HTMLElement | null;
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      // 触发高亮动画（CSS 中定义 --flash，2s 后自动消失）
      card.classList.remove("whale-card--flash", "whale-notes-item--flash"); // 重置以便重复触发
      void card.offsetWidth; // 强制 reflow
      card.classList.add("whale-card--flash", "whale-notes-item--flash");
      setTimeout(() => card.classList.remove("whale-card--flash", "whale-notes-item--flash"), 2200);
    });
  }

  /**
   * 编辑区平滑滚动到内联标注文字位置（侧边栏卡片"定位"按钮使用）。
   * 找到 .hiword-ann-inline[data-ann-id] span → scrollIntoView 居中 → 闪烁高亮。
   */
  /** 解析批注标签 id → {name, color}（供阅读器查看气泡展示标签名/色） */
  resolveAnnotationLabel(id: string): { name: string; color: string } | null {
    try {
      const l = this.annotationLabelStore?.get(id);
      return l ? { name: l.name, color: l.color } : null;
    } catch {
      return null;
    }
  }

  private scrollEditorToAnnotation(annId: string): void {
    if (!annId) return;
    // 延迟一帧确保 DOM 已渲染（侧边栏操作后编辑器可能需要重绘）
    requestAnimationFrame(() => {
      const span = document.querySelector(
        `.hiword-ann-inline[data-ann-id="${CSS.escape(annId)}"]`
      ) as HTMLElement | null;
      if (!span) {
        // 找不到标注 span（可能不在当前文档/未渲染），回退到块级定位
        const ann = this.annotationStore.get(annId);
        if (ann?.blockId) this.openAnnotationBlock(ann.blockId);
        return;
      }
      // 平滑滚动到视口居中
      span.scrollIntoView({ behavior: "smooth", block: "center" });
      // 高亮闪烁（复用 --active 样式 + 自定义闪烁）
      span.classList.remove("hiword-ann-inline--active");
      void span.offsetWidth; // 强制 reflow
      span.classList.add("hiword-ann-inline--active");
      setTimeout(() => span.classList.remove("hiword-ann-inline--active"), 2000);
    });
  }

  /**
   * 2026-08-29：阅读器深链（摘录回跳原书）。
   * 思源点击 `siyuan://plugins/siyuan-plugin-rewordreader?data={"bookId":"…","cfi":"…"}`
   * 时会把 open-siyuan-url-plugin 事件派发给同名插件（官方事件总线，见 siyuan CHANGELOG 0.8.0）。
   * 这里解析出 bookId + cfi → 打开/聚焦该书阅读 Tab → goTo 定位到摘录处，
   * 与 weave 的「双向溯源」等价。非本书链接（缺 bookId）直接忽略，不打扰其它插件逻辑。
   */
  private onOpenBookUrl = (e: { url?: string }): void => {
    const url = String(e?.url ?? "");
    if (!url) return;
    let bookId = "";
    let cfi = "";
    try {
      const qIdx = url.indexOf("?");
      const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "");
      const raw = params.get("data");
      if (raw) {
        // data 可能是 JSON 字符串，也可能是思源内核已解析后的对象字符串
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        bookId = String(parsed?.bookId ?? "");
        cfi = String(parsed?.cfi ?? "");
      }
      // 兼容手写 / 未来格式：?bookId=…&cfi=…
      if (!bookId) bookId = String(params.get("bookId") ?? "");
      if (!cfi) cfi = String(params.get("cfi") ?? "");
    } catch (err) {
      logSwallow(err, "index.ts · onOpenBookUrl", "warn");
      return;
    }
    if (!bookId) return;
    void this.jumpToReading(bookId, cfi);
  };

  /** C 跳转定位：侧边栏阅读批注 → 打开/聚焦阅读 Tab 并跳转到对应 cfi 弹查看气泡 */
  private async jumpToReading(bookId: string, cfi: string): Promise<void> {
    try {
      await this.readerDock?.tabController?.focusAnnotation(bookId, cfi);
    } catch (e) {
      getLogger().warn("[REword] 跳转到阅读批注失败", { data: { bookId, cfi }, error: e });
      showMessage("跳转到阅读批注失败", 2000, "error" as any);
    }
  }

  private closeInlineAnnotationPopover(): void {
    if (this.popNotePreview) {
      try { this.popNotePreview.destroy(); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · closeInlineAnnotationPopover", "debug"); }
      this.popNotePreview = null;
    }
    if (this.inlinePopoverEl) {
      this.inlinePopoverEl.remove();
      this.inlinePopoverEl = null;
    }
    document
      .querySelectorAll(".hiword-ann-inline--active")
      .forEach((el) => el.classList.remove("hiword-ann-inline--active"));
  }

  /** 弹出内联批注浮层
   * @param kind 第二级对象态：pure=纯高亮（无批注内容），annotation=带批注内容。
   *   纯高亮 → 提供「改样式/色 + 升级批注 + 删除」；批注 → 只读查看卡（编辑/面板/复制/删除）。 */
  private showInlineAnnotationPopover(
    span: HTMLElement,
    ann: AnnotationItem,
    kind?: "pure" | "annotation" | null
  ): void {
    this.closeInlineAnnotationPopover();
    const isPure = kind === "pure";

    const styleIcon: Record<string, string> = {
      solid: "━", wavy: "﹏", dashed: "┄", double: "═", dotted: "┉",
    };
    const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const color = ann.color || "#06b6d4";
    const timeStr = ann.updatedAt || ann.createdAt || "";
    const dateStr = timeStr ? timeStr.slice(5, 16).replace("T", " ") : "";
    const sel = (ann.selectedText || "").trim();
    const sentence = (ann.sentence || "").trim();
    const sourceText = stripIal(sel || sentence);
    const noteFallback = ann.note ? this.renderNoteFlex(ann.note) : "";
    // 标签 chips（id → name/color，依赖 annotationLabelStore）
    const labelNameMap: Record<string, string> = {};
    const labelColorMap: Record<string, string> = {};
    for (const l of this.annotationLabelStore?.getAll() || []) {
      labelNameMap[l.id] = l.name;
      labelColorMap[l.id] = l.color;
    }
    const tagChips = (ann.labels || [])
      .map((id) => {
        const name = labelNameMap[id] || id;
        const c = labelColorMap[id] || "#9ca3af";
        return `<span class="hiword-ann-pop-tag" style="--tag-color:${c}">#${esc(name)}</span>`;
      })
      .join("");

    // ── 纯高亮专用：3 样式 + 5 色快捷行（即时改样式/色，等同阅读器编辑工具栏）──
    const STYLE_LIST: Array<{ key: AnnotationStyle; icon: string; label: string }> = [
      { key: "highlight", icon: "▮", label: "高亮" },
      { key: "solid", icon: "━", label: "直线段" },
      { key: "wavy", icon: "﹏", label: "波浪线" },
    ];
    const curStyle = (ann.style as AnnotationStyle) || "highlight";
    const curColor = ann.color || "#06b6d4";
    const styleRowHtml = isPure
      ? `<div class="hiword-ann-pop-stylerow" data-role="style-row">${STYLE_LIST.map(
          (s) =>
            `<button class="hiword-ann-pop-style-btn${s.key === curStyle ? " active" : ""}" data-style="${s.key}" title="${s.label}">${s.icon}</button>`
        ).join("")}</div>`
      : "";
    const colorRowHtml = isPure
      ? `<div class="hiword-ann-pop-stylerow hiword-ann-color-picker" data-role="color-row">${WHALE_COLORS.map(
          (c) =>
            `<button class="hiword-ann-color-swatch${c.value === curColor ? " active" : ""}" data-color="${c.value}" style="background:${c.value}; color:${c.value}" title="${c.name}"></button>`
        ).join("")}</div>`
      : "";

    const pop = document.createElement("div");
    pop.className = "hiword-ann-popover";
    pop.innerHTML = `
      <div class="hiword-ann-pop-head">
        <span class="hiword-ann-pop-dot" style="background:${color}"></span>
        <span class="hiword-ann-pop-style" style="color:${color}" title="标注样式">${styleIcon[ann.style || "solid"] || "━"}</span>
        <span class="hiword-ann-pop-time">${dateStr}</span>
        <button class="hiword-ann-pop-close" title="关闭">✕</button>
      </div>
      ${sourceText ? `<div class="hiword-ann-pop-sentence" data-act="locate-editor" title="点击定位到原文">${esc(sourceText)}</div>` : ""}
      ${
        isPure
          ? `${sourceText ? `<div class="hiword-ann-pop-sentence" data-act="locate-editor" title="点击定位到原文">${esc(sourceText)}</div>` : ""}
             <div class="hiword-ann-pop-note hiword-ann-pop-pure-hint">纯标注 · 无文字内容，可改样式/色或升级为批注</div>${styleRowHtml}${colorRowHtml}`
          : `<div class="hiword-ann-pop-note b3-typography">${
              ann.note
                ? `<div class="hiword-ann-pop-protyle"></div><div class="hiword-ann-pop-fallback">${noteFallback}</div>`
                : (sourceText ? "" : '<span class="hiword-ann-pop-empty">纯标注 · 无文字内容</span>')
            }</div>${tagChips ? `<div class="hiword-ann-pop-tags">${tagChips}</div>` : ""}`
      }
      <div class="hiword-ann-pop-actions">
        ${
          isPure
            ? `<button class="hiword-ann-pop-btn" data-act="upgrade" title="添加批注内容，升级为批注">批注</button>
               <button class="hiword-ann-pop-btn hiword-ann-pop-btn--danger" data-act="delete">删除</button>`
            : `<button class="hiword-ann-pop-btn" data-act="edit">编辑</button>
               <button class="hiword-ann-pop-btn" data-act="locate" title="在侧边栏批注面板中查看">面板</button>
               <button class="hiword-ann-pop-btn" data-act="copy" title="复制原文">复制</button>
               <button class="hiword-ann-pop-btn hiword-ann-pop-btn--danger" data-act="delete">删除</button>`
        }
      </div>
    `;
    document.body.appendChild(pop);
    this.inlinePopoverEl = pop;

    // 定位（优先不被视口裁切）；抽成可重入函数，挂载原生预览后高度变化需二次调用
    const place = () => {
      const r = span.getBoundingClientRect();
      const pw = pop.offsetWidth || 320;
      const ph = pop.offsetHeight || 160;
      let top = r.bottom + 8;
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 8);
      let left = Math.min(r.left, window.innerWidth - pw - 8);
      left = Math.max(8, left);
      pop.style.top = `${top}px`;
      pop.style.left = `${left}px`;
    };
    place();

    // 高亮当前 span
    span.classList.add("hiword-ann-inline--active");

    // 原生 lite Protyle 只读预览（单实例，随浮层销毁）
    const popHost = pop.querySelector(".hiword-ann-pop-protyle") as HTMLElement | null;
    const popApp = (window as any).siyuan?.ws?.app;
    if (ann.note && popHost && popApp) {
      this.popNotePreview = mountAnnEditor(popHost, {
        app: popApp,
        initial: ann.note,
        readonly: true,
        toolbar: [],
        onReady: (ok) => {
          if (ok) {
            pop.classList.add("hiword-ann-pop--live");   // 隐藏静态兜底
            place();                                      // 高度变了 → 重定位，防被视口裁切
          }
        },
      });
      // 块引用点击：capture 阶段拦截，转定位（浮层不在注册表内，单独处理）
      popHost.addEventListener("click", (e: MouseEvent) => {
        const t = (e.target as HTMLElement)?.closest?.('[data-type~="block-ref"]') as HTMLElement | null;
        if (!t) return;
        e.preventDefault();
        e.stopPropagation();
        const id = t.getAttribute("data-id");
        if (id) { this.closeInlineAnnotationPopover(); this.openAnnotationBlock(id); }
      }, true);
    }

    // 关闭
    pop.querySelector(".hiword-ann-pop-close")?.addEventListener("click", () => this.closeInlineAnnotationPopover());
    pop.addEventListener("mousedown", (ev) => ev.stopPropagation());

    // 操作
    // ── 纯高亮分支：快捷改样式/色 + 升级为批注 + 删除 ──
    if (isPure) {
      const applyStyle = async (style: AnnotationStyle) => {
        const scope = style === "highlight" ? "word" : "sentence";
        await this.annotationStore.upsert({ ...ann, id: ann.id, style, scope, type: "highlight" });
        this.applyAnnotationBlockMarks();
        pop.querySelectorAll<HTMLElement>("[data-style]").forEach((b) =>
          b.classList.toggle("active", b.dataset.style === style)
        );
      };
      const applyColor = async (color: string) => {
        await this.annotationStore.upsert({ ...ann, id: ann.id, color });
        this.applyAnnotationBlockMarks();
        pop.querySelectorAll<HTMLElement>(".hiword-ann-color-swatch").forEach((b) =>
          b.classList.toggle("active", b.dataset.color === color)
        );
      };
      pop.querySelector('[data-role="style-row"]')?.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-style]");
        if (btn?.dataset.style) void applyStyle(btn.dataset.style as AnnotationStyle);
      });
      pop.querySelector('[data-role="color-row"]')?.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-color]");
        if (btn?.dataset.color) void applyColor(btn.dataset.color);
      });
      pop.querySelector('[data-act="upgrade"]')?.addEventListener("click", () => {
        this.closeInlineAnnotationPopover();
        this.whaleManager?.showWhaleDialog({
          selectedText: ann.selectedText, sentence: ann.sentence,
          blockId: ann.blockId, docId: ann.docId, existing: ann,
        });
      });
      pop.querySelector('[data-act="locate-editor"]')?.addEventListener("click", () => {
        this.closeInlineAnnotationPopover();
        this.scrollEditorToAnnotation(ann.id);
      });
      pop.querySelector('[data-act="delete"]')?.addEventListener("click", async () => {
        const ok = await confirmDelete("确定删除这条标注？");
        if (!ok) return;
        this.closeInlineAnnotationPopover();
        try {
          await this.deleteAnnotation(ann.id, this.dockElement ?? document.body);
        } catch (e: any) {
          getLogger().error("[REword] 浮层删除批注异常", { data: { id: ann.id }, error: e });
          showMessage(`删除失败：${e?.message || e}`, 3000, "error");
        }
      });
      return;
    }

    // ── 批注分支（带内容）：编辑 / 面板 / 复制 / 删除 ──
    pop.querySelector('[data-act="edit"]')?.addEventListener("click", () => {
      this.closeInlineAnnotationPopover();
      this.whaleManager?.showWhaleDialog({
        selectedText: ann.selectedText, sentence: ann.sentence,
        blockId: ann.blockId, docId: ann.docId, existing: ann,
      });
    });
    pop.querySelector('[data-act="locate"]')?.addEventListener("click", () => {
      this.closeInlineAnnotationPopover();
      // 定位到右侧侧边栏对应批注卡片（滚动 + 高亮）
      this.focusAnnotationCardInDock(ann.id);
    });
    pop.querySelector('[data-act="locate-editor"]')?.addEventListener("click", () => {
      this.closeInlineAnnotationPopover();
      // 在编辑器内重新居中高亮原标注词
      this.scrollEditorToAnnotation(ann.id);
    });
    pop.querySelector('[data-act="copy"]')?.addEventListener("click", () => {
      const text = sourceText;
      if (!text) return;
      const done = () => showMessage("已复制原文", 1600, "info" as any);
      try {
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
        } else {
          fallbackCopy(text, done);
        }
      } catch {
        fallbackCopy(text, done);
      }
    });
    pop.querySelector('[data-act="delete"]')?.addEventListener("click", async () => {
      const ok = await confirmDelete("确定删除这条批注？");
      if (!ok) return;
      this.closeInlineAnnotationPopover();
      try {
        await this.deleteAnnotation(ann.id, this.dockElement ?? document.body);
      } catch (e: any) {
        getLogger().error("[REword] 浮层删除批注异常", { data: { id: ann.id }, error: e });
        showMessage(`删除失败：${e?.message || e}`, 3000, "error");
      }
    });

    // 本地复制兜底（clipboard 不可用时用隐藏 textarea + execCommand）
    const fallbackCopy = (text: string, cb?: () => void) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        cb?.();
      } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · fallbackCopy", "warn"); }
    };
  }

  /** 显示词库列表对话框 */
  private showVocabDialog() {
    if (!this.isReady) {
      showMessage("RE word 尚未就绪", 3000, "error");
      return;
    }

    const words = this.vocabStore.getAllWords();
    const books = this.vocabStore.getBooks().filter((b) => b.id !== ALL_BOOK_ID);

    const dialog = new Dialog({
      title: `RE word 词库（共 ${words.length} 词）`,
      width: responsiveDialogSize(760, "width"),
      height: "560px",
      content: `
        <div class="hiword-vocab-dialog">
          <div class="hiword-vocab-toolbar">
            <select class="b3-select" id="hiword-filter-book">
              <option value="">全部单词本</option>
              ${books.map((b) => `<option value="${b.id}">${this.escapeHtml(b.name)}</option>`).join("")}
            </select>
            <input class="b3-text-field" id="hiword-search" placeholder="搜索单词..." />
            <select class="b3-select" id="hiword-filter-status">
              <option value="">全部状态</option>
              <option value="active">活跃</option>
              <option value="archived">已归档</option>
              <option value="ignored">忽略</option>
            </select>
            <select class="b3-select" id="hiword-filter-mastery">
              <option value="">全部星级</option>
              <option value="0">0★ 新词</option>
              <option value="1">1★</option>
              <option value="2">2★</option>
              <option value="3">3★</option>
              <option value="4">4★</option>
              <option value="5">5★ 已掌握</option>
            </select>
            <button class="b3-button b3-button--outline" id="hiword-export">导出 CSV</button>
            <button class="b3-button b3-button--outline hiword-dialog-batchdel-btn" id="hiword-batchdel-dialog" title="勾选多个单词卡后批量删除">🗑 批量删除</button>
          </div>
          <div class="hiword-vocab-list" id="hiword-list">
            ${this.renderWordList(words, false)}
          </div>
          <div class="hiword-dialog-batchdel-bar" id="hiword-dialog-batchdel-bar" style="display:none;">
            <span class="hiword-dialog-batchdel-count" id="hiword-dialog-batchdel-count">已选 0</span>
            <button class="b3-button b3-button--small b3-button--outline" id="hiword-batchdel-all">全选</button>
            <button class="b3-button b3-button--small hiword-dialog-batchdel-ok" id="hiword-batchdel-ok">删除选中</button>
            <button class="b3-button b3-button--small" id="hiword-batchdel-cancel">退出</button>
          </div>
        </div>
      `,
    });

    // 绑定事件
    this.bindDialogEvents(dialog, words);
  }

  /** 清洗脏音标：只保留首个 /…/ 之间的 IPA，丢弃词典原文碎片（2026-08-27 对话框优化） */
  private cleanPhonetic(raw: string): string {
    if (!raw) return "";
    const m = raw.match(/\/([^/]+)\//);
    if (m) return "/" + m[1] + "/";
    const trimmed = raw.replace(/\s+/g, " ").trim();
    return trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : trimmed;
  }

  /** 渲染单词列表 HTML（对话框用，5 星掌握度；withSelect 进入批量删除多选态） */
  private renderWordList(words: WordRecord[], withSelect = false): string {
    if (words.length === 0) {
      return `<div class="hiword-empty">词库为空，查词时点 ★ 即可收藏</div>`;
    }

    return words
      .map(
        (w) => `
        <div class="hiword-word-item ${withSelect ? "hiword-word-item--select" : ""}" data-word="${this.escapeAttr(w.word)}" data-id="${w.id}">
          ${withSelect ? `<label class="hiword-word-sel"><input type="checkbox" class="hiword-word-check" data-word="${this.escapeAttr(w.word)}"></label>` : ""}
          <div class="hiword-word-main">
            <span class="hiword-word-text">${this.escapeHtml(w.word)}</span>
            ${w.pos ? `<span class="hiword-pos">${this.escapeHtml(w.pos)}</span>` : ""}
            ${w.phonetic ? `<span class="hiword-phonetic" title="${this.escapeAttr(this.cleanPhonetic(w.phonetic))}">${this.escapeHtml(this.cleanPhonetic(w.phonetic))}</span>` : ""}
            ${w.meaning ? `<span class="hiword-meaning">${this.escapeHtml(w.meaning)}</span>` : ""}
          </div>
          <div class="hiword-word-meta">
            ${this.renderMasteryStars(w.word, w.mastery)}
            <span class="hiword-status hiword-status-${w.status}">${w.status}</span>
            <button class="b3-button b3-button--small" data-action="tts" data-word="${this.escapeAttr(w.word)}">朗读</button>
            <button class="b3-button b3-button--small" data-action="remove" data-word="${this.escapeAttr(w.word)}">移除</button>
          </div>
        </div>`
      )
      .join("");
  }

  /** 绑定对话框事件（含 2026-08-27 从内嵌面板迁移来的批量删除） */
  private bindDialogEvents(dialog: Dialog, allWords: WordRecord[]) {
    const element = dialog.element;

    const searchInput = element.querySelector("#hiword-search") as HTMLInputElement;
    const bookFilter = element.querySelector("#hiword-filter-book") as HTMLSelectElement;
    const statusFilter = element.querySelector("#hiword-filter-status") as HTMLSelectElement;
    const masteryFilter = element.querySelector("#hiword-filter-mastery") as HTMLSelectElement;
    const listContainer = element.querySelector("#hiword-list");
    const batchBar = element.querySelector("#hiword-dialog-batchdel-bar") as HTMLElement | null;
    const batchDelBtn = element.querySelector("#hiword-batchdel-dialog") as HTMLButtonElement | null;
    const batchAllBtn = element.querySelector("#hiword-batchdel-all") as HTMLButtonElement | null;
    const batchOkBtn = element.querySelector("#hiword-batchdel-ok") as HTMLButtonElement | null;
    const batchCancelBtn = element.querySelector("#hiword-batchdel-cancel") as HTMLButtonElement | null;
    const batchCountEl = element.querySelector("#hiword-dialog-batchdel-count") as HTMLElement | null;

    let dialogBatchMode = false;

    const getFiltered = (): WordRecord[] => {
      const q = searchInput.value.toLowerCase().trim();
      const bf = bookFilter.value;
      const sf = statusFilter.value;
      const mf = masteryFilter.value;

      let list = this.vocabStore.getAllWords();
      if (bf) {
        const book = this.vocabStore.getBook(bf);
        const ids = new Set<string>();
        book?.themes.forEach((t) => t.words.forEach((w) => ids.add(w.id)));
        list = list.filter((w) => ids.has(w.id));
      }
      return list.filter((w) => {
        if (q && !w.word.includes(q) && !(w.meaning && w.meaning.includes(q))) return false;
        if (sf && w.status !== sf) return false;
        if (mf && String(w.mastery) !== mf) return false;
        return true;
      });
    };

    const renderList = () => {
      if (listContainer) listContainer.innerHTML = this.renderWordList(getFiltered(), dialogBatchMode);
    };

    const applyFilter = () => { renderList(); };

    searchInput.addEventListener("input", applyFilter);
    bookFilter.addEventListener("change", applyFilter);
    statusFilter.addEventListener("change", applyFilter);
    masteryFilter.addEventListener("change", applyFilter);

    // 列表项事件委托
    listContainer?.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action;
      const word = target.dataset.word;

      if (action === "tts" && word) {
        this.speak(word);
      } else if (action === "mastery" && word) {
        const cur = this.vocabStore.findRecord(word)?.mastery ?? 0;
        const lvl = Number(target.dataset.level);
        const next = cur === lvl ? 0 : lvl;
        await this.vocabStore.updateMastery(word, next);
        renderList();
      } else if (action === "remove" && word) {
        await this.vocabStore.removeWord(word);
        showMessage("已移除", 2000, "info");
        renderList();
      }
    });

    // ===== 批量删除（2026-08-27 从内嵌面板迁移到对话框）=====
    const updateBatchCount = () => {
      const checks = listContainer ? Array.from(listContainer.querySelectorAll<HTMLInputElement>(".hiword-word-check")) : [];
      const total = checks.length;
      const sel = checks.filter((c) => c.checked).length;
      if (batchCountEl) batchCountEl.textContent = `已选 ${sel} / ${total}`;
      if (batchOkBtn) batchOkBtn.disabled = sel === 0;
    };
    const bindChecks = () => {
      listContainer?.querySelectorAll<HTMLInputElement>(".hiword-word-check").forEach((c) => {
        c.addEventListener("change", updateBatchCount);
      });
      updateBatchCount();
    };
    batchDelBtn?.addEventListener("click", () => {
      dialogBatchMode = !dialogBatchMode;
      renderList();
      if (batchBar) batchBar.style.display = dialogBatchMode ? "flex" : "none";
      batchDelBtn.classList.toggle("b3-button--primary", dialogBatchMode);
      if (dialogBatchMode) bindChecks();
      else if (batchAllBtn) batchAllBtn.textContent = "全选";
    });
    batchAllBtn?.addEventListener("click", () => {
      const checks = listContainer ? Array.from(listContainer.querySelectorAll<HTMLInputElement>(".hiword-word-check")) : [];
      const allOn = checks.length > 0 && checks.every((c) => c.checked);
      checks.forEach((c) => (c.checked = !allOn));
      if (batchAllBtn) batchAllBtn.textContent = allOn ? "全选" : "全不选";
      updateBatchCount();
    });
    batchOkBtn?.addEventListener("click", async () => {
      const words = listContainer
        ? Array.from(listContainer.querySelectorAll<HTMLInputElement>(".hiword-word-check:checked")).map((c) => c.dataset.word || "").filter(Boolean)
        : [];
      if (words.length === 0) return;
      const ok = await confirmDelete(`确定删除选中的 ${words.length} 个单词？\n此操作不可撤销。`);
      if (!ok) return;
      let done = 0;
      for (const w of words) {
        try { await this.vocabStore.removeWord(w); done++; } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · try { await this.vocabStore.removeWord(w); done++; }", "debug"); }
      }
      dialogBatchMode = false;
      if (batchBar) batchBar.style.display = "none";
      batchDelBtn?.classList.remove("b3-button--primary");
      if (batchAllBtn) batchAllBtn.textContent = "全选";
      renderList();
      showMessage(`已删除 ${done} 个单词`, 2500, "success" as any);
    });
    batchCancelBtn?.addEventListener("click", () => {
      dialogBatchMode = false;
      if (batchBar) batchBar.style.display = "none";
      batchDelBtn?.classList.remove("b3-button--primary");
      if (batchAllBtn) batchAllBtn.textContent = "全选";
      renderList();
    });

    // 导出按钮
    element.querySelector("#hiword-export")?.addEventListener("click", () => {
      this.exportVocabCSV();
    });
  }

  /** TTS 朗读：依据引擎设置选择离线优先 / 在线优先 / 单模式 */
  private speak(word: string) {
    const w = (word || "").trim();
    if (!w) return;
    const cfg = this.ttsSettings || DEFAULT_TTS;
    const accent = cfg.accent || "us";

    if (cfg.engine === "system") {
      this.speakSystem(w, cfg);
      return;
    }
    if (cfg.engine === "youdao" || cfg.engine === "edge") {
      // 查词发音场景：有道/Edge 退化用有道真人音（单字/单词质量优于机械音）
      this.speakOnline(w, accent);
      return;
    }

    // auto（默认）：在线优先，失败回退系统语音
    this.speakOnline(w, accent).then((ok) => {
      if (!ok) this.speakSystem(w, cfg);
    });
  }

  /** 在线真人发音（有道 dictvoice，质量明显优于系统机械音）。accent: us=美音(type=2) / uk=英音(type=1) */
  private speakOnline(word: string, accent: "uk" | "us" = "us"): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const audio = new Audio();
        const type = accent === "uk" ? 1 : 2;
        audio.src = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}&le=en`;
        audio.onended = () => resolve(true);
        audio.onerror = () => resolve(false);
        const p = audio.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => resolve(false));
        }
      } catch {
        resolve(false);
      }
    });
  }

  /** 系统语音合成：自动优选最佳英文 voice。返回是否成功触发朗读 */
  private speakSystem(word: string, cfg: TtsSettings): boolean {
    if (!("speechSynthesis" in window)) {
      return false;
    }
    const synth = window.speechSynthesis;
    // 优先用预热缓存的列表；首读为空时再回退到实时 getVoices（兼容 Chrome 异步加载）
    const voices = (synth.getVoices() || []).length
      ? synth.getVoices()
      : this._sysVoices;
    if (!voices || !voices.length) {
      // 系统无可用语音，交由在线兜底
      return false;
    }
    // 取消上一条，避免排队堆积
    try { synth.cancel(); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · speakSystem", "debug"); }

    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    u.rate = cfg.rate || 0.9;
    u.pitch = cfg.pitch || 1;

    const voice = this.pickBestVoice(cfg.preferVoiceURI);
    if (voice) u.voice = voice;

    try {
      synth.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  // ==================== 列表朗读（顺序播放词库单词） ====================

  /** 获取当前面板可见的单词列表（考虑搜索过滤） */
  private getCurrentVocabWords(): string[] {
    const listEl = this.dockElement?.querySelector("#hiword-vb-list");
    if (!listEl) return [];
    const rows = listEl.querySelectorAll(".hiword-vb-row[data-word]");
    return Array.from(rows).map((r) => (r as HTMLElement).dataset.word || "").filter(Boolean);
  }

  /** 开始/继续列表朗读 */
  private startListReading(words: string[], dockElement: HTMLElement): void {
    this.stopListReading(); // 先停掉旧的
    this._listReadWords = words;
    this._listReadIndex = 0;
    this._listReading = true;
    this._listPaused = false;
    this._listReadAbort = new AbortController();

    this.updateListReadUI(dockElement);
    this.speakNextInList(dockElement);
  }

  /** 暂停/继续切换 */
  private toggleListReadPause(): void {
    if (!this._listReading) return;
    this._listPaused = !this._listPaused;
    const dockEl = this.dockElement;
    if (dockEl) this.updateListReadUI(dockEl);
    if (!this._listPaused && dockEl) {
      // 从暂停恢复 → 继续读下一个
      this.speakNextInList(dockEl);
    }
  }

  /** 停止列表朗读 */
  private stopListReading(): void {
    this._listReading = false;
    this._listPaused = false;
    this._listReadIndex = 0;
    this._listReadWords = [];
    if (this._listReadTimer) { clearTimeout(this._listReadTimer); this._listReadTimer = null; }
    if (this._listReadAbort) { this._listReadAbort.abort(); this._listReadAbort = null; }
    try { window.speechSynthesis?.cancel(); } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · stopListReading", "debug"); }
    // 清除高亮
    this.dockElement?.querySelectorAll(".hiword-vb-row.reading").forEach((el) => el.classList.remove("reading"));
    const dockEl = this.dockElement;
    if (dockEl) this.updateListReadUI(dockEl);
  }

  /** 朗读列表中的下一个单词 */
  private speakNextInList(dockElement: HTMLElement): void {
    if (!this._listReading || this._listPaused) return;
    if (this._listReadIndex >= this._listReadWords.length) {
      // 读完了
      this.stopListReading();
      showMessage("列表朗读完成", 2000, "success" as any);
      return;
    }

    const word = this._listReadWords[this._listReadIndex];
    const total = this._listReadWords.length;

    // 高亮当前行
    dockElement.querySelectorAll(".hiword-vb-row.reading").forEach((el) => el.classList.remove("reading"));
    const rows = dockElement.querySelectorAll(".hiword-vb-row[data-word]");
    const targetRow = Array.from(rows).find(
      (r) => (r as HTMLElement).dataset.word === word
    ) as HTMLElement | undefined;
    targetRow?.classList.add("reading");
    targetRow?.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // 更新进度
    const progEl = dockElement.querySelector("#hiword-vb-readprog") as HTMLElement;
    if (progEl) progEl.textContent = `${this._listReadIndex + 1}/${total}`;

    // 朗读当前词
    this.speak(word);

    // 等待朗读结束 + 间隔后读下一个
    const interval = this.ttsSettings?.interval ?? 800;
    // 用 speechSynthesis 的 onend 来检测朗读完成不太可靠（在线音频更难），改用估算时长
    const estimatedDuration = Math.max(400, word.length * 120 / (this.ttsSettings?.rate ?? 0.9));
    const delay = estimatedDuration + interval;

    this._listReadTimer = setTimeout(() => {
      if (this._listReadAbort?.signal.aborted) return;
      this._listReadIndex++;
      this.speakNextInList(dockElement);
    }, delay);
  }

  /** 更新列表朗读按钮 UI 状态 */
  private updateListReadUI(dockElement: HTMLElement): void {
    const readAllBtn = dockElement.querySelector("#hiword-vb-readall") as HTMLButtonElement;
    const readStopBtn = dockElement.querySelector("#hiword-vb-readstop") as HTMLButtonElement;
    const readProg = dockElement.querySelector("#hiword-vb-readprog") as HTMLElement;

    if (this._listReading) {
      if (readAllBtn) { readAllBtn.style.display = ""; readAllBtn.textContent = this._listPaused ? "▶ 继续" : "⏸ 暂停"; }
      if (readStopBtn) readStopBtn.style.display = "";
      if (readProg) readProg.style.display = "";
    } else {
      if (readAllBtn) { readAllBtn.style.display = ""; readAllBtn.textContent = "▶ 朗读列表"; }
      if (readStopBtn) readStopBtn.style.display = "none";
      if (readProg) { readProg.style.display = ""; readProg.textContent = ""; }
    }
  }

  /** 预热并缓存系统语音列表（修复 Chrome 下 speechSynthesis.getVoices() 首次返回空数组的问题） */
  private warmupSystemVoices() {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const load = () => {
      this._sysVoices = synth.getVoices() || [];
    };
    load(); // 立即尝试（Safari/Firefox 同步可用）
    // Chrome 异步：voiceschanged 触发后才有完整列表
    try { synth.onvoiceschanged = load; } catch (__swallowErr) { logSwallow(__swallowErr, "index.ts · load", "debug"); }
  }

  /** 从可用 voice 中挑选最佳英文发音（优先用户指定 > 神经网络/Google/Microsoft/Samantha） */
  private pickBestVoice(preferURI?: string): SpeechSynthesisVoice | null {
    if (!("speechSynthesis" in window)) return null;
    const voices = (window.speechSynthesis.getVoices() || []).length
      ? window.speechSynthesis.getVoices()
      : this._sysVoices;
    if (!voices || !voices.length) return null;

    if (preferURI) {
      const f = voices.find((v) => v.voiceURI === preferURI);
      if (f) return f;
    }

    const en = voices.filter(
      (v) => /^en(-|_)/i.test(v.lang) || /english/i.test(v.name)
    );
    const pool = en.length ? en : voices;
    if (!pool.length) return null;

    const rank = (v: SpeechSynthesisVoice): number => {
      const n = (v.name + " " + (v.voiceURI || "")).toLowerCase();
      if (n.includes("premium") || n.includes("neural") || n.includes("natural")) return 100;
      if (n.includes("google")) return 92;
      if (n.includes("microsoft") || n.includes("aria") || n.includes("zira")) return 88;
      if (n.includes("samantha")) return 82;
      if (n.includes("alex")) return 78;
      if (n.includes("karen") || n.includes("daniel") || n.includes("arthur")) return 80;
      return 50;
    };
    return pool.slice().sort((a, b) => rank(b) - rank(a))[0];
  }


  /**
   * 导出批注为 Markdown 文件（2026-08-17 修复 footer「导出」死按钮）。
   * 沿用 exportVocabCSV 的 Blob 下载机制。
   */
  private exportAnnotationsMD() {
    const items = this.annotationStore.getAll();
    if (items.length === 0) {
      showMessage("批注为空", 2000, "info" as any);
      return;
    }
    const labelNameMap: Record<string, string> = {};
    for (const l of this.annotationLabelStore.getAll()) {
      labelNameMap[l.id] = l.name;
    }
    const md = buildAnnotationsMarkdown(items, labelNameMap, new Date());
    downloadTextFile(md, `reword-annotations-${new Date().toISOString().slice(0, 10)}.md`, "text/markdown");
    showMessage(`已导出 ${items.length} 条批注`, 2000, "success" as any);
  }

  /** 导出词库为 CSV */
  private exportVocabCSV() {
    const words = this.vocabStore.getAllWords();
    if (words.length === 0) {
      showMessage("词库为空", 2000, "info");
      return;
    }
    const csv = buildVocabCsv(words);
    downloadTextFile(csv, "reword-vocabulary.csv", "text/csv");
    showMessage(`已导出 ${words.length} 个单词`, 2000, "success" as any);
  }
}

/** 拖拽时计算插入位置（返回应插入到其前面的元素） */
function getDragAfterElement(container: HTMLElement, y: number): HTMLElement | null {
  const els = Array.from(container.querySelectorAll<HTMLElement>(".hiword-vb-row:not(.dragging)"));
  let closest: { offset: number; element: HTMLElement | null } = { offset: -Infinity, element: null };
  for (const child of els) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }
  return closest.element;
}
