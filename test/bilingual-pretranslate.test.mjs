import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createBilingualV2 } from "../src/reader/bilingual-v2/bilingual-v2.ts";

function makeDoc(html) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  return dom.window.document;
}

function baseOpts(over = {}) {
  return {
    bookId: "book-1",
    getContents: () => [doc],
    translateBatch: async (texts, _f, _t, _b, ctxBefore, _meta, extra) => {
      calls++;
      lastTexts = texts;
      lastCtx = ctxBefore || [];
      lastExtra = extra;
      return texts.map((x) => "译:" + x);
    },
    from: "auto",
    to: "zh",
    bookMeta: () => ({ title: "测试书", author: "某作者", language: "en" }),
    ...over,
  };
}

let doc, calls, lastTexts, lastCtx, lastExtra;

/* ---------------- pretranslateAll：整书预翻译缓存 ---------------- */

test("pretranslateAll: 遍历全书段落并携带前文上下文送译", async () => {
  doc = makeDoc("<p>第一段</p><p>第二段</p><p>第三段</p>");
  calls = 0; lastTexts = []; lastCtx = []; lastExtra = undefined;
  const handle = createBilingualV2(baseOpts());
  let prog = null;
  await handle.pretranslateAll({
    onProgress: (p) => { prog = { d: p.done, t: p.total, status: p.status, pending: p.pending }; },
  });
  assert.equal(calls, 1, "段数 < 批大小(8) 应一次送译");
  assert.equal(lastTexts.length, 3);
  assert.equal(lastTexts[0], "第一段");
  // 前文上下文：第 1 段无前文(null)，后续段携带前面正文
  assert.equal(lastCtx[0], null);
  assert.ok(lastCtx[1] && lastCtx[1].includes("第一段"), "第2段前文应含第1段");
  assert.ok(lastCtx[2] && lastCtx[2].includes("第二段"), "第3段前文应含第2段");
  assert.equal(prog.d, 3);
  assert.equal(prog.t, 3);
  assert.equal(prog.status, "done");
  assert.equal(prog.pending, 0, "完成后剩余待译为 0");
});

test("pretranslateAll: 批大小上限为 8（分段送译）", async () => {
  const paras = Array.from({ length: 20 }, (_, i) => `<p>段${i + 1}</p>`).join("");
  doc = makeDoc(paras);
  calls = 0; lastExtra = undefined;
  const handle = createBilingualV2({
    bookId: "book-2",
    getContents: () => [doc],
    translateBatch: async (texts) => {
      calls++;
      return texts.map((t) => "x:" + t);
    },
    from: "auto",
    to: "zh",
  });
  await handle.pretranslateAll();
  // 20 段 / 批 8 = 3 批 (8 + 8 + 4)
  assert.equal(calls, 3);
});

test("pretranslateAll: 空文档不调用翻译且不抛错", async () => {
  doc = makeDoc("<div></div>");
  calls = 0;
  const handle = createBilingualV2({
    bookId: "book-3",
    getContents: () => [doc],
    translateBatch: async (texts) => {
      calls++;
      return texts.map((t) => "x:" + t);
    },
    from: "auto",
    to: "zh",
  });
  await handle.pretranslateAll();
  assert.equal(calls, 0);
});

test("pretranslateAll: checkCached 全部命中则跳过翻译（pending=0, 状态 done）", async () => {
  doc = makeDoc("<p>A</p><p>B</p><p>C</p>");
  calls = 0;
  let lastStatus = null;
  const handle = createBilingualV2({
    bookId: "book-4",
    getContents: () => [doc],
    translateBatch: async (texts) => {
      calls++;
      return texts.map((t) => "x:" + t);
    },
    checkCached: async () => [true, true, true], // 全部已缓存
    from: "auto",
    to: "zh",
  });
  await handle.pretranslateAll({
    onProgress: (p) => { lastStatus = p.status; },
  });
  assert.equal(calls, 0, "全部命中缓存不应调用翻译");
  assert.equal(lastStatus, "done");
});

test("pretranslateAll: overwrite=true 时忽略缓存（仍翻译全部）", async () => {
  doc = makeDoc("<p>A</p><p>B</p><p>C</p>");
  calls = 0;
  const handle = createBilingualV2({
    bookId: "book-5",
    getContents: () => [doc],
    translateBatch: async (texts) => {
      calls++;
      return texts.map((t) => "x:" + t);
    },
    checkCached: async () => [true, true, true], // 即便全部命中
    from: "auto",
    to: "zh",
  });
  await handle.pretranslateAll({ overwrite: true });
  assert.equal(calls, 1, "overwrite 应忽略缓存、翻译全部");
});

test("pretranslateAll: model 选项透传到 translateBatch 的 extra.model", async () => {
  doc = makeDoc("<p>A</p>");
  calls = 0; lastExtra = undefined;
  const handle = createBilingualV2(baseOpts());
  await handle.pretranslateAll({ model: "deepseek-chat" });
  assert.equal(calls, 1);
  assert.ok(lastExtra && lastExtra.model === "deepseek-chat", "model 应透传为 extra.model");
});

test("pretranslateAll: signal 中断后状态为 cancelled", async () => {
  const paras = Array.from({ length: 20 }, (_, i) => `<p>段${i + 1}</p>`).join("");
  doc = makeDoc(paras);
  calls = 0;
  const ac = new AbortController();
  const handle = createBilingualV2({
    bookId: "book-6",
    getContents: () => [doc],
    translateBatch: async (texts) => {
      calls++;
      if (calls === 1) ac.abort(); // 第一批完成后立即中断
      return texts.map((t) => "x:" + t);
    },
    from: "auto",
    to: "zh",
  });
  let lastStatus = null;
  await handle.pretranslateAll({
    batchSize: 1,
    concurrency: 1,
    signal: ac.signal,
    onProgress: (p) => { lastStatus = p.status; },
  });
  assert.ok(calls >= 1 && calls < 20, `中断后应部分完成（calls=${calls}）`);
  assert.equal(lastStatus, "cancelled");
});
