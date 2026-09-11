// 2026-09-11 新增：verifyBook + getReviewableBooks 测试
// 覆盖：
//   - getReviewableBooks() 排除 draft
//   - getReviewableBooks() 排除 ALL_BOOK_ID 虚拟
//   - verifyBook(draftId) → true，状态变 verified
//   - verifyBook(verifiedId) → false（幂等）
//   - verifyBook(ALL_BOOK_ID) → false
//   - verifyBook(missingId) → false
//   - verifyBook 写 verifiedAt + verifiedWordCount

import { test } from "node:test";
import assert from "node:assert/strict";
import { VocabStore, ALL_BOOK_ID } from "../src/vocab/vocab-store.ts";
import { BookStatus, BookSource } from "../src/types.ts";

/** 构造一个含 2 本（1 verified + 1 draft）的 store */
function makeStoreWithMixed() {
  const s = new VocabStore();
  s.load({
    books: [
      { id: "b-verified", name: "Verified Book", order: 0, status: "verified", source: "manual", themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] },
      { id: "b-draft", name: "Draft Book", order: 1, status: "draft", source: "doc-parsed", themes: [{ id: "t2", name: "未分类", order: 0, words: [
        { id: "w1", word: "draft1", phonetic: "", pos: "", meaning: "", mastery: 0, status: "active", labels: [], created: "2026-09-11T00:00:00.000Z", updated: "2026-09-11T00:00:00.000Z", order: 0 },
        { id: "w2", word: "draft2", phonetic: "", pos: "", meaning: "", mastery: 0, status: "active", labels: [], created: "2026-09-11T00:00:00.000Z", updated: "2026-09-11T00:00:00.000Z", order: 1 },
      ] }] },
    ],
    activeBookId: "b-verified",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  return s;
}

test("getReviewableBooks: 排除 draft 本", () => {
  const s = makeStoreWithMixed();
  const books = s.getReviewableBooks();
  assert.equal(books.length, 1, "草稿本不进复习");
  assert.equal(books[0].id, "b-verified");
});

test("getReviewableBooks: ALL_BOOK_ID 不会进 list（虚拟聚合）", () => {
  const s = makeStoreWithMixed();
  // getBook(ALL_BOOK_ID) 是虚拟聚合
  const v = s.getBook(ALL_BOOK_ID);
  assert.ok(v);
  // getReviewableBooks 只看 this.data.books（不含虚拟）
  const books = s.getReviewableBooks();
  assert.equal(books.find(b => b.id === ALL_BOOK_ID), undefined);
});

test("getReviewableBooks: 按 order 升序排", () => {
  const s = new VocabStore();
  s.load({
    books: [
      { id: "b1", name: "B1", order: 2, status: "verified", themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] },
      { id: "b2", name: "B2", order: 0, status: "verified", themes: [{ id: "t2", name: "未分类", order: 0, words: [] }] },
      { id: "b3", name: "B3", order: 1, status: "verified", themes: [{ id: "t3", name: "未分类", order: 0, words: [] }] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  const books = s.getReviewableBooks();
  assert.deepEqual(books.map(b => b.id), ["b2", "b3", "b1"]);
});

test("verifyBook: draft → verified 成功", async () => {
  const s = makeStoreWithMixed();
  assert.equal(s.getBook("b-draft").status, "draft");
  const ok = await s.verifyBook("b-draft");
  assert.equal(ok, true);
  const b = s.getBook("b-draft");
  assert.equal(b.status, "verified");
  assert.ok(b.verifiedAt, "verifiedAt 应被写入");
  // verifiedAt 应该是 ISO 格式（解析后是新时间）
  const parsed = Date.parse(b.verifiedAt);
  assert.ok(!isNaN(parsed), "verifiedAt 应可解析为 Date");
  assert.equal(b.verifiedWordCount, 2, "2 个 draft 词");
});

test("verifyBook: 已是 verified 返回 false（幂等）", async () => {
  const s = makeStoreWithMixed();
  const ok1 = await s.verifyBook("b-verified");
  assert.equal(ok1, false, "已是 verified，不应再次校验");
  // 状态保持 verified
  assert.equal(s.getBook("b-verified").status, "verified");
});

test("verifyBook: ALL_BOOK_ID 返回 false", async () => {
  const s = makeStoreWithMixed();
  const ok = await s.verifyBook(ALL_BOOK_ID);
  assert.equal(ok, false);
});

test("verifyBook: 不存在的 bookId 返回 false", async () => {
  const s = makeStoreWithMixed();
  const ok = await s.verifyBook("nonexistent");
  assert.equal(ok, false);
});

test("verifyBook: verified 之后 getReviewableBooks 包含该本", async () => {
  const s = makeStoreWithMixed();
  assert.equal(s.getReviewableBooks().length, 1);
  await s.verifyBook("b-draft");
  assert.equal(s.getReviewableBooks().length, 2);
});

test("verifyBook: draft 本无 importMeta 时不影响校验", async () => {
  const s = new VocabStore();
  s.load({
    books: [
      { id: "b1", name: "B1", order: 0, status: "draft", source: "doc-parsed", themes: [{ id: "t1", name: "未分类", order: 0, words: [
        { id: "w1", word: "x", phonetic: "", pos: "", meaning: "", mastery: 0, status: "active", labels: [], created: "2026-09-11T00:00:00.000Z", updated: "2026-09-11T00:00:00.000Z", order: 0 },
      ] }] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  const ok = await s.verifyBook("b1");
  assert.equal(ok, true);
  // importMeta 不应被自动创建
  assert.equal(s.getBook("b1").importMeta, undefined);
});
