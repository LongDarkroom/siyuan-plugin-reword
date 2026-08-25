// 阅读器 - 安全删除标注 v4 修复测试（2026-08-24）
// ----------------------------------------------------------------
// v3 修复用错 foliate Overlayer 的 SVG 节点属性（svgRoot/root 不存在），
// 导致 forceRedrawSectionAnnotations 清空 SVG 失败。
// v4 修复：
//   1) directRemoveFromDom 用 `layer.element` 拿真 SVG 节点 + 删前后 querySelectorAll("g").length 对比
//   2) forceRedrawSectionAnnotations 用 `layer.element` 替代 `svgRoot`
//   3) safeDeleteAnnotation 步骤 1 await view.deleteAnnotation，让 foliate 内部 await resolveNavigation 真正完成

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewPath = join(__dirname, "..", "src/reader/ReaderView.svelte");
const viewSrc = readFileSync(viewPath, "utf-8");

/** 抽函数体（处理嵌套花括号 + 跳过返回类型注解） */
function extractFunction(src, name) {
  const m = src.match(new RegExp(`function\\s+${name}\\s*[<(]`));
  if (!m) return null;
  const start = m.index + m[0].length;
  // 跳过参数列表（找匹配的 )）
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    i++;
  }
  // 跳过返回类型注解（... : { ... } ...）
  // 继续找到函数体真正的 {，跳过返回类型里的 {
  // 简单做法：跳到 {，并检查它之前是否是返回类型（如果是，记录并继续找下一个 {）
  while (i < src.length && src[i] !== "{") i++;
  if (i >= src.length) return null;
  let openIdx = i;
  // 检查 { 之前是否 ": {"（返回类型注解）—— 简单做法：直接当成函数体起点
  // 改进：如果 src.slice(openIdx-2, openIdx) 含 ": " 则是返回类型注解
  const before = src.slice(Math.max(0, openIdx - 5), openIdx);
  if (before.includes(":")) {
    // 是返回类型注解，跳过它找下一个 {
    depth = 1;
    i++;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    // 现在 i 在返回类型 } 之后，继续找函数体 {
    while (i < src.length && src[i] !== "{") i++;
    if (i >= src.length) return null;
    openIdx = i;
  }
  // 现在 openIdx 是函数体真正的 {
  depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return src.slice(openIdx, i);
}

// ============ A. directRemoveFromDom v4 ============

test("A1: directRemoveFromDom 用 layer.element 拿真 SVG 节点（不用 svgRoot/root）", () => {
  const body = extractFunction(viewSrc, "directRemoveFromDom");
  assert.ok(body, "directRemoveFromDom 函数应存在");
  // v4 修复：应用 layer.element 而非 layer.svgRoot
  assert.match(body, /layer as any\)\.element/, "应用 (layer as any).element 取 SVG 节点");
  assert.doesNotMatch(body, /layer as any\)\.svgRoot/, "不应再用 (layer as any).svgRoot（v3 bug）");
  assert.doesNotMatch(body, /layer as any\)\.root(?!\.)/, "不应再用 (layer as any).root（v3 bug，根目录中文字匹配不算）");
});

test("A2: directRemoveFromDom 用 querySelectorAll(\"g\").length 真实验证删除", () => {
  const body = extractFunction(viewSrc, "directRemoveFromDom");
  assert.ok(body);
  // 应用前后对比
  assert.match(body, /beforeCount\s*=\s*svgEl\?\.querySelectorAll\(\s*["']g["']\s*\)\.length/, "应有 beforeCount = svgEl?.querySelectorAll('g').length");
  assert.match(body, /afterCount\s*=\s*svgEl\?\.querySelectorAll\(\s*["']g["']\s*\)\.length/, "应有 afterCount = svgEl?.querySelectorAll('g').length");
  assert.match(body, /afterCount\s*<\s*beforeCount/, "应对比 afterCount < beforeCount 决定是否真的删了");
  assert.match(body, /removedAnyActualChild\s*=\s*true/, "真实验证后设 removedAnyActualChild = true");
});

// ============ B. forceRedrawSectionAnnotations v4 ============

test("B1: forceRedrawSectionAnnotations 用 layer.element 替代 svgRoot", () => {
  const body = extractFunction(viewSrc, "forceRedrawSectionAnnotations");
  assert.ok(body, "forceRedrawSectionAnnotations 函数应存在");
  assert.match(body, /layer as any\)\.element/, "应用 (layer as any).element");
  assert.doesNotMatch(body, /layer as any\)\.svgRoot/, "不应再用 (layer as any).svgRoot（v3 bug）");
});

test("B2: forceRedrawSectionAnnotations 用 while (svgEl.firstChild) svgEl.removeChild 清空", () => {
  const body = extractFunction(viewSrc, "forceRedrawSectionAnnotations");
  assert.ok(body);
  assert.match(body, /while\s*\(\s*svgEl\.firstChild\s*\)\s*svgEl\.removeChild/, "应用 while (svgEl.firstChild) svgEl.removeChild() 清空 SVG");
});

test("B3: forceRedrawSectionAnnotations 从 annStore 重绘其余批注（按 normalizeCfi 排除目标）", () => {
  const body = extractFunction(viewSrc, "forceRedrawSectionAnnotations");
  assert.ok(body);
  assert.match(body, /annStore\.getByBook/, "应从 annStore.getByBook 读其余批注");
  assert.match(body, /normalizeCfi\(it\.cfi\)\s*!==\s*normalizeCfi\(targetCfi\)/, "应用 normalizeCfi 排除目标");
  assert.match(body, /view\?\.addAnnotation/, "应用 foliate addAnnotation 重绘");
});

test("B4: forceRedrawSectionAnnotations 返回值依赖 redrawOk（不总返回 true）", () => {
  const body = extractFunction(viewSrc, "forceRedrawSectionAnnotations");
  assert.ok(body);
  assert.match(body, /redrawOk\s*=\s*true/, "应在 addAnnotation 成功后设 redrawOk = true");
  assert.match(body, /return\s+redrawOk/, "应返回 redrawOk 而非固定 true");
});

// ============ C. safeDeleteAnnotation v4 ============

test("C1: safeDeleteAnnotation 步骤 1 await view.deleteAnnotation（让 foliate 内部 await resolveNavigation 真正完成）", () => {
  const body = extractFunction(viewSrc, "safeDeleteAnnotation");
  assert.ok(body, "safeDeleteAnnotation 函数应存在");
  assert.match(body, /await\s+view\.deleteAnnotation/, "步骤 1 应 await view.deleteAnnotation");
});

test("C2: safeDeleteAnnotation 步骤 2b 调 forceRedrawSectionAnnotations 兜底", () => {
  const body = extractFunction(viewSrc, "safeDeleteAnnotation");
  assert.ok(body);
  assert.match(body, /domResult\.needsRedraw/, "应检查 needsRedraw 标志");
  assert.match(body, /forceRedrawSectionAnnotations\s*\(\s*cfi\s*\)/, "应调 forceRedrawSectionAnnotations");
});
