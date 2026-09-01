import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNumberedTranslations, AiTranslator } from "../src/translate/providers/ai.ts";
import { buildProviders } from "../src/translate/engine.ts";
import { TranslationCache } from "../src/translate/cache.ts";

/* ---------------- parseNumberedTranslations ---------------- */

test("parseNumberedTranslations: 基本解析与对齐", () => {
  const content = "[[1]]\n老人站在码头尽头。\n\n[[2]]\n潮水涌来。";
  const pairs = parseNumberedTranslations(content);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs[0], [1, "老人站在码头尽头。"]);
  assert.deepEqual(pairs[1], [2, "潮水涌来。"]);
});

test("parseNumberedTranslations: 译文内含多行 / 空行不丢内容", () => {
  const content = "[[1]]\n第一行。\n第二行。\n\n[[2]]\n尾段。";
  const pairs = parseNumberedTranslations(content);
  assert.equal(pairs[0][1], "第一行。\n第二行。");
  assert.equal(pairs[1][1], "尾段。");
});

test("parseNumberedTranslations: 空译文序号不返回（交给逐段兜底）", () => {
  const content = "[[1]]\n\n[[2]]\n有译文。";
  const pairs = parseNumberedTranslations(content);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0][0], 2);
});

test("parseNumberedTranslations: 空输入返回空数组", () => {
  assert.deepEqual(parseNumberedTranslations(""), []);
  assert.deepEqual(parseNumberedTranslations(undefined), []);
});

test("parseNumberedTranslations: 无序号标记的纯文本不误解析", () => {
  assert.deepEqual(parseNumberedTranslations("普通回复，没有标记。"), []);
});

/* ---------------- AiTranslator：批量优先 / 逐段兜底 ---------------- */

test("AiTranslator: 优先走批量模式", async () => {
  let oneCalls = 0;
  const t = new AiTranslator({
    translateBatch: async (texts) => texts.map((x) => "B:" + x),
    translateOne: async () => {
      oneCalls++;
      return "";
    },
  });
  const out = await t.translate({ texts: ["a", "b"], from: "auto", to: "zh" });
  assert.deepEqual(out, ["B:a", "B:b"]);
  assert.equal(oneCalls, 0, "批量成功时不应触发逐段调用");
});

test("AiTranslator: 批量抛错时退回逐段兜底", async () => {
  const t = new AiTranslator({
    translateBatch: async () => {
      throw new Error("boom");
    },
    translateOne: async (text) => "S:" + text,
  });
  const out = await t.translate({ texts: ["a", "b"], from: "auto", to: "zh" });
  assert.deepEqual(out, ["S:a", "S:b"]);
});

test("AiTranslator: 批量返回长度不符时退回逐段兜底", async () => {
  const t = new AiTranslator({
    translateBatch: async (texts) => texts.slice(0, 1),
    translateOne: async (text) => "S:" + text,
  });
  const out = await t.translate({ texts: ["a", "b"], from: "auto", to: "zh" });
  assert.deepEqual(out, ["S:a", "S:b"]);
});

test("AiTranslator: available 随注入函数变化", () => {
  assert.equal(new AiTranslator({}).available, false);
  assert.equal(new AiTranslator({ translateOne: async () => "" }).available, true);
});

/* ---------------- buildProviders：AI 首选 + 免费引擎按配置兜底 ---------------- */

test("buildProviders: AI 恒为链首，未配置的免费引擎不入链", () => {
  const providers = buildProviders({}, { translateOne: async () => "" });
  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, "ai");
});

test("buildProviders: 开关开启且已配置时免费引擎在前，AI 在链尾兜底", () => {
  // 2026-08-30 重构：AI 从"链首"改为"链尾兜底"（省 token：免费额度内不消耗 AI）
  // 引擎链顺序：① 免费机器翻译（按 priority 顺序）→ ② AI 兜底
  const providers = buildProviders(
    { msEnabled: true, msKey: "k", msRegion: "r", libreEnabled: true, libreUrl: "http://x" },
    { translateOne: async () => "" }
  );
  assert.deepEqual(
    providers.map((p) => p.name),
    ["microsoft", "libretranslate", "ai"]
  );
});

test("buildProviders: 默认关闭（无开关）时免费引擎不入链，即使填了 key", () => {
  const providers = buildProviders(
    { msKey: "k", msRegion: "r", libreUrl: "http://x" },
    { translateOne: async () => "" }
  );
  assert.deepEqual(
    providers.map((p) => p.name),
    ["ai"]
  );
});

test("buildProviders: 开关开启但未配置 key/url 仍不入链", () => {
  const providers = buildProviders(
    { msEnabled: true, libreEnabled: true },
    { translateOne: async () => "" }
  );
  assert.deepEqual(
    providers.map((p) => p.name),
    ["ai"]
  );
});

test("buildProviders: 批量函数透传给 AiTranslator", async () => {
  const providers = buildProviders(
    {},
    {
      translateOne: async () => "ONE",
      translateBatch: async (texts) => texts.map(() => "BATCH"),
    }
  );
  const res = await providers[0].translate({ texts: ["a", "b"], from: "auto", to: "zh" });
  assert.deepEqual(res, ["BATCH", "BATCH"]);
});

/* ---------------- TranslationCache：salt 使旧缓存自动失效 ---------------- */

function makeStubPlugin() {
  const store = new Map();
  return {
    async loadData(p) {
      return store.get(p);
    },
    async saveData(p, v) {
      store.set(p, v);
    },
  };
}

test("TranslationCache: 同 salt 命中，不同 salt 不命中", async () => {
  const plugin = makeStubPlugin();
  const c1 = new TranslationCache(plugin, () => "prompt-v1");
  await c1.setBatch("book1", [["hello", "你好"]]);
  const r1 = await c1.getBatch("book1", ["hello"]);
  assert.deepEqual(r1.hits, { 0: "你好" });

  // 新实例、不同 salt（提示词改版）→ 旧 key 不命中
  const c2 = new TranslationCache(plugin, () => "prompt-v2");
  const r2 = await c2.getBatch("book1", ["hello"]);
  assert.deepEqual(r2.hits, {});
  assert.deepEqual(r2.misses, [0]);
});

test("TranslationCache: 无 salt 时向后兼容", async () => {
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin);
  await c.setBatch("book1", [["hello", "你好"]]);
  const r = await c.getBatch("book1", ["hello"]);
  assert.deepEqual(r.hits, { 0: "你好" });
});
