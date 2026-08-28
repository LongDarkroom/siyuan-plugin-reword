import { logSwallow } from "../core/safe.ts";
/**
 * 翻译缓存（按书落盘）
 * ------------------------------------------------------------------
 * 一本书往往几百段，逐段翻译成本高、易超额。这里按 bookId 在插件数据目录
 * 维护一份 `translations/<bookId>.json` 映射：原文 hash → 译文。
 *
 * - 内存层（mem）缓存已加载的书，避免重复读盘。
 * - 写入防抖 500ms，避免海量段落瞬间触发几百次 saveData。
 * - hash 用 FNV-1a（短、稳定、无依赖），足以区分不同段落文本。
 * - 2026-08-28：hash 拼入 salt（默认取当前翻译提示词），提示词 / 直译
 *   风格改版后旧 key 自然不命中，无需清缓存文件。
 * - 2026-08-28：额外按 bookId 维护「已缓存节」集合（cachedSections，1-based
 *   节序号），落盘进 `translations/<bookId>.meta.json`，用于 UI 展示
 *   「共缓存 N 页，第 X-Y 页缓存成功」。
 */
export class TranslationCache {
  private mem = new Map<string, Record<string, string>>();
  private timers = new Map<string, any>();
  private plugin: any;
  private saltFn?: () => string;
  /** 按书记录已缓存译文的「节」索引（1-based），用于 UI 展示「第 X-Y 节缓存成功」 */
  private cachedSections = new Map<string, Set<number>>();
  /** 书名索引（bookId → 书名），落盘进 translations/_index.json，供 UI「选择书籍」下拉 */
  private bookIndex = new Map<string, string>();
  private indexLoaded = false;

  constructor(plugin: any, saltFn?: () => string) {
    this.plugin = plugin;
    this.saltFn = saltFn;
  }

  private hash(s: string): string {
    const salt = this.saltFn ? this.saltFn() : "";
    const input = salt ? salt + "\u0001" + s : s;
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  private path(bookId: string): string {
    return "translations/" + bookId + ".json";
  }

  async load(bookId: string): Promise<Record<string, string>> {
    if (this.mem.has(bookId)) return this.mem.get(bookId)!;
    let map: Record<string, string> = {};
    try {
      const raw = await this.plugin.loadData(this.path(bookId));
      if (raw && typeof raw === "object") map = raw as Record<string, string>;
    } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · load", "debug"); }
    this.mem.set(bookId, map);
    return map;
  }

  /** 批量查询：返回命中项（索引→译文）与未命中索引列表 */
  async getBatch(
    bookId: string,
    texts: string[]
  ): Promise<{ hits: Record<number, string>; misses: number[] }> {
    const map = await this.load(bookId);
    const hits: Record<number, string> = {};
    const misses: number[] = [];
    texts.forEach((t, i) => {
      const v = map[this.hash(t)];
      if (v != null && v !== "") hits[i] = v;
      else misses.push(i);
    });
    return { hits, misses };
  }

  /** 批量写入（防抖落盘） */
  async setBatch(bookId: string, pairs: Array<[string, string]>): Promise<void> {
    if (!pairs.length) return;
    const map = await this.load(bookId);
    for (const [t, tr] of pairs) map[this.hash(t)] = tr;
    this.mem.set(bookId, map);
    clearTimeout(this.timers.get(bookId));
    this.timers.set(
      bookId,
      setTimeout(() => {
        this.plugin.saveData(this.path(bookId), map).catch(() => {});
        this.timers.delete(bookId);
      }, 500)
    );
  }

  /** 记录本书已缓存节（增量合并进 cachedSections，并落盘元信息 + 书名索引）。节号 1-based */
  recordSections(bookId: string, sections: number[], title?: string): void {
    if (!sections || !sections.length) return;
    let set = this.cachedSections.get(bookId);
    if (!set) {
      set = new Set<number>();
      this.cachedSections.set(bookId, set);
    }
    for (const s of sections) if (typeof s === "number" && s > 0) set.add(s);
    this.saveMeta(bookId, title);
    if (title) {
      this.bookIndex.set(bookId, title);
      this.saveIndex();
    }
  }

  /** 已缓存条目数（用于 UI 展示「本书已缓存 N 段」） */
  async size(bookId: string): Promise<number> {
    const map = await this.load(bookId);
    return Object.keys(map).length;
  }

  /** 元信息落盘：保存已缓存节集合（节号数组）+ 书名（用于「第 X-Y 页」+ 下拉书名） */
  private saveMeta(bookId: string, title?: string): void {
    const set = this.cachedSections.get(bookId);
    const arr = set ? [...set].sort((a, b) => a - b) : [];
    const obj: any = { sections: arr };
    if (title) obj.title = title;
    else {
      // 保留已有书名（recordSections 未传 title 时）
      try {
        const cur = this.plugin.loadData(this.metaPath(bookId));
        if (cur && typeof cur === "object" && (cur as any).title) obj.title = (cur as any).title;
      } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · saveMeta", "error"); }
    }
    this.plugin.saveData(this.metaPath(bookId), obj).catch(() => {});
  }

  private metaPath(bookId: string): string {
    return "translations/" + bookId + ".meta.json";
  }

  private indexPath(): string {
    return "translations/_index.json";
  }

  private async loadIndex(): Promise<void> {
    if (this.indexLoaded) return;
    this.indexLoaded = true;
    try {
      const raw = await this.plugin.loadData(this.indexPath());
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw as Record<string, any>)) {
          if (typeof v === "string") this.bookIndex.set(k, v);
        }
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · loadIndex", "debug"); }
  }

  private saveIndex(): void {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.bookIndex) obj[k] = v;
    this.plugin.saveData(this.indexPath(), obj).catch(() => {});
  }

  /** 列出所有有翻译缓存的书籍（bookId + 书名），供 UI「选择书籍」下拉 */
  async listCachedBooks(): Promise<Array<{ bookId: string; title: string }>> {
    await this.loadIndex();
    return [...this.bookIndex.entries()].map(([bookId, title]) => ({ bookId, title }));
  }

  /** 返回本书已缓存节统计：总数 + 升序节号数组 + 连续区间文本（如「第 1-4 页」）+ 书名 */
  async getCachedSections(bookId: string): Promise<{
    total: number;
    pages: number[];
    rangeText: string;
    title: string;
  }> {
    let set = this.cachedSections.get(bookId);
    let title = "";
    if (!set) {
      // 尝试从落盘元信息恢复
      try {
        const raw = await this.plugin.loadData(this.metaPath(bookId));
        if (raw && typeof raw === "object") {
          const secs = (raw as any).sections;
          if (Array.isArray(secs) && secs.length) {
            set = new Set<number>(secs.filter((n: any) => typeof n === "number" && n > 0));
            this.cachedSections.set(bookId, set);
          }
          if (typeof (raw as any).title === "string") title = (raw as any).title;
        }
      } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · getCachedSections", "debug"); }
    }
    const pages = set ? [...set].sort((a, b) => a - b) : [];
    const total = pages.length;
    let rangeText = "0 页";
    if (total === 1) rangeText = `第 ${pages[0]} 页`;
    else if (total > 1) {
      // 合并连续区间
      const ranges: string[] = [];
      let start = pages[0];
      let prev = pages[0];
      for (let i = 1; i < pages.length; i++) {
        const cur = pages[i];
        if (cur === prev + 1) {
          prev = cur;
          continue;
        }
        ranges.push(start === prev ? `第 ${start} 页` : `第 ${start}-${prev} 页`);
        start = cur;
        prev = cur;
      }
      ranges.push(start === prev ? `第 ${start} 页` : `第 ${start}-${prev} 页`);
      rangeText = ranges.join("、");
    }
    // 书名兜底：索引里查
    if (!title) {
      await this.loadIndex();
      title = this.bookIndex.get(bookId) || "";
    }
    return { total, pages, rangeText, title };
  }

  /** 清空某书缓存（内存 + 落盘文件 + 节元信息 + 书名索引），用于 UI「清空缓存」按钮 */
  async clear(bookId: string): Promise<void> {
    this.mem.delete(bookId);
    this.cachedSections.delete(bookId);
    this.bookIndex.delete(bookId);
    this.saveIndex();
    clearTimeout(this.timers.get(bookId));
    this.timers.delete(bookId);
    try {
      await this.plugin.removeData?.(this.path(bookId));
    } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · clear", "error"); }
    try {
      await this.plugin.removeData?.(this.metaPath(bookId));
    } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · clear", "error"); }
  }
}
