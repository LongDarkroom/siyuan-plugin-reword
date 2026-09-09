/**
 * PDF 标注打磨（2026-09-09）源码切片断言：A 波浪线真化 / B 标注列表升级 / C 删除撤销。
 *
 * A. 波浪线此前是 border-bottom dotted 点线近似，与 EPUB 的 squiggly 观感不一致；
 *    改为底部平铺 SVG 波形背景（颜色编码进 data URI）。
 * B. 「本书摘录」→「标注与摘录」：条目加类型标识；jumpAnnot 在 PDF 一律走
 *    goPdfPage + flashRect（CFI 语义是整页，goTo 只有页级定位），墨迹除外。
 * C. 删除撤销统一窗口：软删记录进 pendingDelete，快照图片延迟到窗口结束才清理；
 *    未命中矩形时右键弹「撤销删除」；Cmd/Ctrl+Z 仅在有待撤销项时消费。
 */
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const layerSrc = readFileSync(join(root, "src/reader/PdfTextHlLayer.svelte"), "utf-8");
const viewSrc = readFileSync(join(root, "src/reader/ReaderView.svelte"), "utf-8");

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

/* ---------------- A. 波浪线真化 ---------------- */

test("A1 波浪线：改用 SVG 波形背景平铺，不再是 border dotted 点线", () => {
  const b = bodyOf(layerSrc, "function rectCss");
  assert.ok(b, "应取到 rectCss 函数体");
  assert.match(b, /data:image\/svg\+xml/, "wavy 分支应生成 SVG data URI");
  assert.match(b, /background-repeat:repeat-x/, "波形应横向重复平铺");
  assert.match(b, /background-size:16px 6px/, "波形单元尺寸固定 16x6");
  assert.match(b, /encodeURIComponent/, "颜色需编码进 data URI（含 # 等字符）");
});

test("A2 直线段：仍为底部实线（未被波浪线改动波及）", () => {
  const b = bodyOf(layerSrc, "function rectCss");
  assert.match(b, /border-bottom:2px solid \$\{color\}/, "solid 分支仍是实线");
});

/* ---------------- B. 标注与摘录子区 ---------------- */

test("B1 jumpAnnot：PDF 不再走 goTo(cfi)，统一页码跳转", () => {
  const b = bodyOf(viewSrc, "async function jumpAnnot");
  assert.ok(b, "应取到 jumpAnnot 函数体");
  assert.match(b, /it\?\.cfi && !isPdfBook\(\)/, "CFI 跳转仅限非 PDF");
  assert.match(b, /goPdfPage\(targetPage\)/, "PDF 走页码跳转");
});

test("B2 jumpAnnot：闪烁定位扩展到文本标注（仅墨迹跳过）", () => {
  const b = bodyOf(viewSrc, "async function jumpAnnot");
  assert.match(b, /it\.kind !== "ink"/, "墨迹无矩形元素，跳过 flashRect");
  assert.match(b, /pdfHlLayerComp\?\.flashRect\(it\.id\)/, "其余标注跳页后闪烁定位");
});

test("B3 列表条目：类型 glyph / 文案解析函数齐备", () => {
  const g = bodyOf(viewSrc, "function annotGlyph");
  assert.ok(g, "应定义 annotGlyph");
  for (const glyph of ["✎", "▭", "💬"]) assert.ok(g.includes(glyph), `glyph 应覆盖 ${glyph}`);
  assert.match(g, /ANNOTATION_STYLES\[normalizeAnnotationStyle/, "文本标注按样式取图标");
  assert.ok(viewSrc.includes("function annotKindLabel"), "应定义 annotKindLabel（tooltip）");
});

test("B4 子区更名「标注与摘录」并渲染类型标识", () => {
  assert.match(viewSrc, /标注与摘录/, "子区标题应更名");
  assert.match(viewSrc, /reader-annot-kind/, "模板/样式应含类型标识元素");
});

/* ---------------- C. 删除撤销 ---------------- */

test("C1 撤销窗口统一入口 armUndoFor：快照延迟清理", () => {
  const b = bodyOf(viewSrc, "function armUndoFor");
  assert.ok(b, "应定义 armUndoFor");
  assert.match(b, /pendingDelete = rec/, "登记待撤销记录");
  assert.match(b, /removeFile/, "窗口结束后清理快照文件");
  assert.match(b, /setTimeout\(/, "延迟到撤销窗口结束（非立即删图）");
  assert.match(b, /toastWithUndo/, "提示带撤销入口");
});

test("C2 矩形删除：覆盖层不再立即删图，改由 ReaderView 托管撤销", () => {
  const b = bodyOf(layerSrc, "async function deleteRectAnnotation");
  assert.ok(b, "应取到 deleteRectAnnotation 函数体");
  assert.ok(!b.includes("removeFile"), "组件内不应再直接删快照文件");
  assert.match(b, /onRectDeleted\?\.\(id\)/, "删除后回调 ReaderView 登记撤销");
});

test("C3 右键菜单：待撤销时在未命中矩形处弹「撤销删除」", () => {
  assert.match(layerSrc, /let pendingUndo/, "组件应接收 pendingUndo prop");
  assert.match(layerSrc, /let onUndoDelete/, "组件应接收 onUndoDelete prop");
  const b = bodyOf(layerSrc, "function onIframeContextmenu");
  assert.match(b, /if \(pendingUndo\)/, "未命中矩形时检查待撤销状态");
  assert.match(b, /menuUndoOpen = true/, "打开撤销小菜单");
  assert.match(layerSrc, /撤销删除/, "菜单项文案");
});

test("C4 Cmd/Ctrl+Z：仅在存在待撤销项时消费按键", () => {
  const b = bodyOf(viewSrc, "function onGlobalKey");
  assert.match(b, /e\.key\.toLowerCase\(\) === "z" && pendingDelete/, "无待撤销项则放行");
  assert.match(b, /e\.preventDefault\(\)/, "命中时阻止原生撤销");
  assert.match(b, /void undoDelete\(\)/, "执行撤销");
});

test("C5 列表删除也进撤销窗口（矩形与文本统一）", () => {
  const b = bodyOf(viewSrc, "async function removeAnnot");
  assert.match(b, /armUndoFor\(rec\)/, "删除后登记撤销窗口");
  assert.ok(!b.includes("removeFile"), "不再立即删图（交给窗口延迟清理）");
});
