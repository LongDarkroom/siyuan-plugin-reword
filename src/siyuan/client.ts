/**
 * SiYuan API 统一请求封装
 * ------------------------------------------------------------------
 * 所有集成层模块共享同一个底层请求方法，保证：
 *  - 单一 fetchSyncPost 来源（思源运行时注入的 `siyuan` 模块）
 *  - 统一的返回取值（直接返回 res.data，与思源内核响应结构对齐）
 *  - 统一的错误日志
 *
 * 注意：思源 `fetchSyncPost` 在业务错误（code != 0）时通常不会抛出异常，
 * 而是返回 `{ code, data, msg }`，因此本层保持「宽松取值」语义：
 * 若 data 为空则交由调用方决定默认值（与旧 block-api.ts 行为一致）。
 */
import { fetchSyncPost } from "siyuan";

/**
 * 调用思源内核 API，返回响应体中的 `data` 字段。
 * @param url   内核接口路径（如 "/api/block/getBlockKramdown"）
 * @param data  请求体参数
 */
export async function siyuanRequest<T = any>(
  url: string,
  data: Record<string, any> = {}
): Promise<T> {
  try {
    const res: any = await fetchSyncPost(url, data);
    if (res && typeof res.code === "number" && res.code !== 0) {
      console.warn(`[REword][siyuan] ${url} 返回错误 code=${res.code} msg=${res.msg || ""}`);
    }
    return (res?.data ?? null) as T;
  } catch (e) {
    console.error(`[REword][siyuan] 请求失败: ${url}`, e);
    throw e;
  }
}

/** 内核接口路径集中管理（避免散落字符串，便于审计与维护） */
export const SIYUAN_API = {
  // 属性
  setBlockAttrs: "/api/attr/setBlockAttrs",
  getBlockAttrs: "/api/attr/getBlockAttrs",
  // 块
  insertBlock: "/api/block/insertBlock",
  updateBlock: "/api/block/updateBlock",
  deleteBlock: "/api/block/deleteBlock",
  getBlockKramdown: "/api/block/getBlockKramdown",
  // 查询
  sql: "/api/query/sql",
  // 文档树 / 笔记本
  lsNotebooks: "/api/notebook/lsNotebooks",
  getDocInfo: "/api/filetree/getDocInfo",
  createDocWithMd: "/api/filetree/createDocWithMd",
  listDocsByPath: "/api/filetree/listDocsByPath",
  renameDoc: "/api/filetree/renameDoc",
  removeDoc: "/api/filetree/removeDoc",
  getHPathByPath: "/api/filetree/getHPathByPath",
} as const;
