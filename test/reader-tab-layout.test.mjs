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

// 2026-08-24 方案 C：把阅读器常规层的 z-index 压到远低于思源顶栏"管理"菜单
// （菜单 z-index 通常 200+），避免阅读器层压住思源原生 UI。
//
// 2026-09 修正阈值：原「全部 ≤ 3」在新增任何代码之前就已失效 —— 阅读器陆续引入了
//   .reword-pt-overlay 60 / .reword-pt-floating 61（预翻译固定定位模态）、
//   .reader-footnote 100（脚注气泡）、.reader-bottom-bar 5 / .reader-bottom-handle 7
//   （2026-08-30 底部药丸条改造）、.reader-note-editor 4、.pdf-rect-capture 7（PDF 框选捕获层）。
// 这些值本身仍远低于思源顶栏菜单（200+），不构成遮挡，属合理实现；真正例外只有
// .reader-debug-hud = 2147483647 —— 它是 `{#if DEBUG_READER}` 下的诊断浮层，非业务 UI。
// 处置：常规层阈值放宽到 100（保留「不压住思源原生 UI」的原始意图，并对 100 以上的
// 新层留出告警余量），调试 HUD 走显式豁免；**不**把阈值抬到 2^31-1，否则断言彻底失去意义。
const MAX_READER_Z = 100;
const DEBUG_HUD_Z = 2147483647;
// 注释中的 "z-index 从 50 降到 1" 之类不含 "z-index: N" 格式，不会被误判。
const readerZMatches = [...viewSrc.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
test("阅读器常规层 z-index 均 ≤ 100（调试 HUD 为唯一豁免）", () => {
  assert.ok(readerZMatches.length > 0, "应能提取到至少一个 z-index");
  const overs = readerZMatches.filter((z) => z > MAX_READER_Z && z !== DEBUG_HUD_Z);
  assert.equal(
    overs.length,
    0,
    `阅读器常规层 z-index 应 ≤ ${MAX_READER_Z}（思源顶栏菜单 200+），越界值：${overs.join(", ")}`
  );
  // 豁免值只应出现在 .reader-debug-hud（DEBUG_READER 诊断浮层）
  const hud = stripCssComments(viewSrc.match(/\.reader-debug-hud\s*\{[^}]+\}/s)?.[0] ?? "");
  assert.match(hud, new RegExp(`z-index:\\s*${DEBUG_HUD_Z}`), `${DEBUG_HUD_Z} 只应出现在 .reader-debug-hud`);
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
  const rectCapture = grab("pdf-rect-capture");
  assert.match(toolbar, /z-index:\s*1\b/, ".reader-toolbar z-index 应为 1");
  assert.match(floating, /z-index:\s*2\b/, ".reader-floating-layer z-index 应为 2");
  assert.match(popover, /z-index:\s*2\b/, ".reader-popover z-index 应为 2");
  // 2026-09 更新：底栏 2026-08-30 改为「移出文档流 + 底部滑入」药丸条，需浮在 foliate
  // 内容层之上 → z-index 由 1 升到 5（仍远低于思源顶栏菜单 200+）。
  assert.match(bottom, /z-index:\s*5\b/, ".reader-bottom-bar z-index 应为 5");
  // 2026-09-09 P1：PDF 矩形框选捕获层，只需压住 PDF 画布内的进度条（5），取 7。
  assert.match(rectCapture, /z-index:\s*7\b/, ".pdf-rect-capture z-index 应为 7");
});
