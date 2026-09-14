/**
 * REword · 待办数据层（Todo Model）
 * ------------------------------------------------------------------
 * 全部待办都以「思源原生待办块」为唯一真源：
 *   - 建块：`/api/block/appendBlock` 传 markdown `- [ ] 文本`
 *     ⇒ 内核生成 `type='l' subtype='t'`（列表容器）+ `type='i' subtype='t'`（待办项）。
 *     ⚠️ 返回的 `doOperations[0].id` 是**列表容器** id，待办项是其子块。
 *   - 截止时间：`custom-due="YYYY-MM-DDTHH:MM"`（写在 `ial`，**不是 attrs 列**）。
 *   - 完成态：**只在 markdown**（`- [x]` / `- [ ]`）；`content`、`ial` 都不随勾选变化。
 *
 * ⚠️ 内核级查证（2026-09-13）澄清了两个会写错代码的陷阱：
 *   1. `blocks` 表**没有 `attrs` 列**，块属性在 `ial` 列 ⇒ 过滤必须 `ial LIKE '%custom-due%'`。
 *      （既有封装 `queryBlocksByAttr` 用的是 `attrs LIKE`，**查不到任何东西**，故本模块不复用它。）
 *   2. markdown 里的内联 IAL（`- [ ] 文本{: custom-due="…"}`）**不生效**，
 *      属性文本会被当成正文 ⇒ 必须建块后再 `setBlockAttrs`。
 */
import { siyuanRequest, SIYUAN_API } from "../siyuan/client.ts";
import { sqlQuery } from "../siyuan/attrs.ts";
import type { CalendarHost, TodoItem } from "./types.ts";
import { toDueString, parseNaturalTime } from "./time-parse.ts";
import { t } from "../i18n/index.ts";

/** 托管待办文档的兜底 hpath */
export const MANAGED_DOC_FALLBACK = "/Reword/待办";

/** SQL 单引号转义 */
function esc(v: string): string {
  return v.replace(/'/g, "''");
}

/** 写操作后刷新内核 SQL 索引（否则紧随其后的查询读不到新块） */
async function flush(): Promise<void> {
  try {
    await siyuanRequest(SIYUAN_API.flushTransaction, {});
  } catch {
    /* 刷不动也不致命，后续查询可能稍滞后 */
  }
}

/** 从 ial 串里提取全部 `custom-*` 属性（用于 updateBlock 后回写） */
export function extractCustomAttrs(ial: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /custom-([A-Za-z0-9_-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ial || ""))) out["custom-" + m[1]] = m[2];
  return out;
}

/** 从 markdown 里剥掉列表/复选框标记，得到纯标题 */
export function stripTaskMarkers(md: string): string {
  return (md || "").replace(/^\s*(?:[-*+]|\d+\.)\s*\[[ xX]\]\s*/, "").trim();
}

/** 从 ial 串里取 custom-due */
export function parseCustomDue(ial: string): string {
  const m = /custom-due="([^"]*)"/.exec(ial || "");
  return m ? m[1] : "";
}

/** 内核行 → TodoItem */
function project(
  r: { id: string; content?: string; markdown?: string; ial?: string; hpath?: string },
  managedPath: string
): TodoItem {
  const hpath = r.hpath || "";
  const title =
    (r.content || "").trim() ||
    stripTaskMarkers(r.markdown || "") ||
    "(todo)";
  return {
    blockId: r.id,
    title,
    due: parseCustomDue(r.ial || ""),
    done: /\[[xX]\]/.test(r.markdown || ""),
    hpath,
    managed: managedPath ? (hpath === managedPath || hpath.startsWith(managedPath + "/")) : false,
  };
}

/**
 * 列出全部带 `custom-due` 的待办块（跨文档）。
 * ⚠️ 读之前**必须先刷事务**：`setBlockAttrs` 写进 `ial` 后，内核 SQL 索引不会立即更新，
 *    紧随其后的 `ial LIKE` 查询会**静默返回 0 行**（真机复现：不 flush 查不到，flush 后命中）。
 *    这正是「保存待办后列表空白」的根因。
 */
export async function listTodos(managedPath: string): Promise<TodoItem[]> {
  await flush();
  const path = (managedPath || MANAGED_DOC_FALLBACK).replace(/'/g, "''");
  // ① 任何文档下「已排期」的待办（带 custom-due）；
  // ② 托管文档下**尚未排期**的待办 —— 否则「未排期」分组永远拿不到数据，
  //    在托管文档里建的无时间待办、以及被清空时间的待办会整条从列表消失。
  const rows = await sqlQuery<{
    id: string; content?: string; markdown?: string; ial?: string; hpath?: string;
  }>(
    `SELECT id, content, markdown, ial, hpath FROM blocks ` +
    `WHERE type='i' AND subtype='t' AND ` +
    `(ial LIKE '%custom-due%' OR hpath='${path}' OR hpath LIKE '${path}/%')`
  );
  const items = rows.map((r) => project(r, path));
  // 未完成在前；再按 due 升序（无 due 排最后）
  items.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const da = a.due || "9999-99-99T99:99";
    const db = b.due || "9999-99-99T99:99";
    return da.localeCompare(db);
  });
  return items;
}

/** 读单个待办 */
export async function getTodo(blockId: string, managedPath: string): Promise<TodoItem | null> {
  await flush();
  const rows = await sqlQuery<{
    id: string; content?: string; markdown?: string; ial?: string; hpath?: string;
  }>(
    `SELECT id, content, markdown, ial, hpath FROM blocks WHERE id='${esc(blockId)}' LIMIT 1`
  );
  return rows[0] ? project(rows[0], managedPath) : null;
}

/**
 * 新建待办 → 返回待办项块 ID。
 * @param parentDocId 挂载文档（通常为托管文档，见 ensureManagedDoc）
 */
export async function createTodo(
  title: string,
  due: string,
  parentDocId: string
): Promise<string> {
  const clean = (title || "").replace(/\r?\n/g, " ").trim() || "新待办";
  const ops = await siyuanRequest<Array<{ doOperations?: Array<{ id?: string }> }>>(
    SIYUAN_API.appendBlock,
    { dataType: "markdown", data: `- [ ] ${clean}`, parentID: parentDocId }
  );
  const containerId = ops?.[0]?.doOperations?.[0]?.id || "";
  await flush();
  let itemId = "";
  if (containerId) {
    const rows = await sqlQuery<{ id: string }>(
      `SELECT id FROM blocks WHERE parent_id='${esc(containerId)}' AND type='i' ORDER BY sort ASC LIMIT 1`
    );
    itemId = rows[0]?.id || "";
  }
  if (!itemId) itemId = containerId;
  if (itemId && due) await setTodoDue(itemId, due);
  return itemId;
}

/** 设置（或清除）截止时间；due 为空串 = 清除 custom-due */
export async function setTodoDue(blockId: string, due: string): Promise<void> {
  await siyuanRequest(SIYUAN_API.setBlockAttrs, {
    id: blockId,
    attrs: { "custom-due": due || "" },
  });
  // 写后即刷：否则调用方紧接着的 listTodos 读不到刚写的属性
  await flush();
}

/**
 * 勾选 / 取消勾选。
 * ⚠️ 必须走内核的「任务列表项标记」专用接口：它只改 `[ ]`/`[x]` 标记，
 * **不会触碰块属性**。若改用 `updateBlock` 重写整段 markdown，`custom-due`
 * 会被整片冲掉（实测：勾选一次，截止时间即丢失）。
 */
export async function setTodoDone(blockId: string, done: boolean): Promise<void> {
  await siyuanRequest(SIYUAN_API.updateTaskListItemMarker, {
    id: blockId,
    marker: done ? "x" : " ",
  });
  await flush();
}

/**
 * 改标题（保留勾选态与全部 custom-* 属性）。
 * ⚠️ `updateBlock` 以 markdown 重写整块时会**清空块属性**，故先读出再回写。
 */
export async function setTodoTitle(blockId: string, title: string): Promise<void> {
  const rows = await sqlQuery<{ markdown?: string; ial?: string }>(
    `SELECT markdown, ial FROM blocks WHERE id='${esc(blockId)}' LIMIT 1`
  );
  const row = rows[0];
  const done = /\[[xX]\]/.test(row?.markdown || "");
  const preserved = extractCustomAttrs(row?.ial || "");
  const clean = (title || "").replace(/\r?\n/g, " ").trim() || "待办";
  await siyuanRequest(SIYUAN_API.updateBlock, {
    id: blockId,
    dataType: "markdown",
    data: `- [${done ? "x" : " "}] ${clean}`,
  });
  if (Object.keys(preserved).length) {
    await siyuanRequest(SIYUAN_API.setBlockAttrs, { id: blockId, attrs: preserved });
  }
  await flush();
}

/**
 * 入口 ②：给「文档里已存在的待办块」套用自然语言时间。
 * 读块文本 → 解析（今天/明天/N天后/周X + 时刻）→ 写入 custom-due。
 * @returns 解析结果（失败时 ok=false）
 */
export async function applyNaturalDueToBlock(
  blockId: string
): Promise<{ ok: boolean; due: string; matched: string }> {
  const rows = await sqlQuery<{ content?: string; markdown?: string }>(
    `SELECT content, markdown FROM blocks WHERE id='${esc(blockId)}' LIMIT 1`
  );
  const row = rows[0];
  if (!row) return { ok: false, due: "", matched: "" };
  const text = (row.content || "").trim() || stripTaskMarkers(row.markdown || "");
  const parsed = parseNaturalTime(text);
  if (!parsed) return { ok: false, due: "", matched: "" };
  await setTodoDue(blockId, parsed.due);
  return { ok: true, due: parsed.due, matched: parsed.matched };
}

/** 删除待办项；若其列表容器空了则一并删除容器 */
export async function deleteTodo(blockId: string): Promise<void> {
  const rows = await sqlQuery<{ parent_id?: string }>(
    `SELECT parent_id FROM blocks WHERE id='${esc(blockId)}' LIMIT 1`
  );
  const parent = rows[0]?.parent_id || "";
  await siyuanRequest(SIYUAN_API.deleteBlock, { id: blockId });
  if (parent) {
    await flush();
    const p = await sqlQuery<{ type?: string }>(
      `SELECT type FROM blocks WHERE id='${esc(parent)}' LIMIT 1`
    );
    if (p[0]?.type === "l") {
      const kids = await sqlQuery<{ n: number }>(
        `SELECT COUNT(*) AS n FROM blocks WHERE parent_id='${esc(parent)}'`
      );
      if (!kids[0] || Number(kids[0].n) === 0) {
        await siyuanRequest(SIYUAN_API.deleteBlock, { id: parent });
      }
    }
  }
  await flush();
}

/** 文档是否存在 */
async function docExists(docId: string): Promise<boolean> {
  if (!docId) return false;
  const rows = await sqlQuery<{ id: string }>(
    `SELECT id FROM blocks WHERE id='${esc(docId)}' AND type='d' LIMIT 1`
  );
  return !!rows[0]?.id;
}

/** 选定创建托管文档的笔记本：优先「当前文档所在笔记本」，否则第一个已打开的笔记本 */
async function pickNotebookId(host: CalendarHost): Promise<string> {
  if (host.currentRootId) {
    try {
      const r = await sqlQuery<{ box?: string }>(
        `SELECT box FROM blocks WHERE id='${esc(host.currentRootId)}' LIMIT 1`
      );
      if (r[0]?.box) return r[0].box;
    } catch {
      /* 忽略，走兜底 */
    }
  }
  const nb = await siyuanRequest<{ notebooks?: Array<{ id: string; closed?: boolean }> }>(
    SIYUAN_API.lsNotebooks, {}
  );
  const open = (nb?.notebooks || []).filter((n) => !n.closed);
  return open[0]?.id || "";
}

/**
 * 确保「Reword 待办」托管文档存在，返回其文档 ID。
 * 顺序：缓存 ID → 按 hpath 查已有 → 新建（在当前/首个笔记本下）。
 */
export async function ensureManagedDoc(host: CalendarHost): Promise<string> {
  const settings = host.calendarStore.settings();
  const path = settings.managedDocPath || MANAGED_DOC_FALLBACK;

  const cached = host.calendarStore.managedDocId();
  if (cached && (await docExists(cached))) return cached;

  const rows = await sqlQuery<{ id: string }>(
    `SELECT id FROM blocks WHERE type='d' AND hpath='${esc(path)}' LIMIT 1`
  );
  if (rows[0]?.id) {
    await host.calendarStore.setManagedDocId(rows[0].id);
    return rows[0].id;
  }

  const notebook = await pickNotebookId(host);
  if (!notebook) throw new Error(t("找不到可用于创建待办文档的笔记本"));
  const id = await siyuanRequest<string>(SIYUAN_API.createDocWithMd, {
    notebook,
    path,
    markdown: "",
  });
  if (!id) throw new Error(t("创建托管待办文档失败"));
  await host.calendarStore.setManagedDocId(id);
  return id;
}

/** 便捷：在托管文档下新建一条待办（含 doc 自动创建） */
export async function createTodoInManagedDoc(
  host: CalendarHost,
  title: string,
  due: string
): Promise<string> {
  const docId = await ensureManagedDoc(host);
  return createTodo(title, due, docId);
}

/** 时间戳 → 本地可读（供 UI 展示"上次同步"） */
export function fmtTime(ts: number): string {
  if (!ts) return "";
  return toDueString(new Date(ts)).replace("T", " ");
}
