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

/** 阅读进度：cfi（EPUB 定位）或 fraction（通用比例定位） */
export interface ReadingProgress {
  cfi?: string;
  fraction?: number;
  index?: number;
}

export interface BookMeta {
  id: string;
  title: string;
  author?: string;
  /** EPUB 语言（dc:language） */
  language?: string;
  /** epub / mobi / azw3 / fb2 / cbz / txt / md */
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
  progress?: ReadingProgress;
}

const INDEX_KEY = "hiword-bookshelf.json";
const BOOKS_DIR = (pluginName: string) =>
  `/data/plugins/${pluginName}/books`;

export class BookshelfStore {
  private books: BookMeta[] = [];
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
   * 从 EPUB 中解析元数据与封面（一次解压）
   * - 元数据：OPF 的 dc:title / dc:creator / dc:language
   * - 封面：container.xml → OPF → meta[name=cover] → manifest item
   */
  private async extractEpubMeta(file: File): Promise<{
    title?: string;
    author?: string;
    language?: string;
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
      return { title, author, language, cover };
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
    const nameBase = file.name.replace(/\.(epub|mobi|azw3|fb2|cbz|txt|md|markdown)$/i, "") || file.name;
    // 去重：同名(去扩展名)+同大小视为重复
    const dup = this.books.find(
      (b) => b.title.toLowerCase() === nameBase.toLowerCase() && b.size === file.size
    );
    if (dup) return null;
    const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const dir = BOOKS_DIR(this.plugin.name);
    const path = `${dir}/${id}.${ext}`;
    const ok = await putFile(path, false, file);
    if (!ok) throw new Error(`书籍上传失败: ${file.name}`);
    // EPUB：元数据 + 封面（失败静默，不阻断导入）
    let title: string | undefined;
    let author: string | undefined;
    let language: string | undefined;
    let cover: string | undefined;
    if (ext === "epub") {
      const meta = await this.extractEpubMeta(file);
      title = meta.title;
      author = meta.author;
      language = meta.language;
      if (meta.cover) {
        try {
          await putFile(`${dir}/covers`, true, null);
        } catch {
          /* 目录可能已存在 */
        }
        const coverPath = `${dir}/covers/${id}.${meta.cover.ext}`;
        const coverOk = await putFile(coverPath, false, meta.cover.blob);
        if (coverOk) cover = coverPath;
      }
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

  /** 更新书籍元信息（书名/作者等），返回是否成功 */
  async updateMeta(id: string, patch: Partial<Pick<BookMeta, "title" | "author">>): Promise<boolean> {
    await this.load();
    const meta = this.get(id);
    if (!meta) return false;
    if (typeof patch.title === "string" && patch.title.trim()) meta.title = patch.title.trim();
    if (patch.author !== undefined) meta.author = patch.author.trim() || undefined;
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
        } catch {
          /* 文件删除失败不阻断索引清理 */
        }
        if (meta.cover) {
          try {
            await removeFile(meta.cover);
          } catch {
            /* ignore */
          }
        }
      }
      this.books = this.books.filter((b) => b.id !== id);
      await this.save();
      this._store.set([...this.books]);
    }
  }

  /** 累加阅读时长（毫秒） */
  async addReadingTime(id: string, ms: number): Promise<void> {
    await this.load();
    const meta = this.get(id);
    if (!meta || ms <= 0) return;
    meta.readingTimeMs = (meta.readingTimeMs || 0) + Math.round(ms);
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
    await this.save();
    this._store.set([...this.books]);
  }

  getProgress(id: string): ReadingProgress | undefined {
    return this.get(id)?.progress;
  }
}
