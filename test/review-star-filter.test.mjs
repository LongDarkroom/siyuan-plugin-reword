/**
 * star-filter.ts 单元测试（2026-09-11 · 复习面板重构 v4）
 * v3/v4 起熟练度 = mastery（1~5 级）本身，无档位文字标签；
 * 覆盖 normalizeMastery / countByMastery。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMastery, countByMastery } from "../src/review/star-filter.ts";

const w = (mastery) => ({ word: `m${mastery}`, mastery });

test("normalizeMastery: 合法值与边界 clamp", () => {
  assert.equal(normalizeMastery(0), 0);
  assert.equal(normalizeMastery(1), 1);
  assert.equal(normalizeMastery(5), 5);
  assert.equal(normalizeMastery(-3), 0);
  assert.equal(normalizeMastery(9), 5);
  assert.equal(normalizeMastery(undefined), 0);
  assert.equal(normalizeMastery(null), 0);
  assert.equal(normalizeMastery(NaN), 0);
  assert.equal(normalizeMastery(2.6), 3); // round
});

test("countByMastery: 各档精确计数（未评级不计入）", () => {
  const arr = [w(0), w(1), w(2), w(3), w(4), w(5), w(5), w(0), w(2)];
  const c = countByMastery(arr);
  assert.deepEqual(c, { 1: 1, 2: 2, 3: 1, 4: 1, 5: 2 });
  // 未评级（mastery 0）两个不计入
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), 7);
});

test("countByMastery: 空数组全 0", () => {
  assert.deepEqual(countByMastery([]), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
});

test("countByMastery: 非法 mastery 兜底为未评级（不计入）", () => {
  const arr = [w(NaN), w(undefined), w(5), { word: "no-mastery" }];
  assert.deepEqual(countByMastery(arr), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 });
});
