/**
 * REword · 工作台（聚合仪表盘，2026-09-11 P10）
 * ------------------------------------------------------------------
 * 组合栏第一个 Tab（默认首屏），GitHub Profile 风格的学习数据总览：
 *   ① 统计卡行（今日待复习 / 连续学习 / 本周已复习 / 词库总量）
 *   ② 学习热力图（阅读 + 复习合并计时，紫色五级，复用 reader/stats heatColor）
 *   ③ 引用块（思源 .bq 灰底风）「现在该复习」到期 Top 3
 *   ④ 超级块双栏：功能入口（纯导航）+ 词库速览（掌握度分布）
 *
 * 设计语言：全部颜色走 --b3-* 变量（自动跟随思源明暗主题）；
 * 交互为 MVP 纯导航（卡片点击经 focusFeatureDock 跳对应面板）。
 *
 * 数据口径说明：
 * - 复习模块无按日时长历史（WordRecord 仅 lastReview 单时间戳），
 *   热力图复习贡献按「当日被复习词数 × 40s」折算（近期可回溯，越久远越失真）；
 * - 连续天数字段直接复用 computeReadingStats 的 streak（口径 = 阅读日历）。
 *
 * 依赖注入：`import type RewordPlugin` 仅类型引用（构建时擦除），
 * 无运行时循环依赖；被访问的 plugin 方法在 index.ts 侧标注 @internal。
 */
import type RewordPlugin from "../index.ts";
import { t } from "../i18n/index.ts";
import { getDueQueue } from "../review/scheduler.ts";
import { computeReadingStats, fmtDuration } from "../reader/stats.ts";
import { READER_FEATURE_ID } from "../reader/reader-dock.ts";
import type { BookMeta } from "../reader/bookshelf-store.ts";
import type { WordRecord } from "../types.ts";
import { focusFeatureDock } from "../dock/dock-layout.ts";

export const DASHBOARD_FEATURE_ID = "dashboard";

/** 复习时长折算权重：秒 / 词（仅热力图颜色深浅用，tooltip 拆开显示真实项） */
const REVIEW_SEC_PER_WORD = 40;
/** 热力图范围：周数 */
const HEATMAP_WEEKS = 26;
const DAY_MS = 86_400_000;

/** 工作台数据快照（index.ts getDashboardSnapshot 产出） */
export interface DashboardSnapshot {
  metrics: { dueToday: number; dueCount: number; active: number; overdue: number; weekReviewed: number; retention: number };
  /** 词库全量单词 */
  words: WordRecord[];
  /** 复习候选（status=active） */
  candidates: WordRecord[];
  /** 阅读书架全部书籍元数据 */
  books: BookMeta[];
}

/** 工作台图标 = 本插件 SVG sprite 的 symbol id（经 addIcons 注册，见 index.ts）。
 *  必须用 id 而非内联 svg：布局管理器与 fixStandaloneDockIcons 都按
 *  <use xlink:href="#id"> 引用，内联串会渲染成乱码。 */
export const DASHBOARD_ICON = "iconREwordDashboard";

// ============ 样式（一次注入；全部走 --b3-* 变量） ============

let styleInjected = false;

/** 首次渲染前注入工作台样式（幂等） */
function ensureDashboardStyles(): void {
  if (styleInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.id = "hiword-dashboard-style";
  style.textContent = DASHBOARD_CSS;
  document.head.appendChild(style);
  styleInjected = true;
}

const DASHBOARD_CSS = `
.hiword-dash { padding: 4px 2px 24px; }
.hiword-dash-card { border: 1px solid var(--b3-border-color); border-radius: 6px; background: var(--b3-theme-background); cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.hiword-dash-card:hover { border-color: var(--b3-theme-primary-lighter, rgba(53,117,240,.38)); box-shadow: 0 2px 8px rgba(0,0,0,.05); }
.hiword-dash-stats { display: flex; gap: 10px; margin: 10px 0 14px; }
.hiword-dash-stats .hiword-dash-card { flex: 1; padding: 10px 12px; min-width: 0; }
.hiword-dash-stat-label { font-size: 12px; color: var(--b3-theme-on-surface-light); }
.hiword-dash-stat-num { font-size: 24px; font-weight: 700; line-height: 1.4; color: var(--b3-theme-on-background); }
.hiword-dash-stat-num .hiword-dash-unit { font-size: 12px; font-weight: 400; color: var(--b3-theme-on-surface-light); margin-left: 3px; }
.hiword-dash-stat-num.is-accent { color: var(--b3-theme-primary); }
.hiword-dash-stat-num.is-fire { color: var(--b3-theme-error); }
.hiword-dash-stat-trend { font-size: 11px; color: var(--b3-theme-on-surface-light); }

.hiword-dash-panel { border: 1px solid var(--b3-border-color); border-radius: 6px; padding: 12px 14px; margin: 0 0 14px; background: var(--b3-theme-background); }
.hiword-dash-panel-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; display: flex; align-items: baseline; gap: 8px; }
.hiword-dash-panel-title .hiword-dash-sub { font-size: 12px; font-weight: 400; color: var(--b3-theme-on-surface-light); }
.hiword-dash-heatmap { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 10px); gap: 3px; margin: 6px 0 4px; overflow-x: auto; padding-bottom: 4px; }
.hiword-dash-hm-cell { width: 10px; height: 10px; border-radius: 2.5px; background: var(--b3-theme-surface-lighter, rgba(0,0,0,.04)); flex: none; }
.hiword-dash-hm-cell.is-today { outline: 1.5px solid var(--b3-theme-primary); outline-offset: 1px; }
.hiword-dash-hm-legend { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--b3-theme-on-surface-light); justify-content: flex-end; }
.hiword-dash-hm-legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

/* 引用块风（思源 .bq 灰底） */
.hiword-dash-bq { background-color: var(--b3-blockquote-color, var(--b3-theme-surface)); border-radius: 4px; padding: 10px 12px; margin: 0 0 14px; }
.hiword-dash-bq-title { font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; font-size: 14px; }
.hiword-dash-pill { background: var(--b3-theme-error); color: #fff; border-radius: 10px; font-size: 11px; font-weight: 500; padding: 0 8px; line-height: 18px; }
.hiword-dash-bq-list { list-style: none; margin: 0; padding: 0; }
.hiword-dash-bq-item { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 4px; font-size: 13px; cursor: pointer; }
.hiword-dash-bq-item:hover { background: var(--b3-list-hover, rgba(0,0,0,.04)); }
.hiword-dash-bq-word { font-family: var(--b3-font-family-code, ui-monospace, Menlo, monospace); font-size: .875em; background: var(--b3-protyle-inline-code-background, rgba(175,184,193,.18)); color: var(--b3-protyle-inline-code-color, #d23f31); border-radius: 3px; padding: 1px 5px; font-weight: 600; }
.hiword-dash-bq-def { color: var(--b3-theme-on-surface-light); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hiword-dash-due { font-size: 11px; color: var(--b3-theme-error); flex: none; }
.hiword-dash-due.is-today { color: var(--b3-theme-warning); }
.hiword-dash-bq-foot { margin-top: 8px; display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--b3-theme-on-surface-light); }
.hiword-dash-btn { margin-left: auto; border: none; background: var(--b3-theme-primary); color: var(--b3-theme-on-primary, #fff); border-radius: 4px; padding: 5px 14px; font-size: 13px; cursor: pointer; }
.hiword-dash-btn:hover { opacity: .9; }
.hiword-dash-kbd { font-family: var(--b3-font-family-code, ui-monospace, Menlo, monospace); font-size: 11px; background: var(--b3-theme-surface); border: 1px solid var(--b3-border-color); border-bottom-width: 2px; border-radius: 4px; padding: 0 6px; color: var(--b3-theme-on-surface); }

/* 超级块双栏 */
.hiword-dash-super { border: 1px solid var(--b3-border-color); border-radius: 6px; display: flex; margin: 0; overflow: hidden; background: var(--b3-theme-background); }
.hiword-dash-col { flex: 1; padding: 10px 12px; min-width: 0; }
.hiword-dash-col + .hiword-dash-col { border-left: 1px solid var(--b3-border-color); }
.hiword-dash-col-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
.hiword-dash-feat { list-style: none; margin: 0; padding: 0; }
.hiword-dash-feat-item { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 4px; font-size: 13px; cursor: pointer; }
.hiword-dash-feat-item:hover { background: var(--b3-list-hover, rgba(0,0,0,.04)); }
.hiword-dash-feat-dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.hiword-dash-feat-name { flex: 1; }
.hiword-dash-feat-meta { font-size: 11px; color: var(--b3-theme-on-surface-light); }
.hiword-dash-feat-chev { color: var(--b3-theme-on-surface-light); font-size: 12px; }
table.hiword-dash-table { width: 100%; border-collapse: collapse; font-size: 13px; }
table.hiword-dash-table th, table.hiword-dash-table td { border-bottom: 1px solid var(--b3-border-color); padding: 5px 6px; text-align: left; }
table.hiword-dash-table th { color: var(--b3-theme-on-surface-light); font-weight: 600; font-size: 12px; }
table.hiword-dash-table tr:last-child td { border-bottom: none; }
table.hiword-dash-table td.is-num { font-family: var(--b3-font-family-code, ui-monospace, Menlo, monospace); text-align: right; }
.hiword-dash-tag { color: var(--b3-theme-primary); background: var(--b3-theme-primary-lightest, rgba(53,117,240,.12)); border-radius: 3px; padding: 1px 6px; font-size: 12px; }

/* 移动端窄屏：统计卡 2×2、双栏改单栏 */
@media (max-width: 520px) {
  .hiword-dash-stats { flex-wrap: wrap; }
  .hiword-dash-stats .hiword-dash-card { flex: 1 1 46%; }
  .hiword-dash-super { flex-direction: column; }
  .hiword-dash-col + .hiword-dash-col { border-left: none; border-top: 1px solid var(--b3-border-color); }
}
`;

// ============ 工具 ============

/** 本地日期 key（YYYY-MM-DD），与 reader/stats 的口径一致 */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** HTML 转义（防词库内容注入） */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ============ 渲染 ============

/**
 * 渲染工作台面板（renderFeatureInto / refreshActivePanel 分发入口）。
 * 打开时现算数据，无常驻监听，无同步 I/O。
 */
export function renderDashboardPanel(p: RewordPlugin, dockElement: HTMLElement): void {
  ensureDashboardStyles();
  const contentEl = dockElement.querySelector("#hiword-dock-content") as HTMLElement | null;
  if (!contentEl) return;
  const snap = p.getDashboardSnapshot();
  if (!snap) {
    contentEl.innerHTML = `<div class="hiword-empty">${t("插件尚未就绪")}</div>`;
    return;
  }
  contentEl.innerHTML = buildDashboardHtml(snap);
  bindDashboardEvents(contentEl, p);
}

function buildDashboardHtml(snap: DashboardSnapshot): string {
  const now = Date.now();

  // ---- 阅读统计（现成接口：日历 / streak / 状态计数）----
  const stats = computeReadingStats(snap.books, "12m");

  // ---- 复习按日折算（lastReview 单时间戳近似，见文件头说明）----
  const reviewCountByDay = new Map<string, number>();
  for (const w of snap.words) {
    if (!w.lastReview) continue;
    const ts = Date.parse(w.lastReview);
    if (Number.isNaN(ts)) continue;
    const key = localDateKey(new Date(ts));
    reviewCountByDay.set(key, (reviewCountByDay.get(key) || 0) + 1);
  }

  // ---- 词库本周新增 ----
  const weekAgo = now - 7 * DAY_MS;
  const weekNewWords = snap.words.filter((w) => {
    const ts = Date.parse(w.created);
    return !Number.isNaN(ts) && ts >= weekAgo;
  }).length;

  // ---- ① 统计卡行 ----
  const html = `
  <div class="hiword-dash">
    <div class="hiword-dash-stats">
      <div class="hiword-dash-card" data-goto="review">
        <div class="hiword-dash-stat-label">${t("今日待复习")}</div>
        <div class="hiword-dash-stat-num is-accent">${snap.metrics.dueCount}<span class="hiword-dash-unit">${t("个")}</span></div>
        <div class="hiword-dash-stat-trend">${snap.metrics.overdue > 0 ? `<strong>${t("{n} 个逾期", { n: snap.metrics.overdue })}</strong>` : t("暂无逾期")}</div>
      </div>
      <div class="hiword-dash-card" data-goto="reader">
        <div class="hiword-dash-stat-label">${t("连续学习")}</div>
        <div class="hiword-dash-stat-num is-fire">${stats.streak}<span class="hiword-dash-unit">${t("天")} 🔥</span></div>
        <div class="hiword-dash-stat-trend">${t("最深 {n} 天", { n: stats.longestStreak })}</div>
      </div>
      <div class="hiword-dash-card" data-goto="review">
        <div class="hiword-dash-stat-label">${t("本周已复习")}</div>
        <div class="hiword-dash-stat-num">${snap.metrics.weekReviewed}<span class="hiword-dash-unit">${t("词")}</span></div>
        <div class="hiword-dash-stat-trend">${t("估计保留率 {n}%", { n: snap.metrics.retention })}</div>
      </div>
      <div class="hiword-dash-card" data-goto="vocab">
        <div class="hiword-dash-stat-label">${t("词库总量")}</div>
        <div class="hiword-dash-stat-num">${snap.words.length}<span class="hiword-dash-unit">${t("词")}</span></div>
        <div class="hiword-dash-stat-trend">${t("本周 +{n} 新词", { n: weekNewWords })}</div>
      </div>
    </div>
    ${buildHeatmapHtml(stats.calendar, reviewCountByDay, stats)}
    ${buildReviewBqHtml(snap, now)}
    ${buildSuperHtml(snap, stats, now)}
  </div>`;
  return html;
}

// ============ ② 热力图（阅读 + 复习合并计时） ============

function buildHeatmapHtml(
  calendar: { date: string; ms: number }[],
  reviewCountByDay: Map<string, number>,
  stats: ReturnType<typeof computeReadingStats>
): string {
  const byDay = new Map(calendar.map((d) => [d.date, d.ms]));
  const cells: string[] = [];
  const todayKey = localDateKey(new Date());

  // 起点：HEATMAP_WEEKS 周前的那一周的周一
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (HEATMAP_WEEKS * 7 - 1) * DAY_MS);
  const startDow = (start.getDay() + 6) % 7; // 周一=0
  for (let i = 0; i < startDow; i++) {
    cells.push(`<i class="hiword-dash-hm-cell" style="visibility:hidden"></i>`);
  }

  let totalReadMs = 0;
  let totalReview = 0;
  for (let d = 0; d < HEATMAP_WEEKS * 7; d++) {
    const date = new Date(start.getTime() + d * DAY_MS);
    if (date.getTime() > today.getTime()) break; // 不渲染未来
    const key = localDateKey(date);
    const readMs = byDay.get(key) || 0;
    const reviewN = reviewCountByDay.get(key) || 0;
    totalReadMs += readMs;
    totalReview += reviewN;
    const mergedMs = readMs + reviewN * REVIEW_SEC_PER_WORD * 1000;
    const bg = heatColorSafe(mergedMs);
    const isToday = key === todayKey;
    const tip = reviewN > 0
      ? t("{m} 月 {d} 日 · 阅读 {read} · 复习 {n} 词", {
          m: date.getMonth() + 1,
          d: date.getDate(),
          read: fmtDuration(readMs),
          n: reviewN,
        })
      : t("{m} 月 {d} 日 · 阅读 {read}", { m: date.getMonth() + 1, d: date.getDate(), read: fmtDuration(readMs) });
    cells.push(
      `<i class="hiword-dash-hm-cell${isToday ? " is-today" : ""}" style="background:${bg}" title="${esc(tip)}"></i>`
    );
  }

  return `
  <div class="hiword-dash-panel">
    <div class="hiword-dash-panel-title">${t("学习热力图")}
      <span class="hiword-dash-sub">${t("阅读 + 复习 · 近 {n} 周", { n: HEATMAP_WEEKS })}</span>
      <span class="hiword-dash-sub" style="margin-left:auto">${t("合计 {read} · 复习 {n} 词", { read: fmtDuration(totalReadMs), n: totalReview })} · ${t("最深连续 {n} 天", { n: stats.longestStreak })}</span>
    </div>
    <div class="hiword-dash-heatmap">${cells.join("")}</div>
    <div class="hiword-dash-hm-legend">${t("少")}
      <i style="background:var(--b3-theme-surface-lighter,rgba(0,0,0,.04))"></i>
      <i style="background:hsl(250,62%,90%)"></i>
      <i style="background:hsl(250,65%,78%)"></i>
      <i style="background:hsl(250,70%,62%)"></i>
      <i style="background:hsl(250,48%,44%)"></i>
    ${t("多")}</div>
  </div>`;
}

/** 复用阅读统计的五级紫色配色（保持与阅读统计面板一致的视觉口径） */
function heatColorSafe(ms: number): string {
  if (!ms || ms <= 0) return "var(--b3-theme-surface-lighter, rgba(0,0,0,0.04))";
  if (ms < 15 * 60000) return "hsl(250, 62%, 90%)";
  if (ms < 30 * 60000) return "hsl(250, 65%, 78%)";
  if (ms < 60 * 60000) return "hsl(250, 70%, 62%)";
  return "hsl(250, 48%, 44%)";
}

// ============ ③ 引用块：现在该复习 ============

function buildReviewBqHtml(snap: DashboardSnapshot, now: number): string {
  const queue = getDueQueue(snap.candidates, { limit: 3 });
  const sod = new Date();
  sod.setHours(0, 0, 0, 0);
  const items = queue.map((w) => {
    const due = w.due ? Date.parse(w.due) : NaN;
    let dueText: string;
    let cls = "";
    if (Number.isNaN(due)) {
      dueText = t("立即复习");
    } else if (due < sod.getTime()) {
      dueText = t("逾期 {n} 天", { n: Math.max(1, Math.floor((now - due) / DAY_MS)) });
    } else {
      dueText = t("今天到期");
      cls = " is-today";
    }
    const def = w.preferredDefinitions?.length ? w.preferredDefinitions[0] : w.meaning;
    return `<li class="hiword-dash-bq-item" data-goto="review">
      <span class="hiword-dash-bq-word">${esc(w.word)}</span>
      <span class="hiword-dash-bq-def">${esc(def)}</span>
      <span class="hiword-dash-due${cls}">${dueText}</span>
    </li>`;
  });

  const remaining = Math.max(0, snap.metrics.dueCount - queue.length);
  return `
  <div class="hiword-dash-bq">
    <div class="hiword-dash-bq-title">${t("现在该复习")}
      <span class="hiword-dash-pill">${snap.metrics.dueCount}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--b3-theme-on-surface-light)">${t("按到期时间排序")}</span>
    </div>
    ${items.length
      ? `<ul class="hiword-dash-bq-list">${items.join("")}</ul>`
      : `<div style="font-size:13px;color:var(--b3-theme-on-surface-light)">${t("没有到期的单词，休息一下吧 🎉")}</div>`}
    <div class="hiword-dash-bq-foot">
      <span>${remaining > 0 ? t("还有 {n} 个排队中", { n: remaining }) : t("全部在列")}</span>
      <button class="hiword-dash-btn" data-goto="review">${t("去复习")}</button>
    </div>
  </div>`;
}

// ============ ④ 超级块双栏：功能入口 + 词库速览 ============

const FEATURE_COLORS: Record<string, string> = {
  vocab: "var(--b3-theme-primary)",
  review: "var(--b3-theme-error)",
  [READER_FEATURE_ID]: "var(--b3-theme-secondary, #08d19d)",
  ai: "var(--b3-theme-warning, #d29922)",
  annotations: "#db61a2",
  dict: "var(--b3-theme-on-surface-light)",
};

function buildSuperHtml(snap: DashboardSnapshot, stats: ReturnType<typeof computeReadingStats>, now: number): string {
  const metaById: Record<string, string> = {
    vocab: t("{n} 词", { n: snap.words.length }),
    review: t("{n} 待复习", { n: snap.metrics.dueCount }),
    [READER_FEATURE_ID]: t("在读 {n} 本 · 本周 {time}", { n: stats.statusCounts.reading, time: fmtDuration(weekReadingMs(stats)) }),
    ai: "",
    annotations: "",
    dict: "",
  };
  const features: { id: string; name: string }[] = [
    { id: "vocab", name: t("词库") },
    { id: "dict", name: t("查词典") },
    { id: "annotations", name: t("微阅批注") },
    { id: "ai", name: t("AI 精读") },
    { id: "review", name: t("复习") },
    { id: READER_FEATURE_ID, name: t("阅读器") },
  ];
  const featItems = features
    .map((f) => {
      const meta = metaById[f.id] || "";
      return `<li class="hiword-dash-feat-item" data-goto="${f.id}">
        <span class="hiword-dash-feat-dot" style="background:${FEATURE_COLORS[f.id] || "var(--b3-theme-on-surface-light)"}"></span>
        <span class="hiword-dash-feat-name">${f.name}</span>
        ${meta ? `<span class="hiword-dash-feat-meta">${meta}</span>` : ""}
        <span class="hiword-dash-feat-chev">›</span>
      </li>`;
    })
    .join("");

  // 掌握度分布（mastery 0~5 → 生词 / 认识 / 熟悉 / 已掌握）
  const buckets = { newWord: 0, known: 0, familiar: 0, mastered: 0 };
  for (const w of snap.words) {
    const m = w.mastery || 0;
    if (m >= 5) buckets.mastered++;
    else if (m >= 4) buckets.familiar++;
    else if (m >= 2) buckets.known++;
    else buckets.newWord++;
  }
  const total = snap.words.length || 1;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  const rows: [string, number][] = [
    [t("已掌握"), buckets.mastered],
    [t("熟悉"), buckets.familiar],
    [t("认识"), buckets.known],
    [t("生词"), buckets.newWord],
  ];
  const table = rows
    .map(
      ([name, n]) => `<tr>
        <td><span class="hiword-dash-tag">${name}</span></td>
        <td class="is-num">${n}</td>
        <td class="is-num">${pct(n)}</td>
      </tr>`
    )
    .join("");

  const weekRead = fmtDuration(weekReadingMs(stats));
  return `
  <div class="hiword-dash-super">
    <div class="hiword-dash-col">
      <div class="hiword-dash-col-title">${t("功能入口")}
        <span style="font-size:11px;font-weight:400;color:var(--b3-theme-on-surface-light)">${t("点击跳转对应面板")}</span>
      </div>
      <ul class="hiword-dash-feat">${featItems}</ul>
    </div>
    <div class="hiword-dash-col">
      <div class="hiword-dash-col-title">${t("词库速览")}</div>
      <table class="hiword-dash-table">
        <thead><tr><th>${t("掌握度")}</th><th style="text-align:right">${t("词数")}</th><th style="text-align:right">${t("占比")}</th></tr></thead>
        <tbody>${table}</tbody>
      </table>
      <div style="margin-top:8px;font-size:12px;color:var(--b3-theme-on-surface-light)">
        ${t("本周阅读 {time}", { time: weekRead })} · <em>${t("继续加油")}</em>
      </div>
    </div>
  </div>`;
}

/** 近 7 天阅读毫秒合计（口径 = 阅读日历） */
function weekReadingMs(stats: ReturnType<typeof computeReadingStats>): number {
  const last7 = stats.calendar.slice(-7);
  return last7.reduce((sum, d) => sum + d.ms, 0);
}

// ============ 事件绑定（纯导航） ============

function bindDashboardEvents(contentEl: HTMLElement, p: RewordPlugin): void {
  contentEl.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = (el as HTMLElement).dataset.goto;
      if (target) focusFeatureDock(p, target);
    });
  });
}
