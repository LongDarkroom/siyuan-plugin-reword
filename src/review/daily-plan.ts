/**
 * REword · 每日记忆计划（2026-09-12 新增）
 * ------------------------------------------------------------------
 * 概念区分：
 *   - 书源 dailyNewLimit：管新词「入队节奏」（别一次挤爆队列）——保持不变；
 *   - 每日记忆计划：管每天要完成的「任务量」（复习 N + 新词 M），可打卡、可结转。
 *
 * 软目标模式（拍板确认）：到期词多于目标时，按优先级取前 N 进「今日计划」，
 * 其余标为「超额自选」但**不隐藏**（防遗忘）。
 *
 * 存储：hiword-daily-plan.json（PersistentStore，与 review-sources 同模式）。
 * 历史保留 90 天（打卡连续天数 / 工作台达标统计）。
 */

import { localDateKey } from "./review-source.ts";

export interface DailyPlanConfig {
  /** 每日复习目标（默认 20） */
  reviewTarget: number;
  /** 每日新词目标（默认 5） */
  newTarget: number;
  /** 结转上限比例（昨日未完成滚入今日 ≤ 目标 × ratio，默认 0.5） */
  carryCapRatio: number;
}

export const DEFAULT_DAILY_PLAN_CONFIG: DailyPlanConfig = {
  reviewTarget: 20,
  newTarget: 5,
  carryCapRatio: 0.5,
};

export interface DailyPlan {
  /** YYYY-MM-DD 本地日期 */
  date: string;
  /** 今日复习应做数（= min(到期数, 目标) + 结转） */
  reviewTarget: number;
  /** 今日新词应学数 */
  newTarget: number;
  reviewDone: number;
  newDone: number;
  /** 昨日结转量（已计入 reviewTarget） */
  carriedOver: number;
  /** 生成计划时的到期词全集数（用于展示"超额 N 词"） */
  dueTotal: number;
}

const DAY_MS = 86_400_000;
const HISTORY_KEEP_DAYS = 90;

/**
 * 计算今日计划（纯函数，可单测）。
 * @param cfg    计划配置
 * @param dueNow 当前到期词全集数（getDueQueue 全集长度）
 * @param yesterday 昨日计划（可 null）
 * @param now    时间戳
 */
export function computeTodayPlan(
  cfg: DailyPlanConfig,
  dueNow: number,
  yesterday: DailyPlan | null,
  now: number = Date.now()
): DailyPlan {
  // 昨日未完成（复习部分）结转，封顶 carryCap
  let carriedOver = 0;
  if (yesterday && yesterday.date) {
    const yDay = Date.parse(yesterday.date + "T00:00:00");
    // 仅"昨天"结转（前天以前不再滚，防雪崩）
    if (!Number.isNaN(yDay) && now - yDay <= 1.5 * DAY_MS) {
      const undone = Math.max(0, yesterday.reviewTarget - yesterday.reviewDone);
      carriedOver = Math.min(undone, Math.round(cfg.reviewTarget * cfg.carryCapRatio));
    }
  }
  const reviewTarget = Math.min(dueNow, cfg.reviewTarget) + carriedOver;
  return {
    date: localDateKey(now),
    reviewTarget,
    newTarget: cfg.newTarget,
    reviewDone: 0,
    newDone: 0,
    carriedOver,
    dueTotal: dueNow,
  };
}

/** 计划完成度 */
export function planProgress(p: DailyPlan): { done: number; total: number; pct: number; allDone: boolean } {
  const done = p.reviewDone + p.newDone;
  const total = p.reviewTarget + p.newTarget;
  return {
    done,
    total,
    pct: total <= 0 ? 100 : Math.min(100, Math.round((done / total) * 100)),
    allDone: total > 0 && done >= total,
  };
}

interface DailyPlanStoreData {
  today: DailyPlan | null;
  history: DailyPlan[];
  config: DailyPlanConfig;
}

export class DailyPlanStore {
  private data: DailyPlanStoreData = {
    today: null,
    history: [],
    config: { ...DEFAULT_DAILY_PLAN_CONFIG },
  };
  private loaded = false;
  private onChange?: () => void | Promise<void>;

  constructor(onChange?: () => void | Promise<void>) {
    this.onChange = onChange;
  }

  load(raw: unknown): void {
    const r = raw && typeof raw === "object" ? raw as any : {};
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : d);
    this.data = {
      today: r.today && typeof r.today === "object" ? {
        date: String(r.today.date || ""),
        reviewTarget: num(r.today.reviewTarget, 0),
        newTarget: num(r.today.newTarget, 5),
        reviewDone: num(r.today.reviewDone, 0),
        newDone: num(r.today.newDone, 0),
        carriedOver: num(r.today.carriedOver, 0),
        dueTotal: num(r.today.dueTotal, 0),
      } : null,
      history: Array.isArray(r.history) ? r.history.filter((h: any) => h && typeof h.date === "string").slice(-HISTORY_KEEP_DAYS) : [],
      config: {
        reviewTarget: num(r.config?.reviewTarget, DEFAULT_DAILY_PLAN_CONFIG.reviewTarget),
        newTarget: num(r.config?.newTarget, DEFAULT_DAILY_PLAN_CONFIG.newTarget),
        carryCapRatio: Number.isFinite(Number(r.config?.carryCapRatio)) ? Math.min(1, Math.max(0, Number(r.config.carryCapRatio))) : DEFAULT_DAILY_PLAN_CONFIG.carryCapRatio,
      },
    };
    this.loaded = true;
  }

  export(): DailyPlanStoreData {
    return JSON.parse(JSON.stringify(this.data));
  }

  private async persist(): Promise<void> {
    if (!this.loaded) return;
    await this.onChange?.();
  }

  config(): DailyPlanConfig {
    return { ...this.data.config };
  }

  async setConfig(patch: Partial<DailyPlanConfig>): Promise<void> {
    Object.assign(this.data.config, patch);
    await this.persist();
  }

  today(): DailyPlan | null {
    return this.data.today;
  }

  history(): DailyPlan[] {
    return [...this.data.history];
  }

  /**
   * 确保今天是新计划（跨天：把昨天归档进 history 并重算）。
   * @param dueNow 当前到期词全集数
   */
  async ensureToday(dueNow: number, now: number = Date.now()): Promise<DailyPlan> {
    const key = localDateKey(now);
    if (this.data.today && this.data.today.date === key) return this.data.today;
    // 归档昨天
    if (this.data.today) {
      this.data.history.push(this.data.today);
      if (this.data.history.length > HISTORY_KEEP_DAYS) {
        this.data.history.splice(0, this.data.history.length - HISTORY_KEEP_DAYS);
      }
    }
    const yesterday = this.data.history.length ? this.data.history[this.data.history.length - 1] : null;
    this.data.today = computeTodayPlan(this.data.config, dueNow, yesterday, now);
    await this.persist();
    return this.data.today;
  }

  /** 复习完成计数 +1（计划内词评分时调用；封顶不超目标，UI 口径干净） */
  async markReviewDone(n = 1): Promise<void> {
    if (!this.data.today) return;
    this.data.today.reviewDone = Math.min(this.data.today.reviewTarget, this.data.today.reviewDone + n);
    await this.persist();
  }

  /** 新词学习计数 +1（首次学习/书源释放首次学；封顶同上） */
  async markNewDone(n = 1): Promise<void> {
    if (!this.data.today) return;
    this.data.today.newDone = Math.min(this.data.today.newTarget, this.data.today.newDone + n);
    await this.persist();
  }

  /** 连续达标天数（history + 今日，从今天往回数 allDone 的连续段） */
  streak(now: number = Date.now()): number {
    const doneKeys = new Set<string>();
    for (const h of this.data.history) {
      const pr = planProgress(h);
      if (pr.allDone) doneKeys.add(h.date);
    }
    if (this.data.today) {
      const pr = planProgress(this.data.today);
      if (pr.allDone) doneKeys.add(this.data.today.date);
    }
    const cur = new Date(now);
    cur.setHours(0, 0, 0, 0);
    let cursor = cur.getTime();
    if (!doneKeys.has(localDateKey(cursor))) cursor -= DAY_MS; // 今天没完成不打断昨天
    let streak = 0;
    while (doneKeys.has(localDateKey(cursor))) {
      streak++;
      cursor -= DAY_MS;
    }
    return streak;
  }

  /** 测试辅助 */
  __resetForTest(cfg?: Partial<DailyPlanConfig>): void {
    this.data = { today: null, history: [], config: { ...DEFAULT_DAILY_PLAN_CONFIG, ...cfg } };
    this.loaded = true;
  }
}
