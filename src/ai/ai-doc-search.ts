/**
 * REword · AI 文档搜索
 * ------------------------------------------------------------------
 * 对标 copilot 的「搜索文档 / 添加上下文」：在输入框底部点击 🔍 弹窗，
 * 关键词搜索笔记库中的文档，选中后将其正文追加为对话上下文。
 *
 * 复用项目内已有的 copilot 文档搜索实现（src/copilot/api/siyuan.ts 的
 * searchDocuments / listDocuments / getDocumentContent），仅做薄封装，
 * 对齐 AiHost 所需的返回类型。
 */

import {
  searchDocuments,
  listDocuments,
  getDocumentContent,
} from "../siyuan/api.ts";

/** 文档搜索结果项 */
export interface AiDocSearchResult {
  /** 文档根块 ID（root_id / 文档 id） */
  id: string;
  /** 文档标题 */
  title: string;
  /** 人类可读路径（如 /笔记本名/文档名） */
  hpath?: string;
  /** 更新时间（ms 时间戳，可能缺失） */
  updated?: number;
}

/**
 * 搜索文档（标题 + 路径模糊匹配）。
 * @param keyword 关键词；空字符串返回最近更新的文档列表
 * @param limit   最多返回条数
 */
export async function searchDocs(
  keyword: string,
  limit = 50
): Promise<AiDocSearchResult[]> {
  const kw = (keyword || "").trim();
  const docs = kw ? await searchDocuments(kw, limit) : await listDocuments(limit);
  return docs.map((d) => ({
    id: d.id,
    title: d.name || "(无标题)",
    hpath: d.hpath || undefined,
    updated: d.updated,
  }));
}

/**
 * 读取文档正文（拼装文档下所有块的 markdown，超出 maxLen 截断）。
 * @param docId  文档根块 ID
 * @param maxLen 最大字符数，默认 12000
 *
 * P0 修复（2026-08-21）：错误不再静默,改为 throw,让上游 fetchDocText 能打到具体原因。
 * 旧版 try/catch return "" 会让任何 SQL 错误/0 行匹配都"假装成功",用户拖页签毫无反应。
 */
export async function getDocText(docId: string, maxLen = 12000): Promise<string> {
  const raw = await getDocumentContent(docId, true);
  if (!raw) {
    throw new Error(`getDocumentContent 返回空:docId=${docId} 长度=${docId.length}(思源 v3.x 文档 ID 是 UUID 36 位)`);
  }
  return raw.length > maxLen ? raw.slice(0, maxLen) + "\n…（已截断）" : raw;
}
