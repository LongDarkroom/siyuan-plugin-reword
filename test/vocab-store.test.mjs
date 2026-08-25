// 1.1 byWord 索引专项测试
// 覆盖：
//   - 写路径(addWord/removeWord/moveWord/removeTheme/removeBook)同步索引
//   - 读路径(hasWord/findRecord/getQueryCount/locate)走索引 O(1)
//   - load() 入口重建索引
//   - 索引与 data.books 数量一致性(防止漂移)
//   - 1000 词规模性能冒烟(> 1000 hasWord < 10ms)

import { test } from "node:test";
import assert from "node:assert/strict";
import { VocabStore, ALL_BOOK_ID } from "../src/vocab/vocab-store.ts";
import { WordStatus } from "../src/types.ts";
import { __resetInjectedDataForTest } from "../src/review/difficulty.ts";

/** 构造一个测试用 VocabStore（不接 onChange,避免测试跑 saveData）
 *  注：load 时若 books.length===0 会触发旧版迁移,调 sqlQuery → 桩里 fetchSyncPost 报错。
 *      直接传一个含 1 本的空 book,走 valid 分支跳过迁移。
 */
function makeStore() {
  const s = new VocabStore();
  s.load({
    books: [{ id: "b1", name: "B1", order: 0, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] }],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  return s;
}

test("1.1 byWord 索引:addWord 后索引同步,byWord.size 与总词数一致", async () => {
  __resetInjectedDataForTest();
  const s = makeStore();
  assert.equal(s.__byWordIndexSizeForTest(), 0);
  await s.addWord("apple");
  await s.addWord("banana");
  await s.addWord("cherry");
  assert.equal(s.__byWordIndexSizeForTest(), 3);
  assert.equal(s.hasWord("apple"), true);
  assert.equal(s.hasWord("APPLE"), true, "should be case-insensitive");
  assert.equal(s.hasWord("durian"), false);
});

test("1.1 byWord 索引:removeWord 后索引同步", async () => {
  const s = makeStore();
  await s.addWord("apple");
  await s.addWord("banana");
  assert.equal(s.__byWordIndexSizeForTest(), 2);
  assert.equal(await s.removeWord("apple"), true);
  assert.equal(s.__byWordIndexSizeForTest(), 1);
  assert.equal(s.hasWord("apple"), false);
  assert.equal(s.hasWord("banana"), true);
  // 二次 remove 返回 false
  assert.equal(await s.removeWord("apple"), false);
});

test("1.1 byWord 索引:findRecord/getQueryCount 走索引", async () => {
  const s = makeStore();
  await s.addWord("hello");
  await s.addWord("hello", { phonetic: "/həˈloʊ/" });
  // addWord 不会让已存在词覆盖,findRecord 应返回原词
  const r = s.findRecord("HELLO");
  assert.ok(r);
  assert.equal(r.word, "hello");
  assert.equal(s.getQueryCount("hello"), 0);
  // 不存在
  assert.equal(s.findRecord("world"), undefined);
  assert.equal(s.getQueryCount("world"), 0);
});

test("1.1 byWord 索引:recordQuery 自增 queryCount 走索引", async () => {
  const s = makeStore();
  await s.addWord("hi");
  await s.recordQuery("hi");
  await s.recordQuery("hi");
  await s.recordQuery("hi");
  assert.equal(s.getQueryCount("hi"), 3);
  await s.recordQuery("nonexistent"); // 不在词库,静默忽略
  assert.equal(s.getQueryCount("hi"), 3);
});

test("1.1 byWord 索引:moveWord 后索引更新到新定位", async () => {
  const s = makeStore();
  await s.addWord("foo");
  // 建另一个 book + theme
  const b2 = await s.addBook("Book 2");
  const t2 = b2.themes[0];
  const ok = await s.moveWord("foo", b2.id, t2.id);
  assert.equal(ok, true);
  // 索引仍能找到
  assert.equal(s.hasWord("foo"), true);
  const r = s.findRecord("foo");
  assert.ok(r);
  // 旧 theme 不再含 foo
  const b1 = s.getBooks().find((b) => b.id !== ALL_BOOK_ID && b.id !== b2.id);
  assert.ok(b1, "旧 book 应存在");
  const inOld = b1.themes.some((t) => t.words.some((w) => w.word === "foo"));
  assert.equal(inOld, false, "应已离开旧 book");
});

test("1.1 byWord 索引:removeTheme 把词移到 uncat,索引同步", async () => {
  const s = makeStore();
  await s.addWord("alpha");
  const b = s.getActiveBook();
  // 建一个普通 theme
  const t = await s.addTheme(b.id, "高频");
  await s.moveWord("alpha", b.id, t.id);
  assert.equal(s.hasWord("alpha"), true);
  // 删 theme,词应回到「未分类」
  await s.removeTheme(b.id, t.id);
  assert.equal(s.hasWord("alpha"), true, "词不应丢失");
  // 找到它,应在「未分类」里
  const r = s.findRecord("alpha");
  assert.ok(r);
  const newTheme = b.themes.find((tt) => tt.words.some((w) => w.word === "alpha"));
  assert.ok(newTheme, "词应被移到一个 theme");
  assert.equal(newTheme.name, "未分类", "应回退到未分类");
});

test("1.1 byWord 索引:removeBook 后索引重建,无 dangling", async () => {
  const s = makeStore();
  const b1 = s.getActiveBook();
  const b2 = await s.addBook("Book 2");
  await s.setActiveBook(b2.id);
  await s.addWord("aaa");
  await s.setActiveBook(b1.id);
  await s.addWord("bbb");
  assert.equal(s.__byWordIndexSizeForTest(), 2);
  // 删 b2 → aaa 没了,bbb 还在
  await s.removeBook(b2.id);
  assert.equal(s.hasWord("aaa"), false);
  assert.equal(s.hasWord("bbb"), true);
  assert.equal(s.__byWordIndexSizeForTest(), 1);
});

test("1.1 byWord 索引:load() 重建索引", () => {
  const s = makeStore();
  s.load({
    books: [
      {
        id: "b1",
        name: "B1",
        order: 0,
        themes: [
          {
            id: "t1",
            name: "未分类",
            order: 0,
            words: [
              { id: "w1", word: "x", phonetic: "", pos: "", meaning: "", mastery: 0, status: WordStatus.Active, created: "2026-01-01", updated: "2026-01-01", order: 0 },
              { id: "w2", word: "y", phonetic: "", pos: "", meaning: "", mastery: 0, status: WordStatus.Active, created: "2026-01-01", updated: "2026-01-01", order: 1 },
            ],
          },
        ],
      },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  assert.equal(s.__byWordIndexSizeForTest(), 2);
  assert.equal(s.hasWord("x"), true);
  assert.equal(s.hasWord("y"), true);
});

test("1.1 byWord 索引:updateMastery/updateWordMeta 不破坏索引(词还在)", async () => {
  const s = makeStore();
  await s.addWord("alpha");
  await s.updateMastery("alpha", 3);
  await s.updateWordMeta("alpha", { pos: "n.", meaning: "阿尔法" });
  const r = s.findRecord("alpha");
  assert.ok(r);
  assert.equal(r.mastery, 3);
  assert.equal(r.pos, "n.");
  assert.equal(r.meaning, "阿尔法");
  assert.equal(s.__byWordIndexSizeForTest(), 1);
});

test("1.1 byWord 索引:updateReviewStats 不破坏索引(词还在)", async () => {
  const s = makeStore();
  await s.addWord("beta");
  await s.updateReviewStats("beta", { ease: 2.2, lastGrade: "good" });
  const r = s.findRecord("beta");
  assert.ok(r);
  assert.equal(r.ease, 2.2);
  assert.equal(r.lastGrade, "good");
  assert.equal(s.__byWordIndexSizeForTest(), 1);
});

test("1.1 byWord 索引:状态切换(archive/ignore/reactivate)不破坏索引", async () => {
  const s = makeStore();
  await s.addWord("gamma");
  await s.archiveWord("gamma");
  const r1 = s.findRecord("gamma");
  assert.equal(r1.status, WordStatus.Archived);
  assert.equal(s.__byWordIndexSizeForTest(), 1);
  await s.reactivateWord("gamma");
  assert.equal(s.findRecord("gamma").status, WordStatus.Active);
  await s.ignoreWord("gamma");
  assert.equal(s.findRecord("gamma").status, WordStatus.Ignored);
  assert.equal(s.__byWordIndexSizeForTest(), 1);
});

test("1.1 byWord 索引:1000 词规模下 hasWord 性能冒烟(< 20ms)", async () => {
  const s = makeStore();
  // 一次性塞 1000 词
  for (let i = 0; i < 1000; i++) await s.addWord(`w${i}`);
  assert.equal(s.__byWordIndexSizeForTest(), 1000);
  // 测 1000 次 hasWord 总耗时（命中/未命中混合）
  const words = [];
  for (let i = 0; i < 1000; i++) words.push(i % 2 === 0 ? `w${i}` : `missing${i}`);
  const t0 = Date.now();
  for (const w of words) s.hasWord(w);
  const cost = Date.now() - t0;
  // 1000 次查索引（哈希）应 < 20ms；旧实现走 getAllWords().some 在 1k 时也是毫秒级，
  // 但 5k+ 时会开始线性退化，本冒烟守住基线
  assert.ok(cost < 20, `1000 次 hasWord 耗时 ${cost}ms 应 < 20ms`);
});

test("1.1 byWord 索引:与 data.books 数量一致性(防漂移)", async () => {
  const s = makeStore();
  await s.addWord("a");
  await s.addWord("b");
  await s.addWord("c");
  const all = s.getAllWords();
  assert.equal(all.length, 3);
  assert.equal(s.__byWordIndexSizeForTest(), all.length);
  await s.removeWord("b");
  const all2 = s.getAllWords();
  assert.equal(all2.length, 2);
  assert.equal(s.__byWordIndexSizeForTest(), all2.length);
});

// ============================================================
// 2026-08-22 新增:LearningStatus 字段 + setLearningStatus + onLearningStatusChange
// ============================================================
import { LearningStatus } from "../src/types.ts";

test("learningStatus:新建单词默认 learningStatus='learning'", async () => {
  const s = makeStore();
  await s.addWord("hello", { meaning: "你好" });
  const r = s.findRecord("hello");
  assert.ok(r);
  assert.equal(r.learningStatus, LearningStatus.Learning);
});

test("learningStatus:setLearningStatus 修改后 record 字段同步 + byWord 引用一致", async () => {
  const s = makeStore();
  await s.addWord("apple");
  const before = s.findRecord("apple");
  const ok = await s.setLearningStatus("apple", LearningStatus.Mastered);
  assert.equal(ok, true);
  const after = s.findRecord("apple");
  assert.equal(after.learningStatus, LearningStatus.Mastered);
  // byWord 是强引用,record 应当是同一对象(更新 in-place)
  assert.strictEqual(before, after);
});

test("learningStatus:setLearningStatus 不存在的单词返回 false(静默忽略)", async () => {
  const s = makeStore();
  const ok = await s.setLearningStatus("nonexistent", LearningStatus.Mastered);
  assert.equal(ok, false);
  // 不应 throw
});

test("learningStatus:setLearningStatus 触发 onLearningStatusChange 监听者", async () => {
  const s = makeStore();
  await s.addWord("test");
  const events = [];
  const unsub = s.onLearningStatusChange((w, st) => events.push({ word: w, status: st }));
  await s.setLearningStatus("test", LearningStatus.Review);
  assert.equal(events.length, 1);
  assert.equal(events[0].word, "test");
  assert.equal(events[0].status, "review");
  unsub();
  // 取消订阅后再触发,不应再收到
  await s.setLearningStatus("test", LearningStatus.Mastered);
  assert.equal(events.length, 1, "取消订阅后不再接收");
});

test("learningStatus:setLearningStatus 状态相同时不 emit(避免无谓刷新)", async () => {
  const s = makeStore();
  await s.addWord("foo");
  const events = [];
  s.onLearningStatusChange((w, st) => events.push({ w, st }));
  await s.setLearningStatus("foo", LearningStatus.Learning); // 已经是 learning
  assert.equal(events.length, 0, "同状态不触发 emit");
});

test("learningStatus:addWord 新增单词后 emit('learning')", async () => {
  const s = makeStore();
  const events = [];
  s.onLearningStatusChange((w, st) => events.push({ w, st }));
  await s.addWord("fresh");
  assert.ok(events.length >= 1);
  assert.equal(events[events.length - 1].w, "fresh");
  assert.equal(events[events.length - 1].st, LearningStatus.Learning);
});

test("learningStatus:旧数据(无 learningStatus 字段)load 时补为 'learning'", () => {
  const s = new VocabStore();
  // 模拟旧 JSON 数据,record 没有 learningStatus 字段
  s.load({
    books: [{
      id: "b1", name: "B1", order: 0,
      themes: [{ id: "t1", name: "未分类", order: 0, words: [
        { id: "w1", word: "legacy", phonetic: "", pos: "", meaning: "", mastery: 0, status: "active", labels: [], example: "", created: "2025-01-01", updated: "2025-01-01", order: 0 }
        // 注意:无 learningStatus 字段
      ]}]
    }],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  const r = s.findRecord("legacy");
  assert.ok(r);
  assert.equal(r.learningStatus, LearningStatus.Learning);
});

// ============================================================
// 2026-08-23 新增:清除样式(✕)+ 收起态相关测试
// ============================================================

test("learningStatus:setLearningStatus(word, null) = 清除样式(字段被 delete)", async () => {
  const s = makeStore();
  await s.addWord("apple");
  await s.setLearningStatus("apple", LearningStatus.Mastered);
  const cleared = await s.setLearningStatus("apple", null);
  assert.equal(cleared, true);
  const r = s.findRecord("apple");
  assert.ok(r);
  assert.equal(r.learningStatus, undefined, "字段被 delete,不应残留值");
});

test("learningStatus:setLearningStatus(word, undefined) 也走清除路径", async () => {
  const s = makeStore();
  await s.addWord("banana");
  await s.setLearningStatus("banana", LearningStatus.Review);
  const cleared = await s.setLearningStatus("banana", undefined);
  assert.equal(cleared, true);
  assert.equal(s.findRecord("banana").learningStatus, undefined);
});

test("learningStatus:清除样式时 emit 一个 'cleared' 哨兵状态(让 highlighter 移除高亮)", async () => {
  const s = makeStore();
  await s.addWord("x");
  await s.setLearningStatus("x", LearningStatus.Mastered);
  const events = [];
  s.onLearningStatusChange((w, st) => events.push({ w, st }));
  await s.setLearningStatus("x", null);
  assert.ok(events.length >= 1);
  const last = events[events.length - 1];
  assert.equal(last.w, "x");
  // 哨兵字符串 'cleared' (高亮模块据此从索引移除)
  assert.equal(last.st, "cleared");
});

test("learningStatus:对已清除的词再次清除,emit 不触发(无变化短路)", async () => {
  const s = makeStore();
  await s.addWord("y");
  await s.setLearningStatus("y", null); // 第一次清除
  const events = [];
  s.onLearningStatusChange(() => events.push(1));
  await s.setLearningStatus("y", null); // 再次清除(无变化)
  assert.equal(events.length, 0, "已清除的词再清除不应 emit");
});
