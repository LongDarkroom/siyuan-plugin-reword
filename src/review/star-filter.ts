/**
 * 熟练度计数（2026-09-11 · 复习面板重构 v4）
 * ------------------------------------------------------------------
 * v3/v4 起熟练度 = WordRecord.mastery（1~5 级）本身，不再有档位文字标签
 * （生疏/起步/熟练/精通等已废弃）。本模块只保留统计 Tab 的「星级分布」所需
 * 的按级计数，以及 mastery 兜底归一，纯函数可测。
 */

import type { WordRecord } from "../types.ts";

export type MasteryLevel = 1 | 2 | 3 | 4 | 5;

/** mastery 兜底归一：undefined/NaN/越界 → 0（未评级）；否则 clamp 到 0~5 */
export function normalizeMastery(mastery: number | undefined | null): number {
  const m = Math.round(Number(mastery ?? 0));
  return Number.isFinite(m) ? Math.max(0, Math.min(5, m)) : 0;
}

/**
 * 按 mastery 1~5 精确计数（统计 Tab「星级分布」用）。
 * 未评级（0 / 非法）的词不计入任何档——分布只反映已打级的词。
 */
export function countByMastery<T extends Pick<WordRecord, "mastery">>(
  words: T[]
): Record<MasteryLevel, number> {
  const out: Record<MasteryLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const w of words) {
    const level = normalizeMastery(w?.mastery);
    if (level >= 1) out[level as MasteryLevel]++;
  }
  return out;
}

/** 测试辅助 */
export function __resetStarFilterForTest(): void {
  /* 无模块级状态 */
}
