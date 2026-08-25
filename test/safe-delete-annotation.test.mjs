// 阅读器 - 安全删除标注（双轨兜底）测试（2026-08-24 新增）
// ----------------------------------------------------------------
// 用户反馈：删除按钮有响应，但屏幕高亮/线段/波浪线没被删除。
//
// 根因：
//   foliate 内部 view.deleteAnnotation → addAnnotation(annotation, true)，
//   后者依赖 #getOverlayer(index) 找章节 overlayer；目标 cfi 章节当前
//   未渲染进可见帧时，getContents() 不包含该章节，overlayer.remove 永
//   不被调用 → 屏幕高亮残留。REword 旧版 safeDeleteAnnotation 用
//   goTo + setTimeout 等待，与 foliate 渲染存在竞态。
//
// 修复：
//   1. directRemoveFromDom 直接遍历已渲染章节的 overlayer，查找
//      [data-annotation="${cfi}"] SVG <g> 元素并 remove（双轨兜底）
//   2. cssEscape polyfill（思源内核 CSS.escape 不可靠）
//   3. 新版 safeDeleteAnnotation 三步走：foliate API + DOM 兜底 + 监听
//      create-overlay 事件（事件驱动等渲染完成再删）

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewPath = join(__dirname, "..", "src/reader/ReaderView.svelte");
const viewSrc = readFileSync(viewPath, "utf-8");

/** 抽函数体（处理嵌套花括号） */
function extractFunction(src, name) {
  const m = src.match(new RegExp(`function\\s+${name}\\s*[<(]`));
  if (!m) return null;
  const start = m.index + m[0].length;
  // 找开括号到参数列表结束
  let i = start;
  while (i < src.length && src[i] !== "{") i++;
  if (i >= src.length) return null;
  const openIdx = i;
  let depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return src.slice(openIdx, i);
}

// ============ A. DOM 直接删除函数（无 foliate 依赖） ============

test("A1: directRemoveFromDom 找到匹配 [data-annotation] 的 SVG <g> 元素并 remove", () => {
  const body = extractFunction(viewSrc, "directRemoveFromDom");
  assert.ok(body, "directRemoveFromDom 函数应存在");
  assert.match(body, /querySelectorAll/, "应用 querySelectorAll 查找元素");
  assert.match(body, /\[data-annotation=/, "应用 [data-annotation=...] 选择器");
  assert.match(body, /\.remove\(\)/, "应用 Element.remove()");
});

test("A2: directRemoveFromDom 找不到匹配 cfi 时返回 false（不抛错）", () => {
  const body = extractFunction(viewSrc, "directRemoveFromDom");
  assert.ok(body);
  // 应有 try/catch 包裹
  assert.match(body, /try\s*\{/, "应有 try 包裹");
  assert.match(body, /catch\s*\{/, "应有 catch 兜底");
  // 返回 boolean
  assert.match(body, /return\s+(true|false)/, "应返回 boolean");
});

test("A3: directRemoveFromDom 处理 cfi 含特殊字符（epubcfi(...)）—— 用 cssEscape", () => {
  const body = extractFunction(viewSrc, "directRemoveFromDom");
  assert.ok(body);
  assert.match(body, /cssEscape\s*\(\s*cfi\s*\)/, "cfi 应经过 cssEscape 处理后再用于选择器");
  // 同时验证 cssEscape 函数存在
  const escapeFn = extractFunction(viewSrc, "cssEscape");
  assert.ok(escapeFn, "cssEscape 函数应存在");
  // cssEscape 应处理特殊字符（`(` `)` `/` 等）
  assert.match(escapeFn, /replace.*\\/g, "cssEscape 应转义非字母数字字符");
});

test("A4: directRemoveFromDom 在 contents 为空时返回 false 不抛错", () => {
  const body = extractFunction(viewSrc, "directRemoveFromDom");
  assert.ok(body);
  // 应有 contents 为空兜底
  assert.match(body, /getContents\?\.\(\)\s*\|\|\s*\[\]/, "getContents 失败应兜底空数组");
  // 同时调用 .overlayer 可能 undefined
  assert.match(body, /layer\?\.continue|if\s*\(\s*!layer\s*\)/, "无 overlayer 时 continue");
});

// ============ B. safeDeleteAnnotation 主流程 ============

test("B1: safeDeleteAnnotation 先调 view.deleteAnnotation（foliate API 主路径）", () => {
  const body = extractFunction(viewSrc, "safeDeleteAnnotation");
  assert.ok(body, "safeDeleteAnnotation 函数应存在");
  assert.match(body, /view\.deleteAnnotation/, "应先调 foliate API");
  assert.match(body, /foliateOk\s*=\s*true/, "foliateOk 标志应在 API 成功时置 true");
});

test("B2: safeDeleteAnnotation 在 foliate API 失败时走 DOM 兜底（directRemoveFromDom）", () => {
  const body = extractFunction(viewSrc, "safeDeleteAnnotation");
  assert.ok(body);
  // 调用 directRemoveFromDom 作为兜底
  assert.match(body, /directRemoveFromDom\s*\(\s*cfi\s*\)/, "应调 directRemoveFromDom 兜底");
  // 任一成功就 return true
  assert.match(body, /foliateOk\s*\|\|\s*domOk/, "任一成功应 return true");
});

test("B3: safeDeleteAnnotation 在 foliate API + DOM 都失败时监听 create-overlay 事件", () => {
  const body = extractFunction(viewSrc, "safeDeleteAnnotation");
  assert.ok(body);
  // 监听 create-overlay 事件
  assert.match(body, /addEventListener\("create-overlay"/, "应监听 foliate create-overlay 事件");
  // 用 goTo 触发跳转
  assert.match(body, /view\?\.goTo\s*\(\s*cfi\s*\)/, "应调 view.goTo(cfi) 触发跳转渲染");
  // 3 秒超时兜底
  assert.match(body, /setTimeout[\s\S]*?3000/, "应有 3 秒超时");
});

// ============ C. 现有功能回归 ============

test("C1: onAnnDeleteById 调用 safeDeleteAnnotation（grep 源码验证）", () => {
  const body = extractFunction(viewSrc, "onAnnDeleteById");
  assert.ok(body, "onAnnDeleteById 函数应存在");
  assert.match(body, /await\s+safeDeleteAnnotation\s*\(\s*cfi\s*\)/, "onAnnDeleteById 应 await safeDeleteAnnotation");
});

test("C2: onAnnDeleteById 仍调 annStore.remove（数据库记录删除）", () => {
  const body = extractFunction(viewSrc, "onAnnDeleteById");
  assert.ok(body);
  assert.match(body, /annStore\.remove\s*\(\s*stored\.id\s*\)/, "annStore.remove 仍被调用");
});

test("C3: onAnnDeleteById 仍调 annByValue.delete（内存映射清理）", () => {
  const body = extractFunction(viewSrc, "onAnnDeleteById");
  assert.ok(body);
  assert.match(body, /annByValue\.delete\s*\(\s*cfi\s*\)/, "annByValue.delete 仍被调用");
});
