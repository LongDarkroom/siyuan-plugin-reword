import { test } from "node:test";
import assert from "node:assert/strict";
import { VocabStore, ALL_BOOK_ID } from "../src/vocab/vocab-store.ts";
import { WordStatus } from "../src/types.ts";

function freshStore() {
  const store = new VocabStore(() => {});
  // 模拟从空持久化加载 → 创建默认单词本 + 未分类
  store.load(null);
  return store;
}

test("总库：getBooks 含虚拟总库且排在最前", () => {
  const store = freshStore();
  store.addWord("apple");
  store.addWord("banana");
  const books = store.getBooks();
  assert.equal(books[0].id, ALL_BOOK_ID, "总库应排在最前");
  assert.equal(books[0].themes[0].name, "全集");
  assert.equal(books[0].themes[0].words.length, 2, "总库应聚合全部单词");
});

test("总库：getBook(ALL) 实时投影，含全部状态", () => {
  const store = freshStore();
  store.addWord("alpha");
  store.archiveWord("alpha"); // archived 状态
  const master = store.getBook(ALL_BOOK_ID);
  assert.ok(master, "getBook(ALL) 应返回虚拟本");
  assert.equal(master.themes[0].words.length, 1);
  assert.equal(master.themes[0].words[0].status, WordStatus.Archived, "总库应包含 archived 单词");
});

test("防护：moveWord 目标为总库时拒绝", async () => {
  const store = freshStore();
  store.addWord("x");
  const ok = await store.moveWord("x", ALL_BOOK_ID, "th-xx");
  assert.equal(ok, false, "不可移入总库");
});

test("防护：addWord 目标为总库时重定向到当前本+未分类", async () => {
  const store = freshStore();
  // 切到一个新本并加词，验证重定向不走总库
  await store.addBook("B2");
  const r = await store.addWord("y", undefined, ALL_BOOK_ID, undefined);
  assert.equal(r.added, true);
  // 总库不应凭空多出（仍是聚合），且词存在于某真实本
  assert.ok(store.findRecord("y"), "词应被收录到真实本");
});

test("防护：renameBook/removeBook/addTheme/removeTheme 对总库为 no-op", async () => {
  const store = freshStore();
  store.addWord("z");
  const before = store.getBooks().length;
  await store.renameBook(ALL_BOOK_ID, "改名");
  await store.removeBook(ALL_BOOK_ID);
  await store.addTheme(ALL_BOOK_ID, "子类");
  await store.removeTheme(ALL_BOOK_ID, "th");
  const after = store.getBooks().length;
  assert.equal(after, before, "对总库的增删改不应改变真实本数量");
  assert.equal(store.getBook(ALL_BOOK_ID)?.name, "单词总库", "总库名称不变");
});

test("批量分类：moveWord 在真实本之间移动（单归属）", async () => {
  const store = freshStore();
  await store.addBook("目标本");
  const target = store.getBooks().find((b) => b.name === "目标本");
  store.addWord("moveme");
  const ok = await store.moveWord("moveme", target.id, target.themes[0].id);
  assert.equal(ok, true);
  assert.ok(store.getBook(target.id).themes[0].words.some((w) => w.word === "moveme"));
});
