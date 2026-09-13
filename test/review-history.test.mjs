/**
 * review-history.ts 单元测试（2026-09-12 · 工作台硬伤修复 D1/D2/D3）
 * ------------------------------------------------------------------
 * 这个模块是「复习按日次数」的单一真源，但线上数据（reviewEvents）此刻是空数组，
 * 事件级路径无法靠真机验证 —— 单元测试是唯一能覆盖回落/窗口切分规则的手段。
 * 覆盖：事件级计数、事件窗口切分的 lastReview 回落、非法值容错、
 *      sumRecentDays 窗口、computeDayStreak（今天/昨天起算 + 历史最长）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReviewDayMap,
  computeDayStreak,
  startOfDay,
  sumRecentDays,
} from "../src/review/review-history.ts";

/** 本地时刻 → ISO（用本地构造再转 ISO，避免时区把日期挪一天） */
const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).toISOString();
const word = (lastReview) => ({ word: "w", lastReview });
const flat = (m) => Object.fromEntries(m);

test("buildReviewDayMap: 无事件时退化为 lastReview 近似（每词只记最后一次复习日）", () => {
  const words = [word(at(2026, 9, 10)), word(at(2026, 9, 10)), word(at(2026, 9, 9))];
  assert.deepEqual(flat(buildReviewDayMap(words, [])), { "2026-09-10": 2, "2026-09-09": 1 });
});

test("buildReviewDayMap: 事件级同日多次复习各计一次，且不再叠加 lastReview", () => {
  const words = [word(at(2026, 9, 12)), word(at(2026, 9, 12))];
  const events = [{ at: at(2026, 9, 12) }, { at: at(2026, 9, 12) }, { at: at(2026, 9, 12, 14) }];
  // 2 个词的 lastReview 都落在 9-12，但该日已被事件覆盖 → 只算 3 次事件，不变成 5
  assert.deepEqual(flat(buildReviewDayMap(words, events)), { "2026-09-12": 3 });
});

test("buildReviewDayMap: 只有严格早于「最早事件日」的 lastReview 才回落计入", () => {
  const words = [word(at(2026, 8, 30)), word(at(2026, 9, 10))];
  const events = [{ at: at(2026, 9, 10) }, { at: at(2026, 9, 11) }];
  assert.deepEqual(flat(buildReviewDayMap(words, events)), {
    "2026-08-30": 1, // 事件窗口之前 → 回落
    "2026-09-10": 1, // = 最早事件日 → 交给事件，不重复
    "2026-09-11": 1,
  });
});

test("buildReviewDayMap: 非法 / 缺失时间戳跳过，不产生 NaN 日期", () => {
  const words = [word("not-a-date"), { word: "no-lastReview" }, word(undefined)];
  const events = [{ at: "garbage" }, { grade: "good" }];
  assert.deepEqual(flat(buildReviewDayMap(words, events)), {});
});

test("sumRecentDays: 只统计近 n 个自然日（含今天）", () => {
  const now = new Date(2026, 8, 12, 15).getTime();
  const m = new Map([
    ["2026-09-12", 2],
    ["2026-09-11", 3],
    ["2026-09-06", 5],
    ["2026-09-05", 9], // 第 8 天，落在 7 日窗口外
  ]);
  assert.equal(sumRecentDays(m, 7, now), 10);
  assert.equal(sumRecentDays(m, 8, now), 19);
});

test("computeDayStreak: 今天有记录从今天数，今天空则从昨天起算", () => {
  const now = new Date(2026, 8, 12, 15).getTime();
  assert.deepEqual(computeDayStreak(new Set(["2026-09-12", "2026-09-11", "2026-09-10"]), now), {
    streak: 3,
    longest: 3,
  });
  assert.deepEqual(computeDayStreak(new Set(["2026-09-11", "2026-09-10"]), now), {
    streak: 2,
    longest: 2,
  });
});

test("computeDayStreak: 断签时 streak 归零，longest 仍保留历史最长", () => {
  const now = new Date(2026, 8, 12, 15).getTime();
  const r = computeDayStreak(new Set(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-10"]), now);
  assert.equal(r.streak, 0);
  assert.equal(r.longest, 3);
  assert.deepEqual(computeDayStreak(new Set(), now), { streak: 0, longest: 0 });
});

test("startOfDay: 取本地 00:00:00", () => {
  const t = new Date(2026, 8, 12, 23, 59, 59, 999).getTime();
  assert.equal(startOfDay(t), new Date(2026, 8, 12, 0, 0, 0, 0).getTime());
});
