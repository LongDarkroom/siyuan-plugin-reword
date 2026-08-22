/**
 * 复习调度引擎（自研 SRS 核心，纯函数、可独立单测）
 * ------------------------------------------------------------------
 * 两段式：
 *   1) 到期过滤：先筛出 due<=now 且 status===active 的单词；
 *   2) 优先级排序：按综合优先级降序，挑最高的 N 个。
 *
 * 单条优先级 = 各信号加权归一化和 − 掌握度惩罚：
 *   query↑ star↑ time↑ ease(难)↑ lapse↑ difficulty↑  → 越该复习
 *   recall(系统记忆强度)↑                              → 越压低优先级
 * 缺字段时用合理默认值（due 为空=立即可复习；lastReview 缺失回退 created），
 * 因此即使词库尚无任何复习记录，第一版也能正常排出队列。
 *
 * 评分（SM-2 简化）由 nextReviewState 计算下一批 SRS 状态，供存储层回写。
 *
 * 所有权重 / 倍率 / 边界均从 review/config.ts 读取（默认值与历史一致），
 * 故可通过 setReviewConfig 统一校准而不破坏本文件与既有测试。
 */

import type { WordRecord, ReviewGrade } from "../types.ts";
import { getReviewConfig } from "./config.ts";
import { computeDifficulty } from "./difficulty.ts";

const DAY_MS = 86_400_000;

export interface SchedulerOptions {
  /** 当前时间戳(ms)，默认 Date.now()；单测可注入固定值 */
  now?: number;
  /** 返回数量上限 */
  limit?: number;
  /** 若没有任何到期词，是否用全量（按优先级）兜底 */
  includeNotDue?: boolean;
}

/** 时间衰减因子：距上次复习越久越大（对数压缩，0~1） */
function timeDecay(record: WordRecord, now: number): number {
  const last = record.lastReview ? Date.parse(record.lastReview) : NaN;
  const base = Number.isNaN(last) ? (record.created ? Date.parse(record.created) : now) : last;
  const days = Math.max(0, (now - base) / DAY_MS);
  // log10 压缩：约 9 天≈0.5，约 90 天≈0.98
  return Math.min(1, Math.log10(days + 1) / 2);
}

/** 易度因子：ease 越低（越难记）值越大；默认 ease=2.5 → 0.25。
 *  分母为固定 2.0（等价于原 (3.0 - ease)/2.0，max 默认 3.0 时一致），保留历史数值以便测试与手算对照。 */
function easeFactor(record: WordRecord): number {
  const cfg = getReviewConfig().ease;
  const ease = typeof record.ease === "number" ? record.ease : cfg.default;
  return Math.max(0, Math.min(1, (cfg.max - ease) / 2.0));
}

function norm(v: number, max: number): number {
  return Math.max(0, Math.min(1, v / max));
}

/** 单条优先级（0~1）。纯函数，便于单测与调权。 */
export function priorityOf(record: WordRecord, now: number = Date.now()): number {
  const w = getReviewConfig().weights;
  const q = record.queryCount ?? 0;
  const star = record.mastery ?? 0; // 手动星（主观重要性）
  const t = timeDecay(record, now);
  const e = easeFactor(record);
  const lapse = record.lapse ?? 0;
  const diff = record.difficulty ?? computeDifficulty(record.word, { senseCount: record.senseCount }).difficulty;
  const recall = record.recall ?? 0; // 0~5

  const base =
    w.query * norm(q, 20) +
    w.star * (star / 5) +
    w.time * t +
    w.ease * e +
    w.lapse * norm(lapse, 5) +
    w.difficulty * diff;

  // 负向：系统记忆强度越高越压低优先级
  const penalty = w.recall * (recall / 5);
  return Math.max(0, base - penalty);
}

/** 是否到期可复习（active 且 due<=now；due 为空视为立即可复习） */
export function isDue(record: WordRecord, now: number = Date.now()): boolean {
  if (record.status && record.status !== "active") return false;
  if (!record.due) return true;
  const due = Date.parse(record.due);
  return Number.isNaN(due) ? true : due <= now;
}

/** 两段式：先过滤到期，再按优先级排序；返回单词数组（不修改入参）。 */
export function getDueQueue(words: WordRecord[], opts: SchedulerOptions = {}): WordRecord[] {
  const now = opts.now ?? Date.now();
  const due = words.filter((w) => isDue(w, now));
  const pool = due.length > 0 ? due : opts.includeNotDue ? words : [];
  const sorted = [...pool].sort((a, b) => priorityOf(b, now) - priorityOf(a, now));
  return opts.limit ? sorted.slice(0, opts.limit) : sorted;
}

/** 便捷入口：从候选里取前 n 个到期词（无到期则按优先级兜底） */
export function pickNext(words: WordRecord[], n = 1, opts: SchedulerOptions = {}): WordRecord[] {
  return getDueQueue(words, { ...opts, limit: n, includeNotDue: true });
}

/**
 * 评分后计算下一批 SRS 状态（SM-2 简化）。
 * - again：间隔归零（当天重来），ease 降、lapse+1、recall-1；
 * - hard/good/easy：间隔按倍率增长（good 默认 2 天起，easy 4 天起），ease 微调；
 * - 难度修正：固有难度越高，有效间隔越短（× (1 − c×difficulty)）。
 * 返回的是「待回写字段」，由存储层 updateReviewStats 合并。
 */
export function nextReviewState(
  record: WordRecord,
  grade: ReviewGrade,
  now: number = Date.now()
): Partial<WordRecord> {
  const cfg = getReviewConfig();
  const mult = cfg.gradeMultiplier[grade];
  const prevInterval = record.intervalDays ?? 0;
  let ease = typeof record.ease === "number" ? record.ease : cfg.ease.default;
  let interval: number;

  if (grade === "again") {
    interval = 0;
    ease = Math.max(cfg.ease.min, ease - cfg.ease.againDelta);
  } else {
    if (prevInterval === 0) {
      // 首次有效复习：用档位对应的初始天数
      interval = grade === "hard" ? cfg.initInterval.hard : grade === "good" ? cfg.initInterval.good : cfg.initInterval.easy;
    } else {
      interval = Math.round(prevInterval * mult);
    }
    if (grade === "hard") ease = Math.max(cfg.ease.min, ease - cfg.ease.hardDelta);
    else if (grade === "easy") ease = Math.min(cfg.ease.max, ease + cfg.ease.easyDelta);
  }

  const lapse = (record.lapse ?? 0) + (grade === "again" ? 1 : 0);
  const reps = (record.reps ?? 0) + (grade === "again" ? 0 : 1);

  let recall = record.recall ?? 0;
  if (grade === "again") recall = Math.max(0, recall - 1);
  else if (grade === "good") recall = Math.min(5, recall + 1);
  else if (grade === "easy") recall = Math.min(5, recall + 2);

  // 难度修正：越难间隔越短
  const diff = record.difficulty ?? 0.5;
  const effectiveInterval = Math.max(0, Math.round(interval * (1 - cfg.difficultyCorrection * diff)));

  const dueTime = now + effectiveInterval * DAY_MS;
  return {
    lastGrade: grade,
    lastReview: new Date(now).toISOString(),
    intervalDays: effectiveInterval,
    ease,
    lapse,
    reps,
    recall,
    due: new Date(dueTime).toISOString(),
  };
}
