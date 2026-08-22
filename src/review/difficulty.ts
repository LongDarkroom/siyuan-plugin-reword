/**
 * 单词难度计算（自研 SRS 的难度维度）
 * ------------------------------------------------------------------
 * 难度由四个因子合成（各 0~1）：
 *   rarity       词频稀有度   权重 0.35
 *   lengthFactor 词长         权重 0.25
 *   awlScore     学术词表命中 权重 0.20
 *   polysemy     多义性       权重 0.20
 *
 * 设计原则：第一版「零外部依赖」也能跑（rarity/awl 用回退常量），
 * 后续通过 setFrequencyData() / setAwlData() 注入真实词频表 / AWL 词表即可
 * 提升精度——调用方（scheduler / vocab-store）无需改动 → 平滑衔接后续打磨。
 *
 * 本文件不依赖任何 DOM / 思源 API / 词典引擎，可独立单测。
 *
 * 权重 / 词频表规模从 review/config.ts 的 ReviewConfig 读取（默认值与历史一致），
 * 因此可通过 setReviewConfig 统一校准，无需改动本文件。
 */

import { getReviewConfig } from "./config.ts";

export interface DifficultyFactors {
  /** 词频稀有度 0~1（越大越稀有、越难） */
  rarity: number;
  /** 词长因子 0~1 */
  lengthFactor: number;
  /** 学术词表命中 0~1 */
  awlScore: number;
  /** 多义性 0~1 */
  polysemy: number;
}

export interface DifficultyInput {
  /** 词典义项数（多义性来源）；不传则回退默认中性值 */
  senseCount?: number;
  /** 词频排名（越小越常见）；来自词频表 */
  frequencyRank?: number;
  /** 是否命中学术词表 AWL */
  awlHit?: boolean;
}

// 权重从 ReviewConfig 读取（默认值等价于历史 WEIGHTS），保持单测不变的前提下可统一调参。
// 注意：函数内按需 getReviewConfig()，避免模块加载顺序问题。

// ============ 可注入的外部数据（后续完善衔接点）============
let frequencyMap: Map<string, number> | null = null; // word(lower) -> rank
let awlSet: Set<string> | null = null;               // AWL 学术词表（小写）

/** 注入词频表（word -> rank）。后续接入 COCA/BNC 时调用，无需改调用方。 */
export function setFrequencyData(map: Map<string, number>): void {
  frequencyMap = map;
}

/** 注入 AWL 学术词表（Set of 小写词）。 */
export function setAwlData(set: Set<string>): void {
  awlSet = set;
}

/** 是否已注入词频表（5.1 可观测性：让上层/测试确认冷启动数据到位） */
export function isFrequencyDataInjected(): boolean {
  return frequencyMap !== null && frequencyMap.size > 0;
}

/** 是否已注入 AWL 词表（5.1 可观测性） */
export function isAwlDataInjected(): boolean {
  return awlSet !== null && awlSet.size > 0;
}

/**
 * 测试辅助：清空已注入的外部数据（保证单测隔离，不污染后续用例）。
 * 仅测试用，文档/类型层面公开以便 stub 库能调用。
 */
export function __resetInjectedDataForTest(): void {
  frequencyMap = null;
  awlSet = null;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** 词长因子：3 字母及以下=0，13 字母及以上=1（线性插值） */
export function lengthFactor(word: string): number {
  const len = (word || "").replace(/[^a-zA-Z]/g, "").length;
  return clamp01((len - 3) / 10);
}

/** 多义性因子：由义项数估算，8 个以上义项记满；缺数据回退中性 0.3 */
export function polysemyFactor(senseCount?: number): number {
  if (typeof senseCount !== "number" || senseCount <= 0) return 0.3;
  return clamp01(senseCount / 8);
}

/** 词频稀有度：有词频表/排名时按排名归一化；无数据回退中性 0.5 */
export function rarityFactor(word: string, frequencyRank?: number): number {
  const w = (word || "").toLowerCase().trim();
  const corpus = getReviewConfig().frequencyCorpusSize;
  if (typeof frequencyRank === "number") {
    return clamp01(frequencyRank / corpus);
  }
  if (frequencyMap && frequencyMap.has(w)) {
    return clamp01((frequencyMap.get(w) as number) / corpus);
  }
  return 0.5; // 无数据：中性，不偏向
}

/** 学术词表因子：命中=1，否则 0；无数据回退 0（多数词非学术） */
export function awlFactor(word: string, awlHit?: boolean): number {
  const w = (word || "").toLowerCase().trim();
  if (typeof awlHit === "boolean") return awlHit ? 1 : 0;
  if (awlSet && awlSet.has(w)) return 1;
  return 0;
}

/** 合成难度（0~1）。返回四因子明细 + 合成值，便于调试与后续调权。 */
export function computeDifficulty(
  word: string,
  input: DifficultyInput = {}
): DifficultyFactors & { difficulty: number } {
  const W = getReviewConfig().difficultyWeights;
  const rarity = rarityFactor(word, input.frequencyRank);
  const lf = lengthFactor(word);
  const awl = awlFactor(word, input.awlHit);
  const poly = polysemyFactor(input.senseCount);
  const difficulty =
    W.rarity * rarity +
    W.length * lf +
    W.awl * awl +
    W.polysemy * poly;
  return {
    rarity,
    lengthFactor: lf,
    awlScore: awl,
    polysemy: poly,
    difficulty: clamp01(difficulty),
  };
}
