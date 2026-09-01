<script lang="ts">
  /**
   * 阅读统计面板（A · 阅读统计可视化）
   * 使用 portal 挂载到 body，逃离 dock 的 transform 裁剪，获得完整视口宽度。
   */
  import { onMount, createEventDispatcher } from "svelte";
  import { portal } from "../utils/portal";
  import RWSection from "../ui/components/RWSection.svelte";
  import type { BookshelfStore } from "./bookshelf-store";
  import {
    computeReadingStats,
    fmtDuration,
    heatColor,
    type ReadingStats,
    type DayStat,
    type StatsRange,
  } from "./stats";

  export let store: BookshelfStore;

  const dispatch = createEventDispatcher();

  let stats: ReadingStats | null = null;
  let maxMonthMs = 1;
  let leadOffset = 0;
  let monthTicks: { label: string; col: number }[] = [];
  /** 热力图时间范围（切换重算） */
  let range: StatsRange = "12m";
  let weeks = 53;

  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  const CELL = 13;
  const GAP = 3;
  const RANGE_OPTIONS: { key: StatsRange; label: string }[] = [
    { key: "7d", label: "近 7 天" },
    { key: "30d", label: "近 30 天" },
    { key: "year", label: "今年" },
    { key: "12m", label: "近一年" },
  ];

  function recompute() {
    stats = computeReadingStats(store.list, range);
    weeks = Math.ceil(stats.calendar.length / 7);
    maxMonthMs = Math.max(1, ...stats.monthly.map((m) => m.ms));
    const first = stats.calendar[0]?.date;
    leadOffset = first ? new Date(first + "T00:00:00").getDay() : 0;
    monthTicks = buildMonthTicks(stats.calendar, leadOffset);
  }

  onMount(() => {
    recompute();
  });

  function buildMonthTicks(calendar: DayStat[], offset: number) {
    const ticks: { label: string; col: number }[] = [];
    let lastMonth = "";
    for (let i = 0; i < calendar.length; i++) {
      const m = calendar[i].date.slice(0, 7);
      if (m !== lastMonth) {
        const col = Math.floor((i + offset) / 7);
        ticks.push({ label: monthLabel(m), col });
        lastMonth = m;
      }
    }
    return ticks;
  }

  function monthLabel(ym: string): string {
    const [, m] = ym.split("-");
    return `${Number(m)}月`;
  }

  function close() {
    dispatch("close");
  }
</script>

<div class="edit-mask" use:portal on:click|self={close}>
  <div class="edit-panel stats-panel">
    <header class="panel-header">
      <h2 class="panel-title">阅读统计</h2>
      <button class="panel-close" on:click={close} aria-label="关闭">×</button>
    </header>

    {#if stats}
      <div class="stats-body">
        <div class="range-switch">
          {#each RANGE_OPTIONS as opt}
            <button
              class="range-btn"
              class:active={range === opt.key}
              on:click={() => {
                range = opt.key;
                recompute();
              }}>{opt.label}</button>
          {/each}
        </div>

        <!-- 概览 -->
        <section class="stats-overview">
          <div class="metric-card">
            <div class="metric-value">{fmtDuration(stats.totalMs)}</div>
            <div class="metric-label">累计时长</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{stats.streak}<span class="metric-unit">天</span></div>
            <div class="metric-label">连续阅读</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{stats.statusCounts.reading}</div>
            <div class="metric-label">在读</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{stats.statusCounts.finished}</div>
            <div class="metric-label">读完</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">
              {stats.ratedCount ? stats.avgRating.toFixed(1) : "—"}
            </div>
            <div class="metric-label">平均评分</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{stats.longestStreak}<span class="metric-unit">天</span></div>
            <div class="metric-label">最长连续</div>
          </div>
        </section>

        <!-- 日历热力图 -->
        <RWSection title="近一年阅读热力" hint="每天">
          <div class="chart-card calendar-card">
            <div class="calendar-scroll">
              <div class="calendar-inner" style="width:{weeks * (CELL + GAP)}px">
                <div class="month-labels" aria-hidden="true">
                  {#each monthTicks as t}
                    <span class="month-tick" style="left:{t.col * (CELL + GAP)}px">{t.label}</span>
                  {/each}
                </div>
                <div class="calendar-wrap">
                  <div class="weekday-labels" aria-hidden="true">
                    {#each WEEKDAYS as w, i}
                      <span class="weekday-tick" class:dim={i % 2 === 0}>{w}</span>
                    {/each}
                  </div>
                  <div
                    class="heat-grid"
                    style="grid-template-rows: repeat(7, {CELL}px); grid-auto-columns: {CELL}px; gap: {GAP}px;"
                  >
                    {#each Array(leadOffset) as _, i (i)}
                      <span class="heat-cell empty"></span>
                    {/each}
                    {#each stats.calendar as d (d.date)}
                      <span
                        class="heat-cell"
                        style="background:{heatColor(d.ms)}"
                        title={d.date + (d.ms ? " · " + fmtDuration(d.ms) : " · 未读")}
                      ></span>
                    {/each}
                  </div>
                </div>
              </div>
            </div>
            <div class="heat-legend">
              <span>少</span>
              <span class="heat-cell" style="background:{heatColor(0)}"></span>
              <span class="heat-cell" style="background:{heatColor(15 * 60000)}"></span>
              <span class="heat-cell" style="background:{heatColor(30 * 60000)}"></span>
              <span class="heat-cell" style="background:{heatColor(60 * 60000)}"></span>
              <span class="heat-cell" style="background:{heatColor(90 * 60000)}"></span>
              <span>多</span>
            </div>
          </div>
        </RWSection>

        <!-- 月度分布 -->
        <RWSection title="近 12 个月分布">
          <div class="chart-card month-chart">
            {#each stats.monthly as m}
              <div class="month-col" title={m.month + (m.ms ? " · " + fmtDuration(m.ms) : "")}>
                <div class="month-bar-track">
                  <div class="month-bar" style="height:{Math.round((m.ms / maxMonthMs) * 100)}%"></div>
                </div>
                <div class="month-label">{monthLabel(m.month)}</div>
              </div>
            {/each}
          </div>
        </RWSection>

        <!-- Top 书 -->
        <RWSection title={"阅读时长 Top " + stats.topBooks.length}>
          <div class="chart-card top-chart">
            {#each stats.topBooks as b, i}
              <div class="top-row">
                <span class="top-rank">{i + 1}</span>
                <span class="top-title" title={b.title}>{b.title}</span>
                <div class="top-bar-wrap">
                  <span
                    class="top-bar"
                    style="width:{Math.max(4, Math.round((b.ms / (stats.topBooks[0]?.ms || 1)) * 100))}%"
                  ></span>
                </div>
                <span class="top-ms">{fmtDuration(b.ms)}</span>
              </div>
            {/each}
          </div>
        </RWSection>
      </div>
    {:else}
      <div class="stats-loading">加载中…</div>
    {/if}
  </div>
</div>

<style>
  .stats-panel {
    width: min(680px, 92vw);
    max-height: 88vh;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
  }
  .panel-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--b3-theme-on-background, #333);
    margin: 0;
  }
  .panel-close {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.04));
    border-radius: 50%;
    font-size: 18px;
    line-height: 1;
    color: var(--b3-theme-on-surface-light, #666);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .panel-close:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.08));
    color: var(--b3-theme-on-background, #333);
  }
  .stats-body {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding-right: 2px;
  }
  .range-switch {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .range-btn {
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    background: var(--b3-theme-background, #fff);
    border-radius: 8px;
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
    color: var(--b3-theme-on-background, #333);
    transition: background 0.15s, color 0.15s;
  }
  .range-btn:hover {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.04));
  }
  .range-btn.active {
    background: var(--b3-theme-primary-light, rgba(55, 138, 221, 0.12));
    border-color: transparent;
    color: var(--b3-theme-primary, #378add);
    font-weight: 500;
  }
  .stats-overview {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(94px, 1fr));
    gap: 10px;
  }
  .metric-card {
    background: linear-gradient(180deg, var(--b3-theme-primary-light, rgba(83, 74, 183, 0.08)), rgba(255, 255, 255, 0));
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    border-radius: 12px;
    padding: 14px 6px;
    text-align: center;
  }
  .metric-value {
    font-size: 18px;
    font-weight: 700;
    color: var(--b3-theme-primary, #534ab7);
    line-height: 1.2;
    letter-spacing: -0.02em;
  }
  .metric-unit {
    font-size: 11px;
    font-weight: 500;
    margin-left: 2px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .metric-label {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light, #888);
    margin-top: 4px;
  }
  .chart-card {
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.03));
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.06));
    border-radius: 12px;
    padding: 14px;
  }
  .calendar-scroll {
    overflow-x: auto;
    padding-bottom: 6px;
    margin: 0 -4px;
  }
  .calendar-inner {
    position: relative;
    min-width: 100%;
    padding: 0 4px;
    box-sizing: border-box;
  }
  .month-labels {
    position: absolute;
    top: 0;
    left: 28px;
    right: 0;
    height: 14px;
    pointer-events: none;
  }
  .month-tick {
    position: absolute;
    font-size: 10px;
    color: var(--b3-theme-on-surface-light, #999);
    transform: translateX(2px);
  }
  .calendar-wrap {
    display: flex;
    gap: 8px;
    padding-top: 18px;
  }
  .weekday-labels {
    display: grid;
    grid-template-rows: repeat(7, 13px);
    gap: 3px;
    padding-top: 1px;
  }
  .weekday-tick {
    font-size: 9px;
    line-height: 13px;
    color: var(--b3-theme-on-surface-light, #777);
    text-align: right;
    width: 14px;
  }
  .weekday-tick.dim {
    color: var(--b3-theme-on-surface-light, #bbb);
  }
  .heat-grid {
    display: grid;
    grid-auto-flow: column;
  }
  .heat-cell {
    width: 13px;
    height: 13px;
    border-radius: 3px;
    background: var(--b3-theme-background-light, rgba(0, 0, 0, 0.06));
    transition: transform 0.1s;
  }
  .heat-cell:not(.empty):hover {
    transform: scale(1.15);
  }
  .heat-legend {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
    font-size: 10px;
    color: var(--b3-theme-on-surface-light, #888);
  }
  .heat-legend .heat-cell {
    display: inline-block;
    width: 11px;
    height: 11px;
  }
  .month-chart {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 8px;
    height: 120px;
  }
  .month-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .month-bar-track {
    width: 100%;
    flex: 1;
    display: flex;
    align-items: flex-end;
    background: var(--b3-theme-background, rgba(255, 255, 255, 0.6));
    border-radius: 6px;
    overflow: hidden;
  }
  .month-bar {
    width: 100%;
    background: linear-gradient(180deg, var(--b3-theme-primary-light, #a099e6), var(--b3-theme-primary, #534ab7));
    border-radius: 6px 6px 0 0;
    min-height: 2px;
  }
  .month-label {
    font-size: 10px;
    color: var(--b3-theme-on-surface-light, #888);
    font-variant-numeric: tabular-nums;
  }
  .top-chart {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .top-row {
    display: grid;
    grid-template-columns: 20px 1fr 120px 52px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .top-rank {
    font-size: 11px;
    font-weight: 600;
    color: var(--b3-theme-on-surface-light, #999);
    text-align: center;
  }
  .top-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--b3-theme-on-background, #333);
  }
  .top-bar-wrap {
    height: 8px;
    background: var(--b3-theme-background, rgba(255, 255, 255, 0.7));
    border-radius: 4px;
    overflow: hidden;
  }
  .top-bar {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: linear-gradient(90deg, var(--b3-theme-primary-light, #a099e6), var(--b3-theme-primary, #534ab7));
    min-width: 4px;
  }
  .top-ms {
    text-align: right;
    color: var(--b3-theme-on-surface-light, #888);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
  }
  .stats-loading {
    font-size: 13px;
    color: var(--b3-theme-on-surface-light, #888);
    text-align: center;
    padding: 40px 0;
  }
</style>
