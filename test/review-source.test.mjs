/**
 * review-source.ts 单元测试（2026-09-11 · 复习面板重构 P4）
 * 覆盖 ReviewSourceStore 增删改查去重 / resolveSourceWords / computeRelease 配额节奏。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ReviewSourceStore,
  resolveSourceWords,
  summarizeSource,
  computeRelease,
  localDateKey,
  DAILY_NEW_LIMIT_DEFAULT,
} from "../src/review/review-source.ts";

// —— fixture ——————————————————————————————
// 本地时间构造，规避时区：now = 本地 2026-09-11 15:00
const NOW = new Date(2026, 8, 11, 15, 0, 0).getTime();
const DAY = 86_400_000;

const word = (wordStr, extra = {}) => ({
  id: `id-${wordStr}`,
  word: wordStr,
  status: "active",
  reps: 0,
  mastery: 0,
  created: "2026-09-01T00:00:00.000Z",
  ...extra,
});

const themeA = { id: "th-a", name: "主题A", order: 0, words: [word("apple"), word("bee"), word("cat")] };
const themeB = { id: "th-b", name: "主题B", order: 1, words: [word("dog")] };
const BOOKS = [
  { id: "bk-1", name: "四六级核心", order: 0, status: "verified", themes: [themeA, themeB] },
  { id: "bk-2", name: "草稿书", order: 1, status: "draft", themes: [{ id: "th-c", name: "C", order: 0, words: [word("egg")] }] },
];

const srcBook = (patch = {}) => ({
  id: "s1", kind: "book", targetId: "bk-1", targetLabel: "四六级核心",
  dailyNewLimit: 10, trustSource: false,
  createdAt: new Date(2026, 8, 11, 9, 0, 0).toISOString(), // 绑定当天 = 第 1 天
  releasedWords: [], ...patch,
});

// —— Store ——————————————————————————————
test("store: add 去重（同 kind+targetId 返回已有条目并合并字段）", async () => {
  const s = new ReviewSourceStore();
  s.__resetForTest();
  const a = await s.add({ kind: "book", targetId: "bk-1", targetLabel: "四六级核心" });
  const b = await s.add({ kind: "book", targetId: "bk-1", targetLabel: "四六级核心·改名", dailyNewLimit: 20 });
  assert.equal(a.id, b.id);
  assert.equal(s.list().length, 1);
  assert.equal(b.targetLabel, "四六级核心·改名");
  assert.equal(b.dailyNewLimit, 20);
});

test("store: remove / update / load 非法条目丢弃", async () => {
  const s = new ReviewSourceStore();
  s.__resetForTest();
  const a = await s.add({ kind: "theme", targetId: "th-a", targetLabel: "主题A" });
  await s.update(a.id, { dailyNewLimit: 999, trustSource: true });
  assert.equal(s.get(a.id).dailyNewLimit, 50); // clamp 上限
  assert.equal(s.get(a.id).trustSource, true);
  assert.equal(await s.remove("nope"), false);
  assert.equal(await s.remove(a.id), true);
  assert.equal(s.list().length, 0);

  const s2 = new ReviewSourceStore();
  s2.load([{ id: "ok", kind: "book", targetId: "x" }, null, { id: "bad", kind: "weird", targetId: "y" }, "str"]);
  assert.equal(s2.toJSON().length, 1);
});

test("store: persist 回调在变更时触发、load 前不触发", async () => {
  let calls = 0;
  const s = new ReviewSourceStore(() => { calls++; });
  const a = await s.add({ kind: "book", targetId: "bk-1", targetLabel: "x" }); // 未 load → noop
  assert.equal(calls, 0);
  s.load(s.toJSON());
  await s.update(a.id, { trustSource: true });
  assert.equal(calls, 1);
});

// —— resolveSourceWords / summarize ———————————————————
test("resolveSourceWords: book 解析整本（跨主题）；theme 精确到主题；missing 为空", () => {
  assert.equal(resolveSourceWords({ kind: "book", targetId: "bk-1" }, BOOKS).length, 4);
  assert.equal(resolveSourceWords({ kind: "theme", targetId: "th-a" }, BOOKS).length, 3);
  assert.equal(resolveSourceWords({ kind: "theme", targetId: "th-b" }, BOOKS).length, 1);
  assert.equal(resolveSourceWords({ kind: "book", targetId: "nope" }, BOOKS).length, 0);
});

test("summarizeSource: 词数 / 队列数 / 草稿标记", () => {
  const p1 = summarizeSource({ kind: "book", targetId: "bk-1" }, BOOKS);
  assert.equal(p1.total, 4);
  assert.equal(p1.activeCount, 4);
  assert.equal(p1.draft, false);
  const p2 = summarizeSource({ kind: "book", targetId: "bk-2" }, BOOKS);
  assert.equal(p2.draft, true);
});

// —— computeRelease ———————————————————————
test("computeRelease: 绑定当天首日释放 limit 个，其余 defer 到后续日期", () => {
  // 6 词 / limit 5（MIN clamp）：首日放 5（序 0-4），序 5 → 明天第 2 批
  const books = [{
    id: "bk-1", name: "六词书", order: 0, status: "verified",
    themes: [{ id: "th-a", name: "A", order: 0, words: [word("w1"), word("w2"), word("w3"), word("w4"), word("w5"), word("w6")] }],
  }];
  const plan = computeRelease(srcBook({ dailyNewLimit: 5, targetId: "bk-1" }), books, NOW);
  assert.equal(plan.skippedDraft, false);
  assert.equal(plan.missing, false);
  assert.equal(plan.target, 5); // 第 1 天 × limit 5
  assert.equal(plan.release.length, 5);
  assert.deepEqual(plan.release.map((x) => x.word), ["w1", "w2", "w3", "w4", "w5"]); // created 相同 → 稳定序
  const dueByWord = Object.fromEntries(plan.defer.map((d) => [d.word, d.due]));
  const tomorrow = new Date(2026, 8, 12, 0, 0, 0).getTime();
  assert.equal(plan.defer.length, 1);
  assert.equal(Date.parse(dueByWord["w6"]), tomorrow); // 全局序 5 → 第 2 批
});

test("computeRelease: created 升序决定释放顺序（limit=5，7 词只放前 5）", () => {
  const books = [{
    id: "bk-1", name: "x", order: 0, status: "verified",
    themes: [{
      id: "th-a", name: "A", order: 0,
      words: [
        word("g3", { created: "2026-09-03T00:00:00.000Z" }),
        word("g1", { created: "2026-09-01T00:00:00.000Z" }),
        word("g5", { created: "2026-09-05T00:00:00.000Z" }),
        word("g2", { created: "2026-09-02T00:00:00.000Z" }),
        word("g7", { created: "2026-09-07T00:00:00.000Z" }),
        word("g4", { created: "2026-09-04T00:00:00.000Z" }),
        word("g6", { created: "2026-09-06T00:00:00.000Z" }),
      ],
    }],
  }];
  const plan = computeRelease(srcBook({ dailyNewLimit: 5 }), books, NOW);
  assert.equal(plan.release.length, 5); // target = min(7, 1天×5) = 5
  assert.deepEqual(plan.release.map((x) => x.word), ["g1", "g2", "g3", "g4", "g5"]);
  assert.deepEqual(plan.defer.map((x) => x.word), ["g6", "g7"]);
});

test("computeRelease: 一天一批（lastReleaseDate = 今天 → quota 0，只刷 defer）", () => {
  const src = srcBook({ dailyNewLimit: 2, lastReleaseDate: localDateKey(NOW) });
  const plan = computeRelease(src, BOOKS, NOW);
  assert.equal(plan.release.length, 0);
  assert.ok(plan.defer.length > 0); // 仍会刷新延期 due
});

test("computeRelease: 绑定次日 target 按天推算（min(词数, 天数×limit)）", () => {
  const src = srcBook({ dailyNewLimit: 3, createdAt: new Date(2026, 8, 10, 9, 0, 0).toISOString() });
  const plan = computeRelease(src, BOOKS, NOW); // 第 2 天
  assert.equal(plan.target, 4); // min(4 词, 2天×3) = 4
  assert.equal(plan.release.length, 4); // 词只有 4 个 → 全部放出
});

test("computeRelease: releasedWords 幂等（已释放不重复出现）", () => {
  const src = srcBook({ dailyNewLimit: 1, releasedWords: ["apple"], lastReleaseDate: "2026-09-10" });
  const plan = computeRelease(src, BOOKS, NOW);
  assert.ok(!plan.release.some((x) => x.word === "apple"));
  assert.equal(plan.release[0]?.word, "bee");
});

test("computeRelease: 非新词不算配额（reps>0 已复习 / archived / ignored）", () => {
  const books = [{
    id: "bk-1", name: "x", order: 0, status: "verified",
    themes: [{
      id: "th-a", name: "A", order: 0,
      words: [
        word("old", { reps: 3 }),                 // 复习过 → 非新词
        word("gone", { status: "archived" }),     // 归档 → 非新词
        word("mute", { status: "ignored" }),      // 忽略 → 非新词
        word("fresh"),
      ],
    }],
  }];
  const plan = computeRelease(srcBook({ dailyNewLimit: 10 }), books, NOW);
  assert.deepEqual(plan.release.map((x) => x.word), ["fresh"]);
  assert.equal(plan.defer.length, 0);
});

test("computeRelease: draft 书默认跳过；trustSource 放行", () => {
  const draftSrc = { ...srcBook(), kind: "book", targetId: "bk-2", targetLabel: "草稿书" };
  const skipped = computeRelease(draftSrc, BOOKS, NOW);
  assert.equal(skipped.skippedDraft, true);
  assert.equal(skipped.release.length, 0);

  const trusted = computeRelease({ ...draftSrc, trustSource: true }, BOOKS, NOW);
  assert.equal(trusted.skippedDraft, false);
  assert.equal(trusted.release.length, 1);
  assert.equal(trusted.release[0].word, "egg");
});

test("computeRelease: 书已删除 → missing，不抛错", () => {
  const plan = computeRelease(srcBook({ targetId: "gone" }), BOOKS, NOW);
  assert.equal(plan.missing, true);
  assert.equal(plan.release.length, 0);
});

test("computeRelease: limit clamp 与默认值", () => {
  const plan = computeRelease(srcBook({ dailyNewLimit: 999 }), BOOKS, NOW);
  assert.ok(plan.release.length <= 4); // 词总数兜底
  assert.equal(DAILY_NEW_LIMIT_DEFAULT, 10);
});
