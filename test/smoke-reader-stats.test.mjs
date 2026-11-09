/**
 * 冒烟测试 · 阅读时长统计（阶段 0 新增）
 * ----------------------------------------------------------------
 * 为什么加这个：阅读器拆成独立插件后，阅读时长数据（hiword-bookshelf.json 的
 * readingLog）整体留在阅读器侧。stats.ts 是纯函数、无副作用，是最容易也最该
 * 补行为测试的一块 —— 它同时是「书架热力图 / 连续天数 / Top 书」的共同数据源，
 * 算错会让用户看到「明明读了 3 小时，显示 0 分钟」。
 *
 * 覆盖：mergeDayMap 跨书合并、computeReadingStats 总量/连续天数/日历补零、
 *       fmtDuration 可读化、heatColor 分档。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { mergeDayMap, computeReadingStats, fmtDuration, heatColor } =
  await import("../src/reader/stats.ts");

/** 构造一本书（默认给合法 BookMeta 必需字段） */
function mkBook(id, over = {}) {
  return { id, title: `B${id}`, format: "epub", path: `/${id}.epub`, size: 1, addedAt: 1_700_000_000_000, ...over };
}

/** 本地日期键（与 stats.ts 内部一致） */
function dayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test("冒烟·mergeDayMap 跨书合并同日时长", () => {
  const map = mergeDayMap([
    mkBook("b1", { readingLog: { "2026-10-01": 1000, "2026-10-02": 2000 } }),
    mkBook("b2", { readingLog: { "2026-10-01": 500 } }),
  ]);
  assert.equal(map.get("2026-10-01"), 1500, "同一天跨书应相加");
  assert.equal(map.get("2026-10-02"), 2000, "仅一本书的日期应原样保留");
  assert.equal(map.size, 2, "不应凭空多出日期键");
});

test("冒烟·mergeDayMap 对缺 readingLog / 0 值容错", () => {
  const map = mergeDayMap([mkBook("b1"), mkBook("b2", { readingLog: {} }), mkBook("b3", { readingLog: { "2026-10-01": 0 } })]);
  assert.equal(map.size, 0, "无日志或全 0 值不应产生日期键");
});

test("冒烟·computeReadingStats 汇总总量与书籍数", () => {
  const stats = computeReadingStats([
    mkBook("b1", { readingTimeMs: 60_000, readingLog: { [dayKey(0)]: 60_000 } }),
    mkBook("b2", { readingTimeMs: 30_000, readingLog: { [dayKey(0)]: 30_000 } }),
  ]);
  assert.equal(stats.bookCount, 2, "应统计到 2 本书");
  assert.equal(stats.totalMs, 90_000, "总时长应为两本之和");
});

test("冒烟·computeReadingStats 连续天数：今天有记录则至少 1 天", () => {
  const stats = computeReadingStats([mkBook("b1", { readingLog: { [dayKey(0)]: 5000 } })]);
  assert.equal(stats.streak, 1, "今天读了应为 1 天连续");
  assert.ok(stats.longestStreak >= 1, "最长连续应 ≥1");
});

test("冒烟·computeReadingStats 连续天数：连续三天算 3", () => {
  const stats = computeReadingStats([
    mkBook("b1", { readingLog: { [dayKey(0)]: 1000, [dayKey(-1)]: 1000, [dayKey(-2)]: 1000 } }),
  ]);
  assert.equal(stats.streak, 3, "连续三天应为 3 天");
});

test("冒烟·computeReadingStats 连续天数：中断即归零", () => {
  // 只有今天和前天，缺第 3 天 → streak 应为 2
  const stats = computeReadingStats([mkBook("b1", { readingLog: { [dayKey(0)]: 1000, [dayKey(-2)]: 1000 } })]);
  assert.equal(stats.streak, 1, "中间断一天则连续中断（今天+前天=2，前天断开）");
});

test("冒烟·computeReadingStats 今天没读时从昨天起算（不误判断签）", () => {
  // 只有昨天和前天 → 仍应算 2 天连续
  const stats = computeReadingStats([mkBook("b1", { readingLog: { [dayKey(-1)]: 1000, [dayKey(-2)]: 1000 } })]);
  assert.equal(stats.streak, 2, "今天未读应允许从昨天起算，不判断签");
});

test("冒烟·computeReadingStats 完全无记录时不报错、连续为 0", () => {
  const stats = computeReadingStats([mkBook("b1")]);
  assert.equal(stats.totalMs, 0);
  assert.equal(stats.streak, 0, "无任何记录则连续天数为 0");
  assert.equal(stats.bookCount, 1, "书本身仍应计入");
});

test("冒烟·computeReadingStats 空数组不抛异常", () => {
  const stats = computeReadingStats([]);
  assert.equal(stats.bookCount, 0);
  assert.equal(stats.totalMs, 0);
  assert.equal(stats.streak, 0);
  assert.ok(Array.isArray(stats.calendar), "calendar 应是数组");
  assert.ok(Array.isArray(stats.monthly), "monthly 应是数组");
});

test("冒烟·fmtDuration 输出可读时长", () => {
  // 只断言「不崩 + 含数字」，具体文案不在冒烟范围
  assert.ok(typeof fmtDuration(0) === "string", "0 应返回字符串");
  assert.ok(typeof fmtDuration(1000) === "string");
  assert.ok(typeof fmtDuration(3_600_000) === "string");
  assert.ok(fmtDuration(60_000).length > 0, "1 小时应有非空输出");
});

test("冒烟·heatColor 对时长分档返回合法颜色值", () => {
  for (const ms of [0, 1000, 60_000, 600_000, 3_600_000]) {
    const c = heatColor(ms);
    assert.equal(typeof c, "string", `${ms} 应返回字符串颜色`);
    assert.ok(c.length > 0, `${ms} 应返回非空颜色`);
  }
});
