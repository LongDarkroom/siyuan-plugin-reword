/**
 * 冒烟测试 · 书籍格式判定（阶段 0 新增）
 * ----------------------------------------------------------------
 * 为什么加这个：阅读器拆成独立插件后，「给定一个文件路径 → 该走 EPUB 渲染还是
 * PDF 渲染」是入口第一道分流。判错会导致整本书打不开（黑屏 / 白屏），
 * 而这条路径目前只有源码文本断言保护，没有行为验证。
 *
 * 覆盖：resolveReaderMode / isPdfFormat / isBookFormat / bookTypeFromFormat
 *       / matchBookType 的真实返回值。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { resolveReaderMode, isPdfFormat, isBookFormat, bookTypeFromFormat, matchBookType } =
  await import("../src/reader/reader-mode.ts");

test("冒烟·PDF 格式判定", () => {
  assert.equal(isPdfFormat("pdf"), true, "pdf 应识别为 PDF");
  assert.equal(isPdfFormat("PDF"), true, "大写扩展名也应识别（扩展名大小写不可靠）");
  assert.equal(isPdfFormat("epub"), false);
  assert.equal(isPdfFormat(""), false, "空串不应判为 PDF");
  assert.equal(isPdfFormat(null), false, "null 不应判为 PDF");
  assert.equal(isPdfFormat(undefined), false);
  // 契约说明：入参是 BookMeta.format（**纯格式名**，如 "pdf" / "epub"），
  // 不是文件路径 —— 实测调用方（ReaderView.svelte:532、reader-tab.ts:119）
  // 传的都是 `meta?.format`。故传 "book.pdf" 这类路径不识别，属预期行为，
  // 此处钉住该边界，避免以后有人误以为它支持路径。
  assert.equal(isPdfFormat(".pdf"), false, "入参是格式名而非路径，带点路径不识别（预期行为）");
  assert.equal(isPdfFormat("book.pdf"), false, "入参是格式名而非路径");
});

test("冒烟·resolveReaderMode 决定走 PDF 还是书籍渲染", () => {
  assert.equal(resolveReaderMode("pdf"), "pdf", "pdf → pdf 模式");
  assert.equal(resolveReaderMode("epub"), "book", "epub → book 模式");
  // 缺省/异常值必须回落到 book（EPUB 路径是主路径，不能因一个坏值就进 PDF 分支）
  assert.equal(resolveReaderMode(null), "book");
  assert.equal(resolveReaderMode(undefined), "book");
  assert.equal(resolveReaderMode(""), "book");
  assert.equal(resolveReaderMode("未知格式"), "book");
});

test("冒烟·isBookFormat 与 isPdfFormat 互斥且不重叠", () => {
  for (const f of ["epub", "mobi", "azw3", "fb2", "cbz", "txt", "md"]) {
    assert.equal(isBookFormat(f), true, `${f} 应视为书籍格式`);
    assert.equal(isPdfFormat(f), false, `${f} 不应判为 PDF`);
  }
  assert.equal(isBookFormat("pdf"), false, "pdf 不应算书籍格式（走独立 PDF 渲染器）");
});

test("冒烟·bookTypeFromFormat 归一化为 pdf/epub/other", () => {
  assert.equal(bookTypeFromFormat("pdf"), "pdf");
  assert.equal(bookTypeFromFormat("epub"), "epub");
  // 其余格式统一归 other，避免 BookType 无限膨胀
  for (const f of ["mobi", "azw3", "fb2", "cbz", "txt", "md"]) {
    assert.equal(bookTypeFromFormat(f), "other", `${f} 应归为 other`);
  }
  assert.equal(bookTypeFromFormat(null), "other", "缺省应为 other（老数据兼容）");
  assert.equal(bookTypeFromFormat(undefined), "other");
});

test("冒烟·matchBookType 筛选：未标注的通配，已标注的严格匹配", () => {
  // 老数据没有 bookType 字段 → 任何当前书籍都应显示
  assert.equal(matchBookType(undefined, "pdf"), true);
  assert.equal(matchBookType(undefined, "epub"), true);
  assert.equal(matchBookType(undefined, "other"), true);
  // 有标注 → 必须严格相等
  assert.equal(matchBookType("pdf", "pdf"), true);
  assert.equal(matchBookType("epub", "epub"), true);
  assert.equal(matchBookType("other", "other"), true);
  assert.equal(matchBookType("pdf", "epub"), false);
  assert.equal(matchBookType("epub", "pdf"), false);
  assert.equal(matchBookType("other", "epub"), false);
});
