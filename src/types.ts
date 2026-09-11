/**
 * 单词状态
 * 用 const 对象 + 类型别名代替 enum：保留 `WordStatus.Active`(值) 与
 * `status: WordStatus`(类型) 两种用法，且运行时序列化值仍是字符串 "active"，
 * 同时兼容 Node 的 strip-only 测试模式（enum 在 strip 模式下不被支持）。
 */
export const WordStatus = {
  Active: "active",       // 活跃（在复习队列中）
  Archived: "archived",   // 已归档（掌握后移出队列）
  Ignored: "ignored",     // 忽略（不再提醒）
} as const;
export type WordStatus = typeof WordStatus[keyof typeof WordStatus];

/** 掌握程度最大值（5 星） */
export const MASTERY_MAX = 5;

/**
 * 单词本状态（2026-09-11 新增：词书校验流程）
 * - draft：草稿。文档/块/文件解析后未确认，不进入复习面板、不参与调度
 * - verified：已校验。用户已确认入复习，可被 scheduler 调度
 * 老数据（缺 status 字段）通过 vocab-store.ensureBookStatus() 迁移为 'verified'
 * 模式与 WordStatus 一致：const 对象 + 类型别名双形式，序列化值仍是字符串
 */
export const BookStatus = {
  Draft: "draft",
  Verified: "verified",
} as const;
export type BookStatus = typeof BookStatus[keyof typeof BookStatus];

/**
 * 单词本来源（2026-09-11 新增）
 * - manual：手动逐词添加（老数据缺省值）
 * - imported：文件导入（CSV / TXT / JSON）
 * - doc-parsed：思源文档/块解析
 * - builtin：预置词表（P1 阶段）
 */
export const BookSource = {
  Manual: "manual",
  Imported: "imported",
  DocParsed: "doc-parsed",
  Builtin: "builtin",
} as const;
export type BookSource = typeof BookSource[keyof typeof BookSource];

/**
 * 单词本导入元信息（2026-09-11 新增）
 * 解析/导入时记录溯源，便于复查"这本词书从哪来"
 * 仅在 source 为 'imported' / 'doc-parsed' 时有值
 */
export interface VocabBookImportMeta {
  /** 解析格式：csv/txt/json/plain/doubledot/table/tsv/yaml/siyuan */
  format: string;
  /** 来源定位：文件名 / 思源文档 ID / 块 ID 列表 */
  locator: string;
  /** 原始解析行数 */
  rawCount: number;
  /** 去重后词数（写入词库的） */
  dedupedCount: number;
  /** 跳过的行数（非英文 / 空行 / 停用词） */
  skippedCount: number;
  /** 导入时间 ISO */
  importedAt: string;
}

/**
 * 全局标签（2026-09-11 新增：独立于 book/theme 结构的横切分类）
 * 与 WordRecord.labels 字段配套：词可同时有多个 label，跨 book/theme
 * 持久化：hiword-vocab-labels.json（独立于 hiword-vocab.json）
 * wordCount 字段不持久化，每次 getAllLabels() 时实时聚合
 */
export interface VocabLabel {
  /** 标签名（主键，唯一） */
  name: string;
  /** 显示色（hex，如 #10b981） */
  color: string;
  /** 可选描述（用户可填） */
  description?: string;
  /** 创建时间 ISO */
  createdAt: string;
}

/**
 * 单词学习状态(2026-08-22 新增:词库驱动高亮体系)
 * 与 WordStatus(复习队列状态)独立:WordStatus 管复习队列进出,
 * LearningStatus 管"我对这个单词的掌握度"——直接驱动文档单词高亮颜色。
 * - learning(黄):未掌握/刚加入/不稳定
 * - mastered(绿):已掌握(5 星或显式标记)
 * - review(紫):需复习(最近复习失败或显式标记)
 */
export const LearningStatus = {
  Learning: "learning",
  Mastered: "mastered",
  Review: "review",
} as const;
export type LearningStatus = typeof LearningStatus[keyof typeof LearningStatus];

/** 学习状态对应的高亮色(复用 WHALE_COLORS 同色值,保持视觉统一) */
export const LEARNING_STATUS_COLORS: Record<LearningStatus, string> = {
  [LearningStatus.Learning]: "#facc15",  // 黄色
  [LearningStatus.Mastered]: "#22c55e",  // 绿色
  [LearningStatus.Review]:    "#8b5cf6",  // 紫色
};

/** 学习状态显示文案(中文) */
export const LEARNING_STATUS_LABELS: Record<LearningStatus, string> = {
  [LearningStatus.Learning]: "未掌握",
  [LearningStatus.Mastered]: "已掌握",
  [LearningStatus.Review]:    "需复习",
};

/** 词库中一个单词的记录 */
export interface WordRecord {
  id: string;          // 唯一 ID
  word: string;        // 单词（小写）
  phonetic: string;    // 音标
  pos: string;         // 词性（如 n. / v.）
  meaning: string;     // 释义
  mastery: number;     // 掌握程度 0~5（实心星数量）
  status: WordStatus;  // 状态
  /** 2026-08-22 新增:学习状态(词库驱动文档高亮用,默认 'learning')。
   *  与 status(复习队列)正交:status=Archived 的单词也可能有 learningStatus=mastered。 */
  learningStatus?: LearningStatus;
  labels?: string[];   // 分类标签 id 数组（2026-08-14 新增，与批注 labels 共享命名空间）
  example?: string;    // 例句（AI 精读时同步的上下文原句，可选）
  created: string;     // 纳入时间（ISO）
  updated: string;     // 更新时间（ISO）
  order: number;       // 自定义排序权重（主题内，越小越靠前）
  /** 来源块 ID 列表（AI 精读自动入库时记录溯源，便于回跳原文） */
  sourceBlockIds?: string[];

  // ============ 复习调度（自研 SRS，2026-08-17 新增）============
  /** 被查询次数（查词时自增；查询越多越该复习，权重最高） */
  queryCount?: number;
  /** 固有难度 0~1（由 difficulty.ts 计算并缓存，避免每次重算） */
  difficulty?: number;
  /** 词典义项数（多义性来源，收词时从词典解析写入；用于难度计算的 polysemy 维度） */
  senseCount?: number;
  /** 系统记忆强度 0~5（复习算法维护；掌握度越高，复习优先级越低。
   *  与手动星 `mastery` 区分：mastery=用户主观重要性，recall=算法估算的记忆保持度。 */
  recall?: number;
  /** 有效复习次数（again 以外的评分计数） */
  reps?: number;
  /** 遗忘次数（again 评分累计） */
  lapse?: number;
  /** 上次复习评分档位 */
  lastGrade?: ReviewGrade;
  /** 上次复习时间（ISO 字符串） */
  lastReview?: string;
  /** 下次到期时间（ISO 字符串）；为空表示立即可复习 */
  due?: string;
  /** 当前间隔天数（SM-2） */
  intervalDays?: number;
  /** 易度因子（SM-2 ease，默认 2.5） */
  ease?: number;
  /**
   * 2026-08-22 释义偏好：用户主动挑选的"⭐ 优先"释义（中文文本数组，精确匹配 dict-renderer SenseItem.zh）。
   * - 复习卡片只显示这些（可切换"显示全部"看完整 meaning）
   * - 查词卡片命中行加 ⭐ + 金色背景高亮
   * - 选词时由用户主动挑选，空数组/未设置 = fallback 到 meaning
   * - 老数据无此字段：UI 走 fallback
   */
  preferredDefinitions?: string[];
}

/** 复习评分档位（SM-2 四档） */
export type ReviewGrade = "again" | "hard" | "good" | "easy";

/** 一次复习事件（供 calibrate.ts 回拟合参数；由 updateReviewStats 累积） */
export interface ReviewEvent {
  grade: ReviewGrade;
  /** 该次复习被安排的间隔（上一次评分后给出的 intervalDays） */
  scheduledIntervalDays: number;
  /** 再上一次的间隔（推导倍率用；首学为 0） */
  prevIntervalDays: number;
  /** 安排时的固有难度 0~1 */
  difficulty: number;
  /** 该间隔到期后的那次复习是否通过（grade!=="again" 视为通过） */
  recalled: boolean;
  /** 发生时间 ISO（可选，便于裁剪窗口） */
  at?: string;
}

/** 复习权重（调度优先级合成用，与 difficulty.ts 解耦） */
export const REVIEW_WEIGHTS = {
  query: 1.0,   // 查询次数
  star: 0.9,    // 手动星 mastery（主观重要性）
  time: 0.7,    // 时间衰减（距上次复习越久越该复习）
  ease: 0.8,    // 易度（越低越该复习）
  lapse: 0.4,   // 遗忘次数
  difficulty: 0.3, // 固有难度
  recall: 1.0,  // 系统记忆强度（负向：越熟越压低优先级）
} as const;

/**
 * 评分档位对应的 SM-2 间隔倍率（校准值，见 review/config.ts 注释来源）。
 * again=1.0（间隔归零重来）；hard≈1.3（约 1.3× 上期，偏保守）；
 * good=2.5（SuperMemo/Anki 通用的「良好」增长因子）；
 * easy=3.3（Anki 默认 easy bonus≈1.3×good 区间，2.5×1.3≈3.25→取 3.3）。
 */
export const GRADE_INTERVAL_MULTIPLIER: Record<ReviewGrade, number> = {
  again: 1.0,
  hard: 1.3,
  good: 2.5,
  easy: 3.3,
};

/** 二级：主题（如 高频词 / 中频词 / 低频词 ...） */
export interface VocabTheme {
  id: string;
  name: string;
  order: number;       // 主题排序权重
  words: WordRecord[];
}

/** 一级：单词本 */
export interface VocabBook {
  id: string;
  name: string;
  order: number;       // 单词本排序权重
  themes: VocabTheme[];
  /** 2026-09-11 新增：单词本状态（草稿/已校验），老数据缺 → 默认 'verified' */
  status?: BookStatus;
  /** 2026-09-11 新增：draft → verified 的转换时刻 ISO */
  verifiedAt?: string;
  /** 2026-09-11 新增：校验时的词数快照（用于"校验后词数"显示） */
  verifiedWordCount?: number;
  /** 2026-09-11 新增：单词本来源，老数据缺 → 默认 'manual' */
  source?: BookSource;
  /** 2026-09-11 新增：导入元信息（仅 imported/doc-parsed 时有值） */
  importMeta?: VocabBookImportMeta;
}

/** 词库整体存储结构（存于插件数据 hiword-vocab.json） */
export interface VocabStoreData {
  books: VocabBook[];
  activeBookId: string;   // 当前选中的单词本
  activeThemeId: string;  // 当前选中的主题（用于加词归属与展示）
  /** 复习事件历史（供 calibrate.ts 回拟合参数；仅累积最近若干条） */
  reviewEvents?: ReviewEvent[];
}

/** 排序方式 */
export type VocabSort = "time" | "mastery" | "custom";

// ========== 思源块相关（已迁移至 src/siyuan/types.ts）==========
// 规范要求：所有思源数据结构统一在 src/siyuan/types.ts 定义。
// 此处 re-export 仅作向后兼容，新代码请直接 `import type { SiyuanBlock } from "./siyuan/index.ts"`。
export type { SiyuanBlockAttrs, SiyuanBlock } from "./siyuan/types.ts";
