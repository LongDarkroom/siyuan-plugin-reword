/**
 * Phase 3：术语表 + 段落级「用 AI 重译」入口（2026-08-31）
 *
 * 术语表覆盖：
 *  - 增删改 → version 递增（version 并入缓存 salt 使旧译文失效）
 *  - toPromptBlock 格式；空表返回空串（不占 token）
 *  - apply 译后替换：大小写、正则转义、src===dst 幂等
 *  - 与 TranslationCache 集成：术语表版本变化 → 旧译文不命中
 *
 * AI 重译入口覆盖：
 *  - 按钮仅在 showAiRedo 时渲染，且带 cfi-inert
 *  - doc 级事件委托：点按钮能拿到译文块与原文文本；重复绑定不重复触发
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { GlossaryStore } from "../src/translate/glossary.ts";
import { TranslationCache } from "../src/translate/cache.ts";
import {
  REWORD_BILINGUAL_AI_REDO,
  bindAiRedoDelegation,
  buildTranslationEl,
} from "../src/reader/bilingual-v2/render.ts";

function makeStore() {
  const saved = [];
  const s = new GlossaryStore((d) => saved.push(JSON.parse(JSON.stringify(d))));
  return { s, saved };
}

/* ==================== 版本失效 ==================== */

test("glossary: 新增/删除/修改都会让 version 递增", () => {
  const { s } = makeStore();
  assert.equal(s.version, 0);

  s.add({ src: "Lute", dst: "Lute" });
  assert.equal(s.version, 1, "add 后应 +1");

  s.add({ src: "SiYuan", dst: "思源笔记" });
  assert.equal(s.version, 2);

  s.removeAt(0);
  assert.equal(s.version, 3, "remove 后应 +1");

  s.updateAt(0, { src: "SiYuan", dst: "思源" });
  assert.equal(s.version, 4, "update 后应 +1");
});

test("glossary: 空表时 clear 不触发版本变化（避免无谓失效）", () => {
  const { s } = makeStore();
  s.clear();
  assert.equal(s.version, 0);
});

/* ==================== prompt 注入 ==================== */

test("glossary: 空表 toPromptBlock 返回空串（不浪费 token）", () => {
  const { s } = makeStore();
  assert.equal(s.toPromptBlock(), "");
});

test("glossary: toPromptBlock 列出「原文 → 译法」", () => {
  const { s } = makeStore();
  s.add({ src: "Lute", dst: "Lute" });
  s.add({ src: "SiYuan", dst: "思源笔记" });
  const block = s.toPromptBlock();
  assert.ok(block.includes("- Lute → Lute"), block);
  assert.ok(block.includes("- SiYuan → 思源笔记"), block);
  assert.ok(block.includes("术语表"), "应有术语表标题");
});

/* ==================== 译后替换 ==================== */

test("glossary: apply 把译文里残留的原文术语换成指定译法", () => {
  const { s } = makeStore();
  s.add({ src: "SiYuan", dst: "思源笔记" });
  assert.equal(s.apply("这是一个 SiYuan 插件"), "这是一个 思源笔记 插件");
});

test("glossary: apply 默认忽略大小写", () => {
  const { s } = makeStore();
  s.add({ src: "SiYuan", dst: "思源笔记" });
  assert.equal(s.apply("siyuan 与 SIYUAN"), "思源笔记 与 思源笔记");
});

test("glossary: caseSensitive=true 时区分大小写", () => {
  const { s } = makeStore();
  s.add({ src: "SiYuan", dst: "思源笔记", caseSensitive: true });
  assert.equal(s.apply("siyuan 保持原样"), "siyuan 保持原样");
  assert.equal(s.apply("SiYuan 被替换"), "思源笔记 被替换");
});

test("glossary: 术语含正则元字符不会抛错", () => {
  const { s } = makeStore();
  s.add({ src: "C++ (v2)", dst: "C加加" });
  assert.equal(s.apply("使用 C++ (v2) 编写"), "使用 C加加 编写");
});

test("glossary: src===dst（保留原文）时替换幂等", () => {
  const { s } = makeStore();
  s.add({ src: "Lute", dst: "Lute" });
  assert.equal(s.apply("Lute 是一个工具"), "Lute 是一个工具");
});

test("glossary: 空表时 apply 原样返回（零开销）", () => {
  const { s } = makeStore();
  assert.equal(s.apply("任意文本"), "任意文本");
});

/* ==================== 与缓存集成：改术语触发重译 ==================== */

test("cache: 术语表版本并入 salt 后，旧译文不再命中", async () => {
  const store = new Map();
  const plugin = {
    async loadData(p) { return store.get(p); },
    async saveData(p, v) { store.set(p, v); },
  };
  const gv = { v: 0 };
  const c = new TranslationCache(plugin, () => {
    // 模拟上层：只有 version>0 且术语表非空才并入
    return gv.v > 0 ? `base|g${gv.v}` : "base";
  });

  await c.setBatch("b1", [["hello", "你好"]]);
  const before = await c.getBatch("b1", ["hello"]);
  assert.equal(before.hits[0], "你好", "术语表变更前应命中");

  gv.v = 1; // 改了术语表
  const after = await c.getBatch("b1", ["hello"]);
  assert.equal(after.hits[0], undefined, "术语表变更后旧译文应失效");
  assert.deepEqual(after.misses, [0]);
});

/* ==================== AI 重译按钮 ==================== */

test("render: showAiRedo 时才渲染「用 AI 重译」按钮", () => {
  const doc = new JSDOM("<!DOCTYPE html><body></body>").window.document;
  const on = buildTranslationEl(doc, "译文", { showAiRedo: true });
  assert.ok(on.querySelector("." + REWORD_BILINGUAL_AI_REDO), "开启时应渲染按钮");

  const off = buildTranslationEl(doc, "译文", { showAiRedo: false });
  assert.equal(off.querySelector("." + REWORD_BILINGUAL_AI_REDO), null, "关闭时不应渲染");
});

test("render: 重译按钮带 cfi-inert（不污染 CFI）", () => {
  const doc = new JSDOM("<!DOCTYPE html><body></body>").window.document;
  const el = buildTranslationEl(doc, "译文", { showAiRedo: true });
  const btn = el.querySelector("." + REWORD_BILINGUAL_AI_REDO);
  assert.equal(btn.getAttribute("cfi-inert"), "");
  assert.equal(btn.getAttribute("data-action"), "ai-redo");
});

test("render: 点击重译按钮能拿到译文块与原文文本", () => {
  const dom = new JSDOM('<!DOCTYPE html><body><p>原文段落</p></body>');
  const doc = dom.window.document;
  const p = doc.querySelector("p");
  const el = buildTranslationEl(doc, "译文文本", { showAiRedo: true });
  p.insertAdjacentElement("afterend", el);

  const calls = [];
  bindAiRedoDelegation(doc, (wrap, text) => calls.push({ wrap, text }));

  const btn = el.querySelector("." + REWORD_BILINGUAL_AI_REDO);
  btn.click();

  assert.equal(calls.length, 1, "应触发一次");
  assert.equal(calls[0].text, "原文段落", "应取到紧邻的前一个兄弟（原文）文本");
  assert.equal(calls[0].wrap, el);
});

test("render: 重复绑定委托不会重复触发", () => {
  const dom = new JSDOM('<!DOCTYPE html><body><p>原文</p></body>');
  const doc = dom.window.document;
  const p = doc.querySelector("p");
  const el = buildTranslationEl(doc, "译文", { showAiRedo: true });
  p.insertAdjacentElement("afterend", el);

  let n = 0;
  bindAiRedoDelegation(doc, () => n++);
  bindAiRedoDelegation(doc, () => n++); // 幂等，应被忽略

  el.querySelector("." + REWORD_BILINGUAL_AI_REDO).click();
  assert.equal(n, 1, "绑定两次仍只应触发一次");
});

test("render: 点击译文文字（非按钮）不触发重译", () => {
  const dom = new JSDOM('<!DOCTYPE html><body><p>原文</p></body>');
  const doc = dom.window.document;
  const p = doc.querySelector("p");
  const el = buildTranslationEl(doc, "译文", { showAiRedo: true });
  p.insertAdjacentElement("afterend", el);

  let n = 0;
  bindAiRedoDelegation(doc, () => n++);
  el.querySelector(".reword-bilingual-text").click();
  assert.equal(n, 0, "点译文文字不应触发");
});
