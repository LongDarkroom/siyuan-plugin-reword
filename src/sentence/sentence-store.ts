/**
 * REword · 句子库存储（2026-09-12 新增 · AI 造句功能数据层）
 * ------------------------------------------------------------------
 * 句子是独立实体（一词多句、可跨词复用、可管理），词库 WordRecord 只存 sentenceIds 索引。
 * 持久化经 onChange 回调由 index.ts 用 PersistentStore 落盘（hiword-sentences.json），
 * 与 ReviewSourceStore 同模式。纯数据类可脱离思源运行时单测。
 *
 * 来源优先级（用户拍板）：离线/海词词典自带例句（source=dict）→ AI 生成补缺（source=ai）。
 */

export type SentenceSource = "dict" | "ai";
/** draft=生成后未处理；kept=用户采纳；fav=收藏 */
export type SentenceStatus = "draft" | "kept" | "fav";

export interface SentenceRecord {
  id: string;
  /** 目标词（小写） */
  word: string;
  en: string;
  zh: string;
  /** SV / SVO / SVC / SVOO / SVOC / phrase */
  sentenceType: string;
  tense?: string;
  scenario?: string;
  cefr?: string;
  source: SentenceSource;
  /** AI 来源的模型名（展示用） */
  aiModel?: string;
  status: SentenceStatus;
  createdAt: string;
  /** 复习轮换：当天固定展示、次日换（ScrambleSentences 模式） */
  lastShown?: string;
}

/** 每词句子数上限（防膨胀，超出淘汰最旧 draft） */
export const MAX_SENTENCES_PER_WORD = 20;

function genId(): string {
  return `sent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface SentenceStoreData {
  sentences: SentenceRecord[];
}

export class SentenceStore {
  private data: SentenceStoreData = { sentences: [] };
  /** word → 句子数组（小写键；写路径维护） */
  private byWord = new Map<string, SentenceRecord[]>();
  private loaded = false;
  private onChange?: () => void | Promise<void>;

  constructor(onChange?: () => void | Promise<void>) {
    this.onChange = onChange;
  }

  /** 从持久化 JSON 水合；非法条目静默丢弃 */
  load(raw: unknown): void {
    const arr = Array.isArray((raw as any)?.sentences) ? (raw as any).sentences : [];
    this.data.sentences = arr.filter((s: any): s is SentenceRecord =>
      !!s && typeof s === "object" &&
      typeof s.id === "string" && typeof s.word === "string" &&
      typeof s.en === "string" && typeof s.zh === "string"
    ).map((s: any) => ({
      ...s,
      word: String(s.word).toLowerCase(),
      status: s.status === "kept" || s.status === "fav" ? s.status : "draft",
      source: s.source === "dict" ? "dict" : "ai",
      sentenceType: typeof s.sentenceType === "string" ? s.sentenceType : "phrase",
    }));
    this.rebuildIndex();
    this.loaded = true;
  }

  private rebuildIndex(): void {
    this.byWord.clear();
    for (const s of this.data.sentences) {
      const list = this.byWord.get(s.word) || [];
      list.push(s);
      this.byWord.set(s.word, list);
    }
  }

  export(): SentenceStoreData {
    return JSON.parse(JSON.stringify(this.data));
  }

  private async persist(): Promise<void> {
    if (!this.loaded) return; // load 前守卫（与 VocabStore 一致）
    await this.onChange?.();
  }

  /** 某词全部句子（createdAt 升序） */
  listFor(word: string): SentenceRecord[] {
    return [...(this.byWord.get(word.toLowerCase()) || [])].sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  /** 某词已采纳/收藏的句子（复习轮换用） */
  keptFor(word: string): SentenceRecord[] {
    return this.listFor(word).filter((s) => s.status === "kept" || s.status === "fav");
  }

  countFor(word: string): number {
    return (this.byWord.get(word.toLowerCase()) || []).length;
  }

  total(): number {
    return this.data.sentences.length;
  }

  get(id: string): SentenceRecord | undefined {
    return this.data.sentences.find((s) => s.id === id);
  }

  /** 新增句子；超每词上限时淘汰最旧 draft（kept/fav 永不自动删） */
  async add(input: Omit<SentenceRecord, "id" | "createdAt" | "status"> & { status?: SentenceStatus }): Promise<SentenceRecord> {
    const rec: SentenceRecord = {
      ...input,
      word: String(input.word).toLowerCase(),
      id: genId(),
      createdAt: new Date().toISOString(),
      status: input.status || "draft",
    };
    this.data.sentences.push(rec);
    const list = this.byWord.get(rec.word) || [];
    list.push(rec);
    this.byWord.set(rec.word, list);
    // 上限治理
    if (list.length > MAX_SENTENCES_PER_WORD) {
      const droppable = list
        .filter((s) => s.status === "draft")
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const excess = list.length - MAX_SENTENCES_PER_WORD;
      for (let i = 0; i < excess && i < droppable.length; i++) {
        await this.remove(droppable[i].id);
      }
    }
    await this.persist();
    return rec;
  }

  async update(id: string, patch: Partial<Pick<SentenceRecord, "status" | "zh" | "lastShown">>): Promise<void> {
    const s = this.get(id);
    if (!s) return;
    if (patch.status !== undefined) s.status = patch.status;
    if (patch.zh !== undefined) s.zh = patch.zh;
    if (patch.lastShown !== undefined) s.lastShown = patch.lastShown;
    await this.persist();
  }

  async remove(id: string): Promise<boolean> {
    const i = this.data.sentences.findIndex((s) => s.id === id);
    if (i < 0) return false;
    const [rec] = this.data.sentences.splice(i, 1);
    const list = this.byWord.get(rec.word);
    if (list) {
      const j = list.findIndex((x) => x.id === id);
      if (j >= 0) list.splice(j, 1);
    }
    await this.persist();
    return true;
  }

  /** 测试辅助：重置（不触发持久化） */
  __resetForTest(): void {
    this.data = { sentences: [] };
    this.byWord.clear();
    this.loaded = true;
  }
}
