/**
 * REword · 工作台（聚合仪表盘）
 * ------------------------------------------------------------------
 * 组合栏第一个 Tab（默认首屏），学习数据总览。信息顺序按「行动优先」排：
 *   ① 状态带（今日待复习 / 连续学习 / 词库总量 + 去复习主按钮）
 *   ② 现在该复习（唯一需要用户动手的模块，提到数据之前）
 *   ③ 学习热力图（主视觉，阅读 + 复习合并计时，四档范围可切）
 *   ④ 阅读数据区：指标条 + 近 12 个月分布 + 阅读时长 Top
 *   ⑤ 复习数据区：近 7 天复习量 + 星级分布 + 易忘词 Top
 *   ⑥ 功能入口 + 词库速览
 *
 * 2026-09-12 方案 B 重排（视觉与骨架）：
 *   - 4 张等大 Hero 卡 → 1 条状态带（surface 浅底、无边框），去掉「本周已复习」「估计保留率」
 *     两处与下方重复的口径；「连续阅读 / 最长连续」与状态带同值，一并不再重复渲染。
 *   - 6 张带边框指标卡 → 1 条无边框指标条；零值降权（is-zero，样式见 .hiword-dash-metric-val）。
 *     整格不渲染的只有两处：「平均评分」（无评分时）与「墨迹」（0 笔时）——
 *     其余指标 0 也照常显示，因为 0 本身是有效信息（读了 0 本 ≠ 数据缺失）。
 *     （E8：原文档写「无数据的指标直接不渲染」，与实现不符，此处改为与实现一致。）
 *   - 热力图：默认 12 周（原 26 周会溢出侧栏），四档范围切换，补月份轴；空格子由
 *     #e0e0e0 降到 6% 透明且不挂 tooltip（原「2025-10 · 0m」提示即为空格子上的噪音）。
 *   - 图表：柱状图补基线，空月份/空日压成 3px 淡条且不挂 tooltip，峰值柱顶标数值。
 *   - 「现在该复习」：去掉每行重复的红色「逾期 N 天」，逾期语义移到行左色条 + 标题行汇总；
 *     释义只取首选义项第一条（firstSense），不再把「1. … 2. … 3. …」整串塞进一行。
 *   - 星级分布 5 行条 → 1 条 5 段堆叠；易忘词并列为通栏卡片。
 *   - 分栏统一走 .hiword-dash-cols（auto-fit minmax(260px,1fr)）：窄栏自动单列、
 *     主区页签里打开才铺双栏，一份代码两种宽度都成立。
 *
 * 设计语言：全部颜色走 --b3-* 与 --hw-* 变量（自动跟随思源明暗主题）；
 *   热力图色阶统一由 reader/stats.ts 的 heatColor() 提供（主色叠 alpha 派生，单一真源，
 *   原实现硬编码 hsl(250,…) 紫、与主色 #3575f0 蓝不同色相）；星级/到期色原用
 *   --b3-theme-warning，该变量在思源内置主题（daylight / midnight）与 app CSS 中均未定义，
 *   恒吃硬编码兜底值，改为 --b3-theme-secondary（内置定义 #ff9200）。
 *
 * 2026-09-12 硬伤修复（依据《工作台硬伤调查报告-20260912》D1–D7 / E1–E8）：
 *   - D1/D2/D3：复习按日数据改为**单一真源** src/review/review-history.ts
 *     （事件级 reviewEvents 优先，事件窗口外回落 lastReview）。热力图、近 7 天柱状、
 *     卡片标题、复习面板数据统计 Tab 四处共用同一份聚合，不再各算各的；
 *     历史格子不再随后续复习改写，同日多次复习正确计数。
 *   - D4：「今日待复习」改用 dueToday（今天 24:00 前到期），与标签字面一致；
 *     原先误用 dueCount（此刻已到期），今天稍晚到期的词不计入。
 *   - D5：「连续学习」= 阅读日 ∪ 复习日（只复习没读书也算学习）。并集只在本文件算，
 *     不改 reader/stats.ts，阅读统计面板仍是纯阅读口径。
 *   - D6：阅读标注统计并入 Apple Pencil 墨迹（hiword-ink.json 走独立存储），
 *     与阅读器「我的标记」抽屉的合并口径对齐；字形补 kind==="ink" → ✎ 分支。
 *   - D7：「估计保留率」的显示门槛与数值同源（active 候选 > 0），
 *     不再出现「候选清空 → 保留率 100%」的假象。
 *
 * 2026-09-12 热力图第二轮（用户截图反馈：格子只占卡片左半、右半边整片空白）：
 *   - 根因：每档写死一个格子边长上限（40 / 24 / 18 / 16px）。正方形 + 星期维固定 7，
 *     列数少的档（7 天 2 列、4 周 5 列）永远摊不满 → 实测填充率 9% / 14% / 28% / 76%。
 *   - 改为两种取向 + 按容器宽摊满（上限只作超宽卡片兜底，正常宽度不生效）：
 *       · block（7 天 / 4 周）：行 = 周次、列 = 星期（固定 7 列）+ 左侧日期槽；
 *       · strip（12 周 / 今年）：列 = 周、行 = 星期（固定 7 行）+ 底部月份轴；
 *     短档在 strip 形态下摊满会得到 7 行 × 数百 px 的巨砖墙（7 天档实算 3300px 高），
 *     故必须换取向而不是单纯放大上限。
 *   - 今天圆环被裁：格子用 outline（offset 1px + 1.5px = 溢出 2.5px），而滚动容器
 *     `overflow-x: auto` 挂在网格上、右侧零内边距 → 今天恒为最后一格（最右列），
 *     右边框整条被裁。改为网格外套 .hiword-dash-hm-scroll（padding 3px 3px 4px），
 *     并把月份轴一并移进去（顺带修掉「今年档横向滚动时轴不跟动」）。
 *
 * 数据口径说明：
 * - 复习按日数据 = 复习**次数**（事件级）；事件窗口外的旧日子回落为「每词 1 次」的近似，
 *   单位一律记作「次」（回落日的同日多次会少计，属已知近似）；
 * - 热力图复习贡献按 REVIEW_SEC_PER_WORD 折算时长（仅影响颜色深浅，tooltip 分项显示真实值）；
 * - 连续学习天数 = 阅读日 ∪ 复习日，「最深」同为该并集的历史最长连续；
 * - 热力图范围只影响 ③ 的渲染窗口，不改变任何其它口径；范围选择存在内容容器的
 *   dataset 上（按实例），组合栏 / 独立 Dock / 主区页签三处互不串扰；
 * - 估计保留率仅在存在 active 候选时渲染（否则「没有候选」会被误读成「记忆牢固」）。
 *
 * 依赖注入：`import type RewordPlugin` 仅类型引用（构建时擦除），
 * 无运行时循环依赖；被访问的 plugin 方法在 index.ts 侧标注 @internal。
 */
import type RewordPlugin from "../index.ts";
import { t } from "../i18n/index.ts";
import { getDueQueue } from "../review/scheduler.ts";
import { countByMastery } from "../review/star-filter.ts";
import { computeDayStreak, startOfDay } from "../review/review-history.ts";
import { computeReadingStats, fmtDuration, heatColor, mergeDayMap } from "../reader/stats.ts";
import { READER_FEATURE_ID } from "../reader/reader-dock.ts";
import type { BookMeta } from "../reader/bookshelf-store.ts";
import type { WordRecord } from "../types.ts";
import {
  ANNOTATION_STYLES,
  isPureHighlight,
  normalizeAnnotationStyle,
  type AnnotationItem,
} from "../annotation/annotation-store.ts";
import { focusFeatureDock } from "../dock/dock-layout.ts";

export const DASHBOARD_FEATURE_ID = "dashboard";

/** 复习时长折算权重：秒 / 词（仅热力图颜色深浅用，tooltip 拆开显示真实项） */
const REVIEW_SEC_PER_WORD = 40;
const DAY_MS = 86_400_000;
/** 阅读时长 Top 展示条数 */
const TOP_BOOKS = 5;
/** 易忘词展示条数 */
const FORGET_TOP = 5;

/** 热力图取向。格子是正方形、星期维固定 7，所以「摊满容器宽」能否成立只取决于列数：
 *  - block（7 天 / 4 周）：行 = 周次、列 = 星期（固定 7 列）+ 左侧日期槽。列数足够多。
 *  - strip（12 周 / 今年）：列 = 周、行 = 星期（固定 7 行）+ 底部月份轴。
 *  ⚠️ 7 天在 strip 形态下只有 2 列、4 周只有 5 列，摊满会把格子放大到「容器宽 / 列数」
 *  → 7 行 × 数百 px 的巨砖墙（实算 7 天档会变成 3300px 高）。故短档必须换取向。
 *  2026-09-12（第二轮）：原先每档写死一个边长上限（40 / 24 / 18 / 16px），
 *  在 ≈1000px 宽的卡片里实测只填满 9% / 14% / 28% / 76%，右半边整片空白 → 已改为摊满。 */
type HeatRange = "7d" | "4w" | "12w" | "year";
const HEAT_RANGES: { id: HeatRange; label: string; days: number; mode: "block" | "strip" }[] = [
  { id: "7d", label: "7 天", days: 7, mode: "block" },
  { id: "4w", label: "4 周", days: 28, mode: "block" },
  { id: "12w", label: "12 周", days: 84, mode: "strip" },
  { id: "year", label: "今年", days: 0, mode: "strip" },
];
/** 默认范围档（全新的内容容器用这个值） */
const HEAT_RANGE_DEFAULT: HeatRange = "12w";
const HEAT_RANGE_IDS: readonly string[] = HEAT_RANGES.map((r) => r.id);

/**
 * 读取内容容器当前的热力图范围档。
 * 范围存在**内容容器的 dataset** 上，而不是模块级 `let` —— 组合栏 / 独立 Dock /
 * 主区页签三处同时打开时，模块级变量会被三处共享，切一处会串改其余两处。
 */
function readHeatRange(contentEl: HTMLElement): HeatRange {
  const v = contentEl.dataset.heatRange;
  return v && HEAT_RANGE_IDS.includes(v) ? (v as HeatRange) : HEAT_RANGE_DEFAULT;
}

/** 热力图格子间距（px）。正方形边长 = clamp(7px,
 *  (容器宽 − 内边距 − 日期槽 − (列数−1)×间距) / 列数, 兜底上限)，
 *  整条算式在 CSS 里由 cqw 完成（见 DASHBOARD_CSS 的 .hiword-dash-hm-wrap），
 *  JS 只负责把列数（--hm-cols）、额外扣减（--hm-extra）与兜底上限（--hm-max）内联进 wrap。
 *  ⚠️ 「容器宽」= 100cqw = 卡片内容盒宽；hm-extra 必须把滚动容器内边距算进去，
 *  否则网格会溢出几 px、把兜底的横向滚动条激活。 */
const HM_GAP = 3;

/** 格子边长上限：**只为超宽卡片兜底**，正常宽度下不生效 —— 不生效才摊得满。
 *  block 档列数固定 7、可用宽更大，故上限更宽。 */
const HM_CELL_MAX_BLOCK = 140;
const HM_CELL_MAX_STRIP = 72;
/** block 档左侧日期槽宽（px）。日期形如「9/6」，10px 字号下 32px 够放。 */
const HM_ROWLAB_PX = 32;
/** 滚动容器横向内边距合计（3 + 3）+ 1px 亚像素余量。 */
const HM_SCROLL_PAD = 7;

/** Apple Pencil 墨迹在快照里的投影（只留展示所需字段）。
 *  ⚠️ 不搬 `points` / `path`：一条笔触可能带数百个采样点，快照每渲染一次都会重建。 */
export interface InkStrokeView {
  id: string;
  bookId: string;
  /** 0-based 页序（与 InkStroke.pageIndex 一致；跳转时需 +1 转 1-based） */
  pageIndex: number;
  /** 创建时间戳（ms）。与 AnnotationItem.createdAt（ISO 字符串）比较前需归一化。 */
  createdAt: number;
  color: string;
}

/** 工作台数据快照（index.ts getDashboardSnapshot 产出） */
export interface DashboardSnapshot {
  metrics: { dueToday: number; dueCount: number; active: number; overdue: number; weekReviewed: number; retention: number };
  /** 词库全量单词 */
  words: WordRecord[];
  /** 复习候选（status=active） */
  candidates: WordRecord[];
  /** 阅读书架全部书籍元数据 */
  books: BookMeta[];
  /** 复习按日次数（"YYYY-MM-DD" → 次数）。单一真源，见 review/review-history.ts。
   *  热力图、近 7 天柱状、卡片标题共用它，保证同一屏内数字必然自洽。 */
  reviewByDay: Record<string, number>;
  /** 阅读批注（bookId 存在者；软删已由 store 在 getAll() 内过滤，按 createdAt 倒序） */
  readingAnnotations: AnnotationItem[];
  /** Apple Pencil 墨迹（独立存储 hiword-ink.json；展示时与批注合并统计） */
  inkStrokes: InkStrokeView[];
  /** 批注标签字典（id → 显示名 + 颜色）。
   *  ⚠️ 标签名是**用户数据**（存于 hiword-annotation-labels.json），不是界面文案，
   *  渲染时绝不能裹 t()，否则用户自定义标签会被当成待翻译的界面文案。 */
  labelDict: { id: string; name: string; color: string }[];
}

/** 工作台图标 = 本插件 SVG sprite 的 symbol id（经 addIcons 注册，见 index.ts）。
 *  必须用 id 而非内联 svg：布局管理器与 fixStandaloneDockIcons 都按
 *  <use xlink:href="#id"> 引用，内联串会渲染成乱码。 */
export const DASHBOARD_ICON = "iconREwordDashboard";

// ============ 样式（一次注入；全部走 --b3-* 变量） ============

let styleInjected = false;
const DASHBOARD_STYLE_ID = "hiword-dashboard-style";

/**
 * 首次渲染前注入工作台样式（幂等）。
 * 除了「没有就注入」，还负责「内容过期就覆盖」—— 插件热重载（或开发期改样式后重载）
 * 时页面上会残留上一轮注入的 <style>：只靠模块级 `styleInjected` 要么在新模块实例里
 * 再插一份，要么更糟 —— 旧规则仍生效、改了样式却看不到变化（F6）。
 */
function ensureDashboardStyles(): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(DASHBOARD_STYLE_ID);
  if (existing) {
    if (existing.textContent !== DASHBOARD_CSS) existing.textContent = DASHBOARD_CSS;
    styleInjected = true;
    return;
  }
  if (styleInjected) return;
  const style = document.createElement("style");
  style.id = DASHBOARD_STYLE_ID;
  style.textContent = DASHBOARD_CSS;
  document.head.appendChild(style);
  styleInjected = true;
}

const DASHBOARD_CSS = `
.hiword-dash { padding: 4px 2px 24px; }
.hiword-dash .hiword-dash-btn { cursor: pointer; }

/* ---- 分组小标签（替代原「标题 + 长横线」分区头） ---- */
.hiword-dash-sec { font-size: 11px; letter-spacing: .06em; color: var(--b3-theme-on-surface-light); margin: 18px 2px 8px; }

/* ---- 自动分栏：窄栏单列、宽栏双列 ---- */
.hiword-dash-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-bottom: 12px; }

/* ---- 状态带（Hero）：浅底无边框 ---- */
.hiword-dash-hero { display: flex; flex-wrap: wrap; align-items: stretch; gap: 10px 16px; background: var(--b3-theme-surface); border-radius: 8px; padding: 12px 14px; margin: 6px 0 12px; }
.hiword-dash-hero-cell { flex: 1 1 auto; min-width: 56px; cursor: pointer; }
.hiword-dash-hero-cell + .hiword-dash-hero-cell { border-left: 1px solid var(--b3-border-color); padding-left: 16px; }
.hiword-dash-hero-label { font-size: 11px; color: var(--b3-theme-on-surface-light); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hiword-dash-hero-num { font-size: 22px; font-weight: 700; line-height: 1.3; color: var(--b3-theme-on-background); font-variant-numeric: tabular-nums; }
.hiword-dash-hero-num .u { font-size: 11px; font-weight: 400; color: var(--b3-theme-on-surface-light); margin-left: 3px; }
.hiword-dash-hero-num.is-accent { color: var(--b3-theme-primary); }
.hiword-dash-hero-num.is-zero { color: var(--b3-theme-on-surface-light); }
.hiword-dash-hero-sub { font-size: 11px; color: var(--b3-theme-on-surface-light); }
.hiword-dash-hero-sub.is-alert { color: var(--b3-theme-error); }
.hiword-dash-hero > .hiword-dash-btn { align-self: center; flex: none; }

/* ---- 卡片（唯一的分组容器） ---- */
.hiword-dash-card { border: 1px solid var(--b3-border-color); border-radius: 8px; padding: 12px 14px; background: var(--b3-theme-background); min-width: 0; }
.hiword-dash-card-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; display: flex; align-items: baseline; flex-wrap: wrap; row-gap: 3px; gap: 8px; }
.hiword-dash-card-title .hiword-dash-sub { font-size: 11px; font-weight: 400; color: var(--b3-theme-on-surface-light); }
.hiword-dash-card-title .is-right { margin-left: auto; white-space: nowrap; }

/* ---- 指标条（无边框浅底，自动换行） ---- */
.hiword-dash-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(76px, 1fr)); gap: 10px; background: var(--b3-theme-surface); border-radius: 8px; padding: 11px 14px; margin-bottom: 12px; }
.hiword-dash-metric { min-width: 0; }
.hiword-dash-metric-val { font-size: 16px; font-weight: 700; line-height: 1.35; color: var(--b3-theme-on-background); font-variant-numeric: tabular-nums; }
/* 零值降权（文件头声明的口径，此前只落在 hero 上、指标条漏了） */
.hiword-dash-metric-val.is-zero { color: var(--b3-theme-on-surface-light); }
.hiword-dash-metric-val .u { font-size: 11px; font-weight: 400; color: var(--b3-theme-on-surface-light); margin-left: 2px; }
.hiword-dash-metric-label { font-size: 11px; color: var(--b3-theme-on-surface-light); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---- 热力图 ---- */
.hiword-dash-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.hiword-dash-chip { font-size: 11px; line-height: 18px; padding: 1px 9px; border-radius: 999px; border: 1px solid var(--b3-border-color); background: transparent; color: var(--b3-theme-on-surface-light); cursor: pointer; }
.hiword-dash-chip:hover { color: var(--b3-theme-on-surface); border-color: var(--b3-theme-primary-lighter, rgba(53,117,240,.38)); }
.hiword-dash-chip.is-on { background: var(--b3-theme-primary-lightest, rgba(53,117,240,.12)); border-color: transparent; color: var(--b3-theme-primary); }
/* 热力图尺度：格子边长由容器实测宽度反推（cqw 容器查询，零 JS、零 ResizeObserver），
   两种取向都**按宽摊满**，--hm-max 只在超宽卡片上兜底。
   ⚠️ container-type 必须挂在卡片上——hm-wrap 是 width:max-content，挂在它上面会与 cqw
   形成循环依赖（wrap 宽度取决于 cell，cell 又取决于 wrap 宽度）。 */
.hiword-dash-card.is-heat { container-type: inline-size; }
.hiword-dash-hm-wrap {
  width: max-content; max-width: 100%;
  --hm-gap: ${HM_GAP}px;
  --hm-extra: 7px; /* 滚动容器内边距（+ block 档的日期槽，由 JS 覆写） */
  --hm-max: 72px;  /* 兜底上限，由 JS 覆写 */
  --cell: 14px;    /* 兜底：cqw 不被支持时整条 clamp 失效，回落到这里 */
  --cell: clamp(7px, calc((100cqw - var(--hm-extra) - (var(--hm-cols) - 1) * var(--hm-gap)) / var(--hm-cols)), var(--hm-max));
}
/* 滚动容器：只为「今年档 + 窄容器」兜底（列数 × 7px 下限会超出可用宽）。
   ⚠️ 它的内边距是给「今天」圆环留的溢出空间 —— 原先 overflow-x:auto 直接挂在网格上、
   右侧零内边距，把今天的右边框整条裁掉（今天永远是最后一格，恒落在最右列）。 */
.hiword-dash-hm-scroll { overflow-x: auto; padding: 3px 3px 4px; }
.hiword-dash-heatmap { display: grid; gap: var(--hm-gap); }
/* strip（12 周 / 今年）：列 = 周、行 = 星期（固定 7 行） */
.hiword-dash-heatmap.is-strip { grid-auto-flow: column; grid-template-rows: repeat(7, var(--cell)); grid-auto-columns: var(--cell); }
/* block（7 天 / 4 周）：行 = 周次、列 = 星期（固定 7 列）+ 左侧日期槽 */
.hiword-dash-heatmap.is-block { display: flex; flex-direction: column; }
.hiword-dash-hm-line { display: flex; align-items: center; gap: var(--hm-gap); }
.hiword-dash-hm-lab { flex: 0 0 ${HM_ROWLAB_PX}px; width: ${HM_ROWLAB_PX}px; font-size: 10px; color: var(--b3-theme-on-surface-light); text-align: right; font-variant-numeric: tabular-nums; }
.hiword-dash-hm-wd { flex: 0 0 var(--cell); width: var(--cell); font-size: 10px; color: var(--b3-theme-on-surface-light); text-align: center; }
.hiword-dash-hm-cell { width: 100%; height: 100%; border-radius: 20%; }
.hiword-dash-heatmap.is-block .hiword-dash-hm-cell { flex: 0 0 var(--cell); width: var(--cell); height: var(--cell); }
.hiword-dash-hm-cell.is-today { outline: 1.5px solid var(--b3-theme-primary); outline-offset: 1px; }
/* 月份轴：标签按「列坐标」绝对定位。原先 space-between 三标签不去重，
   7 天档三枚「9月」挤在 39px 内互相压印。 */
.hiword-dash-hm-axis { position: relative; height: 13px; font-size: 10px; color: var(--b3-theme-on-surface-light); margin-top: 6px; }
.hiword-dash-hm-axis span { position: absolute; top: 0; white-space: nowrap; }
/* 图例：并入卡片标题行右侧（原先贴卡片右缘，与网格相距 238px，视觉上完全脱节） */
.hiword-dash-hm-legend { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--b3-theme-on-surface-light); margin-left: 10px; }
.hiword-dash-hm-legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

/* ---- 柱状图（统一带基线） ---- */
.hiword-dash-bars { display: flex; align-items: flex-end; gap: 5px; height: 68px; border-bottom: 1px solid var(--b3-border-color); }
.hiword-dash-bars.is-week { height: 58px; }
.hiword-dash-bar-col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 3px; height: 100%; min-width: 0; }
.hiword-dash-bar-track { width: 100%; flex: 1; display: flex; align-items: flex-end; }
.hiword-dash-bar { width: 100%; border-radius: 3px 3px 0 0; background: var(--b3-theme-primary); opacity: .34; }
.hiword-dash-bar.is-peak { opacity: 1; }
.hiword-dash-bar.is-empty { height: 3px; border-radius: 2px; opacity: .14; }
.hiword-dash-bar-n { font-size: 10px; color: var(--b3-theme-on-surface-light); text-align: center; font-variant-numeric: tabular-nums; height: 12px; line-height: 12px; }
.hiword-dash-bar-x { font-size: 10px; color: var(--b3-theme-on-surface-light); text-align: center; font-variant-numeric: tabular-nums; }
.hiword-dash-axis { display: flex; justify-content: space-between; font-size: 10px; color: var(--b3-theme-on-surface-light); margin-top: 6px; }

/* ---- 阅读时长 Top ---- */
.hiword-dash-rank { display: flex; flex-direction: column; gap: 8px; }
.hiword-dash-rank-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 2px 4px; border-radius: 4px; cursor: pointer; }
.hiword-dash-rank-row:hover { background: var(--b3-list-hover, rgba(0,0,0,.04)); }
.hiword-dash-rank-i { width: 18px; height: 18px; border-radius: 50%; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface-light); font-size: 11px; display: flex; align-items: center; justify-content: center; }
.hiword-dash-rank-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--b3-theme-on-background); }
.hiword-dash-rank-track { height: 4px; border-radius: 2px; background: var(--b3-theme-surface-lighter, rgba(0,0,0,.06)); margin-top: 4px; overflow: hidden; }
.hiword-dash-rank-bar { display: block; height: 100%; border-radius: 2px; background: var(--b3-theme-primary); opacity: .5; min-width: 3px; }
.hiword-dash-rank-v { font-size: 11px; color: var(--b3-theme-on-surface-light); font-variant-numeric: tabular-nums; }

/* ---- 星级分布（单条堆叠） ---- */
.hiword-dash-star { display: flex; height: 9px; border-radius: 5px; overflow: hidden; background: var(--b3-theme-surface-lighter, rgba(0,0,0,.06)); }
.hiword-dash-star-seg { display: block; height: 100%; background: var(--b3-theme-secondary, #ff9200); }
.hiword-dash-star-legend { display: flex; justify-content: space-between; font-size: 10px; color: var(--b3-theme-on-surface-light); margin-top: 7px; }
.hiword-dash-star-foot { font-size: 11px; color: var(--b3-theme-on-surface-light); margin-top: 10px; }

/* ---- 现在该复习（引用块风） ---- */
.hiword-dash-bq { background-color: var(--b3-blockquote-color, var(--b3-theme-surface)); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
.hiword-dash-bq-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.hiword-dash-bq-title { font-weight: 600; font-size: 13px; }
.hiword-dash-pill { background: var(--b3-theme-error); color: var(--b3-theme-on-error, #fff); border-radius: 10px; font-size: 11px; font-weight: 500; padding: 0 8px; line-height: 18px; }
.hiword-dash-bq-od { font-size: 11px; color: var(--b3-theme-error); }
.hiword-dash-bq-list { list-style: none; margin: 0; padding: 0; }
.hiword-dash-bq-item { display: flex; align-items: center; gap: 9px; padding: 6px 4px; border-radius: 4px; font-size: 13px; cursor: pointer; }
.hiword-dash-bq-item:hover { background: var(--b3-list-hover, rgba(0,0,0,.04)); }
.hiword-dash-bq-flag { width: 2px; height: 14px; border-radius: 1px; background: var(--b3-theme-error); flex: none; }
.hiword-dash-bq-flag.is-today { background: var(--b3-theme-secondary, #ff9200); }
.hiword-dash-bq-flag.is-quiet { visibility: hidden; }
.hiword-dash-bq-word { font-family: var(--b3-font-family-code, ui-monospace, Menlo, monospace); font-size: .875em; background: var(--b3-protyle-inline-code-background, rgba(175,184,193,.18)); color: var(--b3-protyle-inline-code-color, #d23f31); border-radius: 3px; padding: 1px 5px; font-weight: 600; flex: none; }
.hiword-dash-bq-def { color: var(--b3-theme-on-surface-light); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hiword-dash-due { font-size: 11px; color: var(--b3-theme-on-surface-light); flex: none; }
.hiword-dash-btn { margin-left: auto; border: none; background: var(--b3-theme-primary); color: var(--b3-theme-on-primary, #fff); border-radius: 6px; padding: 5px 16px; font-size: 13px; cursor: pointer; }
.hiword-dash-btn:hover { opacity: .9; }

/* ---- 易忘词 ---- */
.hiword-dash-forget { display: flex; flex-direction: column; }
.hiword-dash-forget-row { display: flex; align-items: center; gap: 9px; padding: 5px 4px; border-radius: 4px; font-size: 13px; cursor: pointer; }
.hiword-dash-forget-row:hover { background: var(--b3-list-hover, rgba(0,0,0,.04)); }
.hiword-dash-forget-w { font-family: var(--b3-font-family-code, ui-monospace, Menlo, monospace); font-size: .875em; background: var(--b3-protyle-inline-code-background, rgba(175,184,193,.18)); color: var(--b3-protyle-inline-code-color, #d23f31); border-radius: 3px; padding: 1px 5px; font-weight: 600; flex: none; }
.hiword-dash-forget-m { color: var(--b3-theme-on-surface-light); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hiword-dash-forget-n { font-size: 11px; color: var(--b3-theme-error); flex: none; }

/* ---- 功能入口 / 词库速览 ---- */
.hiword-dash-feat { list-style: none; margin: 0; padding: 0; }
.hiword-dash-feat-item { display: flex; align-items: center; gap: 8px; padding: 5px 4px; border-radius: 4px; font-size: 13px; cursor: pointer; }
.hiword-dash-feat-item:hover { background: var(--b3-list-hover, rgba(0,0,0,.04)); }
.hiword-dash-feat-dot { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.hiword-dash-feat-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hiword-dash-feat-meta { font-size: 11px; color: var(--b3-theme-on-surface-light); flex: none; }
.hiword-dash-feat-chev { color: var(--b3-theme-on-surface-light); font-size: 12px; flex: none; }
table.hiword-dash-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
table.hiword-dash-table th, table.hiword-dash-table td { padding: 4px 4px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
table.hiword-dash-table th { color: var(--b3-theme-on-surface-light); font-weight: 600; font-size: 11px; }
table.hiword-dash-table td.is-num { text-align: right; font-variant-numeric: tabular-nums; color: var(--b3-theme-on-surface-light); }
.hiword-dash-tag { color: var(--b3-theme-primary); background: var(--b3-theme-primary-lightest, rgba(53,117,240,.12)); border-radius: 3px; padding: 1px 6px; font-size: 11px; }

/* ---- 阅读标注（只做概览 + 最近 5 条 + 入口，不做第二个「微阅批注」管理面板） ---- */
.hiword-dash-ann-row { display: grid; grid-template-columns: 3px 14px minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 7px 4px; border-radius: 4px; cursor: pointer; }
/* 分隔线走 --b3-border-color：本文件其余全部描边都用它，混用 --hw-* 两套令牌无必要 */
.hiword-dash-ann-row + .hiword-dash-ann-row { border-top: 1px solid var(--b3-border-color); }
.hiword-dash-ann-row:hover { background: var(--b3-list-hover, rgba(0,0,0,.04)); }
.hiword-dash-ann-bar { width: 3px; height: 15px; border-radius: 2px; flex: none; }
.hiword-dash-ann-glyph { font-size: 12px; line-height: 1; text-align: center; color: var(--b3-theme-on-surface-light); }
.hiword-dash-ann-body { min-width: 0; }
.hiword-dash-ann-text { font-size: 12px; color: var(--b3-theme-on-background); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hiword-dash-ann-note { font-size: 11px; color: var(--b3-theme-on-surface-light); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.hiword-dash-ann-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--b3-theme-on-surface-light); flex: none; max-width: 42%; }
.hiword-dash-ann-book { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hiword-dash-ann-all { display: block; width: 100%; margin-top: 8px; border: none; background: transparent; color: var(--b3-theme-primary); font-size: 12px; text-align: center; cursor: pointer; padding: 6px 0; border-radius: 4px; }
.hiword-dash-ann-all:hover { background: var(--b3-theme-primary-lightest, rgba(53,117,240,.12)); }
.hiword-dash-label-chip { font-size: 11px; line-height: 18px; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; background: transparent; }

.hiword-dash-empty { font-size: 12px; color: var(--b3-theme-on-surface-light); padding: 12px; border: 1px dashed var(--b3-border-color); border-radius: 8px; text-align: center; }
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

/**
 * 取首选义项的第一条：词库释义常以「1. 平的；平坦的 2. 清晰的 3. …」整串存储，
 * 整串塞进一行会被截断成流水账。只截到第二义项之前，并去掉条目前的序号。
 * 无序号（如「延长；延伸；使展期」）时原样返回。
 */
function firstSense(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.*?)\s[2-9][.．、]\s/);
  const head = m ? m[1] : flat;
  return head.replace(/^[1-9][.．、]\s*/, "");
}

/** 热力图窗口天数（今年 = 1 月 1 日至今） */
function heatRangeDays(range: HeatRange, today: Date): number {
  const preset = HEAT_RANGES.find((r) => r.id === range);
  if (preset && preset.days > 0) return preset.days;
  const jan1 = new Date(today.getFullYear(), 0, 1);
  return Math.max(7, Math.round((today.getTime() - jan1.getTime()) / DAY_MS) + 1);
}

// ============ 渲染入口 ============

/**
 * 渲染工作台面板（renderFeatureInto / refreshActivePanel 分发入口）。
 * 打开时现算数据，无常驻监听，无同步 I/O。
 */
export function renderDashboardPanel(p: RewordPlugin, dockElement: HTMLElement): void {
  ensureDashboardStyles();
  const contentEl = dockElement.querySelector("#hiword-dock-content") as HTMLElement | null;
  if (!contentEl) return;
  renderDashboardInto(contentEl, p);
}

/** 内容容器级渲染（热力图切范围时复用，避免重新查找 dock 容器） */
function renderDashboardInto(contentEl: HTMLElement, p: RewordPlugin): void {
  const snap = p.getDashboardSnapshot();
  if (!snap) {
    contentEl.innerHTML = `<div class="hiword-empty">${t("插件尚未就绪")}</div>`;
    return;
  }
  contentEl.innerHTML = buildDashboardHtml(snap, readHeatRange(contentEl));
  bindDashboardEvents(contentEl, p);
}

function buildDashboardHtml(snap: DashboardSnapshot, range: HeatRange): string {
  const now = Date.now();

  // ---- 阅读统计（现成接口：日历 / 状态计数）----
  const stats = computeReadingStats(snap.books, "12m");

  // ---- 复习按日次数：单一真源（快照已聚合，见 review/review-history.ts）----
  // 热力图、近 7 天柱状、卡片标题共用这一份，同屏数字必然自洽（修 D1/D2）。
  const reviewCountByDay = new Map<string, number>(Object.entries(snap.reviewByDay));

  // ---- 连续学习 = 阅读日 ∪ 复习日（D5）----
  // 只复习没读书的日子也应算「学习」。并集只算在这里，不动 reader/stats.ts，
  // 所以阅读统计面板的「连续天数」仍是纯阅读口径。
  const studyDays = new Set<string>(reviewCountByDay.keys());
  for (const [day, ms] of mergeDayMap(snap.books)) if (ms > 0) studyDays.add(day);
  const studyStreak = computeDayStreak(studyDays, now);

  // ---- 词库本周新增 ----
  const weekAgo = now - 7 * DAY_MS;
  const weekNewWords = snap.words.filter((w) => {
    const ts = Date.parse(w.created);
    return !Number.isNaN(ts) && ts >= weekAgo;
  }).length;

  return `
  <div class="hiword-dash">
    ${buildHeroHtml(snap, studyStreak, weekNewWords)}
    ${buildReviewBqHtml(snap, now)}
    ${buildHeatmapCard(stats.calendar, reviewCountByDay, range)}
    <div class="hiword-dash-sec">${t("阅读数据")}</div>
    ${buildReadingMetrics(stats)}
    <div class="hiword-dash-cols">
      ${buildMonthsCard(stats)}
      ${buildTopCard(stats)}
    </div>
    ${buildAnnotationSection(snap, now)}
    <div class="hiword-dash-sec">${t("复习数据")}</div>
    <div class="hiword-dash-cols">
      ${buildWeekCard(reviewCountByDay, now)}
      ${buildStarCard(snap)}
    </div>
    ${buildForgetCard(snap)}
    <div class="hiword-dash-cols">${buildFeatureAndVocabCards(snap)}</div>
  </div>`;
}

// ============ ① 状态带 ============

function buildHeroHtml(
  snap: DashboardSnapshot,
  studyStreak: { streak: number; longest: number },
  weekNewWords: number
): string {
  // D4：「今日待复习」= 今天 24:00 前到期的词数（dueToday），与标签字面一致。
  // 原先用 dueCount（此刻已到期），今天稍晚到期的词不计入 → 数字偏小。
  const due = snap.metrics.dueToday;
  const overdue = snap.metrics.overdue;
  const fire = studyStreak.streak > 0 ? " 🔥" : "";
  return `
  <div class="hiword-dash-hero">
    <div class="hiword-dash-hero-cell" data-goto="review">
      <div class="hiword-dash-hero-label">${t("今日待复习")}</div>
      <div class="hiword-dash-hero-num${due === 0 ? " is-zero" : " is-accent"}">${due}<span class="u">${t("个")}</span></div>
      <div class="hiword-dash-hero-sub${overdue > 0 ? " is-alert" : ""}">${overdue > 0 ? t("{n} 个逾期", { n: overdue }) : t("暂无逾期")}</div>
    </div>
    <div class="hiword-dash-hero-cell" data-goto="reader">
      <div class="hiword-dash-hero-label">${t("连续学习")}</div>
      <div class="hiword-dash-hero-num${studyStreak.streak === 0 ? " is-zero" : ""}">${studyStreak.streak}<span class="u">${t("天")}${fire}</span></div>
      <div class="hiword-dash-hero-sub">${t("最深 {n} 天", { n: studyStreak.longest })}</div>
    </div>
    <div class="hiword-dash-hero-cell" data-goto="vocab">
      <div class="hiword-dash-hero-label">${t("词库总量")}</div>
      <div class="hiword-dash-hero-num${snap.words.length === 0 ? " is-zero" : ""}">${snap.words.length}<span class="u">${t("词")}</span></div>
      <div class="hiword-dash-hero-sub">${t("本周 +{n} 新词", { n: weekNewWords })}</div>
    </div>
    <button class="hiword-dash-btn" data-goto="review">${t("去复习")}</button>
  </div>`;
}

// ============ ② 现在该复习 ============

function buildReviewBqHtml(snap: DashboardSnapshot, now: number): string {
  const queue = getDueQueue(snap.candidates, { limit: 3 });
  const sodMs = startOfDay();
  const items = queue.map((w) => {
    const due = w.due ? Date.parse(w.due) : NaN;
    let dueText: string;
    let flag = " is-quiet";
    if (Number.isNaN(due)) {
      dueText = t("立即复习");
      flag = " is-today";
    } else if (due < sodMs) {
      dueText = t("逾期 {n} 天", { n: Math.max(1, Math.floor((now - due) / DAY_MS)) });
      flag = "";
    } else {
      dueText = t("今天到期");
      flag = " is-today";
    }
    const def = firstSense(w.preferredDefinitions?.length ? w.preferredDefinitions[0] : w.meaning || "");
    return `<li class="hiword-dash-bq-item" data-goto="review">
      <span class="hiword-dash-bq-flag${flag}"></span>
      <span class="hiword-dash-bq-word">${esc(w.word)}</span>
      <span class="hiword-dash-bq-def">${esc(def)}</span>
      <span class="hiword-dash-due">${dueText}</span>
    </li>`;
  });

  const overdue = snap.metrics.overdue;
  return `
  <div class="hiword-dash-bq">
    <div class="hiword-dash-bq-head">
      <span class="hiword-dash-bq-title">${t("现在该复习")}</span>
      <span class="hiword-dash-pill">${snap.metrics.dueCount}</span>
      ${overdue > 0 ? `<span class="hiword-dash-bq-od">${t("逾期 {n} 个", { n: overdue })}</span>` : ""}
      <button class="hiword-dash-btn" data-goto="review">${t("去复习")}</button>
    </div>
    ${items.length
      ? `<ul class="hiword-dash-bq-list">${items.join("")}</ul>`
      : `<div style="font-size:13px;color:var(--b3-theme-on-surface-light)">${t("没有到期的单词，休息一下吧 🎉")}</div>`}
  </div>`;
}

// ============ ③ 学习热力图 ============

/** 星期简写（周一…周日）。key 与别处一致，逐条写字面量以便 i18n 扫描能识别。 */
function weekdayShort(date: Date): string {
  const names = [t("周一"), t("周二"), t("周三"), t("周四"), t("周五"), t("周六"), t("周日")];
  return names[(date.getDay() + 6) % 7];
}

/** 单日格子。无数据的日子不挂 title —— 原实现在空格子上会弹「某月某日 · 阅读 0m」。 */
function heatCellHtml(date: Date, readMs: number, reviewN: number, isToday: boolean): string {
  const cls = `hiword-dash-hm-cell${isToday ? " is-today" : ""}`;
  const mergedMs = readMs + reviewN * REVIEW_SEC_PER_WORD * 1000;
  if (mergedMs <= 0) return `<i class="${cls}" style="background:${heatColor(0)}"></i>`;
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const tip = reviewN > 0
    ? t("{m} 月 {d} 日 · 阅读 {read} · 复习 {n} 次", { m, d, read: fmtDuration(readMs), n: reviewN })
    : t("{m} 月 {d} 日 · 阅读 {read}", { m, d, read: fmtDuration(readMs) });
  return `<i class="${cls}" style="background:${heatColor(mergedMs)}" title="${esc(tip)}"></i>`;
}

/** 月份轴（仅 strip 取向需要）。标签按「列坐标」定位（而非 space-between）并去重 ——
 *  原先起止同月时三枚标签会退化成两个/一个，space-between 会把它们等分到错误位置。 */
function buildMonthAxis(cols: number, start: Date, today: Date): string {
  if (cols <= 0) return "";
  const mLabel = (d: Date) => t("{n}月", { n: d.getMonth() + 1 });
  const midCol = Math.max(0, Math.floor((cols - 1) / 2));
  const seen = new Set<string>();
  const spans = [
    { col: 0, text: mLabel(start) },
    { col: midCol, text: mLabel(new Date(start.getTime() + midCol * 7 * DAY_MS)) },
    { col: cols - 1, text: mLabel(today) },
  ]
    .filter((c) => {
      if (c.col < 0) return false;
      // 列数少 → 只留起止两枚（中点会与它们挤在一起）
      if (cols < 8 && c.col !== 0 && c.col !== cols - 1) return false;
      if (seen.has(c.text)) return false;
      seen.add(c.text);
      return true;
    })
    .map((c) => {
      // 末枚标签改为贴右缘：它按 left 定位时会向右溢出（年档格子 ≈22px，比「9月」还窄），
      // 而月份轴现已移进 overflow-x:auto 的滚动容器 → 会凭空长出一条横向滚动条。
      const pos = c.col === cols - 1
        ? "right:0"
        : `left:calc(${c.col} * (var(--cell) + ${HM_GAP}px))`;
      return `<span style="${pos}">${esc(c.text)}</span>`;
    })
    .join("");
  return `<div class="hiword-dash-hm-axis">${spans}</div>`;
}

function buildHeatmapCard(
  calendar: { date: string; ms: number }[],
  reviewCountByDay: Map<string, number>,
  range: HeatRange
): string {
  const today = new Date(startOfDay());
  const todayKey = localDateKey(today);
  const days = heatRangeDays(range, today);
  const start = new Date(today.getTime() - (days - 1) * DAY_MS);
  const byDay = new Map(calendar.map((d) => [d.date, d.ms]));
  const rangeDef = HEAT_RANGES.find((r) => r.id === range);
  const isBlock = rangeDef?.mode === "block";
  const rangeLabel = t(rangeDef?.label || "12 周");

  // 逐日取数一次（时间升序，末位是今天）。两种取向共用同一次遍历，
  // 保证「本范围复习 {n} 次」不会被重复累加、且与格子同源。
  let totalReadMs = 0;
  let totalReview = 0;
  const list = Array.from({ length: days }, (_, d) => {
    const date = new Date(start.getTime() + d * DAY_MS);
    const key = localDateKey(date);
    const readMs = byDay.get(key) || 0;
    const reviewN = reviewCountByDay.get(key) || 0;
    totalReadMs += readMs;
    totalReview += reviewN;
    return { date, key, readMs, reviewN };
  });

  let cols: number;
  let extra: number;
  let grid: string;

  if (isBlock) {
    // 行 = 周次、列 = 星期。窗口恒为 7 的整数倍 → 无占位空格，且同一列在每一行都是同一个
    // 星期（相隔 7 天），故表头只需一份。左侧日期槽给出每行的起始日。
    cols = 7;
    extra = HM_ROWLAB_PX + HM_GAP + HM_SCROLL_PAD;
    const head = list
      .slice(0, 7)
      .map((it) => `<span class="hiword-dash-hm-wd">${esc(weekdayShort(it.date))}</span>`)
      .join("");
    const rows = Array.from({ length: days / 7 }, (_, r) => {
      const slice = list.slice(r * 7, r * 7 + 7);
      const lab = t("{m}/{d}", { m: slice[0].date.getMonth() + 1, d: slice[0].date.getDate() });
      const cells = slice
        .map((it) => heatCellHtml(it.date, it.readMs, it.reviewN, it.key === todayKey))
        .join("");
      return `<div class="hiword-dash-hm-line"><span class="hiword-dash-hm-lab">${esc(lab)}</span>${cells}</div>`;
    }).join("");
    grid = `<div class="hiword-dash-heatmap is-block"><div class="hiword-dash-hm-line is-head"><span class="hiword-dash-hm-lab"></span>${head}</div>${rows}</div>`;
  } else {
    // 列 = 周、行 = 星期。窗口起点不一定是周一 → 首列用不可见格子占位对齐星期。
    const startDow = (start.getDay() + 6) % 7;
    cols = Math.ceil((days + startDow) / 7);
    extra = HM_SCROLL_PAD;
    const blanks = Array.from(
      { length: startDow },
      () => `<i class="hiword-dash-hm-cell" style="visibility:hidden"></i>`
    ).join("");
    const cells = list
      .map((it) => heatCellHtml(it.date, it.readMs, it.reviewN, it.key === todayKey))
      .join("");
    grid = `<div class="hiword-dash-heatmap is-strip">${blanks}${cells}</div>${buildMonthAxis(cols, start, today)}`;
  }

  const emptyHint = totalReadMs === 0 && totalReview === 0
    ? `<div class="hiword-dash-empty" style="margin-top:8px">${t("还没有学习记录，查词或阅读后会点亮这里")}</div>`
    : "";

  const legendColors: [string, number][] = [
    ["var(--b3-theme-on-background)", 0.06],
    ["var(--b3-theme-primary)", 0.18],
    ["var(--b3-theme-primary)", 0.34],
    ["var(--b3-theme-primary)", 0.55],
    ["var(--b3-theme-primary)", 0.85],
  ];
  const legend = `<span class="hiword-dash-hm-legend">${t("少")}${legendColors
    .map(([c, o]) => `<i style="background:${c};opacity:${o}"></i>`)
    .join("")}${t("多")}</span>`;

  return `
  <div class="hiword-dash-card is-heat">
    <div class="hiword-dash-card-title">${t("学习热力图")}
      <span class="hiword-dash-sub">${t("阅读 + 复习")} · ${rangeLabel}</span>
      <span class="hiword-dash-sub is-right">${t("本范围复习 {n} 次", { n: totalReview })}</span>
      ${legend}
    </div>
    <div class="hiword-dash-chips">
      ${HEAT_RANGES.map(
        (r) => `<button class="hiword-dash-chip${r.id === range ? " is-on" : ""}" data-range="${r.id}">${t(r.label)}</button>`
      ).join("")}
    </div>
    <div class="hiword-dash-hm-wrap" style="--hm-cols:${cols};--hm-extra:${extra}px;--hm-max:${isBlock ? HM_CELL_MAX_BLOCK : HM_CELL_MAX_STRIP}px">
      <div class="hiword-dash-hm-scroll">${grid}</div>
    </div>
    ${emptyHint}
  </div>`;
}

// ============ ④ 阅读数据区 ============

/** 零值降权判定：数值型指标为 0 / 0m / 0.0 时降权（与 hero 的 `.is-zero` 口径一致）。
 *  文件头声明了「零值降权」，但此前只落在 hero 上 —— 指标条漏了（E7）。 */
function isZeroMetric(value: string): boolean {
  return /^0(\.0+)?[a-z%]*$/.test(value);
}

/** 指标条渲染（阅读数据区与阅读标注概览共用，保证降权口径一致） */
function renderMetricBar(items: { label: string; value: string; unit?: string }[]): string {
  return `<div class="hiword-dash-metrics">${items
    .map(
      (m) => `<div class="hiword-dash-metric">
        <div class="hiword-dash-metric-val${isZeroMetric(m.value) ? " is-zero" : ""}">${m.value}${m.unit ? `<span class="u">${m.unit}</span>` : ""}</div>
        <div class="hiword-dash-metric-label">${m.label}</div>
      </div>`
    )
    .join("")}</div>`;
}

function buildReadingMetrics(stats: ReturnType<typeof computeReadingStats>): string {
  // 时长指标全屏只保留这一处（2026-09-12 与热力图头部「本范围合计」合并）：
  // 两处原本同源同量（Σ readingTimeMs 与 Σ readingLog 已对齐），并列显示同一个数必被当成
  // bug；此处是全时口径，更适合当汇总指标。热力图头部只留范围复习次数。
  const items: { label: string; value: string; unit?: string }[] = [
    { label: t("累计时长"), value: fmtDuration(stats.totalMs) },
    { label: t("本月阅读"), value: fmtDuration(stats.monthly[stats.monthly.length - 1]?.ms || 0) },
    { label: t("在读"), value: String(stats.statusCounts.reading) },
    { label: t("读完"), value: String(stats.statusCounts.finished) },
  ];
  // 无评分数据时不渲染该格（原实现显示「—」，在卡片里像报错）
  if (stats.ratedCount > 0) {
    items.push({ label: t("平均评分"), value: stats.avgRating.toFixed(1) });
  }
  return renderMetricBar(items);
}

function buildMonthsCard(stats: ReturnType<typeof computeReadingStats>): string {
  const monthly = stats.monthly;
  const maxMonth = Math.max(1, ...monthly.map((m) => m.ms));
  const hasMonth = monthly.some((m) => m.ms > 0);
  const bars = monthly
    .map((m) => {
      const mm = Number(m.month.slice(5, 7));
      const isPeak = m.ms > 0 && m.ms === maxMonth;
      const h = m.ms > 0 ? Math.max(6, Math.round((m.ms / maxMonth) * 100)) : 0;
      if (m.ms <= 0) {
        // 空月份压成 3px 淡条，且不挂 tooltip（原实现在空格子上弹「2025-10 · 0m」）
        return `<div class="hiword-dash-bar-col"><span class="hiword-dash-bar-n"></span>
          <div class="hiword-dash-bar-track"><span class="hiword-dash-bar is-empty"></span></div>
          <span class="hiword-dash-bar-x">${mm}</span></div>`;
      }
      return `<div class="hiword-dash-bar-col" data-goto="${READER_FEATURE_ID}" title="${esc(m.month)} · ${esc(fmtDuration(m.ms))}">
        <span class="hiword-dash-bar-n">${isPeak ? esc(fmtDuration(m.ms)) : ""}</span>
        <div class="hiword-dash-bar-track"><span class="hiword-dash-bar${isPeak ? " is-peak" : ""}" style="height:${h}%"></span></div>
        <span class="hiword-dash-bar-x">${mm}</span>
      </div>`;
    })
    .join("");

  const axis = hasMonth && monthly.length
    ? `<div class="hiword-dash-axis"><span>${esc(monthly[0].month)}</span><span>${esc(monthly[monthly.length - 1].month)}</span></div>`
    : "";

  return `
  <div class="hiword-dash-card">
    <div class="hiword-dash-card-title">${t("近 12 个月分布")}
      <span class="hiword-dash-sub">${t("按阅读时长")}</span>
    </div>
    ${hasMonth ? `<div class="hiword-dash-bars">${bars}</div>${axis}` : `<div class="hiword-dash-empty">${t("还没有阅读记录，开始读一本书吧")}</div>`}
  </div>`;
}

function buildTopCard(stats: ReturnType<typeof computeReadingStats>): string {
  const top = stats.topBooks.slice(0, TOP_BOOKS);
  if (!top.length) {
    return `
  <div class="hiword-dash-card">
    <div class="hiword-dash-card-title">${t("阅读时长 Top {n}", { n: TOP_BOOKS })}</div>
    <div class="hiword-dash-empty">${t("还没有阅读记录，开始读一本书吧")}</div>
  </div>`;
  }
  const maxTop = top[0].ms || 1;
  const rows = top
    .map(
      (b, i) => `<div class="hiword-dash-rank-row" data-goto="${READER_FEATURE_ID}" title="${esc(b.title)}">
        <span class="hiword-dash-rank-i">${i + 1}</span>
        <div style="min-width:0">
          <div class="hiword-dash-rank-t">${esc(b.title)}</div>
          <div class="hiword-dash-rank-track"><span class="hiword-dash-rank-bar" style="width:${Math.max(4, Math.round((b.ms / maxTop) * 100))}%"></span></div>
        </div>
        <span class="hiword-dash-rank-v">${fmtDuration(b.ms)}</span>
      </div>`
    )
    .join("");
  return `
  <div class="hiword-dash-card">
    <div class="hiword-dash-card-title">${t("阅读时长 Top {n}", { n: top.length })}
      <span class="hiword-dash-sub is-right">${t("{n} 本", { n: stats.statusCounts.reading + stats.statusCounts.finished })}</span>
    </div>
    <div class="hiword-dash-rank">${rows}</div>
  </div>`;
}

// ============ ④.5 阅读标注区 ============
// 定位：工作台只做「概览 + 最近 5 条 + 入口」，全量管理仍归「微阅批注」面板
// （那边有搜索 / 三维修排序 / 分组 / 内联编辑 / 删除 / 导出 MD）。
// 数据层零改动：标注已在内存、软删已在 getAll() 过滤、书名可查 snap.books 表。

const ANN_RECENT = 5;
const ANN_TOP_BOOKS = 5;
const ANN_TOP_LABELS = 8;

/** 标注类型字形（与阅读器「我的标记」同一约定，见 ReaderView.annotGlyph）：
 *  墨迹 ✎ / 矩形 ▭ / 带批注 💬 / 其余按线型 ▮ 高亮 ━ 直线 ﹏ 波浪。
 *  墨迹条目来自独立存储（hiword-ink.json），此前本函数缺这一支、注释里的「同一约定」
 *  实际不成立（D6）。 */
function annotGlyph(a: { kind?: string; type?: string; style?: string }): string {
  if (a.kind === "ink") return "✎";
  if (a.kind === "rect") return "▭";
  if (String(a.type || "") === "annotate") return "💬";
  return ANNOTATION_STYLES[normalizeAnnotationStyle(a.style)]?.icon || "▮";
}

/**
 * 标注区一行：把「文本标注（AnnotationItem）」与「墨迹（InkStrokeView）」归一化到同一形状，
 * 合并后统一排序 / 渲染。两者创建时间字段类型不同（ISO 字符串 vs 毫秒数），
 * 必须先归一化再比较 —— 阅读器侧的同款合并直接 `Number(iso)` 会得到 NaN，
 * 排序实际失效（那里是文本标注排在墨迹之后还是之前全看运气）。
 */
interface AnnRow {
  id: string;
  kind: "text" | "ink";
  bookId?: string;
  /** 墨迹的 0-based 页序（跳转时 +1 转 1-based；文本标注不用） */
  pageIndex?: number;
  /** 归一化创建时间戳（ms） */
  ts: number;
  /** 行首色条颜色 */
  color: string;
  glyph: string;
  /** 主行文本（墨迹为「墨迹 · pN」） */
  text: string;
  note: string;
}

/** 创建时间归一化：ISO 字符串 / 毫秒数 → 毫秒数（非法值记 0，排到最后） */
function createdTs(v: string | number | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const ts = Date.parse(v);
  return Number.isNaN(ts) ? 0 : ts;
}

/**
 * 批注正文是 Kramdown（思源原生）：剥掉块引用 / 强调 / 代码 / 属性等记号，
 * 只留纯文本给单行摘要用。不做完整解析，只求「一眼看得懂」。
 */
function plainNote(s: string): string {
  return (s || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")      // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")   // 链接保留文字
    .replace(/^\s*>\s?/gm, "")                 // 块引用
    .replace(/`{1,3}/g, "")                    // 行内 / 围栏代码
    .replace(/(\*\*|__|~~|\*|_)/g, "")         // 强调
    .replace(/^\s*[-*+]\s+/gm, "")             // 列表符号
    .replace(/^\s*#{1,6}\s+/gm, "")            // 标题
    .replace(/\{:[^}]*\}/g, "")                // Kramdown 属性 {: ...}
    .replace(/\s+/g, " ")
    .trim();
}

/** 相对时间（超 30 天回落到具体日期；跨年补上年份，否则去年 8 月看起来像今年） */
function relTime(v: string | number | undefined, now: number): string {
  const ts = createdTs(v);
  if (!ts) return "";
  const diff = now - ts;
  if (diff < 60_000) return t("刚刚");
  if (diff < 3_600_000) return t("{n} 分钟前", { n: Math.floor(diff / 60_000) });
  if (diff < DAY_MS) return t("{n} 小时前", { n: Math.floor(diff / 3_600_000) });
  if (diff < 30 * DAY_MS) return t("{n} 天前", { n: Math.floor(diff / DAY_MS) });
  const d = new Date(ts);
  if (d.getFullYear() !== new Date(now).getFullYear()) {
    return t("{y} 年 {m} 月 {d} 日", { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
  }
  return t("{m} 月 {d} 日", { m: d.getMonth() + 1, d: d.getDate() });
}

function buildAnnotationSection(snap: DashboardSnapshot, now: number): string {
  const anns = snap.readingAnnotations;
  const inks = snap.inkStrokes;
  if (!anns.length && !inks.length) {
    // 空态是用户第一眼看到的东西（hiword-annotations.json / hiword-ink.json 现均为空）——
    // 上轮热力图的教训：空状态没做完，看起来就像坏了。
    return `
    <div class="hiword-dash-sec">${t("阅读标注 · 批注")}</div>
    <div class="hiword-dash-empty">
      <div style="margin-bottom:6px">${t("还没有阅读标注")}</div>
      <div style="font-size:11px;margin-bottom:10px">${t("在阅读器里划选文字即可高亮或批注")}</div>
      <button class="hiword-dash-btn" style="margin:0 auto" data-goto="${READER_FEATURE_ID}">${t("去阅读")}</button>
    </div>`;
  }

  const titleById = new Map(snap.books.map((b) => [b.id, b.title]));

  // ---- 归一化：文本标注 + 墨迹合并成同一形状的行（D6）----
  // 墨迹存在独立文件 hiword-ink.json，此前完全没并入 → 「标注总数」比阅读器
  // 「我的标记」抽屉里看到的条数少。
  const rows: AnnRow[] = [
    ...anns.map((a): AnnRow => ({
      id: a.id,
      kind: "text",
      bookId: a.bookId,
      ts: createdTs(a.createdAt),
      color: a.color || "var(--b3-theme-primary)",
      glyph: annotGlyph(a),
      text: (a.selectedText || a.sentence || "").trim(),
      note: isPureHighlight(a) ? "" : plainNote(a.note || ""),
    })),
    ...inks.map((k): AnnRow => ({
      id: k.id,
      kind: "ink",
      bookId: k.bookId,
      pageIndex: k.pageIndex,
      ts: createdTs(k.createdAt),
      color: k.color || "var(--b3-theme-primary)",
      glyph: annotGlyph({ kind: "ink" }),
      // 墨迹没有文本，主行用「墨迹 · pN」占位（与阅读器「我的标记」同款文案）
      text: t("墨迹 · p{n}", { n: k.pageIndex + 1 }),
      note: "",
    })),
  ].sort((a, b) => b.ts - a.ts);

  const total = rows.length;
  const pureCount = anns.filter((a) => isPureHighlight(a)).length;
  const noteCount = anns.length - pureCount;
  const bookIds = new Set(rows.map((r) => r.bookId).filter((x): x is string => !!x));

  const metrics: { label: string; value: string }[] = [
    { label: t("标注总数"), value: String(total) },
    { label: t("纯高亮"), value: String(pureCount) },
    { label: t("带批注"), value: String(noteCount) },
  ];
  // 墨迹为 0 时不占一格（无数据的指标不渲染，与「平均评分」同口径）
  if (inks.length) metrics.push({ label: t("墨迹"), value: String(inks.length) });
  metrics.push({ label: t("覆盖书目"), value: String(bookIds.size) });
  const metricsHtml = renderMetricBar(metrics);

  // 书籍分布 Top5（文本标注 + 墨迹合计）
  const byBook = new Map<string, number>();
  for (const r of rows) {
    if (!r.bookId) continue;
    byBook.set(r.bookId, (byBook.get(r.bookId) || 0) + 1);
  }
  const bookRank = [...byBook.entries()].sort((a, b) => b[1] - a[1]).slice(0, ANN_TOP_BOOKS);
  const maxBook = bookRank[0]?.[1] || 1;
  const bookRows = bookRank
    .map(([bid, n], i) => {
      const title = titleById.get(bid) || t("未知书籍");
      return `<div class="hiword-dash-rank-row" data-goto="${READER_FEATURE_ID}" title="${esc(title)}">
        <span class="hiword-dash-rank-i">${i + 1}</span>
        <div style="min-width:0">
          <div class="hiword-dash-rank-t">${esc(title)}</div>
          <div class="hiword-dash-rank-track"><span class="hiword-dash-rank-bar" style="width:${Math.max(4, Math.round((n / maxBook) * 100))}%"></span></div>
        </div>
        <span class="hiword-dash-rank-v">${t("{n} 条", { n })}</span>
      </div>`;
    })
    .join("");

  // 标签分布（标签名与颜色均来自用户数据文件，不得 t()；墨迹无标签概念，不参与）
  const byLabel = new Map<string, number>();
  for (const a of anns) for (const l of a.labels || []) byLabel.set(l, (byLabel.get(l) || 0) + 1);
  const labelRank = [...byLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, ANN_TOP_LABELS);
  const colorOf = new Map(snap.labelDict.map((l) => [l.id, l.color]));
  const nameOf = new Map(snap.labelDict.map((l) => [l.id, l.name]));
  const labelChips = labelRank
    .map(([id, n]) => {
      const c = colorOf.get(id) || "var(--b3-theme-on-surface-light)";
      return `<span class="hiword-dash-label-chip" style="color:${c};border-color:${c}">${esc(nameOf.get(id) || id)} ${n}</span>`;
    })
    .join("");

  // 最近标注（rows 已按归一化时间戳倒序）
  const recentRows = rows
    .slice(0, ANN_RECENT)
    .map((r) => {
      const book = titleById.get(r.bookId || "") || "";
      const tip = [r.text, r.note, book].filter(Boolean).join(" · ").slice(0, 200);
      // 墨迹跳转靠 bookId + 页序（不走 annotationStore）；文本标注走统一入口按 id 查库
      const jumpAttrs = r.kind === "ink"
        ? `data-ink-book="${esc(r.bookId || "")}" data-ink-page="${r.pageIndex ?? 0}" data-ink-id="${esc(r.id)}"`
        : `data-ann-jump="${esc(r.id)}"`;
      return `<div class="hiword-dash-ann-row" ${jumpAttrs} title="${esc(tip)}">
        <span class="hiword-dash-ann-bar" style="background:${r.color}"></span>
        <span class="hiword-dash-ann-glyph">${r.glyph}</span>
        <div class="hiword-dash-ann-body">
          <div class="hiword-dash-ann-text">${esc(r.text)}</div>
          ${r.note ? `<div class="hiword-dash-ann-note">${esc(r.note)}</div>` : ""}
        </div>
        <div class="hiword-dash-ann-meta">
          ${book ? `<span class="hiword-dash-ann-book">${esc(book)}</span>` : ""}
          <span>${relTime(r.ts, now)}</span>
        </div>
      </div>`;
    })
    .join("");

  return `
  <div class="hiword-dash-sec">${t("阅读标注 · 批注")}</div>
  ${metricsHtml}
  <div class="hiword-dash-cols">
    <div class="hiword-dash-card">
      <div class="hiword-dash-card-title">${t("书籍分布")}
        <span class="hiword-dash-sub is-right">${t("{n} 本", { n: bookIds.size })}</span>
      </div>
      <div class="hiword-dash-rank">${bookRows}</div>
    </div>
    <div class="hiword-dash-card">
      <div class="hiword-dash-card-title">${t("标签分布")}
        <span class="hiword-dash-sub is-right">${t("{n} 条", { n: labelRank.reduce((s, x) => s + x[1], 0) })}</span>
      </div>
      ${labelRank.length ? `<div class="hiword-dash-chips">${labelChips}</div>` : `<div class="hiword-dash-empty">${t("还没有标签记录")}</div>`}
    </div>
  </div>
  <div class="hiword-dash-card">
    <div class="hiword-dash-card-title">${t("最近标注")}
      <span class="hiword-dash-sub is-right">${t("{n} 条", { n: total })}</span>
    </div>
    <div>${recentRows}</div>
    <button class="hiword-dash-ann-all" data-goto="annotations">${t("查看全部 {n} 条", { n: total })}</button>
  </div>`;
}

// ============ ⑤ 复习数据区 ============

function buildWeekCard(reviewCountByDay: Map<string, number>, now: number): string {
  const sodMs = startOfDay(now);
  const weekNames = [t("周日"), t("周一"), t("周二"), t("周三"), t("周四"), t("周五"), t("周六")];
  let weekMax = 1;
  const vals: { label: string; count: number; today: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = sodMs - i * DAY_MS;
    const count = reviewCountByDay.get(localDateKey(new Date(dayStart))) || 0;
    if (count > weekMax) weekMax = count;
    vals.push({ label: i === 0 ? t("今天") : weekNames[new Date(dayStart).getDay()], count, today: i === 0 });
  }
  // 卡片标题与 7 根柱子同源同窗（今天往前 7 个自然日）：柱子和恒等于这里的合计，
  // 不再出现「标题写一个数、柱子加起来是另一个数」的打架（D1）。
  // 窗口是滚动的近 7 天而非自然周，所以文案写「合计」而不是「本周」。
  const weekSum = vals.reduce((s, v) => s + v.count, 0);
  const bars = vals
    .map((v) => {
      if (v.count <= 0) {
        return `<div class="hiword-dash-bar-col"><span class="hiword-dash-bar-n"></span>
          <div class="hiword-dash-bar-track"><span class="hiword-dash-bar is-empty"></span></div>
          <span class="hiword-dash-bar-x">${esc(v.label)}</span></div>`;
      }
      const h = Math.max(8, Math.round((v.count / weekMax) * 100));
      return `<div class="hiword-dash-bar-col" data-goto="review" title="${esc(v.label)} · ${esc(t("{n} 次", { n: v.count }))}">
        <span class="hiword-dash-bar-n">${v.count}</span>
        <div class="hiword-dash-bar-track"><span class="hiword-dash-bar${v.today ? " is-peak" : ""}" style="height:${h}%"></span></div>
        <span class="hiword-dash-bar-x">${esc(v.label)}</span>
      </div>`;
    })
    .join("");
  return `
  <div class="hiword-dash-card">
    <div class="hiword-dash-card-title">${t("近 7 天复习量")}
      <span class="hiword-dash-sub is-right">${t("合计 {n} 次", { n: weekSum })}</span>
    </div>
    <div class="hiword-dash-bars is-week">${bars}</div>
  </div>`;
}

function buildStarCard(snap: DashboardSnapshot): string {
  // 「估计保留率」的显示门槛必须与数值同源：retention 是 active 候选的遗忘曲线均值，
  // active 为空时恒为 100。原先门槛用「全量有 lastReview 的词数」，于是把复习过的词
  // 全部标熟之后仍显示「估计保留率 100%」—— 那不是保守近似，是把「没有候选」
  // 伪装成「记忆牢固」（D7）。
  const sc = countByMastery(snap.words);
  const levels: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];
  const graded = levels.reduce((a, n) => a + sc[n], 0);
  const opacity: Record<number, number> = { 1: 0.85, 2: 0.62, 3: 0.44, 4: 0.28, 5: 0.16 };
  const segs = levels
    .filter((n) => sc[n] > 0)
    .map((n) => `<span class="hiword-dash-star-seg" style="width:${Math.round((sc[n] / graded) * 100)}%;opacity:${opacity[n]}" title="★${n} · ${esc(t("{n} 词", { n: sc[n] }))}"></span>`)
    .join("");
  const legend = levels
    .map((n) => `<span>★${n} · ${sc[n]}</span>`)
    .join("");
  return `
  <div class="hiword-dash-card">
    <div class="hiword-dash-card-title">${t("星级分布")}
      <span class="hiword-dash-sub is-right">${t("已评级 {n} 词", { n: graded })}</span>
    </div>
    ${graded
      ? `<div class="hiword-dash-star">${segs}</div><div class="hiword-dash-star-legend">${legend}</div>`
      : `<div class="hiword-dash-empty">${t("还没有复习记录")}</div>`}
    ${snap.metrics.active > 0
      ? `<div class="hiword-dash-star-foot">${t("估计保留率 {n}%", { n: snap.metrics.retention })}</div>`
      : ""}
  </div>`;
}

function buildForgetCard(snap: DashboardSnapshot): string {
  const forgetful = [...snap.words]
    .filter((w) => (w.lapse ?? 0) > 0)
    .sort((a, b) => (b.lapse ?? 0) - (a.lapse ?? 0))
    .slice(0, FORGET_TOP);
  const rows = forgetful
    .map(
      (w) => `<div class="hiword-dash-forget-row" data-goto="review">
        <span class="hiword-dash-forget-w">${esc(w.word)}</span>
        <span class="hiword-dash-forget-m">${esc(firstSense(w.meaning || w.preferredDefinitions?.[0] || ""))}</span>
        <span class="hiword-dash-forget-n">${t("忘 {n} 次", { n: w.lapse ?? 0 })}</span>
      </div>`
    )
    .join("");
  return `
  <div class="hiword-dash-card">
    <div class="hiword-dash-card-title">${t("易忘词 Top")}
      <span class="hiword-dash-sub">${t("按遗忘次数排序")}</span>
    </div>
    ${forgetful.length ? `<div class="hiword-dash-forget">${rows}</div>` : `<div class="hiword-dash-empty">${t("还没有遗忘记录，继续保持！")}</div>`}
  </div>`;
}

// ============ ⑥ 功能入口 + 词库速览 ============

/** 功能入口圆点配色。本文件不写字面色值（E1：`annotations` 原为硬编码 `#db61a2`，
 *  是文件头「全部颜色走 --b3-* / --hw-*」唯一的例外，且不跟随明暗主题）。
 *  字面色值只允许出现在 index.less 的设计令牌块里（与 --hw-pos-* 同处）。 */
const FEATURE_COLORS: Record<string, string> = {
  vocab: "var(--b3-theme-primary)",
  review: "var(--b3-theme-error)",
  [READER_FEATURE_ID]: "var(--b3-theme-secondary)",
  ai: "var(--b3-theme-secondary)",
  annotations: "var(--hw-feat-annotations, var(--b3-theme-secondary))",
  dict: "var(--b3-theme-on-surface-light)",
};

/** 最大余额法：把各组计数折算成合计恰为 100 的整数百分比（total ≤ 0 时全 0）。
 *  朴素四舍五入下 1/1/1/0 会得到 33+33+33+0 = 99%，表格视觉上不闭合（E4）。 */
function largestRemainderPercents(counts: readonly number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((n) => (n / total) * 100);
  const out = raw.map(Math.floor);
  let rest = 100 - out.reduce((s, n) => s + n, 0);
  const byFrac = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0 && k < byFrac.length; k++, rest--) out[byFrac[k].i]++;
  return out;
}

/** 功能入口 + 词库速览两张卡。
 *  原函数名 `buildSuperHtml` 与职责不符（既不「super」也读不出是这两张卡），E6 改名。 */
function buildFeatureAndVocabCards(snap: DashboardSnapshot): string {
  const metaById: Record<string, string> = {
    vocab: t("{n} 词", { n: snap.words.length }),
    review: t("{n} 待复习", { n: snap.metrics.dueCount }),
  };
  const features: { id: string; name: string }[] = [
    // 2026-09-12：「复习」面板已更名「学习」（内部含 学习记忆 / 数据统计 / 词库 三个小 Tab），
    // 工作台入口名与面板标题保持一致；「词库」条目保留 —— 它跳转到学习面板的词库 Tab
    // （focusFeatureDock 内部把 vocab 别名重定向到 gotoStudyPane("vocab")）。
    { id: "review", name: t("学习") },
    { id: READER_FEATURE_ID, name: t("阅读器") },
    { id: "vocab", name: t("词库") },
    { id: "dict", name: t("查词典") },
    { id: "annotations", name: t("微阅批注") },
    { id: "ai", name: t("AI 精读") },
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
  const total = snap.words.length;
  const counts: number[] = [buckets.mastered, buckets.familiar, buckets.known, buckets.newWord];
  const pcts = largestRemainderPercents(counts, total);
  const names: string[] = [t("已掌握"), t("熟悉"), t("认识"), t("生词")];
  const table = names
    .map(
      (name, i) => `<tr>
        <td><span class="hiword-dash-tag">${name}</span></td>
        <td class="is-num">${counts[i]}</td>
        <td class="is-num">${pcts[i]}%</td>
      </tr>`
    )
    .join("");

  return `
  <div class="hiword-dash-card">
    <div class="hiword-dash-card-title">${t("功能入口")}
      <span class="hiword-dash-sub">${t("点击跳转对应面板")}</span>
    </div>
    <ul class="hiword-dash-feat">${featItems}</ul>
  </div>
  <div class="hiword-dash-card">
    <div class="hiword-dash-card-title">${t("词库速览")}</div>
    <table class="hiword-dash-table">
      <thead><tr><th>${t("掌握度")}</th><th style="text-align:right">${t("词数")}</th><th style="text-align:right">${t("占比")}</th></tr></thead>
      <tbody>${table}</tbody>
    </table>
  </div>`;
}

// ============ 事件绑定（导航 + 热力图范围） ============

function bindDashboardEvents(contentEl: HTMLElement, p: RewordPlugin): void {
  contentEl.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = (el as HTMLElement).dataset.goto;
      if (target) focusFeatureDock(p, target);
    });
  });
  contentEl.querySelectorAll("[data-ann-jump]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = (el as HTMLElement).dataset.annJump;
      // 统一跳转入口：把整条记录交给 ReaderView，复用其 cfi / page / rect 三分支
      // （旧链只认 cfi，PDF 文本标注无 cfi → 静默失败）
      if (id) p.openAnnotationById(id);
    });
  });
  contentEl.querySelectorAll("[data-ink-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const h = el as HTMLElement;
      const bookId = h.dataset.inkBook;
      if (!bookId) return;
      // 墨迹不在 annotationStore 里（独立 hiword-ink.json），跳转靠 bookId + 0-based 页序
      // —— ReaderView.jumpAnnot 的 kind==="ink" 分支负责 +1 转 1-based 页码
      const page = Number(h.dataset.inkPage);
      p.openInkStroke(bookId, h.dataset.inkId || "", Number.isFinite(page) ? page : 0);
    });
  });
  contentEl.querySelectorAll("[data-range]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const next = (el as HTMLElement).dataset.range as HeatRange | undefined;
      if (!next || next === readHeatRange(contentEl)) return;
      // 范围按容器（dataset）存：三处实例（组合栏 / 独立 Dock / 主区页签）互不串改（F5）
      contentEl.dataset.heatRange = next;
      renderDashboardInto(contentEl, p);
    });
  });
}
