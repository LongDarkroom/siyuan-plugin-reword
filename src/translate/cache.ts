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
 * - 2026-08-30：多 mode 路由（2026-08-30 段落级"简洁版"改造）：
 *   同一段原文可同时缓存多种译文风格（default 直译 / concise 精简），互不污染。
 *   存储结构 bookId -> mode -> Record<hash, tr>，mode 默认 "default" 兼容旧数据。
 *   mode 字符串同时混入 hash salt（即便旧版落盘无 mode 字段，getBatch(bookId, texts, "default")
 *   也能正确路由到 .map[mode] 内的 hash 命中区，零迁移成本）。
 */
export type TranslationMode = "default" | "concise";
export const DEFAULT_TRANSLATION_MODE: TranslationMode = "default";

/** 单 mode 的缓存结构（mode -> 原文 hash -> 译文） */
type ModeCacheMap = Record<string, Record<string, string>>;
/** mem 中每本书的缓存：mode -> 译文 hash map */
type BookCacheMap = Record<TranslationMode, Record<string, string>>;

export class TranslationCache {
  private mem = new Map<string, BookCacheMap>();
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

  /**
   * 2026-08-30 hash 加盐：salt + mode + text 三段拼接
   * 这样不同 mode 的同段原文会产生不同 hash，缓存互不污染。
   */
  private hash(s: string, mode: TranslationMode = DEFAULT_TRANSLATION_MODE): string {
    const salt = this.saltFn ? this.saltFn() : "";
    // 使用 \u0001 作分隔符（罕见字符，几乎不会出现在原文 / 提示词中）
    const input = [salt, mode, s].filter(Boolean).join("\u0001");
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

  /**
   * 加载本书缓存。兼容旧版本单 mode 结构（落盘文件是 Record<hash, tr>）：
   * 检测到顶层是"原文 → 译文"而非"mode → {...}"时，自动包成 { default: 原数据 }。
   */
  async load(bookId: string): Promise<BookCacheMap> {
    if (this.mem.has(bookId)) return this.mem.get(bookId)!;
    const empty: BookCacheMap = { default: {}, concise: {} };
    try {
      const raw = await this.plugin.loadData(this.path(bookId));
      if (raw && typeof raw === "object") {
        // 旧版单 mode 形态：{ "hash": "译文" } → 包成 { default: {...}, concise: {} }
        if (this.looksLikeFlatMap(raw as Record<string, unknown>)) {
          empty.default = raw as Record<string, string>;
        } else {
          // 新版多 mode 形态：{ default: {hash: tr}, concise: {...} }
          const obj = raw as ModeCacheMap;
          if (obj.default && typeof obj.default === "object") empty.default = obj.default;
          if (obj.concise && typeof obj.concise === "object") empty.concise = obj.concise;
        }
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · load", "debug"); }
    this.mem.set(bookId, empty);
    return empty;
  }

  /**
   * 判定落盘 JSON 是"旧版单 mode（hash→tr）"还是"新版多 mode（mode→hash→tr）"。
   * 启发式：顶层 key 形如 6-10 位 base36 字符（hash 长度）→ 当作单 mode ；
   * 顶层 key 是 "default" / "concise" 等 mode 名 → 当作多 mode。
   */
  private looksLikeFlatMap(obj: Record<string, unknown>): boolean {
    const keys = Object.keys(obj);
    if (!keys.length) return false; // 空对象按"多 mode"处理
    // 全是 mode 关键字 → 多 mode
    if (keys.every((k) => k === "default" || k === "concise")) return false;
    // 含 hash 形态的 key（6-10 位 base36）→ 单 mode
    return keys.every((k) => /^[0-9a-z]{6,10}$/.test(k));
  }

  /**
   * 批量查询：返回命中项（索引→译文）与未命中索引列表。
   * mode 决定走哪条译文池（default / concise），二者互不污染。
   */
  async getBatch(
    bookId: string,
    texts: string[],
    mode: TranslationMode = DEFAULT_TRANSLATION_MODE,
  ): Promise<{ hits: Record<number, string>; misses: number[]; fromCache: boolean[] }> {
    const bookMap = await this.load(bookId);
    const modeMap = bookMap[mode] || {};
    const hits: Record<number, string> = {};
    const misses: number[] = [];
    const fromCache: boolean[] = new Array(texts.length).fill(false);
    texts.forEach((t, i) => {
      const v = modeMap[this.hash(t, mode)];
      if (v != null && v !== "") { hits[i] = v; fromCache[i] = true; }
      else misses.push(i);
    });
    return { hits, misses, fromCache };
  }

  /** 单条查询（用于单段补救时快速判断/取译） */
  async getOne(bookId: string, text: string, mode: TranslationMode = DEFAULT_TRANSLATION_MODE): Promise<string | null> {
    const bookMap = await this.load(bookId);
    const modeMap = bookMap[mode] || {};
    const v = modeMap[this.hash(text, mode)];
    return v != null && v !== "" ? v : null;
  }

  /** 单条写入（覆盖，用于单段重译后落盘） */
  async setOne(bookId: string, text: string, tr: string, mode: TranslationMode = DEFAULT_TRANSLATION_MODE): Promise<void> {
    await this.setBatch(bookId, [[text, tr]], mode);
  }

  /**
   * 单条失效（用于单段删除：清除该段 AI 缓存，下次刷新不重现）。
   * 注意：不碰用户修正库（fix），用户修正最珍贵，需单独 fixDelete。
   */
  async deleteOne(bookId: string, text: string, mode: TranslationMode = DEFAULT_TRANSLATION_MODE): Promise<void> {
    const bookMap = await this.load(bookId);
    const modeMap = bookMap[mode] || {};
    const k = this.hash(text, mode);
    if (k in modeMap) delete modeMap[k];
    this.mem.set(bookId, bookMap);
    clearTimeout(this.timers.get(bookId));
    this.timers.set(bookId, setTimeout(() => {
      this.plugin.saveData(this.path(bookId), bookMap).catch(() => {});
      this.timers.delete(bookId);
    }, 500));
  }

  /** 批量写入（防抖落盘）。同 mode 内的 hash 会被覆盖（同段再次翻译以新值为准）。 */
  async setBatch(
    bookId: string,
    pairs: Array<[string, string]>,
    mode: TranslationMode = DEFAULT_TRANSLATION_MODE,
  ): Promise<void> {
    if (!pairs.length) return;
    const bookMap = await this.load(bookId);
    const modeMap = bookMap[mode] || (bookMap[mode] = {});
    for (const [t, tr] of pairs) modeMap[this.hash(t, mode)] = tr;
    this.mem.set(bookId, bookMap);
    clearTimeout(this.timers.get(bookId));
    this.timers.set(
      bookId,
      setTimeout(() => {
        // 落盘多 mode 结构（一次性写整个 bookMap，旧版结构下次 load 时兼容回填）
        this.plugin.saveData(this.path(bookId), bookMap).catch(() => {});
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

  /**
   * 已缓存条目数（按 mode 统计）。mode 不传时返回 default 模式数（保持原 UI 语义）。
   * 用于 UI 展示「本书已缓存 N 段」。
   */
  async size(bookId: string, mode?: TranslationMode): Promise<number> {
    const bookMap = await this.load(bookId);
    if (mode) return Object.keys(bookMap[mode] || {}).length;
    return Object.keys(bookMap.default || {}).length;
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

  /**
   * 清理「孤儿」翻译缓存：删除书架中已不存在的书籍对应的全部缓存文件
   * （translations/<id>.json / <id>.meta.json / <id>.fix.json），并返回清理数量。
   *
   * 历史原因（随机 bookId 时代 / 删书未清缓存）会导致同一本实体书在
   * `translations/` 下遗留多份缓存、并在「选择书籍」下拉里重复出现；
   * 本方法回收这些无效缓存，且只清书架里查不到的 id，绝不误删在读书籍的缓存。
   */
  async cleanOrphanCaches(validIds: Set<string>): Promise<number> {
    await this.loadIndex();
    let removed = 0;
    const orphans = [...this.bookIndex.keys()].filter((id) => !validIds.has(id));
    for (const id of orphans) {
      await this.clear(id); // 清 .json + .meta.json + 书名索引条目
      await this.clearFix(id); // 清 .fix.json（孤儿修正一并回收）
      removed++;
    }
    return removed;
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

  /* ===================== 用户修正库（独立于 AI 缓存） =====================
   * 用户「钉选」的正确译文：最高优先级，覆盖 AI 缓存与实时翻译。
   * 落盘独立文件 translations/<bookId>.fix.json，clear() 不清它——
   * 用户修正最珍贵，误删代价极高。需单独 clearFix() 才删。
   * key 用纯原文 hash（不拼 mode/salt），使一段原文只对应一份修正，
   * 无论当前显示 default 还是 concise 池，修正都生效。
   */
  private fixMem = new Map<string, Record<string, { tr: string; ts: number; model?: string }>>();
  private fixTimers = new Map<string, any>();
  private fixPath(bookId: string): string {
    return "translations/" + bookId + ".fix.json";
  }
  private async loadFix(bookId: string): Promise<Record<string, { tr: string; ts: number; model?: string }>> {
    if (this.fixMem.has(bookId)) return this.fixMem.get(bookId)!;
    let map: Record<string, { tr: string; ts: number; model?: string }> = {};
    try {
      const raw = await this.plugin.loadData(this.fixPath(bookId));
      if (raw && typeof raw === "object") map = raw as any;
    } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · loadFix", "debug"); }
    this.fixMem.set(bookId, map);
    return map;
  }
  /** 取用户钉选的修正译文（最高优先级）。返回 null 表示无修正。 */
  async fixGet(bookId: string, text: string): Promise<string | null> {
    const map = await this.loadFix(bookId);
    const v = map[this.hash(text)];
    return v && v.tr ? v.tr : null;
  }
  /** 写入/覆盖用户修正（钉选正确答案，持久化且不被 clear 清掉） */
  async fixSet(bookId: string, text: string, tr: string, model?: string): Promise<void> {
    const map = await this.loadFix(bookId);
    map[this.hash(text)] = { tr, ts: Date.now(), model };
    this.fixMem.set(bookId, map);
    clearTimeout(this.fixTimers.get(bookId));
    this.fixTimers.set(bookId, setTimeout(() => {
      this.plugin.saveData(this.fixPath(bookId), map).catch(() => {});
      this.fixTimers.delete(bookId);
    }, 500));
  }
  /** 删除单条用户修正（仅删修正库，不影响 AI 缓存） */
  async fixDelete(bookId: string, text: string): Promise<void> {
    const map = await this.loadFix(bookId);
    const k = this.hash(text);
    if (k in map) delete map[k];
    this.fixMem.set(bookId, map);
    clearTimeout(this.fixTimers.get(bookId));
    this.fixTimers.set(bookId, setTimeout(() => {
      this.plugin.saveData(this.fixPath(bookId), map).catch(() => {});
      this.fixTimers.delete(bookId);
    }, 500));
  }
  /** 本书用户修正条数（UI 提示「已钉选 N 处修正」） */
  async fixCount(bookId: string): Promise<number> {
    const map = await this.loadFix(bookId);
    return Object.keys(map).length;
  }
  /** 清空用户修正库（独立于 AI 缓存；默认 clear() 不清修正） */
  async clearFix(bookId: string): Promise<void> {
    this.fixMem.delete(bookId);
    clearTimeout(this.fixTimers.get(bookId));
    this.fixTimers.delete(bookId);
    try {
      await this.plugin.removeData?.(this.fixPath(bookId));
    } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · clearFix", "error"); }
  }
}
