import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitSentences,
  extractHighlights,
  stripHighlightMarkers,
  findContextSentence,
} from "../src/ai/ai-text.ts";

test("splitSentences: 基本英文分句", () => {
  const s = splitSentences("Hello world. This is a test! Do you agree? Yes.");
  assert.deepEqual(s, ["Hello world.", "This is a test!", "Do you agree?", "Yes."]);
});

test("splitSentences: 保留缩写词尾句点（Dr./Mr.）", () => {
  const s = splitSentences("Dr. Smith went home. He slept well.");
  assert.equal(s.length, 2, "Dr. 不应被拆成两句");
  assert.ok(s[0].startsWith("Dr. Smith"));
});

test("splitSentences: 兼容中文句号", () => {
  const s = splitSentences("今天天气很好。我们去散步。");
  assert.deepEqual(s, ["今天天气很好。", "我们去散步。"]);
});

test("splitSentences: 空文本返回空数组", () => {
  assert.deepEqual(splitSentences(""), []);
  assert.deepEqual(splitSentences("   "), []);
});

test("extractHighlights: 识别 ==mark== 与 **bold** 并去重", () => {
  const md = "==apple== is good and **banana** too. ==apple== again.";
  const hs = extractHighlights(md);
  const terms = hs.map((h) => h.term);
  assert.deepEqual(terms, ["apple", "banana"]);
  assert.equal(hs[0].marker, "mark");
  assert.equal(hs[1].marker, "bold");
});

test("extractHighlights: 识别 __bold__ 与 *italic*", () => {
  const md = "__cat__ and *dog*";
  const hs = extractHighlights(md);
  const byTerm = Object.fromEntries(hs.map((h) => [h.term, h.marker]));
  assert.equal(byTerm["cat"], "bold");
  assert.equal(byTerm["dog"], "italic");
});

test("stripHighlightMarkers: 去除标记保留正文", () => {
  const md = "==apple== is **red** and *ripe*.";
  assert.equal(stripHighlightMarkers(md), "apple is red and ripe.");
});

test("findContextSentence: 返回包含该词的最短句", () => {
  const sents = ["The cat sat.", "An apple fell from the tree.", "He ate it."];
  assert.equal(findContextSentence("apple", sents), "An apple fell from the tree.");
  assert.equal(findContextSentence("banana", sents), undefined);
});
