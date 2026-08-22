/**
 * 复习算法校准器（自研 SRS 的「真校准」入口）
 * ------------------------------------------------------------------
 * 给定一段复习历史（ReviewEvent[]），用指数遗忘曲线模型为各档位推导推荐间隔倍率：
 *
 *   某档位实测留存率 r = 该档位「通过」事件占比；
 *   目标留存 target（默认 0.9）；
 *   由 0.5^(I/H) 曲线得：倍率 m = log(target) / log(r)
 *     - r ≥ target（当前间隔已足够稳）→ m > 1，下次拉长间隔；
 *     - r <  target（当前间隔偏长、易忘）→ m < 1，下次缩短间隔（夹紧到下限）。
 *
 * 难度修正系数 c 采用研究设定值（见 config.ts），【不拟合】——因为 c 与半衰期 H
 * 在「仅记录 (间隔, 难度, 是否通过)」的数据下不可独立辨识（H 会吸收 c 的效应）。
 * 故校准只回拟合各档位倍率，c 保持研究级默认值，可由 setReviewConfig 手动微调。
 *
 * 之后调用 applyCalibration() 把结果写入运行时配置，即完成「基于真实数据的校准」，
 * 全程不碰算法源码。无历史时 calibrateFromHistory 返回当前默认值（零样本安全）。
 *
 * 本模块零 DOM / 思源依赖，可独立单测。
 */

import type { ReviewGrade, ReviewEvent } from "../types.ts";
import { getReviewConfig, setReviewConfig } from "./config.ts";
import type { GradeMultiplier, ReviewConfig } from "./config.ts";

const LOG_HALF = Math.log(0.5);

export interface CalibrationResult {
  gradeMultiplier: GradeMultiplier;
  difficultyCorrection: number;
  targetRetention: number;
  eventsUsed: number;
  /** 各档位实测留存率、推荐倍率、样本量，便于展示/审计 */
  detail: Record<ReviewGrade, { recallRate: number; multiplier: number; samples: number }>;
  notes: string[];
}

/** 各档位倍率夹紧区间（避免回拟合出离谱值） */
const MULT_CLAMP: Record<"hard" | "good" | "easy", [number, number]> = {
  hard: [0.9, 1.6],
  good: [1.0, 3.5],
  easy: [1.2, 6.0],
};

/**
 * 从复习历史回拟合间隔倍率。
 * @param events 历史复习事件（某档位 ≥3 条才拟合，否则沿用默认）
 * @param opts.targetRetention 目标留存率（默认 0.9）
 * @param opts.initCorrection  难度修正系数（固定为研究值；默认取当前配置）
 */
export function calibrateFromHistory(
  events: ReviewEvent[],
  opts: { targetRetention?: number; initCorrection?: number } = {}
): CalibrationResult {
  const target = opts.targetRetention ?? 0.9;
  // c 固定为研究值（与半衰期不可独立辨识，故不拟合）
  const c = opts.initCorrection ?? getReviewConfig().difficultyCorrection;
  const notes: string[] = [];
  notes.push(`难度修正系数 c 固定为研究值 ${c.toFixed(2)}（与半衰期不可独立辨识，不拟合）`);

  const usable = events.filter((e) => e.scheduledIntervalDays > 0);

  const mult: GradeMultiplier = {
    again: 1.0,
    hard: getReviewConfig().gradeMultiplier.hard,
    good: getReviewConfig().gradeMultiplier.good,
    easy: getReviewConfig().gradeMultiplier.easy,
  };
  const detail = {} as CalibrationResult["detail"];

  const GRADES = ["hard", "good", "easy"] as const;
  for (const g of GRADES) {
    const ge = usable.filter((e) => e.grade === g);
    if (ge.length < 3) {
      notes.push(`档位 ${g} 样本不足(<3)，沿用默认值`);
      detail[g] = { recallRate: NaN, multiplier: mult[g], samples: ge.length };
      continue;
    }
    const recalled = ge.filter((e) => e.recalled).length;
    const rate = recalled / ge.length;
    // 防止 log 奇异/除零：夹到 [0.5, 0.985]
    const rateC = Math.min(0.985, Math.max(0.5, rate));
    // m = log(target)/log(rate)：rate>target → m>1（增长）；rate<target → m<1（缩短）
    let m = Math.log(target) / Math.log(rateC);
    const [lo, hi] = MULT_CLAMP[g];
    m = Math.min(hi, Math.max(lo, m));
    m = Math.round(m * 100) / 100;
    mult[g] = m;
    detail[g] = { recallRate: Math.round(rate * 1000) / 1000, multiplier: m, samples: ge.length };
    notes.push(`档位 ${g}: 实测留存 ${(rate * 100).toFixed(0)}%, 推荐倍率 ${m}`);
  }

  return { gradeMultiplier: mult, difficultyCorrection: c, targetRetention: target, eventsUsed: usable.length, detail, notes };
}

/** 把校准结果写入运行时配置（供「校准复习算法」命令调用） */
export function applyCalibration(res: CalibrationResult): ReviewConfig {
  return setReviewConfig({
    gradeMultiplier: res.gradeMultiplier,
    difficultyCorrection: res.difficultyCorrection,
  });
}
