// 阅读器 - mousedown 监听限定容器测试（2026-08-23 新增）
// ----------------------------------------------------------------
// 用户第二轮反馈：上轮"6 个浮层改 absolute + 包入 .reader-floating-layer"修复后，
// 思源顶栏"管理"按钮依旧点不动（在阅读 Tab 时不能触发）。
//
// 根因（深入排查）：
//   onDocumentMouseDown listener 注册在 document 上（capture phase），
//   每次 mousedown 都触发 → 调用 closeAllPopovers() 修改 Svelte 状态。
//   即使没有 stopPropagation / preventDefault，多 Tab 共存时多个 listener
//   叠加仍可能干扰 click 时序（特别是 closeAllPopovers 触发的 Svelte
//   microtask 重渲染）。
//
// 修复：
//   1. listener 从 document 改绑到 .reader-view 容器（readerViewEl），
//      限定作用域到阅读器内部，不影响思源原生 UI 点击
//   2. 同时修正：getReaderViewOffset() 之前用 container（foliate-view 容器），
//      实际应该用 readerViewEl（.reader-view 容器）作为偏移基
//   3. 函数重命名：onDocumentMouseDown → onContainerMouseDown（语义更准）
//
// 覆盖（grep ReaderView.svelte 源码）：
// - readerViewEl ref 存在 + bind:this={readerViewEl}
// - getReaderViewOffset 使用 readerViewEl（不是 container）
// - onMount 注册用 readerViewEl.addEventListener（不是 document）
// - onDestroy 注销用 readerViewEl.removeEventListener
// - 关闭回调 closeAllPopovers + 6 条件渲染保留
// 不依赖：foliate / siyuan SDK

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const readerViewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const src = readFileSync(readerViewPath, "utf-8");

/** 抽 onMount 完整函数体（处理嵌套花括号） */
function extractOnMountBody(src) {
  const sig = "onMount(() => {";
  const idx = src.indexOf(sig);
  if (idx < 0) return null;
  const start = src.indexOf("{", idx);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.substring(start, i + 1);
    }
  }
  return null;
}

/** 抽 onDestroy 完整函数体 */
function extractOnDestroyBody(src) {
  const sig = "onDestroy(() => {";
  const idx = src.indexOf(sig);
  if (idx < 0) return null;
  const start = src.indexOf("{", idx);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.substring(start, i + 1);
    }
  }
  return null;
}

test("[关键修复] readerViewEl ref 存在", () => {
  assert.match(src, /let\s+readerViewEl\s*:\s*HTMLDivElement/, "should declare readerViewEl ref");
});

test("[关键修复] .reader-view 容器绑 bind:this={readerViewEl}", () => {
  // 找 <div class="reader-view" bind:this={readerViewEl}
  assert.match(
    src,
    /<div\s+class="reader-view"\s+bind:this=\{readerViewEl\}/,
    "should bind readerViewEl to .reader-view div",
  );
});

test("[关键修复] getReaderViewOffset 用 readerViewEl（非 container）", () => {
  // 抽 getReaderViewOffset 函数体
  const sig = "function getReaderViewOffset";
  const idx = src.indexOf(sig);
  assert.ok(idx > 0, "getReaderViewOffset should exist");
  const start = src.indexOf("{", idx);
  let depth = 0;
  let body = null;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        body = src.substring(start, i + 1);
        break;
      }
    }
  }
  assert.ok(body);
  // 应使用 readerViewEl.getBoundingClientRect（不是 container）
  assert.match(body, /readerViewEl\.getBoundingClientRect/, "should use readerViewEl for offset");
  assert.doesNotMatch(body, /container\.getBoundingClientRect/, "should NOT use container (foliate-view) for offset (was wrong)");
});

test("[关键修复] onMount 用 readerViewEl.addEventListener 绑 mousedown（非 document）", () => {
  const onMountBody = extractOnMountBody(src);
  assert.ok(onMountBody, "onMount body should extract");
  // 应有 readerViewEl.addEventListener("mousedown", onContainerMouseDown)
  assert.match(
    onMountBody,
    /readerViewEl\.addEventListener\s*\(\s*['"]mousedown['"]\s*,\s*onContainerMouseDown/,
    "should bind mousedown to readerViewEl",
  );
  // 不应再用 document.addEventListener("mousedown", ...)
  assert.doesNotMatch(
    onMountBody,
    /document\.addEventListener\s*\(\s*['"]mousedown['"]/,
    "should NOT bind mousedown to document (was the bug)",
  );
});

test("[关键修复] onDestroy 用 readerViewEl.removeEventListener 解绑", () => {
  const onDestroyBody = extractOnDestroyBody(src);
  assert.ok(onDestroyBody, "onDestroy body should extract");
  assert.match(
    onDestroyBody,
    /readerViewEl\.removeEventListener\s*\(\s*['"]mousedown['"]/,
    "should remove mousedown from readerViewEl",
  );
  assert.doesNotMatch(
    onDestroyBody,
    /document\.removeEventListener\s*\(\s*['"]mousedown['"]/,
    "should NOT remove mousedown from document (was the bug)",
  );
});

test("[关键修复] 函数重命名 onDocumentMouseDown → onContainerMouseDown", () => {
  // 不应再出现 onDocumentMouseDown
  assert.doesNotMatch(src, /onDocumentMouseDown/, "should not have onDocumentMouseDown anymore");
  // 应有 onContainerMouseDown
  assert.match(src, /function\s+onContainerMouseDown/, "should have onContainerMouseDown function");
});

test("[关键修复] closeAllPopovers 仍然关闭所有 popover（保留功能）", () => {
  const sig = "function closeAllPopovers";
  const idx = src.indexOf(sig);
  const start = src.indexOf("{", idx);
  let depth = 0;
  let body = null;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        body = src.substring(start, i + 1);
        break;
      }
    }
  }
  assert.ok(body);
  // 应关闭 showToc / showSettings / showSearch
  for (const v of ["showToc", "showSettings", "showSearch"]) {
    assert.match(body, new RegExp(`${v}\\s*=\\s*false`), `closeAllPopovers should close ${v}`);
  }
});

test("onContainerMouseDown 跳过 popover / toolbar（不关正在交互的 UI）", () => {
  const sig = "function onContainerMouseDown";
  const idx = src.indexOf(sig);
  const start = src.indexOf("{", idx);
  let depth = 0;
  let body = null;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        body = src.substring(start, i + 1);
        break;
      }
    }
  }
  assert.ok(body);
  assert.match(body, /\.reader-popover/, "should reference .reader-popover");
  assert.match(body, /\.reader-toolbar/, "should reference .reader-toolbar");
});

test("[关键修复] onContainerMouseDown 三个前置条件（避免无谓触发）", () => {
  const sig = "function onContainerMouseDown";
  const idx = src.indexOf(sig);
  const start = src.indexOf("{", idx);
  let depth = 0;
  let body = null;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        body = src.substring(start, i + 1);
        break;
      }
    }
  }
  assert.ok(body);
  // 前置：三个 popover 都不显示才 return
  assert.match(body, /!showToc/, "should check !showToc");
  assert.match(body, /!showSettings/, "should check !showSettings");
  assert.match(body, /!showSearch/, "should check !showSearch");
});

test("[回归] 三个 popover 条件渲染保留", () => {
  // {#if showToc}, {#if showSettings}, {#if showSearch} 都还存在
  for (const v of ["showToc", "showSettings", "showSearch"]) {
    assert.ok(
      src.includes(`{#if ${v}}`),
      `{#if ${v}} conditional render should remain`,
    );
  }
});

test("[回归] selectionchange 监听绑 document（保留：跨文档选区检测）", () => {
  const onMountBody = extractOnMountBody(src);
  assert.ok(onMountBody);
  assert.match(
    onMountBody,
    /document\.addEventListener\s*\(\s*['"]selectionchange['"]/,
    "selectionchange should still bind to document (cross-document selection)",
  );
});
