/**
 * EPUB / MOBI / AZW3 / FB2 适配器（R1 收敛 · Readest 蓝本）
 * ---------------------------------------------------------------
 * 这些格式都由 foliate-js 原生处理，统一走 reword-foliate-view。
 * 适配器只负责「打开到指定 view」与「从已打开的 foliate book 抽取 BookDoc」，
 * 不创建 view、不挂监听、不应用样式（时序由 openBook 控制）。
 */
import type { BookDoc } from "../book-doc.ts";
import type { ContentAdapter, BookSource, FeatureFlag } from "../content-adapter.ts";
import { flattenFoliateToc, foliateBookToDoc } from "./foliate-open.ts";

export class EpubAdapter implements ContentAdapter {
  readonly type = "epub" as const;

  async openView(view: any, source: BookSource): Promise<void> {
    await view.open(source.file!);
  }

  buildBookDoc(source: BookSource, view: any): BookDoc {
    const fb = view.book;
    const toc = flattenFoliateToc(fb?.toc ?? []);
    return foliateBookToDoc(source.bookId, fb, "reflowable", toc);
  }

  supports(_f: FeatureFlag): boolean {
    return true;
  }
}
