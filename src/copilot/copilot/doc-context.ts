/**
 * 文档上下文管理（添加文档 / 搜索文档 / 加入上下文）
 * ------------------------------------------------------------------
 * 对应需求 6 左下角前两项：
 *  - 添加文档：列出思源全部文档，点击「添加到上下文」加入当前会话。
 *  - 搜索文档：关键词检索文档，左侧显示文档名，右侧「添加到上下文」按钮。
 *
 * 文档正文不在此处持久化，仅在「发送对话」时按需拉取（见 copilot-panel）。
 */
import { listDocuments, searchDocuments, getDocumentContent } from "../api/siyuan.ts";
import type { ContextDoc } from "../types.ts";

/**
 * 列出可添加的文档（按更新时间倒序，最多 limit 条）
 */
export async function fetchDocumentList(limit = 300): Promise<ContextDoc[]> {
  const docs = await listDocuments(limit);
  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    hpath: d.hpath,
    addedAt: Date.now(),
  }));
}

/**
 * 关键词搜索文档
 */
export async function fetchDocumentSearch(keyword: string): Promise<ContextDoc[]> {
  const docs = await searchDocuments(keyword, 50);
  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    hpath: d.hpath,
    addedAt: Date.now(),
  }));
}

/**
 * 拉取文档正文（用于把上下文拼进对话）
 * 截断到 maxLen，避免超长上下文拖垮请求。
 */
export async function fetchDocContent(
  doc: ContextDoc,
  maxLen = 12000
): Promise<{ name: string; hpath: string; content: string }> {
  const raw = await getDocumentContent(doc.id, true);
  const content = raw.length > maxLen ? raw.slice(0, maxLen) + "\n…（已截断）" : raw;
  return { name: doc.name, hpath: doc.hpath, content };
}
