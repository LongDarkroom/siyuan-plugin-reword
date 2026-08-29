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

test("[核心] 工具栏在 PDF 模式下显示缩放按钮组", () => {
  // 找 {#if isPdfBook()} 块
  assert.ok(/\{#if\s+isPdfBook\(\)\s*\}/.test(src), "工具栏应用 {#if isPdfBook()} 包裹缩放组");
  assert.ok(/<span\s+class="reader-zoom-group"/.test(src), "应含 .reader-zoom-group 容器");
});

test("[按钮] 缩放组有 - 按钮（缩小）", () => {
  // 找 − 按钮 + on:click={zoomOut}
  assert.ok(
    /title="缩小[\s\S]*?on:click=\{zoomOut\}/.test(src) || /on:click=\{zoomOut\}[\s\S]*?title="缩小/.test(src),
    "应含缩小按钮（on:click={zoomOut}）"
  );
});

test("[按钮] 缩放组有 + 按钮（放大）", () => {
  assert.ok(
    /title="放大[\s\S]*?on:click=\{zoomIn\}/.test(src) || /on:click=\{zoomIn\}[\s\S]*?title="放大/.test(src),
    "应含放大按钮（on:click={zoomIn}）"
  );
});

test("[按钮] 缩放组有 ↔ 按钮（适应宽度）", () => {
  assert.ok(
    /title="适应宽度[\s\S]*?on:click=\{fitWidth\}/.test(src) || /on:click=\{fitWidth\}[\s\S]*?title="适应宽度/.test(src),
    "应含适应宽度按钮（on:click={fitWidth}）"
  );
});

test("[按钮] 缩放组有 ⊡ 按钮（适应整页）", () => {
  assert.ok(
    /title="适应整页[\s\S]*?on:click=\{fitPage\}/.test(src) || /on:click=\{fitPage\}[\s\S]*?title="适应整页/.test(src),
    "应含适应整页按钮（on:click={fitPage}）"
  );
});

test("[核心] 百分比 label 实时显示（绑 zoomPercentLabel()）", () => {
  // 找 .reader-zoom-label + {zoomPercentLabel()}
  assert.ok(
    /class="reader-zoom-label"\s*>\s*\{zoomPercentLabel\(\)\}/.test(src),
    "缩放组应实时显示当前缩放百分比（{zoomPercentLabel()}）"
  );
});

test("[CSS] 缩放组 .reader-zoom-group / .reader-zoom-btn / .reader-zoom-label 样式", () => {
  assert.ok(/\.reader-zoom-group\s*\{/.test(src), "应有 .reader-zoom-group CSS");
  assert.ok(/\.reader-zoom-btn\s*\{/.test(src), "应有 .reader-zoom-btn CSS");
  assert.ok(/\.reader-zoom-label\s*\{/.test(src), "应有 .reader-zoom-label CSS");
});

test("[布局] 缩放组 border-left 分隔，与其他工具栏按钮区分", () => {
  const cssMatch = src.match(/\.reader-zoom-group\s*\{([\s\S]*?)\}/);
  assert.ok(cssMatch, ".reader-zoom-group CSS 应存在");
  const css = cssMatch[1];
  assert.ok(/border-left/.test(css), "应有 border-left 视觉分隔");
});

test("[回归] 工具栏其他按钮（搜索/设置/双语）保留", () => {
  // 现有的 reader-btn 应仍存在
  assert.ok(/class="reader-btn[\s\S]*?title="搜索/.test(src), "搜索按钮保留");
  assert.ok(/title="设置"/.test(src), "设置按钮保留");
  assert.ok(/toggleBilingual/.test(src), "双语按钮保留");
});
