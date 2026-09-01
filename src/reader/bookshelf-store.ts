import { logSwallow } from "../core/safe.ts";
/**
 * 阅读器 - 书架存储
 * ---------------------------------------------------------------
 * - 书架索引持久化到插件数据 hiword-bookshelf.json（loadData/saveData）
 * - 书籍文件本体存思源 data 的插件私有目录 /data/plugins/<name>/books/，
 *   卸载插件即整体移除，符合「卸载无残留」原则。
 */

import { putFile, getFileBlob, removeFile } from "../siyuan/api";
import { unzipSync } from "fflate";
import { writable } from "svelte/store";
import { bookFingerprint } from "./book-fingerprint.ts";

/** 阅读进度：cfi（EPUB 定位）/ fraction（通用比例定位 0-1）/ index（章节或页码 0-based） */
export interface ReadingProgress {
  cfi?: string;
  fraction?: number;
  index?: number;
  // [REword patch 2026-08-29] PDF 缩放状态（仅 PDF 用，optional 字段，老数据兼容）
  zoom?: ZoomState;
}

/** PDF 缩放状态（per-file 持久化） */
export type ZoomState =
  | { kind: "fit-width" }
  | { kind: "fit-page" }
  | { kind: "custom"; scale: number };  // 0.25 - 4.0

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
  { token: "red",    label: "红", hex: "#ff453a" },
  { token: "orange", label: "橙", hex: "#ff9f0a" },
  { token: "yellow", label: "黄", hex: "#ffd60a" },
  { token: "green",  label: "绿", hex: "#34c759" },
  { token: "blue",   label: "蓝", hex: "#0a84ff" },
  { token: "purple", label: "紫", hex: "#bf5af2" },
  { token: "gray",   label: "灰", hex: "#8e8e93" },
] as const;

/** 反查 token → 索引(用于颜色排序),O(1) 字典 */
const BOOK_COLOR_INDEX: Record<BookColor, number> = (() => {
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

const INDEX_KEY = "hiword-bookshelf.json";
/** 用户分组索引（独立文件：书架索引保持纯数组，向后兼容） */
const GROUPS_KEY = "hiword-bookshelf-groups.json";
const BOOKS_DIR = (pluginName: string) =>
  `/data/plugins/${pluginName}/books`;

/** 本地日期键 YYYY-MM-DD（按用户时区，非 UTC） */
function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export class BookshelfStore {
  private books: BookMeta[] = [];
  /** 用户自建分组（独立持久化，见 GROUPS_KEY） */
  private _groups: BookGroup[] = [];
  private loaded = false;
  /** 内部 Svelte store：让消费者可订阅书架变化（导入/删除/进度更新后自动刷新） */
  private _store = writable<BookMeta[]>([]);

  constructor(private plugin: any) {}

  /** 实现 Svelte store 契约：返回退订函数 */
  subscribe(run: (value: BookMeta[]) => void, invalidate?: (value?: BookMeta[]) => void): () => void {
    return this._store.subscribe(run, invalidate as any);
  }

  get list(): BookMeta[] {
    return [...this.books].sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt));
  }

  get(id: string): BookMeta | undefined {
    return this.books.find((b) => b.id === id);
  }

  async load(): Promise<void> {
    if (this.loaded) {
      this._store.set([...this.books]);
      return;
    }
    try {
      const data = await this.plugin.loadData(INDEX_KEY);
      if (Array.isArray(data)) this.books = data;
    } catch {
      this.books = [];
    }
    // 分组索引：独立文件，不存在即空数组（老数据无此文件）
    try {
      const g = await this.plugin.loadData(GROUPS_KEY);
      if (Array.isArray(g)) this._groups = g;
    } catch {
      this._groups = [];
    }
    this.loaded = true;
    this._store.set([...this.books]);
  }

  private async save(): Promise<void> {
    try {
      await this.plugin.saveData(INDEX_KEY, this.books);
    } catch (e) {
      console.warn("[REword] 书架索引持久化失败:", e);
    }
  }

  /**
   * 从 PDF 中解析元数据与封面
   * - 元数据：PDF.js getMetadata().info（Title / Author / Subject）
   * - 封面：渲染第 1 页为缩略图（scale 0.3, jpeg 80%）
   *
   * [REword patch 2026-08-29] PDF 适配 Phase 1：复用 foliate-js vendor 里的 pdf.mjs
   * pdf.mjs 第 45 行 `var __webpack_exports__ = globalThis.pdfjsLib = {};` 自挂载，
   * 这里动态 import 一次触发副作用即可拿到 pdfjsLib。
   *
   * 失败容错：解析失败不阻断导入（返回空对象，调用方用文件名 fallback）
   */
  private async extractPdfMeta(file: File): Promise<{
    title?: string;
    author?: string;
    cover?: { blob: Blob; ext: string };
  }> {
    try {
      // 动态 import 触发 pdf.mjs 自挂载到 globalThis.pdfjsLib
      // @ts-expect-error vendor/pdfjs/pdf.mjs 无 .d.ts，运行时类型已挂 globalThis
      await import("./vendor/foliate-js/vendor/pdfjs/pdf.mjs");
      const pdfjsLib = (globalThis as any).pdfjsLib;
      if (!pdfjsLib?.getDocument) return {};

      // PDF.js worker：与 foliate-js/pdf.js 一致，用独立 worker 文件
      // Phase 1.5：copy-dist.mjs 已把 pdf.worker.mjs 复制到插件根目录
      // 思源 webview 通过 /plugins/siyuan-plugin-reword/pdf.worker.mjs 访问
      // [REword patch 2026-08-29] Phase 1 移动端：弱设备/iOS WKWebView 用主线程模式
      // 原因：iOS 15.4+ WKWebView 对 Web Worker 严格 CORS 校验，
      // 且 iOS 15.6 以下无 OffscreenCanvas，worker 加载失败导致白屏。
      // 弱设备（移动端 / < 4 核 / iOS）→ workerSrc 设空走 fake worker（主线程跑）
      try {
        const isWeakDevice = (() => {
          try {
            const ua = navigator.userAgent;
            const cores = navigator.hardwareConcurrency ?? 4;
            const isMob = /Mobi|Android|iPhone|iPad|iPod/.test(ua);
            const isIOS = /iPad|iPhone|iPod/.test(ua);
            return isMob || isIOS || cores < 4;
          } catch {
            return false;
          }
        })();
        if (isWeakDevice) {
          // 弱设备：禁用 worker，主线程同步跑（性能损失但能加载）
          pdfjsLib.GlobalWorkerOptions.workerSrc = "";
        } else {
          const origin = (typeof globalThis !== "undefined" && globalThis.location?.origin) || "";
          pdfjsLib.GlobalWorkerOptions.workerSrc = origin
            ? `${origin}/plugins/siyuan-plugin-reword/pdf.worker.mjs`
            : "./pdf.worker.mjs";
        }
      } catch {
        // ignore
      }

      const buf = new Uint8Array(await file.arrayBuffer());
      const loadingTask = pdfjsLib.getDocument({
        data: buf,
        // [REword patch 2026-08-29] PDF 适配 Phase 1.5：恢复 worker 模式
        // 配合 workerSrc = /plugins/siyuan-plugin-reword/pdf.worker.mjs
        // Phase 1 的 disableWorker: true 已移除（详见 foliate-js/pdf.js 注释）
        // [REword patch 2026-08-29] 移动端：workerSrc 为空时 PDF.js 自动主线程跑
      });
      const pdf = await loadingTask.promise;

      // 1. 元数据
      const info = await pdf.getMetadata().then((m: any) => m?.info ?? {});
      const title = (info?.Title || "").trim() || undefined;
      const author = (info?.Author || "").trim() || undefined;

      // 2. 封面：渲染第 1 页为缩略图
      let cover: { blob: Blob; ext: string } | undefined;
      try {
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.3 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d");
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          const blob: Blob | null = await new Promise((resolve) =>
            canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8)
          );
          if (blob) cover = { blob, ext: "jpg" };
        }
      } catch {
        // 封面渲染失败不阻断
      }

      // 释放 PDF 文档
      try {
        await pdf.destroy?.();
      } catch {
        // ignore
      }

      return { title, author, cover };
    } catch {
      return {};
    }
  }

  /**
   * 从 EPUB 中解析元数据与封面（一次解压）
   * - 元数据：OPF 的 dc:title / dc:creator / dc:language
   * - 封面：container.xml → OPF → meta[name=cover] → manifest item
   */
  private async extractEpubMeta(file: File): Promise<{
    title?: string;
    author?: string;
    language?: string;
    identifier?: string;
    cover?: { blob: Blob; ext: string };
  }> {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const files = unzipSync(buf);
      const decode = (name: string): string | null => {
        const b = files[name];
        return b ? new TextDecoder().decode(b) : null;
      };
      // 1. container.xml → OPF 路径
      const containerXml = decode("META-INF/container.xml");
      if (!containerXml) return {};
      const containerDoc = new DOMParser().parseFromString(containerXml, "text/xml");
      const rootfile = Array.from(containerDoc.getElementsByTagName("rootfile"))[0]?.getAttribute("full-path");
      if (!rootfile) return {};
      // 2. OPF → 元数据 + 封面
      const opfXml = decode(rootfile);
      if (!opfXml) return {};
      const opfDoc = new DOMParser().parseFromString(opfXml, "text/xml");
      const dir = rootfile.includes("/") ? rootfile.slice(0, rootfile.lastIndexOf("/") + 1) : "";
      const q = (local: string): string | undefined => {
        const el = opfDoc.getElementsByTagNameNS("*", local)[0];
        return el?.textContent?.trim() || undefined;
      };
      const title = q("title");
      const author = q("creator");
      const language = q("language");
      const identifier = q("identifier");
      // 封面
      let cover: { blob: Blob; ext: string } | undefined;
      let coverId = "";
      for (const meta of Array.from(opfDoc.getElementsByTagName("meta"))) {
        if (meta.getAttribute("name") === "cover") {
          coverId = meta.getAttribute("content") ?? "";
          break;
        }
      }
      if (coverId) {
        let href = "";
        let mediaType = "";
        for (const item of Array.from(opfDoc.getElementsByTagName("item"))) {
          if (item.getAttribute("id") === coverId) {
            href = item.getAttribute("href") ?? "";
            mediaType = item.getAttribute("media-type") ?? "";
            break;
          }
        }
        if (href) {
          const clean = href.split("#")[0].split("?")[0];
          const data = files[dir + clean];
          if (data) {
            const ext = (clean.match(/\.(jpe?g|png|gif|webp)$/i)?.[1] ?? "jpg").toLowerCase();
            const type = mediaType || `image/${ext === "jpg" ? "jpeg" : ext}`;
            cover = { blob: new Blob([data], { type }), ext };
          }
        }
      }
      return { title, author, language, identifier, cover };
    } catch {
      return {}; // 解析失败不阻断导入
    }
  }

  /**
   * 导入书籍：上传文件到思源 + 提取元数据/封面 + 登记书架
   * @returns 新书的 meta；返回 null 表示与已有书重复（文件名+大小一致），已跳过
   */
  async importBook(file: File): Promise<BookMeta | null> {
    await this.load();
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "epub").toLowerCase();
    const nameBase = file.name.replace(/\.(epub|mobi|azw3|fb2|cbz|pdf|txt|md|markdown)$/i, "") || file.name;
    // 去重：同名(去扩展名)+同大小视为重复
    const dup = this.books.find(
      (b) => b.title.toLowerCase() === nameBase.toLowerCase() && b.size === file.size
    );
    if (dup) return null;

    // 先提取元数据（EPUB/PDF），以便用「内容指纹」生成稳定 bookId
    let title: string | undefined;
    let author: string | undefined;
    let language: string | undefined;
    let identifier: string | undefined;
    let coverBlob: { blob: Blob; ext: string } | undefined;
    if (ext === "epub") {
      const meta = await this.extractEpubMeta(file);
      title = meta.title;
      author = meta.author;
      language = meta.language;
      identifier = meta.identifier;
      coverBlob = meta.cover;
    } else if (ext === "pdf") {
      // [REword patch 2026-08-29] PDF 适配 Phase 1：元数据 + 首页封面
      const meta = await this.extractPdfMeta(file);
      title = meta.title;
      author = meta.author;
      coverBlob = meta.cover;
    }

    // 内容指纹 → 稳定 id：同一实体书无论导入几次、删除后重导，
    // 永远得到同一 id，复用同一份 translations/<id>.json 缓存，
    // 从根本上避免「同一本书多份缓存翻译」。
    const id = bookFingerprint({
      identifier,
      title: title || nameBase,
      author,
      size: file.size,
      format: ext === "markdown" ? "md" : ext,
    });
    // 指纹级去重：书架已存在同指纹书则跳过重复导入（直接复用既有缓存）
    if (this.books.some((b) => b.id === id)) return null;

    const dir = BOOKS_DIR(this.plugin.name);
    const path = `${dir}/${id}.${ext}`;
    const ok = await putFile(path, false, file);
    if (!ok) throw new Error(`书籍上传失败: ${file.name}`);

    let cover: string | undefined;
    if (coverBlob) {
      try {
        await putFile(`${dir}/covers`, true, null);
      } catch (__swallowErr) { logSwallow(__swallowErr, "bookshelf-store.ts · importBook mkdir covers", "debug"); }
      const coverPath = `${dir}/covers/${id}.${coverBlob.ext}`;
      const coverOk = await putFile(coverPath, false, coverBlob.blob);
      if (coverOk) cover = coverPath;
    }
    const book: BookMeta = {
      id,
      title: title || nameBase,
      author,
      language,
      format: ext === "markdown" ? "md" : ext,
      path,
      cover,
      size: file.size,
      addedAt: Date.now(),
      lastReadAt: Date.now(),
    };
    this.books.push(book);
    await this.save();
    this._store.set([...this.books]);
    return book;
  }

  /**
   * 更新书籍元信息，返回是否成功
   * [2026-08-29] 从「书名/作者」扩展到丛书 / 状态 / 评分 / 收藏 / 标签 / 分组
   * 空串语义：author / series 传 "" = 清空该字段（转 undefined）
   */
  async updateMeta(
    id: string,
    patch: Partial<
      Pick<
        BookMeta,
        | "title"
        | "author"
        | "series"
        | "status"
        | "rating"
        | "favorite"
        | "tags"
        | "groupId"
        | "bookmarks"
        | "color"
        | "order"
      >
    >
  ): Promise<boolean> {
    await this.load();
    const meta = this.get(id);
    if (!meta) return false;
    if (typeof patch.title === "string" && patch.title.trim()) meta.title = patch.title.trim();
    if (patch.author !== undefined) meta.author = patch.author.trim() || undefined;
    if (patch.series !== undefined) meta.series = patch.series.trim() || undefined;
    if (patch.status !== undefined) meta.status = patch.status;
    if (patch.rating !== undefined) {
      const r = Math.max(0, Math.min(5, Math.round(patch.rating)));
      meta.rating = r > 0 ? r : undefined;
    }
    if (patch.favorite !== undefined) meta.favorite = patch.favorite || undefined;
    if (patch.tags !== undefined) {
      const clean = Array.from(new Set(patch.tags.map((t) => t.trim()).filter(Boolean)));
      meta.tags = clean.length ? clean : undefined;
    }
    if (patch.groupId !== undefined) meta.groupId = patch.groupId || undefined;
    // [2026-08-29] P2:颜色 / 手动排序
    if (patch.color !== undefined) {
      meta.color = isValidBookColor(patch.color) ? patch.color : undefined;
    }
    if (patch.order !== undefined) {
      const o = Number(patch.order);
      meta.order = Number.isFinite(o) ? o : undefined;
    }
    if (patch.bookmarks !== undefined) {
      const clean = patch.bookmarks
        .filter((b) => b && typeof b.cfi === "string" && b.cfi)
        .map((b) => ({
          id: b.id || `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          cfi: b.cfi,
          label: b.label?.trim() || undefined,
          excerpt: b.excerpt?.trim() || undefined,
          createdAt: typeof b.createdAt === "number" ? b.createdAt : Date.now(),
        }))
        .sort((a, b) => a.createdAt - b.createdAt);
      meta.bookmarks = clean.length ? clean : undefined;
    }
    await this.save();
    this._store.set([...this.books]);
    return true;
  }

  /** 读取书籍封面 Blob（无封面返回 null） */
  async getCoverBlob(id: string): Promise<Blob | null> {
    await this.load();
    const meta = this.get(id);
    if (!meta?.cover) return null;
    return getFileBlob(meta.cover);
  }

  /** 读取书籍文件为 Blob */
  async getBlob(id: string): Promise<Blob | null> {
    await this.load();
    const meta = this.get(id);
    if (!meta) return null;
    return getFileBlob(meta.path);
  }

  /**
   * 从书架移除书籍
   * - 默认只移除索引（源文件保留在插件目录，便于重新导入/回收）
   * - deleteFile=true 时同时删除源文件与封面
   */
  async removeBook(id: string, opts: { deleteFile?: boolean } = {}): Promise<void> {
    await this.load();
    const meta = this.get(id);
    if (meta) {
      if (opts.deleteFile) {
        try {
          await removeFile(meta.path);
        } catch (__swallowErr) { logSwallow(__swallowErr, "bookshelf-store.ts · removeBook", "warn"); }
        if (meta.cover) {
          try {
            await removeFile(meta.cover);
          } catch (__swallowErr) { logSwallow(__swallowErr, "bookshelf-store.ts · removeBook", "warn"); }
        }
      }
      this.books = this.books.filter((b) => b.id !== id);
      await this.save();
      this._store.set([...this.books]);
    }
  }

  /** 累加阅读时长（毫秒）；同时按本地日期写入 readingLog 分桶（用于日历热力图） */
  async addReadingTime(id: string, ms: number): Promise<void> {
    await this.load();
    const meta = this.get(id);
    if (!meta || ms <= 0) return;
    const delta = Math.round(ms);
    meta.readingTimeMs = (meta.readingTimeMs || 0) + delta;
    const day = localDateKey();
    meta.readingLog = meta.readingLog || {};
    meta.readingLog[day] = (meta.readingLog[day] || 0) + delta;
    await this.save();
    this._store.set([...this.books]);
  }

  /** 保存阅读进度（防抖由调用方控制） */
  async saveProgress(id: string, progress: ReadingProgress): Promise<void> {
    await this.load();
    const meta = this.get(id);
    if (!meta) return;
    meta.progress = progress;
    meta.lastReadAt = Date.now();
    // [2026-08-29] 阅读状态自动流转：读到 99.5%+ 记「读完」；
    // 只在 unread/未设置时自动置「在读」，避免覆盖用户手动标记的 finished
    const frac = typeof progress.fraction === "number" ? progress.fraction : undefined;
    if (typeof frac === "number" && frac >= 0.995) meta.status = "finished";
    else if (!meta.status || meta.status === "unread") meta.status = "reading";
    await this.save();
    this._store.set([...this.books]);
  }

  getProgress(id: string): ReadingProgress | undefined {
    return this.get(id)?.progress;
  }

  /* ================================================================
   * 2026-08-29 书架 P0/P1 API：搜索 / 排序 / 筛选 / 分组 / 标签 / 批量
   * ================================================================ */

  /** 当前所有用户分组（按创建时间升序） */
  get groups(): BookGroup[] {
    return [...this._groups].sort((a, b) => a.createdAt - b.createdAt);
  }

  private async saveGroups(): Promise<void> {
    try {
      await this.plugin.saveData(GROUPS_KEY, this._groups);
    } catch (e) {
      console.warn("[REword] 书架分组持久化失败:", e);
    }
  }

  /** 新建分组；同名直接复用已有，返回分组对象 */
  async createGroup(name: string): Promise<BookGroup | null> {
    await this.load();
    const n = name.trim();
    if (!n) return null;
    const exist = this._groups.find((g) => g.name === n);
    if (exist) return exist;
    const g: BookGroup = {
      id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: n,
      createdAt: Date.now(),
    };
    this._groups.push(g);
    await this.saveGroups();
    this._store.set([...this.books]);
    return g;
  }

  /** 重命名分组 */
  async renameGroup(id: string, name: string): Promise<boolean> {
    await this.load();
    const g = this._groups.find((x) => x.id === id);
    const n = name.trim();
    if (!g || !n) return false;
    g.name = n;
    await this.saveGroups();
    this._store.set([...this.books]);
    return true;
  }

  /** 删除分组：组内书籍回到「未分组」，书本身不删 */
  async deleteGroup(id: string): Promise<void> {
    await this.load();
    this._groups = this._groups.filter((g) => g.id !== id);
    let touched = false;
    for (const b of this.books) {
      if (b.groupId === id) {
        b.groupId = undefined;
        touched = true;
      }
    }
    await this.saveGroups();
    if (touched) await this.save();
    this._store.set([...this.books]);
  }

  /** 单本设置阅读状态 */
  async setStatus(id: string, status: BookStatus): Promise<boolean> {
    return this.updateMeta(id, { status });
  }

  /** 单本设置评分（0 = 清空） */
  async setRating(id: string, rating: number): Promise<boolean> {
    return this.updateMeta(id, { rating });
  }

  /** 切换收藏星标，返回切换后的状态 */
  async toggleFavorite(id: string): Promise<boolean> {
    await this.load();
    const meta = this.get(id);
    if (!meta) return false;
    const next = !meta.favorite;
    await this.updateMeta(id, { favorite: next });
    return next;
  }

  /** 单本移入/移出分组（groupId 省略 = 移出） */
  async setGroup(id: string, groupId?: string): Promise<boolean> {
    return this.updateMeta(id, { groupId: groupId ?? "" });
  }

  /** 给单本加标签（已存在则忽略） */
  async addTag(id: string, tag: string): Promise<boolean> {
    await this.load();
    const meta = this.get(id);
    const t = tag.trim();
    if (!meta || !t) return false;
    const next = Array.from(new Set([...(meta.tags ?? []), t]));
    return this.updateMeta(id, { tags: next });
  }

  /** 移除单本的某个标签 */
  async removeTag(id: string, tag: string): Promise<boolean> {
    await this.load();
    const meta = this.get(id);
    if (!meta) return false;
    const next = (meta.tags ?? []).filter((t) => t !== tag);
    return this.updateMeta(id, { tags: next });
  }

  /* ===================== 2026-08-29 P2:颜色 / 排序 ===================== */

  /** 单本设色(color = undefined 表示移除颜色) */
  async setColor(id: string, color?: BookColor): Promise<boolean> {
    return this.updateMeta(id, { color });
  }

  /** 单本在同组内手动排序(数字小 = 靠前;0/缺省 = 跟随 query 排序) */
  async setOrder(id: string, order: number): Promise<boolean> {
    return this.updateMeta(id, { order });
  }

  /** 分组设色(groupId 无效或 color = undefined = 移除) */
  async setGroupColor(id: string, color?: BookColor): Promise<boolean> {
    await this.load();
    const g = this._groups.find((x) => x.id === id);
    if (!g) return false;
    if (isValidBookColor(color)) {
      g.color = color;
    } else {
      g.color = undefined;
    }
    await this.saveGroups();
    this._store.set([...this.books]);
    return true;
  }

  /* ===================== 书签（2026-08-29 新增） ===================== */

  /** 取本书书签（按创建时间升序）；书不存在 / 无书签 → 空数组 */
  getBookmarks(id: string): BookMark[] {
    const meta = this.get(id);
    if (!meta?.bookmarks?.length) return [];
    return [...meta.bookmarks].sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 新增书签。同一 cfi 已存在则直接返回现有列表（幂等，不重复添加）。
   * @returns 操作后的书签列表（升序）
   */
  async addBookmark(id: string, bm: { cfi: string; label?: string; excerpt?: string }): Promise<BookMark[]> {
    await this.load();
    const cfi = bm?.cfi?.trim();
    if (!cfi) return this.getBookmarks(id);
    const list = this.getBookmarks(id);
    if (list.some((b) => b.cfi === cfi)) return list;
    const next = [
      ...list,
      {
        id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        cfi,
        label: bm.label?.trim() || undefined,
        excerpt: bm.excerpt?.trim() || undefined,
        createdAt: Date.now(),
      },
    ];
    await this.updateMeta(id, { bookmarks: next });
    return this.getBookmarks(id);
  }

  /** 按书签 id 删除；返回操作后的列表 */
  async removeBookmark(id: string, bookmarkId: string): Promise<BookMark[]> {
    await this.load();
    const next = this.getBookmarks(id).filter((b) => b.id !== bookmarkId);
    await this.updateMeta(id, { bookmarks: next });
    return this.getBookmarks(id);
  }

  /** 重命名书签；返回操作后的列表 */
  async renameBookmark(id: string, bookmarkId: string, label: string): Promise<BookMark[]> {
    await this.load();
    const next = this.getBookmarks(id).map((b) =>
      b.id === bookmarkId ? { ...b, label: label.trim() || undefined } : b
    );
    await this.updateMeta(id, { bookmarks: next });
    return this.getBookmarks(id);
  }

  /**
   * 按 cfi 切换书签：已存在 → 删除；不存在 → 新增。
   * 供阅读器工具栏「🔖」一键加/删当前位置使用。
   * @returns { list, added } —— 操作后的列表与本次是新增还是删除
   */
  async toggleBookmark(
    id: string,
    bm: { cfi: string; label?: string; excerpt?: string }
  ): Promise<{ list: BookMark[]; added: boolean }> {
    await this.load();
    const cfi = bm?.cfi?.trim();
    if (!cfi) return { list: this.getBookmarks(id), added: false };
    const list = this.getBookmarks(id);
    const hit = list.find((b) => b.cfi === cfi);
    if (hit) return { list: await this.removeBookmark(id, hit.id), added: false };
    return { list: await this.addBookmark(id, bm), added: true };
  }

  /** 全部标签 + 用量计数（计数降序，同数按名升序）——智能分组用 */
  tagCounts(): { tag: string; count: number }[] {
    const map = new Map<string, number>();
    for (const b of this.books) {
      for (const t of b.tags ?? []) map.set(t, (map.get(t) ?? 0) + 1);
    }
    return Array.from(map, ([tag, count]) => ({ tag, count })).sort(
      (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-Hans-CN")
    );
  }

  /** 全部已用格式 + 计数（升序）——智能分组用 */
  formatCounts(): { format: string; count: number }[] {
    const map = new Map<string, number>();
    for (const b of this.books) {
      const f = (b.format || "").toLowerCase();
      if (f) map.set(f, (map.get(f) ?? 0) + 1);
    }
    return Array.from(map, ([format, count]) => ({ format, count })).sort((a, b) =>
      a.format.localeCompare(b.format)
    );
  }

  /** 各阅读状态计数（缺省状态归入 unread）——智能分组用 */
  statusCounts(): Record<BookStatus, number> {
    const out: Record<BookStatus, number> = { unread: 0, reading: 0, finished: 0 };
    for (const b of this.books) out[b.status ?? "unread"]++;
    return out;
  }

  /** 收藏数量 */
  favoriteCount(): number {
    return this.books.filter((b) => b.favorite).length;
  }

  /** 未分组书籍数量 */
  ungroupedCount(): number {
    return this.books.filter((b) => !b.groupId).length;
  }

  /** 某分组内书籍数量 */
  groupCount(groupId: string): number {
    return this.books.filter((b) => b.groupId === groupId).length;
  }

  /**
   * 「继续读最近一本」:按 lastReadAt 倒序,返回未读完且有进度的书的 id。
   * 已读完的(进度 >= 99.5%)会被跳过;无任何读过的书则返回 null。
   * 用于顶栏 ⏵ 按钮(2026-08-29 P2 I5)。
   */
  getContinueReadId(): string | null {
    let best: BookMeta | null = null;
    for (const b of this.books) {
      const frac = b.progress?.fraction;
      // 跳过没读过的、读完的、零进度的
      if (typeof frac !== "number" || frac <= 0 || frac >= 0.995) continue;
      if (!best || (b.lastReadAt ?? 0) > (best.lastReadAt ?? 0)) best = b;
    }
    return best?.id ?? null;
  }

  /**
   * 搜索 + 筛选 + 排序一次出结果（UI 的唯一数据入口）
   * 排序稳定性：数值键相等时用书名做次级键，避免列表抖动
   */
  query(
    filter: BookFilter = {},
    sortKey: BookSortKey = "lastRead",
    dir: SortDir = "desc"
  ): BookMeta[] {
    const kw = (filter.keyword ?? "").trim().toLowerCase();
    const out = this.books.filter((b) => {
      if (filter.status && filter.status !== "all" && (b.status ?? "unread") !== filter.status) return false;
      if (
        filter.format &&
        filter.format !== "all" &&
        (b.format || "").toLowerCase() !== filter.format.toLowerCase()
      )
        return false;
      if (filter.tag && !(b.tags ?? []).includes(filter.tag)) return false;
      if (filter.groupId === "ungrouped") {
        if (b.groupId) return false;
      } else if (filter.groupId && filter.groupId !== "all" && b.groupId !== filter.groupId) {
        return false;
      }
      if (filter.favoriteOnly && !b.favorite) return false;
      if (typeof filter.minRating === "number" && filter.minRating > 0 && (b.rating ?? 0) < filter.minRating)
        return false;
      // [2026-08-29] P2:颜色筛选
      if (filter.color && b.color !== filter.color) return false;
      if (kw) {
        const hay = [b.title, b.author ?? "", b.series ?? "", ...(b.tags ?? [])].join(" ").toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    const sign = dir === "asc" ? 1 : -1;
    const num = (b: BookMeta): number => {
      switch (sortKey) {
        case "addedAt":
          return b.addedAt ?? 0;
        case "progress":
          return b.progress?.fraction ?? 0;
        case "readingTime":
          return b.readingTimeMs ?? 0;
        case "rating":
          return b.rating ?? 0;
        case "size":
          return b.size ?? 0;
        case "lastRead":
        default:
          return b.lastReadAt ?? b.addedAt ?? 0;
      }
    };
    out.sort((a, b) => {
      // [2026-08-29] P2:颜色排序按 BOOK_COLORS 数组索引(色相 HSL 顺序:红→橙→黄→绿→蓝→紫→灰)
      // 无色的书排在最后(索引 = 999),保证有色的始终相邻
      if (sortKey === "color") {
        const ai = a.color ? BOOK_COLOR_INDEX[a.color] : 999;
        const bi = b.color ? BOOK_COLOR_INDEX[b.color] : 999;
        const r = ai - bi;
        if (r !== 0) return r * sign;
        return a.title.localeCompare(b.title, "zh-Hans-CN");
      }
      if (sortKey === "title" || sortKey === "author") {
        const av = (sortKey === "title" ? a.title : a.author ?? "") || "";
        const bv = (sortKey === "title" ? b.title : b.author ?? "") || "";
        // 中文按拼音序（localeCompare zh-Hans-CN）
        return av.localeCompare(bv, "zh-Hans-CN") * sign;
      }
      // [2026-08-29] P2:同组内手动排序优先(数字小 = 靠前)
      // 只在两边都设置了 order 时按 order 排,否则走原本的次级键
      if (typeof a.order === "number" && typeof b.order === "number" && a.order !== b.order) {
        return (a.order - b.order) * sign;
      }
      const r = num(a) - num(b);
      if (r !== 0) return r * sign;
      return a.title.localeCompare(b.title, "zh-Hans-CN");
    });
    return out;
  }

  /** 批量设置阅读状态，返回实际生效数量 */
  async batchSetStatus(ids: string[], status: BookStatus): Promise<number> {
    await this.load();
    let n = 0;
    for (const b of this.books) {
      if (ids.includes(b.id)) {
        b.status = status;
        n++;
      }
    }
    if (n) {
      await this.save();
      this._store.set([...this.books]);
    }
    return n;
  }

  /** 批量加标签，返回实际生效数量 */
  async batchAddTag(ids: string[], tag: string): Promise<number> {
    await this.load();
    const t = tag.trim();
    if (!t) return 0;
    let n = 0;
    for (const b of this.books) {
      if (!ids.includes(b.id)) continue;
      const next = Array.from(new Set([...(b.tags ?? []), t]));
      if (next.length !== (b.tags ?? []).length) {
        b.tags = next;
        n++;
      }
    }
    if (n) {
      await this.save();
      this._store.set([...this.books]);
    }
    return n;
  }

  /** 批量移除标签，返回实际生效数量 */
  async batchRemoveTag(ids: string[], tag: string): Promise<number> {
    await this.load();
    let n = 0;
    for (const b of this.books) {
      if (!ids.includes(b.id)) continue;
      const next = (b.tags ?? []).filter((x) => x !== tag);
      if (next.length !== (b.tags ?? []).length) {
        b.tags = next.length ? next : undefined;
        n++;
      }
    }
    if (n) {
      await this.save();
      this._store.set([...this.books]);
    }
    return n;
  }

  /** 批量设置分组（groupId 省略 = 移出分组），返回实际生效数量 */
  async batchSetGroup(ids: string[], groupId?: string): Promise<number> {
    await this.load();
    let n = 0;
    for (const b of this.books) {
      if (!ids.includes(b.id)) continue;
      b.groupId = groupId || undefined;
      n++;
    }
    if (n) {
      await this.save();
      this._store.set([...this.books]);
    }
    return n;
  }

  /** 批量移除（复用 removeBook 保证源文件/封面清理逻辑一致），返回实际删除数量 */
  async batchRemove(ids: string[], opts: { deleteFile?: boolean } = {}): Promise<number> {
    await this.load();
    let n = 0;
    for (const id of [...ids]) {
      if (!this.get(id)) continue;
      await this.removeBook(id, opts);
      n++;
    }
    return n;
  }

  /* ===================== 2026-08-29 P2:批量设色 / 评分 / 收藏 ===================== */

  /** 批量设色(color = undefined = 移除颜色),返回实际生效数量 */
  async batchSetColor(ids: string[], color?: BookColor): Promise<number> {
    await this.load();
    let n = 0;
    for (const b of this.books) {
      if (!ids.includes(b.id)) continue;
      if (isValidBookColor(color)) {
        if (b.color !== color) {
          b.color = color;
          n++;
        }
      } else if (b.color !== undefined) {
        b.color = undefined;
        n++;
      }
    }
    if (n) {
      await this.save();
      this._store.set([...this.books]);
    }
    return n;
  }

  /** 批量评分(0 = 清除),返回实际生效数量 */
  async batchSetRating(ids: string[], rating: number): Promise<number> {
    await this.load();
    const r = Math.max(0, Math.min(5, Math.round(rating)));
    const next = r > 0 ? r : undefined;
    let n = 0;
    for (const b of this.books) {
      if (!ids.includes(b.id)) continue;
      if (b.rating !== next) {
        b.rating = next;
        n++;
      }
    }
    if (n) {
      await this.save();
      this._store.set([...this.books]);
    }
    return n;
  }

  /** 批量收藏 / 取消收藏,返回实际生效数量 */
  async batchSetFavorite(ids: string[], favorite: boolean): Promise<number> {
    await this.load();
    const next = !!favorite;
    let n = 0;
    for (const b of this.books) {
      if (!ids.includes(b.id)) continue;
      if (!!b.favorite !== next) {
        b.favorite = next || undefined;
        n++;
      }
    }
    if (n) {
      await this.save();
      this._store.set([...this.books]);
    }
    return n;
  }

  /* ===================== 2026-08-29 P2:facets 计数(颜色 / 丛书) ===================== */

  /** 颜色使用计数:每色用了多少本(只含已用色,用于侧边栏 7 色区块) */
  colorCounts(): { color: BookColor; count: number }[] {
    const map = new Map<BookColor, number>();
    for (const b of this.books) {
      if (b.color) map.set(b.color, (map.get(b.color) ?? 0) + 1);
    }
    // 按 BOOK_COLORS 数组顺序输出(色相 HSL 顺序)
    return BOOK_COLORS.filter((c) => map.has(c.token)).map((c) => ({
      color: c.token,
      count: map.get(c.token) ?? 0,
    }));
  }

  /** 丛书使用计数:同 series 至少 2 本才显示(避免小书库的噪音,见设计 §10 风险表) */
  seriesCounts(): { series: string; count: number }[] {
    const map = new Map<string, number>();
    for (const b of this.books) {
      const s = (b.series ?? "").trim();
      if (s) map.set(s, (map.get(s) ?? 0) + 1);
    }
    return Array.from(map, ([series, count]) => ({ series, count }))
      .filter((x) => x.count >= 2)
      .sort((a, b) => b.count - a.count || a.series.localeCompare(b.series, "zh-Hans-CN"));
  }

  /**
   * 替换封面（用户自选图片）
   * - 新文件名带时间戳，避开 webview 对旧封面的缓存
   * - 写成功后才删旧封面，避免中途失败丢图
   */
  async replaceCover(id: string, file: File | Blob, ext = "jpg"): Promise<string | null> {
    await this.load();
    const meta = this.get(id);
    if (!meta) return null;
    const dir = BOOKS_DIR(this.plugin.name);
    try {
      await putFile(`${dir}/covers`, true, null);
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "bookshelf-store.ts · replaceCover mkdir", "debug");
    }
    const safeExt = (ext.match(/^[a-z0-9]+$/i)?.[0] ?? "jpg").toLowerCase();
    const path = `${dir}/covers/${id}-${Date.now().toString(36)}.${safeExt}`;
    const ok = await putFile(path, false, file);
    if (!ok) return null;
    const old = meta.cover;
    meta.cover = path;
    await this.save();
    if (old && old !== path) {
      try {
        await removeFile(old);
      } catch (__swallowErr) {
        logSwallow(__swallowErr, "bookshelf-store.ts · replaceCover rmOld", "debug");
      }
    }
    this._store.set([...this.books]);
    return path;
  }
}
