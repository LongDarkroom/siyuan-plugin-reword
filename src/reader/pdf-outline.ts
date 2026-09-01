/**
 * PDF 大纲解析（ReaderView 内部 helper）
 * ------------------------------------------------------------------
 * [2026-09-01] Phase 1：对齐 Obsidian PDF++ 的 outline / 目录能力
 *
 * 解决：foliate-js 对 PDF 只渲染页面，没有内置 book.toc；
 *       需要从 PDF.js 拿 `getOutline()` 然后解析 dest 拿到页码，
 *       转换为与 EPUB 目录同构的 `{title, href, level}` 列表，
 *       直接复用 ReaderView 里现成的 `.reader-toc` 抽屉 UI。
 *
 * 设计要点：
 *  - 输出形态与 `flattenToc()` 一致(EPUB 那边也是这套),ReaderView 拿到就能用
 *  - `href` 用 `"pdf-page-{n}"` 格式(PDF 章节定位的唯一稳定锚就是页码)
 *  - `getDestination()` 异步解析,失败的条目降级为「无页码」节点
 *  - 失败 / 无目录 → 返回空数组(让 ReaderView 走"本书没有目录"分支)
 *  - PDF.js 全局挂载方式与 bookshelf-store.ts extractPdfMeta 一致(动态 import 副作用)
 */

import { logSwallow } from "../core/safe.ts";

/** 与 ReaderView.flattenToc 输出一致 */
export interface PdfOutlineNode {
  title: string;
  /** "pdf-page-{n}"(n = 1-based 页码),或 `""`(未解析出页码) */
  href: string;
  level: number;
  /** 解析出的 1-based 页码(供工具栏「第 N / T 页」显示用);0 = 未知 */
  page: number;
}

/** PDF.js raw outline 节点类型(只取我们需要的字段,避免引入 pdfjs-dist 类型) */
interface PdfRawOutlineItem {
  title?: string;
  dest?: any; // 字符串数组 / 对象数组 / RefSet 等多种可能形态
  url?: string;
  items?: PdfRawOutlineItem[];
}

/** 懒加载 PDF.js(全局挂载,foliate-js 的 pdf.mjs 副作用) */
async function loadPdfjsLib(): Promise<any | null> {
  try {
    // foliate-js 的 pdf.mjs 第 45 行 `var __webpack_exports__ = globalThis.pdfjsLib = {};` 自挂载
    // 动态 import 一次触发副作用,即可拿到 pdfjsLib 全局
    // vendor/pdfjs/pdf.mjs 无 .d.ts,运行时类型已挂 globalThis
    // @ts-expect-error vendor 路径无类型定义
    await import("./vendor/foliate-js/vendor/pdfjs/pdf.mjs");
    return (globalThis as any).pdfjsLib ?? null;
  } catch (e) {
    logSwallow(e, "pdf-outline.ts · loadPdfjsLib", "debug");
    return null;
  }
}

/** 把 PDF blob 喂给 PDF.js,返回解析好的 outline + 总页数 */
export async function loadPdfOutline(blob: Blob): Promise<{ nodes: PdfOutlineNode[]; totalPages: number }> {
  const pdfjsLib = await loadPdfjsLib();
  if (!pdfjsLib?.getDocument) {
    return { nodes: [], totalPages: 0 };
  }

  let pdfDoc: any = null;
  try {
    // PDF.js 需要 ArrayBuffer 形式的数据(走 worker 时也需要)
    const buf = new Uint8Array(await blob.arrayBuffer());
    const loadingTask = pdfjsLib.getDocument({ data: buf });
    pdfDoc = await loadingTask.promise;
    const totalPages: number = pdfDoc.numPages || 0;

    const raw = (await pdfDoc.getOutline?.()) as PdfRawOutlineItem[] | null | undefined;
    if (!Array.isArray(raw) || raw.length === 0) {
      // 大纲为空(扫描版 PDF 经常没目录)→ 不报错,返回空数组让 UI 走"无目录"分支
      return { nodes: [], totalPages };
    }

    const nodes = await flattenPdfOutline(raw, pdfDoc, 0, []);
    return { nodes, totalPages };
  } catch (e) {
    logSwallow(e, "pdf-outline.ts · loadPdfOutline", "debug");
    return { nodes: [], totalPages: 0 };
  } finally {
    // PDF.js 文档需要显式 destroy,释放 worker 内存
    try {
      await pdfDoc?.destroy?.();
    } catch { /* ignore */ }
  }
}

/** 递归展平 PDF outline 树,同时异步解析每个 dest 拿到页码 */
async function flattenPdfOutline(
  items: PdfRawOutlineItem[],
  pdfDoc: any,
  level: number,
  out: PdfOutlineNode[]
): Promise<PdfOutlineNode[]> {
  for (const it of items) {
    if (!it) continue;
    const title = (it.title ?? "").trim() || "(未命名章节)";
    const page = await resolvePdfPage(pdfDoc, it.dest);
    out.push({
      title,
      href: page > 0 ? `pdf-page-${page}` : "",
      level,
      page,
    });
    if (Array.isArray(it.items) && it.items.length) {
      await flattenPdfOutline(it.items, pdfDoc, level + 1, out);
    }
  }
  return out;
}

/**
 * 解析 PDF dest 为 1-based 页码
 *
 * PDF.js 中 dest 有 4 种形态:
 *  1. 字符串数组 `["page-ref-1", "XYZ", 0, top, zoom]` → 第一个元素是命名引用,需查 doc.getDestination()
 *  2. 对象数组 `[{num: 1, gen: 0}, "XYZ", ...]` → 第一个对象的 ref.num 就是页码
 *  3. RefSet 对象 `{num, gen}` 直接拿 num
 *  4. 字符串 url(可能含 # 锚点) → 无页码信息,降级返回 0
 *
 * 返回 0 表示未解析出(条目仍会保留,只是不可点击跳转)
 */
async function resolvePdfPage(pdfDoc: any, dest: any): Promise<number> {
  if (!dest || !pdfDoc) return 0;

  try {
    // 形态 4:url 字符串(常见于网页链接,无页码)
    if (typeof dest === "string") return 0;

    // 形态 3:RefSet 对象
    if (typeof dest === "object" && !Array.isArray(dest) && typeof dest.num === "number") {
      return dest.num + 1; // PDF.js 内部 0-based,UI 显示 1-based
    }

    // 形态 1 & 2:数组
    if (Array.isArray(dest) && dest.length > 0) {
      const first = dest[0];
      // 形态 2:第一个元素是对象 {num}
      if (typeof first === "object" && first !== null && typeof first.num === "number") {
        return first.num + 1;
      }
      // 形态 1:第一个元素是字符串(命名引用),需查 doc.getDestination(name)
      if (typeof first === "string" && pdfDoc.getDestination) {
        const resolved = await pdfDoc.getDestination(first);
        if (resolved && Array.isArray(resolved) && resolved.length > 0) {
          const r0 = resolved[0];
          if (typeof r0 === "object" && r0 !== null && typeof r0.num === "number") {
            return r0.num + 1;
          }
        }
      }
    }
  } catch (e) {
    logSwallow(e, "pdf-outline.ts · resolvePdfPage", "debug");
  }

  return 0;
}

/**
 * 从 foliate-js 的 PDF view 当前位置反推当前页码
 * - 监听 `relocate` 事件,`e.detail` 含 cfi
 * - 用 foliate 内部的 `getPageNumber(cfi)` 反查(若可用)
 * - 兜底:用 view.lastLocation.index + 1
 */
export function extractPdfCurrentPage(view: any, eventDetail: any): number {
  // 优先:view.renderer.getPageNumber(cfi)(foliate-js PDF 渲染器公开 API)
  if (eventDetail?.cfi && view?.renderer?.getPageNumber) {
    try {
      const n = view.renderer.getPageNumber(eventDetail.cfi);
      if (typeof n === "number" && n > 0) return n;
    } catch { /* ignore */ }
  }

  // 兜底:eventDetail.index(0-based)+ 1
  if (typeof eventDetail?.index === "number") {
    return eventDetail.index + 1;
  }

  // 兜底:view.lastLocation.index + 1
  if (typeof view?.lastLocation?.index === "number") {
    return view.lastLocation.index + 1;
  }

  return 0;
}
