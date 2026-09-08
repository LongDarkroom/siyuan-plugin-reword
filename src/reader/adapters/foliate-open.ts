/**
 * foliate 视图挂载 + BookDoc 抽取 共享助手（R1 收敛 · Readest 蓝本）
 * ---------------------------------------------------------------
 * 仅承载「挂载 reword-foliate-view」「把已打开的 foliate book 归一化为 BookDoc」
 * 两类纯逻辑；不创建事件监听、不应用样式、不处理 PDF 缩放——
 * 那些仍由 ReaderView.openBook 按原有时序负责（避免初始化事件丢失）。
 *
 * 与旧 openBook 内联逻辑行为等价：
 *   - 旧：document.createElement("reword-foliate-view") + container.append + view.open(file)
 *   - 新：mountFoliateView 做同样三件事（target 既可是 File 也可是 makeTextBook 产物）
 */

import type { BookDoc, SectionItem, TocItem } from "../book-doc.ts";

/** 挂载一个 reword-foliate-view 并打开内容（File 或 foliate book 对象）。 */
export async function mountFoliateView(container: HTMLElement, target: File | any): Promise<any> {
  const el = document.createElement("reword-foliate-view") as any;
  container.append(el);
  await el.open(target);
  return el;
}

/**
 * 把 foliate 嵌套 toc 展平为 ReaderView 使用的 TocItem[]（{title,href,level}）。
 * 与旧 flattenToc 行为等价（只认 subitems；children 不展开，保持旧语义）。
 */
export function flattenFoliateToc(
  items: any[],
  level = 0,
  out: TocItem[] = []
): TocItem[] {
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    if (!it) continue;
    if (it.href) out.push({ title: it.label ?? it.title ?? it.href, href: it.href, level });
    if (it.subitems?.length) flattenFoliateToc(it.subitems, level + 1, out);
  }
  return out;
}

/** 把 foliate 已打开的 book 对象归一化为统一 BookDoc。 */
export function foliateBookToDoc(
  bookId: string,
  foliateBook: any,
  rendition: "reflowable" | "pre-paginated",
  toc: TocItem[],
  extra?: { pdfTotalPages?: number }
): BookDoc {
  const meta = foliateBook?.metadata ?? {};
  return {
    bookId,
    metadata: {
      title: meta.title,
      author: meta.author,
      language: meta.language,
      cover: typeof meta.cover === "string" ? meta.cover : undefined,
    },
    sections: (foliateBook?.sections ?? []) as SectionItem[],
    rendition,
    toc,
    pdfTotalPages: extra?.pdfTotalPages,
  };
}
