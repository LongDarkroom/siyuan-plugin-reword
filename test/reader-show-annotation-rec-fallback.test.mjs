// 阅读器 - show-annotation 失败兜底 + 宽松 cfi 匹配测试（2026-08-24）
// ----------------------------------------------------------------
// 用户反馈：再次点击高亮后没有出现工具栏。
//
// 根因：
//   1. foliate 内部存储的 cfi 与 annStore 存的 cfi 格式可能不一致
//      （如 epubcfi(...) 包装层、normalize 差异），精确 === 比较静默失败。
//   2. show-annotation handler 在 rec 找不到时直接 return（无任何 UI 反馈）。
//   3. onContainerMouseDown 抢占 click 时序，foliate 内部 SVG 高亮被误判为
//      "外部点击" 而关掉 selToolbar（与随后 show-annotation 弹出产生竞争）。
//
// 修复：
//   1. rec 查找：先 annByValue.get(value) → 失败时去掉 epubcfi() 包装做宽松匹配。
//   2. rec 找不到时：弹 selToolbar(create 模式) + toast 兜底（用户至少能继续操作）。
//   3. onContainerMouseDown：foliate-view 内任意 SVG / foliate-highlight /
//      data-annotation 元素都不关 selToolbar。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const readerViewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const src = readFileSync(readerViewPath, "utf-8");

/** 抽 onShowAnnotation 函数体（从 function onShowAnnotation 到对应大括号闭合） */
function extractShowAnnotationHandler(src) {
  const sig = "function onShowAnnotation";
  const idx = src.indexOf(sig);
  if (idx < 0) return null;
  // 跳过签名到函数体 {
  let i = idx + sig.length;
  while (i < src.length && src[i] !== "{") i++;
  const openIdx = i;
  if (openIdx < 0) return null;
  let depth = 1;
  i = openIdx + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return src.slice(openIdx, i);
}

/** 抽 onContainerMouseDown 函数体 */
function extractOnContainerMouseDown(src) {
  const m = src.match(/function\s+onContainerMouseDown\s*\(/);
  if (!m) return null;
  const start = m.index + m[0].length;
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

// ============ A. show-annotation 宽松 cfi 匹配 ============

test("A1: show-annotation handler 定义 normCfi 帮助函数（去 epubcfi() 包装）", () => {
  const handler = extractShowAnnotationHandler(src);
  assert.ok(handler, "show-annotation 监听器应存在");
  assert.match(handler, /normCfi/, "应有 normCfi 帮助函数");
  assert.match(handler, /epubcfi/, "normCfi 应处理 epubcfi 包装");
});

test("A2: show-annotation handler 在 annByValue 失败时用 annStore 兜底", () => {
  const handler = extractShowAnnotationHandler(src);
  assert.ok(handler);
  assert.match(handler, /annStore[\s\S]{0,20}getByBook/, "应使用 annStore.getByBook 兜底");
  assert.match(handler, /normCfi\(it\.cfi\)\s*===\s*target/, "annStore 兜底应用 normCfi 比较");
});

test("A3: show-annotation handler 兜底命中后回填 annByValue（后续走快路径）", () => {
  const handler = extractShowAnnotationHandler(src);
  assert.ok(handler);
  assert.match(handler, /annByValue\.set\s*\(\s*value\s*,/, "annStore 兜底命中后应回填 annByValue");
});

// ============ B. show-annotation 失败兜底（弹 selToolbar(create) + toast） ============

test("B1: rec 找不到时弹 selToolbar（create 模式）兜底", () => {
  const handler = extractShowAnnotationHandler(src);
  assert.ok(handler);
  // rec 失败分支应该设 selToolbar.visible=true（兜底 UI）
  // 这里宽松匹配：handler 内部有 selToolbar = { ... visible: true
  assert.match(handler, /selToolbar\s*=\s*\{[^}]*visible:\s*true/s, "rec 失败分支应设 selToolbar.visible=true");
});

test("B2: rec 找不到时有可见的用户反馈（如清除残留高亮入口）", () => {
  const handler = extractShowAnnotationHandler(src);
  assert.ok(handler);
  // 2026 修正（原断言具体 toast 文案「批注记录未找到」）：
  // 2026-08-24 死锁解除改为「弹 edit 工具栏 + 清除残留高亮按钮」，刻意**不再**弹 toast
  // ——按钮本身就能说明情况，且给了用户可操作的出口，比一闪而过的 toast 更实用。
  // 因此这里只断言「存在可见反馈」，不断言具体形式。
  const hasToast = /toast\s*\(/.test(handler);
  const hasVisibleUi = /selToolbar\s*=\s*\{[^}]*visible:\s*true/s.test(handler);
  assert.ok(
    hasToast || hasVisibleUi,
    "rec 找不到时必须有可见反馈（toast 或兜底工具栏）"
  );
});

test("B3: rec 找不到分支不再 silent return（必须有可见 UI 反馈）", () => {
  const handler = extractShowAnnotationHandler(src);
  assert.ok(handler);
  // 早期 fix 的 `if (!rec) return;` 应被替换为包含 toast/selToolbar 设置的兜底分支
  // 这里只验证 handler 不再有 `if (!rec) return;`（早期 silent return）
  assert.doesNotMatch(handler, /if\s*\(\s*!rec\s*\)\s*return\s*;?/, "早期 `if (!rec) return;` 静默失败应被替换");
});

// ============ C. onContainerMouseDown foliate 内部点击更宽容 ============

test("C1: onContainerMouseDown 排除 foliate-highlight 类（高亮 SVG g 元素）", () => {
  const body = extractOnContainerMouseDown(src);
  assert.ok(body);
  assert.match(body, /foliate-highlight/, "应排除 foliate-highlight 类");
});

test("C2: onContainerMouseDown 排除 data-annotation 属性元素", () => {
  const body = extractOnContainerMouseDown(src);
  assert.ok(body);
  assert.match(body, /\[data-annotation\]/, "应排除 data-annotation 元素");
});

test("C3: onContainerMouseDown 排除任意 SVG 命名空间元素（foliate 用 svg 画高亮）", () => {
  const body = extractOnContainerMouseDown(src);
  assert.ok(body);
  assert.match(body, /namespaceURI\s*===\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/, "应排除 SVG 命名空间元素");
});

test("C4: onContainerMouseDown 仍保留原有 foliate-view 排除（向后兼容）", () => {
  const body = extractOnContainerMouseDown(src);
  assert.ok(body);
  assert.match(body, /foliate-view/, "应保留 foliate-view 排除");
});
