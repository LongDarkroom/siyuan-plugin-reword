/**
 * 阅读知识图谱 + 书图谱画布导出（C · 图谱 / 画布联动）
 * ------------------------------------------------------------------
 * 图谱：以书架书籍为节点、共享标签/丛书为边，做轻量力导向布局（离线、零外部 API）。
 * 画布：把某本书的标注导出为思源文档（/REword/书图谱/《书名》），复用阅读器发送的笔记本配置。
 * 注：本实现基于 REword 本地数据，不依赖 SiYuan 图谱 API；
 *     若要 seed 自思源关系图（书↔标注↔关联笔记），需先完成 Phase 3「按书落地标注到思源块」。
 */

import type { BookMeta } from "./bookshelf-store";
import type { AnnotationItem } from "../annotation/annotation-store";
import { lsNotebooks, createDocWithMd } from "../siyuan/filetree";
import { getGlobalSettingsStore } from "./reader-settings.ts";
import { getDoc, updateBlock, appendBlock } from "../siyuan/api.ts";

export const GRAPH_W = 600;
export const GRAPH_H = 420;

export interface GraphNode {
  id: string;
  title: string;
  status: string;
  x: number;
  y: number;
  annCount: number;
  r: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface LibraryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** 构建并松弛出节点坐标 */
export function buildLibraryGraph(
  books: BookMeta[],
  annCount: Record<string, number>
): LibraryGraph {
  const n = Math.max(1, books.length);
  const nodes: GraphNode[] = books.map((b, i) => {
    const ang = (i / n) * Math.PI * 2;
    const ann = annCount[b.id] || 0;
    return {
      id: b.id,
      title: b.title,
      status: b.status ?? "unread",
      x: GRAPH_W / 2 + Math.cos(ang) * 200,
      y: GRAPH_H / 2 + Math.sin(ang) * 150,
      annCount: ann,
      r: 5 + Math.min(10, ann * 0.8),
    };
  });

  const edges: GraphEdge[] = [];
  for (let i = 0; i < books.length; i++) {
    for (let j = i + 1; j < books.length; j++) {
      const a = books[i];
      const b = books[j];
      const tagsA = new Set(a.tags || []);
      let shared = 0;
      for (const t of tagsA) if ((b.tags || []).includes(t)) shared++;
      if (a.series && b.series && a.series === b.series) shared += 2;
      if (shared > 0) edges.push({ source: a.id, target: b.id, weight: shared });
    }
  }

  relax(nodes, edges);
  return { nodes, edges };
}

function relax(nodes: GraphNode[], edges: GraphEdge[]) {
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  for (let iter = 0; iter < 260; iter++) {
    // 节点间斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) d2 = 1;
        const f = 1400 / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.x += fx;
        a.y += fy;
        b.x -= fx;
        b.y -= fy;
      }
    }
    // 边的引力
    for (const e of edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = 95 - Math.min(45, e.weight * 9);
      const f = (d - target) * 0.02;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.x += fx;
      a.y += fy;
      b.x -= fx;
      b.y -= fy;
    }
    // 向心力
    for (const nd of nodes) {
      nd.x += (GRAPH_W / 2 - nd.x) * 0.006;
      nd.y += (GRAPH_H / 2 - nd.y) * 0.006;
    }
  }
  for (const nd of nodes) {
    nd.x = Math.max(nd.r + 4, Math.min(GRAPH_W - nd.r - 4, nd.x));
    nd.y = Math.max(nd.r + 4, Math.min(GRAPH_H - nd.r - 4, nd.y));
  }
}

/** 把标注聚合成「书图谱」Markdown */
function buildBookMarkdown(book: BookMeta, anns: AnnotationItem[]): string {
  const statusLabel: Record<string, string> = { unread: "想读", reading: "在读", finished: "读完" };
  const head: string[] = [];
  head.push(`# 《${book.title}》`);
  const meta: string[] = [];
  if (book.author) meta.push(book.author);
  meta.push(statusLabel[book.status ?? "unread"] || "想读");
  if (typeof book.progress?.fraction === "number") meta.push(`${Math.round(book.progress.fraction * 100)}%`);
  if (book.rating) meta.push("★".repeat(book.rating));
  if (meta.length) head.push(`> ${meta.join(" · ")}`);
  head.push("");
  head.push(`## 标注（${anns.length} 条）`);
  head.push("");
  if (!anns.length) {
    head.push("_（这本书还没有标注，在 REword 阅读器中划词批注后，再来这里生成画布）_");
  } else {
    anns.forEach((a, i) => {
      head.push(`### ${i + 1}. ${a.sentence || a.selectedText || "（批注）"}`);
      if (a.note && a.note.trim()) head.push(`批注：${a.note.trim()}`);
      else head.push("（纯高亮，无文字批注）");
      if (a.labels?.length) head.push(`标签：#${a.labels.join(" #")}`);
      head.push("");
    });
  }
  return head.join("\n");
}

/**
 * 导出某本书的画布文档到思源（/REword/书图谱/《书名》）。
 * 复用阅读器发送的笔记本配置（localStorage hiword-reader-send-notebook / -path）。
 */
export async function exportBookCanvasDoc(book: BookMeta, anns: AnnotationItem[]): Promise<string> {
  const md = buildBookMarkdown(book, anns);
  // 2026-09-01：若已绑定书图谱目标文档，按书名去重 append 到该文档
  try {
    const st = getGlobalSettingsStore()?.get?.();
    const targetDocId = st?.bookGraphDocId?.trim();
    if (targetDocId) {
      const heading = `《${book.title}》`;
      const html = await getDoc(targetDocId);
      const foundId = findBookSectionId(html, heading);
      if (foundId) {
        await updateBlock("markdown", md, foundId);
      } else {
        await appendBlock("markdown", md, targetDocId);
      }
      return targetDocId;
    }
  } catch (e) {
    console.warn("[REword] 导出书图谱到绑定文档失败，回退默认:", e);
  }
  // 原逻辑：按书名在 /REword/书图谱 下新建子文档
  let notebookId =
    (typeof localStorage !== "undefined" && localStorage.getItem("hiword-reader-send-notebook")) || "";
  if (!notebookId) {
    const nbs = await lsNotebooks();
    notebookId = nbs.find((x) => !x.closed)?.id || nbs[0]?.id || "";
  }
  if (!notebookId) throw new Error("未找到可用笔记本");
  const safeTitle = book.title.replace(/[\\/:*?"<>|]/g, "_");
  const path =
    (typeof localStorage !== "undefined" && localStorage.getItem("hiword-reader-send-path")) ||
    "/REword/阅读摘录";
  const base = path.replace(/\/[^/]+$/, "") || "/REword";
  const docPath = `${base}/书图谱/${safeTitle}`;
  return await createDocWithMd(notebookId, docPath, md);
}

/** 在书图谱文档 HTML 中定位某本书章节块 ID（一级标题含书名），用于去重更新 */
function findBookSectionId(html: string, heading: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    const blocks = doc.querySelectorAll("[data-node-id],[data-id]");
    for (const el of Array.from(blocks)) {
      const id = (el as HTMLElement).getAttribute("data-node-id") || (el as HTMLElement).getAttribute("data-id");
      const type = (el as HTMLElement).getAttribute("data-type");
      if (id && type === "NodeHeading" && (el.textContent || "").includes(heading)) {
        return id;
      }
    }
  } catch {
    /* 解析失败返回 null，回退 append */
  }
  return null;
}
