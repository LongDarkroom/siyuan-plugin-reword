/**
 * PDF 划词工具栏三问题修复回归（2026-09-09）
 *
 * 锁住三处：
 *  A. 点击命中：PdfTextHlLayer 在 iframe doc 上挂 click 监听，命中文本标注矩形后
 *     回调 onAnnotClick；且必须带「选区折叠」门控（拖选不触发，走 create 工具栏）。
 *  B. z-index：.pdf-text-hl-layer 必须低于 .reader-floating-layer(z-index:2)，
 *     否则波浪线穿过划词工具栏。
 *  C. ReaderView 侧接入：onPdfAnnotClick 透传给组件，并复用 openHighlightEditToolbar。
 *
 * 纯源码切片断言（不启动思源），与项目既有 pdf-*.test.mjs 风格一致。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const layerSrc = readFileSync(join(root, "src/reader/PdfTextHlLayer.svelte"), "utf-8");
const viewSrc = readFileSync(join(root, "src/reader/ReaderView.svelte"), "utf-8");

/** 花括号配对抽取函数体 */
function bodyOf(src, sig) {
  const i = src.indexOf(sig);
  assert.ok(i > 0, `未找到 ${sig}`);
  let j = src.indexOf("{", i + sig.length);
  let depth = 1;
  j += 1;
  const start = j;
  while (j < src.length && depth > 0) {
    const c = src[j];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    j += 1;
  }
  return src.slice(start, j);
}

test("A1 覆盖层新增 onAnnotClick 回调 prop", () => {
  assert.match(layerSrc, /export let onAnnotClick:/, "应导出 onAnnotClick prop");
});

test("A2 iframe doc 上同时挂 contextmenu 与 click（点击命中入口）", () => {
  const b = bodyOf(layerSrc, "function ensureIframeContextmenu");
  assert.match(b, /addEventListener\("contextmenu"/, "保留右键监听");
  assert.match(b, /addEventListener\("click"/, "应新增 click 监听（点击命中文本标注）");
});

test("A3 点击命中带「选区折叠」门控，拖选不触发编辑态", () => {
  const b = bodyOf(layerSrc, "function onIframeClick");
  assert.match(b, /getSelection/, "应读取 iframe 选区");
  assert.match(b, /isCollapsed/, "应以选区折叠为门控（拖选走 create 工具栏）");
  assert.match(b, /kind !== "rect"/, "只命中文本标注（矩形走右键菜单）");
  assert.match(b, /onAnnotClick\(\{/, "命中后回调 onAnnotClick");
});

test("A4 命中回调带主文档坐标与命中矩形（供工具栏避让）", () => {
  const b = bodyOf(layerSrc, "function onIframeClick");
  assert.match(b, /frameElement/, "需用 frame 偏移换算成主文档坐标");
  assert.match(b, /rect:\s*\{/, "回传命中矩形（上下避让定位用）");
});

test("B 覆盖层 z-index 必须低于浮层宿主（2），波浪线不得穿过工具栏", () => {
  const i = layerSrc.indexOf(".pdf-text-hl-layer {");
  assert.ok(i > 0, "未找到层样式块");
  const block = layerSrc.slice(i, i + 420);
  assert.match(block, /z-index:\s*1;/, "层 z-index 应为 1（低于 floating-layer 的 2）");
  assert.doesNotMatch(block, /z-index:\s*6;/, "不得再为 6（会盖住划词工具栏）");
});

test("C1 ReaderView 实现 onPdfAnnotClick 并复用 openHighlightEditToolbar", () => {
  // 注意：不能用 bodyOf —— 参数类型注解里的 `{ ... }` 会让花括号配对错位，
  // 这里用固定窗口切片（函数短小，足够覆盖）。
  const i = viewSrc.indexOf("function onPdfAnnotClick");
  assert.ok(i > 0, "未找到 onPdfAnnotClick");
  const b = viewSrc.slice(i, i + 900);
  assert.match(b, /isPdfBook\(\)/, "仅 PDF 生效");
  assert.match(b, /openHighlightEditToolbar/, "应复用既有编辑态入口（删除+样式+色板）");
  assert.match(b, /editingId === payload\.annId/, "同条标注重复点击不重新定位");
});

test("C2 组件挂载处透传 onAnnotClick", () => {
  assert.match(viewSrc, /onAnnotClick=\{onPdfAnnotClick\}/, "PdfTextHlLayer 应收到回调");
});
