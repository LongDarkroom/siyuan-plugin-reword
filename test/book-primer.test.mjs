/**
 * book-primer（本书前提上下文）单测
 * 覆盖：token 估算、CRUD、空串删除语义、防抖落盘、load 兼容
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BookPrimerStore,
  estimateTokens,
  PRIMER_WARN_CHARS,
  BOOK_PRIMER_KEY,
} from "../src/reader/book-primer.ts";

/** 构造带内存读写的 mock plugin */
function mockPlugin() {
  const files = new Map();
  return {
    files,
    async loadData(key) {
      return files.has(key) ? JSON.parse(JSON.stringify(files.get(key))) : null;
    },
    async saveData(key, data) {
      files.set(key, JSON.parse(JSON.stringify(data)));
    },
  };
}

test("estimateTokens: 中文按 1 token/字", () => {
  assert.equal(estimateTokens("你好世界"), 4);
});

test("estimateTokens: 西文按 4 字符 1 token", () => {
  assert.equal(estimateTokens("abcdefgh"), 2);
});

test("estimateTokens: 混合文本 = cjk*1 + other/4", () => {
  // 2 个中文 + 8 个西文字符 → 2 + 2 = 4
  assert.equal(estimateTokens("ab中cd文efgh"), 4);
});

test("estimateTokens: 空串返回 0", () => {
  assert.equal(estimateTokens(""), 0);
});

test("estimateTokens: 阈值常量合理", () => {
  assert.equal(typeof PRIMER_WARN_CHARS, "number");
  assert.ok(PRIMER_WARN_CHARS > 0);
});

test("BookPrimerStore: set 后 get 返回正文", async () => {
  const p = new BookPrimerStore(mockPlugin());
  await p.load();
  await p.set("bk1", "Sludge = 斯拉奇（狗名）", "Nate the Great");
  assert.equal(p.get("bk1"), "Sludge = 斯拉奇（狗名）");
  const e = p.getEntry("bk1");
  assert.equal(e.title, "Nate the Great");
  assert.ok(e.updatedAt > 0);
});

test("BookPrimerStore: set 空串等同删除", async () => {
  const p = new BookPrimerStore(mockPlugin());
  await p.load();
  await p.set("bk1", "some primer");
  await p.set("bk1", "");
  assert.equal(p.get("bk1"), "");
  assert.equal(p.getEntry("bk1"), undefined);
});

test("BookPrimerStore: remove 清除条目", async () => {
  const p = new BookPrimerStore(mockPlugin());
  await p.load();
  await p.set("bk1", "primer-a");
  await p.remove("bk1");
  assert.equal(p.get("bk1"), "");
});

test("BookPrimerStore: flush 落盘后重新 load 可恢复", async () => {
  const plugin = mockPlugin();
  const p1 = new BookPrimerStore(plugin);
  await p1.load();
  await p1.set("bk1", "primer-keep");
  await p1.flush();
  const p2 = new BookPrimerStore(plugin);
  await p2.load();
  assert.equal(p2.get("bk1"), "primer-keep");
  assert.ok(plugin.files.has(BOOK_PRIMER_KEY));
});

test("BookPrimerStore: load 容错（坏 JSON / 非对象 / null）", async () => {
  const bad = { async loadData() { throw new Error("boom"); }, async saveData() {} };
  const p1 = new BookPrimerStore(bad);
  await p1.load();
  assert.equal(p1.get("x"), "");
  const p2 = new BookPrimerStore({ async loadData() { return "[1,2,3]"; }, async saveData() {} });
  await p2.load();
  assert.equal(p2.get("x"), "");
  const p3 = new BookPrimerStore({ async loadData() { return null; }, async saveData() {} });
  await p3.load();
  assert.equal(p3.get("x"), "");
});

test("BookPrimerStore: clearAll 清空全部", async () => {
  const p = new BookPrimerStore(mockPlugin());
  await p.load();
  await p.set("bk1", "a");
  await p.set("bk2", "b");
  await p.clearAll();
  assert.equal(p.get("bk1"), "");
  assert.equal(p.get("bk2"), "");
  assert.deepEqual(Object.keys(p.all()), []);
});

test("BookPrimerStore: set 二次写入更新 title 并保留旧 title", async () => {
  const p = new BookPrimerStore(mockPlugin());
  await p.load();
  await p.set("bk1", "v1", "Book A");
  await p.set("bk1", "v2");
  const e = p.getEntry("bk1");
  assert.equal(e.primer, "v2");
  assert.equal(e.title, "Book A");
});

test("BookPrimerStore: 空 bookId 安全（no-op）", async () => {
  const p = new BookPrimerStore(mockPlugin());
  await p.load();
  await p.set("", "x");
  assert.equal(p.get(""), "");
  await p.remove("");
  await p.flush();
});
