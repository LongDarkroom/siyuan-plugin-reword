/**
 * AI 精读本地后校验测试（2026-09-06 第 4 批 P1-B）
 * 覆盖：句子逐字比对 / 词见于原文 / 引文清空 / 翻译直通作弊 / ordinal 派生 /
 *       strict 模式词库过滤 / deepReadVerify=off 跳过 / <user_input> 边界包裹
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { verifyDeepReadResult, normText } from "../src/ai/ai-deepread-verify.ts";
import { runAiDeepRead, buildUserPrompt } from "../src/ai/ai-orchestrator.ts";
import { DEFAULT_AI_SETTINGS } from "../src/ai/ai-settings.ts";

const SOURCE = "The quick brown fox jumps over the lazy dog. It was a bright cold day in April.";

function mkResult(overrides = {}) {
  return {
    ok: true,
    isJson: true,
    words: [],
    sentences: [],
    raw: "",
    ...overrides,
  };
}

// ───────────────────────── 句子比对 ─────────────────────────

test("verify: 原文逐字出现的句子通过", () => {
  const r = mkResult({ sentences: [{ sentence: "The quick brown fox jumps over the lazy dog.", translation: "快狐跳过懒狗。" }] });
  const v = verifyDeepReadResult(r, SOURCE);
  assert.equal(v.issues.length, 0);
});

test("verify: 空白差异归一化后通过（换行/多空格）", () => {
  const r = mkResult({ sentences: [{ sentence: "The quick\n  brown fox  jumps over the lazy dog.", translation: "译" }] });
  const v = verifyDeepReadResult(r, SOURCE);
  assert.equal(v.issues.filter((i) => i.kind === "sentence").length, 0);
});

test("verify: 大小写差异放行（不算编造）", () => {
  const r = mkResult({ sentences: [{ sentence: "the quick brown fox jumps over the LAZY dog.", translation: "译" }] });
  const v = verifyDeepReadResult(r, SOURCE);
  assert.equal(v.issues.filter((i) => i.kind === "sentence").length, 0);
});

test("verify: 编造的句子被标记", () => {
  const r = mkResult({ sentences: [{ sentence: "The fox quickly jumped over fences near the river bank.", translation: "译" }] });
  const v = verifyDeepReadResult(r, SOURCE);
  const hit = v.issues.find((i) => i.kind === "sentence");
  assert.ok(hit, "应有 sentence issue");
  assert.match(hit.reason, /与原文不符/);
});

// ───────────────────────── 词与引文 ─────────────────────────

test("verify: 词不在原文 → flaggedWords + issue", () => {
  const r = mkResult({ words: [{ word: "elephant", meaning: "象" }] });
  const v = verifyDeepReadResult(r, SOURCE);
  assert.ok(v.flaggedWords.has("elephant"));
  assert.ok(v.issues.some((i) => i.kind === "word" && i.target === "elephant"));
});

test("verify: 词在原文（大小写不同）→ 通过", () => {
  const r = mkResult({ words: [{ word: "Quick", meaning: "快的" }] });
  const v = verifyDeepReadResult(r, SOURCE);
  assert.equal(v.issues.filter((i) => i.kind === "word").length, 0);
});

test("verify: 引文与原文不符 → 清空 context + issue", () => {
  const r = mkResult({ words: [{ word: "fox", meaning: "狐", context: "A fox sat by the river." }] });
  const v = verifyDeepReadResult(r, SOURCE);
  assert.equal(r.words[0].context, undefined, "不符引文应被清空");
  assert.ok(v.issues.some((i) => i.kind === "quote"));
  assert.equal(v.mutated, true);
});

test("verify: 引文逐字照抄 → 保留", () => {
  const r = mkResult({ words: [{ word: "fox", meaning: "狐", context: "The quick brown fox jumps" }] });
  const v = verifyDeepReadResult(r, SOURCE);
  assert.equal(r.words[0].context, "The quick brown fox jumps");
  assert.equal(v.issues.filter((i) => i.kind === "quote").length, 0);
});

// ───────────────────────── 翻译直通 ─────────────────────────

test("verify: 翻译为空 / 与原句相同 → 标记", () => {
  const r = mkResult({
    sentences: [
      { sentence: "It was a bright cold day in April.", translation: "" },
      { sentence: "The quick brown fox jumps over the lazy dog.", translation: "The quick brown fox jumps over the lazy dog." },
    ],
  });
  const v = verifyDeepReadResult(r, SOURCE);
  assert.equal(v.issues.filter((i) => i.kind === "translation").length, 2);
});

// ───────────────────────── ordinal 派生 ─────────────────────────

test("verify: AI 未给 ordinal 时按预处理分句派生（1-based）", () => {
  const r = mkResult({ sentences: [{ sentence: "It was a bright cold day in April.", translation: "译" }] });
  verifyDeepReadResult(r, SOURCE, { sentences: ["The quick brown fox jumps over the lazy dog.", "It was a bright cold day in April."] });
  assert.equal(r.sentences[0].ordinal, 2);
});

// ───────────────────────── 边界与编排层 ─────────────────────────

test("verify: 非结构化结果 / 空原文跳过", () => {
  const r = mkResult({ isJson: false, sentences: [{ sentence: "编造", translation: "" }] });
  const v = verifyDeepReadResult(r, "");
  assert.equal(v.issues.length, 0);
});

test("buildUserPrompt: 材料包 <user_input> 边界", () => {
  const p = buildUserPrompt({ text: "Hello world." });
  assert.match(p, /<user_input>\nHello world\.\n<\/user_input>/);
  assert.match(p, /【请精读下列文本】/);
});

test("runAiDeepRead: deepReadVerify=off 不产生 issues", async () => {
  const transport = async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        words: [{ word: "elephant", meaning: "象" }],
        sentences: [{ sentence: "编造的句子完全不在原文里。", translation: "译" }],
      }) } }],
    }),
  });
  const res = await runAiDeepRead(
    { text: SOURCE },
    { ...DEFAULT_AI_SETTINGS, deepReadVerify: "off" },
    { transport }
  );
  assert.equal(res.issues, undefined);
});

test("runAiDeepRead: warn 模式标记不符项", async () => {
  const transport = async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        words: [{ word: "elephant", meaning: "象" }],
        sentences: [{ sentence: "编造的句子完全不在原文里。", translation: "译" }],
      }) } }],
    }),
  });
  const res = await runAiDeepRead({ text: SOURCE }, { ...DEFAULT_AI_SETTINGS }, { transport });
  assert.ok(res.issues && res.issues.length >= 2, "word + sentence 都应被标记");
});

test("runAiDeepRead: strict 模式被标记的词不入词库", async () => {
  const upserted = [];
  const vocabStore = {
    findRecord: () => null,
    upsertWord: async (_w, _data, _src) => { upserted.push(_w); return { added: true }; },
  };
  const transport = async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        words: [
          { word: "fox", meaning: "狐" },
          { word: "elephant", meaning: "象" },
        ],
        sentences: [],
      }) } }],
    }),
  });
  const res = await runAiDeepRead(
    { text: SOURCE },
    { ...DEFAULT_AI_SETTINGS, deepReadVerify: "strict" },
    { transport, vocabStore }
  );
  assert.deepEqual(upserted, ["fox"], "只有原文中真实存在的词入库");
  assert.ok(res.issues.some((i) => i.kind === "word"));
});

test("runAiDeepRead: sourceBlockId 透传到结果（回链用）", async () => {
  const transport = async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sentences: [] }) } }] }),
  });
  const res = await runAiDeepRead({ text: SOURCE }, { ...DEFAULT_AI_SETTINGS }, { transport, sourceBlockId: "20260906120000-abc" });
  assert.equal(res.sourceBlockId, "20260906120000-abc");
});

test("normText: 折叠空白", () => {
  assert.equal(normText("a\n  b\t c"), "a b c");
});
