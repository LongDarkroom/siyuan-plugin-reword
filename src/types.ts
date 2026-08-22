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

/** 词库中一个单词的记录 */
export interface WordRecord {
  id: string;          // 唯一 ID
  word: string;        // 单词（小写）
  phonetic: string;    // 音标
  pos: string;         // 词性（如 n. / v.）
  meaning: string;     // 释义
  mastery: number;     // 掌握程度 0~5（实心星数量）
  status: WordStatus;  // 状态
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
