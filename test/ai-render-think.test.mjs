import test from "node:test";
import assert from "node:assert/strict";
import { renderDeepReadHtml } from "../src/ai/ai-render.ts";

/**
 * renderDeepReadHtml 思考过程面板回归测试（2026-08-19 #73/#75）。
 * 任务要求：thinking 折叠面板「默认展开 + 清晰布局」，可点击收起。
 * 关键断言：含 thinking 时输出 `<details class="hiword-ai-think" open>`（open 属性 = 默认展开）。
 */

function chatResult(overrides = {}) {
  return {
    ok: true,
    isJson: false,
    mode: "chat",
    words: [],
    sentences: [],
    raw: "hello **world**",
    ...overrides,
  };
}

test("renderDeepReadHtml：chat 模式含 thinking → 输出默认展开的思考面板", () => {
  const html = renderDeepReadHtml(chatResult({ thinking: "先锁定核心词，再组织讲解。" }));
  assert.ok(html.includes('<details class="hiword-ai-think" open>'), "应默认展开（含 open 属性）");
  assert.ok(html.includes("AI 思考过程（点击收起）"), "摘要文字应为「点击收起」（暗示展开态）");
  assert.ok(html.includes("先锁定核心词，再组织讲解。"), "思考内容应被转义输出");
});

test("renderDeepReadHtml：chat 模式无 thinking → 不输出思考面板", () => {
  const html = renderDeepReadHtml(chatResult({ thinking: undefined }));
  assert.ok(!html.includes("hiword-ai-think"), "无 thinking 时不应渲染面板");
});

test("renderDeepReadHtml：chat 模式空 thinking → 不输出思考面板", () => {
  const html = renderDeepReadHtml(chatResult({ thinking: "   " }));
  assert.ok(!html.includes("hiword-ai-think"), "空 thinking 不应渲染面板");
});

test("renderDeepReadHtml：thinking 内容 HTML 特殊字符被转义（防注入）", () => {
  const html = renderDeepReadHtml(chatResult({ thinking: "<script>alert(1)</script>" }));
  assert.ok(!html.includes("<script>"), "思考内容中的 <script> 应被转义");
  assert.ok(html.includes("&lt;script&gt;"), "应输出转义后的实体");
});
