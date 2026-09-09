/**
 * PDF 矩形框选纯函数（2026-09-09 P1.3 从 ReaderView.finishPdfRect 抽出）
 * 不依赖 DOM / 思源 API，可被单元测试直接导入。
 */
import type { PdfRect } from "../annotation/annotation-store.ts";

/** 主文档坐标系下的矩形（px） */
export type SelRect = { left: number; top: number; right: number; bottom: number };

/** 拖拽最小尺寸：小于该值视为误触（px） */
export const RECT_MIN_PX = 8;

/** 单页归一化矩形边长阈值：小于该值认为框选不落在该页上 */
export const RECT_MIN_NORM = 0.002;

/**
 * 页命中收集：与选区重叠显著（两个方向都 > RECT_MIN_PX）的页。
 * 支持跨页框选（spread 双页各存一段），按重叠面积降序。
 */
export function collectPageHits(
  sel: SelRect,
  frames: Array<{ index: number; rect: SelRect }>,
): Array<{ index: number; page: number; overlap: number }> {
  const hits: Array<{ index: number; page: number; overlap: number }> = [];
  for (const f of frames) {
    const ox = Math.min(sel.right, f.rect.right) - Math.max(sel.left, f.rect.left);
    const oy = Math.min(sel.bottom, f.rect.bottom) - Math.max(sel.top, f.rect.top);
    if (ox > RECT_MIN_PX && oy > RECT_MIN_PX) {
      hits.push({ index: f.index, page: f.index + 1, overlap: ox * oy });
    }
  }
  hits.sort((a, b) => b.overlap - a.overlap);
  return hits;
}

/**
 * 选中区域 → 相对某页基准（baseLeft/baseTop 为页原点的主文档坐标，bw/bh 为页宽高）的归一化矩形。
 * 边长小于 RECT_MIN_NORM 视为不落在该页，返回 null。page 字段由调用方回填。
 */
export function normalizeSelToRect(
  sel: SelRect,
  baseLeft: number,
  baseTop: number,
  bw: number,
  bh: number,
): Omit<PdfRect, "page"> | null {
  const bw1 = bw > 0 ? bw : 1;
  const bh1 = bh > 0 ? bh : 1;
  const x = Math.max(0, (sel.left - baseLeft) / bw1);
  const y = Math.max(0, (sel.top - baseTop) / bh1);
  const w = Math.min(1 - x, (sel.right - baseLeft) / bw1 - x);
  const h = Math.min(1 - y, (sel.bottom - baseTop) / bh1 - y);
  if (w <= RECT_MIN_NORM || h <= RECT_MIN_NORM) return null;
  return { x, y, w, h };
}

/** 链接标题：`书名 · 第 N 页`（标注 id 收进链接，不进可见文本） */
export function buildRectLinkTitle(title: string, page: number): string {
  return `${title || "PDF"} · 第 ${page} 页`;
}

/**
 * 矩形标注深链（host 用插件名 siyuan-plugin-reword，思源会派发事件给插件自身处理器
 * → 复用已有 Tab + 跳页 + 闪烁；2026-09-09 实锤：用 Tab id 会被思源直接开新 Tab 且 cfi 被忽略）。
 */
export function buildRectDeepLink(bookId: string, annId: string): string {
  if (!bookId || !annId) return "";
  try {
    const data = encodeURIComponent(JSON.stringify({ bookId, cfi: `pdf-rect:${annId}` }));
    return `siyuan://plugins/siyuan-plugin-reword?data=${data}`;
  } catch {
    return "";
  }
}

export type RectMdEntry = { page: number; id: string; assetPath: string };

/**
 * 2026-09-09 去嵌套去重：丢弃被其它矩形完全包含（含 ε 容差）的矩形。
 * 背景：实测 PDF 划选时 getClientRects 会对同一行返回两套嵌套矩形
 * （如 h=0.0146 与 h=0.0106 且完全内含），保存端不清洗则同一标注
 * 每行画两遍、叠加出「高亮上又漂一层」的观感。纯包含判定，绝不合并
 * 相邻行/相邻片段（无面积放大，只删冗余），对正常数据零影响。
 * 按面积降序后只保留未被更 大/等 矩形包含者，顺序保持稳定。
 */
export function dedupeNestedRects<T extends { x: number; y: number; w: number; h: number }>(rects: readonly T[]): T[] {
  const EPS = 1e-4;
  const sorted = [...rects].sort((a, b) => b.w * b.h - a.w * a.h);
  const kept: T[] = [];
  for (const r of sorted) {
    let contained = false;
    for (const k of kept) {
      if (
        k.x - EPS <= r.x && k.y - EPS <= r.y &&
        k.x + k.w + EPS >= r.x + r.w && k.y + k.h + EPS >= r.y + r.h
      ) { contained = true; break; }
    }
    if (!contained) kept.push(r);
  }
  // 恢复与输入近似的顺序（按 y 再 x），保证绘制层级稳定
  return kept.sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

/** 矩形标注 markdown：每页一节（链接行 + 可选图片行），多页拼接 */
export function buildRectMarkdown(bookId: string, title: string, entries: RectMdEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    if (!e || !e.id) continue;
    const url = buildRectDeepLink(bookId, e.id);
    const t = buildRectLinkTitle(title, e.page);
    lines.push(url ? `[${t}](${url})` : t);
    if (e.assetPath) lines.push(`![](${e.assetPath})`);
  }
  return lines.join("\n");
}
