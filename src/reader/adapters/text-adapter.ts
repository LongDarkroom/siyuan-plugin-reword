/**
 * TXT / Markdown 纯文本适配器（R1 收敛 · Readest 蓝本）
 * ---------------------------------------------------------------
 * foliate-js 不支持纯文本，旧逻辑在 book-adapters.ts 的 makeTextBook 把
 * 文本切片成 HTML 文档后交给 foliate-view 分页。本适配器复用 makeTextBook，
 * 仅负责「打开到指定 view」与「抽取 BookDoc」，行为等价于旧 openBook 内联分支。
 */
import type { BookDoc } from "../book-doc.ts";
import type { ContentAdapter, BookSource, FeatureFlag } from "../content-adapter.ts";
import { makeTextBook } from "../book-adapters.ts";
import { flattenFoliateToc, foliateBookToDoc } from "./foliate-open.ts";

export class TextAdapter implements ContentAdapter {
  readonly type = "text" as const;

  async openView(view: any, source: BookSource): Promise<void> {
    const bookObj = await makeTextBook(source.file!, source.title);
    await view.open(bookObj);
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
