/**
 * 批注查询引擎 —— 高效过滤 + 可选 SQL 联查
 * ------------------------------------------------------------------
 * 设计目标：
 *  - 当批注量很大时（数百条），避免 AI 全量遍历浪费 token；
 *  - 先通过本地过滤器快速缩小范围，再交给 AI 精讲。
 *
 * 查询能力：
 *  - 关键词全文搜索（sentence / selectedText / note 三字段）
 *  - 颜色筛选
 *  - 文档范围（docId）
 *  - 时间范围（createdAt / updatedAt）
 *  - 来源筛选（manual / ai）
 *  - 块级聚合（按 blockId 分组返回）
 */

import type { AnnotationItem, AnnotationStyle } from "./annotation-store.ts";

/** 批注查询条件 */
export interface AnnotationQuery {
  /** 关键词（模糊匹配 sentence / selectedText / note） */
  keyword?: string;
  /** 批注颜色精确匹配 */
  color?: string;
  /** 下划线样式筛选 */
  style?: AnnotationStyle;
  /** 标签筛选（命中任一即通过） */
  tag?: string;
  /** 所属文档 ID */
  docId?: string;
  /** 来源筛选 */
  origin?: "manual" | "ai";
  /** 创建时间起点（ISO 字符串） */
  from?: string;
  /** 创建时间终点（ISO 字符串） */
  to?: string;
  /** 所属块 ID（精确） */
  blockId?: string;
  /** 最大返回条数（默认 100，防一次塞太多给 AI） */
  limit?: number;
}

/** 查询结果（含统计元信息） */
export interface AnnotationQueryResult {
  items: AnnotationItem[];
  total: number;        // 匹配总数（不受 limit 截断）
  queriedAt: string;     // 查询时间 ISO
  /** 按文档分组的摘要（供 AI 上下文概览） */
  byDoc: Record<string, { docId: string; count: number; sampleNote: string }>;
}

/**
 * 对 AnnotationItem 数组执行过滤查询。
 * 纯函数，无副作用，可在任意上下文调用。
 *
 * @param annotations  全量批注数组（通常来自 store.getAll()）
 * @param query        查询条件
 */
export function queryAnnotations(
  annotations: AnnotationItem[],
  query: AnnotationQuery = {}
): AnnotationQueryResult {
  const limit = query.limit ?? 100;
  let list = [...annotations]; // 不修改原数组

  // 1) 关键词全文搜索（大小写不敏感）
  if (query.keyword && query.keyword.trim()) {
    const kw = query.keyword.trim().toLowerCase();
    list = list.filter((a) =>
      [a.sentence, a.selectedText, a.note].some(
        (field) => field && field.toLowerCase().includes(kw)
      )
    );
  }

  // 2) 颜色精确匹配
  if (query.color) {
    list = list.filter((a) => a.color === query.color);
  }

  // 2b) 下划线样式筛选
  if (query.style) {
    list = list.filter((a) => a.style === query.style);
  }

  // 2c) 标签筛选（命中任一）
  if (query.tag) {
    list = list.filter((a) => Array.isArray(a.tags) && a.tags.includes(query.tag!));
  }

  // 3) 文档范围
  if (query.docId) {
    list = list.filter((a) => a.docId === query.docId);
  }

  // 4) 来源
  if (query.origin) {
    list = list.filter((a) => a.origin === query.origin);
  }

  // 5) 时间范围
  if (query.from) {
    const t = new Date(query.from).getTime();
    list = list.filter((a) => new Date(a.createdAt).getTime() >= t);
  }
  if (query.to) {
    const t = new Date(query.to).getTime();
    list = list.filter((a) => new Date(a.createdAt).getTime() <= t);
  }

  // 6) 块 ID
  if (query.blockId) {
    list = list.filter((a) => a.blockId === query.blockId);
  }

  const total = list.length;

  // 按 createdAt 倒序（最新在前），再截断
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const items = list.slice(0, limit);

  // 按文档分组统计
  const byDoc: AnnotationQueryResult["byDoc"] = {};
  for (const a of items) {
    const d = a.docId || "_unknown";
    if (!byDoc[d]) {
      byDoc[d] = { docId: d, count: 0, sampleNote: "" };
    }
    byDoc[d].count++;
    if (!byDoc[d].sampleNote && a.note) {
      byDoc[d].sampleNote = a.note.length > 60 ? a.note.slice(0, 60) + "…" : a.note;
    }
  }

  return {
    items,
    total,
    queriedAt: new Date().toISOString(),
    byDoc,
  };
}

/**
 * 将查询结果格式化为 AI 友好的文本摘要。
 * 用于「发送给 AI 讲解」时作为上下文注入。
 */
export function formatAnnotationsForAi(result: AnnotationQueryResult): string {
  if (!result.items.length) return "（未找到匹配的批注）";

  const lines: string[] = [
    `## 批注查询结果（共 ${result.total} 条，展示前 ${result.items.length} 条）`,
    "",
  ];

  for (let i = 0; i < result.items.length; i++) {
    const a = result.items[i];
    lines.push(`### 批注 ${i + 1}`);
    lines.push(`- **原文句子**: ${a.sentence}`);
    if (a.selectedText && a.selectedText !== a.sentence) {
      lines.push(`- **选中文字**: ${a.selectedText}`);
    }
    lines.push(`- **批注内容**: ${a.note}`);
    if (a.color) lines.push(`- **颜色**: ${a.color}`);
    if (a.style) lines.push(`- **样式**: ${a.style}`);
    if (a.tags?.length) lines.push(`- **标签**: ${a.tags.join(", ")}`);
    lines.push(`- **来源**: ${a.origin === "ai" ? "AI 生成" : "手动添加"}`);
    lines.push(`- **时间**: ${a.createdAt.slice(0, 10)}`);
    lines.push("");
  }

  return lines.join("\n");
}
