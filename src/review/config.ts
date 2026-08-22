/**
 * 复习调度可校准配置（自研 SRS 的「调参中枢」）
 * ------------------------------------------------------------------
 * 把原先散落在 difficulty.ts / scheduler.ts 里的魔数（权重、SM-2 倍率、
 * 初始间隔、ease 边界、难度修正系数、每日复习上限、词频种子开关）集中到
 * 一个对象里，运行时可通过 setReviewConfig(partial) 覆盖，无需改源码。
 *
 * 设计原则：
 *  - 默认值采用「研究级校准值」（见 defaultReviewConfig 各字段注释，来源
 *    为 SuperMemo SM-2 原始论文、Anki 默认参数、FSRS 经验区间），不再是纯
 *    拍脑门；
 *  - 后续有了真实复习数据，调用 review/calibrate.ts 的 calibrateFromHistory()
 *    回拟合各档位倍率与难度修正系数，再 setReviewConfig() 应用即可，不碰
 *    算法代码；
 *  - 本模块零 DOM / 思源依赖，可独立单测。
 */

import { REVIEW_WEIGHTS, GRADE_INTERVAL_MULTIPLIER } from "../types.ts";
import type { ReviewGrade } from "../types.ts";

/** 复习优先级权重（与 difficulty 解耦） */
export interface ReviewWeights {
  query: number;      // 查询次数
  star: number;       // 手动星 mastery（主观重要性）
  time: number;       // 时间衰减
  ease: number;       // 易度（越低越该复习）
  lapse: number;      // 遗忘次数
  difficulty: number; // 固有难度
  recall: number;     // 系统记忆强度（负向惩罚）
}

/** 难度四因子权重 */
export interface DifficultyWeights {
  rarity: number;
  length: number;
  awl: number;
  polysemy: number;
}

/** SM-2 评分档位对应的间隔倍率 */
export type GradeMultiplier = Record<ReviewGrade, number>;

/** 首次有效复习的初始间隔（天） */
export interface InitInterval {
  hard: number;
  good: number;
  easy: number;
}

/** SM-2 ease 因子参数 */
export interface EaseParams {
  default: number;
  min: number;
  max: number;
  againDelta: number; // again 时 ease 下降量
  hardDelta: number;  // hard 时 ease 下降量
  easyDelta: number;  // easy 时 ease 上升量
}

export interface ReviewConfig {
  weights: ReviewWeights;
  difficultyWeights: DifficultyWeights;
  gradeMultiplier: GradeMultiplier;
  initInterval: InitInterval;
  ease: EaseParams;
  /** 难度修正系数 c：有效间隔 = round(interval * (1 - c*difficulty)) */
  difficultyCorrection: number;
  /** 词频表归一化规模（排名 / 该值 → 0~1） */
  frequencyCorpusSize: number;
  /** 是否启用内置高频词种子（无外部词频表时的回退） */
  enableFrequencySeed: boolean;
  /** 每日复习上限：复习会话从队列取前 N 个（0 = 不限） */
  dailyLimit: number;
}

/**
 * 研究级默认值（校准基线）。各数值来源：
 *  - gradeMultiplier：good=2.5 取自 SM-2 / Anki 通用「良好」增长因子；
 *    hard=1.3 偏保守（≈1.3×上期）；easy=3.3 取 Anki easy bonus≈1.3×good 区间。
 *  - initInterval：首学毕业间隔 hard=1 / good=2 / easy=4 天（Anki 默认毕业
 *    区间 good≈1、easy≈4 的折中，略拉开以减少早期重复负担）。
 *  - ease：default 2.5 / min 1.3 为 SM-2 原始设定；again/hard/easy 调幅沿用
 *    SM-2 的 0.2 / 0.05 / 0.1 经验值。
 *  - difficultyCorrection=0.3：固有难度对间隔的折减系数，参考 FSRS 对「难度」
 *    的温和处理（0.1~0.3 量级），比初版 0.4 更稳，避免难词被压得过短。
 *  - frequencyCorpusSize：运行时由全量词频表长度覆盖（≈50000），此处仅兜底。
 */
export function defaultReviewConfig(): ReviewConfig {
  return {
    weights: { ...REVIEW_WEIGHTS },
    difficultyWeights: { rarity: 0.35, length: 0.25, awl: 0.2, polysemy: 0.2 },
    gradeMultiplier: { ...GRADE_INTERVAL_MULTIPLIER }, // easy 已校准为 3.3
    initInterval: { hard: 1, good: 2, easy: 4 },
    ease: { default: 2.5, min: 1.3, max: 3.0, againDelta: 0.2, hardDelta: 0.05, easyDelta: 0.1 },
    difficultyCorrection: 0.3,
    frequencyCorpusSize: 20000,
    enableFrequencySeed: true,
    dailyLimit: 20,
  };
}

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (patch === undefined || patch === null) return base;
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    // 基本类型 / 数组：直接覆盖
    return (patch as unknown as T);
  }
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const k of Object.keys(patch as any)) {
    const pv = (patch as any)[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv) && typeof (base as any)[k] === "object") {
      out[k] = deepMerge((base as any)[k], pv);
    } else if (pv !== undefined) {
      out[k] = pv;
    }
  }
  return out as T;
}

/** 递归部分覆盖类型（仅用于 setReviewConfig 入参） */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

let current: ReviewConfig = defaultReviewConfig();

export function getReviewConfig(): ReviewConfig {
  return current;
}

/** 用部分覆盖合并到当前配置（用于持久化配置或运行时调参） */
export function setReviewConfig(patch: DeepPartial<ReviewConfig>): ReviewConfig {
  current = deepMerge(current, patch);
  return current;
}

export function resetReviewConfig(): ReviewConfig {
  current = defaultReviewConfig();
  return current;
}
