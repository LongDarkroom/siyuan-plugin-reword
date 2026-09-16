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
  // 属性批量（表格批量操作）：一次请求带多个块，避免 N 次单读/单写
  batchSetBlockAttrs: "/api/attr/batchSetBlockAttrs",
  // ⚠️ 批量读须自行分块（批次过大内核会拒绝）；TH 实测上限 400
  batchGetBlockAttrs: "/api/attr/batchGetBlockAttrs",
  // 块
  insertBlock: "/api/block/insertBlock",
  appendBlock: "/api/block/appendBlock",
  updateBlock: "/api/block/updateBlock",
  deleteBlock: "/api/block/deleteBlock",
  getBlockKramdown: "/api/block/getBlockKramdown",
  // 待办勾选：专用于「任务列表项」的标记切换接口。
  // ⚠️ 改勾选态**必须**用它，不要用 updateBlock 改 markdown —— 后者会把块属性（custom-*）整片冲掉。
  updateTaskListItemMarker: "/api/block/updateTaskListItemMarker",
  // 批量勾选：同样只碰 `[ ]`/`[x]`，不触碰块属性
  batchUpdateTaskListItemMarker: "/api/block/batchUpdateTaskListItemMarker",
  // 查询
  sql: "/api/query/sql",
  flushTransaction: "/api/sqlite/flushTransaction",
  // 文档树 / 笔记本
  lsNotebooks: "/api/notebook/lsNotebooks",
  getDocInfo: "/api/filetree/getDoc",
  createDocWithMd: "/api/filetree/createDocWithMd",
  listDocsByPath: "/api/filetree/listDocsByPath",
  renameDoc: "/api/filetree/renameDoc",
  removeDoc: "/api/filetree/removeDoc",
  getHPathByPath: "/api/filetree/getHPathByPath",
  getHPathByID: "/api/filetree/getHPathByID",
  /**
   * ⚠️ 删文档只能用 `{notebook, path}`（path 取自 getPathByID 的 storage 路径，形如 /<id>.sy）。
   * 实测 `{id}` 形式返回 code=0 却**什么都不做**（静默无效，无法自查）。
   */
  getPathByID: "/api/filetree/getPathByID",
  // 网络
  forwardProxy: "/api/network/forwardProxy",
} as const;
