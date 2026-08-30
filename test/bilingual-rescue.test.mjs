/**
 * 双语翻译「单段补救 + 透明化」P0 改造测试（2026-08-30）
 * 覆盖：
 *   - cache.ts：单条接口 getOne/setOne/deleteOne；用户修正库 fix* 独立于 AI 缓存；
 *     getBatch 返回 fromCache 标记；clear() 不清 fix
 *   - bilingual.ts：
 *     · 来源徽标：随 translateBatchDetailed 的 provider 显示（缓存/AI/已修正）
 *     · 透明化：翻译失败段注入失败占位块 + 重试按钮；重试成功后清除失败态
 *     · 单段修正：点击「修正」→ span contenteditable → 提交后 data-fixed + 徽标「已修正」+ setFix 调用
 *     · 单段隐藏：点击「隐藏」→ 节点移除 + 原文 data-reword-hide + deleteFix/deleteCacheOne
 *     · 用户修正库优先级最高：getFix 返回修正时覆盖 AI 译文
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TranslationCache } from "../src/translate/cache.ts";
import { createBilingual } from "../src/reader/bilingual.ts";

/* ==================== 工具 ==================== */

function makeDoc(html) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  return dom.window.document;
}
function makeStubPlugin() {
  const store = new Map();
  return {
    async loadData(p) { return store.get(p); },
    async saveData(p, v) { store.set(p, v); },
  };
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function setupRescue(over = {}) {
  const doc = makeDoc("<p>段落A</p><p>段落B</p>");
  const handle = createBilingual({
    bookId: "rb1",
    getContents: () => [doc],
    translateBatch: async (texts, _f, _t, _b, _c, _m, extra) =>
      texts.map((x) => (extra && extra.mode === "concise" ? "简:" : "译:") + x),
    translateBatchDetailed: async (texts, _f, _t, _b, _c, _m, extra) => ({
      texts: texts.map((x) => (extra && extra.mode === "concise" ? "简:" : "译:") + x),
      providers: texts.map(() => "openai"),
      fromCache: texts.map(() => false),
    }),
    from: "auto",
    to: "zh",
    bookMeta: () => ({ title: "测试书" }),
    ...over,
  });
  return { doc, handle };
}

/* ==================== cache.ts：单条接口 + 修正库 ==================== */

test("cache: getOne/setOne/deleteOne 单条操作", async () => {
  const c = new TranslationCache(makeStubPlugin(), () => "s");
  await c.setOne("b", "hello", "译:hello");
  assert.equal(await c.getOne("b", "hello"), "译:hello");
  await c.deleteOne("b", "hello");
  assert.equal(await c.getOne("b", "hello"), null);
});

test("cache: 用户修正库独立于 AI 缓存，clear 不清 fix", async () => {
  const c = new TranslationCache(makeStubPlugin(), () => "s");
  await c.setBatch("b", [["x", "译:x"]], "default");
  await c.fixSet("b", "x", "修正:x");
  assert.equal(await c.fixGet("b", "x"), "修正:x");
  assert.equal(await c.fixCount("b"), 1);
  await c.clear("b"); // 清空 AI 缓存
  assert.equal(await c.getOne("b", "x"), null, "AI 缓存已清");
  assert.equal(await c.fixGet("b", "x"), "修正:x", "fix 仍保留（最珍贵）");
  await c.fixDelete("b", "x");
  assert.equal(await c.fixGet("b", "x"), null);
});

test("cache: getBatch 返回 fromCache 标记", async () => {
  const c = new TranslationCache(makeStubPlugin(), () => "s");
  await c.setBatch("b", [["a", "译:a"]], "default");
  const r = await c.getBatch("b", ["a", "b"], "default");
  assert.equal(r.fromCache[0], true);
  assert.equal(r.fromCache[1], false);
  assert.equal(r.misses.length, 1);
});

/* ==================== bilingual.ts：来源徽标 ==================== */

test("bilingual: 来源徽标随 translateBatchDetailed 的 provider 显示", async () => {
  const { doc, handle } = setupRescue();
  handle.setEnabled(true);
  await tick();
  const div = doc.querySelector(".reword-bilingual");
  const badge = div.querySelector(".reword-bilingual-badge");
  assert.ok(badge, "应有来源徽标");
  assert.equal(badge.getAttribute("data-provider"), "openai");
  assert.equal(badge.textContent, "AI"); // badgeText("openai") → "AI"
  assert.equal(div.getAttribute("data-provider"), "openai");
});

/* ==================== bilingual.ts：失败块 + 重试 ==================== */

test("bilingual: 翻译失败段注入失败占位块 + 重试按钮，重试后变正常译文", async () => {
  const doc = makeDoc("<p>正常段</p><p>失败段</p>");
  // succeed=false 时「失败段」返回空（模拟首次翻译失败）；重试前置 true 让重译成功
  let succeed = false;
  const handle = createBilingual({
    bookId: "rf",
    getContents: () => [doc],
    translateBatchDetailed: async (texts) => ({
      texts: texts.map((x) => (x.includes("失败") && !succeed ? "" : "译:" + x)),
      providers: texts.map((x) => (x.includes("失败") && !succeed ? null : "openai")),
      fromCache: texts.map(() => false),
    }),
    from: "auto",
    to: "zh",
  });
  handle.setEnabled(true);
  await tick();
  const failedDiv = [...doc.querySelectorAll(".reword-bilingual")].find((d) => d.getAttribute("data-failed") === "1");
  assert.ok(failedDiv, "应有失败占位块");
  const retry = failedDiv.querySelector('button[data-action="retry"]');
  assert.ok(retry, "失败块应有重试按钮");
  // 开启成功模式并重试（模拟网络恢复/API 配置就绪）
  succeed = true;
  retry.click();
  await tick();
  assert.equal(failedDiv.getAttribute("data-failed"), null, "重试成功后清除失败标记");
  assert.equal(failedDiv.classList.contains("reword-bilingual-failed"), false);
  const span = failedDiv.querySelector(".reword-bilingual-text");
  assert.ok(span.textContent.includes("译:"), "重试后显示译文");
});

/* ==================== bilingual.ts：单段修正 ==================== */

test("bilingual: 点击「修正」→ span 可编辑，提交后 data-fixed + 徽标「已修正」+ setFix 调用", async () => {
  const doc = makeDoc("<p>段落X</p>");
  const fixStore = {};
  const { handle } = createBilingualFixture(doc, {
    translateBatch: async (texts) => texts.map((x) => "译:" + x),
    getFix: (t) => fixStore[t] || null,
    setFix: (t, tr) => { fixStore[t] = tr; },
  });
  handle.setEnabled(true);
  await tick();
  const div = doc.querySelector(".reword-bilingual");
  const fixBtn = div.querySelector('button[data-action="fix"]');
  assert.ok(fixBtn, "应有修正按钮");
  fixBtn.click();
  const span = div.querySelector(".reword-bilingual-text");
  assert.equal(span.getAttribute("contenteditable"), "true", "点击后应进入编辑态");
  span.textContent = "我改的译法";
  span.dispatchEvent(new doc.defaultView.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await tick();
  assert.equal(span.getAttribute("contenteditable"), "false", "提交后退出编辑态");
  assert.equal(div.getAttribute("data-fixed"), "1", "标注已修正");
  const badge = div.querySelector(".reword-bilingual-badge");
  assert.equal(badge.textContent, "已修正");
  assert.equal(fixStore["段落X"], "我改的译法", "setFix 被调用写入修正库");
});

/* ==================== bilingual.ts：单段隐藏 ==================== */

test("bilingual: 点击「隐藏」→ 节点移除 + 原文 data-reword-hide + deleteFix/deleteCacheOne", async () => {
  const doc = makeDoc("<p>段落Y</p>");
  let deletedFix = null;
  let deletedCache = null;
  const { handle } = createBilingualFixture(doc, {
    translateBatch: async (texts) => texts.map((x) => "译:" + x),
    deleteFix: (t) => { deletedFix = t; },
    deleteCacheOne: (t) => { deletedCache = t; },
  });
  handle.setEnabled(true);
  await tick();
  const div = doc.querySelector(".reword-bilingual");
  const p = div.parentElement;
  const hideBtn = div.querySelector('button[data-action="hide"]');
  assert.ok(hideBtn, "应有隐藏按钮");
  hideBtn.click();
  await tick();
  assert.equal(doc.querySelector(".reword-bilingual"), null, "译文块已移除");
  assert.equal(p.getAttribute("data-reword-hide"), "1", "原文标记隐藏（getSegments 跳过）");
  assert.equal(deletedFix, "段落Y", "deleteFix 被调用");
  assert.equal(deletedCache, "段落Y", "deleteCacheOne 被调用");
});

/* ==================== bilingual.ts：修正库优先级 ==================== */

test("bilingual: getFix 返回的修正优先于 AI 译文，徽标显示「已修正」", async () => {
  const doc = makeDoc("<p>段落Z</p>");
  const { handle } = createBilingualFixture(doc, {
    translateBatchDetailed: async (texts) => ({
      texts: texts.map((x) => "译:" + x),
      providers: texts.map(() => "openai"),
      fromCache: texts.map(() => false),
    }),
    getFix: () => "用户钉选译法",
  });
  handle.setEnabled(true);
  await tick();
  const div = doc.querySelector(".reword-bilingual");
  const span = div.querySelector(".reword-bilingual-text");
  assert.equal(span.textContent, "用户钉选译法", "修正库优先");
  assert.equal(div.getAttribute("data-fixed"), "1");
  const badge = div.querySelector(".reword-bilingual-badge");
  assert.equal(badge.textContent, "已修正");
});

/* ==================== fixture 构造（带 getContents 指向固定 doc） ==================== */

function createBilingualFixture(doc, over = {}) {
  const handle = createBilingual({
    bookId: "fx",
    getContents: () => [doc],
    translateBatch: async (texts, _f, _t, _b, _c, _m, extra) =>
      texts.map((x) => (extra && extra.mode === "concise" ? "简:" : "译:") + x),
    translateBatchDetailed: async (texts, _f, _t, _b, _c, _m, extra) => ({
      texts: texts.map((x) => (extra && extra.mode === "concise" ? "简:" : "译:") + x),
      providers: texts.map(() => "openai"),
      fromCache: texts.map(() => false),
    }),
    from: "auto",
    to: "zh",
    ...over,
  });
  return { doc, handle };
}
