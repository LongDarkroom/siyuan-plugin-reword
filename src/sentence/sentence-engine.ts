/**
 * REword · 造句引擎（2026-09-12 新增 · AI 造句功能编排层）
 * ------------------------------------------------------------------
 * 来源优先级（用户拍板）：
 *   ① 海词在线词典自带例句（source=dict，免费且权威）→ 直接入库 draft
 *   ② 不足目标数 → AI 补缺（内置可控 prompt，jsonMode，校验失败自动重试 1 次）
 *
 * 三层限流（防频率过高）：
 *   1) 单词级冷却：同词默认 24h 内不重复自动生成（force 可跳过）；
 *   2) 全局串行队列：词间最小间隔 QUEUE_INTERVAL_MS，并发请求合并（in-flight 去重）；
 *   3) 每日上限：默认 10 词/天，配额计数由调用方注入（与计划/告警解耦）。
 *
 * 依赖注入构造，不触碰思源运行时 → 可被 node:test 用内存 mock 覆盖。
 */

import type { AiSettings } from "../ai/types.ts";
import type { AiGenerateOptions, AiGenerateResult, AiTransport } from "../ai/ai-client.ts";
import type { OnlineDictResult } from "../dict/online-dict.ts";
import { SentenceStore } from "./sentence-store.ts";
import { buildSentenceMessages, parseSentenceJson, validateSentences, DEFAULT_SENT_N } from "./gen-prompt.ts";
import { DEFAULT_SENTENCE_SETTINGS, normalizeSentenceSettings } from "./sentence-settings.ts";
import type { SentenceSettings } from "./sentence-settings.ts";

/** 单词冷却 24h */
export const WORD_COOLDOWN_MS = 24 * 3600_000;
/** 队列词间隔 5s */
export const QUEUE_INTERVAL_MS = 5_000;
/** 每日生成词数上限 */
export const DAILY_GEN_LIMIT = 10;

/**
 * 未注入设置层时的兜底配置。
 * 由上面的常量派生（而非另写一份数字），保证「常量 → 默认设置」永不漂移，
 * 也让既有单测（不传 getSentenceSettings）行为逐字不变。
 */
const FALLBACK_SETTINGS: SentenceSettings = {
  ...DEFAULT_SENTENCE_SETTINGS,
  sentenceCount: DEFAULT_SENT_N,
  cooldownHours: WORD_COOLDOWN_MS / 3600_000,
  dailyLimit: DAILY_GEN_LIMIT,
  queueIntervalMs: QUEUE_INTERVAL_MS,
};

export interface GenerateOpts {
  n?: number;
  scenarios?: string[];
  /** 跳过单词冷却（用户显式"重新生成"） */
  force?: boolean;
  /** 2026-09-12：纯 AI 生成（跳过词典例句步骤）——「重新生成」= 把词典队列切换为 AI 队列 */
  aiOnly?: boolean;
}

export interface GenerateResult {
  ok: boolean;
  word: string;
  /** 词典例句入库数 */
  dictAdded: number;
  /** AI 补缺入库数 */
  aiAdded: number;
  /** 被限流/冷却拒绝 */
  skipped?: "cooldown" | "daily-limit" | "ai-not-configured" | "ai-disabled";
  error?: string;
}

export interface SentenceEngineDeps {
  getSettings: () => AiSettings;
  store: SentenceStore;
  /** 海词在线词典（缓存策略由 online-dict 自带） */
  fetchOnline: (word: string) => Promise<OnlineDictResult | null>;
  /** AI 调用（注入以便单测 mock；生产由 index.ts 传 requestAIGenerate） */
  requestAi: (opts: AiGenerateOptions, transport?: AiTransport) => Promise<AiGenerateResult>;
  /** 每日生成词数计数（跨天重置由调用方负责） */
  getGenCountToday: () => number;
  incrGenCount: () => void;
  /**
   * 造句专属设置（2026-09-12 新增，**可选**）。
   * 不传 = 用 FALLBACK_SETTINGS（等价于既有常量），保证老调用方与单测零改动。
   * 生产由 index.ts 注入，读的是一份独立于 AiSettings 的配置。
   */
  getSentenceSettings?: () => SentenceSettings;
}

export class SentenceEngine {
  private deps: SentenceEngineDeps;
  /** 单词最近生成时间（ms） */
  private lastGenAt = new Map<string, number>();
  /** in-flight 去重：同词并发共享同一 Promise */
  private inflight = new Map<string, Promise<GenerateResult>>();
  /** 串行队列链 */
  private chain: Promise<void> = Promise.resolve();
  private chainTailAt = 0;

  constructor(deps: SentenceEngineDeps) {
    this.deps = deps;
  }

  /** 当前生效的造句设置（每次读取即时归一，防运行时被写入非法值） */
  private s(): SentenceSettings {
    const raw = this.deps.getSentenceSettings?.();
    return raw ? normalizeSentenceSettings(raw) : FALLBACK_SETTINGS;
  }

  /** 单词冷却时长（ms）：由设置层的 cooldownHours 推导，0 = 不冷却 */
  private cooldownMs(): number {
    return Math.max(0, this.s().cooldownHours) * 3600_000;
  }

  /** 是否处于冷却（UI 展示"今日已生成"用） */
  cooldownLeft(word: string, now: number = Date.now()): number {
    const t = this.lastGenAt.get(word.toLowerCase()) || 0;
    return Math.max(0, t + this.cooldownMs() - now);
  }

  /** 生成入口（限流 + 合并并发） */
  generateForWord(word: string, pos: string, meaning: string, opts: GenerateOpts = {}): Promise<GenerateResult> {
    const key = word.toLowerCase();
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.run(word, key, pos, meaning, opts).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** 例句词性筛选：词典未标词性时不因筛选丢例句 */
  private posAllowed(groupPos: string, filter: string[]): boolean {
    if (!filter.length) return true;
    const p = (groupPos || "").toLowerCase().trim();
    if (!p) return true;
    return filter.some((f) => {
      const q = f.toLowerCase().trim();
      return !!q && (p.includes(q) || q.includes(p));
    });
  }

  private async run(word: string, key: string, pos: string, meaning: string, opts: GenerateOpts): Promise<GenerateResult> {
    const st = this.s();
    const n = Math.max(1, Math.min(5, opts.n ?? st.sentenceCount));
    const scenarios = opts.scenarios?.length ? opts.scenarios : st.scenarios;
    const now = Date.now();

    // —— 限流 1：单词冷却 ——
    if (!opts.force && this.cooldownLeft(key, now) > 0) {
      return { ok: false, word, dictAdded: 0, aiAdded: 0, skipped: "cooldown" };
    }
    // —— 限流 3：每日上限（设置层 0 = 不限）——
    if (st.dailyLimit > 0 && this.deps.getGenCountToday() >= st.dailyLimit) {
      return { ok: false, word, dictAdded: 0, aiAdded: 0, skipped: "daily-limit" };
    }

    let dictAdded = 0;
    let aiAdded = 0;

    // —— ① 海词词典例句优先（免费、权威）——
    // 设置层可关（只走 AI）；词性筛选按 group.pos 命中判断；
    // aiOnly（重新生成）跳过词典步骤，直接走 AI 队列。
    try {
      if (!opts.aiOnly && st.useOnlineExamples) {
        const online = await this.deps.fetchOnline(key);
        if (online?.examples?.length) {
          const existing = new Set(this.deps.store.listFor(key).map((s) => s.en.toLowerCase()));
          for (const group of online.examples) {
            if (!this.posAllowed(group.pos, st.examplePosFilter)) continue;
            for (const it of group.items || []) {
              if (dictAdded + aiAdded >= n) break;
              const en = (it.en || "").trim();
              const zh = (it.zh || "").trim();
              if (!en || !zh || existing.has(en.toLowerCase())) continue;
              await this.deps.store.add({
                word: key, en, zh,
                sentenceType: "phrase", // 词典例句不强行标句型
                scenario: "词典", source: "dict", status: "draft",
              });
              existing.add(en.toLowerCase());
              dictAdded++;
            }
            if (dictAdded + aiAdded >= n) break;
          }
        }
      }
    } catch {
      // 海词失败不阻断（离线场景常见），继续走 AI
    }

    // —— ② AI 补缺 ——
    const need = n - dictAdded;
    // 2026-09-12：总开关 aiGenEnabled 优先；补缺子开关 aiFillEnabled 仅约束"补缺"路径，
    // aiOnly（重新生成）是用户显式选择纯 AI，不再受 aiFillEnabled 限制，但仍受总开关约束。
    if (need > 0 && st.aiGenEnabled && (opts.aiOnly || st.aiFillEnabled)) {
      const settings = this.deps.getSettings();
      if (!settings?.apiKey || !settings?.baseUrl) {
        if (dictAdded === 0) {
          return { ok: false, word, dictAdded: 0, aiAdded: 0, skipped: "ai-not-configured" };
        }
        // 有部分词典例句即算成功（AI 未配置不报错）
      } else {
        // 限流 2：串行队列（词间隔）
        await this.enqueue();
        try {
          aiAdded = await this.aiFill(word, pos, meaning, need, scenarios, st);
        } catch (e: any) {
          this.chainTailAt = Date.now();
          if (dictAdded === 0) {
            return { ok: false, word, dictAdded, aiAdded: 0, error: String(e?.message || e) };
          }
        }
        this.chainTailAt = Date.now();
      }
    } else if (need > 0 && dictAdded === 0) {
      // 2026-09-12：AI 参与被设置关闭（总开关 aiGenEnabled 或补缺 aiFillEnabled），
      // 且词典也未提供例句 → 明确回报，UI 提示去开启，而不是含糊的"无结果"。
      return { ok: false, word, dictAdded: 0, aiAdded: 0, skipped: "ai-disabled" };
    }

    this.lastGenAt.set(key, now);
    this.deps.incrGenCount();
    return { ok: true, word, dictAdded, aiAdded };
  }

  /** 排队：保证与上一任务间隔 ≥ 设置的队列间隔（串行限流，0 = 不等待） */
  private enqueue(): Promise<void> {
    const iv = Math.max(0, this.s().queueIntervalMs);
    const wait = Math.max(0, this.chainTailAt + iv - Date.now());
    const next = this.chain.then(async () => {
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    });
    this.chain = next.catch(() => undefined);
    this.chainTailAt = Math.max(this.chainTailAt + iv, Date.now() + wait);
    return next;
  }

  /**
   * AI 补缺：调用 → 解析 → 校验 → 不足重试 1 次 → 入库。
   *
   * 设置层接入点（**全部只作用于造句链路**）：
   *  - prompt 覆盖 / 长度区间 / 词性提示 / 加粗开关 → 透传给 buildSentenceMessages
   *  - temperature → 通过**浅拷贝** settings 注入，绝不写回 AiSettings
   *    （AI 精读 / 自由对话共用的那份配置只读不写）
   */
  private async aiFill(
    word: string,
    pos: string,
    meaning: string,
    need: number,
    scenarios: string[],
    st: SentenceSettings
  ): Promise<number> {
    const requestAi = this.deps.requestAi;
    // 多要 1 句：校验会剔除不合格项，用冗余抵损耗（不足则 while 再补一轮）
    const messages = buildSentenceMessages(word, pos, meaning, need + 1, {
      scenarios,
      lenMin: st.lenMin,
      lenMax: st.lenMax,
      posBias: st.posBias,
      markWord: st.markWord,
      systemPrompt: st.systemPrompt,
      extraPrompt: st.extraPrompt,
      userPrompt: st.userPrompt,
    });
    // 浅拷贝 + 覆盖 temperature：对外只读，AiSettings 原对象不受影响
    const base = this.deps.getSettings();
    const settings = { ...(base as any), temperature: st.temperature } as AiSettings;

    let added = 0;
    let attempt = 0;
    while (added < need && attempt < 2) {
      attempt++;
      const gen = await requestAi({ messages, settings, jsonMode: true, timeout: 60000 });
      const parsed = parseSentenceJson(gen.content);
      const valid = validateSentences(parsed, word, { lenMin: st.lenMin, lenMax: st.lenMax });
      const existing = new Set(this.deps.store.listFor(word.toLowerCase()).map((s) => s.en.toLowerCase()));
      for (const s of valid) {
        if (added >= need) break;
        if (existing.has(s.en.toLowerCase())) continue;
        await this.deps.store.add({
          word: word.toLowerCase(),
          en: s.en, zh: s.zh,
          sentenceType: s.sentenceType,
          tense: s.tense, scenario: s.scenario, cefr: s.cefr,
          source: "ai", aiModel: gen.model, status: "draft",
        });
        existing.add(s.en.toLowerCase());
        added++;
      }
      if (added >= need) break;
      // 不足：带提示重试一次（仅一次，控 token）
    }
    return added;
  }

  /** 测试辅助：重置运行时状态 */
  __resetForTest(): void {
    this.lastGenAt.clear();
    this.inflight.clear();
    this.chain = Promise.resolve();
    this.chainTailAt = 0;
  }
}
