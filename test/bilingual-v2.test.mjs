/**
 * bilingual-v2 回归测试（2026-08-31：v1 删除后，以下用例迁移自
 * 原 bilingual-concise.test.mjs 的「桥接层」部分）
 *
 * 覆盖：
 *   - 注入时 ctxBefore（前文参考）与 bookMeta 真的透传到 translateBatch
 *   - 多段注入时前文参考携带最近 2 段
 *   - handle 生命周期：setEnabled(false) 清除注入节点（零正文污染）
 *   - pretranslateAll：全部命中缓存时不再空跑（防止白烧 token 的回归）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createBilingualV2 } from "../src/reader/bilingual-v2/bilingual-v2.ts";

/** v2 的 scheduleInject 是 300ms 防抖，注入类用例需等 >300ms */
const INJECT_WAIT = 420;

function makeDoc(html) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  return dom.window.document;
}

/* ==================== 桥接层：ctxBefore + meta 透传 ==================== */

test("bridge: v2 注入时 ctxBefore + meta 透传到 opts.translateBatch", async () => {
  const doc = makeDoc("<p>第一段</p><p>第二段</p>");
  let receivedCtx = null;
  let receivedMeta = null;
  const handle = createBilingualV2({
    bookId: "bridge-1",
    getContents: () => [doc],
    translateBatch: async (_texts, _f, _t, _b, ctx, meta) => {
      receivedCtx = ctx;
      receivedMeta = meta;
      return ["译:a", "译:b"];
    },
    from: "auto",
    to: "zh",
    bookMeta: () => ({ title: "桥测试书", author: "桥作者", language: "en" }),
  });
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, INJECT_WAIT));

  assert.ok(Array.isArray(receivedCtx), "ctxBefore 必须为数组");
  assert.equal(receivedCtx.length, 2, "ctxBefore 长度应等于 pending 段数（2）");
  assert.equal(receivedCtx[0], null, "第一段无前文");
  assert.ok(receivedCtx[1] && receivedCtx[1].includes("第一段"), "第二段前文含第一段");

  assert.ok(receivedMeta, "meta 必须非空（书籍元数据）");
  assert.equal(receivedMeta.title, "桥测试书");
  assert.equal(receivedMeta.author, "桥作者");
  assert.equal(receivedMeta.language, "en");
});

test("bridge: v2 多段注入时 ctxBefore 携带前文参考（最近 2 段）", async () => {
  const doc = makeDoc("<p>第一段</p><p>第二段</p><p>第三段</p>");
  let receivedCtx = null;
  const handle = createBilingualV2({
    bookId: "bridge-2",
    getContents: () => [doc],
    translateBatch: async (_texts, _f, _t, _b, ctx) => {
      receivedCtx = ctx;
      return ["译:a", "译:b", "译:c"];
    },
    from: "auto",
    to: "zh",
  });
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, INJECT_WAIT));

  assert.equal(receivedCtx[0], null, "第一段无前文");
  assert.ok(receivedCtx[1] && receivedCtx[1].includes("第一段"), "第二段前文含第一段");
  assert.ok(
    receivedCtx[2] && receivedCtx[2].includes("第一段") && receivedCtx[2].includes("第二段"),
    "第三段前文含前两段"
  );
});

/* ==================== 零正文污染 ==================== */

test("lifecycle: setEnabled(false) 清除全部注入节点（正文零残留）", async () => {
  const doc = makeDoc("<p>甲</p><p>乙</p>");
  const handle = createBilingualV2({
    bookId: "life-1",
    getContents: () => [doc],
    translateBatch: async (texts) => texts.map((t) => "译:" + t),
    from: "auto",
    to: "zh",
  });
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, INJECT_WAIT));
  const htmlBefore = doc.body.innerHTML;
  assert.ok(htmlBefore.includes("reword-bilingual"), "开启后应存在译文节点");

  handle.setEnabled(false);
  await new Promise((r) => setTimeout(r, INJECT_WAIT));
  assert.equal(doc.body.innerHTML, "<p>甲</p><p>乙</p>", "关闭后正文应还原为原始 HTML");
});

/* ==================== 预翻译：缓存短路（防白烧 token 回归） ==================== */

test("pretranslate: 全部命中缓存时不调用翻译（短路，避免重译全书）", async () => {
  const doc = makeDoc("<p>A</p><p>B</p><p>C</p>");
  let calls = 0;
  let lastStatus = null;
  const handle = createBilingualV2({
    bookId: "pt-short-1",
    getContents: () => [doc],
    translateBatch: async (texts) => {
      calls++;
      return texts.map((t) => "x:" + t);
    },
    checkCached: async () => [true, true, true],
    from: "auto",
    to: "zh",
  });
  handle.setEnabled(true);
  await handle.pretranslateAll({
    onProgress: (p) => { lastStatus = p.status; },
  });
  assert.equal(calls, 0, "全部命中缓存不应调用翻译");
  assert.equal(lastStatus, "done");
});

test("pretranslate: 批次携带 ctxBefore（前文参考不丢失）", async () => {
  const doc = makeDoc("<p>第一段</p><p>第二段</p><p>第三段</p>");
  let receivedCtx = null;
  const handle = createBilingualV2({
    bookId: "pt-ctx-1",
    getContents: () => [doc],
    translateBatch: async (_texts, _f, _t, _b, ctx) => {
      receivedCtx = ctx;
      return ["译:a", "译:b", "译:c"];
    },
    from: "auto",
    to: "zh",
  });
  handle.setEnabled(true);
  await handle.pretranslateAll();
  assert.ok(Array.isArray(receivedCtx), "预翻译也必须传 ctxBefore");
  assert.equal(receivedCtx[0], null);
  assert.ok(receivedCtx[1] && receivedCtx[1].includes("第一段"), "第二段前文含第一段");
});
