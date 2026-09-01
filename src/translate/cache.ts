import { logSwallow } from "../core/safe.ts";
import { readDir } from "../siyuan/api.ts";
import {
  isSqliteCacheReady,
  sqliteDeleteBook,
  sqliteDeleteKeys,
  sqliteGetBatch,
  sqliteSetBatch,
  translationKey,
} from "./sqlite-cache.ts";
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

/** 插件名（思源插件数据目录 = /data/storage/petal/<name>/） */
const PLUGIN_NAME = "siyuan-plugin-reword";
/** 翻译缓存在思源工作空间内的目录（readDir 用工作空间相对绝对路径） */
const TRANSLATIONS_DIR = `/data/storage/petal/${PLUGIN_NAME}/translations`;

/** 一本书的缓存条目（UI 列表用；title 可能为空，由上层用书架书名兜底） */
export interface CachedBookInfo {
  bookId: string;
  title: string;
  /** 缓存文件最后更新时间（Unix 秒，readDir 的 updated 字段；取不到时为空） */
  updated?: number;
}

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

    // 2026-08-31 Phase 2：JSON 未命中的段，兜底查 SQLite（思源块 / attributes 表）。
    // 只有 misses 非空才会发起查询，JSON 全命中时零额外开销。
    if (misses.length && isSqliteCacheReady()) {
      const stillMiss: number[] = [];
      const missKeys = misses.map((i) => translationKey(bookId, mode, this.hash(texts[i], mode)));
      let found: Map<string, string>;
      try {
        found = await sqliteGetBatch(missKeys);
      } catch (__swallowErr) {
        logSwallow(__swallowErr, "cache.ts · getBatch·sqlite", "debug");
        found = new Map();
      }
      for (const i of misses) {
        const k = translationKey(bookId, mode, this.hash(texts[i], mode));
        const v = found.get(k);
        if (v) {
          hits[i] = v;
          fromCache[i] = true;
          // 回写内存，下次直接命中，不必再查 SQLite
          modeMap[this.hash(texts[i], mode)] = v;
        } else {
          stillMiss.push(i);
        }
      }
      if (stillMiss.length !== misses.length) {
        this.mem.set(bookId, bookMap);
        misses.length = 0;
        misses.push(...stillMiss);
      }
    }

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
   */
  async deleteOne(bookId: string, text: string, mode: TranslationMode = DEFAULT_TRANSLATION_MODE): Promise<void> {
    const bookMap = await this.load(bookId);
    const modeMap = bookMap[mode] || {};
    const k = this.hash(text, mode);
    if (k in modeMap) delete modeMap[k];
    this.mem.set(bookId, bookMap);
    // Phase 2：同步删 SQLite 里的对应块
    if (isSqliteCacheReady()) {
      void sqliteDeleteKeys([translationKey(bookId, mode, k)]).catch(() => {});
    }
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

    // 2026-08-31 Phase 2：同步写一份进思源 SQLite（块 + attributes 检索键），
    // 使译文可被思源搜索 / 随同步跨设备 / 用 SQL 查询。
    // 异步且不 await——SQLite 写入失败不应阻塞翻译主流程。
    if (isSqliteCacheReady()) {
      const sp = pairs.map(
        ([t, tr]) => [translationKey(bookId, mode, this.hash(t, mode)), tr] as [string, string]
      );
      void sqliteSetBatch(sp, { bookId, mode }).catch(() => {});
    }
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

  /** 人工修订缓存（clear 时一并删除） */
  private fixPath(bookId: string): string {
    return "translations/" + bookId + ".fix.json";
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

  /**
   * 扫描磁盘上真实存在的翻译缓存文件，返回 bookId 列表。
   * ------------------------------------------------------------------
   * 2026-09-01 修复：书名索引（translations/_index.json）依赖 recordSections()
   * 被调用时才写入，v2 翻译链路未调用它 → 索引文件从未生成 → 「缓存管理」
   * 永远显示「暂无翻译缓存」，而磁盘上其实有几十本缓存文件。
   * 这里用 readDir 直接扫目录做兜底，与索引取并集，保证 UI 与磁盘一致。
   *
   * 过滤规则：只认 `<bookId>.json`，排除 `.meta.json` / `.fix.json` / `_index.json`。
   * readDir 失败（路径不存在 / 权限 / 接口变更）时静默降级为空数组，由索引兜底。
   */
  private async scanDiskCacheIds(): Promise<Array<{ bookId: string; updated?: number }>> {
    try {
      const res: any = await readDir(TRANSLATIONS_DIR);
      // 不同思源版本返回形态不一：直接数组 / { data: [...] }
      const arr: any[] = Array.isArray(res) ? res : (res?.data ?? []);
      return arr
        .filter((e: any) => e && !e.isDir && typeof e.name === "string")
        .filter((e: any) => {
          const n = e.name as string;
          return n.endsWith(".json") && !n.endsWith(".meta.json") && !n.endsWith(".fix.json") && n !== "_index.json";
        })
        .map((e: any) => ({
          bookId: (e.name as string).slice(0, -".json".length),
          // readDir 会带 updated（Unix 秒），用于 UI 展示「最近翻译」；取不到就是 undefined
          updated: typeof e.updated === "number" ? e.updated : undefined,
        }))
        .filter((x: { bookId: string }) => Boolean(x.bookId));
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "cache.ts · scanDiskCacheIds", "debug");
      return [];
    }
  }

  /** 从 <bookId>.meta.json 里读回书名（索引里没有时的第二数据源） */
  private async titleFromMeta(bookId: string): Promise<string> {
    try {
      const raw = await this.plugin.loadData(this.metaPath(bookId));
      if (raw && typeof raw === "object" && typeof (raw as any).title === "string") {
        return (raw as any).title;
      }
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "cache.ts · titleFromMeta", "debug");
    }
    return "";
  }

  /** 列出所有有翻译缓存的书籍（bookId + 书名），供 UI「选择书籍」下拉 */
  async listCachedBooks(): Promise<CachedBookInfo[]> {
    await this.loadIndex();
    // 磁盘扫描 ∪ 书名索引：磁盘为准（可能比索引多），索引补充标题
    const updatedMap = new Map<string, number>();
    const ids = new Set<string>([...this.bookIndex.keys()]);
    for (const { bookId, updated } of await this.scanDiskCacheIds()) {
      ids.add(bookId);
      if (typeof updated === "number") updatedMap.set(bookId, updated);
    }

    const out: CachedBookInfo[] = [];
    let backfilled = false;
    for (const bookId of ids) {
      let title = this.bookIndex.get(bookId) || "";
      if (!title) {
        // meta 文件是索引之外唯一的书名来源（recordSections 曾写进去过）
        const t = await this.titleFromMeta(bookId);
        if (t) {
          title = t;
          this.bookIndex.set(bookId, t);
          backfilled = true;
        }
      }
      out.push({ bookId, title, updated: updatedMap.get(bookId) });
    }
    // 回填落盘：下次直接命中 _index.json，不必再逐本读 meta
    if (backfilled) this.saveIndex();
    return out;
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
    // 2026-09-01：从「磁盘 ∪ 索引」取全量，避免只清索引里的、磁盘上的孤儿文件还在
    const all = await this.listCachedBooks();
    let removed = 0;
    const orphans = all.map((b) => b.bookId).filter((id) => !validIds.has(id));
    for (const id of orphans) {
      await this.clear(id); // 清 .json + .meta.json + 书名索引条目
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
    // Phase 2：同步清 SQLite 里该书的全部译文块
    if (isSqliteCacheReady()) void sqliteDeleteBook(bookId).catch(() => {});
    try {
      await this.plugin.removeData?.(this.path(bookId));
    } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · clear", "error"); }
    try {
      await this.plugin.removeData?.(this.metaPath(bookId));
    } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · clear", "error"); }
    // 2026-09-01：补删人工修订缓存 <id>.fix.json（clear 的文档一直承诺会删，
    // 但实现里漏了，导致孤儿清理后残留 fix 文件）
    try {
      await this.plugin.removeData?.(this.fixPath(bookId));
    } catch (__swallowErr) { logSwallow(__swallowErr, "cache.ts · clear · fix", "error"); }
  }
}
