/**
 * 阅读器界面模式：按书籍格式自动分流「图书界面」与「PDF 界面」。
 *
 * 背景（2026-09-02）：此前 PDF 与 EPUB / TXT 等格式共用 ReaderView 的同一套界面模板，
 * 靠散落的 `isPdfBook()` 条件判断拼装控件，导致两类格式互相干扰：
 * - PDF 模式仍显示「文本设置 / 段落设置 / 朗读设置」，而这些项对固定版式的 PDF 完全无效；
 * - 图书模式的工具栏与 PDF 工具栏逻辑纠缠在同一个 11k 行的组件里，难以维护。
 *
 * 这里把「格式 → 界面模式」的映射收敛成唯一真源，ReaderView 与各子组件统一从这里取模式，
 * 避免各处再散写 `format === "pdf"`。
 */

export type ReaderMode = "book" | "pdf";

/** 走 PDF 界面（固定版式、画布渲染）的格式。小写比较。 */
const PDF_FORMATS = new Set(["pdf"]);

/**
 * 由书籍格式解析界面模式。
 * 未知 / 缺失格式一律回落到图书界面（图书是主场景，且图书样式对 txt / md 也适用）。
 */
export function resolveReaderMode(format?: string | null): ReaderMode {
  if (!format) return "book";
  return PDF_FORMATS.has(String(format).toLowerCase()) ? "pdf" : "book";
}

/** 便捷判定：该格式是否走 PDF 界面。 */
export function isPdfFormat(format?: string | null): boolean {
  return resolveReaderMode(format) === "pdf";
}

/** 便捷判定：该格式是否走图书界面（EPUB / MOBI / AZW3 / FB2 / CBZ / TXT / MD 等）。 */
export function isBookFormat(format?: string | null): boolean {
  return resolveReaderMode(format) === "book";
}
