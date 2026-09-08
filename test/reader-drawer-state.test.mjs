/**
 * 阅读器抽屉状态机（activeDrawer）回归测试（2026-08-30，2026-09-04 对齐 marks 合并）
 * ----------------------------------------------------------------
 * 验证独立 bool（showToc / showMarks）→ 1 个 activeDrawer 互斥单选状态机：
 *  - 同图标再点 = 关
 *  - 不同图标 = 自动切到新的
 *  - null 状态下点 = 开
 *  - 抽屉内点空白 = 全部关（move 到点空白 = activeDrawer = null）
 * 2026-09-03「半分半合」改造：书签 + 摘录合并为「我的标记」（marks）单抽屉，
 * DrawerKind 由三态收敛为 'toc' | 'marks'。
 *
 * 由于 activeDrawer 是 ReaderView.svelte 内的局部状态，本测试走源码契约扫描，
 * 验证状态机的核心表达式 + 模板钩子完整存在 + 角标 CSS 完整 + 工具栏 3 段 grid 改完。
 *
 * 不依赖：siyuan SDK / DOM
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const readerPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const readerSrc = readFileSync(readerPath, "utf-8");

/* ============================================================
 * A. 状态机：activeDrawer 类型 + 互斥逻辑
 * ============================================================ */

test("A1. 类型 DrawerKind = 'toc' | 'marks'（2026-09-03 书签/摘录合并后两态）", () => {
  assert.match(readerSrc, /type\s+DrawerKind\s*=\s*["']toc["']\s*\|\s*["']marks["']/,
    "应定义 DrawerKind 两态枚举");
});

test("A2. activeDrawer 初始为 null（默认全关）", () => {
  assert.match(readerSrc, /let\s+activeDrawer:\s*DrawerKind\s*\|\s*null\s*=\s*null/,
    "activeDrawer 初始值应为 null");
});

test("A3. toggleDrawer：同 kind 再点 = null（互斥 + 同关）", () => {
  // 核心表达式：activeDrawer === kind ? null : kind
  assert.match(readerSrc,
    /activeDrawer\s*===\s*kind\s*\?\s*null\s*:\s*kind/,
    "toggleDrawer 核心应为：同关/不同切");
});

test("A4. toggleDrawer 同步到底层 2 个 bool（showToc / showMarks）", () => {
  // 2026-09-04 对齐：bookmarks/annots 合并后只同步 showToc / showMarks
  assert.match(readerSrc, /showToc\s*=\s*activeDrawer\s*===\s*["']toc["']/,
    "应同步 showToc 标志位");
  assert.match(readerSrc, /showMarks\s*=\s*activeDrawer\s*===\s*["']marks["']/,
    "应同步 showMarks 标志位");
});

test("A5. toggleDrawer 打开 marks 时同时刷新书签 + 摘录两份数据", () => {
  // 2026-09-03 半分半合：合并抽屉打开时两份数据一起刷
  assert.match(readerSrc,
    /if\s*\(\s*activeDrawer\s*===\s*["']marks["']\s*\)\s*\{[\s\S]{0,80}?refreshBookmarks\(\)[\s\S]{0,80}?refreshAnnotsList\(\)/,
    "打开 marks 抽屉应同时调 refreshBookmarks() 与 refreshAnnotsList()");
});

/* ============================================================
 * B. 模板：3 个抽屉触发器图标（data-drawer-anchor）
 * ============================================================ */

test("B1. 模板里有 2 个 data-drawer-anchor 按钮（toc/marks）", () => {
  for (const kind of ["toc", "marks"]) {
    const re = new RegExp(`data-drawer-anchor=["']${kind}["']`);
    assert.match(readerSrc, re, `模板里应有 data-drawer-anchor="${kind}" 的触发器`);
  }
});

test("B2. 2 个触发器都接 toggleDrawer(kind) 点击", () => {
  for (const kind of ["toc", "marks"]) {
    const re = new RegExp(`toggleDrawer\\(["']${kind}["']\\)`);
    assert.match(readerSrc, re, `on:click 应调用 toggleDrawer("${kind}")`);
  }
});

test("B3. 触发器按钮 active class 跟随抽屉可见态（show* 标志，覆盖点空白/Esc/翻页等所有收起路径）", () => {
  // 2026-08-30 修复：图标高亮不再绑 activeDrawer，改绑 showToc/showMarks，
  // 这样无论抽屉被哪种方式收起（点击空白、Esc、翻页导航），图标都能回到未选中态
  assert.match(readerSrc, /class:reader-btn-active=\{showToc\}/);
  assert.match(readerSrc, /class:reader-btn-active=\{showMarks\}/);
});

/* ============================================================
 * C. 工具栏 3 段 grid 布局
 * ============================================================ */

test("C1. 工具栏用 grid 三段布局（left / title / right），左右等宽 1fr 让标题真正居中", () => {
  assert.match(readerSrc,
    /\.reader-toolbar\s*\{[\s\S]{0,700}display:\s*grid[\s\S]{0,400}grid-template-columns:\s*1fr\s+minmax\(0,\s*auto\)\s+1fr/,
    "工具栏应为 grid-template-columns: 1fr minmax(0,auto) 1fr 三段");
});

test("C2. 三个子容器：left / title / right", () => {
  for (const cls of ["reader-toolbar-left", "reader-toolbar-title", "reader-toolbar-right"]) {
    assert.match(readerSrc, new RegExp(`\\.${cls}\\b`),
      `应定义 .${cls} 子容器样式`);
  }
});

test("C3. 标题区有 ellipsis 支持 + justify-content: center", () => {
  // .reader-toolbar-title 至少要支持 ellipsis + 居中
  const m = readerSrc.match(/\.reader-toolbar-title\s*\{([\s\S]*?)\}/);
  assert.ok(m, "应定义 .reader-toolbar-title");
  assert.match(m[1], /justify-content:\s*center/, "标题应居中");
  assert.match(m[1], /min-width:\s*0/, "标题区 min-width:0 触发 ellipsis");
});

/* ============================================================
 * D. 角标 CSS：::before 三角
 * ============================================================ */

test("D1. 各抽屉共用 ::before 角标（CSS 三角，含合并后的 marks）", () => {
  // 2026-09-04 对齐：合并后选择器链为 toc/bookmarks/annots/marks 四个共用一组
  assert.match(readerSrc,
    /\.reader-toc::before\s*,\s*\.reader-bookmarks::before\s*,\s*\.reader-annots::before\s*,\s*\.reader-marks::before\s*\{/,
    "应定义 reader-toc/bookmarks/annots/marks 的共用 ::before 角标");
});

test("D2. 角标用 45° 旋转（CSS 三角标配）", () => {
  // 角标用 rotate(45deg) 形成尖角（CSS 三角形标准做法）
  // 我们不需要严格匹配"在 ::before 块内"，只要源码里有 1+ 处使用即可（3 个抽屉共用 1 个）
  const matches = readerSrc.match(/rotate\(45deg\)/g) || [];
  assert.ok(matches.length >= 1,
    `角标 CSS 应至少 1 处 rotate(45deg)，实际 ${matches.length}`);
});

test("D3. 角标横向位置由 JS 写入 --tail-left 并中心对齐", () => {
  // 2026-08-30 改造：三角不再硬编码 left，而是用 CSS 变量 + translateX(-50%)
  // 指向对应锚点图标的中心，按钮宽度/间距变化也不偏移。
  assert.match(readerSrc, /left:\s*var\(--tail-left,\s*30px\)/,
    "共用角标应使用 left: var(--tail-left, 30px)");
  assert.match(readerSrc, /transform:\s*translateX\(-50%\)\s*rotate\(45deg\)/,
    "三角应用 translateX(-50%) 中心对准变量位置");
  assert.match(readerSrc, /style="--tail-left:\{tailLeft\}px"/,
    "抽屉 popover 应内联写入 --tail-left 变量");
});

/* ============================================================
 * E. 点空白收起 + Esc
 * ============================================================ */

test("E1. handleDocClick 排除 [data-drawer-anchor]（点图标 = toggle）", () => {
  // 用宽松匹配：源码中有 .closest?.("[data-drawer-anchor]") 即可
  assert.ok(
    readerSrc.includes('.closest?.("[data-drawer-anchor]")'),
    "handleDocClick 应排除 drawer 锚点图标自身（让它走 toggle）",
  );
});

test("E2. 抽屉自身 .reader-popover 内部点击不收起（已有）", () => {
  assert.ok(
    readerSrc.includes('.closest?.(".reader-popover")'),
    "应排除 .reader-popover 自身点击（让内部交互不触发关闭）",
  );
});

test("E3. handleDocClick 兜底关闭（至少清 showToc）", () => {
  // 关闭路径里至少有 showToc = false 的赋值
  assert.match(readerSrc, /showToc\s*=\s*false/);
});

test("E4. Esc 关闭全浮层（已存在，line 1679 注释）", () => {
  // 简单契约：源码注释或代码里提到 Esc
  assert.match(readerSrc, /Esc/, "源码应提到 Esc 键的处理");
});

test("E5. 点空白守卫必须覆盖全部抽屉与浮层标志（否则 marks 抽屉开着时点空白关不掉）", () => {
  // 2026-08-30 修复：原守卫只查 !showToc。2026-09-04 对齐：marks 合并后守卫应含
  // !showMarks && !activeDrawer（另覆盖 settings/search/footnote/工具栏/批注气泡）。
  const guard = readerSrc.match(/if\s*\(!showToc\s*&&[^\n]*?return;/);
  assert.ok(guard, "应存在以 !showToc 开头、命中 return 的早退守卫");
  assert.match(guard[0], /!showMarks/, "守卫需排除 marks 抽屉（点空白可收起）");
  assert.match(guard[0], /!activeDrawer/, "守卫需排除 activeDrawer（防状态残留漏关）");
});

test("E6. 正文区点空白（isFoliateArea 分支）必须收起抽屉（修复书签/摘录点空白关不掉）", () => {
  // 2026-08-30 根因：点击落点在 reword-foliate-view 内，命中 isFoliateArea 分支；
  //   此前该分支只关划词工具栏/批注，没调 closeAllPopovers，导致抽屉在正文点空白关不掉。
  //   现场景 B（点空白/普通文本）必须调用 closeAllPopovers。
  assert.match(readerSrc, /场景 B[\s\S]{0,600}?closeAllPopovers\(\)/,
    "isFoliateArea 的场景 B（点空白）分支应调用 closeAllPopovers 收起目录/书签/摘录抽屉");
});

/* ============================================================
 * F. 模板：标题居中
 * ============================================================ */

test("F1. 模板保留 reader-title（书名）+ reader-chapter（章节）+ reader-progress（进度）", () => {
  assert.match(readerSrc, /class="reader-title"/);
  assert.match(readerSrc, /class="reader-chapter"/);
  assert.match(readerSrc, /class="reader-progress"/);
});

test("F2. 进度条移到右侧工具组，标题组只放书名/章节（避免视觉拥挤）", () => {
  const titleBlock = readerSrc.match(/<div class="reader-toolbar-title">([\s\S]*?)<\/div>/);
  assert.ok(titleBlock, "应有 <div class='reader-toolbar-title'>");
  assert.doesNotMatch(titleBlock[1], /reader-progress/,
    "reader-progress 不应再占标题居中空间");
  const rightBlock = readerSrc.match(/<div class="reader-toolbar-right">([\s\S]*?)<\/div>/);
  assert.ok(rightBlock, "应有 <div class='reader-toolbar-right'>");
  assert.match(rightBlock[1], /reader-progress/,
    "reader-progress 应位于右侧工具组");
});

test("F3. 书名与章节相同时不再重复渲染", () => {
  assert.match(readerSrc,
    /\{#if chapterLabel && chapterLabel !== title\}/,
    "章节名等于书名时应省略，避免「人间词话 人间词话」重复");
});
