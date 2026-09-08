/**
 * 双语运行时 · 切分器（L2 runtime）
 * ==================================================================
 * 从 bilingual-v2.ts 的 getSegments（旧 :93-118）抽出的独立模块。
 *
 * 相对旧实现的两点变化：
 *  1. **memo**：旧代码在 injectAll / segmentStats / segmentTexts / pretranslateAll
 *     四个调用点各自全量扫描 DOM（同一批段落在一轮里被扫 4 次）。本模块按
 *     Document 做 WeakMap 缓存，四处共用一份结果，翻页或重排时 invalidate。
 *  2. **产出 Segment 而非匿名结构**：带 locatorKey（= segHash(text)，只由原文
 *     决定，不含译文风格），成为注入去重 / 失败重试 / 隐藏集合的统一锚点。
 */
import type { Segment, SegmenterLike } from "../core/types.ts";
import { segHash, isTranslatedPeer } from "../../bilingual-v2/render.ts";

/** 真实正文块（首选段落级） */
const BLOCK = "p, li, blockquote";
/** div 仅作叶子文本块兜底：部分 EPUB 用 div 而非 p 做段落 */
const LEAF_DIV = "div";
/** 不应翻译的节点 */
const EXCLUDED = "pre, code, math, style, script";
/** 作为整体翻译的容器：其内 p/li 跳过，改译容器整体 */
const CONTAINER = "blockquote, li";

export function cleanText(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/**
 * 切一个分节文档。
 *
 * 已成功注入的段落（原文带 data-reword-translated 或已有译文兄弟节点）会被跳过；
 * 失败段在新语义下**不打标**，因此下一轮仍会被切出并重试。
 */
export function segmentDocument(
  doc: Document,
  sectionIndex: number,
  isSegmentHidden?: (hash: string) => boolean,
): Segment[] {
  if (!doc || typeof doc.querySelectorAll !== "function") return [];
  const all = Array.from(doc.querySelectorAll(`${BLOCK}, ${LEAF_DIV}`)) as Element[];
  const out: Segment[] = [];
  let recent: string[] = [];
  for (const el of all) {
    if (el.closest(EXCLUDED)) continue;
    if ((el as HTMLElement).classList?.contains("reword-bilingual")) continue;
    if (el.hasAttribute("data-translation-mark")) continue;
    if (el.tagName === "DIV" && el.querySelector("p, li, blockquote, div")) continue;
    if (el.parentElement?.closest(CONTAINER)) continue;
    if (el.hasAttribute("data-reword-translated") || isTranslatedPeer(el)) continue;
    const text = cleanText(el.textContent || "");
    if (!text) continue;
    if (isSegmentHidden && isSegmentHidden(segHash(text))) continue;
    out.push({
      locatorKey: segHash(text),
      text,
      sectionIndex,
      indexInSection: out.length,
      node: el,
      prev: recent.slice(-2).join("\n"),
    });
    const short = text.length > 160 ? text.slice(0, 160) : text;
    recent.push(short);
    if (recent.length > 4) recent.shift();
  }
  return out;
}

export interface SegmenterOptions {
  /** 判定段落指纹是否被用户隐藏（隐藏集合沿用 segHash，兼容已持久化数据） */
  isSegmentHidden?: (hash: string) => boolean;
}

/**
 * 带 memo 的切分器。缓存键是 Document 本身（WeakMap，随文档回收自动释放）。
 */
export function createSegmenter(opts: SegmenterOptions = {}): SegmenterLike {
  // WeakMap 没有 clear()，全清只能换一个新实例
  let cache = new WeakMap<Document, Map<number, Segment[]>>();

  function segmentsOf(doc: Document, sectionIndex: number): Segment[] {
    if (!doc) return [];
    let bySection = cache.get(doc);
    if (!bySection) {
      bySection = new Map();
      cache.set(doc, bySection);
    }
    const hit = bySection.get(sectionIndex);
    if (hit) return hit;
    const segs = segmentDocument(doc, sectionIndex, opts.isSegmentHidden);
    bySection.set(sectionIndex, segs);
    return segs;
  }

  return {
    segmentsOf,
    segmentsOfDocs(docs: Document[], firstSectionIndex = 0): Segment[] {
      const out: Segment[] = [];
      docs.forEach((doc, i) => {
        out.push(...segmentsOf(doc, firstSectionIndex + i));
      });
      return out;
    },
    invalidate(doc?: Document): void {
      if (doc) cache.delete(doc);
      else cache = new WeakMap();
    },
  };
}
