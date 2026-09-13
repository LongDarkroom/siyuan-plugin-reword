/**
 * 复习历史 · 按日聚合（单一真源）
 * ------------------------------------------------------------------
 * 2026-09-12 工作台硬伤修复（D1 / D2 / D3）。此前「复习按日数据」在三处各自实现
 * （工作台热力图、工作台近 7 天柱状、复习面板数据统计 Tab），且一律用
 * `WordRecord.lastReview` 单时间戳近似。每个词只贡献「最后一次复习」那一个日期，于是：
 *   - 同一天复习多次只算 1 次（少计）；
 *   - 之后再复习一次，会让**过去某天**的计数 −1、今天 +1 —— 历史格子会自己变浅；
 *   - 越常复习的词，历史越被不断搬到最近，恰好抹掉高频词的历史。
 * 三处还会互相打架：工作台卡片标题走「active 候选 + 滚动 7×24h」，柱子走「全量词」，
 * 同一张卡片里两个数字必然不等（D1）。
 *
 * 现在统一走本模块，且优先读事件级日志：
 *   - `reviewEvents` 每次评分写一条（`ReviewEvent.at` 为 ISO 时间戳），同日多次复习各自
 *     计数、历史不随后续操作改写；
 *   - 事件窗口（`REVIEW_EVENT_CAP` = 2000 条滚动上限）之外的日子才回落 `lastReview`
 *     近似 —— 每个词在其最后一次复习日计 1 次（同日多次会少计，属已知近似）。
 *
 * 纯函数，不依赖思源运行时，可被 node:test 直接覆盖。
 */

import type { ReviewEvent, WordRecord } from "../types.ts";
import { localDateKey } from "./review-source.ts";

const DAY_MS = 86_400_000;

/**
 * 按天聚合复习次数。
 *
 * 回落规则：`lastReview` 只在**严格早于「事件日志最早一天」**时才计入。
 * 否则同一次复习会被事件与快照各记一遍（事件日志不含 wordId，无法按词去重，
 * 只能按日期切分）。`reviewEvents` 为空（老库 / 尚未复习过）时退化为纯
 * `lastReview` 近似 —— 与修复前行为一致。
 *
 * @returns Map<"YYYY-MM-DD", 次数>，只含真正有记录的日子
 */
export function buildReviewDayMap(
  words: readonly WordRecord[],
  events: readonly ReviewEvent[]
): Map<string, number> {
  const map = new Map<string, number>();
  let earliestEventDay: string | null = null;

  for (const ev of events) {
    const at = ev?.at;
    if (!at) continue;
    const ts = Date.parse(at);
    if (Number.isNaN(ts)) continue;
    const key = localDateKey(ts);
    map.set(key, (map.get(key) || 0) + 1);
    // "YYYY-MM-DD" 可直接按字典序比较
    if (earliestEventDay === null || key < earliestEventDay) earliestEventDay = key;
  }

  for (const w of words) {
    if (!w.lastReview) continue;
    const ts = Date.parse(w.lastReview);
    if (Number.isNaN(ts)) continue;
    const key = localDateKey(ts);
    if (earliestEventDay !== null && key >= earliestEventDay) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }

  return map;
}

/** 最近 n 个自然日（含今天）的合计次数 */
export function sumRecentDays(
  dayMap: ReadonlyMap<string, number>,
  days: number,
  now: number = Date.now()
): number {
  const sod = startOfDay(now);
  let sum = 0;
  for (let i = 0; i < days; i++) sum += dayMap.get(localDateKey(sod - i * DAY_MS)) || 0;
  return sum;
}

/** 某时刻的本地 00:00:00 毫秒 */
export function startOfDay(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 连续天数：从今天（或昨天）往前数，连续「有记录」的自然日。
 * 今天无记录时允许从昨天起算 —— 与 `reader/stats.ts` 的阅读 streak 口径一致，
 * 避免「今天还没开始就断签」的挫败感。
 *
 * @param daySet 有记录的本地日期集合（如 Map 的 keys 或阅读日 ∪ 复习日）
 */
export function computeDayStreak(
  daySet: ReadonlySet<string>,
  now: number = Date.now()
): { streak: number; longest: number } {
  if (daySet.size === 0) return { streak: 0, longest: 0 };

  let cursor = startOfDay(now);
  if (!daySet.has(localDateKey(cursor))) cursor -= DAY_MS;
  let streak = 0;
  while (daySet.has(localDateKey(cursor))) {
    streak++;
    cursor -= DAY_MS;
  }

  const sorted = [...daySet].sort();
  let longest = 1;
  let cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T00:00:00");
    const day = new Date(sorted[i] + "T00:00:00");
    cur = Math.round((day.getTime() - prev.getTime()) / DAY_MS) === 1 ? cur + 1 : 1;
    if (cur > longest) longest = cur;
  }
  return { streak, longest };
}
