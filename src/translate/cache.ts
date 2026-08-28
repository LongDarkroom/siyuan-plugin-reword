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
 */
export class TranslationCache {
  private mem = new Map<string, Record<string, string>>();
  private timers = new Map<string, any>();
  private plugin: any;
  private saltFn?: () => string;

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
    } catch {
      /* 忽略读盘错误，当作空缓存 */
    }
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
}
