// 阅读器 - 批注 UI 一步到位流程测试（2026-08-24 新增）
// ----------------------------------------------------------------
// 用户第二轮反馈（截图）：选中文本 → 工具栏点"批注" → 弹出小色板（5 色 + 3 样式）→
// 选完颜色 → 才弹完整批注卡片。两步流程不合理（annEditor 内本就有完整选择器）。
//
// 修复：消除 stylePanel 中间层，selToolbar "批注" 按钮直接弹 annEditor；
// selToolbar "高亮" 按钮简化为"一键高亮"（用上次颜色/样式）；
// 点击已有批注直接弹 annEditor（不再走 selToolbar(edit) → "笔记"两步）。
//
// 覆盖（grep ReaderView.svelte 源码）：
// A. selToolbar "批注" 按钮直接弹 annEditor（5 用例）
// B. selToolbar "高亮" 按钮走快速高亮（4 用例）
// C. stylePanel 状态/UI/CSS 彻底移除（7 用例）
// D. selToolbar edit 模式移除（4 用例）
// E. show-annotation 流程直接弹 annEditor（4 用例）
// F. annEditor 内部选择器齐全（3 用例）
// G. onAnnSave 正确记录 lastColor / lastStyle / lastGroup（3 用例）
// H. 现有功能回归（3 用例）
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

/** 抽两个字符串之间的源码片段（处理嵌套花括号） */
function extractBetween(src, startMarker, endMarker) {
  const startIdx = src.indexOf(startMarker);
  if (startIdx < 0) return null;
  const afterStart = startIdx + startMarker.length;
  const endIdx = src.indexOf(endMarker, afterStart);
  if (endIdx < 0) return null;
  return src.slice(afterStart, endIdx);
}

/** 抽一个函数体（start `function xxx` 到下一个 `^\s*}\n` 顶级位置，简化按括号配对） */
function extractFunctionBody(src, fnName) {
  const m = src.match(new RegExp(`function\\s+${fnName}\\s*\\(`));
  if (!m) return null;
  const start = m.index + m[0].length;
  // 找到匹配的 ) { 后的开始大括号
  const openIdx = src.indexOf("{", start);
  if (openIdx < 0) return null;
  let depth = 1;
  let i = openIdx + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return src.slice(openIdx, i);
}

/** 抽一个 view.addEventListener("show-annotation", (e: any) => { ... }) 的回调体 */
function extractShowAnnotationHandler(src) {
  const re = /view\.addEventListener\(\s*["']show-annotation["']\s*,\s*\(e:\s*any\)\s*=>\s*\{/;
  const m = re.exec(src);
  if (!m) return null;
  const openIdx = src.indexOf("{", m.index + m[0].length - 1);
  if (openIdx < 0) return null;
  let depth = 1;
  let i = openIdx + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return src.slice(openIdx, i);
}

// ============ A. selToolbar "批注" 按钮直接弹 annEditor ============

test("A1: onSelAnnotate 函数体不再设置 stylePanel", () => {
  const body = extractFunctionBody(src, "onSelAnnotate");
  assert.ok(body, "onSelAnnotate 函数应存在");
  assert.doesNotMatch(body, /stylePanel/, "onSelAnnotate 不应再写 stylePanel");
});

test("A2: onSelAnnotate 函数体直接设置 annEditor.visible = true", () => {
  const body = extractFunctionBody(src, "onSelAnnotate");
  assert.ok(body, "onSelAnnotate 函数应存在");
  assert.match(body, /annEditor\s*=\s*\{/, "onSelAnnotate 应设置 annEditor 对象");
  assert.match(body, /visible:\s*true/, "annEditor.visible 应为 true");
});

test("A3: onSelAnnotate 设置 annEditor.cfi = selInfo.cfi", () => {
  const body = extractFunctionBody(src, "onSelAnnotate");
  assert.ok(body);
  assert.match(body, /cfi:\s*selInfo\.cfi/, "annEditor.cfi 应来自 selInfo.cfi");
});

test("A4: onSelAnnotate 设置 annEditor.selectedText = selToolbar.text", () => {
  const body = extractFunctionBody(src, "onSelAnnotate");
  assert.ok(body);
  assert.match(body, /selectedText:\s*text/, "annEditor.selectedText 应来自 selToolbar.text");
});

test("A5: onSelAnnotate 继承 lastColor / lastStyle（不写死）", () => {
  const body = extractFunctionBody(src, "onSelAnnotate");
  assert.ok(body);
  assert.match(body, /color:\s*lastColor/, "annEditor.color 应继承 lastColor");
  assert.match(body, /style:\s*lastStyle/, "annEditor.style 应继承 lastStyle");
});

// ============ B. selToolbar "高亮" 按钮走快速高亮 ============

test("B1: onSelHighlight 函数体不再设置 stylePanel", () => {
  const body = extractFunctionBody(src, "onSelHighlight");
  assert.ok(body, "onSelHighlight 函数应存在");
  assert.doesNotMatch(body, /stylePanel/, "onSelHighlight 不应再写 stylePanel");
});

test("B2: onSelHighlight 直接调 saveHighlight（用 lastStyle / lastColor）", () => {
  const body = extractFunctionBody(src, "onSelHighlight");
  assert.ok(body);
  assert.match(body, /saveHighlight\s*\(/, "onSelHighlight 应调 saveHighlight");
  assert.match(body, /lastStyle/, "应使用 lastStyle");
  assert.match(body, /lastColor/, "应使用 lastColor");
});

test("B3: onSelHighlight 关闭 selToolbar", () => {
  const body = extractFunctionBody(src, "onSelHighlight");
  assert.ok(body);
  assert.match(body, /selToolbar\s*=\s*\{\s*\.\.\.selToolbar\s*,\s*visible:\s*false/, "onSelHighlight 应关闭 selToolbar");
});

test("B4: onSelHighlight 在无选区时 toast 提示（仍保留）", () => {
  const body = extractFunctionBody(src, "onSelHighlight");
  assert.ok(body);
  assert.match(body, /toast\s*\(\s*["']请先选中文本["']/, "无选区时仍应 toast 提示");
});

// ============ C. stylePanel 状态/UI/CSS 彻底移除 ============

test("C1: 源码不再有 `let stylePanel` 声明", () => {
  assert.doesNotMatch(src, /\blet\s+stylePanel\s*:/, "stylePanel 状态应删除");
});

test("C2: 源码不再有 `function applyStylePanel`", () => {
  assert.doesNotMatch(src, /function\s+applyStylePanel\s*\(/, "applyStylePanel 函数应删除");
});

test("C3: 源码不再有 `function pickStyle`", () => {
  assert.doesNotMatch(src, /function\s+pickStyle\s*\(/, "pickStyle 函数应删除");
});

test("C4: 源码不再有 `function onEditNote`", () => {
  assert.doesNotMatch(src, /function\s+onEditNote\s*\(/, "onEditNote 函数应删除（已被 show-annotation 直接弹 annEditor 替代）");
});

test("C5: 源码不再有 `function onAnnDeleteById`", () => {
  assert.doesNotMatch(src, /function\s+onAnnDeleteById\s*\(/, "onAnnDeleteById 函数应删除（不再需要）");
});

test("C6: 源码不再有 `.reader-style-panel {` CSS 选择器", () => {
  assert.doesNotMatch(src, /\.reader-style-panel\s*\{/, ".reader-style-panel CSS 应删除");
  // 顺带验证相邻子选择器
  assert.doesNotMatch(src, /\.reader-style-row\s*\{/, ".reader-style-row CSS 应删除");
  assert.doesNotMatch(src, /\.reader-style-btn\s*\{/, ".reader-style-btn CSS 应删除");
  assert.doesNotMatch(src, /\.reader-color-row\s*\{/, ".reader-color-row CSS 应删除");
  assert.doesNotMatch(src, /\.reader-color-dot\s*\{/, ".reader-color-dot CSS 应删除");
  assert.doesNotMatch(src, /\.reader-sel-btn-danger\s*\{/, ".reader-sel-btn-danger CSS 应删除（不再需要）");
});

test("C7: 模板不再有 `{#if stylePanel.visible}`", () => {
  assert.doesNotMatch(src, /\{\s*#if\s+stylePanel\.visible\s*\}/, "stylePanel UI 块应删除");
});

// ============ D. selToolbar edit 模式移除 ============

test("D1: SelToolbarState interface 中 `mode` 字段已删除", () => {
  const m = src.match(/interface\s+SelToolbarState\s*\{[^}]*\}/);
  assert.ok(m, "SelToolbarState interface 应存在");
  assert.doesNotMatch(m[0], /\bmode\s*:/, "SelToolbarState 不应再有 mode 字段");
  assert.doesNotMatch(m[0], /\beditingId\s*:/, "SelToolbarState 不应再有 editingId 字段");
});

test("D2: selToolbar 模板不再有 `{#if selToolbar.mode === \"edit\"}` 分支", () => {
  assert.doesNotMatch(src, /\{\s*#if\s+selToolbar\.mode\s*===\s*["']edit["']\s*\}/, "selToolbar edit 模式分支应删除");
});

test("D3: show-annotation 监听器不再写 `selToolbar.mode = \"edit\"`", () => {
  const handler = extractShowAnnotationHandler(src);
  assert.ok(handler, "show-annotation 监听器应存在");
  assert.doesNotMatch(handler, /selToolbar\.mode\s*=\s*["']edit["']/, "show-annotation 不应再写 selToolbar.mode = edit");
});

test("D4: onContainerMouseDown 不再检查 `stylePanel.visible`", () => {
  const body = extractFunctionBody(src, "onContainerMouseDown");
  assert.ok(body, "onContainerMouseDown 函数应存在");
  assert.doesNotMatch(body, /stylePanel/, "onContainerMouseDown 不应再检查 stylePanel.visible");
});

// ============ E. show-annotation 流程直接弹 annEditor ============

test("E1: show-annotation 监听器直接设置 annEditor 对象", () => {
  const handler = extractShowAnnotationHandler(src);
  assert.ok(handler, "show-annotation 监听器应存在");
  assert.match(handler, /annEditor\s*=\s*\{/, "show-annotation 应直接弹 annEditor");
  assert.match(handler, /visible:\s*true/, "annEditor.visible 应为 true");
});

test("E2: show-annotation 设置 annEditor.editingId = rec.id", () => {
  const handler = extractShowAnnotationHandler(src);
  assert.ok(handler);
  assert.match(handler, /editingId:\s*rec\.id/, "annEditor.editingId 应来自 rec.id");
});

test("E3: show-annotation 不再设置 selToolbar 状态", () => {
  const handler = extractShowAnnotationHandler(src);
  assert.ok(handler);
  assert.doesNotMatch(handler, /selToolbar\s*=/, "show-annotation 不应再写 selToolbar 状态");
});

test("E4: show-annotation 不再有 `mode: \"edit\"` 字面量", () => {
  const handler = extractShowAnnotationHandler(src);
  assert.ok(handler);
  assert.doesNotMatch(handler, /mode:\s*["']edit["']/, "show-annotation 不应再有 mode: edit");
});

// ============ F. annEditor 内部选择器齐全 ============

test("F1: annEditor 模板包含 `class=\"reader-ann-color\"`（颜色选择）", () => {
  assert.match(src, /class="reader-ann-color"/, "annEditor 颜色按钮应存在");
});

test("F2: annEditor 模板包含 `class=\"reader-ann-style\"`（样式选择）", () => {
  assert.match(src, /class="reader-ann-style"/, "annEditor 样式按钮应存在");
});

test("F3: annEditor 模板包含 `<textarea class=\"reader-ann-note\"`（笔记输入）", () => {
  assert.match(src, /<textarea\s+class="reader-ann-note"/, "annEditor 笔记输入框应存在");
});

// ============ G. onAnnSave 正确记录 lastColor / lastStyle / lastGroup ============

test("G1: onAnnSave 函数体记录 lastColor（来自 annEditor.color）", () => {
  const body = extractFunctionBody(src, "onAnnSave");
  assert.ok(body, "onAnnSave 函数应存在");
  // onAnnSave 实际是 const color = annEditor.color; lastColor = color;
  // 这里宽松匹配：先取 annEditor.color 到局部变量，再赋给 lastColor
  assert.match(body, /const\s+color\s*=\s*annEditor\.color/, "应从 annEditor.color 取 color");
  assert.match(body, /lastColor\s*=\s*color\b/, "lastColor 应被赋值（间接）");
});

test("G2: onAnnSave 函数体记录 lastStyle（来自 annEditor.style）", () => {
  const body = extractFunctionBody(src, "onAnnSave");
  assert.ok(body);
  assert.match(body, /const\s+style\s*=\s*annEditor\.style/, "应从 annEditor.style 取 style");
  assert.match(body, /lastStyle\s*=\s*style\b/, "lastStyle 应被赋值（间接）");
});

test("G3: onAnnSave 函数体记录 lastGroup（来自 annEditor.group）", () => {
  const body = extractFunctionBody(src, "onAnnSave");
  assert.ok(body);
  assert.match(body, /const\s+group\s*=\s*annEditor\.group/, "应从 annEditor.group 取 group");
  assert.match(body, /lastGroup\s*=\s*group\b/, "lastGroup 应被赋值（间接）");
});

// ============ H. 现有功能回归 ============

test("H1: selToolbar 模板保留 7 按钮（复制/高亮/批注/词典/翻译/朗读/发送）", () => {
  // 抽取 selToolbar 模板的按钮区段
  const startIdx = src.indexOf("class=\"reader-sel-toolbar\"");
  assert.ok(startIdx >= 0, "selToolbar 容器应存在");
  // 找到最近的上层 {#if selToolbar.visible} 块（往前推）
  const openTag = src.lastIndexOf("{#if selToolbar.visible}", startIdx);
  assert.ok(openTag >= 0, "selToolbar 条件渲染块应存在");
  const closeTag = src.indexOf("{/if}", openTag);
  assert.ok(closeTag > openTag, "selToolbar 块应闭合");
  const block = src.slice(openTag, closeTag);
  for (const title of ["复制", "高亮", "批注", "词典", "翻译", "朗读", "发送"]) {
    assert.match(block, new RegExp(`title=["']${title}`), `selToolbar 应保留 ${title} 按钮`);
  }
});

test("H2: selToolbar 模板仍有 `class=\"reader-sel-toolbar\"` 根节点", () => {
  assert.match(src, /class="reader-sel-toolbar"/, "selToolbar 根节点 class 应保留");
});

test("H3: annEditor 模板有 backdrop + onAnnCancel（取消路径）", () => {
  assert.match(src, /class="reader-ann-backdrop"\s+on:click=\{onAnnCancel\}/, "annEditor backdrop 点击应调 onAnnCancel");
  assert.match(src, /function\s+onAnnCancel\s*\(/, "onAnnCancel 函数应存在");
});
