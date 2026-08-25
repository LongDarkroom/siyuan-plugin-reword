/**
 * 鲸鱼批注弹窗 HTML 模板单测（2026-08-17 简化版更新）。
 * 验证：已选原文只显示 selectedText、批注内容默认空、编辑态预填 note、
 * 无 Tab / 无 mini 工具栏 / 无底部复制按钮、框架样式默认折叠等。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildWhaleDialogHtml } from "../src/annotation/whale-manager.ts";

// 简易 esc（与 whale-manager 的 escHtml 同语义）
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

test("弹窗 HTML：已选原文区只显示 selectedText，不显示整句 sentence（2026-08-15 改造）", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "mastery",
    sentence: "全文生词标注：扫描当前文档，高亮词库中 mastery 低的词",
    blockId: "b1",
    docId: "d1",
  }, esc);
  const visibleSource = html.match(/whale-dlg-source-text[^>]*>([^<]+)</)?.[1] || "";
  assert.equal(visibleSource.trim(), "mastery", "可见的已选原文区应只显示 mastery（不含整句上下文）");
  assert.ok(!visibleSource.includes("全文生词标注"), "可见区域不应展示整句上下文");
});

test("弹窗 HTML：批注内容默认空白，不预填 selectedText", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "mastery",
    sentence: "mastery in sentence",
    blockId: "b1",
    docId: "d1",
  }, esc);
  const editorMatch = html.match(/id="whale-dlg-editor"[\s\S]*?>([\s\S]*?)<\/div>/);
  assert.ok(editorMatch, "应能找到编辑器元素");
  assert.ok(!editorMatch[1].trim(), "默认批注内容应为空");
});

test("弹窗 HTML：编辑态时批注内容预填 existing.note", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "mastery",
    sentence: "mastery in sentence",
    blockId: "b1",
    docId: "d1",
    existing: {
      id: "a1", blockId: "b1", docId: "d1",
      sentence: "old", selectedText: "mastery",
      note: "我的批注：熟练度低", origin: "manual",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  }, esc);
  assert.match(html, /我的批注：熟练度低/, "编辑态应预填 existing.note");
});

test("弹窗 HTML：selectedText 空时降级显示 sentence（向后兼容）", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "",
    sentence: "fallback context",
    blockId: "b1",
    docId: "d1",
  }, esc);
  assert.match(html, /whale-dlg-source-text[^"]*">fallback context/, "无 selectedText 时降级显示 sentence");
});

test("弹窗 HTML：HTML 转义防 XSS", () => {
  const html = buildWhaleDialogHtml({
    selectedText: '<script>alert("xss")</script>',
    sentence: "<img onerror=x>",
    blockId: "b1",
    docId: "d1",
  }, esc);
  assert.doesNotMatch(html, /<script>alert/, "selectedText 应被转义");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img onerror=x>/, "sentence 应被转义");
});

test("弹窗 HTML：头部含 data-drag-handle 用于拖拽（2026-08-15 新增）", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "x", sentence: "x", blockId: "b1", docId: "d1",
  }, esc);
  assert.match(html, /data-drag-handle/, "头部应带拖拽标识");
  assert.match(html, /class="whale-dlg-head"/);
});

test("弹窗 HTML：框架样式手风琴默认展开（2026-08-18 打磨：降低首次上色心智成本）", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "word", sentence: "word", blockId: "b1", docId: "d1",
  }, esc);
  assert.match(html, /id="whale-accordion-styles"/, "应有框架样式手风琴段");
  assert.match(html, /id="whale-accordion-styles" open/, "框架样式应默认展开（含 open 属性）");
  assert.match(html, /框架样式/, "手风琴文案「框架样式」");
  // 合并后的自定义区保留高亮/线段开关
  assert.match(html, /id="whale-dlg-has-highlight"/, "应有高亮开关");
  assert.match(html, /id="whale-dlg-has-line"/, "应有线段开关");
});

test("弹窗 HTML：自定义样式含背景色 + 线段种类 + 线段颜色三行（2026-08-15）", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "x", sentence: "x", blockId: "b1", docId: "d1",
  }, esc);
  assert.match(html, /id="whale-dlg-colors"/, "应有背景色色板");
  assert.match(html, /id="whale-dlg-style-btns"/, "应有线段种类");
  assert.match(html, /id="whale-dlg-line-colors"/, "应有线段颜色色板");
  assert.match(html, /data-line-color=/, "线段颜色 swatch 带 data-line-color");
});

test("弹窗 HTML：「只上色」按钮（2026-08-18 打磨：文案更清晰）", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "x", sentence: "x", blockId: "b1", docId: "d1",
  }, esc);
  assert.match(html, /id="whale-dlg-annotate-only"/, "应有「只上色」按钮");
  assert.match(html, /只上色/, "按钮文案「只上色」");
});

test("弹窗 HTML：无快速/详细 Tab（2026-08-17 简化移除）", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "x", sentence: "x", blockId: "b1", docId: "d1",
  }, esc);
  assert.doesNotMatch(html, /whale-dlg-tab-btns/, "不应有 Tab 切换器");
  assert.doesNotMatch(html, /data-tab="quick"/, "不应有快速标注 tab");
  assert.doesNotMatch(html, /data-tab-panel/, "不应有 tab panel");
  assert.doesNotMatch(html, /whale-dlg-quick-apply/, "不应有快速标注按钮");
});

test("弹窗 HTML：无 mini 富文本工具栏（2026-08-17 简化移除，改思源原生浮动栏）", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "x", sentence: "x", blockId: "b1", docId: "d1",
  }, esc);
  assert.doesNotMatch(html, /whale-dlg-editor-toolbar/, "不应有自建工具栏");
  assert.doesNotMatch(html, /whale-dlg-toolbar/, "不应有 toolbar 容器");
  assert.doesNotMatch(html, /data-fmt="bold"/, "不应有格式按钮");
});

test("弹窗 HTML：无底部复制/粘贴格式/清除格式按钮（2026-08-17 移除，复制走原生 ⌘C）", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "x", sentence: "x", blockId: "b1", docId: "d1",
  }, esc);
  assert.doesNotMatch(html, /whale-dlg-copy/, "不应有复制按钮");
  assert.doesNotMatch(html, /whale-dlg-pastefmt/, "不应有粘贴格式按钮");
  assert.doesNotMatch(html, /whale-dlg-clearfmt/, "不应有清除格式按钮");
});

test("弹窗 HTML：无预设分组 chips（2026-08-17 合并到框架样式）", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "x", sentence: "x", blockId: "b1", docId: "d1",
  }, esc);
  assert.doesNotMatch(html, /whale-dlg-preset-chip/, "不应有预设 chips");
  assert.doesNotMatch(html, /data-preset-group=/, "不应有分组");
});

// 2026-08-22 新增：测试 isAccordionOpen 参数(修 Bug: 框架样式记忆模式失效)
test("弹窗 HTML：isAccordionOpen=true(默认)时,框架样式 details 含 open 属性", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "x", sentence: "x", blockId: "b1", docId: "d1",
  }, esc, true);
  assert.match(html, /id="whale-accordion-styles"\s+open/, "默认应带 open 属性");
});

test("弹窗 HTML：isAccordionOpen=false 时,框架样式 details 不含 open 属性(记忆模式生效)", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "x", sentence: "x", blockId: "b1", docId: "d1",
  }, esc, false);
  assert.doesNotMatch(html, /id="whale-accordion-styles"[^>]*\bopen\b/, "收起时应不带 open 属性");
  // 但 details 元素本身仍存在
  assert.match(html, /id="whale-accordion-styles"/, "details 元素本身应存在");
});

// 2026-08-22 新增：测试品牌改名 - dialog title 应为"微阅批注"
test("弹窗 HTML：dialog 标题已从「批注」改为「微阅批注」(2026-08-22 品牌改名)", () => {
  const html = buildWhaleDialogHtml({
    selectedText: "x", sentence: "x", blockId: "b1", docId: "d1",
  }, esc);
  assert.match(html, /class="whale-dlg-title">微阅批注</, "标题应为「微阅批注」");
});
