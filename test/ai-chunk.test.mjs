/**
 * 第 5 批 · 长文分块回归（2026-09-06）。
 * 覆盖 ai-chunk 的纯逻辑：分段边界 + 单段硬切 + 合并去重。
 * runChunkedDeepRead 的并发编排属集成层（依赖 runAiDeepRead 网络），此处不直接跑。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { splitIntoChunks, mergeDeepReadResults } from "../src/ai/ai-chunk.ts";

function fakeResult(word, sentence, summary) {
  return {
    ok: true,
    isJson: true,
    words: [{ word, meaning: "m" }],
    sentences: [{ sentence }],
    summary,
    raw: summary || "",
    issues: [],
  };
}

test("splitIntoChunks：按段落边界打包，不超阈值", () => {
  // 段落较长 + 阈值 250（低于 200 下限会被抬到 200，故用 >200 的阈值验证切分）
  const para = (i) => `段落${i} 这是一段足够长的正文内容用于验证分段边界打包逻辑是否按空行切分且不越过阈值上限`.repeat(1);
  const text = Array.from({ length: 6 }, (_, i) => para(i)).join("\n\n");
  const chunks = splitIntoChunks(text, 250);
  assert.ok(chunks.length >= 2, `应切成多块，实际 ${chunks.length}`);
  for (const c of chunks) assert.ok(c.length <= 250, `块应 ≤ 阈值，实际 ${c.length}`);
});

test("splitIntoChunks：单段超长硬切兜底", () => {
  const huge = "x".repeat(2500);
  const chunks = splitIntoChunks(huge, 1000);
  assert.ok(chunks.length >= 2, "超长单段应硬切");
  for (const c of chunks) assert.ok(c.length <= 1000, "硬切后每块 ≤ 阈值");
});

test("splitIntoChunks：短文本单块", () => {
  const chunks = splitIntoChunks("一句很短的话", 3000);
  assert.equal(chunks.length, 1);
});

test("mergeDeepReadResults：词/句去重，小结拼接", () => {
  const a = fakeResult("Apple", "I like apples.", "小结A：讲水果");
  const b = fakeResult("apple", "I like apples.", "小结B：复现"); // 大小写/重复句应被去重
  const c = fakeResult("Banana", "Bananas are yellow.", "小结C：讲香蕉");
  const merged = mergeDeepReadResults([a, b, c]);
  const words = merged.words.map((w) => w.word.toLowerCase());
  assert.equal(words.filter((w) => w === "apple").length, 1, "apple/Apple 去重为 1");
  assert.ok(words.includes("banana"));
  const sents = merged.sentences.map((s) => s.sentence.toLowerCase());
  assert.equal(sents.filter((s) => s === "i like apples.").length, 1, "重复句去重");
  assert.ok(merged.summary.includes("小结A") && merged.summary.includes("小结C"), "小结应拼接");
  assert.equal(merged.ok, true);
});

test("mergeDeepReadResults：空输入安全返回", () => {
  const merged = mergeDeepReadResults([]);
  assert.equal(merged.ok, false);
  assert.equal(merged.words.length, 0);
  assert.equal(merged.sentences.length, 0);
});
