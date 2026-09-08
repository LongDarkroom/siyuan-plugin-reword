/**
 * PDF 适配器（R1 收敛 · Readest 蓝本）
 * ---------------------------------------------------------------
 * PDF 由 foliate-js（内含 pdf.js）渲染，但 foliate 不提供 book.toc，
 * 需从 PDF.js getOutline() 解析页码（见 pdf-outline.ts）。
 * 适配器负责：打开到指定 view + 解析 PDF 大纲产出与 EPUB 同构的 toc + 记录总页数。
 */
import type { BookDoc } from "../book-doc.ts";
import type { ContentAdapter, BookSource, FeatureFlag } from "../content-adapter.ts";
import { flattenFoliateToc, foliateBookToDoc } from "./foliate-open.ts";
import { loadPdfOutline } from "../pdf-outline.ts";

export class PdfAdapter implements ContentAdapter {
  readonly type = "pdf" as const;

  async openView(view: any, source: BookSource): Promise<void> {
    await view.open(source.file!);
  }

  async buildBookDoc(source: BookSource, view: any): Promise<BookDoc> {
    const fb = view.book;
    // PDF 大纲走 pdf.js，与 EPUB 展平结果形态一致（{title,href,level}[]）
    const pdf = await loadPdfOutline(source.file!);
    return foliateBookToDoc(source.bookId, fb, "pre-paginated", pdf.nodes, {
      pdfTotalPages: pdf.totalPages,
    });
  }

  supports(f: FeatureFlag): boolean {
    // PDF 支持文本/选区，但不支持 webtoon（漫画专属）
    return f !== "webtoon";
  }
}
