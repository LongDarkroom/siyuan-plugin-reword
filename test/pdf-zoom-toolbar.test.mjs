/**
 * PDF 缩放 Phase 2 · 测试 5: 工具栏 UI（缩放按钮组）
 * ----------------------------------------------------------------
 * 覆盖：
 *  - 工具栏在 isPdfBook() 块内含 .reader-zoom-group
 *  - 5 个按钮：- / + / ↔ / ⊡ + 百分比 label
 *  - 按钮事件绑到 zoomOut / zoomIn / fitWidth / fitPage
 *  - 缩放按钮组 CSS .reader-zoom-group / .reader-zoom-btn / .reader-zoom-label
 *
 * 不依赖：foliate / siyuan SDK
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const src = readFileSync(viewPath, "utf-8");
// 2026-09-02 重构：缩放按钮组从 ReaderView 拆到 PdfToolbar.svelte（事件改为 onZoomXxx 回调 prop），
// 配套 CSS 在 reader-controls.less。ReaderView 只保留挂载点与百分比的传入。
const toolbarPath = join(__dirname, "..", "src", "reader", "PdfToolbar.svelte");
const tbSrc = readFileSync(toolbarPath, "utf-8");
const cssPath = join(__dirname, "..", "src", "reader", "reader-controls.less");
const cssSrc = readFileSync(cssPath, "utf-8");

test("[核心] 工具栏在 PDF 模式下显示缩放按钮组", () => {
  // ReaderView 按 readerMode 分流，PDF 分支挂载 <PdfToolbar />
  assert.ok(/\{#if\s+readerMode\s*===\s*["']pdf["']\s*\}/.test(src), "工具栏应用 {#if readerMode === 'pdf'} 挂载缩放组");
  assert.ok(/<PdfToolbar/.test(src), "ReaderView 应挂载 <PdfToolbar />");
  assert.ok(/<span\s+class="reader-zoom-group"/.test(tbSrc), "PdfToolbar 应含 .reader-zoom-group 容器");
});

test("[按钮] 缩放组有 - 按钮（缩小）", () => {
  // 找 − 按钮 + on:click={onZoomOut}（组件内回调 prop 名带 on 前缀）
  assert.ok(
    /title="缩小[\s\S]*?on:click=\{onZoomOut\}/.test(tbSrc) || /on:click=\{onZoomOut\}[\s\S]*?title="缩小/.test(tbSrc),
    "应含缩小按钮（on:click={onZoomOut}）"
  );
  assert.ok(/onZoomOut=\{zoomOut\}/.test(src), "ReaderView 应把 zoomOut 传给 PdfToolbar");
});

test("[按钮] 缩放组有 + 按钮（放大）", () => {
  assert.ok(
    /title="放大[\s\S]*?on:click=\{onZoomIn\}/.test(tbSrc) || /on:click=\{onZoomIn\}[\s\S]*?title="放大/.test(tbSrc),
    "应含放大按钮（on:click={onZoomIn}）"
  );
  assert.ok(/onZoomIn=\{zoomIn\}/.test(src), "ReaderView 应把 zoomIn 传给 PdfToolbar");
});

test("[按钮] 缩放组有 ↔ 按钮（适应宽度）", () => {
  assert.ok(
    /title="适应宽度[\s\S]*?on:click=\{onFitWidth\}/.test(tbSrc) || /on:click=\{onFitWidth\}[\s\S]*?title="适应宽度/.test(tbSrc),
    "应含适应宽度按钮（on:click={onFitWidth}）"
  );
  assert.ok(/onFitWidth=\{fitWidth\}/.test(src), "ReaderView 应把 fitWidth 传给 PdfToolbar");
});

test("[按钮] 缩放组有 ⊡ 按钮（适应整页）", () => {
  assert.ok(
    /title="适应整页[\s\S]*?on:click=\{onFitPage\}/.test(tbSrc) || /on:click=\{onFitPage\}[\s\S]*?title="适应整页/.test(tbSrc),
    "应含适应整页按钮（on:click={onFitPage}）"
  );
  assert.ok(/onFitPage=\{fitPage\}/.test(src), "ReaderView 应把 fitPage 传给 PdfToolbar");
});

test("[核心] 百分比 label 实时显示（绑 zoomPercentLabel()）", () => {
  // PdfToolbar 内渲染 zoomLabel prop，ReaderView 把 zoomPercentLabel() 传进去
  assert.ok(
    /class="reader-zoom-label"\s*>\s*\{zoomLabel\}/.test(tbSrc),
    "PdfToolbar 应渲染 {zoomLabel} 百分比"
  );
  assert.ok(
    /zoomLabel=\{zoomPercentLabel\(\)\}/.test(src),
    "ReaderView 应把 zoomPercentLabel() 实时传给 PdfToolbar"
  );
});

test("[CSS] 缩放组 .reader-zoom-group / .reader-zoom-btn / .reader-zoom-label 样式", () => {
  // CSS 随工具栏一起搬到 reader-controls.less
  assert.ok(/\.reader-zoom-group\s*\{/.test(cssSrc), "应有 .reader-zoom-group CSS");
  assert.ok(/\.reader-zoom-btn\s*\{/.test(cssSrc), "应有 .reader-zoom-btn CSS");
  assert.ok(/\.reader-zoom-label\s*\{/.test(cssSrc), "应有 .reader-zoom-label CSS");
});

test("[布局] 缩放组 border-left 分隔，与其他工具栏按钮区分", () => {
  const cssMatch = cssSrc.match(/\.reader-zoom-group\s*\{([\s\S]*?)\}/);
  assert.ok(cssMatch, ".reader-zoom-group CSS 应存在");
  const css = cssMatch[1];
  assert.ok(/border-left/.test(css), "应有 border-left 视觉分隔");
});

test("[回归] 工具栏其他按钮（搜索/设置/双语）保留", () => {
  // 现有的 reader-btn 应仍存在
  // 2026-09-11 i18n：title 改为 title={t("…")} 模板插值，断言放宽为「两种形态都接受」。
  assert.ok(/class="reader-btn[\s\S]*?title=(?:\{t\()?"搜索/.test(src), "搜索按钮保留");
  assert.ok(/title=(?:\{t\()?"设置"/.test(src), "设置按钮保留");
  assert.ok(/toggleBilingual/.test(src), "双语按钮保留");
});
