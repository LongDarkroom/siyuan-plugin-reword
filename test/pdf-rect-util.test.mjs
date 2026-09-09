// PDF 矩形框选纯函数单测（2026-09-09 P1.3）
// 被测模块零 DOM / 零思源 API 依赖，可直接导入。
import test from "node:test";
import assert from "node:assert/strict";
import {
  collectPageHits,
  normalizeSelToRect,
  buildRectLinkTitle,
  buildRectDeepLink,
  buildRectMarkdown,
  RECT_MIN_PX,
} from "../src/reader/pdf-rect-util.ts";

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });

/* ===== collectPageHits：页命中收集 ===== */

test("单页框选 → 命中一页", () => {
  const frames = [
    { index: 0, rect: rect(0, 0, 800, 1000) },
    { index: 1, rect: rect(800, 0, 1600, 1000) },
  ];
  const hits = collectPageHits(rect(100, 100, 300, 200), frames);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].page, 1);
});

test("跨页框选 → 两页都命中，按重叠面积降序", () => {
  const frames = [
    { index: 0, rect: rect(0, 0, 800, 1000) },
    { index: 1, rect: rect(800, 0, 1600, 1000) },
  ];
  // 左页重叠 150 宽，右页重叠 50 宽 → 左页排前
  const hits = collectPageHits(rect(700, 100, 890, 300), frames);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.page), [1, 2]);
  assert.ok(hits[0].overlap > hits[1].overlap);
});

test("重叠小于最小拖拽尺寸的页被过滤（4px < RECT_MIN_PX）", () => {
  const frames = [
    { index: 0, rect: rect(0, 0, 800, 1000) },
    { index: 1, rect: rect(800, 0, 1600, 1000) },
  ];
  // 左页重叠 20px 宽（有效），右页只重叠 4px（应过滤）
  const hits = collectPageHits(rect(780, 100, 804, 300), frames);
  assert.equal(hits.length, 1, "右页只重叠 4px，应被过滤");
  assert.equal(hits[0].page, 1);
});

test("框选完全不在任何页上 → 空数组", () => {
  const frames = [{ index: 0, rect: rect(0, 0, 800, 1000) }];
  assert.equal(collectPageHits(rect(2000, 2000, 2100, 2100), frames).length, 0);
});

/* ===== normalizeSelToRect：归一化（与高亮/重绘同基准） ===== */

test("主文档坐标 → 页内归一化矩形", () => {
  const r = normalizeSelToRect(rect(100, 50, 300, 250), 0, 0, 800, 1000);
  assert.ok(r);
  assert(Math.abs(r.x - 0.125) < 1e-9);
  assert(Math.abs(r.y - 0.05) < 1e-9);
  assert(Math.abs(r.w - 0.25) < 1e-9);
  assert(Math.abs(r.h - 0.2) < 1e-9);
});

test("textLayer 有偏移时按基准原点换算", () => {
  const r = normalizeSelToRect(rect(110, 60, 310, 260), 10, 10, 800, 1000);
  assert.ok(r);
  assert(Math.abs(r.x - 0.125) < 1e-9);
  assert(Math.abs(r.y - 0.05) < 1e-9);
});

test("越界部分被钳制在页内（不产生负坐标 / 超 1 宽高）", () => {
  const r = normalizeSelToRect(rect(-50, -50, 400, 300), 0, 0, 800, 1000);
  assert.ok(r);
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
  assert(Math.abs(r.w - 0.5) < 1e-9);
  assert(Math.abs(r.h - 0.3) < 1e-9);
});

test("边长低于阈值 → null（视为不在该页上）", () => {
  assert.equal(normalizeSelToRect(rect(0, 0, 1, 100), 0, 0, 800, 1000), null);
});

test("零宽高基准不崩溃（回落 1px 基准，字段恒为有限数）", () => {
  // 基准宽高为 0 时按 1px 处理：亚像素选区可归一化
  const tiny = normalizeSelToRect(rect(0, 0, 0.5, 0.5), 0, 0, 0, 0);
  assert.ok(tiny, "亚像素选区应返回有效矩形");
  for (const v of [tiny.x, tiny.y, tiny.w, tiny.h]) assert.equal(Number.isFinite(v), true);
  // 超出 1px 基准的选区被钳成负宽高 → 判定不在页上，返回 null 而非 NaN
  assert.equal(normalizeSelToRect(rect(10, 10, 50, 50), 0, 0, 0, 0), null);
});

/* ===== 链接标题 / 深链 / markdown ===== */

test("标题格式：书名 · 第 N 页；空书名回落 PDF", () => {
  assert.equal(buildRectLinkTitle("我的书", 3), "我的书 · 第 3 页");
  assert.equal(buildRectLinkTitle("", 12), "PDF · 第 12 页");
  assert.ok(!buildRectLinkTitle("我的书", 3).includes("ann-"), "可见标题不携带标注 id");
});

test("深链 host 用插件名（思源派发给插件自身处理器 → 复用 Tab）", () => {
  const url = buildRectDeepLink("book-1", "ann-9");
  assert.ok(url.startsWith("siyuan://plugins/siyuan-plugin-reword?data="));
  const data = JSON.parse(decodeURIComponent(url.split("data=")[1]));
  assert.equal(data.bookId, "book-1");
  assert.equal(data.cfi, "pdf-rect:ann-9");
});

test("深链缺参 → 空串（不生成坏链接）", () => {
  assert.equal(buildRectDeepLink("", "ann-9"), "");
  assert.equal(buildRectDeepLink("book-1", ""), "");
});

test("markdown：链接行 + 图片行；无截图只有链接行", () => {
  const withImg = buildRectMarkdown("b1", "书", [{ page: 2, id: "a1", assetPath: "assets/x.png" }]);
  const lines = withImg.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("[书 · 第 2 页](siyuan://plugins/siyuan-plugin-reword?data="));
  assert.ok(lines[0].endsWith(")"));
  assert.equal(lines[1], "![](assets/x.png)");
  const noImg = buildRectMarkdown("b1", "书", [{ page: 2, id: "a1", assetPath: "" }]);
  assert.equal(noImg.split("\n").length, 1);
  assert.ok(noImg.startsWith("[书 · 第 2 页]("));
});

test("markdown 跨页：每页一节（两页 = 4 行）", () => {
  const md = buildRectMarkdown("b1", "书", [
    { page: 2, id: "a1", assetPath: "assets/x1.png" },
    { page: 3, id: "a2", assetPath: "assets/x2.png" },
  ]);
  assert.equal(md.split("\n").length, 4);
  assert.ok(md.includes("第 2 页") && md.includes("第 3 页"));
  assert.ok(!md.includes("](["), "不得出现嵌套链接（Invalid URL 回归）");
});

test("markdown 跳过无 id 的坏条目", () => {
  const md = buildRectMarkdown("b1", "书", [{ page: 1, id: "", assetPath: "assets/x.png" }]);
  assert.equal(md, "");
});

test("常量导出：最小拖拽尺寸为 8px", () => {
  assert.equal(RECT_MIN_PX, 8);
});
