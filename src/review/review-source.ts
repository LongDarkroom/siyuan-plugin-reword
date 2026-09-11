/**
 * 复习书源（2026-09-11 新增 · 复习面板重构 P4）
 * ------------------------------------------------------------------
 * 「添加单词书」的书源绑定模式：
 *   - 队列不复制词：书源只记录 {kind, targetId}，实时从词库解析成员词；
 *     词库加词自动跟随、删词自动退出（队列 = status===Active 的实时过滤）；
 *   - 每日新词释放：绑定书源后，书内"从未复习过的新词"不一次性涌入队列，
 *     而是按 dailyNewLimit 分批释放（computeRelease 返回计划，调用方写库）；
 *   - 信任书源：draft 书默认不入队（与草稿状态机一致），勾选 trustSource
 *     的自整理书可跳过校验直接释放。
 *
 * 纯函数 + 轻量存储类，不依赖思源运行时，可被 node:test 直接覆盖。
 */

import type { VocabBook, WordRecord } from "../types.ts";

/** 一条复习书源绑定 */
export interface ReviewSource {
  id: string;
  /** book = 整本单词本；theme = 单词本下的单个主题 */
  kind: "book" | "theme";
  /** VocabBook.id（book）或 VocabTheme.id（theme） */
  targetId: string;
  /** 展示名（冗余：书/主题被删除后仍可读） */
  targetLabel: string;
  /** 每日新词释放上限（5~50，默认 10） */
  dailyNewLimit: number;
  /** 信任书源：draft 书也允许释放入队 */
  trustSource: boolean;
  /** 绑定时刻 ISO */
  createdAt: string;
  /** 已释放进队列的新词（小写 word），幂等与配额推算依据 */
  releasedWords?: string[];
  /** 最近一次释放的本地日期 "YYYY-MM-DD"，一天最多释放一批 */
  lastReleaseDate?: string;
}

export const DAILY_NEW_LIMIT_MIN = 5;
export const DAILY_NEW_LIMIT_MAX = 50;
export const DAILY_NEW_LIMIT_DEFAULT = 10;

const DAY = 86_400_000;

function genId(): string {
  return `rsrc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 本地日期 "YYYY-MM-DD"（与用户感知的"今天"一致） */
export function localDateKey(d: Date | number = new Date()): string {
  const dt = typeof d === "number" ? new Date(d) : d;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return DAILY_NEW_LIMIT_DEFAULT;
  return Math.max(DAILY_NEW_LIMIT_MIN, Math.min(DAILY_NEW_LIMIT_MAX, Math.round(n)));
}

/** 书源存储：数组 + onChange 持久化回调（与 VocabStore 注入模式一致） */
export class ReviewSourceStore {
  private sources: ReviewSource[] = [];
  private loaded = false;
  private onChange?: () => void | Promise<void>;

  constructor(onChange?: () => void | Promise<void>) {
    this.onChange = onChange;
  }

  /** 从持久化 JSON 水合；非法条目静默丢弃 */
  load(raw: unknown): void {
    this.sources = Array.isArray(raw)
      ? raw.filter((s): s is ReviewSource =>
          !!s && typeof s === "object" &&
          typeof (s as ReviewSource).id === "string" &&
          ((s as ReviewSource).kind === "book" || (s as ReviewSource).kind === "theme") &&
          typeof (s as ReviewSource).targetId === "string"
        ).map((s) => ({
          ...s,
          dailyNewLimit: clampLimit(s.dailyNewLimit),
          trustSource: !!s.trustSource,
          targetLabel: s.targetLabel || s.targetId,
          releasedWords: Array.isArray(s.releasedWords) ? s.releasedWords.filter(Boolean) : [],
        }))
      : [];
    this.loaded = true;
  }

  toJSON(): ReviewSource[] {
    return this.sources;
  }

  private async persist(): Promise<void> {
    if (!this.loaded) return; // 与 VocabStore 相同的 load 前守卫
    await this.onChange?.();
  }

  list(): ReviewSource[] {
    return [...this.sources];
  }

  get(id: string): ReviewSource | undefined {
    return this.sources.find((s) => s.id === id);
  }

  /** 按 kind+targetId 去重；重复绑定返回已有条目（updated 字段合并） */
  async add(input: Pick<ReviewSource, "kind" | "targetId" | "targetLabel"> & { dailyNewLimit?: number; trustSource?: boolean }): Promise<ReviewSource> {
    const exist = this.sources.find((s) => s.kind === input.kind && s.targetId === input.targetId);
    if (exist) {
      exist.targetLabel = input.targetLabel || exist.targetLabel;
      exist.dailyNewLimit = clampLimit(input.dailyNewLimit ?? exist.dailyNewLimit);
      exist.trustSource = input.trustSource ?? exist.trustSource;
      await this.persist();
      return exist;
    }
    const src: ReviewSource = {
      id: genId(),
      kind: input.kind,
      targetId: input.targetId,
      targetLabel: input.targetLabel || input.targetId,
      dailyNewLimit: clampLimit(input.dailyNewLimit ?? DAILY_NEW_LIMIT_DEFAULT),
      trustSource: !!input.trustSource,
      createdAt: new Date().toISOString(),
      releasedWords: [],
    };
    this.sources.push(src);
    await this.persist();
    return src;
  }

  async update(id: string, patch: Partial<Pick<ReviewSource, "dailyNewLimit" | "trustSource" | "targetLabel" | "releasedWords" | "lastReleaseDate">>): Promise<void> {
    const s = this.get(id);
    if (!s) return;
    if (patch.dailyNewLimit !== undefined) s.dailyNewLimit = clampLimit(patch.dailyNewLimit);
    if (patch.trustSource !== undefined) s.trustSource = patch.trustSource;
    if (patch.targetLabel !== undefined) s.targetLabel = patch.targetLabel;
    if (patch.releasedWords !== undefined) s.releasedWords = patch.releasedWords;
    if (patch.lastReleaseDate !== undefined) s.lastReleaseDate = patch.lastReleaseDate;
    await this.persist();
  }

  async remove(id: string): Promise<boolean> {
    const i = this.sources.findIndex((s) => s.id === id);
    if (i < 0) return false;
    this.sources.splice(i, 1);
    await this.persist();
    return true;
  }

  /** 测试辅助：无持久化重置 */
  __resetForTest(): void {
    this.sources = [];
    this.loaded = true;
  }
}

// ============ 纯函数：解析与释放计划（books 直接传入，便于测试） ============

/** 书源成员词：book → 整本全部主题词；theme → 全库中匹配 themeId 的主题词 */
export function resolveSourceWords(source: Pick<ReviewSource, "kind" | "targetId">, books: VocabBook[]): WordRecord[] {
  if (source.kind === "book") {
    const book = books.find((b) => b.id === source.targetId);
    if (!book) return [];
    return book.themes.flatMap((t) => t.words);
  }
  for (const b of books) {
    const theme = b.themes.find((t) => t.id === source.targetId);
    if (theme) return [...theme.words];
  }
  return [];
}

/** 书源绑定的书是否为草稿（theme 沿用所属书的 status） */
export function sourceBookStatus(source: Pick<ReviewSource, "kind" | "targetId">, books: VocabBook[]): "draft" | "verified" | "missing" {
  if (source.kind === "book") {
    const b = books.find((x) => x.id === source.targetId);
    return b ? (b.status === "draft" ? "draft" : "verified") : "missing";
  }
  for (const b of books) {
    if (b.themes.some((t) => t.id === source.targetId)) {
      return b.status === "draft" ? "draft" : "verified";
    }
  }
  return "missing";
}

/** 书内"新词"判定：在队列（active）、从未复习过（reps 0/空） */
function isNewCandidate(w: WordRecord): boolean {
  return w.status === "active" && !w.reps;
}

export interface ReleasePlan {
  /** 今天应释放（设 due = 立即可复习）的词 */
  release: WordRecord[];
  /** 其余新词的延期 due（ISO，防止"空 due = 立即可复习"绕过配额） */
  defer: Array<{ word: string; due: string }>;
  /** 书是草稿且未信任 → 整体跳过 */
  skippedDraft: boolean;
  /** 书已不存在 → 绑定失效 */
  missing: boolean;
  /** 绑定以来按天推算的应释放总数 */
  target: number;
  /** 已释放总数 */
  releasedCount: number;
}

/**
 * 计算某书源今天的释放计划（纯函数，不写库）。
 *
 * 节奏公式：应释放总数 target = min(书源新词总数, 自绑定日起经过天数 × dailyNewLimit)。
 * 今天释放数 = clamp(target - 已释放数, 0, 今日剩余资格)；一天最多一批（lastReleaseDate 幂等）。
 * 选取顺序：词的 created 升序（收词先后）。未被今天释放的新词统一 defer 到
 * "按全局序号 ÷ limit" 推算的未来日期，保证配额不被"空 due"绕过。
 */
export function computeRelease(
  source: ReviewSource,
  books: VocabBook[],
  now: number = Date.now()
): ReleasePlan {
  const status = sourceBookStatus(source, books);
  if (status === "missing") {
    return { release: [], defer: [], skippedDraft: false, missing: true, target: 0, releasedCount: (source.releasedWords ?? []).length };
  }
  if (status === "draft" && !source.trustSource) {
    return { release: [], defer: [], skippedDraft: true, missing: false, target: 0, releasedCount: (source.releasedWords ?? []).length };
  }

  const limit = clampLimit(source.dailyNewLimit);
  const released = new Set(source.releasedWords ?? []);
  const all = resolveSourceWords(source, books)
    .filter(isNewCandidate)
    .sort((a, b) => String(a.created).localeCompare(String(b.created)));

  const pending = all.filter((w) => !released.has(w.word));
  const totalNew = all.length; // 含已释放（仍在"新词"定义内）
  const sod = new Date(now);
  sod.setHours(0, 0, 0, 0);
  const created = new Date(source.createdAt);
  created.setHours(0, 0, 0, 0);
  const daysElapsed = Math.max(1, Math.floor((sod.getTime() - created.getTime()) / DAY) + 1);
  const target = Math.min(totalNew, daysElapsed * limit);

  const releasedCount = totalNew - pending.length;
  let quota = Math.max(0, Math.min(target - releasedCount, pending.length));
  // 一天一批：今天已释放过则本次只做 defer 刷新
  if (source.lastReleaseDate === localDateKey(now)) quota = 0;

  const release = pending.slice(0, quota);
  const rest = pending.slice(quota);
  // defer：全局序号（已释放数 + 本批数 + 相对序）决定第几天放出。
  // 第 k 批（k = floor(globalIdx/limit)，0-based）应在"绑定后第 k+1 天"到期；
  // 换算到当前：due = 今天 0 点 + max(1, k+1-daysElapsed) 天（至少明天，杜绝立即到期）。
  const defer = rest.map((w, i) => {
    const globalIdx = releasedCount + quota + i;
    const k = Math.floor(globalIdx / limit);
    const offsetDays = Math.max(1, k + 1 - daysElapsed);
    const dueDay = sod.getTime() + offsetDays * DAY;
    return { word: w.word, due: new Date(dueDay).toISOString() };
  });

  return { release, defer, skippedDraft: false, missing: false, target, releasedCount };
}

/** 书源预览（弹层用）：词数 / 已在队列数 / 星级分布 / 抽样词 */
export function summarizeSource(
  source: Pick<ReviewSource, "kind" | "targetId">,
  books: VocabBook[]
): { total: number; activeCount: number; draft: boolean; missing: boolean } {
  const words = resolveSourceWords(source, books);
  return {
    total: words.length,
    activeCount: words.filter((w) => w.status === "active").length,
    draft: sourceBookStatus(source, books) === "draft",
    missing: sourceBookStatus(source, books) === "missing",
  };
}

/** 测试辅助 */
export function __resetReviewSourceForTest(): void {
  /* 无模块级状态 */
}
