/**
 * 每日计划 + 造句引擎单元测试（2026-09-12）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTodayPlan,
  planProgress,
  DailyPlanStore,
  DEFAULT_DAILY_PLAN_CONFIG,
} from "../src/review/daily-plan.ts";
import { SentenceEngine, DAILY_GEN_LIMIT, WORD_COOLDOWN_MS } from "../src/sentence/sentence-engine.ts";
import { SentenceStore } from "../src/sentence/sentence-store.ts";
import { localDateKey } from "../src/review/review-source.ts";

// ======== daily-plan ========
const cfg = { ...DEFAULT_DAILY_PLAN_CONFIG };
const Y = 24 * 3600_000;

test("computeTodayPlan: 软目标 = min(到期, 目标) + 结转", () => {
  const now = Date.parse("2026-09-12T10:00:00");
  // 到期 50 > 目标 20 → 今日复习 20；无昨日
  let p = computeTodayPlan(cfg, 50, null, now);
  assert.equal(p.reviewTarget, 20);
  assert.equal(p.carriedOver, 0);
  assert.equal(p.newTarget, 5);
  // 到期 8 < 目标 → 8
  p = computeTodayPlan(cfg, 8, null, now);
  assert.equal(p.reviewTarget, 8);
});

test("computeTodayPlan: 昨日未完成结转，封顶 50% 且仅隔一天生效", () => {
  const today = Date.parse("2026-09-12T10:00:00");
  const yFull = { date: localDateKey(today - Y), reviewTarget: 20, newTarget: 5, reviewDone: 5, newDone: 0, carriedOver: 0, dueTotal: 20 };
  // 昨日完成 5/20 → 未完成 15，封顶 20×0.5=10
  let p = computeTodayPlan(cfg, 50, yFull, today);
  assert.equal(p.carriedOver, 10);
  assert.equal(p.reviewTarget, 30);
  // 前天以前不结转
  const yOld = { ...yFull, date: localDateKey(today - 3 * Y) };
  p = computeTodayPlan(cfg, 50, yOld, today);
  assert.equal(p.carriedOver, 0);
});

test("planProgress: 完成度与全完成判定", () => {
  const p = { date: "x", reviewTarget: 10, newTarget: 5, reviewDone: 10, newDone: 5, carriedOver: 0, dueTotal: 10 };
  assert.deepEqual(planProgress(p), { done: 15, total: 15, pct: 100, allDone: true });
  const p2 = { ...p, newDone: 0 };
  assert.equal(planProgress(p2).pct, 67);
});

test("store: ensureToday 跨天归档昨日并重算", async () => {
  const s = new DailyPlanStore();
  s.__resetForTest();
  const d1 = Date.parse("2026-09-12T10:00:00");
  await s.ensureToday(30, d1);
  await s.markReviewDone(3);
  assert.equal(s.today().reviewDone, 3);
  // 次日：昨日归档，今日重算（昨日完成 3/20 → 结转 min(17, 10)=10）
  const d2 = d1 + 24 * 3600_000;
  const t2 = await s.ensureToday(50, d2);
  assert.equal(s.history().length, 1);
  assert.equal(t2.carriedOver, 10);
  assert.equal(t2.reviewTarget, 30);
});

test("store: streak 连续达标（今天未完成不打断昨天）", async () => {
  const s = new DailyPlanStore();
  s.__resetForTest({ reviewTarget: 2, newTarget: 1 });
  const base = Date.parse("2026-09-10T10:00:00");
  for (let i = 0; i < 3; i++) {
    await s.ensureToday(3, base + i * 24 * 3600_000);
    await s.markReviewDone(2);
    await s.markNewDone(1);
  }
  // 第 4 天：计划生成但未完成 → streak 仍 3（从昨天回数）
  const d4 = base + 3 * 24 * 3600_000;
  await s.ensureToday(3, d4);
  assert.equal(s.streak(d4), 3);
});

// ======== sentence-engine ========
const mockSettings = { apiKey: "k", baseUrl: "https://x/v1" };

function mkEngine({ onlineExamples = null, aiContent = null, genCount = 0 } = {}) {
  const store = new SentenceStore();
  store.__resetForTest();
  let count = genCount;
  let aiCalls = 0;
  const engine = new SentenceEngine({
    getSettings: () => mockSettings,
    store,
    fetchOnline: async () => (onlineExamples ? { examples: onlineExamples } : null),
    requestAi: async () => { aiCalls++; return { content: aiContent, raw: "", model: "test-model" }; },
    getGenCountToday: () => count,
    incrGenCount: () => { count++; },
  });
  return { engine, store, aiCalls: () => aiCalls, count: () => count };
}

const aiJson = (ens) => JSON.stringify({
  sentences: ens.map((en) => ({ en, zh: "中", sentenceType: "SVC", tense: "一般现在时", scenario: "日常", cefr: "B1" })),
});

test("engine: 海词例句优先，够数则不调 AI", async () => {
  const { engine, store, aiCalls } = mkEngine({
    onlineExamples: [{ pos: "adj.", items: [
      { en: "The plain truth is hard to accept here.", zh: "朴素的真相难接受。" },
      { en: "It was plain to everyone in the room that day.", zh: "大家都明白。" },
      { en: "a third dict example sentence about plain things.", zh: "第三例。" },
    ] }],
  });
  const r = await engine.generateForWord("plain", "adj.", "明显的", { n: 3 });
  assert.equal(r.dictAdded, 3);
  assert.equal(r.aiAdded, 0);
  assert.equal(aiCalls(), 0);
  assert.equal(store.listFor("plain").length, 3);
});

test("engine: 词典不足 → AI 补缺；校验过滤不合格句", async () => {
  const { engine, store, aiCalls } = mkEngine({
    onlineExamples: [{ pos: "adj.", items: [{ en: "The plain truth is hard to accept here.", zh: "有。" }] }],
    aiContent: aiJson([
      "It was plain to everyone in the room.",   // 合格
      "too short",                                // 长度不合规 → 剔除
      "The unrelated concept appeared later today.", // 不含词 → 剔除
      "She gave a plain answer to the hard question.", // 合格
    ]),
  });
  const r = await engine.generateForWord("plain", "adj.", "明显的", { n: 3 });
  assert.equal(r.dictAdded, 1);
  assert.equal(r.aiAdded, 2);
  assert.ok(aiCalls() >= 1);
  assert.equal(store.keptFor("plain").length, 0); // 全是 draft（采纳由 UI 决定）
});

test("engine: 单词 24h 冷却拒绝重复生成；force 可跳过", async () => {
  const { engine } = mkEngine({ aiContent: aiJson(["It was plain to everyone in the room that day."]) });
  const r1 = await engine.generateForWord("plain", "adj.", "明显的", { n: 1 });
  assert.equal(r1.ok, true);
  const r2 = await engine.generateForWord("plain", "adj.", "明显的", { n: 1 });
  assert.equal(r2.skipped, "cooldown");
  const r3 = await engine.generateForWord("plain", "adj.", "明显的", { n: 1, force: true });
  assert.equal(r3.ok, true);
});

test("engine: 每日上限拒绝；AI 未配置无词典时报错", async () => {
  const full = mkEngine({ genCount: DAILY_GEN_LIMIT, aiContent: aiJson(["x"]) });
  const r = await full.engine.generateForWord("plain", "adj.", "明显的");
  assert.equal(r.skipped, "daily-limit");

  const s = new SentenceStore(); s.__resetForTest();
  const engine2 = new SentenceEngine({
    getSettings: () => ({ apiKey: "", baseUrl: "" }),
    store: s,
    fetchOnline: async () => null,
    requestAi: async () => ({ content: "", raw: "", model: "" }),
    getGenCountToday: () => 0,
    incrGenCount: () => {},
  });
  const r2 = await engine2.generateForWord("plain", "adj.", "明显的");
  assert.equal(r2.skipped, "ai-not-configured");
});

test("engine: aiOnly 切换 AI 队列（跳过词典、不受 aiFillEnabled 限制、受总开关约束）", async () => {
  // 1) aiOnly：有词典例句也不走词典，直接 AI 生成
  const s1 = new SentenceStore(); s1.__resetForTest();
  let aiCalls1 = 0;
  const e1 = new SentenceEngine({
    getSettings: () => mockSettings,
    store: s1,
    fetchOnline: async () => ({ examples: [{ pos: "adj.", items: [{ en: "A dict example sentence that is long enough.", zh: "有。" }] }] }),
    requestAi: async () => { aiCalls1++; return { content: aiJson(["It was plain to everyone in the room that day."]), raw: "", model: "m" }; },
    getGenCountToday: () => 0, incrGenCount: () => {},
    getSentenceSettings: () => ({ aiGenEnabled: true, aiFillEnabled: false, useOnlineExamples: true }),
  });
  const r1 = await e1.generateForWord("plain", "adj.", "明显的", { n: 1, aiOnly: true });
  assert.equal(r1.dictAdded, 0, "aiOnly 不应入库词典句");
  assert.equal(r1.aiAdded, 1, "aiOnly 应走 AI");
  assert.equal(aiCalls1, 1);
  assert.equal(s1.listFor("plain").length, 1);

  // 2) 总开关关闭：aiOnly 也返回 ai-disabled
  const e2 = new SentenceEngine({
    getSettings: () => mockSettings,
    store: s1,
    fetchOnline: async () => null,
    requestAi: async () => ({ content: aiJson(["It was plain to everyone in the room that day."]), raw: "", model: "m" }),
    getGenCountToday: () => 0, incrGenCount: () => {},
    getSentenceSettings: () => ({ aiGenEnabled: false, aiFillEnabled: true, useOnlineExamples: true }),
  });
  const r2 = await e2.generateForWord("plain", "adj.", "明显的", { n: 1, aiOnly: true });
  assert.equal(r2.skipped, "ai-disabled");
});
