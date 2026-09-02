/**
 * 双语对照 · 公共类型契约
 * ------------------------------------------------------------------
 * 2026-08-31：原定义在 bilingual.ts（v1）里，删除 v1 后抽到此处，
 * 使 bilingual-v2 与 ReaderView.svelte 不再依赖已删除的 v1 模块。
 *
 * 当前唯一实现：src/reader/bilingual-v2/bilingual-v2.ts（兄弟节点渲染方案）。
 * 相比 v1 的接口变化：
 *  - 移除 `retranslateConcise()`（v1 的「简洁版重译」按钮功能已废弃，v2 唯一 literal 模式）。
 */
/** 书籍元数据（注入翻译 system prompt，提升专有名词/语境准确性） */
export interface BilingualBookMeta {
  title?: string;
  author?: string;
  /** 源语言（如 en / ja / fr），用于提示模型原文语种 */
  language?: string;
  /** 目录文本（可选，较长，仅在非空且较短时注入） */
  toc?: string;
}

export interface BilingualOptions {
  bookId: string;
  /** 返回当前 foliate 内容文档数组（传入方负责把 [{doc}] 解成真实 Document[]） */
  getContents: () => Document[];
  /**
   * 批量翻译（异步，返回与输入同序同长的译文数组）
   * @param ctxBefore 与 texts 同序的「前文参考」数组（可为 null），供模型理解语境，无需翻译
   * @param meta 书籍元数据（书名/作者/语言/目录），注入 system prompt
   * @param extra 预翻译细化选项：model 模型覆盖 / overwrite 覆盖已有缓存 / signal 中断信号
   */
  translateBatch: (
    texts: string[],
    from: string,
    to: string,
    bookId: string,
    ctxBefore?: (string | null)[],
    meta?: BilingualBookMeta | null,
    extra?: { model?: string; overwrite?: boolean; signal?: AbortSignal; mode?: "default" | "concise"; engine?: string }
  ) => Promise<string[]>;
  /**
   * 详细翻译（回传 provider / fromCache），用于成本与引擎统计遥测。
   * 与 translateBatch 逻辑一致，仅返回值多了来源元数据。注入层优先用
   * 它；未提供时回落到 translateBatch。
   */
  translateBatchDetailed?: (
    texts: string[],
    from: string,
    to: string,
    bookId: string,
    ctxBefore?: (string | null)[],
    meta?: BilingualBookMeta | null,
    extra?: { model?: string; overwrite?: boolean; signal?: AbortSignal; mode?: "default" | "concise"; engine?: string }
  ) => Promise<{ texts: string[]; providers: (string | null)[]; fromCache: boolean[] }>;
  /** 批量查询缓存命中（同序 boolean[]；true=该段已缓存），用于预翻译弹窗精确计算待译数 */
  checkCached?: (texts: string[]) => Promise<boolean[]>;
  /** 双语调试信息（译文块显示引擎与 Token 明细），默认 false；传函数以便设置切换即时生效 */
  debug?: (() => boolean) | boolean;
  /** 源语言（默认 auto） */
  from?: string;
  /** 目标语言（默认 zh） */
  to?: string;
  /** 书籍元数据回调（书名/作者/语言/目录），注入翻译 system prompt 提升准确性 */
  bookMeta?: () => BilingualBookMeta | null;
  /** 进度回调（done / total，按本轮送译数计） */
  onProgress?: (done: number, total: number) => void;
  /** Token 用量回调（每次翻译批次完成后调用；累计值跨批次累加） */
  onTokenUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  /**
   * 2026-09-01 Bug ② 方案 A：注入后强制重排钩子。
   * 分页模式下译文作为段落的兄弟节点（afterend）注入；若段落在页面底部，
   * 译文会超出分栏固定高度被 overflow:hidden 裁掉而不显示。foliate 的
   * ResizeObserver 只调 expand() 不触发重排，故注入后需主动触发一次重排。
   * injectAll 在「本轮有成功注入（done>0）」时调用它；是否仅分页模式生效、
   * 如何触发重排由上层实现决定（保持本层与 flow 解耦）。
   */
  onAfterInject?: () => void;
  /** 可视过滤开关（默认 true；测试可关掉以翻译全部段落） */
  visibleOnly?: boolean;
  /**
   * 译文风格（2026-08-31 重新启用简洁版）：
   *  - "default" 直译（默认）
   *  - "concise" 简洁版（更短、更像学习者笔记，走 conciseTranslatePrompt）
   * 影响 injectAll 实时注入与 pretranslateAll 整书预翻译两条路径。
   */
  mode?: "default" | "concise";
  /**
   * 实时读取译文风格（优先于静态 mode）：用于设置切换后无需重建 handle 即生效。
   * 返回 "default" | "concise"。
   */
  getMode?: () => "default" | "concise";
  /** 预取页数（动态回调）：当前屏之后额外预译并缓存的「面」数；默认 2.5。值越大越省翻页等待但越费 token */
  getPrefetchPages?: () => number;
  /** 节号回调（1-based）：每当一批段落翻译并成功入缓存后，回传本次涉及的书「节」序号，用于 UI「第 X-Y 页缓存成功」 */
  onSectionsCached?: (bookId: string, sections: number[]) => void;
  /**
   * 2026-08-31 Phase 3：是否渲染段落级「✨ 用 AI 重译」按钮（默认否）。
   * 按钮由 CSS 默认隐藏，hover 译文块时才显形，避免干扰阅读。
   */
  showAiRedo?: boolean;
  /**
   * 用户点击「用 AI 重译」时触发。
   * @param wrapEl 译文块元素（.reword-bilingual）
   * @param sourceText 该段原文（取译文块紧邻的前一个兄弟节点文本）
   */
  onAiRedo?: (wrapEl: Element, sourceText: string) => void;
  /**
   * 2026-08-31：是否渲染段落级「✕ 删除此段译文」按钮（默认否）。
   * 点击后隐藏该段译文（从 DOM 移除 + 记入隐藏集合），injectAll 跳过被隐藏段。
   */
  showHideSegment?: boolean;
  /** 判定某段指纹是否已被隐藏（返回 true 则该段不注入译文）。指纹由 render.ts 的 segHash 计算 */
  isSegmentHidden?: (segHash: string) => boolean;
  /**
   * 用户点击「删除此段译文」时触发，回传（bookId, 该段指纹）。
   * 调用方负责把指纹记入隐藏集合并持久化。
   */
  onHideSegment?: (bookId: string, segHash: string) => void;
}

/** 整书预翻译进度（细化版：含状态/缓存/待译/ETA/token 估算） */
export interface PretranslateProgress {
  /** 本轮已成功入缓存段数 */
  done: number;
  /** 全书总段数 */
  total: number;
  /** 已缓存段数（含本次开始前已有的） */
  cached: number;
  /** 待译段数（需走 AI 的；overwrite 时等于 total） */
  pending: number;
  status: "idle" | "running" | "done" | "cancelled" | "error";
  /** Token 估算（仅基于待译字数 /4，非实时用量） */
  estTokens?: number;
  /** 剩余秒数估算（运行中按已完成速率推算） */
  etaSeconds?: number;
}

/** 整书预翻译细化选项（来自弹窗） */
export interface PretranslateOptions {
  /** 目标语言覆盖（默认沿用双语设置 to） */
  to?: string;
  /** 模型覆盖（默认沿用当前 AI 设置 model） */
  model?: string;
  /** 引擎覆盖（默认 auto：按优先级链；可强制指定 tencent/youdao/baidu/microsoft/libretranslate/ai） */
  engine?: string;
  /** 每批段数（默认 8，与 aiTranslateBatch 分桶上限一致） */
  batchSize?: number;
  /** 批次间并发数（默认 1，避免触发限流） */
  concurrency?: number;
  /** 覆盖已有缓存（默认 false：命中缓存段落跳过，不重复消耗 token） */
  overwrite?: boolean;
  /** 译文风格：直译 / 简洁版（默认直译；与 BilingualOptions.mode 一致） */
  mode?: "default" | "concise";
  /** 中断信号（停止按钮 / 卸载时 abort） */
  signal?: AbortSignal;
  /** 进度回调（每批完成后触发） */
  onProgress?: (p: PretranslateProgress) => void;
}

export interface BilingualHandle {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /** 立即重新扫描并注入（如设置变更后） */
  refresh(): void;
  /** foliate 加载新内容（翻页）或滚动/跳转（relocate）时调用 */
  onViewLoad(): void;
  /** 统计本书段落总数与总字数（供预翻译弹窗展示） */
  segmentStats(): { count: number; chars: number };
  /** 列出本书全部段落原文（供预翻译弹窗按段精确计算「已缓存」命中，与 pretranslateAll 逻辑一致） */
  segmentTexts(): string[];
  /**
   * 整书预翻译（细化版）：遍历全书所有段落，未缓存的送译并落盘（translationCache）；
   * 不在 DOM 注入译文——仅填充缓存，使后续开启双语 / 翻页 / 重开本书时命中缓存秒出。
   * 支持模型/目标语言覆盖、批大小/并发调节、覆盖缓存、可中断。
   * @param opts 细化选项与进度回调
   */
  pretranslateAll(opts?: PretranslateOptions): Promise<void>;
  destroy(): void;
}
