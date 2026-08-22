/**
 * calibrate.ts 单元测试（自研 SRS 的「真校准」）
 * 用合成数据验证：
 *   1) 无历史时安全返回默认（零样本不崩）；
 *   2) 样本不足时沿用默认并提示；
 *   3) c 固定为研究值（与半衰期不可辨识，不拟合）；
 *   4) 倍率由各档位实测留存率推导：recall 高 → m>1（拉长），recall 低 → m 更小；
 *      easy > good > hard 单调；倍率落在夹紧区间内。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrateFromHistory } from "../src/review/calibrate.ts";

// 复现指数遗忘公式，用于「种数据」：P(recall)=0.5^(effInterval/H), eff=interval*(1-c*difficulty)
function prob(interval, difficulty, H, c) {
  const eff = Math.max(0.1, interval * (1 - c * difficulty));
  return Math.pow(0.5, eff / Math.max(0.5, H));
}
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 种一批事件：给定真实半衰期 H、区间范围、难度区间，按模型决定 recalled
function plant(grade, H, intervalRange, n, c, rand) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    const interval = intervalRange[0] + rand() * (intervalRange[1] - intervalRange[0]);
    const difficulty = rand();
    const p = prob(interval, difficulty, H, c);
    ev.push({ grade, scheduledIntervalDays: Math.round(interval * 100) / 100, prevIntervalDays: interval, difficulty, recalled: rand() < p });
  }
  return ev;
}

test("空历史：安全返回默认倍率，不崩溃", () => {
  const res = calibrateFromHistory([]);
  assert.equal(res.eventsUsed, 0);
  assert.equal(res.gradeMultiplier.again, 1.0);
  assert.ok(res.gradeMultiplier.good > 1.0);
});

test("样本不足（每档位<3）：沿用默认并提示", () => {
  const res = calibrateFromHistory([
    { grade: "good", scheduledIntervalDays: 5, prevIntervalDays: 2, difficulty: 0.3, recalled: true },
  ]);
  assert.ok(res.notes.some((n) => n.includes("样本不足")));
});

test("c 固定为研究值（不拟合，与半衰期不可辨识）", () => {
  const rand = rng(7);
  const events = [
    ...plant("hard", 3, [2, 6], 80, 0.3, rand),
    ...plant("good", 10, [0.5, 2], 80, 0.3, rand),
    ...plant("easy", 40, [1, 4], 80, 0.3, rand),
  ];
  const res = calibrateFromHistory(events, { targetRetention: 0.9, initCorrection: 0.3 });
  assert.equal(res.difficultyCorrection, 0.3);
});

test("倍率由实测留存率推导：高留存→拉长，低留存→更短，且随留存单调", () => {
  const c = 0.3;
  const rand = rng(20260818);
  // good/easy 用「短区间」→ 实测留存高 → 倍率应 >1（拉长）；hard 用「长区间」→ 留存低
  const events = [
    ...plant("hard", 3, [2, 6], 120, c, rand),
    ...plant("good", 10, [0.5, 2], 120, c, rand),
    ...plant("easy", 40, [1, 4], 120, c, rand),
  ];
  const res = calibrateFromHistory(events, { targetRetention: 0.9 });

  // good 实测留存应较高（短区间），倍率 > 1（增长）
  assert.ok(res.detail.good.recallRate > 0.75, `good recallRate=${res.detail.good.recallRate}`);
  assert.ok(res.gradeMultiplier.good > 1.0, `good m=${res.gradeMultiplier.good}`);
  // hard 实测留存应低于 good（长区间更易忘）
  assert.ok(res.detail.hard.recallRate < res.detail.good.recallRate, `hard ${res.detail.hard.recallRate} < good ${res.detail.good.recallRate}`);
  // 结构性质：倍率随「实测留存率」单调（m = log(target)/log(rate)，rate 越高 m 越大）
  const byRate = ["hard", "good", "easy"].sort((a, b) => res.detail[b].recallRate - res.detail[a].recallRate);
  const byMult = ["hard", "good", "easy"].sort((a, b) => res.detail[b].multiplier - res.detail[a].multiplier);
  assert.deepEqual(byRate, byMult);
  // 倍率夹紧在合理区间
  assert.ok(res.gradeMultiplier.hard >= 0.9 && res.gradeMultiplier.hard <= 1.6);
  assert.ok(res.gradeMultiplier.good >= 1.0 && res.gradeMultiplier.good <= 3.5);
  assert.ok(res.gradeMultiplier.easy >= 1.2 && res.gradeMultiplier.easy <= 6.0);
  // 所有档位样本量达标
  for (const g of ["hard", "good", "easy"]) assert.ok(res.detail[g].samples >= 3);
});
