// 词库高亮总开关 + 排除选择器 + 编辑中跳过（2026-08-23 新增）
// ----------------------------------------------------------------
// 用户反馈："高亮杂乱 / 编辑时干扰"，要求：
// 1. 词库面板加总开关，关掉后清空所有高亮 + 停止重扫
// 2. 跳过已包裹的元素：code, pre, .katex, a, mark, .hiword-ann-inline, .hiword-vocab-mark
// 3. 编辑中的块（document.activeElement 在块内）本次跳过，避免反复拆/包 span
// 4. 编辑失焦（focusout）后重新入队该块，恢复高亮
//
// 覆盖：
// - EXCLUDED_SELECTOR 含所有不应高亮的选择器
// - VocabHighlighter.enabled 字段默认 true
// - setEnabled(false) 后 processPending 清空高亮
// - setEnabled(true) 后调用 refreshAll
// - start() 注册 focusout 监听，stop() 移除
// - processPending 跳过含 activeElement 的块
// 不依赖：foliate / siyuan SDK

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const vocabHighlightPath = join(__dirname, "..", "src", "vocab", "vocab-highlight.ts");
const src = readFileSync(vocabHighlightPath, "utf-8");

test("EXCLUDED_SELECTOR 含全部 7 个排除选择器", () => {
  // EXCLUDED_SELECTOR = "code, pre, .katex, a, mark, .hiword-ann-inline, .hiword-vocab-mark"
  // 直接 grep 源码验证（避免复杂 regex 解析）
  const m = src.match(/EXCLUDED_SELECTOR\s*=\s*["']([^"']+)["']/);
  assert.ok(m, "EXCLUDED_SELECTOR 常量应该存在");
  const sel = m[1];
  for (const required of ["code", "pre", ".katex", "a", "mark", ".hiword-ann-inline", ".hiword-vocab-mark"]) {
    assert.ok(sel.includes(required), `EXCLUDED_SELECTOR 应含 ${required}, got: ${sel}`);
  }
});

test("collectHighlightableSegments 用 NodeFilter 排除 EXCLUDED_SELECTOR", () => {
  // 函数体内有 closest(EXCLUDED_SELECTOR) 过滤
  const m = src.match(/function\s+collectHighlightableSegments[\s\S]*?\n\s*\}\s*\n/);
  assert.ok(m, "collectHighlightableSegments should exist");
  const body = m[0];
  assert.match(body, /NodeFilter\.SHOW_TEXT/, "should use NodeFilter.SHOW_TEXT");
  assert.match(body, /closest\s*\(\s*EXCLUDED_SELECTOR\s*\)/, "should use closest(EXCLUDED_SELECTOR)");
  assert.match(body, /FILTER_REJECT/, "should reject nodes inside excluded selector");
  assert.match(body, /FILTER_ACCEPT/, "should accept nodes not inside excluded");
});

test("VocabHighlighter 含 enabled 字段（默认 true）", () => {
  assert.match(src, /private\s+enabled\s*=\s*true/, "VocabHighlighter should have `private enabled = true`");
});

test("VocabHighlighter 含 setEnabled 方法", () => {
  assert.match(src, /setEnabled\s*\(\s*on\s*:\s*boolean\s*\)/, "setEnabled should accept boolean param");
  // 方法体：找 setEnabled 后第一个 { ... } 闭花括号（按行计数）
  const body = extractMethodBody(src, "setEnabled(");
  assert.ok(body, "setEnabled method body should be extractable");
  assert.match(body, /this\.enabled\s*=\s*on/, "should set this.enabled = on");
});

test("setEnabled(false) 清空所有高亮", () => {
  const body = extractMethodBody(src, "setEnabled(");
  assert.ok(body);
  // !on 分支：扫描所有块 → clearVocabMarks
  assert.match(body, /!\s*on/, "should have !on branch");
  assert.match(body, /clearVocabMarks/, "should call clearVocabMarks");
  assert.match(body, /scanBlocks\s*\(\s*this\.currentProtyleEl\s*\)/, "should scanBlocks(currentProtyleEl) to clear all");
});

test("setEnabled(true) 调用 refreshAll", () => {
  const body = extractMethodBody(src, "setEnabled(");
  assert.ok(body);
  assert.match(body, /this\.refreshAll\s*\(\)/, "should call refreshAll()");
});

test("processPending 在 !enabled 时直接清空高亮并返回", () => {
  const body = extractMethodBody(src, "processPending(");
  assert.ok(body, "processPending method body should be extractable");
  assert.match(body, /!\s*this\.enabled/, "should check !this.enabled");
  assert.match(body, /clearVocabMarks/, "should call clearVocabMarks in disabled branch");
  assert.match(body, /this\.pendingBlocks\.clear\(\)/, "should clear pendingBlocks in disabled branch");
});

test("processPending 跳过含 document.activeElement 的块（编辑中块）", () => {
  const body = extractMethodBody(src, "processPending(");
  assert.ok(body);
  assert.match(body, /document\.activeElement/, "should reference document.activeElement");
  // 关键：!b.contains(document.activeElement) — 包含的跳过
  assert.match(body, /!\s*b\.contains\s*\(\s*document\.activeElement\s*\)/, "should filter out blocks containing activeElement");
});

test("start() 注册 focusout 监听（编辑失焦后重新入队该块）", () => {
  const body = extractMethodBody(src, "start(");
  assert.ok(body, "start method body should be extractable");
  assert.match(body, /addEventListener\s*\(\s*['"]focusout['"]/, "should addEventListener focusout");
  // capture phase
  assert.match(body, /addEventListener\s*\(\s*['"]focusout['"][\s\S]*?,\s*true\s*\)/, "should use capture phase (true as 3rd arg)");
  // handler 中找最近 data-node-id 块 → 加入 pendingBlocks
  assert.match(body, /closest\s*\(\s*['"]\[data-node-id\][\'"]\s*\)/, "should find closest [data-node-id] block");
  assert.match(body, /this\.pendingBlocks\.add/, "should add block to pendingBlocks");
});

test("stop() 移除 focusout 监听（防内存泄漏）", () => {
  // 用方法签名 stop(): void 定位（避免命中 this.stop() 等其他用法）
  const sig = "stop(): void";
  const idx = src.indexOf(sig);
  assert.ok(idx > 0, "stop() method signature should exist");
  // 从 idx 后第一个 { 开始
  const start = src.indexOf("{", idx);
  assert.ok(start > 0);
  let depth = 0;
  let body = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        body = src.substring(start, i + 1);
        break;
      }
    }
  }
  assert.ok(body, "stop() method body should be extractable");
  assert.match(body, /removeEventListener\s*\(\s*['"]focusout['"]/, "should removeEventListener focusout");
  // 句柄置 null
  assert.match(body, /this\.onBlurHandler\s*=\s*null/, "should clear onBlurHandler reference");
});

test("[回归] start 注册的 focusout handler 仅响应 protyle 内的失焦（不影响其他面板）", () => {
  const body = extractMethodBody(src, "start(");
  assert.ok(body);
  assert.match(body, /this\.currentProtyleEl/, "should reference this.currentProtyleEl");
  assert.match(body, /currentProtyleEl\.contains\s*\(\s*t\s*\)/, "should check currentProtyleEl.contains(target)");
});

/**
 * 从 src 中按"方法签名"提取方法体（支持嵌套花括号）。
 * @param {string} src 源文件全文
 * @param {string} sig 方法签名特征（如 "setEnabled(" 或 "start("）
 * @returns {string|null} 方法体字符串（含花括号），或 null
 */
function extractMethodBody(src, sig) {
  const idx = src.indexOf(sig);
  if (idx < 0) return null;
  // 找 sig 后的第一个 {
  const start = src.indexOf("{", idx);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.substring(start, i + 1);
    }
  }
  return null;
}

test("[回归] applyVocabMarks（无过滤版本）保留原样（单测 index-vocab-integration.test.mjs 校验其源码模式，不能动）", () => {
  // 旧的 applyVocabMarks 函数体（line 110-188）应当仍存在
  const m = src.match(/export\s+function\s+applyVocabMarks\s*\(/);
  assert.ok(m, "applyVocabMarks should still exist");
  // 抽函数体
  const start = src.indexOf("{", m.index);
  let depth = 0;
  let body = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        body = src.substring(start, i + 1);
        break;
      }
    }
  }
  assert.ok(body, "applyVocabMarks body should be extractable");
  assert.match(body, /NodeFilter\.SHOW_TEXT/, "should use TreeWalker SHOW_TEXT (legacy fallback)");
  // 验证 applyVocabMarksToBlock 存在（过滤后高亮主路径）
  assert.match(src, /export\s+function\s+applyVocabMarksToBlock/, "applyVocabMarksToBlock should exist");
});
