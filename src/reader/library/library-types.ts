/**
 * 书库类型与常量（library/ 层）
 * ---------------------------------------------------------------
 * 从 bookshelf-store.ts 原位抽取而来，保持形状 100% 不变以保证老数据兼容。
 * 新增条目校验器 isValidBookMeta / isValidBookGroup，供 library-persist 的
 * 安全恢复（坏条 quarantine）使用。
 *
 * 对应 Readest 蓝图：本文件 ≈ Readest libs/library.ts 的「类型与常量」部分。
 */

import { type BookType } from "../reader-mode.ts";

/** 阅读进度：cfi（EPUB 定位）/ fraction（通用比例定位 0-1）/ index（章节或页码 0-based） */
export interface ReadingProgress {
  cfi?: string;
  fraction?: number;
  index?: number;
  // [REword patch 2026-08-29] PDF 缩放状态（仅 PDF 用，optional 字段，老数据兼容）
  zoom?: ZoomState;
  // 2026-09-09 PDF 阅读进度修复：显式页码（1-based）。
  // foliate fixed-layout 上报 size:1 → 保存的 fraction 是「页尾边界」，getSection
  // 反解会落到下一页（每次会话 +1 页累积漂移）；PDF 恢复改用页码精确换算。
  page?: number;
}

/** PDF 缩放状态（per-file 持久化） */
export type ZoomState =
  | { kind: "fit-width" }
  | { kind: "fit-page" }
  | { kind: "custom"; scale: number }; // 0.25 - 4.0

/** 缩放预设档位（Zoom in/out 步进用，参考 Obsidian PDF++） */
export const ZOOM_PRESETS: readonly number[] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;

/* ================================================================
 * 2026-08-29 书架 P0/P1：阅读状态 / 分组 / 标签 / 排序 / 筛选
 * ================================================================ */

/** 阅读状态：想读（未开始）/ 在读 / 读完 */
export type BookStatus = "unread" | "reading" | "finished";

/* ================================================================
 * 2026-08-29 书架 P2：macOS 风格 7 色 token
 * - 用于 BookGroup.color / BookMeta.color / BookFilter.color
 * - 不用裸 hex 存储,token 化便于未来扩展自定义色 + 主题适配
 * - 与 docs/bookshelf-interaction-refinement.md §2.1 保持一致
 * ================================================================ */

/** 7 色 token（与 macOS Finder 6 色 + 灰色归档对齐,沿用用户截图） */
export type BookColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray";

/** 7 色字典:UI swatch 渲染 / 排序时反查索引 / 任意模块查找 token 用 */
export const BOOK_COLORS: readonly { token: BookColor; label: string; hex: string }[] = [
  { token: "red", label: "红", hex: "#ff453a" },
  { token: "orange", label: "橙", hex: "#ff9f0a" },
  { token: "yellow", label: "黄", hex: "#ffd60a" },
  { token: "green", label: "绿", hex: "#34c759" },
  { token: "blue", label: "蓝", hex: "#0a84ff" },
  { token: "purple", label: "紫", hex: "#bf5af2" },
  { token: "gray", label: "灰", hex: "#8e8e93" },
] as const;

/** 反查 token → 索引(用于颜色排序),O(1) 字典 */
export const BOOK_COLOR_INDEX: Record<BookColor, number> = (() => {
  const out = {} as Record<BookColor, number>;
  BOOK_COLORS.forEach((c, i) => (out[c.token] = i));
  return out;
})();

/** 校验颜色 token 合法性,用于 API 入口的脏数据防御 */
export function isValidBookColor(s: unknown): s is BookColor {
  return typeof s === "string" && s in BOOK_COLOR_INDEX;
}

/** 用户自建分组（书架「文件夹」），独立索引文件持久化 */
export interface BookGroup {
  id: string;
  name: string;
  createdAt: number;
  /** 2026-08-29 新增:macOS 风格 7 色 token,见 BOOK_COLORS 字典;缺省 = 无色 */
  color?: BookColor;
}

/** 排序键 */
export type BookSortKey =
  | "lastRead"
  | "addedAt"
  | "title"
  | "author"
  | "progress"
  | "readingTime"
  | "rating"
  | "size"
  | "color";

/** 排序方向 */
export type SortDir = "asc" | "desc";

/** 书架筛选条件（全部 optional，缺省 = 不限） */
export interface BookFilter {
  /** 关键词：匹配书名 / 作者 / 标签 / 丛书 */
  keyword?: string;
  /** 阅读状态；"all" 或缺省 = 不限 */
  status?: BookStatus | "all";
  /** 格式（小写，如 epub/pdf）；"all" 或缺省 = 不限 */
  format?: string;
  /** 单标签精确匹配 */
  tag?: string;
  /** 分组：具体 id / "ungrouped" 未分组 / "all" 不限 */
  groupId?: string;
  /** 仅看收藏 */
  favoriteOnly?: boolean;
  /** 最低评分（1-5） */
  minRating?: number;
  /** 2026-08-29 新增:单色精确匹配;缺省 = 不限 */
  color?: BookColor;
}

/** 阅读书签（2026-08-29 新增：对齐 Obsidian weave 的「书签 / 参考阅读点」） */
export interface BookMark {
  id: string;
  /** foliate CFI 锚点（PDF 时为 foliate 自派发的锚点串） */
  cfi: string;
  /** 用户可改的书签名；缺省时 UI 回退显示章节名 */
  label?: string;
  /** 书签处的正文摘录（前若干字，便于列表里辨认位置） */
  excerpt?: string;
  createdAt: number;
  /** 2026-09-03 新增：媒体类型双保险（pdf/epub/other）。渲染「我的标记」抽屉时按当前书籍过滤，防止跨格式串味 */
  bookType?: BookType;
}

export interface BookMeta {
  id: string;
  title: string;
  author?: string;
  /** EPUB 语言（dc:language） */
  language?: string;
  /** epub / mobi / azw3 / fb2 / cbz / pdf / txt / md */
  format: string;
  /** 思源 data 内路径 */
  path: string;
  /** 封面图路径（EPUB 提取；TXT/MD 无） */
  cover?: string;
  size: number;
  addedAt: number;
  lastReadAt?: number;
  /** 累计阅读时长（毫秒） */
  readingTimeMs?: number;
  /** 按本地日期分桶的阅读时长（毫秒），键为 YYYY-MM-DD，用于日历热力图 */
  readingLog?: Record<string, number>;
  progress?: ReadingProgress;
  /* ---- 2026-08-29 书架 P0/P1 新增字段（全 optional，老数据兼容） ---- */
  /** 阅读状态；缺省视为 unread */
  status?: BookStatus;
  /** 评分 0-5；0/缺省 = 未评分 */
  rating?: number;
  /** 收藏星标 */
  favorite?: boolean;
  /** 标签 */
  tags?: string[];
  /** 丛书 / 系列名 */
  series?: string;
  /** 所属用户分组 id；缺省 = 未分组 */
  groupId?: string;
  /** 2026-08-29 新增：本书书签（按 createdAt 升序；老数据无此字段，缺省空数组） */
  bookmarks?: BookMark[];
  /** 2026-08-29 P2 新增:macOS 风格 7 色 token,见 BOOK_COLORS 字典;缺省 = 无色 */
  color?: BookColor;
  /** 2026-08-29 P2 新增:同组内手动排序用(数字小 = 靠前),缺省 = 跟随 query 排序 */
  order?: number;
}

/* ================================================================
 * 2026-09-05 R2 安全恢复：条目校验器
 * - 仅校验「必需字段」，全 optional 字段一律放行（老数据兼容）。
 * - loadLibraryIndex 用它们做坏条 quarantine，绝不因单条损坏而清空整架。
 * ================================================================ */

/** 校验单本 BookMeta 是否可安全加载（必需字段齐全） */
export function isValidBookMeta(x: unknown): x is BookMeta {
  if (!x || typeof x !== "object") return false;
  const m = x as Record<string, unknown>;
  if (typeof m.id !== "string" || !m.id) return false;
  if (typeof m.title !== "string") return false;
  if (typeof m.format !== "string") return false;
  if (typeof m.path !== "string") return false;
  if (typeof m.size !== "number") return false;
  if (typeof m.addedAt !== "number") return false;
  // bookmarks：若提供则必须是数组（非数组视为损坏，整条隔离）；老数据多为 undefined，安全放行
  if (m.bookmarks !== undefined && !Array.isArray(m.bookmarks)) return false;
  return true;
}

/** 校验单个用户分组是否可安全加载 */
export function isValidBookGroup(x: unknown): x is BookGroup {
  if (!x || typeof x !== "object") return false;
  const g = x as Record<string, unknown>;
  if (typeof g.id !== "string" || !g.id) return false;
  if (typeof g.name !== "string") return false;
  if (typeof g.createdAt !== "number") return false;
  return true;
}
