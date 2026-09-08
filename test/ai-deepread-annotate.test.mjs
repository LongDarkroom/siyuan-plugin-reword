/**
 * 第 5 批 · 逐句批注按钮渲染回归（2026-09-06）。
 * 覆盖 renderDeepReadHtml 的 annotate 选项：
 *  - annotate=true  → 每条句子块内含「批注到原文」按钮（data-sent-idx 供面板回查）
 *  - annotate 缺省/false → 不渲染该按钮
 *
 * 不依赖 Lute（Node 无 window.Lute，渲染层走 renderMarkdown 兜底，句子块为纯 HTML 串）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { renderDeepReadHtml } from "../src/ai/ai-render.ts";

function makeResult() {
  return {
    ok: true,
    isJson: true,
    sentences: [
      { sentence: "The quick brown fox", structure: "SVC", translation: "敏捷的棕狐" },
      { sentence: "jumps over the lazy dog", structure: "VP", translation: "跳过懒狗" },
    ],
    words: [],
    raw: "",
  };
}

test("annotate=true：每条句子下渲染「批注到原文」按钮", () => {
  const html = renderDeepReadHtml(makeResult(), { annotate: true });
  const btns = html.match(/class="hiword-ai-anno[^"]*"/g) || [];
  assert.equal(btns.length, 2, "应有两个句子各一个批注按钮");
  assert.ok(html.includes('data-sent-idx="0"'), "第一句按钮携带 sent-idx=0");
  assert.ok(html.includes('data-sent-idx="1"'), "第二句按钮携带 sent-idx=1");
  assert.ok(html.includes("批注到原文"), "按钮文案正确");
});

test("annotate 缺省：不渲染批注按钮", () => {
  const html = renderDeepReadHtml(makeResult());
  assert.equal(html.includes("hiword-ai-anno"), false, "未开启时不应出现批注按钮");
});

test("annotate=false：不渲染批注按钮", () => {
  const html = renderDeepReadHtml(makeResult(), { annotate: false });
  assert.equal(html.includes("hiword-ai-anno"), false, "显式关闭时不应出现批注按钮");
});
