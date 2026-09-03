/**
 * AI 面板拖入：批量块 ID 解析
 * ------------------------------------------------------------------
 * 背景：旧实现 `resolveDragBlockId` 从设计上就只取一个 ID
 *   - dragstart 用 closest("[data-node-id]") 只抓一个元素（拖块标时干脆抓不到）；
 *   - drop 时即便走 text/html 也是 ids[0]。
 * 于是「框选多块 / 拖块标多选」永远只能进一个块。
 *
 * 思源官方的多块拖拽通道把数据编码在 **MIME 类型名本身**（不是 setData 的
 * value），所以只能遍历 dataTransfer.types 找前缀、再剥前缀分段。
 *（dragover 阶段 getData() 恒为空、只有 types 可读，也是同一原因。）
 *
 * ==================================================================
 * 编码结构（2026-09-03 实测：反编译本机 SiYuan.app
 *   /Applications/SiYuan.app/Contents/Resources/stage/build/app/common.*.js）
 * ==================================================================
 * 常量（旧版 → 新版已改名，两者都要认）：
 *   SIYUAN_DROP_GUTTER     "siyuan/gutter"  →  "application/siyuan-gutter"
 *   SIYUAN_DROP_BLOCK_REF  "application/siyuan-block-ref"
 *
 * ① gutter（拖块标 / 拖正文块），思源写入：
 *     setData(`${GUTTER}${dataType}${ZWSP}${subtype}${ZWSP}${ids}${ZWSP}${workspaceDir}`, html)
 *     → 剥前缀后 split(ZWSP) = [dataType, subtype, ids, workspaceDir]
 *     → **ids 固定在第 3 段（index 2）**，逗号分隔多块 ID
 *     思源自家的 getDropBlockIds() 也是这么取的：`j[2].split(",")`
 *     ⚠️ 不能图省事取"最后一段"——最后一段是 workspaceDir（绝对路径）。
 *     旧版思源结构为 [gutterType, ids]，故段数 <= 3 时退回最后一段。
 *
 * ② block-ref（拖书签 / 块引面板条目），值是 JSON：
 *     setData("application/siyuan-block-ref", JSON.stringify({ids, workspaceDir}))
 *     → 直接 getData 解析（类型名不带 payload，可以按名取值）
 *
 * 块 ID 正则（思源自家用 `/^\d{14}-[0-9a-z]{7}$/`）：此处沿用项目既有的
 * 宽松校验 `/^[a-z0-9-]{14,}$/i`，与 resolveDragBlockId 保持一致。
 *
 * 本模块只做纯函数解析（不碰 DOM / 不碰内核），便于 Node 单测；
 * 宿主的 DOM 采集（dragstart 多选）结果以入参形式喂进来。
 */

/** 零宽空格：思源用它在 MIME 类型名里分段（字面量不可见，故写转义） */
export const SIYUAN_ZWSP = "\u200b";

/** 新版 gutter 通道名（Constants.SIYUAN_DROP_GUTTER） */
export const SIYUAN_DROP_GUTTER = "application/siyuan-gutter";
/** 旧版 gutter 通道名（思源 v2.x，copilot 插件用的就是这个） */
export const SIYUAN_DROP_GUTTER_LEGACY = "siyuan/gutter";
/** 块引用通道：setData 的值是 JSON {ids, workspaceDir} */
export const SIYUAN_DROP_BLOCK_REF = "application/siyuan-block-ref";

/** gutter payload 中「块 ID 列表」所在分段下标：[dataType, subtype, ids, workspaceDir] */
const GUTTER_IDS_INDEX = 2;

/** 单次拖入块数量上限（防御异常数据撑爆输入框） */
export const MAX_BLOCK_IDS = 50;

/** 思源块 ID：时间戳 + 连字符 + 随机串，至少 14 位 */
const BLOCK_ID_RE = /^[a-z0-9-]{14,}$/i;

/**
 * gutter 通道前缀候选：运行时常量优先，新旧字面量兜底。
 *
 * 思源已把该常量改名过一次（siyuan/gutter → application/siyuan-gutter），
 * 直接读 window.siyuan.Constants 可以在下次改名时自动跟上；
 * 读不到（单测 / 早期版本）时按新旧顺序回落字面量。
 */
export function gutterPrefixes(): string[] {
  const list: string[] = [];
  try {
    const runtime = (globalThis as any)?.siyuan?.Constants?.SIYUAN_DROP_GUTTER;
    if (typeof runtime === "string" && runtime) list.push(runtime);
  } catch {
    /* 无 window.siyuan（单测环境）→ 走字面量 */
  }
  for (const p of [SIYUAN_DROP_GUTTER, SIYUAN_DROP_GUTTER_LEGACY]) {
    if (!list.includes(p)) list.push(p);
  }
  return list;
}

/** 清洗：去空白 + 格式校验 + 去重 + 限长 */
function sanitize(list: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const id = (raw || "").trim();
    if (!BLOCK_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_BLOCK_IDS) break;
  }
  return out;
}

/**
 * 从 dataTransfer.types 解析思源 gutter 通道携带的多个块 ID。
 *
 * @param types dt.types（DOMStringList / string[] 均可）
 * @returns 块 ID 数组（无该通道或数据非法时为空数组）
 */
export function parseGutterBlockIds(types: readonly string[] | undefined | null): string[] {
  if (!types) return [];
  const list = types as readonly string[];
  for (const prefix of gutterPrefixes()) {
    for (const t of list) {
      if (!t || !t.startsWith(prefix)) continue;
      const payload = t.slice(prefix.length);
      if (!payload) continue;
      const parts = payload.split(SIYUAN_ZWSP);
      // 新版 4 段：[dataType, subtype, ids, workspaceDir] → 固定取 index 2
      // 旧版 2 段：[gutterType, ids] → 取最后一段
      const raw = parts.length > GUTTER_IDS_INDEX ? parts[GUTTER_IDS_INDEX] : (parts[parts.length - 1] || "");
      if (!raw) continue;
      return sanitize(raw.split(","));
    }
  }
  return [];
}

/**
 * 解析块引用通道（application/siyuan-block-ref）。
 * 值是 JSON：`{ ids: [...], workspaceDir: "..." }`。
 *
 * @param raw getData(SIYUAN_DROP_BLOCK_REF) 的原始字符串
 */
export function parseBlockRefIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.ids)) return sanitize(parsed.ids as string[]);
    if (Array.isArray(parsed)) return sanitize(parsed as string[]);
  } catch {
    /* 非 JSON（异常数据）→ 空数组，交给其它通道 */
  }
  return [];
}

export interface DragBlockIdSources {
  /** dt.types —— 唯一能读到 gutter 通道的地方 */
  types?: readonly string[];
  /** getData("application/siyuan-block-ref") 的原始 JSON 串 */
  blockRefRaw?: string | null;
  /** dragstart 记录的块 ID（可能已含 DOM 多选），高可信 */
  dragstartIds?: readonly string[];
  /** text/html 解析出的块 ID（按文档顺序） */
  htmlIds?: readonly string[];
}

/**
 * 汇总各通道候选，返回本次拖入涉及的**全部**块 ID。
 *
 * 取值规则：三个高可信通道里取覆盖面更全的那个（数量相同时按
 * gutter > block-ref > dragstart 的优先序）。都为空才回退 text/html。
 */
export function collectDragBlockIds(src: DragBlockIdSources): string[] {
  const candidates: readonly string[][] = [
    sanitize(parseGutterBlockIds(src.types)),
    sanitize(parseBlockRefIds(src.blockRefRaw)),
    sanitize(src.dragstartIds ?? []),
  ];
  let best: string[] = [];
  for (const c of candidates) {
    if (c.length > best.length) best = c;
  }
  if (best.length) return best;
  return sanitize(src.htmlIds ?? []);
}
