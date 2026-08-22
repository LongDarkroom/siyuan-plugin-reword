/**
 * ReviewConfig 校准层单元测试（自研 SRS 的「调参中枢」）
 * 验证：defaultReviewConfig 为研究级校准默认值、深合并、对调度/SM-2 的实际影响、reset。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getReviewConfig,
  setReviewConfig,
  resetReviewConfig,
  defaultReviewConfig,
} from "../src/review/config.ts";
import { REVIEW_WEIGHTS, GRADE_INTERVAL_MULTIPLIER } from "../src/types.ts";
import { priorityOf, nextReviewState } from "../src/review/scheduler.ts";

const NOW = Date.parse("2026-08-18T00:00:00Z");

test("defaultReviewConfig: 研究级校准默认值正确", () => {
  const d = defaultReviewConfig();
  assert.equal(d.weights.query, REVIEW_WEIGHTS.query);
  assert.equal(d.weights.star, REVIEW_WEIGHTS.star);
  assert.equal(d.weights.recall, REVIEW_WEIGHTS.recall);
  assert.equal(d.gradeMultiplier.good, GRADE_INTERVAL_MULTIPLIER.good);
  assert.equal(d.gradeMultiplier.easy, GRADE_INTERVAL_MULTIPLIER.easy);
  assert.equal(d.initInterval.good, 2);
  assert.equal(d.initInterval.easy, 4);
  assert.equal(d.ease.default, 2.5);
  assert.equal(d.difficultyCorrection, 0.3); // 校准值（FSRS 量级，较初版 0.4 更稳）
  assert.equal(d.dailyLimit, 20);
  assert.equal(d.enableFrequencySeed, true);
  assert.equal(d.frequencyCorpusSize, 20000); // 运行期由全量词频表长度覆盖
});

test("setReviewConfig: 深合并并保留未覆盖字段", () => {
  setReviewConfig({ weights: { query: 0 }, gradeMultiplier: { good: 3 }, dailyLimit: 50 });
  const c = getReviewConfig();
  assert.equal(c.weights.query, 0);
  assert.equal(c.weights.star, REVIEW_WEIGHTS.star); // 未覆盖 → 保留默认
  assert.equal(c.gradeMultiplier.good, 3);
  assert.equal(c.gradeMultiplier.easy, GRADE_INTERVAL_MULTIPLIER.easy); // 未覆盖 → 保留
  assert.equal(c.dailyLimit, 50);
  resetReviewConfig();
});

test("setReviewConfig 生效于优先级（query 权重置 0 → 高查询词优先级下降）", () => {
  const rec = { ease: 2.5, difficulty: 0.5, queryCount: 20, mastery: 0, recall: 0 };
  const before = priorityOf(rec, NOW);
  setReviewConfig({ weights: { query: 0 } });
  const after = priorityOf(rec, NOW);
  assert.ok(after < before, `expect after(${after}) < before(${before})`);
  resetReviewConfig();
});

test("setReviewConfig 生效于 SM-2（good 初始间隔改为 10 → 有效间隔 9）", () => {
  setReviewConfig({ initInterval: { good: 10 } });
  const p = nextReviewState({ ease: 2.5, intervalDays: 0, difficulty: 0.5 }, "good", NOW);
  // round(10 * (1 - 0.3*0.5)) = round(8.5) = 9
  assert.equal(p.intervalDays, 9);
  resetReviewConfig();
});

test("setReviewConfig 生效于 SM-2（难度修正系数改为 0 → 间隔不受难度影响）", () => {
  setReviewConfig({ difficultyCorrection: 0 });
  const p = nextReviewState({ ease: 2.5, intervalDays: 0, difficulty: 1.0 }, "good", NOW);
  // 难度修正关闭 → round(2 * 1.0) = 2（而非 1）
  assert.equal(p.intervalDays, 2);
  resetReviewConfig();
});

test("resetReviewConfig 恢复默认", () => {
  setReviewConfig({ dailyLimit: 99, weights: { query: 0 } });
  resetReviewConfig();
  const c = getReviewConfig();
  assert.equal(c.dailyLimit, 20);
  assert.equal(c.weights.query, REVIEW_WEIGHTS.query);
});
