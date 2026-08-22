/**
 * 属性（Attributes）与 SQL 查询（Query）
 * ------------------------------------------------------------------
 * 思源的属性以 IAL（Inline Attribute List）形式存储于块上，自定义属性必须 `custom-` 前缀。
 * 本模块提供：
 *  - sqlQuery：通用 SQL 查询封装（基于 /api/query/sql）
 *  - custom- 属性的便捷读写
 *  - 按属性筛选块的查询辅助
 */
import { siyuanRequest, SIYUAN_API } from "./client.ts";
import type { SiyuanBlock, SiyuanBlockAttrs } from "./types.ts";

/**
 * 执行思源 SQL 查询，返回结果行数组。
 * @param stmt  SQL 语句（针对 blocks / spans / assets 等内核表）
 * @param T     行类型（默认 SiyuanBlock，可传入自定义投影类型）
 */
export async function sqlQuery<T = SiyuanBlock>(stmt: string): Promise<T[]> {
  const res = await siyuanRequest<T[]>(SIYUAN_API.sql, { stmt });
  return res ?? [];
}

/**
 * 将属性名补全为 custom- 前缀（思源自定义属性规范）
 */
export function withCustomPrefix(key: string): string {
  return key.startsWith("custom-") ? key : `custom-${key}`;
}

/** 读取块上某个自定义属性值 */
export async function getCustomAttr(blockId: string, key: string): Promise<string | undefined> {
  const attrs = await siyuanRequest<Record<string, string>>(SIYUAN_API.getBlockAttrs, { id: blockId });
  return attrs?.[withCustomPrefix(key)];
}

/** 写入块上某个自定义属性（值为空字符串表示清除该属性） */
export async function setCustomAttr(blockId: string, key: string, value: string): Promise<void> {
  await siyuanRequest(SIYUAN_API.setBlockAttrs, {
    id: blockId,
    attrs: { [withCustomPrefix(key)]: value },
  });
}

/**
 * 按属性筛选块（基于 blocks 表的 attrs 列 LIKE 匹配）
 * @param attrKey   属性名（自动补 custom- 前缀）
 * @param attrValue 可选：指定属性值；省略则返回所有带该属性的块
 *
 * 说明：思源将块属性以 JSON 存于 attrs 列，LIKE 匹配是社区通用做法；
 * 对大规模库请配合 type/root_id 条件缩小范围。
 */
export async function queryBlocksByAttr(
  attrKey: string,
  attrValue?: string
): Promise<SiyuanBlock[]> {
  const key = withCustomPrefix(attrKey);
  const like =
    attrValue != null
      ? `%"${key}":"${attrValue}"%`
      : `%"${key}"%`;
  return sqlQuery<SiyuanBlock>(
    `SELECT * FROM blocks WHERE attrs LIKE '${like.replace(/'/g, "''")}'`
  );
}

/** 批量读取多个块的属性（减少往返，便于列表渲染） */
export async function getBlocksAttrs(blockIds: string[]): Promise<Record<string, SiyuanBlockAttrs>> {
  const out: Record<string, SiyuanBlockAttrs> = {};
  await Promise.all(
    blockIds.map(async (id) => {
      out[id] = await siyuanRequest<Record<string, string>>(SIYUAN_API.getBlockAttrs, { id });
    })
  );
  return out;
}
