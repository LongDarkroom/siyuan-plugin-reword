/**
 * scheduler.ts 单元测试（自研 SRS 调度引擎）
 * 覆盖 priorityOf / isDue / getDueQueue / pickNext / nextReviewState。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priorityOf,
  isDue,
  getDueQueue,
  pickNext,
  nextReviewState,
} from "../src/review/scheduler.ts";

const NOW = Date.parse("2026-08-18T00:00:00Z");
const DAY = 86_400_000;

function close(a, b, eps = 1e-9) {
  assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);
}

// —— priorityOf：显式难度、无时间信息，便于手算验证 ——
test("priorityOf: 基准（ease 2.5, 难度 0.5, 全 0）= 0.35", () => {
  const rec = { ease: 2.5, difficulty: 0.5, queryCount: 0, mastery: 0, recall: 0, lapse: 0 };
  // easeFactor(2.5)=0.25 -> 0.8*0.25=0.2; difficulty 0.3*0.5=0.15; 合计 0.35
  close(priorityOf(rec, NOW), 0.35);
});

test("priorityOf: recall 满 5 把优先级压到 0", () => {
  const rec = { ease: 2.5, difficulty: 0.5, queryCount: 0, mastery: 0, recall: 5, lapse: 0 };
  close(priorityOf(rec, NOW), 0);
});

test("priorityOf: queryCount 20 拉满贡献 1.0", () => {
  const rec = { ease: 2.5, difficulty: 0.5, queryCount: 20, mastery: 0, recall: 0, lapse: 0 };
  close(priorityOf(rec, NOW), 1.35); // 0.35 + 1.0
});

test("priorityOf: 距上次复习 9 天贡献 time≈0.5", () => {
  const rec = {
    ease: 2.5,
    difficulty: 0.5,
    queryCount: 0,
    mastery: 0,
    recall: 0,
    lapse: 0,
    lastReview: new Date(NOW - 9 * DAY).toISOString(),
  };
  // base 0.35 + time 0.7*0.5 = 0.7
  close(priorityOf(rec, NOW), 0.7);
});

// —— isDue ——
test("isDue: 无 due 默认立即可复习", () => {
  assert.equal(isDue({ word: "a" }, NOW), true);
});

test("isDue: 过去 due = true，未来 due = false", () => {
  assert.equal(isDue({ word: "a", due: new Date(NOW - DAY).toISOString() }, NOW), true);
  assert.equal(isDue({ word: "a", due: new Date(NOW + DAY).toISOString() }, NOW), false);
});

test("isDue: 非 active 状态永不复习", () => {
  assert.equal(isDue({ word: "a", status: "archived" }, NOW), false);
  assert.equal(isDue({ word: "a", status: "ignored", due: new Date(NOW - DAY).toISOString() }, NOW), false);
});

// —— getDueQueue / pickNext ——
test("getDueQueue: 只排到期词，且按优先级降序", () => {
  const words = [
    { word: "a", due: new Date(NOW - 2 * DAY).toISOString(), queryCount: 0, mastery: 0, difficulty: 0.5, recall: 0 },
    { word: "b", due: new Date(NOW - 2 * DAY).toISOString(), queryCount: 20, mastery: 5, difficulty: 0.5, recall: 0 },
    { word: "c", due: new Date(NOW + 5 * DAY).toISOString(), queryCount: 20, mastery: 5, difficulty: 0.5, recall: 0 },
  ];
  const q = getDueQueue(words, { now: NOW });
  assert.equal(q.length, 2);
  assert.equal(q[0].word, "b");
  assert.equal(q[1].word, "a");
});

test("getDueQueue: 无到期词时 includeNotDue 兜底全量", () => {
  const words = [
    { word: "x", due: new Date(NOW + 5 * DAY).toISOString(), queryCount: 0, mastery: 0, difficulty: 0.5, recall: 0 },
    { word: "y", due: new Date(NOW + 5 * DAY).toISOString(), queryCount: 20, mastery: 5, difficulty: 0.5, recall: 0 },
  ];
  const q = getDueQueue(words, { now: NOW, includeNotDue: true });
  assert.equal(q.length, 2);
  assert.equal(q[0].word, "y");
  assert.equal(q[1].word, "x");
});

test("getDueQueue: limit 截断", () => {
  const words = [
    { word: "a", due: new Date(NOW - 2 * DAY).toISOString(), queryCount: 0, mastery: 0, difficulty: 0.5, recall: 0 },
    { word: "b", due: new Date(NOW - 2 * DAY).toISOString(), queryCount: 20, mastery: 5, difficulty: 0.5, recall: 0 },
  ];
  const q = getDueQueue(words, { now: NOW, limit: 1 });
  assert.equal(q.length, 1);
  assert.equal(q[0].word, "b");
});

test("pickNext: 取前 n 个（内部强制 includeNotDue）", () => {
  const words = [
    { word: "x", due: new Date(NOW + 5 * DAY).toISOString(), queryCount: 0, mastery: 0, difficulty: 0.5, recall: 0 },
    { word: "y", due: new Date(NOW + 5 * DAY).toISOString(), queryCount: 20, mastery: 5, difficulty: 0.5, recall: 0 },
  ];
  const p = pickNext(words, 2, { now: NOW });
  assert.equal(p.length, 2);
  assert.equal(p[0].word, "y");
});

// —— nextReviewState（SM-2 简化）——
test("nextReviewState: again -> 间隔 0、ease-0.2、lapse+1、recall-1", () => {
  const rec = { ease: 2.5, lapse: 0, reps: 0, recall: 3, intervalDays: 5, difficulty: 0.5 };
  const p = nextReviewState(rec, "again", NOW);
  assert.equal(p.lastGrade, "again");
  assert.equal(p.ease, 2.3);
  assert.equal(p.lapse, 1);
  assert.equal(p.reps, 0);
  assert.equal(p.recall, 2);
  assert.equal(p.intervalDays, 0);
  assert.equal(p.due, new Date(NOW).toISOString());
  assert.equal(p.lastReview, new Date(NOW).toISOString());
});

test("nextReviewState: good 首次 -> 间隔 2、recall+1、reps+1", () => {
  const rec = { ease: 2.5, lapse: 0, reps: 0, recall: 0, intervalDays: 0, difficulty: 0.5 };
  const p = nextReviewState(rec, "good", NOW);
  assert.equal(p.lastGrade, "good");
  assert.equal(p.ease, 2.5); // good 不动 ease
  assert.equal(p.intervalDays, 2); // round(2 * 0.8) = 2
  assert.equal(p.recall, 1);
  assert.equal(p.reps, 1);
  assert.equal(p.lapse, 0);
  assert.equal(p.due, new Date(NOW + 2 * DAY).toISOString());
});

test("nextReviewState: easy 首次 -> 间隔 4 起、ease+0.1、recall+2", () => {
  const rec = { ease: 2.5, lapse: 0, reps: 0, recall: 0, intervalDays: 0, difficulty: 0.5 };
  const p = nextReviewState(rec, "easy", NOW);
  assert.equal(p.lastGrade, "easy");
  assert.equal(p.ease, 2.6);
  assert.equal(p.intervalDays, 3); // round(4 * 0.8) = 3
  assert.equal(p.recall, 2);
  assert.equal(p.reps, 1);
  assert.equal(p.due, new Date(NOW + 3 * DAY).toISOString());
});

test("nextReviewState: hard 首次 -> 间隔 1、ease-0.05、recall 不变", () => {
  const rec = { ease: 2.5, lapse: 0, reps: 0, recall: 5, intervalDays: 0, difficulty: 0.5 };
  const p = nextReviewState(rec, "hard", NOW);
  assert.equal(p.lastGrade, "hard");
  assert.equal(p.ease, 2.45);
  assert.equal(p.intervalDays, 1); // round(1 * 0.8) = 1
  assert.equal(p.recall, 5); // hard 不动 recall
  assert.equal(p.reps, 1);
  assert.equal(p.due, new Date(NOW + 1 * DAY).toISOString());
});

test("nextReviewState: good 重复 -> 间隔按倍率 2.5 增长（返回难度修正后的有效间隔）", () => {
  const rec = { ease: 2.5, lapse: 0, reps: 3, recall: 2, intervalDays: 5, difficulty: 0.5 };
  const p = nextReviewState(rec, "good", NOW);
  assert.equal(p.lastGrade, "good");
  // 原始间隔 = round(5 * 2.5) = 13，难度修正后有效间隔 = round(13 * (1 - 0.3*0.5)) = round(11.05) = 11
  assert.equal(p.intervalDays, 11);
  assert.equal(p.recall, 3);
  assert.equal(p.reps, 4);
  assert.equal(p.due, new Date(NOW + 11 * DAY).toISOString());
});

test("nextReviewState: 难度越高有效间隔越短（难度修正生效）", () => {
  const rec = { ease: 2.5, lapse: 0, reps: 0, recall: 0, intervalDays: 0, difficulty: 1.0 };
  const p = nextReviewState(rec, "good", NOW);
  assert.equal(p.intervalDays, 1); // round(2 * (1 - 0.4)) = round(1.2) = 1
});
