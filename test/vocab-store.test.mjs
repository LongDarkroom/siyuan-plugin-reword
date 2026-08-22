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
