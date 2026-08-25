import { WordStatus, MASTERY_MAX, LearningStatus } from "../types.ts";
import type { WordRecord, VocabTheme, VocabBook, VocabStoreData, VocabSort, ReviewGrade, ReviewEvent, LearningStatus as LearningStatusType } from "../types.ts";
import { sqlQuery, getBlockAttrs } from "../siyuan/index.ts";
import { getLogger } from "../core/logger.ts";
import { computeDifficulty } from "../review/difficulty.ts";

/** 2026-08-22 新增:学习状态变更监听者(由 vocab-highlight 模块订阅) */
export type LearningStatusListener = (word: string, status: LearningStatusType) => void;

const DEFAULT_BOOK = "我的单词本";
const DEFAULT_THEME = "未分类";

/** 单词总库（虚拟聚合本）：id 不可与真实单词本冲突 */
export const ALL_BOOK_ID = "__all__";
export const ALL_BOOK_NAME = "单词总库";
const ALL_THEME_ID = "__all_theme__";
const ALL_THEME_NAME = "全集";
/** 复习事件历史保留上限（用于校准，超出只留最近若干条） */
const REVIEW_EVENT_CAP = 2000;

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 词库 JSON 存储
 *
 * 三级结构：单词本(一级) > 主题(二级) > 单词
 * 数据存于插件数据目录 hiword-vocab.json（通过注入的 onChange 回调持久化）。
 *
 * 加词规则：点收藏星时，单词进入「当前单词本」的「未分类」主题。
 *
 * 1.1 byWord 反向索引（P0 性能）：
 *   历史上 hasWord/findRecord/recordQuery/locate 每次都走 getAllWords() 全表 O(N)，
 *   词库规模上千后查词体验明显变差。本类在 onChange 写路径同步维护
 *   byWord: Map<word(lower), {book, theme, record}>，把读路径降到 O(1)；
 *   移除整本/整主题时统一 rebuildByWordIndex() 重建（O(N) 但只发生在批量删除时）。
 */
export class VocabStore {
  private data: VocabStoreData = { books: [], activeBookId: "", activeThemeId: "" };
  private onChange?: () => void | Promise<void>;
  /**
   * 2026-08-23 新增:load 完成守卫。
   * 修复词库丢失根因:onload 期间 `new VocabStore()` 后 data 是空(含 1 个空 book),
   * 若此时 persist() 被触发(同步/异步早期副作用)会把空数据覆盖磁盘旧数据。
   * 守卫:load() 同步设置 this.loaded = true;persist() 在 !loaded 时直接 noop。
   * 注意:__forcePersistForMigration 是显式越权入口,仅用于运维修复场景。
   */
  private loaded = false;
  /**
   * 反向索引：word(小写) → {book, theme, record}。
   * 强引用 record，便于 record 字段 in-place 更新后索引自动同步。
   * 注意：移除整本/整主题时必须 rebuild，否则会留下 dangling 引用。
   */
  private byWord = new Map<string, { book: VocabBook; theme: VocabTheme; record: WordRecord }>();
  /**
   * 2026-08-22 新增:学习状态变更监听者集合。
   * 写路径(setLearningStatus / addWord)同步 emit,供 vocab-highlight 模块做即时刷新。
   * 注意:不在 persist() 内部 emit——避免"批量更新时所有 listener 重复触发重扫"。
   */
  private learningStatusListeners = new Set<LearningStatusListener>();

  constructor(onChange?: () => void | Promise<void>) {
    this.onChange = onChange;
  }

  /**
   * 重建 byWord 索引（O(N)）。仅在批量结构变更（移除整本/整主题/反序列化）时调用。
   * 单词增删/移动走增量更新，不调本方法。
   * 2026-08-22 改：顺便给旧数据补 learningStatus 字段（默认 'learning'），保证兼容性。
   */
  private rebuildByWordIndex(): void {
    this.byWord.clear();
    for (const book of this.data.books) {
      for (const theme of book.themes) {
        for (const record of theme.words) {
          // 旧数据兼容：缺 learningStatus 字段视为未掌握
          if (!record.learningStatus) {
            record.learningStatus = LearningStatus.Learning;
          }
          this.byWord.set(record.word, { book, theme, record });
        }
      }
    }
  }

  /** 测试辅助：取当前 byWord 索引大小（验证同步正确性） */
  __byWordIndexSizeForTest(): number {
    return this.byWord.size;
  }

  /** 从持久化 JSON 水合；首次运行创建默认单词本 + 未分类主题 */
  load(raw: unknown): void {
    const valid =
      raw &&
      typeof raw === "object" &&
      Array.isArray((raw as VocabStoreData).books) &&
      (raw as VocabStoreData).books.length > 0;

    if (valid) {
      this.data = raw as VocabStoreData;
      if (!Array.isArray(this.data.reviewEvents)) this.data.reviewEvents = [];
      this.ensureActiveValid();
      this.rebuildByWordIndex();
    } else {
      this.data = { books: [], activeBookId: "", activeThemeId: "", reviewEvents: [] };
      this.ensureDefaults();
      this.rebuildByWordIndex();
      // 尝试从旧版思源文档词库迁移
      this.migrateFromLegacyDoc().catch(() => {/* 迁移失败不影响启动 */});
    }
    // 2026-08-23:无论 valid 与否,load 完成即标 loaded=true;
    // 后续 persist() 才会真正写盘,避免初始化竞态窗口内空数据覆盖磁盘。
    this.loaded = true;
  }

  /** 序列化 */
  export(): VocabStoreData {
    return JSON.parse(JSON.stringify(this.data));
  }

  private async persist(): Promise<void> {
    // 2026-08-23:loaded 守卫 — load() 还没跑完时(初始化竞态窗口)直接 noop,
    // 避免空 data 覆盖磁盘旧数据(根因修复)。
    if (!this.loaded) {
      return;
    }
    if (this.onChange) {
      try {
        await this.onChange();
      } catch (e) {
        getLogger().warn("[REword] 词库持久化失败:", { error: e });
      }
    }
  }

  /**
   * 2026-08-23 新增:强制持久化入口(运维修复用)。
   * 场景:用户已因旧版本 bug 丢数据,需触发 migrate 重新从 `HiWord-Vocabulary` 文档恢复;
   * 或运维手动覆盖磁盘。**不在常规 addWord/setActiveBook 路径调用**。
   */
  __forcePersistForMigration(): Promise<void> {
    this.loaded = true;
    return this.persist();
  }

  /** 2026-08-23 新增:测试 / 运维只读状态 */
  __isLoaded(): boolean {
    return this.loaded;
  }

  // ============ 默认与激活态 ============

  private ensureDefaults(): void {
    if (this.data.books.length === 0) {
      const bookId = genId("bk");
      const themeId = genId("th");
      this.data.books.push({
        id: bookId,
        name: DEFAULT_BOOK,
        order: 0,
        themes: [{ id: themeId, name: DEFAULT_THEME, order: 0, words: [] }],
      });
      this.data.activeBookId = bookId;
      this.data.activeThemeId = themeId;
    }
    this.ensureActiveValid();
  }

  private ensureActiveValid(): void {
    const book = this.data.books.find((b) => b.id === this.data.activeBookId);
    if (!book) {
      this.data.activeBookId = this.data.books[0]?.id ?? "";
    }
    const activeBook = this.getActiveBook();
    if (!activeBook || activeBook.themes.length === 0) return;
    const theme = activeBook.themes.find((t) => t.id === this.data.activeThemeId);
    if (!theme) {
      this.data.activeThemeId = activeBook.themes[0].id;
    }
  }

  // ============ 读取 ============

  getBooks(): VocabBook[] {
    const real = [...this.data.books].sort((a, b) => a.order - b.order);
    // 单词总库：虚拟聚合本，排在最前（order=-1），不写入 data.books（只读聚合，零数据迁移）
    return [this.getMasterBook(), ...real];
  }

  /** 取单词总库虚拟本（实时投影全部单词，含 active/archived/ignored） */
  getMasterBook(): VocabBook {
    return {
      id: ALL_BOOK_ID,
      name: ALL_BOOK_NAME,
      order: -1,
      themes: [{ id: ALL_THEME_ID, name: ALL_THEME_NAME, order: 0, words: this.getAllWords() }],
    };
  }

  getBook(id: string): VocabBook | undefined {
    if (id === ALL_BOOK_ID) return this.getMasterBook();
    return this.data.books.find((b) => b.id === id);
  }

  getActiveBook(): VocabBook | undefined {
    return this.getBook(this.data.activeBookId);
  }

  getActiveTheme(): VocabTheme | undefined {
    const book = this.getActiveBook();
    if (!book) return undefined;
    return book.themes.find((t) => t.id === this.data.activeThemeId) ?? book.themes[0];
  }

  getTheme(bookId: string, themeId: string): VocabTheme | undefined {
    return this.getBook(bookId)?.themes.find((t) => t.id === themeId);
  }

  /** 全部单词（扁平，用于查重/检索） */
  getAllWords(): WordRecord[] {
    const out: WordRecord[] = [];
    for (const b of this.data.books) {
      for (const t of b.themes) out.push(...t.words);
    }
    return out;
  }

  hasWord(word: string): boolean {
    const w = word.toLowerCase().trim();
    return this.byWord.has(w);
  }

  findRecord(word: string): WordRecord | undefined {
    const w = word.toLowerCase().trim();
    return this.byWord.get(w)?.record;
  }

  /** 取单词的累计查询次数（不在词库则返回 0）。 */
  getQueryCount(word: string): number {
    return this.byWord.get(word.toLowerCase().trim())?.record.queryCount ?? 0;
  }

  /** 找到单词当前所在的位置 */
  private locate(word: string): { book: VocabBook; theme: VocabTheme; record: WordRecord } | null {
    const w = word.toLowerCase().trim();
    return this.byWord.get(w) ?? null;
  }

  /** 取某主题内、按排序方式计算后的单词序列 */
  getSortedWords(theme: VocabTheme, sort: VocabSort): WordRecord[] {
    const list = [...theme.words];
    if (sort === "time") {
      list.sort((a, b) => (a.created || "").localeCompare(b.created || ""));
    } else if (sort === "mastery") {
      list.sort((a, b) => b.mastery - a.mastery || a.word.localeCompare(b.word));
    } else {
      list.sort((a, b) => a.order - b.order);
    }
    return list;
  }

  // ============ 单词 CRUD ============

  /**
   * 加入单词。
   * - 不传 targetBookId：进入当前单词本的「未分类」主题（原行为）。
   * - 传 targetBookId：进入指定单词本的「未分类」主题（框选提取时由用户选择）。
   * - 传 targetThemeId：进入指定单词本的指定二级主题（收藏星两级选择，2026-08-14 新增）。
   * - meta.preferredDefinitions：2026-08-22 释义偏好，用户在收词弹窗挑选的 ⭐ 优先 sense（中文文本数组）
   * 已存在则直接返回。
   */
  async addWord(
    word: string,
    meta?: { phonetic?: string; pos?: string; meaning?: string; labels?: string[]; example?: string; senseCount?: number; difficulty?: number; preferredDefinitions?: string[] },
    targetBookId?: string,
    targetThemeId?: string
  ): Promise<{ added: boolean; record: WordRecord }> {
    const w = word.toLowerCase().trim();
    // 单词总库是只读聚合，不可作为收录目标：重定向到当前单词本 + 未分类
    if (targetBookId === ALL_BOOK_ID) targetBookId = undefined;
    const existing = this.findRecord(w);
    if (existing) return { added: false, record: existing };

    let book = targetBookId ? this.getBook(targetBookId) : this.getActiveBook();
    if (!book) {
      this.ensureDefaults();
      book = this.getActiveBook()!;
    }
    // 指定了二级主题 → 找到该主题；否则回退「未分类」（不存在则新建）
    let theme: VocabTheme | undefined;
    if (targetThemeId) {
      theme = book.themes.find((t) => t.id === targetThemeId);
    }
    if (!theme) {
      theme = book.themes.find((t) => t.name === DEFAULT_THEME) ?? book.themes[0];
    }
    if (!theme) {
      const themeId = genId("th");
      theme = { id: themeId, name: DEFAULT_THEME, order: book.themes.length, words: [] };
      book.themes.push(theme);
    }

    const now = new Date().toISOString();
    // 收词即计算并缓存固有难度（结合已注入词频/AWL 表 + 词典义项数）
    const senseCount = meta?.senseCount;
    const difficulty =
      typeof meta?.difficulty === "number"
        ? meta.difficulty
        : computeDifficulty(w, { senseCount }).difficulty;
    const record: WordRecord = {
      id: genId("wd"),
      word: w,
      phonetic: meta?.phonetic ?? "",
      pos: meta?.pos ?? "",
      meaning: meta?.meaning ?? "",
      mastery: 0,
      status: WordStatus.Active,
      // 2026-08-22 词库驱动高亮：新词默认未掌握(黄色)
      learningStatus: LearningStatus.Learning,
      labels: meta?.labels ?? [],
      example: meta?.example ?? "",
      created: now,
      updated: now,
      order: theme.words.length,
      sourceBlockIds: [],
      senseCount,
      difficulty,
      // 复习排程初始化：新词立即进入今日队列（due=now），其余 SRS 字段归零/取默认，
      // 使面板「待复习/保留率」指标自加词起即准确，且 nextReviewState 首评有干净基线。
      queryCount: 0,
      recall: 0,
      reps: 0,
      lapse: 0,
      due: now,
      intervalDays: 0,
      ease: 2.5,
      // 2026-08-22 释义偏好：复制入参数组(防外部突变),空数组默认值
      preferredDefinitions: Array.isArray(meta?.preferredDefinitions)
        ? [...meta!.preferredDefinitions!]
        : [],
    };
    theme.words.push(record);
    // 1.1 byWord 同步：新增词进索引，O(1)
    this.byWord.set(w, { book, theme, record });
    await this.persist();
    // 2026-08-22 新增：emit learningStatusChange,触发高亮刷新
    this.emitLearningStatusChange(w, record.learningStatus ?? LearningStatus.Learning);
    return { added: true, record };
  }

  /**
   * 2026-08-22 新增：切换单词学习状态(词库面板"未掌握/已掌握/需复习"按钮调)。
   *  - 单词不存在 → 静默忽略(返回 false),不抛错
   *  - 2026-08-23 改：status 传 null/undefined/"" = 清除样式(不显示高亮),内部 delete 字段
   *  - 写完持久化 + emit learningStatusChange(供 vocab-highlight 即时刷新高亮)
   */
  async setLearningStatus(
    word: string,
    status: LearningStatusType | null | undefined
  ): Promise<boolean> {
    const w = word.toLowerCase().trim();
    const entry = this.byWord.get(w);
    if (!entry) return false;
    // 规范化:null / undefined / "" 都视为"清除"
    const isClear = !status;
    const nextStatus: LearningStatusType | undefined = isClear
      ? undefined
      : (status as LearningStatusType);
    // 无变化则跳过
    if (entry.record.learningStatus === nextStatus) return true;
    if (isClear) {
      // delete 而非赋空串,语义更清晰,且序列化更干净
      delete entry.record.learningStatus;
    } else {
      entry.record.learningStatus = nextStatus;
    }
    entry.record.updated = new Date().toISOString();
    await this.persist();
    // emit 时把 undefined 传出去(让 listener 知道这是"清除"事件)
    this.emitLearningStatusChange(w, (nextStatus as any) ?? ("cleared" as any));
    return true;
  }

  /**
   * 2026-08-22 新增：订阅学习状态变更。
   * 返回取消订阅函数(由 vocab-highlight.start/stop 配对调用)。
   * 不会因 listener 抛错影响其他 listener 或写入流程。
   */
  onLearningStatusChange(listener: LearningStatusListener): () => void {
    this.learningStatusListeners.add(listener);
    return () => {
      this.learningStatusListeners.delete(listener);
    };
  }

  /** 2026-08-22 新增：emit 学习状态变更 */
  private emitLearningStatusChange(word: string, status: LearningStatusType): void {
    for (const l of this.learningStatusListeners) {
      try {
        l(word, status);
      } catch (e) {
        getLogger().warn("[REword] learningStatus listener 抛错(已忽略)", { error: e });
      }
    }
  }

  /**
   * upsert 单词（AI 精读词库闭环用）：
   *  - 已存在：补全空字段、追加 sourceBlockIds（去重）、取更高 mastery；有变化才更新。
   *  - 不存在：经 addWord 新建并写入 sourceBlockId（及 mastery）。
   */
  async upsertWord(
    word: string,
    meta?: { phonetic?: string; pos?: string; meaning?: string; labels?: string[]; example?: string; mastery?: number; difficulty?: number; senseCount?: number; preferredDefinitions?: string[] },
    sourceBlockId?: string,
    targetBookId?: string,
    targetThemeId?: string
  ): Promise<{ added: boolean; updated: boolean; record: WordRecord }> {
    const w = word.toLowerCase().trim();
    const existing = this.findRecord(w);
    if (existing) {
      let changed = false;
      if (meta?.phonetic && !existing.phonetic) { existing.phonetic = meta.phonetic; changed = true; }
      if (meta?.pos && !existing.pos) { existing.pos = meta.pos; changed = true; }
      if (meta?.meaning && !existing.meaning) { existing.meaning = meta.meaning; changed = true; }
      if (meta?.example && !existing.example) { existing.example = meta.example; changed = true; }
      if (meta?.labels?.length && !(existing.labels && existing.labels.length)) { existing.labels = meta.labels; changed = true; }
      if (typeof meta?.mastery === "number" && meta.mastery > existing.mastery) { existing.mastery = meta.mastery; changed = true; }
      if (typeof meta?.senseCount === "number" && existing.senseCount === undefined) { existing.senseCount = meta.senseCount; changed = true; }
      if (typeof meta?.difficulty === "number" && existing.difficulty === undefined) { existing.difficulty = meta.difficulty; changed = true; }
      // 2026-08-22 释义偏好：未设置时用新值写入（已有则保留避免覆盖用户原始选择）
      if (meta?.preferredDefinitions && (!existing.preferredDefinitions || existing.preferredDefinitions.length === 0)) {
        existing.preferredDefinitions = [...meta.preferredDefinitions];
        changed = true;
      }
      // 若仍未有难度值，用已有/新义项数补算一次
      if (existing.difficulty === undefined) {
        existing.difficulty = computeDifficulty(w, { senseCount: existing.senseCount }).difficulty;
        changed = true;
      }
      if (sourceBlockId) {
        existing.sourceBlockIds = existing.sourceBlockIds ?? [];
        if (!existing.sourceBlockIds.includes(sourceBlockId)) { existing.sourceBlockIds.push(sourceBlockId); changed = true; }
      }
      if (changed) {
        existing.updated = new Date().toISOString();
        await this.persist();
      }
      return { added: false, updated: changed, record: existing };
    }
    // 新建
    const { mastery, difficulty, senseCount, ...restMeta } = meta ?? {};
    const r = await this.addWord(w, { ...restMeta, senseCount, difficulty }, targetBookId, targetThemeId);
    if (r.record) {
      let touched = false;
      if (typeof mastery === "number") {
        r.record.mastery = Math.max(0, Math.min(MASTERY_MAX, Math.round(mastery)));
        touched = true;
      }
      if (sourceBlockId) {
        r.record.sourceBlockIds = [sourceBlockId];
        touched = true;
      }
      if (touched) await this.persist();
    }
    return { added: r.added, updated: false, record: r.record };
  }

  /** 切换收藏：在/不在词库之间切换 */
  async toggleWord(
    word: string,
    meta?: { phonetic?: string; pos?: string; meaning?: string }
  ): Promise<{ inVocab: boolean; record?: WordRecord }> {
    if (this.hasWord(word)) {
      await this.removeWord(word);
      return { inVocab: false };
    }
    const r = await this.addWord(word, meta);
    return { inVocab: true, record: r.record };
  }

  async removeWord(word: string): Promise<boolean> {
    const loc = this.locate(word);
    if (!loc) return false;
    const w = word.toLowerCase().trim();
    loc.theme.words = loc.theme.words.filter((r) => r.word !== w);
    // 1.1 byWord 同步：删除词出索引
    this.byWord.delete(w);
    await this.persist();
    return true;
  }

  async updateMastery(word: string, level: number): Promise<void> {
    const loc = this.locate(word);
    if (!loc) return;
    const l = Math.max(0, Math.min(MASTERY_MAX, Math.round(level)));
    loc.record.mastery = l;
    loc.record.updated = new Date().toISOString();
    await this.persist();
  }

  /** 记录一次查词（查询次数 +1）。仅对已在词库中的单词生效；不在词库则忽略。 */
  async recordQuery(word: string): Promise<void> {
    const loc = this.locate(word);
    if (!loc) return;
    loc.record.queryCount = (loc.record.queryCount ?? 0) + 1;
    loc.record.updated = new Date().toISOString();
    await this.persist();
  }

  /**
   * 复习评分后回写 SRS 状态。patch 由 scheduler.nextReviewState 计算，
   * 这里只负责合并 + 持久化，不内含调度逻辑（保持存储层纯粹）。
   * 仅允许写入复习相关字段，避免误覆盖其它字段。
   */
  async updateReviewStats(
    word: string,
    patch: Partial<WordRecord>
  ): Promise<void> {
    const loc = this.locate(word);
    if (!loc) return;

    // 累积复习事件（供 calibrate.ts 回拟合）。在应用 patch 前读取旧间隔/难度，
    // 本次评分的「结果」反映的是「上一次被安排的间隔」的留存情况。
    if (patch.lastGrade) {
      const grade = patch.lastGrade as ReviewGrade;
      const oldInterval = loc.record.intervalDays ?? 0;
      const oldDiff = loc.record.difficulty ?? 0.5;
      this.pushReviewEvent({
        grade,
        scheduledIntervalDays: oldInterval,
        prevIntervalDays: oldInterval,
        difficulty: oldDiff,
        recalled: grade !== "again",
        at: new Date().toISOString(),
      });
    }

    const allowed: (keyof WordRecord)[] = [
      "queryCount", "difficulty", "recall", "reps", "lapse",
      "lastGrade", "lastReview", "due", "intervalDays", "ease",
    ];
    const rec = loc.record as unknown as Record<string, unknown>;
    for (const k of allowed) {
      const v = patch[k];
      if (v !== undefined) rec[k] = v;
    }
    loc.record.updated = new Date().toISOString();
    await this.persist();
  }

  /** 累积一条复习事件（仅保留最近 REVIEW_EVENT_CAP 条，避免无限增长） */
  private pushReviewEvent(ev: ReviewEvent): void {
    if (!Array.isArray(this.data.reviewEvents)) this.data.reviewEvents = [];
    this.data.reviewEvents.push(ev);
    if (this.data.reviewEvents.length > REVIEW_EVENT_CAP) {
      this.data.reviewEvents = this.data.reviewEvents.slice(-REVIEW_EVENT_CAP);
    }
  }

  /** 取复习事件历史（校准用） */
  getReviewEvents(): ReviewEvent[] {
    return Array.isArray(this.data.reviewEvents) ? this.data.reviewEvents : [];
  }

  /** 复习候选：所有处于 active 状态的单词（调度器输入）。 */
  getReviewCandidates(): WordRecord[] {
    return this.getAllWords().filter((r) => r.status === WordStatus.Active);
  }

  /**
   * 升级旧词库：为所有缺失 difficulty 的单词补算难度、缺失排程字段的补默认。
   * 保证「估计保留率」等指标与复习队列对存量词也准确。返回实际更新的数量。
   */
  async ensureDifficulties(): Promise<number> {
    let changed = 0;
    for (const r of this.getAllWords()) {
      if (r.difficulty === undefined) {
        r.difficulty = computeDifficulty(r.word, { senseCount: r.senseCount }).difficulty;
        changed++;
      }
      // 排程字段缺失（老词库）补默认：due 留空 → 视为立即可复习（等价于 now）
      if (r.ease === undefined) { r.ease = 2.5; changed++; }
      if (r.reps === undefined) { r.reps = 0; changed++; }
      if (r.lapse === undefined) { r.lapse = 0; changed++; }
      if (r.recall === undefined) { r.recall = 0; changed++; }
      if (r.intervalDays === undefined) { r.intervalDays = 0; changed++; }
      if (r.queryCount === undefined) { r.queryCount = 0; changed++; }
    }
    if (changed > 0) await this.persist();
    return changed;
  }

  // ============ 状态机：Archived / Ignored ============
  // 单词可从 active → archived(毕业归档) / ignored(忽略)，并支持回到 active。

  /** 直接设置单词状态（active/archived/ignored）。 */
  async setWordStatus(word: string, status: WordStatus): Promise<void> {
    const loc = this.locate(word);
    if (!loc) return;
    if (loc.record.status === status) return;
    loc.record.status = status;
    loc.record.updated = new Date().toISOString();
    await this.persist();
  }

  /** 毕业归档：掌握后移出复习队列。 */
  async archiveWord(word: string): Promise<void> {
    await this.setWordStatus(word, WordStatus.Archived);
  }

  /** 忽略：不再提醒。 */
  async ignoreWord(word: string): Promise<void> {
    await this.setWordStatus(word, WordStatus.Ignored);
  }

  /** 恢复为活跃（从 archived/ignored 回队列）。 */
  async reactivateWord(word: string): Promise<void> {
    await this.setWordStatus(word, WordStatus.Active);
  }

  /** 取某状态下的全部单词（用于「恢复」界面）。 */
  getWordsByStatus(status: WordStatus): WordRecord[] {
    return this.getAllWords().filter((r) => r.status === status);
  }

  async updateWordMeta(
    word: string,
    meta: { phonetic?: string; pos?: string; meaning?: string; preferredDefinitions?: string[] }
  ): Promise<void> {
    const loc = this.locate(word);
    if (!loc) return;
    if (meta.phonetic !== undefined) loc.record.phonetic = meta.phonetic;
    if (meta.pos !== undefined) loc.record.pos = meta.pos;
    if (meta.meaning !== undefined) loc.record.meaning = meta.meaning;
    // 2026-08-22 释义偏好：支持单独更新 preferredDefinitions(允许清空传 [])
    if (meta.preferredDefinitions !== undefined) loc.record.preferredDefinitions = [...meta.preferredDefinitions];
    loc.record.updated = new Date().toISOString();
    await this.persist();
  }

  /** 更新单词的分类标签（2026-08-14 新增，与批注 labels 共享命名空间） */
  async updateWordLabels(word: string, labels: string[]): Promise<void> {
    const loc = this.locate(word);
    if (!loc) return;
    loc.record.labels = labels || [];
    loc.record.updated = new Date().toISOString();
    await this.persist();
  }

  /** 移动单词到指定单词本/主题（保留元信息） */
  async moveWord(word: string, toBookId: string, toThemeId: string): Promise<boolean> {
    // 单词总库是只读聚合，单词不可被移入其中
    if (toBookId === ALL_BOOK_ID) return false;
    const loc = this.locate(word);
    const target = this.getTheme(toBookId, toThemeId);
    if (!loc || !target) return false;
    if (loc.theme === target) return true;
    const w = word.toLowerCase().trim();
    loc.theme.words = loc.theme.words.filter((r) => r.word !== w);
    const moved: WordRecord = { ...loc.record, order: target.words.length, updated: new Date().toISOString() };
    target.words.push(moved);
    // 1.1 byWord 同步：先删旧定位，再写新定位
    this.byWord.delete(w);
    const targetBook = this.getBook(toBookId)!;
    this.byWord.set(w, { book: targetBook, theme: target, record: moved });
    await this.persist();
    return true;
  }

  /** 拖拽重排：把主题内某单词移动到 newIndex（基于当前展示序列） */
  async reorderInTheme(themeId: string, wordId: string, newIndex: number): Promise<void> {
    const book = this.getActiveBook();
    const theme = book?.themes.find((t) => t.id === themeId);
    if (!theme) return;
    const oldIndex = theme.words.findIndex((r) => r.id === wordId);
    if (oldIndex < 0) return;
    const [rec] = theme.words.splice(oldIndex, 1);
    const idx = Math.max(0, Math.min(theme.words.length, newIndex));
    theme.words.splice(idx, 0, rec);
    theme.words.forEach((r, i) => (r.order = i));
    await this.persist();
  }

  // ============ 单词本 / 主题 CRUD ============

  async addBook(name: string): Promise<VocabBook> {
    const book: VocabBook = {
      id: genId("bk"),
      name: name.trim() || DEFAULT_BOOK,
      order: this.data.books.length,
      themes: [{ id: genId("th"), name: DEFAULT_THEME, order: 0, words: [] }],
    };
    this.data.books.push(book);
    this.data.activeBookId = book.id;
    this.data.activeThemeId = book.themes[0].id;
    await this.persist();
    return book;
  }

  async renameBook(id: string, name: string): Promise<void> {
    if (id === ALL_BOOK_ID) return; // 总库只读，不可重命名
    const book = this.getBook(id);
    if (book) {
      book.name = name.trim() || book.name;
      await this.persist();
    }
  }

  async removeBook(id: string): Promise<void> {
    if (id === ALL_BOOK_ID) return; // 总库不可删除
    if (this.data.books.length <= 1) return; // 至少保留一个
    this.data.books = this.data.books.filter((b) => b.id !== id);
    this.ensureActiveValid();
    // 1.1 byWord 同步：整本删除是最容易导致 dangling 的场景，
    // 干脆整体重建索引（O(N)，但删除整本是低频操作）
    this.rebuildByWordIndex();
    await this.persist();
  }

  async setActiveBook(id: string): Promise<void> {
    if (this.getBook(id)) {
      this.data.activeBookId = id;
      const book = this.getBook(id)!;
      this.data.activeThemeId = book.themes[0]?.id ?? "";
      await this.persist();
    }
  }

  async addTheme(bookId: string, name: string): Promise<VocabTheme | null> {
    if (bookId === ALL_BOOK_ID) return null; // 总库只读，不可建子类
    const book = this.getBook(bookId);
    if (!book) return null;
    const theme: VocabTheme = {
      id: genId("th"),
      name: name.trim() || "新主题",
      order: book.themes.length,
      words: [],
    };
    book.themes.push(theme);
    this.data.activeThemeId = theme.id;
    await this.persist();
    return theme;
  }

  async renameTheme(bookId: string, themeId: string, name: string): Promise<void> {
    if (bookId === ALL_BOOK_ID) return; // 总库只读，不可重命名子类
    const theme = this.getTheme(bookId, themeId);
    if (theme) {
      theme.name = name.trim() || theme.name;
      await this.persist();
    }
  }

  /**
   * 删除二级分类（主题）。
   * 语义（2026-08-15 用户确认）：删分类=只删分组、单词留未分类。
   * 即：把该分类下的单词整体移入本单词本的「未分类」分组，再移除该分组本身；
   * 「未分类」分组本身不可删除（它是兜底归宿）。
   */
  async removeTheme(bookId: string, themeId: string): Promise<void> {
    if (bookId === ALL_BOOK_ID) return; // 总库只读，不可删子类
    const book = this.getBook(bookId);
    if (!book) return;
    const theme = book.themes.find((t) => t.id === themeId);
    if (!theme) return;
    // 「未分类」是兜底分组，不允许删除
    if (theme.name === DEFAULT_THEME) return;
    // 找到/创建本单词本的「未分类」分组，作为单词的归宿
    let uncat = book.themes.find((t) => t.name === DEFAULT_THEME);
    if (!uncat) {
      uncat = { id: genId("th"), name: DEFAULT_THEME, order: book.themes.length, words: [] };
      book.themes.push(uncat);
    }
    // 将被删分组的单词移入「未分类」（按 word 去重，保留未分类已有项）
    const existing = new Set(uncat.words.map((w) => w.word.toLowerCase()));
    for (const w of theme.words) {
      if (!existing.has(w.word.toLowerCase())) {
        const newRec = { ...w, order: uncat.words.length };
        uncat.words.push(newRec);
        existing.add(w.word.toLowerCase());
        // 1.1 byWord 同步：record 引用更新到 uncat 内的复制体
        this.byWord.set(w.word, { book, theme: uncat, record: newRec });
      }
    }
    // 移除目标分组
    book.themes = book.themes.filter((t) => t.id !== themeId);
    // 若删除的是当前激活分组，切到未分类
    if (this.data.activeThemeId === themeId) {
      this.data.activeThemeId = uncat.id;
    }
    this.ensureActiveValid();
    await this.persist();
  }

  async setActiveTheme(themeId: string): Promise<void> {
    this.data.activeThemeId = themeId;
    await this.persist();
  }

  // ============ 旧版迁移（一次性）============

  private async migrateFromLegacyDoc(): Promise<void> {
    try {
      const docs = await sqlQuery<{ id: string }>(
        `SELECT id FROM blocks WHERE hpath = '/HiWord-Vocabulary' AND type = 'd' LIMIT 1`
      );
      if (!docs.length) return;
      const blocks = await sqlQuery<{ id: string; content: string }>(
        `SELECT id, content FROM blocks WHERE root_id = '${docs[0].id}' AND type = 'l' ORDER BY sort ASC`
      );
      let imported = 0;
      for (const b of blocks) {
        const word = (b.content || "").replace(/^\*\s*/, "").replace(/^-\s*/, "").trim().toLowerCase();
        if (!word) continue;
        const attrs = await getBlockAttrs(b.id);
        await this.addWord(word, {
          phonetic: attrs["custom-phonetic"] ?? "",
          meaning: attrs["custom-meaning"] ?? "",
        });
        imported++;
      }
      getLogger().info(`[REword] 已从旧版词库迁移 ${imported} 个单词`);
    } catch (e) {
      getLogger().warn("[REword] 旧版词库迁移跳过:", { error: e });
    }
  }
}
