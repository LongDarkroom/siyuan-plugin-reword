/**
 * REword · 导出工具
 * ------------------------------------------------------------------
 * 从 index.ts 拆出的纯逻辑：批注 → Markdown、词库 → CSV 的内容构造均为
 * 纯函数（不依赖 DOM / this），可在 Node 下直接单测；下载动作收敛到
 * downloadTextFile 一处。
 */

import type { AnnotationItem } from "../annotation/annotation-store.ts";
import type { WordRecord } from "../types.ts";

/** 构造批注导出的 Markdown 内容（纯函数） */
export function buildAnnotationsMarkdown(
  items: AnnotationItem[],
  labelNameMap: Record<string, string>,
  now: Date
): string {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const lines: string[] = [];
  lines.push("# REword 批注导出");
  lines.push("");
  lines.push(`> 导出时间：${now.toLocaleString()}`);
  lines.push(`> 共 ${items.length} 条批注`);
  lines.push("");
  lines.push("---");
  lines.push("");

  items.forEach((a, i) => {
    const title = (a.selectedText || a.sentence || "未命名批注").split("\n")[0].slice(0, 80);
    lines.push(`## ${i + 1}. ${title}`);
    lines.push("");
    lines.push(`- **原文**：${a.sentence || "—"}`);
    if (a.note) lines.push(`- **批注**：${a.note}`);
    const tagNames = (a.labels || []).map((id) => `#${labelNameMap[id] || id}`).join(" ");
    if (tagNames) lines.push(`- **标签**：${tagNames}`);
    if (a.color || a.style) {
      lines.push(`- **样式**：${a.color || "默认"} / ${a.style || "solid"}`);
    }
    if (a.origin) lines.push(`- **来源**：${a.origin === "ai" ? "AI" : "手动"}`);
    if (a.docId) lines.push(`- **来源文档**：${a.docId}`);
    if (a.createdAt) lines.push(`- **创建时间**：${a.createdAt}`);
    if (a.updatedAt && a.updatedAt !== a.createdAt) lines.push(`- **更新时间**：${a.updatedAt}`);
    lines.push("");
  });

  return lines.join("\n");
}

/** 构造词库导出的 CSV 内容（纯函数） */
export function buildVocabCsv(words: WordRecord[]): string {
  const escape = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
  const header = "word,phonetic,pos,meaning,mastery,status\n";
  const rows = words
    .map((w) =>
      [escape(w.word), escape(w.phonetic), escape(w.pos), escape(w.meaning), w.mastery, w.status].join(",")
    )
    .join("\n");
  return header + rows;
}

/** 触发浏览器下载文本文件 */
export function downloadTextFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
