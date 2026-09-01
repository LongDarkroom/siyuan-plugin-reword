/**
 * bilingual-v2 渲染层回归测试（2026-08-31 Phase 0 + Phase 1）
 *
 * Phase 0（P0）：译文节点必须带 cfi-inert。
 *   foliate 内核只认 cfi-inert / cfi-skip（epubcfi.js:194、paginator.js:467、
 *   overlayer.js:96），不认 data-translation-mark。缺了它译文会占据父容器下的
 *   CFI 索引位，导致后续兄弟段落的 CFI 全部偏移 → 标注/高亮/书签错位。
 *
 * Phase 1：译文富文本渲染（lute 美化层）。
 *   纯译文走 textContent；含 Markdown 结构或空行分段的译文走 mdToHtml。
 *   测试环境无思源 Lute，因此走 mdToHtml 的降级分支（转义 + <br>），
 *   正好可以同时验证「降级路径不会引入 XSS」。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildTranslationEl, buildFailedEl } from "../src/reader/bilingual-v2/render.ts";

function makeDoc() {
  return new JSDOM("<!DOCTYPE html><body></body>").window.document;
}

/* ==================== Phase 0：cfi-inert ==================== */

test("render: 译文块必须带 cfi-inert（否则污染 CFI 索引）", () => {
  const doc = makeDoc();
  const el = buildTranslationEl(doc, "这是一段译文");
  assert.equal(el.getAttribute("cfi-inert"), "", "译文块缺 cfi-inert 会导致后续段落 CFI 偏移");
});

test("render: 译文块同时保留 data-translation-mark（v2 幂等依赖它）", () => {
  const doc = makeDoc();
  const el = buildTranslationEl(doc, "译文");
  assert.equal(el.getAttribute("data-translation-mark"), "1");
});

test("render: 失败占位块同样带 cfi-inert", () => {
  const doc = makeDoc();
  const el = buildFailedEl(doc);
  assert.equal(el.getAttribute("cfi-inert"), "");
  assert.equal(el.getAttribute("data-translation-mark"), "1");
});

/* ==================== Phase 1：纯译文 vs 富文本 ==================== */

test("render: 纯单段译文走 textContent（不经过 Markdown 渲染）", () => {
  const doc = makeDoc();
  const el = buildTranslationEl(doc, "这是一段普通译文，没有任何 Markdown 特征。");
  const span = el.querySelector(".reword-bilingual-text");
  assert.equal(span.textContent, "这是一段普通译文，没有任何 Markdown 特征。");
  // 未走 lute → 内部只有文本节点，不应出现 <br>
  assert.equal(span.querySelector("br"), null, "纯译文不应产生换行元素");
});

test("render: 含空行分段的长译文走 lute 渲染路径", () => {
  const doc = makeDoc();
  const el = buildTranslationEl(doc, "第一段译文。\n\n第二段译文。");
  const span = el.querySelector(".reword-bilingual-text");
  // 无 Lute 时降级为「转义 + <br>」，据此可断言确实走了富文本分支
  assert.ok(span.querySelector("br"), "多段译文应走 innerHTML 渲染路径");
  assert.ok(span.textContent.includes("第一段译文"), "内容不应丢失");
  assert.ok(span.textContent.includes("第二段译文"), "内容不应丢失");
});

test("render: 含 Markdown 列表的译文走 lute 渲染路径", () => {
  const doc = makeDoc();
  const el = buildTranslationEl(doc, "- 义项一\n- 义项二");
  const span = el.querySelector(".reword-bilingual-text");
  // 降级路径把 \n 转成 <br>，据此判断走了 innerHTML 分支
  assert.ok(span.querySelector("br"), "Markdown 译文应走 innerHTML 渲染路径");
  assert.ok(span.textContent.includes("义项一"));
});

/* ==================== 安全：译文是不可信输入 ==================== */

test("render: 译文含 HTML 标签时不产生真实元素（XSS 防护）", () => {
  const doc = makeDoc();
  const evil = '<img src=x onerror="alert(1)">';
  const el = buildTranslationEl(doc, evil);
  const span = el.querySelector(".reword-bilingual-text");
  assert.equal(span.querySelector("img"), null, "译文中的 img 不应成为真实元素");
  assert.ok(span.textContent.includes("onerror"), "内容应作为纯文本保留");
});

test("render: 多段译文中夹带脚本也不产生 script 元素", () => {
  const doc = makeDoc();
  const el = buildTranslationEl(doc, "上段。\n\n<script>alert(1)</script>\n\n下段。");
  const span = el.querySelector(".reword-bilingual-text");
  assert.equal(span.querySelector("script"), null, "不应产生 script 元素");
});

/* ==================== 徽标已删除：保持阅读界面干净 ==================== */

test("render: 不再渲染任何来源徽标", () => {
  const doc = makeDoc();
  const el = buildTranslationEl(doc, "译文");
  assert.equal(el.querySelector(".reword-bilingual-badge"), null, "应删除来源徽标");
});
