// 阅读器 Tab 布局测试（2026-08-24 新增，方案 B）
// ------------------------------------------------------------
// 用户反馈：阅读 Tab 激活时，思源顶栏"管理"菜单中的 RE word 设置按钮
// 无法 hover/点击；普通思源文档 Tab 正常。
//
// 根因：reader-tab.ts 创建的 holder 使用 position:absolute; inset:0，
// 撑满整个 custom.element，成为覆盖层的命中拦截层；即使子元素 z-index
// 正确，菜单弹出在该 holder 同一 stacking context 时，鼠标事件仍被 holder
// 拦截。方案 A（给 .reader-view 加 pointer-events:none）失败原因同理：
// holder 本身仍是拦截层。
//
// 修复（方案 B）：
//   1. reader-tab.ts 的 holder 改为相对 flex 子项：
//      position:relative; flex:1; min-height:0; display:flex; flex-direction:column
//   2. ReaderView.svelte 的 .reader-view 去掉 position:absolute; inset:0，
//      改为 position:relative; flex:1; min-height:0
//
// 覆盖：
// - holder 不再使用 "position:absolute" 或 "inset:0"
// - .reader-view 不再使用 "position:absolute" 或 "inset:0"
// - .reader-view 不使用 pointer-events:none（方案 A 残留清理）

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const tabPath = join(__dirname, "..", "src", "reader", "reader-tab.ts");
const viewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const tabSrc = readFileSync(tabPath, "utf-8");
const viewSrc = readFileSync(viewPath, "utf-8");

const holderCssText = tabSrc.match(/holder\.style\.cssText\s*=\s*"([^"]+)"/)?.[1] ?? "";
const readerViewBlockRaw = viewSrc.match(/\.reader-view\s*\{[^}]+\}/s)?.[0] ?? "";
// 去掉 CSS 注释，避免注释中的 "position:absolute" / "inset:0" 被误判
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const readerViewBlock = stripCssComments(readerViewBlockRaw);

test("reader-tab holder 不使用 absolute inset:0 撑满", () => {
  assert.ok(holderCssText, "应能提取 holder 的 cssText");
  assert.doesNotMatch(holderCssText, /position:\s*absolute/, "holder 不应使用 position:absolute");
  assert.doesNotMatch(holderCssText, /inset:\s*0/, "holder 不应使用 inset:0");
  assert.match(holderCssText, /position:\s*relative/, "holder 应使用 position:relative");
  assert.match(holderCssText, /flex:\s*1/, "holder 应使用 flex:1 撑满父容器");
  assert.match(holderCssText, /min-height:\s*0/, "holder 应有 min-height:0 避免 flex 溢出");
});

test("ReaderView .reader-view 不使用 absolute inset:0", () => {
  assert.ok(readerViewBlock, "应能提取 .reader-view 样式块");
  assert.doesNotMatch(readerViewBlock, /position:\s*absolute/, ".reader-view 不应使用 position:absolute");
  assert.doesNotMatch(readerViewBlock, /inset:\s*0/, ".reader-view 不应使用 inset:0");
  assert.match(readerViewBlock, /position:\s*relative/, ".reader-view 应使用 position:relative");
  assert.match(readerViewBlock, /flex:\s*1/, ".reader-view 应使用 flex:1");
  assert.match(readerViewBlock, /min-height:\s*0/, ".reader-view 应有 min-height:0");
});

test("方案 A 的 pointer-events:none 已被清理（避免残留导致子层无法交互）", () => {
  assert.doesNotMatch(readerViewBlock, /pointer-events:\s*none/, ".reader-view 不应保留 pointer-events:none");
});

test("reader-backdrop 仍相对于 .reader-view 且避开 toolbar 区域", () => {
  const backdropBlockRaw = viewSrc.match(/\.reader-backdrop\s*\{[^}]+\}/s)?.[0] ?? "";
  const backdropBlock = stripCssComments(backdropBlockRaw);
  assert.ok(backdropBlock, "应能提取 .reader-backdrop 样式块");
  assert.match(backdropBlock, /position:\s*absolute/, ".reader-backdrop 仍需 absolute 定位");
  assert.match(backdropBlock, /top:\s*34px/, ".reader-backdrop 仍需 top:34px 避开 toolbar");
});

// 2026-08-24 方案 C：把所有阅读器内部 z-index 压到 ≤3，
// 避免阅读器层压住思源顶栏"管理"菜单（菜单 z-index 通常 200+）。
// 注释中的 "z-index 从 50 降到 1" 之类不含 "z-index: N" 格式，不会被误判。
const MAX_READER_Z = 3;
const readerZMatches = [...viewSrc.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
test("阅读器内部所有 z-index 均 ≤ 3（不压住思源原生 UI）", () => {
  assert.ok(readerZMatches.length > 0, "应能提取到至少一个 z-index");
  for (const z of readerZMatches) {
    assert.ok(
      z <= MAX_READER_Z,
      `阅读器内部 z-index 应 ≤ ${MAX_READER_Z}，实际发现 ${z}（会压住思源顶栏菜单）`
    );
  }
});

test("关键层 z-index 为预期小值", () => {
  const grab = (sel) => {
    const raw = viewSrc.match(new RegExp(`\\.${sel}\\s*\\{[^}]+\\}`))?.[0] ?? "";
    return stripCssComments(raw);
  };
  const toolbar = grab("reader-toolbar");
  const floating = grab("reader-floating-layer");
  const popover = grab("reader-popover");
  const bottom = grab("reader-bottom-bar");
  assert.match(toolbar, /z-index:\s*1\b/, ".reader-toolbar z-index 应为 1");
  assert.match(floating, /z-index:\s*2\b/, ".reader-floating-layer z-index 应为 2");
  assert.match(popover, /z-index:\s*2\b/, ".reader-popover z-index 应为 2");
  assert.match(bottom, /z-index:\s*1\b/, ".reader-bottom-bar z-index 应为 1");
});
