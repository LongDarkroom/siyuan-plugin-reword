/**
 * 双语运行时 · 四层架构契约（L0 / core）
 * ==================================================================
 * 2026-09-05 立架构。本文件只放**跨层共享的类型与接口签名**，零 DOM 依赖、
 * 零运行时副作用，因此可被单元测试直接 import。
 *
 * 四层边界（严格遵守，越界即架构腐化）：
 *
 *   L0 core      —— 纯契约与纯算法。不 import 任何 DOM / foliate / 思源 API。
 *                   本目录（types.ts）+ runtime/ 里的纯函数（detector.ts）。
 *   L1 adapters  —— 打开书籍、取内容文档、按格式归一化。
 *                   已存在：src/reader/adapters/*（Epub/Pdf/Text/Comic/FoliateOpen）。
 *   L2 runtime   —— 切分 / 可见性 / 注入 / 预翻译队列 / 编排 / 语言判定。
 *                   放在 src/reader/bilingual/runtime/*；必须零 DOM 依赖的部分
 *                   写成纯函数放到 core，DOM 部分只出现在 adapter 注入的对象里。
 *   L3 ui        —— ReaderView.svelte / BookToolbar / 设置面板。只调 L2 的门面，
 *                   不直接碰翻译内核与 DOM 注入细节。
 *
 * 现有实现 bilingual-v2/ 属于「旧运行时」，在 L2 各块落地前继续承担全部职责；
 * 新块按 L2 → 替换 v2 内对应职责的顺序逐块接管，接口对齐 BilingualHandle。
 *
 * 注意：BilingualOptions / BilingualHandle / PretranslateOptions /
 * PretranslateProgress 等**现行运行时契约仍定义在 ../bilingual-types.ts**，
 * 本文件不重复定义，只在需要时引用。
 */

/* ================================================================
 * 一、块（Segment）：切分后的最小翻译/注入单位
 * ================================================================ */

/**
 * 切分后的文本块。
 *
 * locatorKey 刻意**只由原文决定**（`hashText(text)`，不带译文风格 mode）：
 * 隐藏集合、脏标记、注入进度都以它为锚；若带上 mode，用户切换「直译/简洁版」
 * 会让这些状态整体漂移。缓存键仍用带 mode 的 `hashText(text, mode)`（旧缓存免迁移）。
 */
export interface Segment {
  /** 稳定定位键（hashText(text)） */
  locatorKey: string;
  /** 原文（已 trim，可直接送译） */
  text: string;
  /** 所在分节序号（0-based） */
  sectionIndex: number;
  /** 分节内块序号（0-based，用于按进度顺序注入） */
  indexInSection: number;
  /** 对应的 DOM 节点（注入时用；序列化/跨层传递时不带） */
  node?: unknown;
  /**
   * 前文参考（最近若干段的截断文本拼接）。送译时作 ctxBefore，
   * 让模型理解语境，专有名词 / 译法前后一致（对应旧 getSegments 的 prev 语义）。
   */
  prev?: string;
}

/** 块级翻译状态（三态：失败不再永久占位，可退避重试） */
export type SegmentState = "pending" | "translated" | "failed";

/* ================================================================
 * 二、可见性窗口：决定「切哪些 / 注入到哪」
 * ================================================================ */

/**
 * 可见性窗口。
 * - reflowable（EPUB/TXT）：按视口折算分节范围，basis="viewport"
 * - 定版面（PDF/漫画）：按分节数，basis="section"
 */
export interface VisibilityWindow {
  /** 窗口起点分节（含） */
  fromSection: number;
  /** 窗口终点分节（含） */
  toSection: number;
  basis: "viewport" | "section";
}

/* ================================================================
 * 三、注入：分帧有界，按用户进度走
 * ================================================================ */

/** 注入批次（每帧条数上限，避免读写交替触发强制重排） */
export interface InjectBatch {
  segments: Segment[];
  /** 与 segments 同序的译文；空串 / undefined = 未译出（留空，不打标，下轮重试） */
  translations: Array<string | undefined>;
  /** 每帧最大注入条数（默认见 INJECT_DEFAULTS.perFrame） */
  perFrame?: number;
}

/**
 * 注入闸门：翻译结果落到缓存后，**只有落在窗口内的块才注入**，
 * 窗口外的只存缓存，等用户翻页推进窗口后再按进度注入（不预先排队注入）。
 */
export interface InjectGate {
  /** 当前位置之后允许注入的分节数（默认 2，即「当前页 + 后 2 页」） */
  aheadSections: number;
}

export const INJECT_DEFAULTS = {
  /** 每帧最大注入条数 */
  perFrame: 8,
  /** 当前位置之后允许注入的分节数 */
  aheadSections: 2,
} as const;

/* ================================================================
 * 四、后台预翻译队列：全本 / 渐进式
 * ================================================================ */

/** 预翻译模式 */
export type PretranslateMode = "full" | "progressive";

/**
 * 预翻译任务。
 *
 * 两种模式（用户 2026-09-05 定）：
 *  - full：切分全书所有分节，后台持续翻译；
 *  - progressive：只切「当前页 + 后 2 页」，随翻页推进续切。
 *
 * 两者共用同一套并发与闸门：并发 lanes 列、每列每次 blocksPerLane 块；
 * 译好的块先写缓存，只有落在「当前位置 + aheadSections」内才注入，越界只存不注。
 */
export interface PretranslateJob {
  bookId: string;
  mode: PretranslateMode;
  /** 并发列数（默认 2） */
  lanes?: number;
  /** 每列每次取走的块数（默认 5） */
  blocksPerLane?: number;
  /** 注入闸门：超出「当前位置 + aheadSections」只缓存不注入（默认 2） */
  aheadSections?: number;
  /** 中断信号（停止按钮 / 组件卸载 / 切换书籍时 abort） */
  signal?: AbortSignal;
}

/** 预翻译运行时状态 */
export interface PretranslateState {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  /** 已处理块数（含命中缓存的） */
  done: number;
  /** 总块数（progressive 模式下随翻页增长） */
  total: number;
  /** 已入缓存但尚未注入的块数（等用户翻页） */
  cachedOnly: number;
  /** 已注入 DOM 的块数 */
  injected: number;
  /** 失败块数（进 failedSet 退避重试，不永久占位） */
  failed: number;
}

export const PRETRANSLATE_DEFAULTS = {
  /** 并发列数 */
  lanes: 2,
  /** 每列每次块数 */
  blocksPerLane: 5,
  /** 注入闸门：当前位置之后 N 个分节内才注入 */
  aheadSections: 2,
  /** 失败退避：首次 5s，之后 30s，最多重试 2 次 */
  retryDelaysMs: [5_000, 30_000],
  maxRetries: 2,
} as const;

/* ================================================================
 * 五、L2 各模块接口契约（只签名不实现，随数据流细化逐块落地）
 * ================================================================ */

/**
 * 切分器：把内容文档切成块（带 memo，避免多处重复全量扫描）。
 *
 * 旧运行时 `getSegments` 在 bilingual-v2.ts 的 4 个调用点各自全量扫描 DOM；
 * 新切分器按 Document 做 WeakMap memo，四处共用一份结果。
 */
export interface SegmenterLike {
  /** 切一个分节文档；同一 doc 重复调用走缓存 */
  segmentsOf(doc: Document, sectionIndex: number): Segment[];
  /** 切多个文档（保持 docs 顺序，段内序号连续） */
  segmentsOfDocs(docs: Document[], firstSectionIndex?: number): Segment[];
  /** 丢弃缓存（不传则全清；翻页/重排/字号变更后调用） */
  invalidate(doc?: Document): void;
}

/** 可见性判定：给出当前窗口与「是否落在注入闸门内」 */
export interface VisibilityLike {
  /** 当前可见窗口 */
  currentWindow(): VisibilityWindow;
  /** 该分节是否在当前位置 + gate.aheadSections 之内（是才注入） */
  withinInjectGate(sectionIndex: number, gate: InjectGate): boolean;
}

/** 注入器：分帧有界地把已译块写进 DOM */
export interface InjectorLike {
  /** 注入一批（内部按 perFrame 分帧，读写分离） */
  inject(batch: InjectBatch): Promise<void>;
  /** 该块是否已注入（用于去重，替代「打标即跳过」的旧做法） */
  hasInjected(locatorKey: string): boolean;
  /** 移除单个块的译文（用户删除 / 隐藏） */
  erase(locatorKey: string): void;
  /** 清空全部注入（关闭双语 / 卸载） */
  clear(): void;
}

/** 预翻译队列：按 job 配置并发翻译 + 闸门注入 */
export interface PretranslateQueueLike {
  start(job: PretranslateJob): Promise<void>;
  cancel(): void;
  /** 翻页/推进：窗口变化后按进度补注入已缓存块 */
  onProgress(): void;
  state(): PretranslateState;
}

/* ================================================================
 * 六、语言判定（双语前置门槛）
 * ================================================================ */

/** 判定结论：en=英文书（可开双语）/ other=非英文（拦）/ unknown=无法判定（放行） */
export type LanguageVerdict = "en" | "other" | "unknown";

/** 判定依据：meta=元数据 dc:language / sample=正文采样 / none=无任何输入 */
export type LanguageSource = "meta" | "sample" | "none";

export interface LanguageDetection {
  verdict: LanguageVerdict;
  source: LanguageSource;
  /** 置信度 0-1（采样判定时为字符占比；元数据判定时为 1） */
  confidence: number;
}
