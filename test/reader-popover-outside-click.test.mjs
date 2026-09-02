// 阅读器 - Popover 点击外部收起测试（2026-08-23 修订）
// ----------------------------------------------------------------
// 用户反馈：图2/图3 中设置 / 目录 popover 关闭只能点按钮，体验繁琐。
// 期望：点击 popover 外部区域（除 toolbar 按钮）也能自动收起。
//
// 实现演进：
//   第一轮：document mousedown capture 监听。
//   第二轮修复：listener 改绑到 .reader-view 容器（readerViewEl），限定在阅读器内部，
//     不影响思源顶栏/侧栏/命令面板/dock 的点击时序（特别是"管理"菜单里的插件设置项）。
//   - target 在任一 popover 内（含子元素）→ 不动
//   - target 在 toolbar 按钮上 → 不动（让 click 触发 toggle，避免先关再开抵消）
//   - 其他 → 关闭所有 popover
//
// 不依赖：foliate / siyuan SDK
// 覆盖（grep ReaderView.svelte 文本验证关键代码）：
// - onContainerMouseDown 函数存在（onDocumentMouseDown 已移除）
// - closeAllPopovers 函数存在
// - readerViewEl.addEventListener("mousedown", onContainerMouseDown)（非 document）
// - onDestroy 从 readerViewEl 移除监听
// - 优先跳过 .reader-popover（mousedown.target.closest(".reader-popover")）
// - 跳过 .reader-toolbar（让 click 自行 toggle）
// - 关闭所有 popover: showToc / showSettings / showSearch

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const readerViewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const src = readFileSync(readerViewPath, "utf-8");

/**
 * 按花括号配对抽取函数体（含首尾花括号）。
 *
 * 为什么不用 `/function xxx[^{]*\{([\s\S]*?)\n\s*\}/` 这类正则：
 * 它在函数体里第一个「行首 }」处就会截断 —— 只要函数内出现任何内嵌块
 * （如 `if (...) { ... }`），取到的就只是前半截，后续断言全部误判。
 * 本文件的 onContainerMouseDown 正是栽在这里：函数开头有一处
 * `if (dictPopupSource === "hover" ...) { ... }` 早退块，旧正则在此收尾，
 * 导致完全读不到后半段的 .reader-popover / .reader-toolbar 判断。
 *
 * 起点用 `{\n`（紧跟换行）定位函数体左花括号，可跳过签名里的内联类型
 * （如 `(_e: MouseEvent)`），避免切到类型注解上。
 */
function bodyOf(src, name, from = 0) {
  const idx = src.indexOf(name, from);
  if (idx < 0) return null;
  let open = -1;
  for (let i = idx; i < src.length - 1; i++) {
    if (src[i] === "{" && (src[i + 1] === "\n" || src[i + 1] === "\r")) {
      open = i;
      break;
    }
  }
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * 抽取文件里【所有】同名生命周期块。
 * ReaderView.svelte 现有两处 onDestroy（一处处清理定时器、一处处解绑监听），
 * 只取第一个会漏掉真正注销 mousedown 的那一个，故必须遍历全部。
 */
function allBodiesOf(src, name) {
  const out = [];
  let from = 0;
  for (;;) {
    const idx = src.indexOf(name, from);
    if (idx < 0) break;
    const body = bodyOf(src, name, idx);
    if (body) out.push(body);
    from = idx + name.length;
  }
  return out;
}

test("ReaderView 含 onContainerMouseDown 函数定义", () => {
  assert.match(src, /function\s+onContainerMouseDown\s*\(/, "onContainerMouseDown should be defined");
});

test("ReaderView 不再使用 onDocumentMouseDown", () => {
  assert.doesNotMatch(src, /onDocumentMouseDown/, "onDocumentMouseDown should be removed");
});

test("ReaderView 含 closeAllPopovers 函数定义（统一关闭入口）", () => {
  assert.match(src, /function\s+closeAllPopovers\s*\(/, "closeAllPopovers should be defined");
});

test("closeAllPopovers 关闭 showToc / showSettings / showSearch 三个 popover", () => {
  const body = bodyOf(src, "function closeAllPopovers");
  assert.ok(body, "closeAllPopovers function should exist");
  assert.match(body, /showToc\s*=\s*false/, "should close showToc");
  assert.match(body, /showSettings\s*=\s*false/, "should close showSettings");
  assert.match(body, /showSearch\s*=\s*false/, "should close showSearch");
});

test("onContainerMouseDown 优先跳过 .reader-popover（点击 popover 内不关闭）", () => {
  const body = bodyOf(src, "function onContainerMouseDown");
  assert.ok(body, "onContainerMouseDown function should exist");
  assert.match(body, /closest\??\.\s*\(\s*['"]\.reader-popover['"]\s*\)/, "should use closest('.reader-popover') (with optional chaining)");
  const popoverIdx = body.indexOf(".reader-popover");
  const toolbarIdx = body.indexOf(".reader-toolbar");
  assert.ok(popoverIdx >= 0 && toolbarIdx >= 0, "both selectors should exist");
  assert.ok(popoverIdx < toolbarIdx, "popover check must come before toolbar check");
  const popoverLine = body.substring(popoverIdx, body.indexOf("\n", popoverIdx));
  assert.match(popoverLine, /\)\s*\)?\s*return/, "popover hit should return");
});

test("onContainerMouseDown 跳过 .reader-toolbar（让 click 自行 toggle）", () => {
  const body = bodyOf(src, "function onContainerMouseDown");
  assert.ok(body);
  assert.match(body, /closest\??\.\s*\(\s*['"]\.reader-toolbar['"]\s*\)/, "should use closest('.reader-toolbar')");
  const toolbarIdx = body.indexOf(".reader-toolbar");
  const toolbarLine = body.substring(toolbarIdx, body.indexOf("\n", toolbarIdx));
  assert.match(toolbarLine, /\)\s*\)?\s*return/, "toolbar hit should return");
});

test("onContainerMouseDown 在 popover + toolbar 之外调用 closeAllPopovers", () => {
  const body = bodyOf(src, "function onContainerMouseDown");
  assert.ok(body);
  assert.match(body, /closeAllPopovers\s*\(\)/, "should call closeAllPopovers() in fallback branch");
});

test("onMount 注册 readerViewEl mousedown 监听（限定在阅读器容器内）", () => {
  const onMountBody = bodyOf(src, "onMount(() => {");
  assert.ok(onMountBody, "onMount body should extract");
  assert.match(
    onMountBody,
    /readerViewEl\.addEventListener\s*\(\s*['"]mousedown['"]\s*,\s*onContainerMouseDown/,
    "should bind mousedown to readerViewEl",
  );
  assert.doesNotMatch(
    onMountBody,
    /document\.addEventListener\s*\(\s*['"]mousedown['"]/,
    "should NOT bind mousedown to document",
  );
});

test("onDestroy 从 readerViewEl 移除 mousedown 监听（防内存泄漏 + 多 Tab 残留）", () => {
  // ReaderView 有多个 onDestroy 块，注销监听的可能是其中任意一个，故合并后判断。
  const onDestroyBodies = allBodiesOf(src, "onDestroy(() => {");
  assert.ok(onDestroyBodies.length > 0, "onDestroy body should extract");
  const onDestroyBody = onDestroyBodies.join("\n");
  assert.match(
    onDestroyBody,
    /readerViewEl\.removeEventListener\s*\(\s*['"]mousedown['"]\s*,\s*onContainerMouseDown/,
    "should remove mousedown from readerViewEl (checked across all onDestroy blocks)",
  );
  assert.doesNotMatch(
    onDestroyBody,
    /document\.removeEventListener\s*\(\s*['"]mousedown['"]/,
    "should NOT remove mousedown from document",
  );
});

test("[回归] 修复后用户点击 book 内容区自动关闭 popover（无需点 toolbar 按钮）", () => {
  const body = bodyOf(src, "function onContainerMouseDown");
  assert.ok(body);
  // 函数内现有两处 closeAllPopovers()：一处是「点 foliate 正文空白」的即时收起分支
  // （位于若干 return 之前），另一处是函数末尾的兜底。本用例守护的是「兜底路径必须在
  // 所有早退之后」，因此取【最后一次】出现来比较，而不是第一次。
  const closeIdx = body.lastIndexOf("closeAllPopovers");
  const returnIdxs = [];
  const re = /return\s*;/g;
  let mm;
  while ((mm = re.exec(body)) !== null) returnIdxs.push(mm.index);
  if (returnIdxs.length > 0) {
    assert.ok(closeIdx > returnIdxs[returnIdxs.length - 1], `fallback closeAllPopovers should be AFTER all early returns. Found lastCloseIdx=${closeIdx}, returns=${returnIdxs.join(",")}`);
  }
});

test("[回归] 修复后保留原有 toggle 行为（点 toolbar 按钮不立即关闭）", () => {
  const body = bodyOf(src, "function onContainerMouseDown");
  assert.ok(body);
  const toolbarIdx = body.indexOf(".reader-toolbar");
  const toolbarLine = body.substring(toolbarIdx, body.indexOf("\n", toolbarIdx));
  assert.match(toolbarLine, /\)\s*\)?\s*return/, "toolbar mousedown must return early (do NOT close) so toolbar button click can toggle");
});
