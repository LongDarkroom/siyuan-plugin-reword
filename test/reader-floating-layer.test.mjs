// 阅读器 - 浮层限定容器测试（2026-08-23 新增）
// ----------------------------------------------------------------
// 用户反馈：阅读 Tab 打开后，思源顶栏"管理"按钮点不动。
// 根因：.reader-dict-backdrop / .reader-ann-backdrop 用 position:fixed + inset:0
//   + 高 z-index 全屏覆盖视口（视觉透明但拦截点击）。
// 修复：所有 fixed 浮层统一改 absolute + 包入 .reader-floating-layer 容器。
//
// 覆盖（grep ReaderView.svelte 源码）：
// - .reader-floating-layer 容器定义 + position:absolute + pointer-events:none
// - .reader-floating-layer 子元素 pointer-events:auto
// - 6 个浮层元素都改 position:absolute（无 fixed）
// - 6 个浮层都嵌套在 .reader-floating-layer 内
// - selToolbar / dictPopup / annEditor 坐标使用 toContainerCoords
// - 回归：{#if ... visible} 条件渲染 + 关闭回调保留
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

// === 容器定义 ===

test("[关键修复] .reader-floating-layer 容器存在", () => {
  assert.match(src, /\.reader-floating-layer\s*\{/, "should define .reader-floating-layer CSS rule");
});

test("[关键修复] .reader-floating-layer 容器 position: absolute（不脱离视口）", () => {
  const m = src.match(/\.reader-floating-layer\s*\{([^}]*)\}/);
  assert.ok(m, ".reader-floating-layer block should exist");
  const body = m[1];
  assert.match(body, /position\s*:\s*absolute/, "should use position: absolute (not fixed)");
  assert.doesNotMatch(body, /position\s*:\s*fixed/, "should NOT use position: fixed (was the bug)");
});

test("[关键修复] .reader-floating-layer 容器 pointer-events: none（默认不拦截事件）", () => {
  const m = src.match(/\.reader-floating-layer\s*\{([^}]*)\}/);
  assert.ok(m);
  const body = m[1];
  assert.match(body, /pointer-events\s*:\s*none/, "container should default to pointer-events: none");
});

test("[关键修复] .reader-floating-layer 子元素 pointer-events: auto（启用交互）", () => {
  const m = src.match(/\.reader-floating-layer\s*>\s*\*\s*\{([^}]*)\}/);
  assert.ok(m, ".reader-floating-layer > * block should exist");
  const body = m[1];
  assert.match(body, /pointer-events\s*:\s*auto/, "children should re-enable pointer-events");
});

test(".reader-floating-layer inset: 0（占满容器）+ 适度 z-index", () => {
  const m = src.match(/\.reader-floating-layer\s*\{([^}]*)\}/);
  assert.ok(m);
  const body = m[1];
  assert.match(body, /inset\s*:\s*0/, "container should fill the reader-view");
  assert.match(body, /z-index\s*:\s*\d+/, "container should have z-index above foliate-view");
});

// === 6 个浮层元素位置 ===

/** 从 CSS 块体中去除 CSS 注释（/* ... *\/），避免注释里"fixed"被误匹配 */
function stripCssComments(body) {
  return body.replace(/\/\*[\s\S]*?\*\//g, "");
}

test(".reader-sel-toolbar 改 position: absolute", () => {
  const m = src.match(/\.reader-sel-toolbar\s*\{([^}]*)\}/);
  assert.ok(m);
  const body = stripCssComments(m[1]);
  assert.match(body, /position\s*:\s*absolute\s*;/, "sel-toolbar should be absolute");
  assert.doesNotMatch(body, /position\s*:\s*fixed\s*[;}]/, "sel-toolbar should NOT be fixed");
});

test(".reader-dict-backdrop 改 position: absolute（关键！原 fixed + inset:0 全屏覆盖是根因）", () => {
  const m = src.match(/\.reader-dict-backdrop\s*\{([^}]*)\}/);
  assert.ok(m, "reader-dict-backdrop should exist");
  const body = stripCssComments(m[1]);
  assert.match(body, /position\s*:\s*absolute\s*;/, "dict-backdrop should be absolute");
  assert.doesNotMatch(body, /position\s*:\s*fixed\s*[;}]/, "dict-backdrop should NOT be fixed (was blocking clicks)");
});

test(".reader-dict-popup 改 position: absolute", () => {
  const m = src.match(/\.reader-dict-popup\s*\{([^}]*)\}/);
  assert.ok(m);
  const body = stripCssComments(m[1]);
  assert.match(body, /position\s*:\s*absolute\s*;/, "dict-popup should be absolute");
  assert.doesNotMatch(body, /position\s*:\s*fixed\s*[;}]/, "dict-popup should NOT be fixed");
});

test(".reader-toast 改 position: absolute", () => {
  const m = src.match(/\.reader-toast\s*\{([^}]*)\}/);
  assert.ok(m);
  const body = stripCssComments(m[1]);
  assert.match(body, /position\s*:\s*absolute\s*;/, "toast should be absolute");
  assert.doesNotMatch(body, /position\s*:\s*fixed\s*[;}]/, "toast should NOT be fixed");
});

test(".reader-ann-backdrop 改 position: absolute（关键！原 fixed + inset:0 全屏覆盖是根因）", () => {
  const m = src.match(/\.reader-ann-backdrop\s*\{([^}]*)\}/);
  assert.ok(m, "reader-ann-backdrop should exist");
  const body = stripCssComments(m[1]);
  assert.match(body, /position\s*:\s*absolute\s*;/, "ann-backdrop should be absolute");
  assert.doesNotMatch(body, /position\s*:\s*fixed\s*[;}]/, "ann-backdrop should NOT be fixed (was blocking clicks)");
});

test(".reader-ann-editor 样式保持 position: absolute（无 fixed，避免拦截点击）", () => {
  const m = src.match(/\.reader-ann-editor\s*\{([^}]*)\}/);
  assert.ok(m, ".reader-ann-editor CSS rule should still exist");
  const body = stripCssComments(m[1]);
  assert.match(body, /position\s*:\s*absolute\s*;/, "ann-editor should be absolute");
  assert.doesNotMatch(body, /position\s*:\s*fixed\s*[;}]/, "ann-editor should NOT be fixed");
});

// === 6 个浮层模板位置：都嵌套在 .reader-floating-layer 内 ===

test("[关键修复] .reader-floating-layer div 在模板中存在", () => {
  assert.match(src, /<div\s+class="reader-floating-layer"/, "should render <div class=\"reader-floating-layer\">");
});

test("浮层模板都嵌套在 .reader-floating-layer 内（按出现顺序）", () => {
  const layerIdx = src.indexOf('class="reader-floating-layer"');
  const layerEnd = src.indexOf("</div><!-- /.reader-floating-layer -->");
  assert.ok(layerIdx > 0, "floating-layer opening tag should exist");
  assert.ok(layerEnd > layerIdx, "floating-layer closing tag should exist");
  const inside = src.substring(layerIdx, layerEnd);
  // 现存浮层（annEditor 死链路已移除，故不再有 reader-ann-editor / reader-ann-backdrop）
  for (const sel of [
    "reader-sel-toolbar",
    "reader-dict-backdrop",
    "reader-dict-popup",
    "reader-toast",
  ]) {
    assert.ok(
      inside.includes(`class="${sel}"`),
      `${sel} should be inside .reader-floating-layer`,
    );
  }
});

// === 坐标计算（视口→容器） ===

test("getReaderViewOffset() 函数定义（视口偏移）", () => {
  assert.match(src, /function\s+getReaderViewOffset\s*\(/, "getReaderViewOffset should be defined");
  // 内部用 getBoundingClientRect 取 .reader-view 容器视口位置
  // 用花括号深度匹配函数体（兼容返回类型 : { ... }）
  const sig = "function getReaderViewOffset";
  const body = extractFunctionBody(src, sig);
  assert.ok(body, "getReaderViewOffset function body should be extractable");
  assert.match(body, /getBoundingClientRect/, "should call getBoundingClientRect on container");
});

test("toContainerCoords() 函数定义（视口→容器转换）", () => {
  assert.match(src, /function\s+toContainerCoords\s*\(/, "toContainerCoords should be defined");
  const sig = "function toContainerCoords";
  const body = extractFunctionBody(src, sig);
  assert.ok(body);
  assert.match(body, /getReaderViewOffset/, "should call getReaderViewOffset");
});

test("showToolbarFor 经由 positionToolbarAbove 转换坐标（selToolbar）", () => {
  const body = extractFunctionBody(src, "function showToolbarFor");
  assert.ok(body);
  // showToolbarFor 不直接调用 toContainerCoords，而是委托 positionToolbarAbove
  // （后者内部调用 toContainerCoords 做视口→容器坐标转换）
  assert.match(body, /positionToolbarAbove/, "showToolbarFor should route through positionToolbarAbove");
  const pta = extractFunctionBody(src, "function positionToolbarAbove");
  assert.ok(pta, "positionToolbarAbove should be extractable");
  assert.match(pta, /toContainerCoords/, "positionToolbarAbove should call toContainerCoords");
});

test("openAnnViewer 已删除（annEditor 死链路移除，不再有该浮层坐标转换）", () => {
  // annEditor 死代码已删除，源码不应再定义 openAnnViewer 函数
  assert.equal(src.indexOf("function openAnnViewer"), -1, "openAnnViewer should be removed (dead code)");
});

/**
 * 从 src 中提取指定函数的方法体（按花括号深度匹配，兼容参数 / 返回类型注解）。
 * 跳过参数括号 `()` 和返回类型 `: Type` 后再开始计数。
 * @param {string} src 源文件
 * @param {string} sig 函数签名特征（如 "function showToolbarFor"）
 * @returns {string|null} 方法体（含花括号），或 null
 */
function extractFunctionBody(src, sig) {
  const idx = src.indexOf(sig);
  if (idx < 0) return null;
  // 跳过参数括号：找 sig 后的第一个 (，配对 )
  let i = idx + sig.length;
  while (i < src.length && src[i] !== "(" && src[i] !== "{") i++;
  if (i >= src.length) return null;
  if (src[i] === "{") {
    // 没参数，直接是函数体（罕见）
  } else {
    // 跳过 ( ... )，配对括号
    let depth = 1;
    i++;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
  }
  // 现在 i 指向 ) 后字符。跳过空白
  while (i < src.length && /\s/.test(src[i])) i++;
  // 如果是 :（返回类型注解），跳过整个返回类型（可能是 { ... } 块类型，也可能是
  // 简单命名类型如 : ReaderViewOffset），直到函数体 { 开始。
  if (src[i] === ":") {
    i++;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === "{") {
      // 跳过返回类型 { ... }
      let depth = 1;
      i++;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
    } else {
      // 简单命名返回类型（如 : ReaderViewOffset）：跳过直到函数体 {
      while (i < src.length && src[i] !== "{") i++;
    }
    // 跳过空白
    while (i < src.length && /\s/.test(src[i])) i++;
  }
  // 此时 i 应该指向函数体的 {
  if (src[i] !== "{") return null;
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.substring(start, i + 1);
    }
  }
  return null;
}

// === 回归：保留 {#if} 条件渲染和关闭回调 ===

test("[回归] 浮层条件渲染保留（visible/toastMsg 触发）", () => {
  for (const cond of [
    "selToolbar.visible",
    "dictPopup.visible",
    "toastMsg",
  ]) {
    assert.ok(src.includes(cond), `condition ${cond} should still exist in template`);
  }
  // annEditor.visible 已随死链路删除，不应再存在
  assert.equal(src.includes("annEditor.visible"), false, "annEditor.visible should be removed (dead code)");
});

test("[回归] 关闭回调保留（closeDictPopup）", () => {
  assert.ok(src.includes("closeDictPopup"), "closeDictPopup callback should remain");
  // onAnnCancel 已随 annEditor 死链路删除
  assert.equal(src.includes("onAnnCancel"), false, "onAnnCancel should be removed (dead code)");
});

test("[回归] pointer-events: none 保留在 .reader-toast（toast 不应拦截点击）", () => {
  const m = src.match(/\.reader-toast\s*\{([^}]*)\}/);
  assert.ok(m);
  assert.match(m[1], /pointer-events\s*:\s*none/, "toast should keep pointer-events: none");
});

test("[回归] backdrop 是 transparent 背景（不挡视觉）", () => {
  const mDict = src.match(/\.reader-dict-backdrop\s*\{([^}]*)\}/);
  const mAnn = src.match(/\.reader-ann-backdrop\s*\{([^}]*)\}/);
  assert.ok(mDict);
  assert.ok(mAnn);
  assert.match(mDict[1], /background\s*:\s*transparent/, "dict-backdrop should keep transparent bg");
  assert.match(mAnn[1], /background\s*:\s*transparent/, "ann-backdrop should keep transparent bg");
});

test("[关键回归] 修复后没有浮层元素再用 position: fixed", () => {
  // 收集所有 .reader-*-toolbar / .reader-dict-* / .reader-ann-* / .reader-toast 块
  // 确保它们都改 absolute。先 strip 注释避免误匹配注释里的"fixed"字符串
  const blockRe = /\.(reader-(sel-toolbar|dict-(backdrop|popup)|toast|ann-(backdrop|editor)))\s*\{([^}]*)\}/g;
  let m;
  const fixedBlocks = [];
  while ((m = blockRe.exec(src)) !== null) {
    const body = m[5].replace(/\/\*[\s\S]*?\*\//g, "");
    if (/position\s*:\s*fixed\s*[;}]/.test(body)) {
      fixedBlocks.push(m[1]);
    }
  }
  assert.equal(fixedBlocks.length, 0, `no floating layer should use position: fixed, but found: ${fixedBlocks.join(", ")}`);
});
