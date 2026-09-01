/**
 * 书架 P2 Phase 1 · PDF 大纲解析
 * ----------------------------------------------------------------
 * 2026-09-01:对齐 Obsidian PDF++ 的 outline / 目录能力。
 * 测试覆盖 src/reader/pdf-outline.ts:
 *  - 数据类型导出(PdfOutlineNode)
 *  - resolvePdfPage 的 4 种 dest 形态(字符串数组 / 对象数组 / RefSet / url)
 *  - flattenPdfOutline 递归展平 + 层级正确
 *  - loadPdfOutline 容错(无 pdfjs / 无 outline / 解析失败)
 *  - extractPdfCurrentPage 反推当前页
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const src = readFileSync(join(__dirname, "..", "src", "reader", "pdf-outline.ts"), "utf-8");

/* ================= 导出 ================= */

test("[导出] PdfOutlineNode 类型导出", () => {
  assert.ok(/export interface PdfOutlineNode\s*\{/.test(src), "应导出 PdfOutlineNode 接口");
  const m = src.match(/export interface PdfOutlineNode\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "应能抽出 PdfOutlineNode");
  for (const f of ["title", "href", "level", "page"]) {
    assert.ok(new RegExp(`\\n\\s*${f}\\??:`).test(m[1]), `PdfOutlineNode.${f} 应存在`);
  }
});

test("[导出] loadPdfOutline / extractPdfCurrentPage 函数导出", () => {
  assert.ok(/export async function loadPdfOutline/.test(src), "应导出 loadPdfOutline");
  assert.ok(/export function extractPdfCurrentPage/.test(src), "应导出 extractPdfCurrentPage");
});

/* ================= 解析 4 种 dest 形态 ================= */

test("[dest] 形态 3:RefSet 对象 → 取 num+1", () => {
  // RefSet: {num, gen}
  const re = /dest\s*===\s*"object"\s*&&\s*!Array\.isArray\(dest\)\s*&&\s*typeof\s*dest\.num\s*===\s*"number"/;
  assert.ok(re.test(src), "应识别 RefSet 对象形态");
});

test("[dest] 形态 2:对象数组 → 取 [0].num+1", () => {
  // dest: [{num, gen}, "XYZ", ...]
  const re = /Array\.isArray\(dest\)\s*&&\s*dest\.length\s*>\s*0[\s\S]*?typeof first\s*===\s*"object"\s*&&\s*first\s*!==\s*null\s*&&\s*typeof first\.num\s*===\s*"number"/;
  assert.ok(re.test(src), "应识别对象数组形态");
});

test("[dest] 形态 1:字符串数组 → 查 doc.getDestination(name)", () => {
  // dest: ["name-ref", "XYZ", ...]
  assert.ok(/typeof first\s*===\s*"string"\s*&&\s*pdfDoc\.getDestination/.test(src),
    "应识别字符串数组形态并调 getDestination");
  // 应能处理异步 getDestination
  assert.ok(/await\s+pdfDoc\.getDestination/.test(src), "getDestination 是异步的,需 await");
});

test("[dest] 形态 4:url 字符串 → 降级返回 0", () => {
  assert.ok(/typeof dest\s*===\s*"string"\)\s*return\s*0/.test(src), "url 字符串应降级返回 0");
});

test("[dest] 兜底:dest 为 null / 数组为空 → 返回 0", () => {
  assert.ok(/if\s*\(!dest\s*\|\|\s*!pdfDoc\)\s*return\s*0/.test(src), "空 dest 应返回 0");
  assert.ok(/Array\.isArray\(dest\)\s*&&\s*dest\.length\s*>\s*0/.test(src), "空数组应短路");
});

test("[dest] PDF.js 内部 0-based → UI 1-based(+1)", () => {
  // 应有 +1 的转换
  const re = /return\s+(?:first|dest|r0)\.num\s*\+\s*1|return\s+dest\.num\s*\+\s*1/;
  assert.ok(re.test(src), "页码应从 0-based 转 1-based");
});

/* ================= flattenPdfOutline 递归 ================= */

test("[递归] flattenPdfOutline 接收嵌套 items 数组,展平 + level 递增", () => {
  assert.ok(/function flattenPdfOutline/.test(src), "应有 flattenPdfOutline 函数");
  // 应递归调用自己(items.length > 0 时)
  assert.ok(/Array\.isArray\(it\.items\)\s*&&\s*it\.items\.length[\s\S]*?await flattenPdfOutline\(it\.items,\s*pdfDoc,\s*level\s*\+\s*1/.test(src),
    "递归调用应传 level+1");
  assert.ok(/await flattenPdfOutline\(it\.items,\s*pdfDoc,\s*level\s*\+\s*1,\s*out\)/.test(src),
    "递归调用应传同一个 out 数组(累加)");
});

test("[递归] href 格式:pdf-page-{n}(n > 0 时)", () => {
  assert.ok(/href:\s*page\s*>\s*0\s*\?\s*`pdf-page-\$\{page\}`\s*:\s*""/.test(src),
    "href 格式应为 pdf-page-{n}");
});

test("[递归] href 为空时仍保留条目(降级展示)", () => {
  // out.push 应在 page 解析后无条件执行
  assert.ok(/out\.push\(\s*\{[\s\S]*?href:\s*page\s*>\s*0\s*\?\s*`pdf-page-\$\{page\}`\s*:\s*""/.test(src),
    "条目应无条件 push,即使 page=0");
});

/* ================= loadPdfOutline 容错 ================= */

test("[容错] pdfjsLib 不可用时返回空数组 + totalPages=0", () => {
  assert.ok(/if\s*\(!pdfjsLib\?\.getDocument\)\s*\{[\s\S]*?return\s*\{\s*nodes:\s*\[\],\s*totalPages:\s*0\s*\};?\s*\}/.test(src),
    "无 pdfjs 时应静默返回空");
});

test("[容错] 大纲为空(扫描版 PDF)→ 返回空数组", () => {
  assert.ok(/!Array\.isArray\(raw\)\s*\|\|\s*raw\.length\s*===\s*0[\s\S]*?return\s*\{\s*nodes:\s*\[\]/.test(src),
    "无大纲时返回空数组,不抛错");
});

test("[容错] 解析过程异常被 try/catch 兜住", () => {
  // loadPdfOutline 整体应包 try/catch,finally 释放 pdfDoc
  assert.ok(/try\s*\{[\s\S]*?\}\s*catch\s*\(e\)[\s\S]*?return\s*\{\s*nodes:\s*\[\],\s*totalPages:\s*0\s*\}/.test(src),
    "外层 try/catch 应吞掉异常返回空");
});

test("[容错] pdfDoc.destroy 在 finally 释放", () => {
  // 截取 loadPdfOutline 函数体(从 export async function 到顶层 },到文件最后第二个 },即函数结束)
  // 简单做法:找 export async function loadPdfOutline 起点 + 最后 1000 字符(整函数最长约 60 行)
  const start = src.indexOf("export async function loadPdfOutline");
  assert.ok(start > 0, "应找到 loadPdfOutline");
  // 函数体一般在 ~60 行内,截 2000 字符够
  const fn = src.slice(start, start + 2000);
  // 验证 destroy 在 finally 块内
  const finallyIdx = fn.indexOf("finally");
  const destroyIdx = fn.indexOf("pdfDoc?.destroy");
  assert.ok(finallyIdx > 0, "应有 finally 块");
  assert.ok(destroyIdx > finallyIdx, "destroy 应在 finally 块内(在 finally 之后)");
});

/* ================= extractPdfCurrentPage ================= */

test("[extract] 优先用 view.renderer.getPageNumber(cfi)", () => {
  assert.ok(/view\?\.renderer\?\.getPageNumber/.test(src), "应优先用 foliate-js 的 page API");
});

test("[extract] 三层兜底:cfi→eventDetail.index→view.lastLocation.index", () => {
  // 三个数据源
  assert.ok(/eventDetail\?\.cfi/.test(src), "兜底 1:eventDetail.cfi");
  assert.ok(/eventDetail\?\.index/.test(src), "兜底 2:eventDetail.index");
  assert.ok(/view\?\.lastLocation\?\.index/.test(src), "兜底 3:view.lastLocation.index");
  // 都 +1 转 1-based
  assert.ok(/eventDetail\.index\s*\+\s*1/.test(src), "应 0-based 转 1-based");
  assert.ok(/view\.lastLocation\.index\s*\+\s*1/.test(src), "应 0-based 转 1-based");
});

/* ================= 与 ReaderView 集成契约 ================= */

test("[集成] 输出格式与 flattenToc 一致(让 reader-toc 抽屉无缝复用)", () => {
  // flattenPdfOutline 整体函数体
  const m = src.match(/async function flattenPdfOutline[\s\S]*?\n\}/);
  assert.ok(m, "应能抽出 flattenPdfOutline 函数体");
  assert.ok(/out\.push\(\s*\{[\s\S]*?title,\s*\n\s*href:[\s\S]*?level,\s*\n\s*page,[\s\S]*?\}\s*\)/.test(m[0]),
    "push 应含 title/href/level/page 四字段");
  // 整体输出是数组
  assert.ok(/return\s+out;/.test(m[0]), "应返回累积的 out 数组");
});
