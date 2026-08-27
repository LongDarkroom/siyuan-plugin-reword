/**
 * REword · AI 精读 dock 面板
 * ------------------------------------------------------------------
 * 面板交互编排（不耦合 SiYuan SDK 细节）。插件在 index.ts 中实现 AiHost 接口，
 * 提供「读取当前块/选区」「收藏单词」「句子批注」等能力，面板只负责 UI 与事件。
 *
 * v2: 支持拖拽文本块入面板 + 对话消息保留思源富文本样式（kramdown 子集）
 */

import type { AiSettings } from "./ai-settings.ts";
import {
  prepareDeepReadInput,
  runAiDeepRead,
  runAiChat,
  type DeepReadResult,
  type DeepReadInput,
  type DeepReadWord,
  type DeepReadSentence,
} from "./ai-orchestrator.ts";
import type { AiMessage } from "../copilot/ai/ai-client.ts";
import { requestAIGenerate, estimateTokens } from "../copilot/ai/ai-client.ts";
import { renderDeepReadHtml, renderWithLute } from "./ai-render.ts";
import { enhanceSiYuanRender } from "./ai-enhance.ts";
import { createStreamThrottle } from "./stream-throttle.ts";
import { trimChatHistory, type ChatTurn } from "./chat-trim.ts";
import { sessionStore } from "./ai-session-store.ts";
import type { AnnotationQuery, AnnotationQueryResult } from "../annotation/annotation-query.ts";
import { formatAnnotationsForAi } from "../annotation/annotation-query.ts";
import { renderAnnotationHTML } from "../annotation/whale-renderer.ts";
import { Disposables } from "../core/disposable.ts";
import { renderMarkdown, escapeHtml } from "../core/markdown.ts";
import { getLogger } from "../core/logger.ts";
import type { AiPreset } from "./ai-preset.ts";
import type { AiPromptTemplate } from "./ai-prompt-templates.ts";
import type { AiDocSearchResult } from "./ai-doc-search.ts";
import type { VocabStore } from "../vocab/vocab-store.ts";
import { confirmDelete } from "../annotation/whale-confirm.ts";
import { Protyle, Lute, type App, showMessage } from "siyuan";
import {
  renderModelMenu,
  renderPromptPanel,
  renderPresetPanel,
  renderPresetListView,
  renderDocSearchDialog,
  renderDocSearchItems,
  renderMessageToolbar,
  renderSaveToNoteDialog,
  renderSaveToNoteTree,
  type SaveToNoteDialogData,
} from "./ai-dialogs.ts";

/** 精读数据源（由插件从当前块/选区/本地文档取得） */
export interface AiDeepReadSource {
  title?: string;
  text: string;
  blockId?: string;
  docId?: string;
}

/** 宿主（index.ts 实现，桥接插件能力） */
export interface AiHost {
  /** 思源 App 实例（用于实例化共享 Lute 引擎的原生 Protyle 输入框） */
  app: App;
  getAiSettings(): AiSettings;
  /** 获取词库存储实例（AI 精读词库自动闭环用） */
  getVocabStore(): VocabStore;
  /** 在词典面板中查询某词（右键菜单「查词」用） */
  lookupWordInDict(word: string): void;
  /** 读取当前块 / 选区的精读原文（无则返回 null；无选区但有焦点块时 text 为空，需 fetchBlockText 补全） */
  /** 打开 AI 设置独立对话框 */
  openAiSettings(): void;
  getDeepReadSource(): AiDeepReadSource | null;
  /** 异步读取整块正文（kramdown），用于「读取当前块」且无选区时补全文本 */
  fetchBlockText(blockId: string): Promise<string | null>;
  /** 读取块类型（如 p 段落 / l,i 列表 / h 标题 / c 代码 / quote 引用），用于拖入卡片图标区分；失败返回 null */
  fetchBlockType(blockId: string): Promise<string | null>;
  /** 读取整篇文档正文（拼装 markdown，截断 12k）。用于页签/文档树拖入 */
  fetchDocText(docId: string): Promise<string | null>;
  /** 从拖拽事件中解析块 ID（可能返回 null 表示非块拖拽） */
  resolveDragBlockId(e: DragEvent): string | null;
  /** 从拖拽事件中解析文档 ID（识别思源页签 / 文档树节点），返回 docId 或 null */
  resolveDragDocId(e: DragEvent): string | null;
  /** 从 HTML 片段（text/html）中按文档顺序解析所有思源块 ID（data-node-id），去重返回 */
  resolveBlockIdsFromHtml(html: string): string[];
  /** 拖拽回退：无法识别块 ID 时提取纯文本（dragstart 记录的选中文本） */
  resolveDragFallbackText(e: DragEvent): string | null;
  /** 收藏单词到词库（支持 DeepReadWord / 逐词目标本 / 例句+标签关联） */
  collectWord(
    word: string | DeepReadWord,
    bookId?: string,
    themeId?: string,
    opts?: { example?: string; markUnmastered?: boolean; inheritThemeTags?: boolean }
  ): Promise<{ added: boolean }>;
  /** 将标签名列表解析为标签 id 列表（不存在则新建） */
  resolveLabelNames(names: string[]): string[];
  /** 把句子加入批注（落批注数据层并打标记） */
  annotateSentence(sentence: string, blockId?: string, note?: string, color?: string, style?: string, tags?: string[]): Promise<void>;
  /**
   * 打开微阅风格批注弹窗（截图 1：头部 5 线型 Aa + 富文本编辑区 +
   * 底部 3 功能按钮/保存）。供 AI 面板「插入批注」使用，与工具栏入口统一。
   */
  openAnnotationDialog(opts: {
    blockId?: string;
    docId?: string;
    sentence: string;
    selectedText: string;
    existing?: import("../annotation/annotation-store.ts").AnnotationItem;
  }): void;
  /**
   * 把 AI 面板选中文本送入词库提取流程：自动识别英文/中文单词 → 复用词库同款
   * 「提取单词到词库」对话框（选择 L1 单词本 + L2 子类后批量入库）。
   * 与 addVocabForAiMessage/setMessage 等 AI 内置批量加入语义不同，这里专给选区交互使用。
   */
  openVocabExtractDialog(text: string): void;
  /** 复制文本到剪贴板 */
  copyText(text: string): void;
  /**
   * 将 Markdown 内容保存为思源笔记文档。
   * @returns 新建文档 ID
   */
  saveToNote(opts: {
    markdown: string;
    notebookId: string;
    path: string;
    title: string;
    openAfterSave: boolean;
  }): Promise<string>;
  /** 列出所有笔记本（用于保存到笔记对话框） */
  listNotebooks(): Promise<{ id: string; name: string }[]>;
  /** 列出某笔记本/目录下的文档树（用于保存到笔记对话框） */
  listDocTree(notebookId: string, path: string): Promise<{ id: string; name: string; path: string; children?: any[] }[]>;
  /**
   * 查询批注（本地过滤 + 可选 SQL 联查）。
   * 返回匹配的批注列表及统计信息。
   */
  queryAnnotations(query?: AnnotationQuery): Promise<AnnotationQueryResult>;
  /**
   * 获取所有被批注过的文档 ID 列表（用于查询面板的文档筛选下拉框）
   */
  getAnnotatedDocIds(): Promise<string[]>;

  /** 切换当前模型并持久化（header 模型下拉） */
  setModel(model: string): Promise<void>;
  /** 搜索文档（标题+路径模糊匹配；空关键词返回最近更新的文档列表） */
  searchDocs(keyword: string): Promise<AiDocSearchResult[]>;
  /** 读取文档正文（用于添加上下文） */
  getDocText(docId: string): Promise<string>;
  /** 提示词模板 CRUD */
  listPromptTemplates(): AiPromptTemplate[];
  savePromptTemplate(tpl: AiPromptTemplate): Promise<void>;
  deletePromptTemplate(id: string): Promise<void>;
  /** 预设 CRUD */
  listPresets(): AiPreset[];
  getActivePreset(): AiPreset | undefined;
  savePreset(p: AiPreset): Promise<void>;
  deletePreset(id: string): Promise<void>;
  setActivePreset(id: string): Promise<void>;
  /** 获取词库目标（单词本/主题两级，供批量入库下拉） */
  getVocabTargets(): {
    books: { id: string; name: string; themes: { id: string; name: string }[] }[];
  };
  /** 批量入库单词（含音标/词性/释义） */
  collectWords(
    words: DeepReadWord[],
    bookId?: string,
    themeId?: string
  ): Promise<{ added: number; skipped: number }>;
  /** 批量写入句子批注（note = 结构 + 译文），返回成功数 */
  annotateSentences(
    sents: DeepReadSentence[],
    blockId?: string,
    opts?: { category?: string; labels?: string[]; fillNote?: boolean }
  ): Promise<number>;
}

export class AiPanel {
  private disposables = new Disposables();
  /** 当前激活预设（其 systemPrompt / temperature 覆盖本次精读） */
  private activePreset?: AiPreset;
  /** 会话累计 token 用量（面板生命周期内累加，用于圆环 tooltip） */
  private sessionUsage: { prompt: number; completion: number } = { prompt: 0, completion: 0 };
  /** 当前输入框文本的估算 token 数 */
  private inputTokenEstimate = 0;
  /** 对话模式多轮上下文（仅 chat 模式累加；学习模式不写入） */
  private chatHistory: AiMessage[] = [];
  /** 当前会话 id（对话模式上下文挂载到该会话，落盘到 hiword-ai-sessions.json） */
  private currentSessionId?: string;
  /** AI 输入框容器：挂载共享 Lute 引擎的轻量 Protyle 实例（#hiword-ai-protyle） */
  private inputEl: HTMLElement | null = null;
  /** 共享 SiYuan Lute 引擎的原生 Protyle 输入框实例（lite 模式）；为 null 时回退 contenteditable */
  private protyle: Protyle | null = null;
  /** Protyle 延迟挂载重试计数（等待元素进入布局且有尺寸） */
  private mountAttempts = 0;
  /** 待填充内容：Protyle 延迟挂载完成后再写入（避免被 Protyle 挂载重建 DOM 冲掉） */
  private pendingPrefill: string | null = null;
  /** 面板根容器（render 时持有引用，供 applyAiFontSize 等外部调用实时刷新） */
  private contentEl: HTMLElement | null = null;
  /** 监听 wysiwyg DOM 变化以刷新 empty 态（防止程序化写入遗留 --empty 导致占位符残留） */
  private emptyObserver: MutationObserver | null = null;
  /** AI 生成中标记：true 时发送按钮切换为「停止生成」 */
  private aiBusy = false;
  /** 进入生成态的时间戳，用于 aiBusy 卡死自愈（避免提示词加载等场景下按钮无反应） */
  private _busySince: number | null = null;
  /** 当前可中止的 AI 请求（用户点「停止」时 abort） */
  private aiAbort: AbortController | null = null;
  /** 2026-08-27：发送按钮引用，供 sendText() 复用同一条发送链路（避免重复实现流式逻辑） */
  private runBtnEl: HTMLButtonElement | null = null;
  /** 流式 thinking 实时显示容器（生成期间挂载在 loadingMsg 内，完成后移除） */
  private liveThinkingEl: HTMLElement | null = null;
  /** 流式 thinking 累积文本（用于最终替换为 <details> 面板） */
  private liveThinkingText = "";
  /** 通用浮层容器引用 */
  private overlay: HTMLElement | null = null;
  /** 通用浮层打开函数（在 render 中初始化） */
  private openOverlay: ((html: string) => void) | null = null;
  /** 最近一次 AI 结果消息渲染后的展示 HTML（落盘到会话，重载时 1:1 还原，避免裸显原始 JSON/markdown） */
  private lastResultHtml: string | null = null;
  /** 块引用正文缓存（按 blockId）：同一会话内多次展开同一块时避免重复 fetchBlockText（P3-1） */
  private blockTextCache = new Map<string, string>();
  /** 2026-08-21 A 任务 v2：文档占位卡拉取的整篇正文缓存（会话内复用,避免多次发送重复拉取） */
  private docTextCache = new Map<string, string>();
  /** 原始 markdown 按消息索引存储（替代 data-raw-md DOM 属性，降低 innerHTML 解析负担，P3-2） */
  private rawMdByIndex = new Map<number, string>();
  /** 最近一次 getInputValue 序列化时从 DOM 缓存的块引用 id → 锚文本（供 cleanForAi 还原占位符给 UI 用） */
  private lastDomRefs = new Map<string, string>();
  /** 拖入块时通过内核 API（fetchBlockText）预取的完整 kramdown 正文：id → 正文。
   *  发送时 AI 路径直接从这里拿块正文替换占位符，不依赖 Lute 序列化块引用，避免 anchor 中 { / 数字. 等字符导致截断 */
  private refKramdownById = new Map<string, string>();
  constructor(private host: AiHost) {}

  render(dockElement: HTMLElement): void {
    // 构建版本标记：用于在 DevTools 确认当前加载的是否为最新构建产物
    try {
      (window as any).__REWORD_BUILD_INFO__ = {
        buildTime: "2026-08-21T07:58:00+08:00",
        features: ["refKramdownById-prefetch", "expandPlaceholdersAsync", "lute-primary-html-markdown-fallback", "ui-bubble-placeholder-restore", "fetchBlockText-md-sql", "user-msg-light-bg", "blockRef-regex-unclosed", "user-msg-render-cleanText"],
        expandBlockRefs: true,
        fetchBlockTextFallback: true,
      };
    } catch { /* ignore */ }

    const contentEl = dockElement.querySelector("#hiword-dock-content") as HTMLElement;
    if (!contentEl) return;
    this.contentEl = contentEl;

    // 2026-08-26 修复：不再在 render() 中自动把选区文本预填进输入框。
    // 旧逻辑无论用户是否已输入，每次切回 AI 精读（重渲染）都会把「先前选中文本」灌入输入框，
    // 覆盖已输入内容。预填改为仅在显式动作（⌥⌘A 命令 / 右键「发送到 AI」）经 prefillSelection() 触发。
    contentEl.innerHTML = `
      <div class="hiword-ai-panel">
        <!-- 顶部工具栏 -->
        <div class="hiword-ai-header">
          <div class="hiword-ai-header-left">
            <button class="hiword-ai-btn" id="hiword-ai-read" title="读取当前块/选区">
              <span class="hiword-ai-btn-icon">📄</span>
              <span>读取</span>
            </button>
            <button class="hiword-ai-btn hiword-ai-btn--primary" id="hiword-ai-run" title="AI 精读">
              <span class="hiword-ai-btn-icon">✨</span>
              <span>AI 精读</span>
            </button>
            <button class="hiword-ai-btn hiword-ai-btn--ghost" id="hiword-ai-query" title="查询我的批注">
              <span class="hiword-ai-btn-icon">🔍</span>
              <span>查询批注</span>
            </button>
          </div>
          <div class="hiword-ai-header-right">
            <div class="hiword-ai-model-wrap">
              <button class="hiword-ai-btn hiword-ai-btn--ghost hiword-ai-model-btn" id="hiword-ai-model-btn" title="切换模型">
                <span class="hiword-ai-model-current">${escapeHtml(this.host.getAiSettings().model)}</span>
                <span class="hiword-ai-model-caret">▾</span>
              </button>
              <div class="hiword-ai-model-menu" id="hiword-ai-model-menu" style="display:none;"></div>
            </div>
            <button class="hiword-ai-btn hiword-ai-btn--ghost" id="hiword-ai-new-session" title="新建会话">＋</button>
            <button class="hiword-ai-btn hiword-ai-btn--ghost" id="hiword-ai-sessions" title="会话历史">💬</button>
            <button class="hiword-ai-btn hiword-ai-btn--ghost" id="hiword-ai-copyall" title="复制全文">复制</button>
            <button class="hiword-ai-btn hiword-ai-btn--ghost" id="hiword-ai-settings" title="AI 设置">⚙</button>
          </div>
        </div>

        <!-- 中间内容区（可滚动） -->
        <div class="hiword-ai-body" id="hiword-ai-body">
          <!-- 空态欢迎 -->
          <div class="hiword-ai-welcome" id="hiword-ai-welcome">
            <div class="hiword-ai-welcome-bubble">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M40 32H36V24C36 16.268 29.732 10 22 10C14.268 10 8 16.268 8 24V32H4C2.89543 32 2 32.8954 2 34V42C2 43.1046 2.89543 44 4 44H44C45.1046 44 46 43.1046 46 42V34C46 32.8954 45.1046 32 44 32H40ZM12 24C12 18.4772 16.4772 14 22 14C27.5228 14 32 18.4772 32 24V32H12V24ZM22 38C23.1046 38 24 37.1046 24 36C24 34.8954 23.1046 34 22 34C20.8954 34 20 34.8954 20 36C20 37.1046 20.8954 38 22 38Z" fill="currentColor" opacity="0.35"/>
              </svg>
            </div>
            <p class="hiword-ai-welcome-text">开始与 AI 对话吧！</p>
            <p class="hiword-ai-welcome-hint">在文档中选中英文文字 → 点「读取」或「AI 精读」即可分析；也可直接粘贴</p>
          </div>
          <!-- 对话消息区（动态填充） -->
          <div class="hiword-ai-messages" id="hiword-ai-messages"></div>
        </div>

        <!-- 批注查询侧滑面板（默认隐藏） -->
        <div class="hiword-ai-query-panel" id="hiword-ai-query-panel">
          <div class="hiword-ai-query-header">
            <span class="hiword-ai-query-title">🔍 查询批注</span>
            <button class="hiword-ai-query-close" id="hiword-ai-query-close" title="关闭">✕</button>
          </div>
          <div class="hiword-ai-query-filters">
            <input class="hiword-ai-qf-input" id="hiword-ai-q-keyword" placeholder="关键词搜索（句子 / 选中文字 / 批注内容）" />
            <div class="hiword-ai-qf-row">
              <select class="hiword-ai-qf-select" id="hiword-ai-q-color">
                <option value="">全部颜色</option>
              </select>
              <select class="hiword-ai-qf-select" id="hiword-ai-q-doc">
                <option value="">全部文档</option>
              </select>
              <select class="hiword-ai-qf-select" id="hiword-ai-q-origin">
                <option value="">全部来源</option>
                <option value="manual">手动</option>
                <option value="ai">AI 生成</option>
              </select>
            </div>
            <div class="hiword-ai-qf-row">
              <input class="hiword-ai-qf-input hiword-ai-qf-small" id="hiword-ai-q-from" type="date" placeholder="起始日期" />
              <input class="hiword-ai-qf-input hiword-ai-qf-small" id="hiword-ai-q-to" type="date" placeholder="截止日期" />
              <button class="hiword-ai-btn hiword-ai-btn--primary hiword-ai-qf-btn" id="hiword-ai-q-run" title="执行查询">查询</button>
            </div>
          </div>
          <div class="hiword-ai-query-status" id="hiword-ai-query-status"></div>
          <div class="hiword-ai-query-results" id="hiword-ai-query-results">
            <div class="hiword-ai-query-empty">设置筛选条件后点击「查询」</div>
          </div>
          <div class="hiword-ai-query-actions" id="hiword-ai-query-actions" style="display:none;">
            <button class="hiword-ai-btn hiword-ai-btn--primary" id="hiword-ai-q-send" title="发送给 AI 讲解">发送给 AI 讲解</button>
            <span class="hiword-ai-q-count" id="hiword-ai-q-count"></span>
          </div>
        </div>

        <!-- 2026-08-22 改：resizer 升级为 chevron 按钮(可点击+可拖拽) -->
        <div class="hiword-ai-resizer" id="hiword-ai-resizer" data-tooltip="点击收起输入区 / 拖动调整高度">
          <button class="hiword-ai-resizer-toggle" id="hiword-ai-resizer-toggle" aria-label="收起输入区" type="button">▾</button>
          <span class="hiword-ai-resizer-grip"></span>
        </div>

        <!-- 底部输入区（2026-08-22 改：工具栏上移到 footer 顶部,与输入框贴紧,消除中间大块空白） -->
        <div class="hiword-ai-footer" id="hiword-ai-footer">
          <div class="hiword-ai-toolbar" id="hiword-ai-toolbar">
            <!-- 左组：内容来源 -->
            <button class="hiword-ai-tool-btn" id="hiword-ai-upload" title="上传文件（支持文本类）">
              <svg class="hiword-ai-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 16V4"/>
                <path d="M7 9l5-5 5 5"/>
                <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>
              </svg>
              <span class="hiword-ai-tool-label">上传</span>
            </button>
            <button class="hiword-ai-tool-btn" id="hiword-ai-docsearch" title="添加上下文 / 搜索文档">
              <svg class="hiword-ai-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="7"/>
                <path d="M21 21l-4.3-4.3"/>
              </svg>
              <span class="hiword-ai-tool-label">添加上下文</span>
            </button>
            <span class="hiword-ai-toolbar-divider"></span>
            <!-- 右组：提示词 / 配置 -->
            <button class="hiword-ai-tool-btn" id="hiword-ai-templates" title="提示词模板：插入到输入框，不改 AI 角色">
              <svg class="hiword-ai-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="3" width="16" height="18" rx="2"/>
                <path d="M8 8h8"/>
                <path d="M8 12h8"/>
                <path d="M8 16h5"/>
              </svg>
              <span class="hiword-ai-tool-label">模板</span>
            </button>
            <button class="hiword-ai-tool-btn" id="hiword-ai-presets" title="预设：切换 AI 角色/温度（点击管理）">
              <svg class="hiword-ai-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3.2"/>
                <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M4.9 4.9l2.1 2.1M16.9 16.9l2.1 2.1M19.1 4.9l-2.1 2.1M7.1 16.9l-2.1 2.1"/>
              </svg>
              <span class="hiword-ai-tool-label">预设</span>
              <span class="hiword-ai-tool-sub" id="hiword-ai-preset-name"></span>
            </button>
            <span class="hiword-ai-toolbar-spacer"></span>
            <div class="hiword-ai-status" id="hiword-ai-status"></div>
          </div>
          <div class="hiword-ai-input-row">
            <div class="hiword-ai-protyle" id="hiword-ai-protyle" spellcheck="false"></div>
            <div class="hiword-ai-send-wrap">
              <button class="hiword-ai-token-ring" id="hiword-ai-token-ring" title="Token 用量" aria-label="Token 用量">
                <svg class="hiword-ai-token-ring__svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle class="hiword-ai-token-ring__track" cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.2" opacity="0.25"/>
                  <circle class="hiword-ai-token-ring__progress" cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" transform="rotate(-90 12 12)" stroke-dasharray="62.83" stroke-dashoffset="62.83"/>
                </svg>
                <span class="hiword-ai-token-ring__text">0</span>
              </button>
              <button class="hiword-ai-send" id="hiword-ai-send" title="发送精读" aria-label="发送">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 10L18 2L10 18L8 11L2 10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // 重渲染前先销毁旧 Protyle，避免遗留观察器在 detached 元素上触发 getBoundingClientRect 崩溃
    this.destroyInput();
    // 清理上一次渲染遗留的会话弹窗 / token 弹窗 DOM（挂载在 body 上，不会随 contentEl.innerHTML 被清掉）
    {
      const oldModal = document.querySelector(".hiword-ai-session-modal");
      if (oldModal) oldModal.remove();
      const oldTokenModal = document.querySelector(".hiword-ai-token-modal-host");
      if (oldTokenModal) oldTokenModal.remove();
    }

    this.bind(contentEl);
    this.mountProtyle(contentEl);
    // Protyle 延迟挂载：预填内容等挂载完成后再写入，避免被挂载重建的 DOM 冲掉
    this.pendingPrefill = null; // 2026-08-26：显式复位，预填仅在 prefillSelection() 显式触发
    // 应用 AI 消息字体大小设置（CSS 变量驱动，随设置实时生效）
    this.applyAiFontSize();
    // 自动恢复上次活跃会话（有消息的会话才恢复，避免空会话干扰新用户）
    this.restoreLastSession();
  }

  /** 数字格式化：千/k、百万/M */
  private formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  }

  /** 估算当前输入框文本 token 数 */
  private estimateInputTokens(): number {
    return estimateTokens(this.getInputValue());
  }

  /** 刷新 token 圆环：中心数字 + 进度条（以上下文窗口为上限） */
  private renderTokenRing(): void {
    const contentEl = this.contentEl;
    if (!contentEl) return;
    const tokenRingText = contentEl.querySelector(".hiword-ai-token-ring__text") as HTMLElement | null;
    const tokenRingProgress = contentEl.querySelector(".hiword-ai-token-ring__progress") as SVGCircleElement | null;
    if (!tokenRingText) return;
    const total = this.sessionUsage.prompt + this.sessionUsage.completion + this.inputTokenEstimate;
    tokenRingText.textContent = total ? this.formatTokens(total) : "0";
    const settings = this.host.getAiSettings();
    // 2026-08-21 精简：contextWindow 已删除,改用 inferContextWindow 自动推断
    const max = settings.maxTokens || 0;
    if (tokenRingProgress && max > 0) {
      const ratio = Math.min(1, Math.max(0, total / max));
      const circumference = 62.83; // 2 * PI * 10
      tokenRingProgress.style.strokeDashoffset = String(circumference * (1 - ratio));
      tokenRingProgress.style.opacity = ratio > 0.9 ? "1" : ratio > 0.7 ? "0.85" : "0.65";
    }
  }

  /** 渲染「上下文用量」弹窗 HTML */
  private renderTokenModal(): string {
    const settings = this.host.getAiSettings();
    const model = settings.model || "—";
    // 2026-08-21 精简：contextWindow 已删除,改用 inferContextWindow 自动推断
    const limit = settings.maxTokens || 0;
    const prompt = this.sessionUsage.prompt;
    const completion = this.sessionUsage.completion;
    const sessionTotal = prompt + completion;
    const inputEst = this.inputTokenEstimate;
    const total = sessionTotal + inputEst;
    const pct = limit > 0 ? Math.min(99.9, Math.max(0, (total / limit) * 100)).toFixed(1) : "0.0";
    const fmt = (n: number) => n.toLocaleString("zh-CN");
    return `
      <div class="hiword-ai-token-modal">
        <div class="hiword-ai-token-modal-header">
          <span class="hiword-ai-token-modal-title">上下文用量</span>
          <button class="hiword-ai-token-modal-close" data-act="close-modal" aria-label="关闭">✕</button>
        </div>
        <div class="hiword-ai-token-modal-body">
          <div class="hiword-ai-token-modal-model">${escapeHtml(model)}</div>
          <div class="hiword-ai-token-modal-main">${fmt(total)} / ${limit ? fmt(limit) : "∞"} tokens (${pct}%)</div>
          <div class="hiword-ai-token-modal-divider"></div>
          <div class="hiword-ai-token-modal-row"><span>输入 tokens</span><b>${fmt(prompt)}</b></div>
          <div class="hiword-ai-token-modal-row"><span>输出 tokens</span><b>${fmt(completion)}</b></div>
          <div class="hiword-ai-token-modal-row"><span>输入框估算</span><b>${fmt(inputEst)}</b></div>
          <div class="hiword-ai-token-modal-row hiword-ai-token-modal-row-total"><span>会话合计</span><b>${fmt(sessionTotal)}</b></div>
          <div class="hiword-ai-token-modal-note">* 用量为估算值，包含当前输入框文本</div>
        </div>
      </div>`;
  }

  /** 将 AI 设置中的字体大小写入面板根容器 CSS 变量，AI 输出区 / 输入区统一读取该变量 */
  applyAiFontSize(): void {
    const contentEl = this.contentEl;
    if (!contentEl) return;
    const s = this.host.getAiSettings();
    const msgPx = Math.max(10, Math.min(24, Math.round(s.fontSize || 14)));
    const inputPx = Math.max(10, Math.min(24, Math.round(s.inputFontSize || 13)));
    contentEl.style.setProperty("--hiword-ai-font-size", `${msgPx}px`);
    contentEl.style.setProperty("--hiword-ai-input-font-size", `${inputPx}px`);
  }

  /** 卸载 Protyle 输入框（重渲染 / 面板销毁时调用，必须彻底清理观察器） */
  private destroyInput(): void {
    try { this.emptyObserver?.disconnect(); } catch { /* ignore */ }
    this.emptyObserver = null;
    try { this.protyle?.destroy(); } catch { /* ignore */ }
    // 无论 destroy 是否异常，强制移除容器内残留的 Protyle DOM——
    // 思源内核在该 DOM 上绑定的 dragover/click 监听器随元素移除失效，
    // 避免「contentElement=null 的失效实例」在拖拽/点击时触发 getBoundingClientRect 崩溃
    try { this.inputEl?.querySelector(".protyle")?.remove(); } catch { /* ignore */ }
    this.protyle = null;
    this.mountAttempts = 0;
    this.pendingPrefill = null;
    this.inputEl = null;
  }

  /**
   * 挂载「共享 SiYuan Lute 引擎」的轻量 Protyle 作为 AI 输入框。
   * 同引擎下，从思源复制/拖出的原生块 HTML 粘贴进本输入框后 DOM 结构与 CSS class 一致，
   * 加粗 / 代码 / 颜色 / 链接等富文本格式由 Protyle 原生管线零转换保留。
   * 若元素尚未进入布局（零尺寸/未挂载）则延迟重试；构造失败则回退 contenteditable。
   */
  private mountProtyle(contentEl: HTMLElement): void {
    const inputEl = contentEl.querySelector("#hiword-ai-protyle") as HTMLElement | null;
    if (!inputEl) { getLogger().warn("[REword] mountProtyle 失败: #hiword-ai-protyle 不存在"); return; }
    this.inputEl = inputEl;

    // 延迟挂载：等待元素进入布局且具备尺寸，避免 lite Protyle 在 detached/零尺寸容器上崩溃
    const attempt = () => {
      if (!this.inputEl || this.protyle) return;
      const el = this.inputEl;
      if (!el.isConnected || el.getBoundingClientRect().height < 2) {
        if (this.mountAttempts++ < 60) {
          requestAnimationFrame(attempt);
        } else {
          getLogger().error("Protyle 容器长时间未就绪，回退 contenteditable", { operation: "挂载AI输入框" });
          this.fallbackToContentEditable();
        }
        return;
      }
      try {
        // 挂载前清理容器内可能残留的旧 Protyle DOM（半成品/失效实例），避免重复挂载
        el.querySelector(".protyle")?.remove();
        this.protyle = new Protyle(this.host.app, el, {
          lite: true,
          blockId: "",
          render: { background: false, title: false, breadcrumb: false, gutter: false, scroll: false },
          hint: { extend: [] },
          toolbar: [],
        });
        this.mountAttempts = 0;
        // lite Protyle 不会自动插入初始块，wysiwyg 始终为空——
        // protyle.insert() 会因找不到 blockElement 而在 insertHTML 中静默 return，导致拖块不显示。
        // 此处显式写入最小 NodeParagraph 占位，确保后续 insert 始终能命中 fallback 锚点。
        const wysiwyg = this.protyle.protyle?.wysiwyg?.element;
        if (wysiwyg) {
          if (wysiwyg.childElementCount === 0) {
            wysiwyg.innerHTML =
              '<div data-reword-placeholder="1" data-node-id="placeholder" data-type="NodeParagraph">' +
              '<div contenteditable="true"><br></div></div>';
          }
          // 空态占位符：监听 wysiwyg 输入切换 --empty 类（忽略 REword 占位节点）
          const refreshEmpty = () => {
            let hasContent = false;
            for (const child of Array.from(wysiwyg.children)) {
              const c = child as HTMLElement;
              if (c.dataset?.rewordPlaceholder === "1") continue;
              if ((c.textContent || "").trim()) { hasContent = true; break; }
              if (c.querySelector("[data-type='block-ref']")) { hasContent = true; break; }
            }
            el.classList.toggle("hiword-ai-input--empty", !hasContent);
          };
          const refreshInputTokens = () => {
            this.inputTokenEstimate = this.estimateInputTokens();
            this.renderTokenRing();
          };
          wysiwyg.addEventListener("input", () => { refreshEmpty(); refreshInputTokens(); });
          // 双重保险：程序化写入（setInputMarkdown / insertBlockRef / 内核内部块创建）不会触发 input 事件，
          // 用 MutationObserver 兜底刷新 empty 态与 token 估算
          this.emptyObserver?.disconnect();
          this.emptyObserver = new MutationObserver(() => { refreshEmpty(); refreshInputTokens(); });
          this.emptyObserver.observe(wysiwyg, { childList: true, subtree: true, characterData: true });
          refreshEmpty();
          refreshInputTokens();
          // 光标落入占位段落，后续 insert 在此段落插入
          this.protyle.focus();
        }
        // 原生 Protyle 负责粘贴（零转换保样式）；拖放由我们接管文件/块，纯文本交原生
        // dragover 捕获阶段拦截：preventDefault 允许 drop，stopPropagation 阻止事件到达
        // 容器内思源内核 dragover 处理器（避免失效实例 contentElement=null 崩溃）
        el.addEventListener("dragover", (e: DragEvent) => {
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
          e.preventDefault();
          e.stopPropagation();
          el.classList.add("hiword-ai-protyle--dragover");
        }, true);
        el.addEventListener("dragleave", (e: Event) => {
          if (e.target === el) el.classList.remove("hiword-ai-protyle--dragover");
        });
        el.addEventListener("drop", (e: DragEvent) => { void this.handleDrop(e); }, true);
        // lite Protyle（blockId:""）原生粘贴不可靠，与 contenteditable 兜底一致地接管粘贴：
        // 思源块 → 块引用卡片；富文本 → 保样式；纯文本 → insertTextAtCaret
        el.addEventListener("paste", (e: ClipboardEvent) => { void this.handlePaste(e); }, true);
        el.addEventListener("click", (e: Event) => {
          const target = (e.target as HTMLElement).closest('[data-type="block-ref"]') as HTMLElement | null;
          if (target) {
            e.preventDefault();
            e.stopPropagation();
            const me = e as MouseEvent;
            // 命中卡片右侧 × 区域（padding-right 18px 预留）→ 删除该引用卡
            if (target.getBoundingClientRect().right - me.clientX <= 20) {
              target.remove();
              this.refreshInputEmptyState();
              return;
            }
            target.classList.toggle("hiword-ref--expanded");
          }
        }, true);
        // Protyle 挂载完成，写入延迟的预填内容
        if (this.pendingPrefill) { this.setInputMarkdown(this.pendingPrefill); this.pendingPrefill = null; }
      } catch (e) {
        getLogger().error("Protyle 实例化/初始化失败，回退 contenteditable", { operation: "挂载AI输入框", error: e as Error });
        // 失败路径：销毁可能已创建的部分实例并清空引用，残留 DOM 由 fallbackToContentEditable 统一清理
        try { this.protyle?.destroy(); } catch { /* ignore */ }
        this.protyle = null;
        this.fallbackToContentEditable();
      }
    };
    requestAnimationFrame(attempt);
  }

  /** Protyle 不可用时的兜底：contenteditable 完全自控（拖块/粘贴/文件接管） */
  private fallbackToContentEditable(): void {
    const inputEl = this.inputEl;
    if (!inputEl) return;
    // 先移除容器内残留的 Protyle DOM（失效实例的内核 dragover/click 监听器随之失效），
    // 再启用 contenteditable，杜绝双模式叠加
    try { inputEl.querySelector(".protyle")?.remove(); } catch { /* ignore */ }
    inputEl.setAttribute("contenteditable", "true");
    inputEl.classList.add("hiword-ai-input--empty");
    const refreshEmpty = () => {
      const empty = (inputEl.textContent?.trim() || "") === "" && !inputEl.querySelector("[data-type='block-ref']");
      inputEl.classList.toggle("hiword-ai-input--empty", empty);
    };
    const refreshInputTokens = () => {
      this.inputTokenEstimate = this.estimateInputTokens();
      this.renderTokenRing();
    };
    inputEl.addEventListener("input", () => { refreshEmpty(); refreshInputTokens(); });
    inputEl.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      inputEl.classList.add("hiword-ai-protyle--dragover");
    }, true);
    inputEl.addEventListener("dragleave", (e: Event) => {
      if (e.target === inputEl) inputEl.classList.remove("hiword-ai-protyle--dragover");
    });
    inputEl.addEventListener("drop", (e: DragEvent) => { void this.handleDrop(e); }, true);
    inputEl.addEventListener("paste", (e: ClipboardEvent) => { void this.handlePaste(e); }, true);
    inputEl.addEventListener("click", (e: Event) => {
      const target = (e.target as HTMLElement).closest('[data-type="block-ref"]') as HTMLElement | null;
      if (target) {
        e.stopPropagation();
        const me = e as MouseEvent;
        if (target.getBoundingClientRect().right - me.clientX <= 20) {
          target.remove();
          this.refreshInputEmptyState();
          return;
        }
        target.classList.toggle("hiword-ref--expanded");
      }
    }, true);
    // 兜底模式同样写入延迟的预填内容
    if (this.pendingPrefill) { this.setInputMarkdown(this.pendingPrefill); this.pendingPrefill = null; }
  }

  /** 拖放处理：文件/思源块 -> 我们接管插入；Protyle 模式下纯文本/外部富文本交给原生管线（零转换保样式） */
  private async handleDrop(e: DragEvent): Promise<void> {
    const inputEl = this.inputEl;
    if (inputEl) inputEl.classList.remove("hiword-ai-protyle--dragover");
    const logger = getLogger();
    const dt = e.dataTransfer;
    logger.info("拖块 drop 触发", { operation: "拖块插入", data: { types: dt ? [...dt.types] : [] } });

    // 1) 文件：读取文本类文件内容插入（原生 lite Protyle 不处理文件拖入）
    if (dt?.files?.length) {
      e.preventDefault();
      e.stopPropagation();
      const textFiles = Array.from(dt.files).filter((f) =>
        f.type.startsWith("text/") ||
        /\.(txt|md|markdown|json|csv|log|xml|yml|yaml|html?|js|ts|tsx|jsx|css|py|go|rs|c|cpp|h|hpp|java|sh|sql|toml|ini|cfg)$/i.test(f.name)
      );
      if (textFiles.length === 0) {
        const names = [...dt.files].map((f) => f.name).join("、");
        logger.warn("drop 包含不支持的文件类型（仅支持文本文件）", {
          operation: "拖块插入",
          data: { files: [...dt.files].map((f) => `${f.type} ${f.name}`) },
        });
        showMessage(`仅支持文本文件（txt/md/代码/json 等），已忽略：${names}`, 4000, "error");
        return;
      }
      for (const file of textFiles) {
        try {
          const c = await file.text();
          logger.info("拖入文本文件", { operation: "拖块插入", data: { name: file.name, len: c.length } });
          this.insertTextAtCaret(c);
        } catch (err) {
          logger.error("读取文本文件失败", { operation: "拖块插入", error: err, data: { name: file.name } });
        }
      }
      return;
    }

    // 2) 思源页签 / 文档树节点（2026-08-21 v2:插入占位卡,发送时再实时拉取）
    const docId = this.host.resolveDragDocId(e);
    if (docId && docId.length >= 14) {
      e.preventDefault();
      e.stopPropagation();
      try {
        await this.insertDocRef(docId);   // 异步：插入卡片 + 预取文档全文缓存
        logger.info("页签拖入占位成功", { operation: "页签拖入", data: { docId } });
      } catch (err) {
        logger.error("页签拖入失败", { operation: "页签拖入", error: err, data: { docId } });
      }
      return;
    }

    // 3) 思源块：优先 dragstart 记录，其次从 text/html 解析（跨窗口拖拽时 dragstart 不触发）
    let blockId = this.host.resolveDragBlockId(e);
    if (!blockId && dt) {
      const htmlData = dt.getData("text/html") || "";
      const ids = htmlData ? this.host.resolveBlockIdsFromHtml(htmlData) : [];
      if (ids.length) blockId = ids[0];
    }
    // 思源块 ID 格式：时间戳(14位数字)+随机字母数字串，如 202608131290w-8cx7o5g
    // 不限制字符集（ID 可能含 w/x/y/z 等非十六进制字母），仅校验长度与基本结构
    if (blockId && blockId.length >= 14) {
      e.preventDefault();
      e.stopPropagation();
      try {
        await this.insertBlockRef(blockId);
        logger.info("块引用插入成功", { operation: "拖块插入", data: { blockId } });
      } catch (err) {
        logger.error("块引用插入失败", { operation: "拖块插入", error: err, data: { blockId } });
      }
      return;
    }

    // 3) 纯文本 / 外部富文本
    if (this.protyle) {
      // Protyle 模式：交给原生管线处理（同引擎零转换，保留加粗 / 代码 / 颜色 / 链接等）
      return;
    }
    // 回退 contenteditable：自行插入
    e.preventDefault();
    e.stopPropagation();
    const fallbackText = this.host.resolveDragFallbackText(e);
    if (fallbackText) {
      logger.info("拖入文本(选中记录)", { operation: "拖块插入", data: { len: fallbackText.length } });
      this.insertTextAtCaret(fallbackText);
      return;
    }
    const plainText = dt?.getData("text/plain")?.trim() || "";
    if (plainText) {
      logger.info("拖入文本(plain)", { operation: "拖块插入", data: { len: plainText.length } });
      this.insertTextAtCaret(plainText);
      return;
    }
    try {
      const htmlData = dt?.getData("text/html")?.trim() || "";
      if (htmlData) {
        const doc = new DOMParser().parseFromString(htmlData, "text/html");
        const extracted = (doc.body.textContent || "").trim();
        if (extracted) {
          logger.info("拖入文本(html)", { operation: "拖块插入", data: { len: extracted.length } });
          this.insertTextAtCaret(extracted);
          return;
        }
      }
    } catch { /* ignore */ }
    logger.warn("drop 未提取到任何可插入内容", { operation: "拖块插入" });
  }

  /** 粘贴处理：思源块 -> 块引用卡片（保语义）；富文本 -> 保留样式；否则纯文本 */
  private async handlePaste(e: ClipboardEvent): Promise<void> {
    const cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    e.stopPropagation();
    const logger = getLogger();

    const html = cd.getData("text/html") || "";
    const blockIds = html ? this.host.resolveBlockIdsFromHtml(html) : [];
    if (blockIds.length) {
      logger.info("粘贴思源块引用", { operation: "粘贴", data: { count: blockIds.length } });
      for (const id of blockIds) await this.insertBlockRef(id);
      return;
    }

    const plain = cd.getData("text/plain")?.trim() || "";
    if (!plain && !html) {
      logger.warn("粘贴内容为空", { operation: "粘贴" });
      return;
    }
    // 富文本：保留样式直接插入，序列化时再转 Markdown（**加粗** 等语义保留给 AI）
    const styled = html && /<(strong|em|mark|b|i|code|del|s|span|h\d|li|ul|ol|a|br|p|div)/i.test(html);
    if (styled) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const bodyHtml = doc.body.innerHTML;
      if (bodyHtml && bodyHtml.trim()) {
        logger.info("粘贴富文本(保样式)", { operation: "粘贴", data: { len: bodyHtml.length } });
        this.insertHtmlAtCaret(bodyHtml);
        return;
      }
    }
    logger.info("粘贴文本", { operation: "粘贴", data: { len: plain.length } });
    this.insertTextAtCaret(plain);
  }

  /** 向输入框追加文本（按钮场景：先读后写，整体重建） */
  private appendInput(text: string): void {
    if (!text) return;
    // 预填充场景必须保留 block-ref 等思源原生语法，避免被展成占位符文本
    const current = this.getInputMarkdownForPrefill();
    const newMd = current ? current + "\n\n" + text : text;
    this.setInputMarkdown(newMd);
  }

  /**
   * 拖入/粘贴思源块 -> 插入原生块引用节点（data-type="block-ref"，同引擎渲染）。
   * 锚文本取自块正文；发送时由 getInputValue 反序列化为 ((id 'anchor')) 再展开为完整正文。
   *
   * 三重保障（应对思源 insertHTML 多处静默 return）：
   *   ① protyle.insert() 原生路径；
   *   ② 验证 block-ref 是否出现，未出现则直接 DOM 插入；
   *   ③ 强制刷新 --empty 态防占位符遮挡。
   */
  private async insertBlockRef(blockId: string): Promise<void> {
    const logger = getLogger();
    const kramdownBody = (await this.host.fetchBlockText(blockId)) || "";
    // ★ 缓存内核 API 返回的完整 kramdown 正文到 refKramdownById，
    //   发送时 AI 路径直接从这里拿正文替换占位符，避免 Lute 二次解析 block-ref 节点导致的 anchor 截断
    if (kramdownBody) this.refKramdownById.set(blockId, kramdownBody);
    // 块类型：用于卡片差异化图标/颜色（段落 ¶ / 列表 ☰ / 标题 H / 代码 </> / 引用 "）
    // 误取/失败时不加修饰类，退化为默认段落样式，不影响功能
    const blockType = (await this.host.fetchBlockType(blockId)) || "";
    const typeClass = blockType ? ` hiword-ai-block-ref--${blockType}` : "";
    // anchor 用作输入框折叠卡片显示（取正文前 6 字预览）
    const anchor = kramdownBody;
    // 容错：API 失败/为空时用块 ID 短后缀作为锚文本（思源会渲染为带 ID 提示的块引用卡片）
    const shortId = blockId.replace(/-/g, "").slice(-6);
    const fallbackAnchor = `块 ${shortId}`;
    if (!anchor) logger.debug("拉取块正文为空，使用 ID 短后缀兜底", { operation: "拖块插入", data: { blockId } });
    // 思源块正文可能带 HTML 样式标签（如 inline-memo），先提取纯文本、转义，再截断为 5-6 字预览
    const rawText = this.stripHtmlTags(anchor || fallbackAnchor).replace(/\n/g, " ").trim();
    const displayAnchor = rawText.slice(0, 6) + (rawText.length > 6 ? "…" : "");
    const safeAnchor = escapeHtml(displayAnchor || fallbackAnchor);
    const card = `<span data-type="block-ref" data-id="${blockId}" data-subtype="s" class="hiword-ai-block-ref${typeClass}" data-block-type="${escapeHtml(blockType)}">${safeAnchor}</span>`;
    logger.debug("插入块 " + blockId, { operation: "拖块插入", data: { blockId } });

    if (this.protyle) {
      const wysiwyg = this.protyle.protyle?.wysiwyg?.element;
      // ── 保障①：原生 protyle.insert() ──
      this.protyle.focus();
      let nativeOk = false;
      try {
        this.protyle.insert(card, false);
        nativeOk = true;
      } catch (e) {
        // 抛出异常视为原生路径失败
        logger.debug("protyle.insert() 抛出异常，走 DOM 兜底", { operation: "拖块插入", data: { blockId }, error: e });
      }

      if (nativeOk) {
        // ── 保障②：异步校验 ──
        // 列表块的块引用节点可能异步渲染，插入后立即同步查询会误判「未生效」，
        // 从而走 DOM 兜底导致块引用语义丢失（发送时 ((id)) 无法展开）。等待一帧后再校验；
        // 若页面处于后台导致 rAF 不触发，由 50ms 超时兜底，避免挂起。
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          requestAnimationFrame(() => finish());
          setTimeout(finish, 50);
        });
        const refAfterInsert = wysiwyg?.querySelector(`[data-type="block-ref"][data-id="${CSS.escape(blockId)}"]`);
        if (refAfterInsert) {
          logger.debug("块引用插入成功（原生路径）", { operation: "拖块插入", data: { blockId } });
        } else {
          // 原生路径静默失败（未插入节点）→ DOM 直插兜底（带去重保护）
          logger.debug("protyle.insert() 未生效，启用 DOM 直插兜底", { operation: "拖块插入", data: { blockId } });
          this.directInsertCard(card, wysiwyg, blockId);
        }
      } else {
        // 异常路径同样走 DOM 兜底（带去重保护）
        this.directInsertCard(card, wysiwyg, blockId);
      }

      // ── 保障③：强制刷新 empty 态（移除 --empty 防占位符伪元素遮挡内容）──
      this.refreshInputEmptyState();
      return;
    }
    // contenteditable 兜底模式
    this.insertHtmlAtCaret(card);
  }

  /**
   * A 任务 + 改进（2026-08-21 v3 原生 block-ref 化）：
   * 思源页签 / 文档树拖入 → 插入「原生 block-ref」卡片（data-subtype="s" 静态锚），
   * 锚文本用「📄 文档 XXXXXX」标识。
   *
   * 为什么改成原生 block-ref（取代旧版自定义 reword-doc-ref）：
   *   - 旧版 reword-doc-ref 是思源不认识的节点，Protyle 在每次 input 重渲染时
   *     会把 data-id / class / contenteditable 等自定义属性全部剥掉，
   *     导致「打几个字页签链接就消失」（已用 DevTools 截图确认：data-id 丢失）。
   *   - 原生 block-ref 走思源白名单，重渲染后 data-type/data-id/data-subtype 全部保留；
   *     data-subtype="s" 静态锚会保留我们手填的「📄 文档 XXXXXX」文本，绝不会回退成块正文。
   *   - data-type="block-ref" 与现有块引用同构，getInputValue / cleanForAi / expandBlockRefs
   *     都能识别；发送时由 expandDocRefs 按「📄 文档 」锚前缀识别为文档引用，
   *     调 host.fetchDocText 实时拉取全文，复用既有逻辑，且文档被改也能拿到最新版。
   */
  private async insertDocRef(docId: string): Promise<void> {
    const logger = getLogger();
    logger.info("页签/文档树拖入,插入文档引用卡片 docId=" + docId, { operation: "页签拖入" });

    const shortId = docId.replace(/-/g, "").slice(-6);
    // 静态锚（data-subtype="s"）：保留我们手填的「📄 文档 XXXXXX」，不随块正文变化
    const anchor = `📄 文档 ${shortId}`;
    // 属性值转义：防 XSS / 引号截断
    const safeId = docId.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const card =
      `<span data-type="block-ref" data-id="${safeId}" ` +
      `data-subtype="s" class="hiword-ai-doc-ref" data-doc-status="loading" ` +
      `title="正在载入文档全文…（发送时一并提交）">📄 文档 ${escapeHtml(shortId)}</span>`;

    // 预取完成后更新卡片状态角标（loading → ready / failed）
    const updateDocCardStatus = (status: "ready" | "failed") => {
      const wysiwyg = this.protyle?.protyle?.wysiwyg?.element;
      const cardEl =
        (wysiwyg?.querySelector(`[data-type="block-ref"][data-id="${CSS.escape(docId)}"]`) as HTMLElement | null) ??
        (this.inputEl?.querySelector(`[data-type="block-ref"][data-id="${CSS.escape(docId)}"]`) as HTMLElement | null);
      if (cardEl) {
        cardEl.setAttribute("data-doc-status", status);
        cardEl.setAttribute("title", status === "ready" ? "文档全文已就绪，发送时一并提交" : "文档内容拉取失败，发送时将重试");
      }
    };

    // ★ 预取文档全文并缓存（与 insertBlockRef 的 refKramdownById 对齐），
    //   发送时 expandDocRefs 优先用缓存，避免发送时实时拉取失败导致 AI 收不到内容
    this.host.fetchDocText(docId).then((text) => {
      if (text) {
        this.docTextCache.set(docId, text);
        logger.info("文档预取成功", { operation: "页签拖入", data: { docId, len: text.length } });
        updateDocCardStatus("ready");
      } else {
        logger.warn("文档预取为空，发送时将重试", { operation: "页签拖入", data: { docId } });
        updateDocCardStatus("failed");
      }
    }).catch((e) => {
      logger.warn("文档预取异常，发送时将重试", { operation: "页签拖入", data: { docId }, error: e });
      updateDocCardStatus("failed");
    });

    if (this.protyle) {
      const wysiwyg = this.protyle.protyle?.wysiwyg?.element;
      this.directInsertCard(card, wysiwyg, docId);
      this.refreshInputEmptyState();
    } else {
      // contenteditable 兜底路径：无 Lute 重渲染，直接插入即可
      this.insertHtmlAtCaret(card);
    }
    logger.info("页签拖入文档引用卡片已插入", { operation: "页签拖入", data: { docId, shortId } });
    try {
      (window as any).siyuan?.showMessage?.(`已添加文档上下文(发送时实时拉取)`, 2000, "info");
    } catch { /* ignore */ }
  }

  /** 直接向 wysiwyg DOM 写入块引用卡片（绕开思源 insertHTML 所有静默失败点） */
  private directInsertCard(cardHtml: string, wysiwyg: HTMLElement | undefined, blockId?: string): void {
    if (!wysiwyg) return;
    // 去重保护：原生路径已插入同名块引用（校验时序导致的误判）时，跳过避免重复卡片
    if (blockId && wysiwyg.querySelector(`[data-type="block-ref"][data-id="${CSS.escape(blockId)}"]`)) {
      return;
    }
    // 确保有可编辑段落作为锚点（优先非占位段落）
    let paragraph = wysiwyg.querySelector<HTMLElement>("[data-node-id]:not([data-reword-placeholder]) > [contenteditable]");
    if (!paragraph) {
      // 回退到任意非占位 contenteditable 段落
      const allEditable = Array.from(wysiwyg.querySelectorAll<HTMLElement>("[contenteditable='true']"));
      paragraph = allEditable.find((p) => {
        const parent = p.closest<HTMLElement>("[data-node-id]");
        return parent?.dataset?.rewordPlaceholder !== "1";
      }) ?? null;
    }
    if (!paragraph) {
      // ★ 升级占位段为真段落：新会话时 wysiwyg 只有占位段，
      // 与其创建新段落导致「空第一行 + 块引用第二行」的错乱布局，
      // 不如直接把占位段升级——移除 placeholder 标记、写入内容、更新 node-id。
      // 升级后 readInputValue 不再把它当占位清理，预设提示词也不会顶掉块引用。
      const placeholder = wysiwyg.querySelector<HTMLElement>('[data-reword-placeholder="1"]');
      if (placeholder) {
        placeholder.removeAttribute('data-reword-placeholder');
        placeholder.setAttribute('data-node-id', 'reword-p-' + Date.now());
        const inner = placeholder.querySelector<HTMLElement>('[contenteditable="true"]');
        if (inner) { inner.innerHTML = cardHtml; }
        // ★ 追加空真段落供光标/后续输入（否则用预设提示词会出现「块引用→空行→文本」三行错乱）
        const emptyId = 'reword-p-' + Date.now();
        wysiwyg.insertAdjacentHTML('beforeend',
          `<div data-node-id="${emptyId}" data-type="NodeParagraph"><div contenteditable="true"><br></div></div>`);
        // 光标移到空段落，用户可直接继续输入
        const newPara = wysiwyg.querySelector<HTMLElement>(`[data-node-id="${emptyId}"] > [contenteditable]`);
        if (newPara) {
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(newPara);
            range.collapse(true);
            sel?.removeAllRanges();
            sel?.addRange(range);
          } catch { /* selection 可能被锁定 */ }
        }
        return;
      }
      // 连占位段都没有（极端边界）：创建全新真段落
      const newId = "reword-p-" + Date.now();
      wysiwyg.insertAdjacentHTML("beforeend",
        `<div data-node-id="${newId}" data-type="NodeParagraph"><div contenteditable="true">${cardHtml}</div></div>`);
      return;
    }
    // 在段落末尾追加卡片
    paragraph.insertAdjacentHTML("beforeend", cardHtml);
    // 将光标移到卡片之后
    const sel = window.getSelection();
    if (sel && paragraph.contains(sel.anchorNode)) {
      try {
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        range.collapse(false); // 折叠到末尾
        sel.removeAllRanges();
        sel.addRange(range);
      } catch { /* selection 可能被锁定 */ }
    }
  }

  /** 强制刷新输入框 empty 态（移除 --empty 类，防止伪元素遮挡已插入的内容） */
  private refreshInputEmptyState(): void {
    const el = this.inputEl;
    if (!el) return;
    el.classList.remove("hiword-ai-input--empty");
    // 如果是 Protyle 模式，重新评估是否有真实内容
    const wysiwyg = this.protyle?.protyle?.wysiwyg?.element;
    if (wysiwyg) {
      let hasContent = false;
      for (const child of Array.from(wysiwyg.children)) {
        const c = child as HTMLElement;
        if (c.dataset?.rewordPlaceholder === "1") continue;
        if ((c.textContent || "").trim()) { hasContent = true; break; }
        if (c.querySelector("[data-type='block-ref']")) { hasContent = true; break; }
      }
      el.classList.toggle("hiword-ai-input--empty", !hasContent);
    }
  }

  /** 在光标处插入 HTML 片段（块引用卡片 / 富文本）；无有效光标时追加到末尾 */
  private insertHtmlAtCaret(html: string): void {
    const el = this.inputEl;
    if (!el) return;
    el.classList.remove("hiword-ai-input--empty");
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      el.insertAdjacentHTML("beforeend", html);
      this.moveCaretToEnd(el);
      return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const frag = range.createContextualFragment(html);
    const lastNode = frag.lastChild;
    range.insertNode(frag);
    if (lastNode) {
      const r = document.createRange();
      r.setStartAfter(lastNode);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  /** 在光标处插入纯文本（换行转 <br>）；Protyle 模式走原生 insert（同引擎保样式） */
  private insertTextAtCaret(text: string): void {
    if (!text) return;
    if (this.protyle) {
      this.protyle.focus();
      this.protyle.insert(escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>"), false);
      return;
    }
    const html = escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>");
    this.insertHtmlAtCaret(html);
  }

  /** 聚焦输入框 */
  private focusInput(): void {
    if (this.protyle) { this.protyle.focus(); return; }
    this.inputEl?.focus();
  }

  /**
   * 显式把当前选区/块文本预填进输入框。
   * 仅用于用户主动动作（⌥⌘A「AI 精读（当前块/选区）」命令、右键「发送到 AI 分析」），
   * 不再在 render() 中自动触发——避免切走阅读 Tab 再切回 AI 精读时把「先前选中文本」灌入输入框、
   * 覆盖用户已输入内容。
   * - Protyle 已挂载：直接写入。
   * - 尚未挂载（render 刚触发、rAF 待挂载）：暂存 pendingPrefill，挂载回调会消费。
   */
  public prefillSelection(): void {
    const src = this.host.getDeepReadSource();
    const text = src?.text || "";
    if (!text) return; // 无选区/块文本：不打扰，保留用户已输入内容或空态
    if (this.protyle || this.inputEl) {
      this.setInputMarkdown(text);
    } else {
      this.pendingPrefill = text;
    }
  }

  /**
   * 2026-08-27：外部入口（阅读器「翻译」按钮）调用。
   * 把文本预填进输入框并复用既有发送链路（runBtn 点击处理器内联实现，含流式生成）。
   * 调用方负责先打开/聚焦面板（showAiPanel）。正在生成中则忽略本次请求，避免误 abort 丢失上一次结果。
   */
  public sendText(text: string): void {
    if (!text || !text.trim()) return;
    if (this.aiBusy) {
      getLogger().warn("AiPanel.sendText 被忽略：AI 精读正在生成中");
      return;
    }
    this.setInputMarkdown(text);
    this.focusInput();
    if (this.runBtnEl) {
      this.runBtnEl.click();
    }
  }

  /** 创建一个启用块引用语法的 Lute（Protyle 内置 lute 缺失时的兜底） */
  private newLute(): Lute {
    // 防御：CJS external 模式下 import { Lute } from "siyuan" 可能运行时为 undefined
    if (typeof Lute !== "undefined" && Lute && typeof Lute.New === "function") {
      const l = Lute.New();
      l.SetBlockRef(true);
      return l;
    }
    // 不可用时抛明确错误（正常流程不应到达这里）
    throw new Error("Lute 运行时不可用（siyuan CJS external 模块限制），无法创建兜底 Lute 实例");
  }

  /**
   * 获取全特性 Kramdown Lute 实例（专用于输入框 DOM → 发送给 AI 的序列化）。
   * 开启所有思源格式特性，确保 BlockDOM2Md 输出完整 kramdown：
   * - 块引用 span → ((id 'anchor')) 而非泄漏原始 <span> 标签
   * - 加粗/斜体/代码/高亮/删除线 等行内格式保留
   * - IAL 属性标记 {: ...} 保留（后续由 cleanForAi 剥离）
   *
   * 重要：必须优先复用 Protyle 自带的 lute 实例（p.protyle.lute），
   * 因为 import { Lute } from "siyuan" 在 vite CJS + external 模式下运行时为 undefined。
   */
  private fullKramdownLute(existing?: Lute): Lute {
    // 优先使用已有的 Lute 实例（Protyle 内核创建的，运行时一定可用）
    if (existing) {
      try {
        existing.SetBlockRef(true);           // 块引用 → ((id 'anchor'))
        existing.SetKramdownIAL(true);        // 保留 IAL（后续清洗）
        existing.SetMark(true);               // ==高亮==
        existing.SetInlineMath(true);         // $数学$
        existing.SetSup(true); existing.SetSub(true);
        existing.SetTag(true);                // #标签#
        existing.SetGFMStrikethrough(true);   // ~~删除线~~
        existing.SetFootnotes(true);
        existing.SetSuperBlock(true); existing.SetCallout(true);
        return existing;
      } catch (e) {
        getLogger().warn("Lute 特性配置失败，使用原实例", { error: e as Error });
        return existing; // 配置失败不影响主流程，用原实例继续
      }
    }
    // 无已有实例时尝试通过 import 的 Lute 构造函数新建（CJS external 下可能不可用）
    try {
      if (typeof Lute !== "undefined" && Lute && typeof Lute.New === "function") {
        const l = Lute.New();
        l.SetBlockRef(true);
        l.SetKramdownIAL(true);
        l.SetMark(true);
        l.SetInlineMath(true);
        l.SetSup(true); l.SetSub(true);
        l.SetTag(true);
        l.SetGFMStrikethrough(true);
        l.SetFootnotes(true);
        l.SetSuperBlock(true); l.SetCallout(true);
        return l;
      }
    } catch (e) {
      getLogger().error("Lute.New() 不可用", { error: e as Error });
    }
    // 全部路径失败 → 抛明确错误（不应到达这里，因为 Protyle 模式下 p.protyle.lute 一定存在）
    throw new Error("Lute 运行时不可用：既无已有实例也无法新建（siyuan CJS external 模块限制）");
  }

  /** 将 HTML 片段转为纯文本（去标签、解码实体），用于输入区预览 */
  private stripHtmlTags(html: string): string {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return (doc.body.textContent || "").trim();
    } catch {
      return html.replace(/<[^>]+>/g, "").trim();
    }
  }

  /**
   * 清洗待发送给 AI 的文本（同步，纯字符串操作）。
   * 去除思源内部标记，保留 AI 可理解的纯 Markdown 内容。
   */
  private cleanForAi(raw: string): string {
    let s = raw;

    // 0. 还原 getInputValue 的块引用占位符 → 标准 ((id 'anchor'))。
    //    Lute 序列化时块引用被替换为 @@REWORD_REF_id@@（绕开 Lute 对复杂 anchor 的二次解析截断），
    //    此处用序列化时缓存的真实锚文本还原为完整 kramdown，供 UI 渲染折叠卡片与 expandBlockRefs 展开正文。
    s = s.replace(/@@REWORD_REF_([a-z0-9_-]{14,})@@/g, (_m, id: string) => {
      if (!this.lastDomRefs.has(id)) return _m; // 防御：非插件生成的占位符原样保留
      const anchor = (this.lastDomRefs.get(id) || '').replace(/'/g, '’');
      return `((${id} '${anchor}'))`;
    });

    // 0a. （2026-08-21 v3 已移除）页签引用现为原生 block-ref（锚以「📄 文档 」开头），
    //     由上面 step 0 统一还原为 ((id '📄 文档 XXXX'))，不再有 @@REWORD_DOC_ 占位符。

    // 0. 兜底：修复任何残留的 kramdown 块引用泄漏形态。
    //    主修复已在 getInputValue() 中完成：块引用走占位符旁路（@@REWORD_REF_id@@），
    //    Lute 不会二次解析 anchor。此处仅作为二次兜底，处理历史会话/其他路径残留的截断形态。
    const wysiwyg = this.protyle?.protyle?.wysiwyg?.element;
    const domRefs = new Map<string, string>();
    if (wysiwyg) {
      wysiwyg.querySelectorAll('[data-type="block-ref"]').forEach((el) => {
        const id = el.getAttribute('data-id') || '';
        if (id && !domRefs.has(id)) domRefs.set(id, (el.textContent || '').trim());
      });
    }
    if (domRefs.size > 0) {
      // 长 id 优先，避免短 id 在长 id 子串上误替换
      const sortedIds = Array.from(domRefs.keys()).sort((a, b) => b.length - a.length);
      for (const id of sortedIds) {
        const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const anchor = domRefs.get(id) || '';
        const safeAnchor = anchor.replace(/'/g, '’');
        // 统一修复任何残留的泄漏形态：((id 'anchor)) / ((id 'anchor) / ((id 'anchor / ((id)) / ((id) / ((id。
        // 负向前瞻 (?!\s+'[^']*?'\)\)) 排除已完整闭合的 ((id 'anchor'))，
        // 避免对占位符还原后的标准形态二次破坏（旧版 idOnlyRe 会把完整形态误拆导致重复 anchor）。
        // 字符类内不含右括号，避开 TS/V8 解析 bug。
        const fixRe = new RegExp(`\\(\\(${escapedId}(?!\\s+'[^']*?'\\)\\))(?:\\s+'[^']*?)?\\)?\\)?`, 'g');
        s = s.replace(fixRe, `((${id} '${safeAnchor}'))`);
      }
    }

    // 0b. 把泄漏的原始 HTML <span data-type="block-ref" data-id="X">anchor</span>
    //    规整为 ((X 'anchor')) 语法，保留 data-id 供后续 expandBlockRefs 按块 ID 拉回
    //    完整且带思源样式的正文。Lute 的 BlockDOM2Md 对部分手动插入的块引用卡片未能
    //    转成 ((id))，会残留原始 span；若此处把 data-id 丢弃，expandBlockRefs 将无法识别，
    //    只能把输入框里 40 字截断的锚文本发给 AI（已修复的缺陷）。
    s = s.replace(
      /<span\b[^>]*\bdata-type\s*=\s*["']?block-ref["'"]?[^>]*\bdata-id\s*=\s*["']?([a-z0-9_-]{14,})["']?[^>]*>([\s\S]*?)<\/span>/gi,
      (_m, id: string, inner: string) => {
        const anchor = inner.replace(/<[^>]+>/g, "").replace(/\n/g, " ").trim();
        // 把 anchor 中的单引号替换为 Unicode 右单引号，避免与 kramdown 定界符冲突
        return `((${id} '${anchor.replace(/'/g, "’")}'))`;
      }
    );
    // 1. 删除 Ideal/Pandoc 行内属性列表 {: ...}（可能跨多行）
    s = s.replace(/\{:[^}]*\}/gs, '');
    // 2. 删除残留的裸 HTML 标签（BlockDOM2Md 未完全转换的），提取文本内容
    //    但保留已正确转为 ((id)) 的块引用；极个别仍泄漏的块引用 span 也保住 data-id
    s = s.replace(/<[^>]+>/g, (match) => {
      // 仍有极个别泄漏的块引用 span（无 data-id 等异常情形）：保住 data-id 而非丢弃
      const idMatch = match.match(/data-type\s*=\s*["']?block-ref["'"]?/i) &&
        match.match(/data-id\s*=\s*["']?([a-z0-9_-]{14,})["']?/i);
      if (idMatch) return `((${idMatch[1]}))`;
      return '';
    });
    // 3. 删除零宽字符和特殊空白
    s = s.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');
    // 4. 删除 HTML 注释
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    // 5. 清理多余空行
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
  }

  /**
   * 读取输入框原始 Kramdown（保留 block-ref 的 ((id 'anchor')) 形态）。
   * 用于「预填充/回填」场景：把当前内容与模板/文件/搜索文本合并后再 setInputMarkdown 渲染，
   * 必须保留思源原生语法，否则 block-ref 会被展成 @@REWORD_REF_id@@ 文本，失去交互与样式。
   */
  private getInputMarkdownForPrefill(): string {
    // trimEnd：去掉末尾空段落产生的多余换行，避免合并预设/模板时出现「块引用→空行→文本」的三行错乱
    return this.readInputValue({ replaceBlockRefs: false }).trimEnd();
  }

  /** 读取输入框内容：Protyle 模式用全特性 Lute 把块 DOM 序列化为完整 Kramdown；回退用 htmlToMarkdown */
  private getInputValue(): string {
    return this.readInputValue({ replaceBlockRefs: true });
  }

  /**
   * 读取输入框内容的核心实现。
   * @param replaceBlockRefs true = 发送/估算场景，把 block-ref 替换成 @@REWORD_REF_id@@ 占位符，
   *                         绕开 Lute 对复杂 anchor 的二次解析截断；false = 预填充场景，保留 ((id 'anchor'))。
   */
  private readInputValue(opts: { replaceBlockRefs: boolean }): string {
    const p = this.protyle;
    if (p && p.protyle?.wysiwyg) {
      const wysiwyg = p.protyle.wysiwyg.element;
      // 使用全特性 Lute 确保块引用等思源格式正确序列化为 kramdown
      // 传入 Protyle 自带的 lute 实例（避免 Lute.New() 在 CJS external 下不可用的问题）
      const existingLute = p.protyle.lute ?? undefined;
      const lute = this.fullKramdownLute(existingLute);
      try {
        // 克隆并清理 REword 占位节点（lite Protyle wysiwyg 初始占位），避免被当作消息正文发送到 LLM
        const clone = wysiwyg.cloneNode(true) as HTMLElement;
        // ★ 安全网：移除占位段前，先将其中的块引用「救出」到新真段落。
        //   场景：protyle.insert() 原生路径可能把块引用写入占位段（光标默认在占位段内），
        //   若直接删占位段，块引用随之丢失 → 新会话拖块后用预设提示词会「顶掉」块引用。
        clone.querySelectorAll('[data-reword-placeholder="1"]').forEach((placeholder) => {
          const refs = placeholder.querySelectorAll('[data-type="block-ref"]');
          if (refs.length > 0) {
            // 将块引用迁移到新建的真段落中，再删除空占位段
            const safePara = document.createElement('div');
            safePara.setAttribute('data-node-id', 'reword-saved-' + Date.now());
            safePara.setAttribute('data-type', 'NodeParagraph');
            const inner = document.createElement('div');
            inner.setAttribute('contenteditable', 'true');
            refs.forEach((r) => inner.appendChild(r.cloneNode(true)));
            safePara.appendChild(inner);
            placeholder.parentNode?.insertBefore(safePara, placeholder.nextSibling);
          }
          placeholder.remove();
        });
        // ★ Lute 为主：所有行内/块级格式（加粗/高亮/列表/代码块等）仍由 Lute 序列化。
        //   发送场景下块引用走「占位符旁路」：列表块 anchor 常含 {、数字. 等 kramdown 语法字符，
        //   Lute 序列化时会二次解析 anchor 文本导致截断（((id '27. 泄漏）。
        //   把 block-ref 节点替换成 Lute 完全不认识的纯文本标记 @@REWORD_REF_id@@，
        //   Lute 只会原样输出，绝无截断；后续 cleanForAi 再还原为标准 ((id 'anchor'))。
        this.lastDomRefs.clear();
        clone.querySelectorAll('[data-type="block-ref"]').forEach((el) => {
          const id = el.getAttribute('data-id') || '';
          if (!id) return;
          const anchor = (el.textContent || '').trim();
          this.lastDomRefs.set(id, anchor);
          if (opts.replaceBlockRefs) {
            el.replaceWith(document.createTextNode(`@@REWORD_REF_${id}@@`));
          }
        });
        // 2026-08-21 v3：页签引用已改为原生 block-ref（锚以「📄 文档 」开头），
        // 走上面的统一 block-ref 通道即可，发送时由 expandDocRefs 识别锚前缀拉全文。
        return lute.BlockDOM2Md(clone.innerHTML).trim();
      } catch (e) {
        getLogger().error("Protyle 序列化失败，回退 htmlToMarkdown", { operation: "读取输入框", error: e as Error });
      }
    }
    const el = this.inputEl;
    if (!el) return "";
    if (el.classList.contains("hiword-ai-input--empty")) return "";
    return this.htmlToMarkdown(el.innerHTML).trim();
  }

  /** 读取输入框内容并清洗（用于发送给 AI）：序列化 + 去除 IAL/泄漏 HTML */
  private getCleanInputValue(): string {
    return this.cleanForAi(this.getInputValue());
  }

  /** 设置输入框内容：Protyle 模式用 Md2BlockDOM 渲染（同引擎）；回退用 markdownToHtml */
  private setInputMarkdown(md: string): void {
    const p = this.protyle;
    if (p && p.protyle?.wysiwyg) {
      const lute = p.protyle.lute ?? this.newLute();
      p.protyle.wysiwyg.element.innerHTML = lute.Md2BlockDOM(md || "");
      // 程序化写入后强制刷新 empty 态，否则 --empty 残留会让占位符伪元素覆盖在内容之上
      this.refreshInputEmptyState();
      return;
    }
    const el = this.inputEl;
    if (!el) return;
    if (!md) {
      el.innerHTML = "";
      el.classList.add("hiword-ai-input--empty");
      return;
    }
    el.classList.remove("hiword-ai-input--empty");
    el.innerHTML = this.markdownToHtml(md);
  }

  /** 切换输入框可编辑状态（加载中禁用） */
  private setInputDisabled(disabled: boolean): void {
    if (this.protyle) {
      if (disabled) this.protyle.disable(); else this.protyle.enable();
    }
    if (this.inputEl) this.inputEl.classList.toggle("hiword-ai-input--disabled", disabled);
  }

  /** 确保存在一个激活会话；复用 currentSessionId，无则惰性创建并返回 id */
  private async ensureSession(): Promise<string> {
    if (this.currentSessionId && sessionStore.get(this.currentSessionId)) return this.currentSessionId;
    const s = sessionStore.create();
    this.currentSessionId = s.id;
    return s.id;
  }

  /**
   * 初次使用自动命名：发送首条用户消息后，若会话标题仍为默认「新会话」或为
   * sessionStore.saveMessages 中的 24 字截断版，则调用 AI 生成更贴切的标题。
   * 失败/超时/无 API key 时静默跳过，保留兜底标题。
   */
  private async aiAutoRenameSession(sid: string, firstUserContent: string): Promise<void> {
    try {
      const sess = sessionStore.get(sid);
      if (!sess) return;
      // 已被用户手动改过名（不是默认名、也不是 saveMessages 的截断版）就不动它
      const fallbackSlice = firstUserContent.slice(0, 24).replace(/\s+/g, " ").trim();
      if (sess.title !== "新会话" && sess.title !== fallbackSlice) return;
      const settings = this.host.getAiSettings();
      if (!settings.enabled || !settings.apiKey || !settings.baseUrl) return;
      const content = firstUserContent.trim().slice(0, 500);
      if (!content) return;
      const prompt = `请根据以下用户消息内容，生成一个不超过 12 个字的简洁中文会话标题。只输出标题文本本身，不要加引号、不要加任何前缀说明。\n\n用户消息：\n${content}`;
      const result = await requestAIGenerate({
        messages: [{ role: "user", content: prompt }],
        settings: { ...settings, maxTokens: 60, temperature: 0.2, jsonMode: false, systemPrompt: "" },
        jsonMode: false,
        timeout: 15000,
      });
      const cleaned = (result.content || "")
        .trim()
        .replace(/^["'`「]|^[「]|["'`」]$/g, "")
        .replace(/^标题[:：]\s*/, "")
        .split(/\r?\n/)[0]
        .trim()
        .slice(0, 30);
      if (!cleaned) return;
      // 二次防御：标题若与兜底一样就不必落盘
      if (cleaned === sess.title) return;
      sessionStore.rename(sid, cleaned);
      getLogger().info("会话自动命名成功", { operation: "AI会话命名", data: { sid, title: cleaned } });
    } catch (err) {
      // 静默失败：兜底标题已可用，不影响主流程
      getLogger().warn("会话自动命名失败（已保留兜底标题）", { operation: "AI会话命名", data: { error: String(err) } });
    }
  }

  /**
   * 自动恢复上次活跃会话（面板打开 / 重渲染时调用）。
   * 仅当激活会话包含消息时才恢复，避免空会话干扰新用户首次体验。
   * 恢复后 chatHistory 与消息视图同步，用户可继续对话。
   */
  private restoreLastSession(): void {
    try {
      const active = sessionStore.getActive();
      if (!active || !active.messages.length) return; // 无消息不恢复
      // 防止重复恢复（currentSessionId 已指向该会话且已有历史消息）
      if (this.currentSessionId === active.id && this.chatHistory.length > 0) return;

      this.currentSessionId = active.id;
      this.chatHistory = active.messages.map((m) => ({ role: m.role, content: m.content }));

      const messagesEl = this.contentEl?.querySelector("#hiword-ai-messages") as HTMLElement | undefined;
      const welcomeEl = this.contentEl?.querySelector("#hiword-ai-welcome") as HTMLElement | undefined;
      const bodyEl = this.contentEl?.querySelector(".hiword-ai-body") as HTMLElement | undefined;
      const statusEl = this.contentEl?.querySelector("#hiword-ai-status") as HTMLElement | undefined;
      if (!messagesEl) return;

      // 渲染历史消息到视图
      messagesEl.innerHTML = "";
      active.messages.forEach((m, idx) => {
        const isUser = m.role === "user";
        const msg = document.createElement("div");
        msg.className = `hiword-ai-msg hiword-ai-msg--${isUser ? "user" : "result"}`;
        msg.dataset.index = String(idx);
        msg.dataset.role = m.role;
        const contentHtml = isUser
          ? this.renderUserMessage(m.content)
          : (m.html ?? renderWithLute(m.content));
        msg.innerHTML = `
          <div class="hiword-ai-msg-avatar">${isUser ? "我" : "AI"}</div>
          <div class="hiword-ai-msg-content b3-typography">
            ${contentHtml}
            ${renderMessageToolbar(m.role)}
          </div>
        `;
        messagesEl.appendChild(msg);
        if (!isUser) {
          // 原始 markdown 存入 JS Map（替代 data-raw-md 属性，降低 innerHTML 解析负担，P3-2）
          this.rawMdByIndex.set(idx, m.content);
          enhanceSiYuanRender(msg);
          this.bindResult(msg, undefined);
        }
        this.bindMessageToolbar(msg, idx, m.role);
      });
      if (welcomeEl) welcomeEl.style.display = "none";
      if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
      if (statusEl) statusEl.textContent = `已恢复会话「${active.title}」(${active.messages.length} 条)`;
    } catch (e) {
      getLogger().warn("[REword] 会话自动恢复失败（非致命）:", { error: e });
    }
  }

  /** 将 HTML 序列化为 Markdown（发送给 AI 用）：块引用 -> ((id 'anchor'))，保留基础样式 */
  private htmlToMarkdown(html: string): string {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const walk = (node: Node): string => {
      if (node.nodeType === Node.COMMENT_NODE) return "";
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const inner = Array.from(el.childNodes).map(walk).join("");
      switch (tag) {
        case "span": {
          if (el.dataset.type === "block-ref") {
            const id = el.dataset.id || "";
            const anchor = el.dataset.anchor || el.textContent?.trim() || "";
            return `((${id} '${anchor.replace(/'/g, "\\'")}'))`;
          }
          return inner;
        }
        case "strong": case "b": return `**${inner}**`;
        case "em": case "i": return `*${inner}*`;
        case "mark": return `==${inner}==`;
        case "code": return "`${inner}`";
        case "del": case "s": return `~~${inner}~~`;
        case "br": return "\n";
        case "p": case "div": {
          const t = inner.trim();
          return t ? `\n${t}\n` : "\n";
        }
        case "li": return `\n- ${inner}`;
        default: return inner;
      }
    };
    let md = walk(doc.body);
    md = md.replace(/\u200B/g, "").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
    return md;
  }

  /** 将 Markdown 转为输入框 HTML（块引用 -> 卡片，基础样式 -> 标签） */
  private markdownToHtml(md: string): string {
    const refs: string[] = [];
    let s = md.replace(/\(\(\s*([0-9a-f]{16,})\s*(?:'((?:[^'\\]|\\.)*)')?\s*\)\)/gi, (_m, id: string, anchor?: string) => {
      const a = (anchor || "").replace(/\\'/g, "'");
      const safe = escapeHtml(a);
      const ref = `<span class="hiword-ref" contenteditable="false" data-type="block-ref" data-id="${id}" data-anchor="${safe}">${safe || "块引用"}</span>`;
      refs.push(ref);
      return `@@REF${refs.length - 1}@@`;
    });
    s = escapeHtml(s);
    s = s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/==([^=]+)==/g, "<mark>$1</mark>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
    s = `<p>${s}</p>`;
    s = s.replace(/@@REF(\d+)@@/g, (_m, i: string) => refs[Number(i)]);
    return s;
  }

  /** 将光标移动到元素末尾 */
  private moveCaretToEnd(el: HTMLElement): void {
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  private renderUserMessage(md: string): string {
    // 预清洗：去除 IAL 属性标记和残留 HTML（防御 BlockDOM2Md 泄漏）
    md = this.cleanForAi(md);

    // 块引用正则：((blockId 'anchor')) 或 ((blockId)) 或泄漏形态 ((blockId 'anchor))
    // 注意：泄漏形态（缺闭合单引号）是思源 BlockDOM2Md 序列化列表块时偶发的，必须兼容，
    // 否则 anchor 捕获组 ([^']*) 会贪婪吞掉结尾的 )) 导致整体匹配失败，块引用无法展开/渲染为卡片。
    const refRe = /\(\(([^\s]+)(?:\s+'([^']*?)'?)?\)\)/g;
    // 泄漏的 HTML 块引用正则：<span data-type="block-ref" data-id="xxx">anchor</span>
    const htmlRefRe = /<span\s[^>]*data-type\s*=\s*["']?block-ref["'"]?\s[^>]*data-id\s*=\s*["']?([a-z0-9_-]{14,})["'"]?\s[^]*>([\s\S]*?)<\/span>/gi;
    const parts: string[] = [];
    let lastEnd = 0;
    let m: RegExpExecArray | null;

    // 先处理 ((id 'anchor')) 格式的块引用
    while ((m = refRe.exec(md)) !== null) {
      if (m.index > lastEnd) {
        const plain = md.slice(lastEnd, m.index).trim();
        if (plain) parts.push(renderMarkdown(plain));
      }
      const blockId = m[1];
      const anchor = m[2] || "";
      const displayAnchor = anchor || `块 ${blockId.slice(0, 8)}…`;
      parts.push(
        `<span class="hiword-ref-card" data-block-id="${escapeHtml(blockId)}" title="点击展开预览（发送给 AI 时为完整内容）">` +
          `<span class="hiword-ref-card__icon">📎</span>` +
          `<span class="hiword-ref-card__anchor">${escapeHtml(displayAnchor)}</span>` +
          `<span class="hiword-ref-card__chevron">▸</span>` +
        `</span>`
      );
      lastEnd = m.index + m[0].length;
    }

    // 再处理泄漏的 <span data-type="block-ref"> HTML 格式
    htmlRefRe.lastIndex = 0;
    while ((m = htmlRefRe.exec(md)) !== null) {
      if (m.index > lastEnd) {
        const plain = md.slice(lastEnd, m.index).trim();
        if (plain) parts.push(renderMarkdown(plain));
      }
      const blockId = m[1];
      const rawAnchor = (m[2] || "").replace(/<[^>]+>/g, ""); // 去除锚文本内可能嵌套的标签
      const displayAnchor = rawAnchor.trim() || `块 ${blockId.slice(0, 8)}…`;
      parts.push(
        `<span class="hiword-ref-card" data-block-id="${escapeHtml(blockId)}" title="点击展开预览">` +
          `<span class="hiword-ref-card__icon">📎</span>` +
          `<span class="hiword-ref-card__anchor">${escapeHtml(displayAnchor)}</span>` +
          `<span class="hiword-ref-card__chevron">▸</span>` +
        `</span>`
      );
      lastEnd = m.index + m[0].length;
    }

    // 尾部剩余文本
    if (lastEnd < md.length) {
      const tail = md.slice(lastEnd).trim();
      if (tail) parts.push(renderMarkdown(tail));
    }

    let html = parts.join("") || '<span style="opacity:0.5">（空消息）</span>';

    // 最终安全兜底：去除仍可能泄漏的思源内部标签（<span data-type / data-id / data-subtype 等）
    // 这些标签在 cleanForAi 的 <[^>]+> 通用剥离中本应被清除，但某些边界情况（如属性值含 > 或标签未闭合）
    // 可能绕过正则。此处对输出 HTML 做二次扫描，确保用户消息气泡中绝不出现原始标签文本。
    html = html.replace(/<span\b(?=[^>]*\bdata-(?:type|id|subtype|node-id|src|mark)\b)[^>]*>[\s\S]*?<\/span>/gi, (match) => {
      // 提取纯文本作为降级显示
      const text = match.replace(/<[^>]+>/g, "").trim();
      return text || "";
    });
    // 兜底：去除任何独立的未闭合/残留 <span data-... 片段
    html = html.replace(/<span\b[^>]*\bdata-\w+\b[^>]*>/gi, "");

    return html;
  }

  /**
   * 把 Markdown 中的 @@REWORD_REF_<id>@@ 占位符替换为拖入块时缓存的内核 API 完整 kramdown 正文。
   * 这是新方案的核心：
   *   - 拖入时（insertBlockRef）已 await fetchBlockText 把完整正文写入 refKramdownById，
   *     发送时直接从 Map 拿，不再依赖 Lute 序列化 block-ref 节点，
   *     彻底绕开「Lute 二次解析 anchor 文本」导致的截断（列表块 anchor 含 {、数字. 等字符）。
   *   - AI 路径专用：UI 路径仍走 cleanForAi 把占位符 → ((id 'anchor')) 渲染折叠卡片。
   *   - refMap 未命中（如拖入后 fetchBlockText 失败）→ 兜底异步拉取；仍为空则保留空串。
   *   - 单块正文超过 8000 字符的硬上限，避免拖入/粘贴大量块时上下文爆炸。
   */
  private async expandPlaceholdersAsync(raw: string): Promise<string> {
    const re = /@@REWORD_REF_([a-z0-9_-]{14,})@@/g;
    const matches: RegExpExecArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) matches.push(m);
    if (!matches.length) return raw;

    const MAX_PER_BLOCK = 8000;
    const edits = await Promise.all(matches.map(async (mm) => {
      const id = mm[1];
      const anchor = this.lastDomRefs.get(id) || "";
      // 2026-08-21 v3：文档引用（锚以「📄 文档 」开头）不在此处展开正文，
      // 转成 ((id '📄 文档 XXXX')) 交给 expandDocRefs 实时拉全文（复用 fetchDocText 路径）
      if (/^📄 文档 /.test(anchor)) {
        const shortId = id.replace(/-/g, "").slice(-6);
        return { from: mm.index, to: mm.index + mm[0].length, text: `((${id} '📄 文档 ${shortId}'))` };
      }
      let body = this.refKramdownById.get(id);
      if (!body) {
        // refMap 缺失兜底（如用户从未通过拖入路径，而是其他来源触发的占位符）
        body = (await this.host.fetchBlockText(id)) || "";
        if (body) this.refKramdownById.set(id, body);
      }
      let text = body.trim();
      if (text.length > MAX_PER_BLOCK) text = ""; // 超限静默丢弃，避免撑爆 AI 上下文
      return { from: mm.index, to: mm.index + mm[0].length, text };
    }));

    // 按 from 倒序替换，避免位置偏移
    edits.sort((a, b) => b.from - a.from);
    let out = raw;
    for (const e of edits) out = out.slice(0, e.from) + e.text + out.slice(e.to);
    return out;
  }

  /**
   * 把 Markdown 中的块引用 ((blockId 'anchor')) 展开为真实 Kramdown 内容。
   * 拖入/粘贴思源块时被序列化为该语法，发送前还原为正文，
   * 避免 AI 收到无法解析的 ((id))。无块引用时原样返回。
   */
  private async expandBlockRefs(md: string): Promise<string> {
    const edits: Array<{ from: number; to: number; text: string }> = [];
    let m: RegExpExecArray | null;
    // 展开正文总量上限（避免拖入/粘贴大量块引用时上下文爆炸，P3-1）
    const MAX_EXPAND = 8000;
    let expandedLen = 0;
    // 带缓存的块正文拉取：同一会话内重复块只请求一次
    const fetchCached = async (blockId: string): Promise<string | null> => {
      const hit = this.blockTextCache.get(blockId);
      if (hit !== undefined) return hit;
      const k = await this.host.fetchBlockText(blockId);
      if (k && k.trim()) {
        this.blockTextCache.set(blockId, k);
        // 简单 LRU：超过 200 条时淘汰最旧（Map 保序，首键即最旧）
        if (this.blockTextCache.size > 200) {
          const oldest = this.blockTextCache.keys().next().value as string | undefined;
          if (oldest) this.blockTextCache.delete(oldest);
        }
        return k;
      }
      return k;
    };
    const tryExpand = async (blockId: string, from: number, to: number, anchorText?: string) => {
      // 兜底文本：拉取失败 / 超限时用锚文本转 Markdown，绝不留 ((id 'anchor')) 原文给 AI
      const fallback = (anchorText || "").trim();
      const k = await fetchCached(blockId);
      const body = k && k.trim() ? k.trim() : "";
      if (body) {
        if (expandedLen >= MAX_EXPAND) {
          // 已达上限：不展开正文，退化为锚文本
          edits.push({ from, to, text: fallback ? `\n\n${fallback}\n\n` : "" });
          return;
        }
        const text = `\n\n${body}\n\n`;
        if (expandedLen + text.length > MAX_EXPAND) {
          // 单块即超限则跳过展开，退化为锚文本，避免撑爆
          edits.push({ from, to, text: fallback ? `\n\n${fallback}\n\n` : "" });
          return;
        }
        edits.push({ from, to, text });
        expandedLen += text.length;
        return;
      }
      // 拉取失败/内容为空：静默转 Markdown（锚文本）；无锚文本则移除该引用，避免残留 ((id))
      edits.push({ from, to, text: fallback ? `\n\n${fallback}\n\n` : "" });
    };
    // 1) ((id 'anchor')) kramdown 形式（正常路径，兼容缺闭合单引号的泄漏形态 ((id 'anchor))
    const re = /\(\(([^\s]+)(?:\s+'([^']*?)'?)?\)\)/g;
    while ((m = re.exec(md))) {
      // 2026-08-21 v3：文档引用（锚以「📄 文档 」开头）由 expandDocRefs 处理，
      // 此处跳过，避免把文档根块当普通块用 fetchBlockText 拉取、抢在 expandDocRefs 之前
      if (/^📄 文档 /.test(m[2] || "")) continue;
      await tryExpand(m[1], m.index, m.index + m[0].length, m[2]);
    }
    // 2) 残留 <span data-type="block-ref" data-id="X">anchor</span> 形式
    //    （cleanForAi 未兜住时的兜底：直接按 data-id 拉回完整且带样式的正文）
    const htmlRefRe = /<span\b[^>]*\bdata-type\s*=\s*["']?block-ref["'"]?[^>]*\bdata-id\s*=\s*["']?([a-z0-9_-]{14,})["']?[^>]*>([\s\S]*?)<\/span>/gi;
    while ((m = htmlRefRe.exec(md))) {
      const innerAnchor = (m[2] || "").replace(/<[^>]+>/g, "").replace(/\n/g, " ").trim();
      // 文档引用由 expandDocRefs 处理，跳过
      if (/^📄 文档 /.test(innerAnchor)) continue;
      await tryExpand(m[1], m.index, m.index + m[0].length, innerAnchor);
    }
    if (!edits.length) return md;
    // 按位置升序合并（两种形式可能交错出现）
    edits.sort((a, b) => a.from - b.from);
    let out = "";
    let cursor = 0;
    for (const e of edits) {
      if (e.from < cursor) continue; // 跳过理论上的重叠
      out += md.slice(cursor, e.from) + e.text;
      cursor = e.to;
    }
    out += md.slice(cursor);
    return out.replace(/\n{4,}/g, "\n\n\n").trim();
  }

  /**
   * 把 Markdown 中的文档占位符 ((docId '📄 文档 XXXXXX')) 展开为文档正文。
   * 策略（2026-08-26 修复）：
   *   - 拖入时 insertDocRef 已预取全文到 docTextCache → 发送时缓存优先（零网络延迟）
   *   - 缓存未命中时实时拉取（兼容历史会话/预取失败场景）
   *   - 拉取失败 → 降级为明确提示文本（不再静默删掉导致 AI 看不到任何内容）
   *   - 全文超 MAX (12k) → 截断并在末尾追加"已截断"提示
   */
  private async expandDocRefs(md: string): Promise<string> {
    const MAX_EXPAND = 12000;
    const edits: Array<{ from: number; to: number; text: string }> = [];
    let expandedLen = 0;
    let m: RegExpExecArray | null;
    // 复用 expandBlockRefs 的同款正则：((id 'title'))（兼容缺闭合单引号泄漏形态）
    const re = /\(\(([a-z0-9_-]{14,})(?:\s+'([^']*?)'?)?\)\)/g;
    while ((m = re.exec(md))) {
      // 只处理"doc 锚"(title 以 '📄 文档 ' 开头),跳过 block-ref 的 ((id 'anchor'))
      const anchor = m[2] || "";
      if (!/^📄 文档 /.test(anchor)) continue;
      const docId = m[1];
      let text: string | undefined = this.docTextCache.get(docId);
      if (text !== undefined) {
        getLogger().info("[REword] expandDocRefs 缓存命中 docId=" + docId + " len=" + text.length);
      } else {
        // 缓存未命中：实时拉取（历史会话 / 预取失败时的兜底）
        getLogger().info("[REword] expandDocRefs 缓存未命中，实时拉取 docId=" + docId);
        let fetched: string | null = null;
        try {
          fetched = await this.host.fetchDocText(docId);
        } catch (e) {
          getLogger().warn("[REword] expandDocRefs 拉取失败 docId=" + docId, { error: e as Error });
        }
        if (fetched) {
          this.docTextCache.set(docId, fetched);
          // 简单 LRU：超过 50 条时淘汰最旧（文档比块大,上限更保守）
          if (this.docTextCache.size > 50) {
            const oldest = this.docTextCache.keys().next().value as string | undefined;
            if (oldest) this.docTextCache.delete(oldest);
          }
          text = fetched;
        } else {
          getLogger().warn("[REword] expandDocRefs 拉取结果为空 docId=" + docId + "（AI 将收到降级提示）");
        }
      }
      if (text) {
        const shortId = docId.replace(/-/g, "").slice(-6);
        const header = `\n\n## 📄 文档 ${shortId}\n\n`;
        if (expandedLen + header.length + text.length > MAX_EXPAND) {
          // 已达上限:不展开正文,只保留占位标题（与 expandBlockRefs 降级一致）
          edits.push({ from: m.index, to: m.index + m[0].length, text: header });
        } else {
          edits.push({ from: m.index, to: m.index + m[0].length, text: header + text });
          expandedLen += header.length + text.length;
        }
      } else {
        // ★ 降级：拉取失败时不再静默删除，而是给 AI 一个明确提示，
        //   让 AI 知道用户引用了某个文档（即使内容不可用），避免 AI 说「看不到内容」
        const shortId = docId.replace(/-/g, "").slice(-6);
        edits.push({
          from: m.index,
          to: m.index + m[0].length,
          text: `\n\n> ⚠️ 文档 ${shortId} 内容暂不可用（可能文档已被删除或权限不足），请用户重新拖入或粘贴正文。\n\n`,
        });
      }
    }
    if (!edits.length) return md;
    edits.sort((a, b) => a.from - b.from);
    let out = "";
    let cursor = 0;
    for (const e of edits) {
      if (e.from < cursor) continue;
      out += md.slice(cursor, e.from) + e.text;
      cursor = e.to;
    }
    out += md.slice(cursor);
    return out.replace(/\n{4,}/g, "\n\n\n").trim();
  }

  /** 跨平台快捷键文案 */
  private shortcutHint(): string {
    const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    return isMac ? "⌘↩" : "Ctrl+Enter";
  }

  /** 把异常转成友好提示 */
  private friendlyError(e: any): string {
    const msg: string = (e?.message || String(e) || "").toLowerCase();
    if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("invalid api"))
      return "API Key 无效或已失效，请到设置中检查。";
    if (msg.includes("403"))
      return "无访问权限（403），请确认 API Key 与 base URL 是否匹配。";
    if (msg.includes("429"))
      return "请求过于频繁（429），稍等几秒再试。";
    if (msg.includes("402") || msg.includes("quota") || msg.includes("exceeded"))
      return "额度不足（402），请检查账户余额。";
    if (msg.includes("timeout") || msg.includes("网络") || msg.includes("fetch") || msg.includes("network") || msg.includes("econn"))
      return "网络异常：无法连接模型服务，请检查网络与 base URL。";
    return escapeHtml(e?.message || String(e)) || "未知错误";
  }

  private bind(contentEl: HTMLElement): void {
    const readBtn = contentEl.querySelector("#hiword-ai-read") as HTMLButtonElement;
    const runBtn = contentEl.querySelector("#hiword-ai-run") as HTMLButtonElement;
    const sendBtn = contentEl.querySelector("#hiword-ai-send") as HTMLButtonElement;
    // 2026-08-27：保存发送按钮引用，供外部（阅读器「翻译」）经 sendText() 复用同一条发送链路
    this.runBtnEl = runBtn;
    const copyAllBtn = contentEl.querySelector("#hiword-ai-copyall") as HTMLButtonElement;
    const input = contentEl.querySelector("#hiword-ai-protyle") as HTMLElement;
    const statusEl = contentEl.querySelector("#hiword-ai-status") as HTMLElement;
    const bodyEl = contentEl.querySelector("#hiword-ai-body") as HTMLElement;
    const welcomeEl = contentEl.querySelector("#hiword-ai-welcome") as HTMLElement;
    const messagesEl = contentEl.querySelector("#hiword-ai-messages") as HTMLElement;
    const footerEl = contentEl.querySelector("#hiword-ai-footer") as HTMLElement;

    // 新增：模型下拉 / 底部工具栏按钮 / 弹窗容器
    const modelBtn = contentEl.querySelector("#hiword-ai-model-btn") as HTMLButtonElement;
    const modelMenu = contentEl.querySelector("#hiword-ai-model-menu") as HTMLElement;
    const modelCurrent = contentEl.querySelector(".hiword-ai-model-current") as HTMLElement;
    const docSearchBtn = contentEl.querySelector("#hiword-ai-docsearch") as HTMLButtonElement;
    const templatesBtn = contentEl.querySelector("#hiword-ai-templates") as HTMLButtonElement;
    const presetsBtn = contentEl.querySelector("#hiword-ai-presets") as HTMLButtonElement;
    const uploadBtn = contentEl.querySelector("#hiword-ai-upload") as HTMLButtonElement;
    // 预设激活态同步到「预设」按钮：显示当前预设名 + 高亮（2026-08-26 改进）
    const syncPresetButton = () => {
      const nameEl = presetsBtn?.querySelector("#hiword-ai-preset-name") as HTMLElement | null;
      const p = this.host.getActivePreset();
      if (!presetsBtn) return;
      if (p && p.name) {
        presetsBtn.classList.add("hiword-ai-tool-btn--active");
        presetsBtn.title = `当前预设：${p.name}（点击管理）`;
        if (nameEl) { nameEl.textContent = p.name; nameEl.style.display = ""; }
      } else {
        presetsBtn.classList.remove("hiword-ai-tool-btn--active");
        presetsBtn.title = "预设：切换 AI 角色/温度（点击管理）";
        if (nameEl) { nameEl.textContent = ""; nameEl.style.display = "none"; }
      }
    };
    syncPresetButton(); // 初始渲染即反映已持久化的激活预设
    const tokenRing = contentEl.querySelector("#hiword-ai-token-ring") as HTMLButtonElement;
    const tokenRingText = tokenRing?.querySelector(".hiword-ai-token-ring__text") as HTMLElement | null;
    const tokenRingProgress = tokenRing?.querySelector(".hiword-ai-token-ring__progress") as SVGCircleElement | null;

    /** 隐藏欢迎态 */
    const hideWelcome = () => {
      if (welcomeEl) welcomeEl.style.display = "none";
    };

    /* ========== Token 用量圆环 + 上下文用量浮窗（点击后出现在圆环上方的小窗） ========== */
    this.renderTokenRing();
    const tokenModal = document.createElement("div");
    tokenModal.className = "hiword-ai-token-modal-host";
    tokenModal.style.display = "none";
    document.body.appendChild(tokenModal);
    // 定位：优先显示在圆环上方，空间不足（贴顶）则显示在下方；水平居中对齐圆环
    const positionTokenModal = () => {
      const pop = tokenModal.querySelector(".hiword-ai-token-modal") as HTMLElement | null;
      if (!pop || !tokenRing) return;
      const anchorRect = tokenRing.getBoundingClientRect();
      const popRect = pop.getBoundingClientRect();
      const gap = 8;
      const margin = 8;
      let top = anchorRect.top - popRect.height - gap;
      if (top < margin) {
        top = anchorRect.bottom + gap;
        tokenModal.classList.add("hiword-ai-token-modal-host--below");
      } else {
        tokenModal.classList.remove("hiword-ai-token-modal-host--below");
      }
      const left = Math.max(
        margin,
        Math.min(anchorRect.left + anchorRect.width / 2 - popRect.width / 2, window.innerWidth - popRect.width - margin)
      );
      tokenModal.style.top = `${top}px`;
      tokenModal.style.left = `${left}px`;
    };
    const openTokenModal = () => {
      if (!tokenRing) return;
      tokenModal.innerHTML = this.renderTokenModal();
      tokenModal.style.display = "";
      tokenModal.classList.add("hiword-ai-token-modal-host--open");
      // 等布局稳定后定位（避免 getBoundingClientRect 拿到 0 尺寸）
      requestAnimationFrame(positionTokenModal);
    };
    const closeTokenModal = () => {
      tokenModal.classList.remove("hiword-ai-token-modal-host--open");
      tokenModal.style.display = "none";
      tokenModal.innerHTML = "";
    };
    // 浮窗内「✕」关闭
    tokenModal.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement)?.dataset?.act;
      if (act === "close-modal") closeTokenModal();
    });
    // 点击浮窗外部 / 圆环以外 → 关闭
    const outsideClick = (e: MouseEvent) => {
      if (!tokenModal.classList.contains("hiword-ai-token-modal-host--open")) return;
      const t = e.target as Node;
      if (tokenModal.contains(t) || (tokenRing && tokenRing.contains(t))) return;
      closeTokenModal();
    };
    document.addEventListener("mousedown", outsideClick);
    // Esc 关闭浮窗
    const escListener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && tokenModal.classList.contains("hiword-ai-token-modal-host--open")) {
        closeTokenModal();
      }
    };
    document.addEventListener("keydown", escListener);
    // 滚动 / 窗口缩放时自动收起浮窗（避免定位错位）
    const scrollClose = () => {
      if (tokenModal.classList.contains("hiword-ai-token-modal-host--open")) closeTokenModal();
    };
    window.addEventListener("scroll", scrollClose, true);
    window.addEventListener("resize", scrollClose);
    tokenRing?.addEventListener("click", (e) => {
      e.stopPropagation();
      openTokenModal();
    });

    /* ========== 通用浮层容器（模型菜单 / 模板面板 / 预设面板 / 文档搜索 / 批量入库） ========== */
    const overlay = document.createElement("div");
    overlay.className = "hiword-ai-overlay";
    overlay.style.display = "none";
    contentEl.appendChild(overlay);

    this.overlay = overlay;
    this.openOverlay = (html: string) => {
      overlay.style.pointerEvents = ""; // 恢复交互（closeOverlay 会禁用）
      overlay.innerHTML = `<div class="hiword-ai-overlay-mask" data-act="close"></div><div class="hiword-ai-overlay-panel">${html}</div>`;
      overlay.style.display = "";
      // 临时解除父容器 overflow:hidden，防止面板内容被裁切（仅影响 AI 面板区域）
      const dockPanel = contentEl.closest(".hiword-dock-panel");
      if (dockPanel) { (dockPanel as HTMLElement).style.overflow = "visible"; }
      const dc = contentEl.parentElement;
      if (dc) { (dc as HTMLElement).style.overflow = "visible"; }
    };
    const openOverlay = this.openOverlay;
    const closeOverlay = () => {
      overlay.style.display = "none";
      overlay.innerHTML = "";
      overlay.style.pointerEvents = "none"; // 确保遮罩不再拦截下方按钮的点击事件
      // 恢复父容器 overflow
      const dockPanel = contentEl.closest(".hiword-dock-panel");
      if (dockPanel) { (dockPanel as HTMLElement).style.overflow = ""; }
      const dc = contentEl.parentElement;
      if (dc) { (dc as HTMLElement).style.overflow = ""; }
    };
    overlay.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement)?.dataset?.act;
      // 遮罩点击关闭 / titlebar 内的 ✕ 按钮关闭（统一 data-act）
      if (act === "close" || act === "close-overlay") closeOverlay();
    });

    /* ========== 会话历史：居中弹窗（modal，挂到 body 逃逸 overflow:hidden） ========== */
    const sessionModal = document.createElement("div");
    sessionModal.className = "hiword-ai-session-modal";
    sessionModal.style.display = "none";
    document.body.appendChild(sessionModal);
    const openSessionModal = (html: string) => {
      sessionModal.innerHTML = `<div class="hiword-ai-session-modal-mask" data-act="close-modal"></div><div class="hiword-ai-session-modal-card">${html}</div>`;
      sessionModal.style.display = "";
      // 强制重排以触发淡入/缩入动画
      void sessionModal.offsetWidth;
      sessionModal.classList.add("hiword-ai-session-modal--open");
    };
    const closeSessionModal = () => {
      sessionModal.classList.remove("hiword-ai-session-modal--open");
      sessionModal.style.display = "none";
      sessionModal.innerHTML = "";
    };
    sessionModal.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement)?.dataset?.act;
      if (act === "close-modal") closeSessionModal();
    });

    /* ========== 模型下拉切换（Portal 模式：挂到 body 逃逸 overflow:hidden） ========== */
    const closeModelMenu = () => {
      modelMenu.style.display = "none";
      // 归位回原父元素，避免 DOM 漂移
      if (modelMenu.parentElement !== modelBtn?.parentElement) {
        modelBtn?.parentElement?.appendChild(modelMenu);
      }
    };
    modelBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (modelMenu.style.display === "none") {
        const s = this.host.getAiSettings();
        modelMenu.innerHTML = renderModelMenu(s.models, s.model);
        modelMenu.style.display = "";
        // Portal：挂到 body，用 fixed 定位逃逸面板的 overflow:hidden
        document.body.appendChild(modelMenu);
        const btnRect = modelBtn.getBoundingClientRect();
        modelMenu.style.position = "fixed";
        modelMenu.style.top = `${btnRect.bottom + 4}px`;
        modelMenu.style.left = `${btnRect.right - Math.min(220, btnRect.width)}px`;
        modelMenu.style.minWidth = `${Math.max(180, btnRect.width)}px`;
        modelMenu.querySelectorAll(".hiword-ai-model-item").forEach((item) => {
          item.addEventListener("click", async () => {
            const m = (item as HTMLElement).dataset.model || "";
            if (m) {
              await this.host.setModel(m);
              if (modelCurrent) modelCurrent.textContent = m;
            }
            closeModelMenu();
          });
        });
      } else {
        closeModelMenu();
      }
    });
    // 点击外部关闭
    document.addEventListener("click", (e) => {
      if (modelMenu.style.display !== "none" &&
          !(e.target as HTMLElement)?.closest?.(".hiword-ai-model-wrap") &&
          !(e.target as HTMLElement)?.closest?.("#hiword-ai-model-menu")) {
        closeModelMenu();
      }
    });

    /* ========== 文件上传 ========== */
    uploadBtn?.addEventListener("click", () => {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".txt,.md,.markdown,.json,.csv,.log,.js,.ts,.py,.html,.css";
      fileInput.style.display = "none";
      contentEl.appendChild(fileInput);

      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        fileInput.remove();
        if (!file) return;

        // 类型保护：accept 仅为提示，用户仍可选任意文件；非文本类读取会成乱码，故显式拦截
        const textExtRe = /\.(txt|md|markdown|json|csv|log|xml|yml|yaml|html?|js|ts|tsx|jsx|css|py|go|rs|c|cpp|h|hpp|java|sh|sql|toml|ini|cfg)$/i;
        if (!textExtRe.test(file.name) && !(file.type || "").startsWith("text/")) {
          statusEl.textContent = `已忽略非文本文件「${file.name}」`;
          showMessage(`仅支持文本文件（txt/md/代码/json 等），无法读取「${file.name}」`, 4000, "error");
          return;
        }

        // 尺寸保护：超过 2MB 提示
        if (file.size > 2 * 1024 * 1024) {
          statusEl.textContent = "文件过大（>2MB），请选择较小的文本文件。";
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || "");
          if (!text.trim()) {
            statusEl.textContent = "文件内容为空。";
            return;
          }
          const cur = this.getInputMarkdownForPrefill();
          const combined = (cur ? cur + "\n\n" : "") + text;
          this.setInputMarkdown(combined);
          statusEl.textContent = `已上传「${file.name}」（${text.length} 字）`;
          this.focusInput();
        };
        reader.onerror = () => {
          statusEl.textContent = "文件读取失败，请重试。";
        };
        reader.readAsText(file);
      });

      fileInput.click();
    });

    /* ========== 文档搜索 / 添加上下文 ========== */
    docSearchBtn?.addEventListener("click", () => {
      openOverlay(renderDocSearchDialog());
      const panel = overlay.querySelector(".hiword-ai-overlay-panel") as HTMLElement;
      const kwInput = panel.querySelector('[data-field="keyword"]') as HTMLInputElement;
      const listEl = panel.querySelector('[data-field="list"]') as HTMLElement;

      const doSearch = async () => {
        listEl.innerHTML = '<div class="hiword-ai-docsearch-empty">搜索中…</div>';
        const docs = await this.host.searchDocs(kwInput?.value || "");
        listEl.innerHTML = renderDocSearchItems(docs);
        listEl.querySelectorAll(".hiword-ai-docsearch-add").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const docId = (btn.closest(".hiword-ai-docsearch-item") as HTMLElement)?.dataset.docId || "";
            if (!docId) return;
            (btn as HTMLButtonElement).textContent = "读取中…";
            const text = await this.host.getDocText(docId);
            if (text) {
              const cur = this.getInputMarkdownForPrefill();
              const combined = (cur ? cur + "\n\n--- 上下文 ---\n\n" : "") + text;
              this.setInputMarkdown(combined);
              statusEl.textContent = "已添加文档上下文";
            } else {
              statusEl.textContent = "文档内容读取失败";
            }
            closeOverlay();
          });
        });
      };

      panel.querySelector('[data-act="search"]')?.addEventListener("click", doSearch);
      kwInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
      doSearch(); // 初始展示最近文档
    });

    /* ========== 提示词模板 ========== */
    templatesBtn?.addEventListener("click", () => {
      openOverlay(renderPromptPanel(this.host.listPromptTemplates()));
      const panel = overlay.querySelector(".hiword-ai-overlay-panel") as HTMLElement;
      const refresh = () => {
        openOverlay(renderPromptPanel(this.host.listPromptTemplates()));
        bindTemplateList();
      };
      const bindTemplateList = () => {
        const p2 = overlay.querySelector(".hiword-ai-overlay-panel") as HTMLElement;
        p2.querySelectorAll(".hiword-ai-tpl-item").forEach((item) => {
          const id = (item as HTMLElement).dataset.id || "";
          item.querySelector('[data-act="use"]')?.addEventListener("click", () => {
            const tpl = this.host.listPromptTemplates().find((t) => t.id === id);
            if (tpl) {
              // 点击即把提示词注入对话框输入框（追加到现有内容之后），取代原先的「系统提示词」语义
              // 必须用 getInputMarkdownForPrefill：保留 block-ref / 页签卡片的 ((id 'anchor')) 原生语法，
              // 否则经 getInputValue 的占位符替换后会变成 @@REWORD_REF_id@@ 纯文本。
              const cur = this.getInputMarkdownForPrefill();
              const merged = cur ? `${cur}\n\n${tpl.content}` : tpl.content;
              this.setInputMarkdown(merged);
              this.protyle?.focus?.();
              statusEl.textContent = `已填充提示词「${tpl.name}」到输入框`;
              closeOverlay();
            }
          });
          item.querySelector('[data-act="edit"]')?.addEventListener("click", () => {
            const tpl = this.host.listPromptTemplates().find((t) => t.id === id);
            openTemplateEditor(tpl);
          });
          item.querySelector('[data-act="del"]')?.addEventListener("click", async () => {
            await this.host.deletePromptTemplate(id);
            refresh();
          });
        });
        p2.querySelector('[data-act="new"]')?.addEventListener("click", () => openTemplateEditor(undefined));
      };
      const openTemplateEditor = (tpl?: AiPromptTemplate) => {
        openOverlay(`
          <div class="hiword-ai-tpl-editor">
            <div class="hiword-ai-preset-field">
              <label class="hiword-ai-preset-label">模板名称</label>
              <input class="hiword-ai-preset-input" data-field="name" value="${escapeHtml(tpl?.name || "")}" />
            </div>
            <div class="hiword-ai-preset-field">
              <label class="hiword-ai-preset-label">提示词内容</label>
              <textarea class="hiword-ai-preset-textarea" data-field="content" spellcheck="false">${escapeHtml(tpl?.content || "")}</textarea>
            </div>
            <div class="hiword-ai-tpl-editor-actions">
              <button class="hiword-ai-btn hiword-ai-btn--ghost" data-act="cancel">取消</button>
              <button class="hiword-ai-btn hiword-ai-btn--primary" data-act="save">保存</button>
            </div>
          </div>`);
        const ep = overlay.querySelector(".hiword-ai-overlay-panel") as HTMLElement;
        ep.querySelector('[data-act="cancel"]')?.addEventListener("click", () => refresh());
        ep.querySelector('[data-act="save"]')?.addEventListener("click", async () => {
          const name = (ep.querySelector('[data-field="name"]') as HTMLInputElement)?.value?.trim();
          const content = (ep.querySelector('[data-field="content"]') as HTMLTextAreaElement)?.value;
          if (!name) { statusEl.textContent = "请填写模板名称"; return; }
          await this.host.savePromptTemplate({ id: tpl?.id || "", name, content: content || "" });
          refresh();
        });
      };
      bindTemplateList();
    });

    /* ========== 会话历史（新建 / 搜索 / 批量删除） ========== */
    const sessionsBtn = contentEl.querySelector("#hiword-ai-sessions") as HTMLButtonElement;
    const loadSession = async (id: string) => {
      const s = sessionStore.get(id);
      if (!s) return;
      this.currentSessionId = id;
      // 同步 store 激活指针：否则后续 render() 触发的 restoreLastSession 会用陈旧 active 覆盖当前会话，造成切换回弹渲染失效
      sessionStore.setActive(id);
      this.chatHistory = s.messages.map((m) => ({ role: m.role, content: m.content }));
      messagesEl.innerHTML = "";
      s.messages.forEach((m, idx) => {
        const isUser = m.role === "user";
        const msg = document.createElement("div");
        msg.className = `hiword-ai-msg hiword-ai-msg--${isUser ? "user" : "result"}`;
        msg.dataset.index = String(idx);
        msg.dataset.role = m.role;
        const contentHtml = isUser
          ? this.renderUserMessage(m.content)
          : (m.html ?? renderWithLute(m.content));
        msg.innerHTML = `
          <div class="hiword-ai-msg-avatar">${isUser ? "我" : "AI"}</div>
          <div class="hiword-ai-msg-content b3-typography">
            ${contentHtml}
            ${renderMessageToolbar(m.role)}
          </div>
        `;
        messagesEl.appendChild(msg);
        // 重载的 assistant 消息同样做思源样式增强，保证与现场一致
        if (!isUser) {
          // 原始 markdown 存入 JS Map（替代 data-raw-md 属性，降低 innerHTML 解析负担，P3-2）
          this.rawMdByIndex.set(idx, m.content);
          enhanceSiYuanRender(msg);
          this.bindResult(msg, undefined);
        }
        this.bindMessageToolbar(msg, idx, m.role);
      });
      if (welcomeEl) welcomeEl.style.display = "none";
      bodyEl.scrollTop = bodyEl.scrollHeight;
      statusEl.textContent = `已载入会话「${s.title}」`;
    };
    const openSessionsPanel = async () => {
      let selected = new Set<string>();
      let kw = "";
      const render = async () => {
        const sessions = sessionStore.list();
        const filtered = kw
          ? sessions.filter((s) => s.title.toLowerCase().includes(kw.toLowerCase()))
          : sessions;
        openSessionModal(`
          <div class="hiword-ai-session-panel">
            <div class="hiword-ai-session-head">
              <span class="hiword-ai-session-title">💬 会话历史</span>
              <button class="hiword-ai-btn hiword-ai-btn--primary" data-act="new">＋ 新建会话</button>
              <button class="hiword-ai-btn hiword-ai-session-close" data-act="close-modal" title="关闭">✕</button>
            </div>
            <input class="hiword-ai-session-search" data-field="kw" placeholder="搜索会话…" value="${escapeHtml(kw)}" />
            <div class="hiword-ai-session-list" data-field="list">
              ${
                filtered.length
                  ? filtered.map((s) => `
                <div class="hiword-ai-session-item${selected.has(s.id) ? " sel" : ""}" data-id="${escapeHtml(s.id)}">
                  <input type="checkbox" data-act="check" ${selected.has(s.id) ? "checked" : ""} />
                  <div class="hiword-ai-session-main">
                    <div class="hiword-ai-session-name" data-field="name">${escapeHtml(s.title)}</div>
                    <div class="hiword-ai-session-sub">${s.messages.length} 条 · ${new Date(s.updatedAt).toLocaleString()}</div>
                  </div>
                  <button class="hiword-ai-session-rename" data-act="rename" title="重命名" aria-label="重命名会话">✏️</button>
                </div>`).join("")
                  : `<div class="hiword-ai-session-empty">还没有会话，点「＋ 新建会话」开始</div>`
              }
            </div>
            <div class="hiword-ai-session-actions" ${selected.size ? "" : 'style="display:none"'}>
              <span class="hiword-ai-session-count">已选 ${selected.size} 个</span>
              <button class="hiword-ai-btn hiword-ai-btn--danger" data-act="del">批量删除</button>
            </div>
          </div>`);
        bind();
      };
      const bind = () => {
        const p = sessionModal.querySelector(".hiword-ai-session-modal-card") as HTMLElement;
        if (!p) return;
        p.querySelector('[data-act="new"]')?.addEventListener("click", async () => {
          const s = sessionStore.create();
          await loadSession(s.id);
          closeSessionModal();
        });
        p.querySelector('[data-act="close-drawer"]')?.addEventListener("click", () => closeSessionModal());
        const search = p.querySelector('[data-field="kw"]') as HTMLInputElement;
        search?.addEventListener("input", () => { kw = search.value; void render(); });
        p.querySelectorAll(".hiword-ai-session-item").forEach((rawItem) => {
          const item = rawItem as HTMLElement;
          const id = item.dataset.id || "";
          const checkbox = item.querySelector('[data-act="check"]') as HTMLInputElement | null;
          checkbox?.addEventListener("change", (e) => {
            e.stopPropagation();
            if (checkbox.checked) selected.add(id); else selected.delete(id);
            void render();
          });
          checkbox?.addEventListener("click", (e) => {
            e.stopPropagation();
          });
          item.addEventListener("click", async (e) => {
            // 点击重命名按钮：进入内联编辑模式（不切换会话）
            if ((e.target as HTMLElement).closest('[data-act="rename"]')) {
              e.stopPropagation();
              beginRename(item, id);
              return;
            }
            if ((e.target as HTMLElement).closest('[data-act="check"]')) return;
            e.stopPropagation();
            await loadSession(id);
            closeSessionModal();
          });
        });

        /** 进入内联重命名：把标题替换为输入框，Enter 保存、Esc 取消、失焦保存 */
        const beginRename = (item: HTMLElement, id: string) => {
          if (item.classList.contains("hiword-ai-session-item--editing")) return;
          const sess = sessionStore.get(id);
          if (!sess) return;
          const nameEl = item.querySelector('[data-field="name"]') as HTMLElement | null;
          if (!nameEl) return;
          const original = sess.title;
          item.classList.add("hiword-ai-session-item--editing");
          nameEl.innerHTML = `<input class="hiword-ai-session-rename-input" data-field="rename-input" value="${escapeHtml(original)}" />`;
          const input = nameEl.querySelector('[data-field="rename-input"]') as HTMLInputElement;
          input.focus();
          input.select();
          let settled = false;
          const finish = (commit: boolean) => {
            if (settled) return;
            settled = true;
            const newTitle = (input.value || "").trim();
            // 取消、或与原标题相同、或为空：直接恢复展示
            if (!commit || !newTitle || newTitle === original) {
              nameEl.textContent = sess.title;
            } else {
              sessionStore.rename(id, newTitle);
              // 若是当前激活会话，同步头部状态栏显示
              if (this.currentSessionId === id) {
                statusEl.textContent = `已重命名为「${newTitle}」`;
              }
            }
            item.classList.remove("hiword-ai-session-item--editing");
          };
          input.addEventListener("keydown", (ev) => {
            ev.stopPropagation();
            if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
            else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
          });
          input.addEventListener("blur", () => finish(true));
          // 输入框内的点击不能冒泡触发 item 的「打开会话」
          input.addEventListener("click", (ev) => ev.stopPropagation());
        };
        p.querySelector('[data-act="del"]')?.addEventListener("click", async () => {
          const ok = await confirmDelete(`确认删除选中的 ${selected.size} 个会话？`);
          if (!ok) return;
          sessionStore.delete([...selected]);
          selected.clear();
          void render();
        });
      };
      await render();
    };
    sessionsBtn?.addEventListener("click", () => void openSessionsPanel());

    /* ========== 新建会话（头部 ＋ 按钮，直接新建不弹窗） ========== */
    const newSessionBtn = contentEl.querySelector("#hiword-ai-new-session") as HTMLButtonElement;
    newSessionBtn?.addEventListener("click", async () => {
      // 新会话清零会话内 token 统计（弹窗说明「仅会话内累计」）
      this.sessionUsage = { prompt: 0, completion: 0 };
      this.renderTokenRing();
      const s = sessionStore.create();
      await loadSession(s.id);
      statusEl.textContent = `已新建会话「${s.title}」`;
      this.focusInput();
    });

    /* ========== 预设系统 ========== */
    presetsBtn?.addEventListener("click", () => {
      const activeId = this.host.getActivePreset()?.id || "";
      const initial = this.host.getActivePreset() || {
        id: "", name: "新预设", templateType: "learning", contextMessages: -1, temperature: 0.3,
        temperatureEnabled: false, systemPrompt: "",
        autoCollectWords: false, autoAnnotateSentences: false,
      } as AiPreset;

      /** 渲染预设编辑表单并绑定事件（内部复用） */
      const showPresetPanel = (preset: AiPreset, isNew: boolean) => {
        const activeId = this.host.getActivePreset()?.id || "";
        openOverlay(renderPresetPanel(preset, { activeId, isNew }));
        const panel = overlay.querySelector(".hiword-ai-overlay-panel") as HTMLElement;

        const sliderCtx = panel.querySelector('[data-field="contextMessages"]') as HTMLInputElement;
        const ctxVal = panel.querySelector('[data-val="context"]') as HTMLElement;
        sliderCtx?.addEventListener("input", () => {
          const v = parseInt(sliderCtx.value, 10);
          if (ctxVal) ctxVal.textContent = v === -1 ? "无限制" : String(v);
        });
        const tempSlider = panel.querySelector('[data-field="temperature"]') as HTMLInputElement;
        const tempVal = panel.querySelector('[data-val="temp"]') as HTMLElement;
        tempSlider?.addEventListener("input", () => { if (tempVal) tempVal.textContent = tempSlider.value; });

        const readPresetForm = (): AiPreset => {
          const q = (f: string) => panel.querySelector(`[data-field="${f}"]`) as HTMLInputElement | null;
          return {
            id: preset.id,
            name: q("name")?.value?.trim() || "未命名预设",
            templateType: (panel.querySelector('[data-field="templateType"]') as HTMLSelectElement | null)?.value === "chat" ? "chat" : "learning",
            contextMessages: parseInt(q("contextMessages")?.value || "-1", 10),
            temperature: parseFloat(q("temperature")?.value || "0.3"),
            temperatureEnabled: !!(q("temperatureEnabled") as HTMLInputElement)?.checked,
            systemPrompt: (panel.querySelector('[data-field="systemPrompt"]') as HTMLTextAreaElement | null)?.value || "",
            autoCollectWords: !!(q("autoCollectWords") as HTMLInputElement)?.checked,
            autoAnnotateSentences: !!(q("autoAnnotateSentences") as HTMLInputElement)?.checked,
          };
        };

        panel.querySelector('[data-act="save-preset"]')?.addEventListener("click", async () => {
          const p = readPresetForm();
          await this.host.savePreset(p);
          this.activePreset = p; // 保存即激活，本次精读生效
          statusEl.textContent = "预设已保存并激活";
          closeOverlay();
          syncPresetButton();
        });

        panel.querySelector('[data-act="close-preset"]')?.addEventListener("click", async () => {
          await this.host.setActivePreset("");
          this.activePreset = undefined;
          statusEl.textContent = "已关闭预设，恢复自由对话";
          closeOverlay();
          syncPresetButton();
        });

        panel.querySelector('[data-act="delete-preset"]')?.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (preset.id) {
            await this.host.deletePreset(preset.id);
            this.activePreset = undefined;
          }
          statusEl.textContent = "预设已删除";
          showPresetList();
          syncPresetButton();
        });

        panel.querySelector('[data-act="preset-list"]')?.addEventListener("click", () => showPresetList());
      };

      /** 渲染预设列表（2026-08-16 重构：使用 renderPresetListView，对齐参考样式） */
      let listKw = "";
      const showPresetList = () => {
        const presets = this.host.listPresets();
        const activeId = this.host.getActivePreset()?.id || "";
        openOverlay(renderPresetListView(presets, activeId, { keyword: listKw }));
        const lp = overlay.querySelector(".hiword-ai-overlay-panel") as HTMLElement;

        // 搜索框输入 → 局部重渲列表项
        const search = lp.querySelector('[data-field="keyword"]') as HTMLInputElement;
        search?.addEventListener("input", () => {
          listKw = search.value;
          const listEl = lp.querySelector('[data-field="list"]') as HTMLElement;
          if (!listEl) return;
          const kw = listKw.trim().toLowerCase();
          const filtered = kw ? presets.filter((p) => p.name.toLowerCase().includes(kw)) : presets;
          if (filtered.length) {
            listEl.innerHTML = filtered.map((p) => {
              const isActive = p.id === activeId;
              return `<div class="hiword-ai-preset-item${isActive ? " active" : ""}" data-id="${escapeHtml(p.id)}">
                <div class="hiword-ai-preset-item-main" data-act="open">
                  <div class="hiword-ai-preset-item-name">${escapeHtml(p.name)}${isActive ? '<span class="hiword-ai-preset-active-chip">· 使用中</span>' : ""}</div>
                  <div class="hiword-ai-preset-item-sub">上下文消息数: ${p.contextMessages === -1 ? "无限制" : p.contextMessages + " 条"} | 聊天模式: ${p.templateType === "learning" ? "结构化精读" : "问答模式"}</div>
                </div>
                <div class="hiword-ai-preset-item-actions">
                  <button class="hiword-ai-preset-icon" data-act="edit" title="编辑">✎</button>
                  <button class="hiword-ai-preset-icon" data-act="del" title="删除">🗑</button>
                </div>
              </div>`;
            }).join("");
            bindListActions();
          } else {
            listEl.innerHTML = `<div class="hiword-ai-preset-empty">${
              presets.length === 0
                ? "还没有预设，点击「＋ 新建预设」创建你的第一个预设"
                : "没有匹配「" + escapeHtml(listKw) + "」的预设"
            }</div>`;
          }
        });

        bindListActions();
      };

      /** 列表卡片操作绑定（抽出来供搜索后局部刷新复用） */
      const bindListActions = () => {
        const lp = overlay.querySelector(".hiword-ai-overlay-panel") as HTMLElement;
        if (!lp) return;
        lp.querySelectorAll(".hiword-ai-preset-item").forEach((item) => {
          const id = (item as HTMLElement).dataset.id || "";
          item.querySelector('[data-act="edit"]')?.addEventListener("click", (e) => {
            e.stopPropagation();
            const p = this.host.listPresets().find((x) => x.id === id);
            if (p) showPresetPanel(p, false);
          });
          item.querySelector('[data-act="del"]')?.addEventListener("click", async (e) => {
            e.stopPropagation();
            const p = this.host.listPresets().find((x) => x.id === id);
            if (!p) return;
            const ok = await confirmDelete(`删除预设「${p.name}」？\n若是当前激活预设，删除后将恢复自由对话。`);
            if (!ok) return;
            await this.host.deletePreset(id);
            this.activePreset = undefined;
            statusEl.textContent = "预设已删除";
            listKw = "";
            showPresetList();
            syncPresetButton();
          });
          item.querySelector('[data-act="open"]')?.addEventListener("click", () => {
            const p = this.host.listPresets().find((x) => x.id === id);
            if (p) {
              this.host.setActivePreset(id); // 选中即激活
              this.activePreset = p;
              showPresetPanel(p, false);
              syncPresetButton();
            }
          });
        });
        lp.querySelector('[data-act="new"]')?.addEventListener("click", () => {
          listKw = "";
          showPresetPanel({
            id: "", name: "新预设", templateType: "learning", contextMessages: -1, temperature: 0.3,
            temperatureEnabled: false, systemPrompt: "",
            autoCollectWords: false, autoAnnotateSentences: false,
          } as AiPreset, true);
        });
      };

      // 默认进入「预设列表」视图（2026-08-16 重构，与参考样式一致）
      showPresetList();
    });



    /* ========== 输入区向上拖拽拉伸 + 2026-08-22 新增：chevron 点击收展 ========== */
    const resizer = contentEl.querySelector("#hiword-ai-resizer") as HTMLElement;
    const toggleBtn = contentEl.querySelector("#hiword-ai-resizer-toggle") as HTMLElement | null;
    const panelEl = contentEl.querySelector(".hiword-ai-panel") as HTMLElement;
    const MIN_FOOTER_H = 120;
    const FOOTER_H_KEY = "reword-ai-footer-height";
    const COLLAPSE_KEY = "reword-ai-footer-collapsed";  // 2026-08-22 新增

    // 2026-08-22 改：纯函数 applyCollapsedState（吃 localStorage）,便于单测
    const applyCollapsedState = (panel: HTMLElement | null, footer: HTMLElement | null, btn: HTMLElement | null, collapsed: boolean, lastH: number) => {
      if (!panel || !footer || !btn) return;
      if (collapsed) {
        panel.classList.add("hiword-ai-panel--collapsed");
        footer.style.height = "0px";
        footer.style.minHeight = "0";
        footer.style.overflow = "hidden";
        btn.setAttribute("aria-label", "展开输入区");
        btn.textContent = "▴";
      } else {
        panel.classList.remove("hiword-ai-panel--collapsed");
        if (lastH >= MIN_FOOTER_H) footer.style.height = `${Math.round(lastH)}px`;
        footer.style.minHeight = "";
        footer.style.overflow = "";
        btn.setAttribute("aria-label", "收起输入区");
        btn.textContent = "▾";
      }
      try { localStorage.setItem(COLLAPSE_KEY, String(collapsed)); } catch { /* ignore */ }
    };

    /** 应用高度并持久化 */
    const applyFooterHeight = (h: number) => {
      if (!footerEl) return;
      footerEl.style.height = `${Math.round(h)}px`;
    };
    const savedH = Number(localStorage.getItem(FOOTER_H_KEY) || "0");
    if (savedH >= MIN_FOOTER_H && panelEl) {
      const maxH = Math.max(MIN_FOOTER_H, Math.round(panelEl.clientHeight * 0.6));
      applyFooterHeight(Math.min(savedH, maxH));
    }

    // 2026-08-22 新增：初始化收起态
    let isCollapsed = false;
    try { isCollapsed = localStorage.getItem(COLLAPSE_KEY) === "true"; } catch { /* ignore */ }
    if (isCollapsed && footerEl && panelEl && toggleBtn) {
      applyCollapsedState(panelEl, footerEl, toggleBtn, true, savedH);
    }

    let dragging = false;
    let startY = 0;
    let startH = 0;
    let rafId = 0;
    let pendingH = 0;

    const doResize = () => {
      rafId = 0;
      if (!footerEl || !panelEl) return;
      const maxH = Math.max(MIN_FOOTER_H, Math.round(panelEl.clientHeight * 0.6));
      let h = pendingH;
      if (h < MIN_FOOTER_H) h = MIN_FOOTER_H;
      if (h > maxH) h = maxH;
      footerEl.style.height = `${h}px`;
    };

    const onResizeMove = (ev: PointerEvent) => {
      if (!dragging) return;
      // 向上拖：起始 Y 大于当前 Y → 输入区变高
      const dy = startY - ev.clientY;
      pendingH = startH + dy;
      if (!rafId) rafId = requestAnimationFrame(doResize);
    };

    const onResizeEnd = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("pointermove", onResizeMove);
      document.removeEventListener("pointerup", onResizeEnd);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      resizer.classList.remove("hiword-ai-resizer--active");
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      doResize();
      // 2026-08-22 改：仅在展开态才写 height（避免收起时把 0 写回 localStorage）
      if (!isCollapsed) {
        const finalH = footerEl ? footerEl.offsetHeight : 0;
        if (finalH > 0) localStorage.setItem(FOOTER_H_KEY, String(finalH));
      }
    };

    resizer?.addEventListener("pointerdown", (ev: PointerEvent) => {
      ev.preventDefault();
      if (!footerEl) return;
      dragging = true;
      startY = ev.clientY;
      startH = footerEl.offsetHeight;
      this.disposables.addEventListener(document, "pointermove", onResizeMove);
      this.disposables.addEventListener(document, "pointerup", onResizeEnd);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "row-resize";
      resizer.classList.add("hiword-ai-resizer--active");
    });

    // 2026-08-22 新增：chevron 点击收展
    toggleBtn?.addEventListener("click", (e) => {
      e.stopPropagation();  // 不触发 resizer 的 pointerdown
      if (!footerEl || !panelEl || !toggleBtn) return;
      if (!isCollapsed) {
        // 收起前记下当前高度
        const h = footerEl.offsetHeight;
        if (h >= MIN_FOOTER_H) {
          try { localStorage.setItem(FOOTER_H_KEY, String(h)); } catch { /* ignore */ }
        }
        applyCollapsedState(panelEl, footerEl, toggleBtn, true, h);
        isCollapsed = true;
      } else {
        const lastH = Number(localStorage.getItem(FOOTER_H_KEY) || "0") || MIN_FOOTER_H;
        applyCollapsedState(panelEl, footerEl, toggleBtn, false, lastH);
        isCollapsed = false;
      }
    });

    /* ========== AI 消息选字 → 复制 / 识别英文加入词库 ========== */

    // 浮动工具栏 DOM
    const selToolbar = document.createElement("div");
    selToolbar.className = "hiword-ai-sel-toolbar";
    selToolbar.id = "hiword-ai-sel-toolbar";
    selToolbar.innerHTML = `
      <button class="hiword-ai-sel-btn" id="hiword-ai-sel-copy" title="复制选中文字">📋 复制</button>
      <button class="hiword-ai-sel-btn hiword-ai-sel-btn--vocab" id="hiword-ai-sel-addvocab" title="识别选中的英文单词，弹出词库分类对话框后批量加入">➕ 加入词库</button>
    `;
    contentEl.appendChild(selToolbar);

    /** 显示/隐藏选字工具栏 */
    const showSelToolbar = (x: number, y: number) => {
      selToolbar.style.left = `${Math.min(x, (contentEl.clientWidth || 400) - 220)}px`;
      selToolbar.style.top = `${y - 40}px`; // 选区上方显示
      selToolbar.classList.add("hiword-ai-sel-toolbar--visible");
    };
    const hideSelToolbar = () => {
      selToolbar.classList.remove("hiword-ai-sel-toolbar--visible");
    };

    // 监听 AI 消息区的 mouseup（选字检测）
    messagesEl?.addEventListener("mouseup", (e: MouseEvent) => {
      // 延迟一帧等 selection 更新
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() || "";
        if (!text || text.length < 2) { hideSelToolbar(); return; }

        // 确保选区在消息内容内（不在输入框）
        const range = sel?.getRangeAt(0);
        if (!range || !messagesEl.contains(range.commonAncestorContainer)) {
          hideSelToolbar(); return;
        }

        const rect = range.getBoundingClientRect();
        const bodyRect = bodyEl.getBoundingClientRect();
        showSelToolbar(
          rect.left - bodyRect.left + rect.width / 2,
          rect.top - bodyRect.top
        );
      });
    });

    // 点击其他区域隐藏工具栏
    contentEl.addEventListener("mousedown", (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.("#hiword-ai-sel-toolbar")) {
        hideSelToolbar();
      }
    });

    // 复制按钮
    contentEl.querySelector("#hiword-ai-sel-copy")?.addEventListener("click", () => {
      const sel = window.getSelection()?.toString().trim() || "";
      if (sel) this.host.copyText(sel);
      hideSelToolbar();
    });

    // 「加入词库」按钮 → 自动识别选区中的英文/中文单词，复用词库「提取单词到词库」对话框
    //                   选 L1 单词本 + L2 子类后批量入库（与文档框选/拖放走同一套视觉与交互）
    contentEl.querySelector("#hiword-ai-sel-addvocab")?.addEventListener("click", () => {
      const selText = window.getSelection()?.toString().trim() || "";
      if (!selText) { hideSelToolbar(); return; }
      hideSelToolbar();
      try {
        this.host.openVocabExtractDialog(selText);
      } catch (e) {
        getLogger().error("选区加入词库失败", { operation: "加入词库", error: e as Error });
        showMessage("加入词库失败，请重试", 3000, "error");
      }
    });

    /* ========== AI 输出区右键上下文菜单（复制 / 查词 / 加词库） ========== */

    // 自定义浮层菜单 DOM（懒创建，挂到面板根，避免被消息区滚动裁剪）
    let ctxMenu: HTMLElement | null = contentEl.querySelector("#hiword-ai-ctx-menu");
    if (!ctxMenu) {
      ctxMenu = document.createElement("div");
      ctxMenu.className = "hiword-ai-ctx-menu";
      ctxMenu.id = "hiword-ai-ctx-menu";
      ctxMenu.innerHTML = `
        <div class="hiword-ai-ctx-item" data-act="copy">📋 复制</div>
        <div class="hiword-ai-ctx-item" data-act="lookup">🔍 查词</div>
        <div class="hiword-ai-ctx-item" data-act="vocab">➕ 加入词库</div>
      `;
      contentEl.appendChild(ctxMenu);
    }
    const hideCtxMenu = () => ctxMenu?.classList.remove("hiword-ai-ctx-menu--visible");

    // 从右键目标提取单词（无选区时：取点击元素文本中的首个英文/连字符词）
    const pickWordFromTarget = (target: HTMLElement | null): string => {
      if (!target) return "";
      const t = target.textContent || "";
      const m = t.match(/[A-Za-z][A-Za-z'’-]*/);
      return m ? m[0] : "";
    };

    messagesEl?.addEventListener("contextmenu", (e: MouseEvent) => {
      e.preventDefault();
      const sel = window.getSelection()?.toString().trim() || "";
      // 复制内容：优先选区，否则取点击元素首个单词
      const copyText = sel || pickWordFromTarget(e.target as HTMLElement);
      // 查词 / 加词库用词：选区若无空格则整段，否则取首个单词
      const word = sel ? (sel.includes(" ") ? pickWordFromTarget(e.target as HTMLElement) : sel) : pickWordFromTarget(e.target as HTMLElement);
      if (!copyText && !word) { hideCtxMenu(); return; }

      const items = ctxMenu?.querySelectorAll(".hiword-ai-ctx-item") || [];
      items.forEach((it) => {
        const act = (it as HTMLElement).dataset.act;
        const disabled = (act === "lookup" && !word) || (act === "vocab" && !word);
        (it as HTMLElement).classList.toggle("hiword-ai-ctx-item--disabled", !!disabled);
      });

      if (ctxMenu) {
        const rect = contentEl.getBoundingClientRect();
        const x = Math.min(e.clientX - rect.left, contentEl.clientWidth - 140);
        const y = Math.min(e.clientY - rect.top, contentEl.clientHeight - 110);
        ctxMenu.style.left = `${Math.max(4, x)}px`;
        ctxMenu.style.top = `${Math.max(4, y)}px`;
        ctxMenu.classList.add("hiword-ai-ctx-menu--visible");
      }

      // 暂存当前上下文，供菜单项点击使用
      (ctxMenu as any).__ctx = { copyText, word };
    });

    // 菜单项点击
    ctxMenu?.querySelectorAll(".hiword-ai-ctx-item").forEach((it) => {
      it.addEventListener("click", () => {
        const act = (it as HTMLElement).dataset.act;
        const ctx = (ctxMenu as any).__ctx || {};
        hideCtxMenu();
        if ((it as HTMLElement).classList.contains("hiword-ai-ctx-item--disabled")) return;

        if (act === "copy") {
          if (ctx.copyText) { this.host.copyText(ctx.copyText); showMessage("已复制", 1500, "info"); }
        } else if (act === "lookup") {
          if (ctx.word) this.host.lookupWordInDict(ctx.word);
        } else if (act === "vocab") {
          if (!ctx.word) return;
          const vocab = this.host.getVocabStore();
          if (!vocab) { showMessage("词库模块未就绪", 2000, "error"); return; }
          void vocab.upsertWord(ctx.word).then((res: any) => {
            if (res.added) showMessage(`已加入词库：${ctx.word}`, 2000, "info");
            else if (res.updated) showMessage(`已更新词库：${ctx.word}`, 2000, "info");
            else showMessage(`已在词库中：${ctx.word}`, 2000, "info");
          }).catch(() => showMessage("加入词库失败，请重试", 3000, "error"));
        }
      });
    });

    // 点击别处 / 滚动时隐藏菜单
    contentEl.addEventListener("mousedown", (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.("#hiword-ai-ctx-menu")) hideCtxMenu();
    });
    contentEl.addEventListener("scroll", hideCtxMenu, true);

    /* ========== 批注查询面板 ========== */

    const queryPanel = contentEl.querySelector("#hiword-ai-query-panel") as HTMLElement;
    const queryBtn = contentEl.querySelector("#hiword-ai-query") as HTMLButtonElement;
    const queryClose = contentEl.querySelector("#hiword-ai-query-close") as HTMLButtonElement;
    const qKeyword = contentEl.querySelector("#hiword-ai-q-keyword") as HTMLInputElement;
    const qColor = contentEl.querySelector("#hiword-ai-q-color") as HTMLSelectElement;
    const qDoc = contentEl.querySelector("#hiword-ai-q-doc") as HTMLSelectElement;
    const qOrigin = contentEl.querySelector("#hiword-ai-q-origin") as HTMLSelectElement;
    const qFrom = contentEl.querySelector("#hiword-ai-q-from") as HTMLInputElement;
    const qTo = contentEl.querySelector("#hiword-ai-q-to") as HTMLInputElement;
    const qRunBtn = contentEl.querySelector("#hiword-ai-q-run") as HTMLButtonElement;
    const qStatus = contentEl.querySelector("#hiword-ai-query-status") as HTMLElement;
    const qResults = contentEl.querySelector("#hiword-ai-query-results") as HTMLElement;
    const qActions = contentEl.querySelector("#hiword-ai-query-actions") as HTMLElement;
    const qSendBtn = contentEl.querySelector("#hiword-ai-q-send") as HTMLButtonElement;
    const qCount = contentEl.querySelector("#hiword-ai-q-count") as HTMLElement;

    /** 缓存上一次查询结果，供「发送给 AI」使用 */
    let lastQueryResult: AnnotationQueryResult | null = null;

    /** 打开查询面板 */
    const openQueryPanel = async () => {
      queryPanel.classList.add("hiword-ai-query-panel--open");
      // 加载筛选选项
      await this.loadQueryFilters(qColor, qDoc);
      // 如果还没有查过且有关键词，自动执行一次空条件查询
      if (!lastQueryResult) {
        qRunBtn.click();
      }
    };

    /** 关闭查询面板 */
    const closeQueryPanel = () => {
      queryPanel.classList.remove("hiword-ai-query-panel--open");
    };

    queryBtn?.addEventListener("click", () => openQueryPanel());
    queryClose?.addEventListener("click", closeQueryPanel);

    // 执行查询
    qRunBtn?.addEventListener("click", async () => {
      qStatus.textContent = "查询中…";
      qRunBtn.disabled = true;

      try {
        const query: AnnotationQuery = {};
        if (qKeyword?.value.trim()) query.keyword = qKeyword.value.trim();
        if (qColor?.value) query.color = qColor.value;
        if (qDoc?.value) query.docId = qDoc.value;
        if (qOrigin?.value) query.origin = qOrigin.value as "manual" | "ai";
        if (qFrom?.value) query.from = new Date(qFrom.value).toISOString();
        if (qTo?.value) query.to = new Date(qTo.value + "T23:59:59.999Z").toISOString();
        query.limit = 50;

        lastQueryResult = await this.host.queryAnnotations(query);

        // 渲染结果
        this.renderQueryResults(qResults, lastQueryResult);

        qStatus.textContent = `找到 ${lastQueryResult.total} 条批注（显示前 ${lastQueryResult.items.length} 条）`;
        qActions.style.display = lastQueryResult.items.length > 0 ? "" : "none";
        qCount.textContent = `已选 ${lastQueryResult.items.length} 条`;
      } catch (e: any) {
        qStatus.textContent = "查询失败：" + (e?.message || e);
        qActions.style.display = "none";
      } finally {
        qRunBtn.disabled = false;
      }
    });

    // 发送给 AI 讲解
    qSendBtn?.addEventListener("click", () => {
      if (!lastQueryResult?.items.length) return;

      closeQueryPanel();

      // 将查询结果格式化后填入输入框
      const aiText = formatAnnotationsForAi(lastQueryResult);
      this.setInputMarkdown(
        `请根据以下我的批注记录进行讲解：\n\n${aiText}\n\n请逐条分析每条批注的要点，并给出综合学习建议。`
      );
      this.focusInput();
      bodyEl.scrollTop = bodyEl.scrollHeight;

      // 自动触发精读（可选：用户也可以手动点发送）
      statusEl.textContent = `已加载 ${lastQueryResult!.items.length} 条批注到输入框，点击「AI 精读」或按 ${this.shortcutHint()} 发送`;
    });

    // 回车键触发查询
    qKeyword?.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        qRunBtn?.click();
      }
    });

    /* ========== 快捷键与按钮事件 ========== */

    // Ctrl/Cmd + Enter 在文本框内快捷精读
    input?.addEventListener("keydown", (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        runBtn?.click();
      }
    });

    // 发送按钮 = 精读
    sendBtn?.addEventListener("click", () => runBtn?.click());

    // 复制全文
    copyAllBtn?.addEventListener("click", () => {
      const text = messagesEl?.innerText?.trim() || "";
      if (!text || !messagesEl?.children.length) {
        statusEl.textContent = "暂无可复制的结果。";
        return;
      }
      this.host.copyText(text);
      statusEl.textContent = "已复制全文到剪贴板。";
    });

    // AI 设置
    contentEl.querySelector("#hiword-ai-settings")?.addEventListener("click", () => {
      this.host.openAiSettings();
    });

      readBtn?.addEventListener("click", async () => {
      const src = this.host.getDeepReadSource();
      if (!src) {
        statusEl.textContent = "未定位到当前块/选区，请先在文档中点选。";
        return;
      }
      if (src.text) {
        this.setInputMarkdown(src.text);
        statusEl.textContent = `已读取（${src.text.length} 字）`;
        return;
      }
      if (src.blockId) {
        statusEl.textContent = "读取整块中…";
        readBtn.disabled = true;
        const md = await this.host.fetchBlockText(src.blockId);
        readBtn.disabled = false;
        if (md) {
          this.setInputMarkdown(md);
          statusEl.textContent = `已读取整块（${md.length} 字）`;
        } else {
          statusEl.textContent = "读取整块失败（可能无访问权限）。";
        }
      } else {
        statusEl.textContent = "无可用文本。";
      }
    });

    runBtn?.addEventListener("click", async () => {
      try {
        // 生成中：点击 = 停止生成
        if (this.aiBusy) {
          // 正常生成中（按钮为「停止」态）：abort 后交给 finally 恢复按钮态。
          // 注意不能在此强制重置——生成超过 30s 的长文时，强制重置会与 finally 抢跑，
          // 导致按钮提前恢复成「AI 精读」而后台请求仍在跑，用户误以为已停止。
          if (runBtn.classList.contains("hiword-ai-btn--stop")) {
            this.aiAbort?.abort();
            statusEl.textContent = "正在停止上一次生成…";
            return;
          }
          // 自愈：aiBusy 但按钮已非「停止」态（说明 finally 未执行导致状态卡死超过 30s）→ 强制恢复
          if (this._busySince && Date.now() - this._busySince > 30_000) {
            getLogger().warn("aiBusy 卡死超过 30s，强制重置发送状态");
            this.aiBusy = false;
            this._busySince = null;
            this.aiAbort = null;
            this.setInputDisabled(false);
            runBtn.disabled = false;
            runBtn.classList.remove("hiword-ai-btn--stop");
            const rl = runBtn.querySelector("span:last-child");
            if (rl) rl.textContent = "AI 精读";
            runBtn.title = "AI 精读";
            sendBtn.disabled = false;
            sendBtn.classList.remove("hiword-ai-send--stop");
            sendBtn.title = "发送精读";
            statusEl.textContent = "发送状态已重置，请重新点击发送。";
            return;
          }
          return;
        }
        const baseSettings = this.host.getAiSettings();
      // 应用预设 / 模板的临时覆盖（模板优先于预设，预设优先于全局）
      const settings = { ...baseSettings };
      if (this.activePreset?.systemPrompt) {
        settings.promptTemplate = this.activePreset.systemPrompt;
      }
      if (this.activePreset?.temperatureEnabled) {
        settings.temperature = this.activePreset.temperature;
      }
      if (!settings.enabled) {
        statusEl.textContent = "AI 未启用：请在 ⚙ 设置中开启并填写 API。";
        return;
      }
      if (!settings.apiKey) {
        statusEl.textContent = "缺少 API Key：请在 ⚙ 设置中填写。";
        return;
      }
      const text = this.getInputValue();
      if (!text) {
        statusEl.textContent = "请先填写或读取要精读的英文。";
        return;
      }
      // 2026-08-22 许可证已封存：原「requireLicense("ai-deep-read")」门禁已移除（恢复时在发送链路最前方加回）
      // 发送链路分叉：
      //   UI 路径：cleanForAi 把 @@REWORD_REF_id@@ 占位符 → ((id 'anchor')) → renderUserMessage 渲染折叠卡片。
      //   AI 路径：expandPlaceholdersAsync 直接把占位符 → refKramdownById 中拖入时预取的完整 kramdown 正文。
      //     不依赖 Lute 序列化 block-ref 节点，彻底绕开列表块 anchor 中 { / 数字. 等字符导致的截断。
      //     历史会话中的 ((id 'anchor')) 仍由旧 expandBlockRefs 兜底展开。
      const cleanText = this.cleanForAi(text);
      let expanded = await this.expandPlaceholdersAsync(text);
      expanded = await this.expandBlockRefs(expanded);
      // 2026-08-21 A 任务 v2：把占位卡 ((docId '📄 文档 XXXXXX')) 展开为思源 SQL 实时正文
      expanded = await this.expandDocRefs(expanded);
      // 标题直接取自源文档（不再有用户可编辑的输入框）；无源标题则不传
      const title = (this.host.getDeepReadSource() || {}).title?.trim() || undefined;
      const blockId = (this.host.getDeepReadSource() || {}).blockId;

      // 内容已捕获为本地快照（cleanText/expanded），立即清空输入框，避免用户手动删除；
      // 即使后续请求失败，用户消息气泡仍在，可点「编辑」回填
      this.setInputMarkdown("");

      // 进入加载态（生成中：按钮切换为「停止」）
      hideWelcome();
      statusEl.textContent = "AI 精读中…";
      this.aiBusy = true;
      this._busySince = Date.now(); // 记录进入时间，用于卡死自愈
      this.aiAbort = new AbortController();
      runBtn.disabled = false;
      runBtn.classList.add("hiword-ai-btn--stop");
      runBtn.querySelector("span:last-child")!.textContent = "停止";
      runBtn.title = "停止生成";
      sendBtn.disabled = false;
      sendBtn.classList.add("hiword-ai-send--stop");
      sendBtn.title = "停止生成";
      this.setInputDisabled(true);

      // 用户消息气泡（块引用渲染为折叠卡片，保持气泡简洁）
      const userMsg = document.createElement("div");
      const userIndex = this.chatHistory.length - 1;
      userMsg.className = "hiword-ai-msg hiword-ai-msg--user";
      userMsg.dataset.index = String(userIndex);
      userMsg.dataset.role = "user";
      userMsg.innerHTML = `
        <div class="hiword-ai-msg-avatar hiword-ai-msg-avatar--user">我</div>
        <div class="hiword-ai-msg-content b3-typography">
          ${this.renderUserMessage(cleanText)}
          ${renderMessageToolbar("user")}
        </div>
      `;
      this.bindMessageToolbar(userMsg, userIndex, "user");
      // 折叠卡片点击展开：异步加载完整内容预览
      userMsg.addEventListener("click", async (e: Event) => {
        const card = (e.target as HTMLElement).closest(".hiword-ref-card") as HTMLElement | null;
        if (!card) return;
        e.stopPropagation();
        const isExpanded = card.classList.toggle("hiword-ref-card--expanded");
        if (isExpanded && !card.querySelector(".hiword-ref-card__preview__content")) {
          const blockId = card.dataset.blockId;
          if (blockId) {
            const previewEl = card.querySelector(".hiword-ref-card__preview") as HTMLElement | null;
            if (previewEl) {
              previewEl.innerHTML = '<span style="opacity:0.5">加载中…</span>';
              const cached = this.blockTextCache.get(blockId);
              const fullText = cached !== undefined ? cached : (await this.host.fetchBlockText(blockId));
              if (cached === undefined && fullText) this.blockTextCache.set(blockId, fullText);
              const contentEl = document.createElement("span");
              contentEl.className = "hiword-ref-card__preview__content";
              contentEl.textContent = fullText || "（无法读取内容）";
              previewEl.replaceChildren(contentEl);
            }
          }
        }
      });
      messagesEl.appendChild(userMsg);

      // 加载动画消息（含流式 thinking 实时显示区）
      const loadingMsg = document.createElement("div");
      loadingMsg.className = "hiword-ai-msg hiword-ai-msg--loading";
      loadingMsg.innerHTML = `
        <div class="hiword-ai-msg-avatar">AI</div>
        <div class="hiword-ai-msg-body">
          <div class="hiword-ai-msg-loading">
            <span class="hiword-ai-dot"></span>
            <span class="hiword-ai-dot"></span>
            <span class="hiword-ai-dot"></span>
          </div>
          <div class="hiword-ai-live-think" data-role="live-think" style="display:none"></div>
          <div class="hiword-ai-live-count" data-role="live-count" style="display:none"></div>
        </div>
      `;
      messagesEl.appendChild(loadingMsg);
      // 缓存 thinking 容器引用
      this.liveThinkingEl = loadingMsg.querySelector("[data-role='live-think']") as HTMLElement;
      this.liveThinkingText = "";
      bodyEl.scrollTop = bodyEl.scrollHeight;

      try {
        const logger = getLogger();
        // 预设驱动：有激活的 learning 预设 → 结构化精读（约束自由对话）；否则 → 自由对话常态
        const activePreset = this.host.getActivePreset();
        const useLearning = !!activePreset && activePreset.templateType !== "chat";
        logger.info("用户发送消息", { operation: "AI对话发送", data: { hasPreset: !!activePreset, templateType: activePreset?.templateType, textLen: expanded.length } });
        let result: DeepReadResult;
        // 流式 thinking 回调：实时追加到 loading 消息的 think 容器
        const onThinking = (chunk: string) => {
          this.liveThinkingText += chunk;
          if (this.liveThinkingEl) {
            this.liveThinkingEl.style.display = "";
            this.liveThinkingEl.textContent = this.liveThinkingText;
            // 自动滚动到最新 thinking 内容
            bodyEl.scrollTop = bodyEl.scrollHeight;
          }
        };
        // ── 流式正文渲染（chat 模式）：首 token 即把 loading 升级为结果气泡，节流增量渲染 ──
        let liveRaw = "";            // 已累积的正文（markdown）
        let liveStarted = false;     // 是否已从 loading 升级为结果气泡
        let liveMdEl: HTMLElement | null = null; // 结果气泡内的 md 增量容器
        const renderLive = () => {
          if (!liveMdEl || !liveRaw.trim()) return;
          liveMdEl.innerHTML = renderWithLute(liveRaw);
          // 滚动跟随：仅当用户已贴近底部时自动滚，避免打断上翻阅读
          if (bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 120) {
            bodyEl.scrollTop = bodyEl.scrollHeight;
          }
        };
        const liveThrottle = createStreamThrottle(renderLive, 100);
        const onToken = (chunk: string) => {
          liveRaw += chunk;
          if (useLearning) {
            // 结构化精读：JSON 无法增量美化，仅更新「已生成 N 字」计数，完成后整体渲染卡片
            const cntEl = loadingMsg.querySelector("[data-role='live-count']") as HTMLElement | null;
            if (cntEl) {
              cntEl.style.display = "";
              cntEl.textContent = `AI 正在生成结构化分析…（已生成 ${liveRaw.length} 字）`;
            }
            return;
          }
          if (!liveStarted) {
            liveStarted = true;
            // 原位升级：loading 消息 → 结果气泡；thinking 已实时滚动的内容内联进气泡顶部
            loadingMsg.classList.remove("hiword-ai-msg--loading");
            loadingMsg.classList.add("hiword-ai-msg--result");
            const thinkHtml = this.liveThinkingText
              ? `<details class="hiword-ai-think" open><summary class="hiword-ai-think-sum">AI 思考过程（点击收起）</summary><div class="hiword-ai-think-body">${escapeHtml(this.liveThinkingText)}</div></details>`
              : "";
            loadingMsg.innerHTML = `
              <div class="hiword-ai-msg-avatar">AI</div>
              <div class="hiword-ai-msg-content b3-typography">
                ${thinkHtml}
                <button class="hiword-ai-msg-copy" data-act="copy-all" title="复制本条全部内容">📋 复制全部</button>
                <div class="hiword-ai-chat b3-typography" data-role="live-md"></div>
              </div>
            `;
            liveMdEl = loadingMsg.querySelector("[data-role='live-md']") as HTMLElement;
            this.liveThinkingEl = null; // 已内联进结果气泡，不再单独更新
          }
          liveThrottle.schedule();
        };
        if (useLearning) {
          // 2026-08-21 精简：双模式已删除,所有响应走统一渲染
          settings.jsonMode = true;
          const input2: DeepReadInput = { ...prepareDeepReadInput({ title, text: expanded }) };
          result = await runAiDeepRead(input2, settings, {
            signal: this.aiAbort?.signal,
            vocabStore: this.host.getVocabStore(),
            sourceBlockId: blockId,
            onThinking,
            onToken,
          });
        } else {
          // 对话常态：维护多轮上下文，把用户输入压栈后整段发送给 AI
          this.chatHistory.push({ role: "user", content: expanded });
          // 历史裁剪（P2-1）：按 token 预算从最旧整轮丢弃，避免「越聊越慢」；仅裁剪发送副本，保留完整 chatHistory 供显示
          const sendCtx: ChatTurn[] = trimChatHistory(
            this.chatHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
            { maxTokens: settings.maxTokens, keepRecentRatio: 0.6, maxMessages: 24 }
          );
          result = await runAiChat(sendCtx, settings, { signal: this.aiAbort?.signal, onThinking, onToken });
          if (result.ok && result.raw) {
            this.chatHistory.push({ role: "assistant", content: result.raw });
          } else if (!result.ok && !result.aborted) {
            // 失败时把上一轮用户消息弹出，避免脏数据污染下次
            this.chatHistory.pop();
          }
          // 落盘到当前会话（先渲染后落盘：fire-and-forget，不阻塞结果气泡出现）
          if (result.ok && result.raw) {
            void (async () => {
              try {
                const sid = await this.ensureSession();
                const existing = sessionStore.get(sid)?.messages ?? [];
                await sessionStore.saveMessages(
                  sid,
                  this.chatHistory.map((m, i) => {
                    if (m.role === "assistant") {
                      // 最后一条 assistant 用本次新鲜渲染的 HTML；更早的保留之前落盘的 HTML，避免裸显 JSON
                      const fresh = i === this.chatHistory.length - 1 && this.lastResultHtml ? this.lastResultHtml : undefined;
                      return {
                        role: "assistant" as const,
                        content: m.content,
                        ts: existing[i]?.ts ?? Date.now(),
                        html: fresh ?? existing[i]?.html,
                      };
                    }
                    return { role: "user" as const, content: m.content, ts: existing[i]?.ts ?? Date.now() };
                  })
                );
                // 初次使用自动命名：若当前会话还是默认名/24 字截断名，调用 AI 生成更贴切的标题
                const firstUser = this.chatHistory.find((m) => m.role === "user");
                if (firstUser) {
                  void this.aiAutoRenameSession(sid, firstUser.content);
                }
              } catch (e) {
                getLogger().error("会话落盘失败（异步）", { operation: "AI对话发送", error: e });
              }
            })();
          }
        }

        // ── 移除加载动画，替换 / 复用结果消息 ──
        // 流式（chat 模式）已把 loading 原位升级为结果气泡：复用该元素；
        // 非流式（learning 结构化 / 缓冲一次性 / 无 token 回调）：移除 loading，新建完整结果气泡
        if (liveStarted && liveMdEl) {
          liveThrottle.flush(); // 确保最后一段增量已渲染
        }
        this.liveThinkingEl = null;
        if (result.aborted) {
          // 用户主动停止：流式已出内容则保留展示；未出内容则不渲染、仅提示
          if (!liveStarted) {
            loadingMsg.remove();
            statusEl.textContent = "已停止生成。";
            return;
          }
        }
        const resultMsg = (() => {
          if (liveStarted && loadingMsg.isConnected) {
            loadingMsg.classList.remove("hiword-ai-msg--loading");
            loadingMsg.classList.add("hiword-ai-msg--result");
            return loadingMsg;
          }
          loadingMsg.remove();
          const el = document.createElement("div");
          el.className = "hiword-ai-msg hiword-ai-msg--result";
          return el;
        })();
        // 2026-08-21 精简：双模式已删除,所有结果走统一消息渲染(msgIndex 由调用上下文决定)
        const msgIndex = this.chatHistory.length - 1;
        resultMsg.dataset.index = String(msgIndex);
        resultMsg.dataset.role = "assistant";
        if (!liveStarted) {
          // 非流式路径：一次性渲染完整结果（learning 结构化 / 缓冲模式 / 未触发流式）
          const bodyHtml = renderDeepReadHtml(result);
          resultMsg.innerHTML = `
            <div class="hiword-ai-msg-avatar">AI</div>
            <div class="hiword-ai-msg-content b3-typography">
              <button class="hiword-ai-msg-copy" data-act="copy-all" title="复制本条全部内容">📋 复制全部</button>
              ${bodyHtml}
              ${result.truncated ? `<div class="hiword-ai-truncated">⚠️ 输出达到 Token 上限被截断（已自动续传仍不完整）。可在 ⚙ 设置中调大「最大 Token」后重试。</div>` : ""}
              ${renderMessageToolbar("assistant")}
            </div>
          `;
          messagesEl.appendChild(resultMsg);
          // 原始 markdown 存入 JS Map（替代 data-raw-md 属性，降低 innerHTML 解析负担，P3-2）
          this.rawMdByIndex.set(msgIndex, result.raw || "");
        } else {
          // 流式路径：补截断提示 / 工具栏（内容已在流式中渲染）
          const contentEl = resultMsg.querySelector(".hiword-ai-msg-content") as HTMLElement | null;
          if (contentEl) {
            // 原始 markdown 存入 JS Map（替代 data-raw-md 属性，P3-2）
            this.rawMdByIndex.set(msgIndex, result.raw || "");
            if (result.truncated) {
              contentEl.insertAdjacentHTML(
                "beforeend",
                `<div class="hiword-ai-truncated">⚠️ 输出达到 Token 上限被截断（已自动续传仍不完整）。可在 ⚙ 设置中调大「最大 Token」后重试。</div>`
              );
            }
            contentEl.insertAdjacentHTML("beforeend", renderMessageToolbar("assistant"));
          }
        }
        this.bindResult(resultMsg, blockId);
        this.bindMessageToolbar(resultMsg, msgIndex, "assistant");
        // 思源原生样式增强：数学公式(KaTeX) + 代码高亮(highlight.js)，与思源正文视觉一致
        enhanceSiYuanRender(resultMsg);
        // 记录渲染后的展示 HTML，落盘到会话以便重载时 1:1 还原（避免原始 JSON/markdown 裸显）
        this.lastResultHtml =
          (resultMsg.querySelector(".hiword-ai-msg-content") as HTMLElement | null)?.innerHTML ?? null;
        // 2026-08-21 精简：所有响应都绑定词库条(原来是 learning 专属)
        this.bindVocabBar(resultMsg, result, blockId);
        bodyEl.scrollTop = bodyEl.scrollHeight;

        // 累计 token 用量并刷新圆环
        if (result.usage) {
          this.sessionUsage.prompt += result.usage.promptTokens ?? 0;
          this.sessionUsage.completion += result.usage.completionTokens ?? 0;
          this.renderTokenRing();
        }

        statusEl.textContent = result.aborted
          ? "已停止生成（保留已生成内容）。"
          : result.ok
            ? `完成（${result.words.length} 词 / ${result.sentences.length} 句）`
            : "精读失败，详见结果区。";
        // 传输层退化为缓冲模式提示（P1-1）：端点跨域/限流导致直连失败，已回退内核代理非流式
        if (result.buffered && result.ok && !result.aborted) {
          statusEl.textContent += "（缓冲模式：直连不可用，已退化为非流式传输）";
        }
      } catch (e: any) {
        loadingMsg.remove();
        this.liveThinkingEl = null;
        // 用户主动停止（兜底路径：编排层已转 aborted，此处防御直接抛出的 AbortError）
        if (e?.name === "AbortError" || this.aiAbort?.signal.aborted) {
          statusEl.textContent = "已停止生成。";
          return;
        }
        const errMsg = document.createElement("div");
        errMsg.className = "hiword-ai-msg hiword-ai-msg--error";
        errMsg.innerHTML = `
          <div class="hiword-ai-msg-avatar hiword-ai-msg-avatar--error">!</div>
          <div class="hiword-ai-msg-body">
            <div class="hiword-ai-msg-error">${this.friendlyError(e)}</div>
          </div>
        `;
        messagesEl.appendChild(errMsg);
        bodyEl.scrollTop = bodyEl.scrollHeight;
        statusEl.textContent = "精读异常。";
        getLogger().error("AI 对话发送异常", { operation: "AI对话发送", error: e });
      } finally {
        // 恢复发送态（无论成功/失败/停止）
        this.aiBusy = false;
        this._busySince = null;
        this.aiAbort = null;
        runBtn.disabled = false;
        runBtn.classList.remove("hiword-ai-btn--stop");
        const runLabel = runBtn.querySelector("span:last-child");
        if (runLabel) runLabel.textContent = "AI 精读";
        runBtn.title = "AI 精读";
        sendBtn.disabled = false;
        sendBtn.classList.remove("hiword-ai-send--stop");
        sendBtn.title = "发送精读";
        this.setInputDisabled(false);
      }
      } catch (outerErr: any) {
        // 外层兜底：防止任何未捕获异常导致发送按钮永久无反应
        getLogger().error("发送按钮点击外层异常(兜底)", { error: outerErr });
        this.aiBusy = false;
        this._busySince = null;
        this.setInputDisabled(false);
        statusEl.textContent = this.friendlyError(outerErr) || "发送失败，请重试。";
      }
    });
  }

  /** 绑定悬浮词汇栏（renderVocabBar 输出的全不选 / 主题 / 入库） */
  private bindVocabBar(resultEl: HTMLElement, result: DeepReadResult, blockId?: string): void {
    const bar = resultEl.querySelector(".hiword-ai-vocab-bar") as HTMLElement | null;
    if (!bar) return;

    // 填充目标本下拉（默认词库 + 用户词库）
    const targets = this.host.getVocabTargets();
    const bookSel = bar.querySelector('[data-field="book"]') as HTMLSelectElement | null;
    if (bookSel) {
      const opts = [`<option value="">（默认词库）</option>`];
      targets.books.forEach((b) => {
        opts.push(`<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`);
      });
      bookSel.innerHTML = opts.join("");
    }

    const getCheckedWords = (): DeepReadWord[] => {
      const checked = Array.from(resultEl.querySelectorAll<HTMLInputElement>('.hiword-ai-sel[data-kind="word"]:checked'));
      if (checked.length) {
        const set = new Set(checked.map((c) => (c as HTMLElement).dataset.word || ""));
        return result.words.filter((w) => set.has(w.word));
      }
      return result.words;
    };

    // 「全不选」按钮
    bar.querySelector('[data-act="none"]')?.addEventListener("click", () => {
      resultEl.querySelectorAll<HTMLInputElement>('.hiword-ai-sel[data-kind="word"]').forEach((c) => {
        c.checked = false;
        c.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });

    // 主题 chips：点击切换 active（视觉态），具体主题随词库目标本决定，这里仅作为过滤标签
    const chips = bar.querySelectorAll<HTMLElement>(".hiword-ai-theme-chip");
    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        chip.classList.toggle("active");
      });
    });

    // 「添加到词库」按钮
    bar.querySelector('[data-act="add"]')?.addEventListener("click", () => {
      const sel = getCheckedWords();
      if (!sel.length) {
        const statusEl = document.querySelector("#hiword-ai-status") as HTMLElement | null;
        if (statusEl) statusEl.textContent = "请先勾选要入库的单词。";
        return;
      }
      const bookSel = bar.querySelector('[data-field="book"]') as HTMLSelectElement | null;
      const bookId = bookSel?.value || undefined;
      const activeTheme = bar.querySelector(".hiword-ai-theme-chip.active") as HTMLElement | null;
      const themeId = activeTheme?.dataset.theme || undefined;
      this.collectCheckedWords(sel, bookId, themeId, resultEl, blockId);
    });

    // 目标书变化时联动（保留）
    bar.querySelector('[data-field="book"]')?.addEventListener("change", () => {
      // 由 openVocabTargetPicker 在弹层内按 bookId 重建主题下拉；此处不做强约束。
    });
  }

  /** 把选中词写入词库（同步上下文例句 / 标记 #未掌握 / 继承主题标签） */
  private async collectCheckedWords(
    sel: DeepReadWord[],
    bookId: string | undefined,
    themeId: string | undefined,
    resultEl: HTMLElement,
    blockId?: string
  ): Promise<void> {
    const statusEl = document.querySelector("#hiword-ai-status") as HTMLElement | null;
    if (statusEl) statusEl.textContent = `入库中（${sel.length} 词）…`;
    let added = 0;
    for (const w of sel) {
      try {
        const r = await this.host.collectWord(w, bookId, themeId, {
          example: w.context,
          markUnmastered: true,
          inheritThemeTags: true,
        });
        if (r.added) added++;
      } catch { /* 单条失败不阻断 */ }
    }
    if (statusEl) statusEl.textContent = `入库完成：新增 ${added} 个单词`;
    // 把已入库的复选框置灰
    resultEl.querySelectorAll<HTMLInputElement>('.hiword-ai-sel[data-kind="word"]').forEach((c) => {
      const word = (c as HTMLElement).dataset.word || "";
      if (sel.some((w) => w.word === word)) {
        c.checked = false;
        c.disabled = true;
      }
    });
  }

  /** 批量入库：逐词选目标本 + 自动关联（例句 / #未掌握 / 文档主题标签） */
  private openVocabTargetPicker(words: DeepReadWord[], _all: DeepReadWord[], blockId?: string): void {
    const targets = this.host.getVocabTargets();
    const books = targets.books;
    const contentEl = document.querySelector("#hiword-dock-content") as HTMLElement;
    if (!contentEl) return;
    let overlay = contentEl.querySelector(".hiword-ai-overlay") as HTMLElement | null;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "hiword-ai-overlay";
      overlay.style.display = "none";
      contentEl.appendChild(overlay);
    }
    const rows = words.map((w, i) => {
      const bookOpts = books.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("");
      const themeOpts = (books[0]?.themes || []).map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join("");
      return `<div class="hiword-ai-vrow" data-idx="${i}">` +
        `<span class="hiword-ai-vrow-word">${escapeHtml(w.word)}</span>` +
        `<select class="hiword-ai-vrow-book" data-field="book">${bookOpts}</select>` +
        `<select class="hiword-ai-vrow-theme" data-field="theme">${themeOpts}</select>` +
      `</div>`;
    }).join("");

    overlay.innerHTML = `<div class="hiword-ai-overlay-mask" data-act="close"></div>` +
      `<div class="hiword-ai-overlay-panel hiword-ai-vocab-picker">` +
        `<div class="hiword-ai-overlay-title">批量加入词库（${words.length} 词）</div>` +
        `<div class="hiword-ai-vrows">${rows}</div>` +
        `<label class="hiword-ai-vassoc"><input type="checkbox" data-assoc="example" checked /> 同步上下文例句</label>` +
        `<label class="hiword-ai-vassoc"><input type="checkbox" data-assoc="unmastered" checked /> 自动标记 #未掌握</label>` +
        `<label class="hiword-ai-vassoc"><input type="checkbox" data-assoc="theme" checked /> 继承文档主题标签</label>` +
        `<div class="hiword-ai-vocab-actions">` +
          `<button class="hiword-ai-btn hiword-ai-btn--ghost" data-act="cancel">取消</button>` +
          `<button class="hiword-ai-btn hiword-ai-btn--primary" data-act="confirm">确认入库</button>` +
        `</div>` +
      `</div>`;
    overlay.style.display = "";

    overlay.querySelectorAll<HTMLElement>(".hiword-ai-vrow").forEach((row) => {
      const bookSel = row.querySelector('[data-field="book"]') as HTMLSelectElement;
      const themeSel = row.querySelector('[data-field="theme"]') as HTMLSelectElement;
      bookSel?.addEventListener("change", () => {
        const b = books.find((bk) => bk.id === bookSel.value);
        themeSel.innerHTML = (b?.themes || []).map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join("");
      });
    });

    overlay.querySelector('[data-act="cancel"]')?.addEventListener("click", () => {
      overlay!.style.display = "none";
      overlay!.innerHTML = "";
    });
    overlay.querySelector('[data-act="confirm"]')?.addEventListener("click", async () => {
      const btn = overlay!.querySelector('[data-act="confirm"]') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = "入库中…";
      const exampleOn = (overlay!.querySelector('[data-assoc="example"]') as HTMLInputElement)?.checked;
      const unmasteredOn = (overlay!.querySelector('[data-assoc="unmastered"]') as HTMLInputElement)?.checked;
      const themeOn = (overlay!.querySelector('[data-assoc="theme"]') as HTMLInputElement)?.checked;
      let added = 0;
      for (const row of Array.from(overlay!.querySelectorAll<HTMLElement>(".hiword-ai-vrow"))) {
        const idx = parseInt(row.dataset.idx || "0", 10);
        const w = words[idx];
        if (!w) continue;
        const bookId = (row.querySelector('[data-field="book"]') as HTMLSelectElement)?.value || undefined;
        const themeId = (row.querySelector('[data-field="theme"]') as HTMLSelectElement)?.value || undefined;
        const example = exampleOn ? w.context : undefined;
        try {
          const r = await this.host.collectWord(w, bookId, themeId, { example, markUnmastered: unmasteredOn, inheritThemeTags: themeOn });
          if (r.added) added++;
        } catch { /* 忽略单个失败 */ }
      }
      overlay!.style.display = "none";
      overlay!.innerHTML = "";
      const statusEl = document.querySelector("#hiword-ai-status") as HTMLElement | null;
      if (statusEl) statusEl.textContent = `批量入库完成：新增 ${added} 个单词`;
    });
  }

  /** 绑定结果区内的收藏按钮（单词收藏 / 上下文 + 学习模式） */
  private bindResult(resultEl: HTMLElement, blockId?: string): void {
    // 整条消息「复制全部」：复制本条 AI 输出的纯文本（还原数学公式原始写法）
    resultEl.querySelector(".hiword-ai-msg-copy")?.addEventListener("click", () => {
      const content = resultEl.querySelector(".hiword-ai-msg-content") as HTMLElement | null;
      const text = content ? this.getMessagePlainText(content) : "";
      if (!text) { showMessage("本条暂无内容可复制", 2000, "info"); return; }
      this.host.copyText(text);
      showMessage("已复制本条全部内容", 2000, "info");
    });

    // 学习模式下单词行内 ＋收藏
    resultEl.querySelectorAll(".hiword-ai-collect").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const w = (btn as HTMLElement).dataset.word || "";
        if (!w) return;
        try {
          await this.host.collectWord({ word: w, meaning: "" });
          (btn as HTMLButtonElement).textContent = "已收藏";
          (btn as HTMLButtonElement).disabled = true;
        } catch (e: any) {
          (btn as HTMLElement).textContent = "失败";
        }
      });
    });
  }

  /** 提取消息内容纯文本：克隆节点，将已渲染的数学公式还原为原始写法，再读取 innerText */
  private getMessagePlainText(content: HTMLElement): string {
    const clone = content.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-content]").forEach((n) => {
      const raw = (n as HTMLElement).getAttribute("data-content");
      if (raw != null) n.textContent = raw;
    });
    clone.querySelectorAll(".hiword-ai-msg-copy").forEach((n) => n.remove());
    clone.querySelectorAll(".hiword-ai-collect, .hiword-ai-vocab-bar, .hiword-ai-word-cb").forEach((n) => n.remove());
    return (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  }

  /** 绑定消息工具栏事件（复制 Markdown/TXT、保存到笔记、编辑、重试） */
  private bindMessageToolbar(msgEl: HTMLElement, index: number, role: "user" | "assistant"): void {
    const contentEl = msgEl.querySelector(".hiword-ai-msg-content") as HTMLElement | null;
    if (!contentEl) return;

    const getRawMd = (): string => {
      if (role === "user") {
        return this.chatHistory[index]?.content || "";
      }
      // 优先读 JS Map（P3-2 替代 data-raw-md 属性），兜底读旧属性/历史
      return this.rawMdByIndex.get(index) || contentEl.dataset.rawMd || this.chatHistory[index]?.content || "";
    };

    // 复制 Markdown
    msgEl.querySelector('[data-act="copy-md"]')?.addEventListener("click", () => {
      const md = getRawMd();
      if (!md.trim()) { showMessage("本条暂无 Markdown 可复制", 2000, "info"); return; }
      this.host.copyText(md);
      showMessage("已复制 Markdown", 2000, "info");
    });

    // 复制 TXT
    msgEl.querySelector('[data-act="copy-txt"]')?.addEventListener("click", () => {
      const text = this.getMessagePlainText(contentEl);
      if (!text) { showMessage("本条暂无内容可复制", 2000, "info"); return; }
      this.host.copyText(text);
      showMessage("已复制纯文本", 2000, "info");
    });

    // 保存到笔记
    msgEl.querySelector('[data-act="save-note"]')?.addEventListener("click", () => {
      void this.openSaveToNoteDialog(getRawMd());
    });

    // 编辑
    msgEl.querySelector('[data-act="edit"]')?.addEventListener("click", () => {
      if (role === "user") {
        this.editUserMessage(index);
      } else {
        void this.editAssistantMessage(msgEl, index);
      }
    });

    // 重试（仅 AI 消息）
    if (role === "assistant") {
      msgEl.querySelector('[data-act="retry"]')?.addEventListener("click", () => {
        void this.retryAssistantMessage(index);
      });
    }
  }

  /** 打开「保存到笔记」对话框 */
  private async openSaveToNoteDialog(markdown: string): Promise<void> {
    if (!this.openOverlay) return;
    const notebooks = await this.host.listNotebooks();
    if (!notebooks.length) {
      showMessage("未找到可用笔记本", 3000, "error");
      return;
    }
    this.openOverlay(renderSaveToNoteDialog({ notebooks }));
    const panel = this.overlay?.querySelector(".hiword-ai-overlay-panel") as HTMLElement | null;
    if (!panel) return;

    const notebookSel = panel.querySelector('[data-field="notebook"]') as HTMLSelectElement;
    const pathInput = panel.querySelector('[data-field="path"]') as HTMLInputElement;
    const titleInput = panel.querySelector('[data-field="title"]') as HTMLInputElement;
    const treeEl = panel.querySelector('[data-field="tree"]') as HTMLElement;

    const loadTree = async (notebookId: string, path = "") => {
      if (!treeEl) return;
      treeEl.innerHTML = '<div class="hiword-ai-savenote-empty">加载中…</div>';
      try {
        const nodes = await this.host.listDocTree(notebookId, path);
        treeEl.innerHTML = renderSaveToNoteTree(nodes);
        bindTreeEvents();
      } catch {
        treeEl.innerHTML = '<div class="hiword-ai-savenote-empty">加载失败</div>';
      }
    };

    const bindTreeEvents = () => {
      panel.querySelectorAll(".hiword-ai-savenote-node").forEach((node) => {
        const el = node as HTMLElement;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const children = el.nextElementSibling as HTMLElement | null;
          if (children?.classList.contains("hiword-ai-savenote-children")) {
            const isHidden = children.style.display === "none";
            children.style.display = isHidden ? "" : "none";
            const toggle = el.querySelector(".hiword-ai-savenote-toggle");
            if (toggle) toggle.textContent = isHidden ? "▼" : "▸";
          }
          const p = el.dataset.path;
          if (p != null && pathInput) {
            pathInput.value = p;
          }
        });
      });
    };

    notebookSel?.addEventListener("change", () => {
      const id = notebookSel.value;
      if (id) loadTree(id);
    });

    // 初始加载第一个笔记本的树
    if (notebooks[0]?.id) loadTree(notebooks[0].id);

    panel.querySelector('[data-act="cancel"]')?.addEventListener("click", () => {
      if (this.overlay) { this.overlay.style.display = "none"; this.overlay.innerHTML = ""; }
    });
    this.overlay?.querySelector('[data-act="close-overlay"]')?.addEventListener("click", () => {
      if (this.overlay) { this.overlay.style.display = "none"; this.overlay.innerHTML = ""; }
    });

    panel.querySelector('[data-act="confirm"]')?.addEventListener("click", async () => {
      const notebookId = notebookSel?.value || "";
      const path = pathInput?.value || "";
      const title = titleInput?.value || "";
      const openAfterSave = (panel.querySelector('[data-field="openAfterSave"]') as HTMLInputElement)?.checked ?? true;
      if (!notebookId) { showMessage("请选择笔记本", 2500, "info"); return; }
      try {
        const docId = await this.host.saveToNote({ markdown, notebookId, path, title, openAfterSave });
        if (this.overlay) { this.overlay.style.display = "none"; this.overlay.innerHTML = ""; }
        showMessage(`已保存到笔记 (${docId.slice(0, 8)}…)`, 2500, "success" as any);
      } catch (e: any) {
        showMessage(`保存失败：${e?.message || e}`, 3000, "error");
      }
    });
  }

  /** 编辑用户消息：回填输入框并截断后续上下文 */
  private editUserMessage(index: number): void {
    const msg = this.chatHistory[index];
    if (!msg || msg.role !== "user") return;
    this.setInputMarkdown(msg.content);
    // 截断到该消息之前
    this.chatHistory = this.chatHistory.slice(0, index);
    // 同步 session store
    if (this.currentSessionId) {
      sessionStore.saveMessages(
        this.currentSessionId,
        this.chatHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content, ts: Date.now() }))
      );
    }
    // 删除 DOM 中该消息及之后的所有消息
    const messagesEl = this.contentEl?.querySelector("#hiword-ai-messages") as HTMLElement | null;
    if (messagesEl) {
      const all = Array.from(messagesEl.querySelectorAll(".hiword-ai-msg"));
      for (const el of all) {
        const idx = parseInt((el as HTMLElement).dataset.index || "-1", 10);
        if (idx >= index) el.remove();
      }
      // 重新校正剩余消息的索引
      this.reindexMessages(messagesEl);
    }
    const inputEl = this.contentEl?.querySelector("#hiword-ai-input") as HTMLElement | null;
    inputEl?.focus();
  }

  /** 重新校正消息 DOM 的 data-index */
  private reindexMessages(messagesEl: HTMLElement): void {
    const msgs = Array.from(messagesEl.querySelectorAll(".hiword-ai-msg"));
    msgs.forEach((el, i) => { (el as HTMLElement).dataset.index = String(i); });
  }

  /** 编辑 AI 消息：就地进入 Markdown 编辑，保存后更新并重渲染 */
  private async editAssistantMessage(msgEl: HTMLElement, index: number): Promise<void> {
    const contentEl = msgEl.querySelector(".hiword-ai-msg-content") as HTMLElement | null;
    if (!contentEl) return;
    const rawMd = this.rawMdByIndex.get(index) || contentEl.dataset.rawMd || this.chatHistory[index]?.content || "";

    contentEl.style.display = "none";
    const editor = document.createElement("div");
    editor.className = "hiword-ai-msg-editor";
    editor.innerHTML = `
      <textarea class="hiword-ai-msg-editor-text" spellcheck="false">${escapeHtml(rawMd)}</textarea>
      <div class="hiword-ai-msg-editor-actions">
        <button class="hiword-ai-btn hiword-ai-btn--ghost" data-act="cancel">取消</button>
        <button class="hiword-ai-btn hiword-ai-btn--primary" data-act="save">保存</button>
      </div>
    `;
    contentEl.after(editor);
    const textarea = editor.querySelector("textarea") as HTMLTextAreaElement;
    textarea.focus();

    const cleanup = () => {
      contentEl.style.display = "";
      editor.remove();
    };

    editor.querySelector('[data-act="cancel"]')?.addEventListener("click", cleanup);
    editor.querySelector('[data-act="save"]')?.addEventListener("click", () => {
      const newMd = textarea.value;
      // 更新内存与持久化
      if (this.chatHistory[index]) {
        this.chatHistory[index].content = newMd;
      }
      if (this.currentSessionId) {
        const sess = sessionStore.get(this.currentSessionId);
        if (sess && sess.messages[index]) {
          sess.messages[index].content = newMd;
          sess.messages[index].html = undefined; // 强制重新渲染
          sessionStore.saveMessages(this.currentSessionId, sess.messages);
        }
      }
      // 重渲染内容区（保留工具栏，避免 innerHTML 覆盖后丢失）
      const toolbar = contentEl.querySelector(".hiword-ai-msg-toolbar");
      contentEl.innerHTML = renderWithLute(newMd);
      if (toolbar) contentEl.appendChild(toolbar);
      this.rawMdByIndex.set(index, newMd);
      enhanceSiYuanRender(contentEl);
      cleanup();
      showMessage("已更新消息", 2000, "success" as any);
    });
  }

  /** 重试 AI 消息：保留更早上下文，用前一条用户消息重新生成 */
  private async retryAssistantMessage(index: number): Promise<void> {
    if (index <= 0 || index >= this.chatHistory.length) {
      showMessage("没有可重试的用户消息", 2000, "info");
      return;
    }
    const prevUser = this.chatHistory[index - 1];
    if (prevUser?.role !== "user") {
      showMessage("上一条不是用户消息，无法重试", 2000, "info");
      return;
    }
    // 截断到前一条用户消息之前
    this.chatHistory = this.chatHistory.slice(0, index - 1);
    if (this.currentSessionId) {
      sessionStore.saveMessages(
        this.currentSessionId,
        this.chatHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content, ts: Date.now() }))
      );
    }
    // 删除 DOM 中前一条用户消息及之后的所有消息
    const messagesEl = this.contentEl?.querySelector("#hiword-ai-messages") as HTMLElement | null;
    if (messagesEl) {
      const all = Array.from(messagesEl.querySelectorAll(".hiword-ai-msg"));
      for (const el of all) {
        const idx = parseInt((el as HTMLElement).dataset.index || "-1", 10);
        if (idx >= index - 1) el.remove();
      }
      this.reindexMessages(messagesEl);
    }
    // 回填输入框并触发发送
    this.setInputMarkdown(prevUser.content);
    const runBtn = this.contentEl?.querySelector("#hiword-ai-run") as HTMLButtonElement | null;
    runBtn?.click();
  }

  /**
   * 加载查询面板的筛选选项（颜色列表 + 文档列表）
   */
  private async loadQueryFilters(
    colorSelect: HTMLSelectElement | null,
    docSelect: HTMLSelectElement | null
  ): Promise<void> {
    // 颜色选项（与批注对话框一致）
    const colors = [
      { value: "", label: "全部颜色" },
      { value: "#4285f4", label: "蓝色" },
      { value: "#0d9e5f", label: "翠绿" },
      { value: "#e6a23c", label: "琥珀" },
      { value: "#db3f84", label: "玫红" },
      { value: "#5b6ee1", label: "靛蓝" },
      { value: "#17a2b8", label: "青色" },
      { value: "#f06543", label: "珊瑚" },
      { value: "#6c757d", label: "石板" },
    ];
    if (colorSelect) {
      colorSelect.innerHTML = colors
        .map((c) => `<option value="${c.value}">${c.label}</option>`)
        .join("");
    }

    // 文档选项（从 host 获取已批注文档列表）
    if (docSelect) {
      try {
        const docIds = await this.host.getAnnotatedDocIds();
        docSelect.innerHTML = '<option value="">全部文档</option>';
        for (const did of docIds) {
          // 尝试获取文档标题
          const label = did.slice(0, 12) + (did.length > 12 ? "…" : "");
          const opt = document.createElement("option");
          opt.value = did;
          opt.textContent = label;
          docSelect.appendChild(opt);
        }
      } catch {
        // 静默失败，保持默认
      }
    }
  }

  /**
   * 渲染查询结果列表
   */
  private renderQueryResults(
    container: HTMLElement,
    result: AnnotationQueryResult
  ): void {
    if (!result.items.length) {
      container.innerHTML = `
        <div class="hiword-ai-query-empty">
          <p>未找到匹配的批注</p>
          <p class="hiword-ai-query-hint">试试放宽筛选条件或更换关键词</p>
        </div>`;
      return;
    }

    const renderNote = (note: string) => {
      const html = renderAnnotationHTML(note);
      return html || renderMarkdown(note);
    };

    const html = result.items.map((a, i) => {
      const colorDot = a.color
        ? `<span class="hiword-ai-q-color-dot" style="background:${escapeHtml(a.color)}"></span>`
        : "";
      const timeShort = a.createdAt.slice(5, 16).replace("T", " ");
      return `
        <div class="hiword-ai-q-item" data-id="${escapeHtml(a.id)}">
          <div class="hiword-ai-q-item-head">
            ${colorDot}
            <span class="hiword-ai-q-item-num">#${i + 1}</span>
            <span class="hiword-ai-q-item-origin">${a.origin === "ai" ? "AI" : "手动"}</span>
            <span class="hiword-ai-q-item-time">${timeShort}</span>
          </div>
          ${a.selectedText
            ? `<div class="hiword-ai-q-item-sel">选中：${escapeHtml(a.selectedText)}</div>`
            : ""}
          ${a.note ? `<div class="hiword-ai-q-item-note b3-typography">${renderNote(a.note)}</div>` : ""}
        </div>`;
    }).join("");

    container.innerHTML = `<div class="hiword-ai-q-list">${html}</div>`;
  }

  /** 释放面板持有的全局监听（dragend / 拉伸 pointer 事件），配合插件 onunload */
  destroy(): void {
    this.destroyInput();
    this.disposables.dispose();
  }
}
