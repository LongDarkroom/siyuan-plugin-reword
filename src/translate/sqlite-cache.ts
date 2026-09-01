import { logSwallow } from "../core/safe.ts";
/**
 * 译文缓存 · SQLite 持久层（思源块 + attributes 表）
 * ------------------------------------------------------------------
 * 2026-08-31 Phase 2：把译文写进思源笔记自己的 SQLite，使译文
 * ① 可被思源全文搜索 ② 可随思源同步跨设备 ③ 可用 SQL 灵活查询。
 *
 * 存储方式（不用自建数据库，直接复用思源的数据层）：
 *  - 译文正文 = 思源块（挂在「译文归档」文档下）
 *  - 检索键   = 块属性 custom-reword-key（值 = bookId|mode|hash）
 *  - 查询     = attributes 表按 name+value 精确查 → 拿 block_id → blocks 表取 content
 *
 * 为什么不用「确定性块 ID」做主键查询：
 *  `/api/block/insertBlock` 不接受自定义 id（只有 nextID/previousID/parentID），
 *  块 ID 由思源生成。所以改为在 attributes 表上建检索键——attributes(name,value)
 *  是思源自身的索引表，精确查询足够快，且不依赖 ID 格式。
 *
 * 性能约定：本层只作为「JSON 未命中时的兜底」，不是主路径。
 *  主路径仍是 mem → JSON，命中就不查 SQLite，因此零性能损失。
 *
 * 依赖：网络（思源内核 API）。内核不可用 / 未配置归档文档时整体静默跳过。
 */

/** 思源自定义块属性必须以 custom- 开头 */
const ATTR_KEY = "custom-reword-key";
const ATTR_BOOK = "custom-reword-book";
const ATTR_MODE = "custom-reword-mode";
const ATTR_TS = "custom-reword-ts";

/** 译文归档文档；未配置时 SQLite 层整体跳过 */
let archiveDocId = "";
/** 内核 API 不可用（如测试环境）时降级为 no-op，避免污染调用方 */
let apiAvailable = true;

/** 配置归档文档 ID（由插件在设置里持久化，首次写入前创建） */
export function setTranslationArchiveDoc(docId: string): void {
  archiveDocId = (docId || "").trim();
}

export function getTranslationArchiveDoc(): string {
  return archiveDocId;
}

/** SQLite 层是否可用（已配置归档文档 且 内核 API 可加载） */
export function isSqliteCacheReady(): boolean {
  return !!archiveDocId && apiAvailable;
}

/** 生成检索键：书 + 模式 + 原文 hash（与 JSON 层 hash 规则一致即可） */
export function translationKey(bookId: string, mode: string, hash: string): string {
  return `${bookId}|${mode}|${hash}`;
}

/** SQL 字符串字面量转义（思源 sqlite 用单引号；key/内容都不可信） */
function esc(s: string): string {
  return String(s ?? "").replace(/'/g, "''");
}

/**
 * 块内换行转义：思源块是单段落，真实换行会被解析成新块。
 * 写入时转成字面量 \n，读取时还原，保证内容可往返。
 */
function encodeContent(s: string): string {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/** encodeContent 的逆变换 */
function decodeContent(s: string): string {
  return String(s ?? "").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

/** 裁剪超长译文，避免单块过大拖慢思源（默认 2 万字符） */
const MAX_BLOCK_CHARS = 20000;
function clamp(s: string): string {
  return s.length > MAX_BLOCK_CHARS ? s.slice(0, MAX_BLOCK_CHARS) : s;
}

async function loadApi() {
  try {
    const mod = await import("../siyuan/api.ts");
    return {
      sql: mod.sql,
      appendBlock: mod.appendBlock,
      updateBlock: mod.updateBlock,
      refreshSql: mod.refreshSql,
    };
  } catch (__swallowErr) {
    logSwallow(__swallowErr, "sqlite-cache.ts · loadApi", "debug");
    apiAvailable = false;
    return null;
  }
}

/**
 * 批量查询：keys → 命中的译文。
 * 未配置归档文档 / 内核不可用时返回空 Map（调用方据此走原有 JSON 路径）。
 */
export async function sqliteGetBatch(keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!keys.length || !isSqliteCacheReady()) return out;
  const api = await loadApi();
  if (!api) return out;

  try {
    // ① 检索键 → block_id
    const inList = keys.map((k) => `'${esc(k)}'`).join(",");
    const rows = await api.sql<{ block_id: string; value: string }>(
      `select block_id, value from attributes where name='${ATTR_KEY}' and value in (${inList})`
    );
    if (!rows?.length) return out;

    const idToKey = new Map<string, string>();
    for (const r of rows) if (r?.block_id && r?.value) idToKey.set(r.block_id, r.value);

    // ② block_id → 正文
    const ids = [...idToKey.keys()];
    const idList = ids.map((id) => `'${esc(id)}'`).join(",");
    const blocks = await api.sql<{ id: string; content: string }>(
      `select id, content from blocks where id in (${idList})`
    );
    for (const b of blocks || []) {
      const key = idToKey.get(b.id);
      if (!key) continue;
      const text = decodeContent(b.content || "");
      if (text) out.set(key, text);
    }
  } catch (__swallowErr) {
    logSwallow(__swallowErr, "sqlite-cache.ts · sqliteGetBatch", "debug");
  }
  return out;
}

/**
 * 批量写入：已存在的 key 走 updateBlock，新 key 走 appendBlock。
 * 写完后 refreshSql 刷事务，确保立刻可被 SQL 查到。
 */
export async function sqliteSetBatch(
  pairs: Array<[string, string]>,
  meta: { bookId: string; mode: string }
): Promise<void> {
  if (!pairs.length || !isSqliteCacheReady()) return;
  const api = await loadApi();
  if (!api) return;

  try {
    const keys = pairs.map(([k]) => k);
    const inList = keys.map((k) => `'${esc(k)}'`).join(",");

    // 已存在 → 收集 block_id 以便原地更新
    const existRows = await api.sql<{ block_id: string; value: string }>(
      `select block_id, value from attributes where name='${ATTR_KEY}' and value in (${inList})`
    );
    const keyToId = new Map<string, string>();
    for (const r of existRows || []) {
      if (r?.block_id && r?.value) keyToId.set(r.value, r.block_id);
    }

    const ts = String(Date.now());
    const updates: Array<[string, string]> = [];
    const inserts: Array<[string, string]> = [];
    for (const [k, tr] of pairs) {
      const id = keyToId.get(k);
      if (id) updates.push([id, tr]);
      else inserts.push([k, tr]);
    }

    // 更新已有块
    for (const [id, tr] of updates) {
      await api.updateBlock("markdown", clamp(encodeContent(tr)), id);
    }

    // 新增块：一次 appendBlock 批量提交（块间用空行分隔）
    if (inserts.length) {
      const md = inserts
        .map(
          ([k, tr]) =>
            `${clamp(encodeContent(tr))}{: ${ATTR_KEY}="${k}" ${ATTR_BOOK}="${meta.bookId}" ` +
            `${ATTR_MODE}="${meta.mode}" ${ATTR_TS}="${ts}"}`
        )
        .join("\n\n");
      await api.appendBlock("markdown", md, archiveDocId);
    }

    await api.refreshSql();
  } catch (__swallowErr) {
    logSwallow(__swallowErr, "sqlite-cache.ts · sqliteSetBatch", "debug");
  }
}

/** 批量删除（清空某书缓存 / 删除单段时调用） */
export async function sqliteDeleteKeys(keys: string[]): Promise<void> {
  if (!keys.length || !isSqliteCacheReady()) return;
  const api = await loadApi();
  if (!api) return;
  try {
    const inList = keys.map((k) => `'${esc(k)}'`).join(",");
    const rows = await api.sql<{ block_id: string }>(
      `select block_id from attributes where name='${ATTR_KEY}' and value in (${inList})`
    );
    const { deleteBlock } = await import("../siyuan/api.ts");
    for (const r of rows || []) {
      if (r?.block_id) await deleteBlock(r.block_id);
    }
    await api.refreshSql();
  } catch (__swallowErr) {
    logSwallow(__swallowErr, "sqlite-cache.ts · sqliteDeleteKeys", "debug");
  }
}

/** 按书删除（清空某本书的全部译文块） */
export async function sqliteDeleteBook(bookId: string): Promise<number> {
  if (!isSqliteCacheReady()) return 0;
  const api = await loadApi();
  if (!api) return 0;
  try {
    const rows = await api.sql<{ block_id: string }>(
      `select block_id from attributes where name='${ATTR_BOOK}' and value='${esc(bookId)}'`
    );
    const { deleteBlock } = await import("../siyuan/api.ts");
    let n = 0;
    for (const r of rows || []) {
      if (r?.block_id) {
        await deleteBlock(r.block_id);
        n++;
      }
    }
    if (n) await api.refreshSql();
    return n;
  } catch (__swallowErr) {
    logSwallow(__swallowErr, "sqlite-cache.ts · sqliteDeleteBook", "debug");
    return 0;
  }
}

/** 归档文档标题（创建时用） */
export const ARCHIVE_DOC_PATH = "/REword 译文归档";

/**
 * 文档是否存在（按 id + type='d' 查 blocks 表）。
 * 用于校验设置里保存的 docId 是否仍然有效（用户可能手动删掉了该文档）。
 */
async function docExists(id: string): Promise<boolean> {
  if (!id) return false;
  const api = await loadApi();
  if (!api) return false;
  try {
    const rows = await api.sql<{ id: string }>(`select id from blocks where id='${esc(id)}' and type='d'`);
    return !!rows?.length;
  } catch (__swallowErr) {
    logSwallow(__swallowErr, "sqlite-cache.ts · docExists", "debug");
    return false;
  }
}

/**
 * 确保归档文档存在：优先复用已保存的 docId，失效或缺失则新建一个。
 *
 * 在用户思源里建文档属于侵入性操作，因此**只在调用方明确启用后才调用**，
 * 且把 docId 交给调用方持久化（存进插件设置），下次直接复用。
 *
 * @param getSaved 读取已保存的 docId
 * @param save     持久化新建的 docId
 * @returns 可用的归档文档 ID；失败返回空串（此时 SQLite 层保持关闭）
 */
export async function ensureTranslationArchiveDoc(
  getSaved: () => string,
  save: (docId: string) => Promise<void> | void
): Promise<string> {
  const saved = (getSaved?.() || "").trim();
  if (saved && (await docExists(saved))) {
    setTranslationArchiveDoc(saved);
    return saved;
  }

  const api = await loadApi();
  if (!api) return "";
  try {
    const { lsNotebooks } = await import("../siyuan/api.ts");
    const res = (await lsNotebooks()) as any;
    // lsNotebooks 返回形如 { notebooks: [...] }，兼容直接返回数组的情况
    const list = Array.isArray(res) ? res : res?.notebooks || [];
    const nbId = list?.[0]?.id;
    if (!nbId) return "";

    const md =
      "# REword 译文归档\n\n" +
      "本笔记本存放阅读器双语译文，供思源搜索 / SQL 查询 / 跨设备同步使用。\n\n" +
      "每段译文是一个块，块属性 `custom-reword-key` 为检索键（书 ID|模式|原文 hash）。\n";
    const { createDocWithMd } = await import("../siyuan/api.ts");
    const docId = await createDocWithMd(nbId, ARCHIVE_DOC_PATH, md);
    const id = String(docId || "").trim();
    if (!id) return "";

    setTranslationArchiveDoc(id);
    await save?.(id);
    return id;
  } catch (__swallowErr) {
    logSwallow(__swallowErr, "sqlite-cache.ts · ensureTranslationArchiveDoc", "debug");
    return "";
  }
}

/** 统计归档文档下的译文块数量（供 UI 展示） */
export async function sqliteCount(): Promise<number> {
  if (!isSqliteCacheReady()) return 0;
  const api = await loadApi();
  if (!api) return 0;
  try {
    const rows = await api.sql<{ c: number }>(
      `select count(*) as c from attributes where name='${ATTR_KEY}'`
    );
    return Number(rows?.[0]?.c || 0);
  } catch (__swallowErr) {
    logSwallow(__swallowErr, "sqlite-cache.ts · sqliteCount", "debug");
    return 0;
  }
}
