/**
 * PDF 文本标注「双绘漂移层」根治（2026-09-09）源码切片断言。
 *
 * 现象：PDF 文字高亮正确显示的同时，其上叠了一层整体漂移的高亮。
 *
 * 根因：设计上 PDF 文本标注视觉单一真源是自建覆盖层 PdfTextHlLayer，
 * 保存路径（saveHighlight / onNoteSave 更新分支）已短路 foliate 原生管线，
 * 但恢复与编辑路径漏了过滤——fixed-layout 每页 frame 也会创建 overlayer 并
 * 派发 create-overlay，onCreateOverlay / redrawBookAnnotations / 撤销删除 /
 * 改色改样式（applyViewer 系列 / applyEdit 系列）把 PDF 标注喂给 view.addAnnotation →
 * foliate 原生 Overlayer 在页面 SVG 上按 DOM range 画第二层；
 * PDF 文本层带缩放 transform，原生 SVG 坐标系不匹配 → 该层整体漂移。
 *
 * 修复：三处守卫——addReaderAnnotation 入口拒绘 PDF（唯一收口，覆盖全部调用方）、
 * onCreateOverlay 与 redrawBookAnnotations 对 PDF 直接跳过。
 */
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const viewSrc = readFileSync(join(root, "src/reader/ReaderView.svelte"), "utf-8");

/** 花括号配对提取函数体（与 pdf-progress-restore.test.mjs 同款 bodyOf） */
function bodyOf(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return "";
  const start = src.indexOf("{", i);
  if (start < 0) return "";
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const ch = src[j];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  return "";
}

test("addReaderAnnotation 入口：PDF 拒绘（唯一收口，覆盖改色/改样式/撤销删除等全部调用方）", () => {
  const b = bodyOf(viewSrc, "async function addReaderAnnotation");
  assert.ok(b, "应取到 addReaderAnnotation 函数体");
  const deletedAtPos = b.indexOf("it.deletedAt");
  assert.ok(deletedAtPos > 0, "软删除守卫应仍在");
  const guardPos = b.indexOf("if (isPdfBook()) return;");
  assert.ok(guardPos > deletedAtPos, "PDF 拒绘守卫应在软删除守卫之后、addAnnotation 调用之前");
  assert.match(b, /view\.addAnnotation/, "函数体仍应保留 foliate 原生调用（EPUB 用）");
});

test("onCreateOverlay：PDF 直接跳过（fixed-layout 每页触发，不必逐条空跑）", () => {
  const b = bodyOf(viewSrc, "function onCreateOverlay");
  assert.ok(b, "应取到 onCreateOverlay 函数体");
  assert.match(b, /if\s*\(\s*isPdfBook\(\)\s*\)\s*return;/, "PDF 应提前 return");
});

test("redrawBookAnnotations：PDF 直接跳过（relocate / 页签可见性兜底不得喂原生管线）", () => {
  const b = bodyOf(viewSrc, "function redrawBookAnnotations");
  assert.ok(b, "应取到 redrawBookAnnotations 函数体");
  assert.match(b, /if\s*\(\s*isPdfBook\(\)\s*\)\s*return;/, "PDF 应提前 return");
});

test("守卫注释记录双绘机制（create-overlay 每页触发 + transform 坐标系不匹配 → 漂移层）", () => {
  // 用完整短语定位（「双绘根治」已有 ②号保存端注释在前，短词会取错窗口）
  const i = viewSrc.indexOf("双绘根治：PDF 文本标注视觉单一真源");
  assert.ok(i > 0, "应存在双绘根治注释");
  const seg = viewSrc.slice(i, i + 500);
  assert.match(seg, /create-overlay/, "注释应提及 create-overlay 每页触发");
  assert.match(seg, /PdfTextHlLayer/, "注释应指明单一真源是自建覆盖层");
});
