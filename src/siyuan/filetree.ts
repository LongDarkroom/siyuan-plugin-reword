/**
 * 文档树与笔记本管理（Document Tree & Notebooks）
 * ------------------------------------------------------------------
 * 封装 /api/notebook 与 /api/filetree 相关能力，覆盖：
 *  - 笔记本枚举（本地 + 云端数据仓库统一在笔记本层面抽象）
 *  - 文档信息、文档树层级列举
 *  - 文档创建 / 重命名 / 删除 / 路径转换
 * 用于实现「文档树 ↔ 笔记本」的层级管理与跨文档协同。
 */
import { siyuanRequest, SIYUAN_API } from "./client.ts";
import type { SiyuanNotebook, SiyuanDocInfo, SiyuanDocNode } from "./types.ts";

/** 列出所有笔记本（已挂载与已关闭均返回，closed=true 表示未挂载） */
export async function lsNotebooks(): Promise<SiyuanNotebook[]> {
  const res = await siyuanRequest<{ notebooks: SiyuanNotebook[] }>(SIYUAN_API.lsNotebooks, {});
  return res?.notebooks ?? [];
}

/** 获取文档元信息（标题、路径、hpath 等） */
export async function getDocInfo(docId: string): Promise<SiyuanDocInfo> {
  const res = await siyuanRequest<SiyuanDocInfo>(SIYUAN_API.getDocInfo, { id: docId });
  return res ?? {};
}

/**
 * 用 Markdown 创建文档，返回新建文档 ID。
 * @param notebookId 笔记本 ID
 * @param path       文档路径（如 "/我的文档/新页面"）
 * @param markdown   文档 Markdown 内容
 */
export async function createDocWithMd(
  notebookId: string,
  path: string,
  markdown: string
): Promise<string> {
  const res = await siyuanRequest<string>(SIYUAN_API.createDocWithMd, {
    notebook: notebookId,
    path,
    markdown,
  });
  return res;
}

/**
 * 列举某笔记本/目录下的文档树（层级结构）
 * @param notebookId 笔记本 ID
 * @param path       起始路径（为空表示笔记本根）
 */
export async function listDocsByPath(notebookId: string, path = ""): Promise<SiyuanDocNode[]> {
  const res = await siyuanRequest<{ files: SiyuanDocNode[] } | SiyuanDocNode[]>(
    SIYUAN_API.listDocsByPath,
    { notebook: notebookId, path }
  );
  // 兼容两种返回形态：{ files: [...] } 或直接数组
  if (Array.isArray(res)) return res;
  return (res as any)?.files ?? [];
}

/** 重命名文档 */
export async function renameDoc(docId: string, title: string): Promise<void> {
  await siyuanRequest(SIYUAN_API.renameDoc, { id: docId, title });
}

/** 删除文档（按笔记本 + 内核路径） */
export async function removeDoc(notebookId: string, docPath: string): Promise<void> {
  await siyuanRequest(SIYUAN_API.removeDoc, { notebook: notebookId, path: docPath });
}

/** 内核路径 → 人类可读路径（hpath）转换 */
export async function getHPathByPath(notebookId: string, docPath: string): Promise<string> {
  const res = await siyuanRequest<{ hPath: string }>(SIYUAN_API.getHPathByPath, {
    notebook: notebookId,
    path: docPath,
  });
  return res?.hPath ?? "";
}
