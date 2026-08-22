/**
 * 块级操作与大纲同步（Block & Outline）
 * ------------------------------------------------------------------
 * 封装思源块的核心读写能力，并提供面向「大纲视图 ↔ 块编辑器」双向同步的辅助查询。
 * 数据写入采用 kramdown / Markdown 标记；大纲同步通过 SQL 按 parent_id / sort 还原层级。
 */
import { siyuanRequest, SIYUAN_API } from "./client.ts";
import { sqlQuery } from "./attrs.ts";
import type { SiyuanBlock, SiyuanBlockAttrs } from "./types.ts";

/* ============ 基础读写 ============ */

/** 获取块的 kramdown 源码（带格式标记，落 AI 精读 / 拖拽时使用） */
export async function getBlockKramdown(blockId: string): Promise<string> {
  const res = await siyuanRequest<{ kramdown: string }>(SIYUAN_API.getBlockKramdown, { id: blockId });
  return res?.kramdown ?? "";
}

/** 读取块属性（含 custom- 自定义属性与系统属性） */
export async function getBlockAttrs(blockId: string): Promise<SiyuanBlockAttrs> {
  const res = await siyuanRequest<Record<string, string>>(SIYUAN_API.getBlockAttrs, { id: blockId });
  return res ?? {};
}

/** 写入块属性（自定义属性务必以 custom- 前缀命名，见 attrs.ts） */
export async function setBlockAttrs(blockId: string, attrs: Record<string, string>): Promise<void> {
  await siyuanRequest(SIYUAN_API.setBlockAttrs, { id: blockId, attrs });
}

/** 更新块内容（dataType: "markdown" | "dom"） */
export async function updateBlock(blockId: string, dataType: string, data: string): Promise<void> {
  await siyuanRequest(SIYUAN_API.updateBlock, { id: blockId, dataType, data });
}

/** 在父块下插入子块，返回新块 operations（含新块 ID） */
export async function insertBlock(
  parentID: string,
  dataType: string,
  data: string
): Promise<{ operations: { id: string }[] }> {
  const res = await siyuanRequest<{ operations: { id: string }[] }>(SIYUAN_API.insertBlock, {
    parentID,
    dataType,
    data,
  });
  return res;
}

/** 删除块 */
export async function deleteBlock(blockId: string): Promise<void> {
  await siyuanRequest(SIYUAN_API.deleteBlock, { id: blockId });
}

/* ============ 大纲同步（Outline Sync）============ */

/** 按 ID 精确获取单个块 */
export async function getBlockByID(blockId: string): Promise<SiyuanBlock | null> {
  const rows = await sqlQuery<SiyuanBlock>(`SELECT * FROM blocks WHERE id='${blockId}'`);
  return rows[0] ?? null;
}

/** 获取某块的直接子块（按 sort 升序，对应大纲同层顺序） */
export async function getChildBlocks(parentId: string): Promise<SiyuanBlock[]> {
  return sqlQuery<SiyuanBlock>(
    `SELECT * FROM blocks WHERE parent_id='${parentId}' ORDER BY sort ASC`
  );
}

/** 获取某块的父块 */
export async function getParentBlock(blockId: string): Promise<SiyuanBlock | null> {
  const rows = await sqlQuery<SiyuanBlock>(
    `SELECT * FROM blocks WHERE id=(SELECT parent_id FROM blocks WHERE id='${blockId}')`
  );
  return rows[0] ?? null;
}

/**
 * 获取文档内标题大纲（所有 type='h' 的块，按 sort 顺序）。
 * 用于「大纲视图 ↔ 编辑器」双向定位：大纲项点击即在编辑器滚动到对应块。
 */
export async function getDocOutline(rootId: string): Promise<SiyuanBlock[]> {
  return sqlQuery<SiyuanBlock>(
    `SELECT * FROM blocks WHERE root_id='${rootId}' AND type='h' ORDER BY sort ASC`
  );
}

/**
 * 根据块 ID 回溯其所在文档根 ID（用于跨模块定位文档上下文）
 */
export async function getRootIdByBlock(blockId: string): Promise<string | null> {
  const rows = await sqlQuery<{ root_id: string }>(
    `SELECT root_id FROM blocks WHERE id='${blockId}'`
  );
  return rows[0]?.root_id ?? null;
}
