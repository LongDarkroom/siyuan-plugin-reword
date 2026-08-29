/**
 * 阅读统计聚合（A · 阅读统计可视化）
 * ------------------------------------------------------------------
 * 纯函数：输入书架书籍列表，输出概览 / 日历热力 / 连续天数 / 月度分布 / Top 书。
 * 日级时长来自 BookMeta.readingLog（按本地日期分桶，启用后开始填充）；
 * 累计时长来自 readingTimeMs（含历史），二者口径不同，UI 分开展示。
 */

import type { BookMeta, BookStatus } from "./bookshelf-store";

export interface DayStat {
  /** YYYY-MM-DD */
  date: string;
  /** 当天阅读毫秒 */
  ms: number;
}

export interface MonthStat {
  /** YYYY-MM */
  month: string;
  ms: number;
}

export interface TopBook {
  id: string;
  title: string;
  ms: number;
}

/** 统计时间范围（控制热力图跨度） */
export type StatsRange = "7d" | "30d" | "year" | "12m";

export interface ReadingStats {
  totalMs: number;
  bookCount: number;
  statusCounts: Record<BookStatus, number>;
  /** 连续阅读天数（自今天/昨天往前数，含今天） */
  streak: number;
  /** 历史最长连续阅读天数 */
  longestStreak: number;
  /** 时间范围内的逐日（缺天补 0，按时间升序） */
  calendar: DayStat[];
  /** 过去 12 个自然月（含当月）逐月 */
  monthly: MonthStat[];
  /** 阅读时长 Top 8 */
  topBooks: TopBook[];
  avgRating: number;
  ratedCount: number;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** 历史累计时长（含未分桶的老数据），毫秒 */
function totalReadingMs(books: BookMeta[]): number {
  let sum = 0;
  for (const b of books) sum += b.readingTimeMs || 0;
  return sum;
}

/** 把全部书籍的 readingLog 合并成 日期→毫秒 映射 */
function mergeDayMap(books: BookMeta[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of books) {
    const log = b.readingLog;
    if (!log) continue;
    for (const [day, ms] of Object.entries(log)) {
      if (!ms) continue;
      map.set(day, (map.get(day) || 0) + ms);
    }
  }
  return map;
}

/** 连续天数：从今天往前，连续有阅读（ms>0）的天数；今天为 0 则从昨天起算 */
function computeStreak(dayMap: Map<string, number>): number {
  const today = new Date();
  // 若今天无阅读，允许从昨天开始计（避免「今天还没读就断签」的挫败感）
  let cursor = new Date(today);
  if (!dayMap.get(localDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!dayMap.get(localDateKey(cursor))) return 0;
  }
  let streak = 0;
  while (dayMap.get(localDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 历史最长连续阅读天数（扫描所有有记录的天） */
function computeLongestStreak(dayMap: Map<string, number>): number {
  const days = [...dayMap.keys()].filter((d) => dayMap.get(d)).sort();
  if (days.length === 0) return 0;
  let best = 1;
  let cur = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1] + "T00:00:00");
    const curD = new Date(days[i] + "T00:00:00");
    const diff = Math.round((curD.getTime() - prev.getTime()) / 86400000);
    if (diff === 1) cur++;
    else cur = 1;
    if (cur > best) best = cur;
  }
  return best;
}

/** 范围 → 天数 */
function rangeDays(range: StatsRange): number {
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  if (range === "year") {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    return Math.round((now.getTime() - start.getTime()) / 86400000) + 1;
  }
  return 365;
}

/** 生成 [start, end] 闭区间内所有日期键（升序） */
function dateRange(days: number): string[] {
  const out: string[] = [];
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(localDateKey(new Date(d)));
  }
  return out;
}

export function computeReadingStats(books: BookMeta[], range: StatsRange = "12m"): ReadingStats {
  const dayMap = mergeDayMap(books);

  // 日历：按范围
  const calKeys = dateRange(rangeDays(range));
  const calendar: DayStat[] = calKeys.map((date) => ({ date, ms: dayMap.get(date) || 0 }));

  // 月度：过去 12 个自然月
  const monthMap = new Map<string, number>();
  for (const [day, ms] of dayMap) {
    const mk = day.slice(0, 7);
    monthMap.set(mk, (monthMap.get(mk) || 0) + ms);
  }
  const monthly: MonthStat[] = [];
  {
    const cur = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(cur.getFullYear(), cur.getMonth() - i, 1);
      const mk = monthKey(d);
      monthly.push({ month: mk, ms: monthMap.get(mk) || 0 });
    }
  }

  // 状态计数
  const statusCounts: Record<BookStatus, number> = { unread: 0, reading: 0, finished: 0 };
  for (const b of books) statusCounts[b.status ?? "unread"]++;

  // Top 书
  const topBooks: TopBook[] = books
    .filter((b) => (b.readingTimeMs || 0) > 0)
    .map((b) => ({ id: b.id, title: b.title, ms: b.readingTimeMs || 0 }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 8);

  // 评分
  let ratingSum = 0;
  let ratedCount = 0;
  for (const b of books) {
    if (b.rating && b.rating > 0) {
      ratingSum += b.rating;
      ratedCount++;
    }
  }

  return {
    totalMs: totalReadingMs(books),
    bookCount: books.length,
    statusCounts,
    streak: computeStreak(dayMap),
    longestStreak: computeLongestStreak(dayMap),
    calendar,
    monthly,
    topBooks,
    avgRating: ratedCount ? ratingSum / ratedCount : 0,
    ratedCount,
  };
}

/** 时长格式化（中文，紧凑） */
export function fmtDuration(ms: number): string {
  if (!ms || ms < 60000) return "0m";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}

/** 热力图配色等级：0=无，1~4 递增（返回 css 颜色） */
export function heatColor(ms: number): string {
  if (!ms || ms <= 0) return "var(--b3-theme-background-light, rgba(0,0,0,0.06))";
  if (ms < 15 * 60000) return "hsl(250, 62%, 90%)";
  if (ms < 30 * 60000) return "hsl(250, 65%, 78%)";
  if (ms < 60 * 60000) return "hsl(250, 70%, 62%)";
  return "hsl(250, 48%, 44%)";
}
