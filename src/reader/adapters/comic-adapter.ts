/**
 * 漫画 / CBZ 适配器（R1 收敛 · Readest 蓝本 · 薄壳）
 * ---------------------------------------------------------------
 * CBZ 由 foliate-js 原生渲染（图片序列），与 EPUB 打开方式一致，
 * 但无文本 → 双语/标注等文本型特性自动跳过（supports("text")=false）。
 * 后续漫画专属特性（webtoon / 双页 / RTL / 分镜缩放）在此文件内扩展，
 * 不污染基础阅读器层（对齐 KOReader picdocument / Readest CBZ 思路）。
 */
import type { BookDoc } from "../book-doc.ts";
import type { ContentAdapter, BookSource, FeatureFlag } from "../content-adapter.ts";
import { foliateBookToDoc } from "./foliate-open.ts";

export class ComicAdapter implements ContentAdapter {
  readonly type = "comic" as const;

  async openView(view: any, source: BookSource): Promise<void> {
    await view.open(source.file!);
  }

  buildBookDoc(source: BookSource, view: any): BookDoc {
    const fb = view.book;
    // 图片型内容无目录 / 无文本块；toc 空，rendition 固定版式
    return foliateBookToDoc(source.bookId, fb, "pre-paginated", []);
  }

  supports(f: FeatureFlag): boolean {
    // 仅 webtoon 适用；无正文文本、无选区高亮
    return f === "webtoon";
  }
}
