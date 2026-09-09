/**
 * pdf-double-draw-chokepoint.test.mjs — PDF 双绘最终收口 + 发热治理（2026-09-09）
 *
 * 锁四件事：
 * 1. view-light.js / view.js 的 addAnnotation 最深收口守卫（PDF 非搜索非删除一律不画）。
 *    背景：ReaderView 实际 import 的是 view-light.js，view.js 不在运行路径——
 *    守卫必须两份都有，缺一不可。
 * 2. pdf.js 桌面端 canvas 像素预算（深缩放位图爆炸 → 发热治理）。
 * 3. PdfTextHlLayer recompute 签名去抖（几何不变不触发 Svelte 重渲）。
 * 4. dedupeNestedRects 纯函数行为：嵌套矩形被删、正常行/片段保留。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf-8");

test("view-light.js addAnnotation 有 PDF 收口守卫（运行路径）", () => {
  const src = read("src/reader/vendor/foliate-js/view-light.js");
  const re = /async addAnnotation\(annotation, remove\) \{[\s\S]{0,600}?rewordPdf && !remove/;
  assert.match(src, re, "addAnnotation 头部必须紧跟 rewordPdf 收口守卫");
  assert.ok(
    src.includes("if (this.book?.rewordPdf && !remove && !value.startsWith(SEARCH_PREFIX)) return"),
    "守卫必须放行 remove 与搜索前缀",
  );
});

test("view.js addAnnotation 同样有收口守卫（防切换孪生文件）", () => {
  const src = read("src/reader/vendor/foliate-js/view.js");
  assert.ok(
    src.includes("if (this.book?.rewordPdf && !remove && !value.startsWith(SEARCH_PREFIX)) return"),
  );
});

test("ReaderView 实际加载的是 view-light.js（守卫落点依据）", () => {
  const src = read("src/reader/ReaderView.svelte");
  assert.match(src, /import "\.\.\/reader\/vendor\/foliate-js\/view-light\.js";/);
});

test("pdf.js 桌面端 canvas 像素预算生效", () => {
  const src = read("src/reader/vendor/foliate-js/pdf.js");
  assert.ok(src.includes("MAX_CANVAS_PIXELS_DESKTOP"), "必须定义桌面预算常量");
  const fn = src.indexOf("const getRenderDpr");
  const body = src.slice(fn, src.indexOf("const render = async", fn));
  assert.match(body, /else \{[\s\S]*MAX_CANVAS_PIXELS_DESKTOP/, "桌面分支必须做面积钳制");
});

test("PdfTextHlLayer recompute 签名去抖（几何不变不重渲）", () => {
  const src = read("src/reader/PdfTextHlLayer.svelte");
  assert.ok(src.includes("function computeRects()"), "矩形计算须拆为纯计算函数");
  assert.ok(src.includes("lastRectsSig"), "须有签名比对变量");
  const recompute = src.slice(src.indexOf("function recompute()"), src.indexOf("function computeRects"));
  assert.ok(recompute.includes("sig === lastRectsSig"), "相同签名直接跳过赋值");
  assert.ok(!/rects\s*=\s*\[\]/.test(src.slice(src.indexOf("function computeRects"), src.indexOf("function rectCss"))),
    "computeRects 内不得再反复赋值 rects（改用 return []）");
});

test("保存端与绘制端都接了 dedupeNestedRects", () => {
  const rv = read("src/reader/ReaderView.svelte");
  assert.match(rv, /dedupeNestedRects\(norm\)/, "保存端归一化后去嵌套");
  const layer = read("src/reader/PdfTextHlLayer.svelte");
  assert.match(layer, /dedupeNestedRects\(/, "绘制端按标注去嵌套（兼容存量脏数据）");
});

test("dedupeNestedRects 行为：嵌套删除、同行片段与相邻行保留", async () => {
  const mod = await import(join(root, "src/reader/pdf-rect-util.ts"));
  const { dedupeNestedRects } = mod;
  // 实录形态：同一行两套嵌套矩形（h=0.0146 与内含的 h=0.0106）
  const line = (y, h, x = 0.42, w = 0.2) => ({ x, y, w, h, page: 3 });
  const input = [
    line(0.6671, 0.0146),
    line(0.6692, 0.0106), // 完全内含于上一条 → 应删
    line(0.6833, 0.0106),
    line(0.6812, 0.0146),
  ];
  const out = dedupeNestedRects(input);
  assert.equal(out.length, 2, "每行只留外层一条");
  // 相邻行（y 不重叠）必须保留
  const two = dedupeNestedRects([line(0.65, 0.014), line(0.666, 0.014)]);
  assert.equal(two.length, 2, "相邻行不合并");
  // 同行不重叠的水平片段（斜体分段）必须保留
  const segs = dedupeNestedRects([
    line(0.6953, 0.0146, 0.42, 0.079),
    line(0.6953, 0.0146, 0.504, 0.038),
  ]);
  assert.equal(segs.length, 2, "水平片段不去重");
});
