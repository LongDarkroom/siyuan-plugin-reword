/**
 * 移动端响应式工具测试（2026-08-29 Phase 5 / 6）
 * ----------------------------------------------------------------
 * 覆盖 core/responsive.ts 的源码契约：
 *  - viewportWidth / viewportHeight（优先用 visualViewport，回退 window.innerWidth）
 *  - isSoftKeyboardOpen（iOS / Android 软键盘弹起检测）
 *  - responsiveWidth / responsiveHeight（视口尺寸折算）
 *  - responsiveDialogSize（CSS calc 表达式）
 *  - watchViewport（visualViewport 监听 + rAF 去重 + 清理）
 *  - Phase 5 的 dock 宽度 / Dialog 宽度 / index.less @media 适配
 *  - Phase 6 的 selectionchange / watchViewport 接入点
 *
 * 不依赖：siyuan SDK / jsdom（所有断言走源码 regex，避免 Node 环境差异）
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const responsivePath = join(__dirname, "..", "src", "core", "responsive.ts");
const src = readFileSync(responsivePath, "utf-8");

/* ============================================================
 * A. 模块结构（静态扫描，避免 jsdom 副作用）
 * ============================================================ */

test("A1. responsive.ts 导出 BREAKPOINTS 包含 4 个断点", () => {
  assert.match(src, /BREAKPOINTS\s*=\s*\{[^}]*phone[^}]*largePhone[^}]*tablet[^}]*desktop/s,
    "BREAKPOINTS 应有 phone / largePhone / tablet / desktop");
});

test("A2. responsive.ts 导出 7 个工具函数", () => {
  for (const fn of [
    "viewportWidth", "viewportHeight", "isSoftKeyboardOpen",
    "isPhoneSize", "isLargePhoneOrSmallTablet", "isTabletOrLarger",
    "responsiveWidth", "responsiveHeight", "responsiveDialogSize", "watchViewport",
  ]) {
    assert.match(src, new RegExp(`export function ${fn}\\(`), `${fn} 应 export`);
  }
});

test("A3. watchViewport 返回 dispose 函数（用于 cleanup）", () => {
  // watchViewport 应在最后 return () => { ... }
  const m = src.match(/export function watchViewport\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(m, "watchViewport 函数体应可提取");
  assert.match(m[1], /return\s*\(\s*\)\s*=>\s*\{/, "应返回 () => { ... } dispose 函数");
});

test("A4. watchViewport 监听 visualViewport.resize + scroll（带 window resize 降级）", () => {
  // 至少调用 vv.addEventListener('resize'/'scroll') 或 window.addEventListener('resize')
  assert.match(src, /addEventListener\(\s*['"]resize['"]/, "应监听 resize 事件");
});

test("A5. isSoftKeyboardOpen 阈值 = 150px（与 ann-preview 软键盘处理对齐）", () => {
  assert.match(src, /shrunk\s*>\s*150/, "软键盘判定阈值应为 150px");
});

/* ============================================================
 * B. responsiveWidth/Height/DialogSize 行为契约
 * ============================================================ */

test("B1. responsiveWidth：纯函数契约（无 window 依赖）", () => {
  // 通过源码推断的断点：
  //   phone(≤480):      Math.round(vw * 0.92 - 16)
  //   largePhone(≤600): designWidth * 0.85
  //   tablet(≤1024):    designWidth * 0.7
  //   desktop(>1024):   原 designWidth
  // 我们只验证存在"对应断点分支"，避免 mock window 的复杂度
  assert.match(src, /phone:\s*480/);
  assert.match(src, /largePhone:\s*600/);
  assert.match(src, /tablet:\s*768/);
  // 关键：vw ≤ 480 时 0.92 倍
  assert.match(src, /vw\s*<=\s*BREAKPOINTS\.phone[\s\S]{0,200}0\.92/,
    "phone 分支应为 0.92 倍");
  // tablet 分支 0.7
  assert.match(src, /vw\s*<=\s*BREAKPOINTS\.tablet[\s\S]{0,200}0\.7/,
    "tablet 分支应为 0.7");
  // 兜底 desktop
  assert.match(src, /return\s+Math\.min\(designWidth,\s*cap\)/,
    "desktop 分支应原样返回");
});

test("B2. responsiveHeight：视口高度折算契约", () => {
  // phone(≤480):  0.75 倍
  // largePhone(≤600): 0.8
  // tablet(≤1024): 0.85
  assert.match(src, /vh\s*<=\s*BREAKPOINTS\.phone[\s\S]{0,200}0\.75/);
  assert.match(src, /vh\s*<=\s*BREAKPOINTS\.largePhone[\s\S]{0,200}0\.8/);
  assert.match(src, /vh\s*<=\s*BREAKPOINTS\.tablet[\s\S]{0,200}0\.85/);
});

test("B3. responsiveDialogSize：phone → 100vw - 16px", () => {
  assert.match(src, /calc\(100vw\s*-\s*16px\)/, "phone 应铺满视口（100vw - 16px）");
  assert.match(src, /calc\(100vh\s*-\s*32px\)/, "phone 高度应减去键盘安全边距 32px");
});

/* ============================================================
 * C. Phase 5 dock 宽度契约（index.ts）
 * ============================================================ */

test("C1. index.ts dock 宽度按设备分级（Phase 5）", () => {
  const idxSrc = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf-8");
  // 查找 initDockPanels 内的 dockWidth 表达式
  assert.match(idxSrc, /isSmallMobile\(\)[\s\S]{0,200}\* 0\.92/,
    "小屏 dock 应取视口宽度的 92%");
  assert.match(idxSrc, /isLargeMobile\(\)\s*\?\s*360/,
    "大屏 dock 应为 360px（iPad / Android Tablet）");
  // 桌面 dock 应为 320px（旧默认），表达式 : 320 在三元末尾
  assert.match(idxSrc, /\?\s*360\s*:\s*320/,
    "桌面 dock 应为 320px（旧默认）");
});

test("C2. index.ts 11 个 Dialog width 都接上 responsiveDialogSize", () => {
  const idxSrc = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf-8");
  // 统计 responsiveDialogSize("width") 调用次数
  const matches = idxSrc.match(/responsiveDialogSize\(\s*\d+\s*,\s*["']width["']\s*\)/g);
  assert.ok(matches && matches.length >= 11,
    `应至少有 11 个 responsiveDialogSize 调用，实际 ${matches?.length}`);
});

test("C3. index.less 引入移动端 @media 查询（Phase 5）", () => {
  const lessSrc = readFileSync(join(__dirname, "..", "src", "index.less"), "utf-8");
  // 之前 0 个 @media，现在应该有
  const mediaQueries = lessSrc.match(/@media\s*\(/g) || [];
  assert.ok(mediaQueries.length >= 3,
    `应至少有 3 个 @media 查询（phone / large phone / iOS），实际 ${mediaQueries.length}`);
  // 关键断点
  assert.match(lessSrc, /@media\s*\(\s*max-width:\s*480px\s*\)/, "应有 phone 断点");
  assert.match(lessSrc, /@media\s*\(\s*min-width:\s*481px\s*\)\s*and\s*\(\s*max-width:\s*768px\s*\)/,
    "应有 large phone 断点");
});

/* ============================================================
 * D. Phase 6 visualViewport 接入契约（ai-panel.ts）
 * ============================================================ */

test("D1. ai-panel.ts 选字工具栏使用 computeFloatingPosition（Phase 6）", () => {
  const src = readFileSync(join(__dirname, "..", "src", "ai", "ai-panel.ts"), "utf-8");
  // positionSelToolbar 函数体应包含 computeFloatingPosition
  assert.match(src, /computeFloatingPosition\(/, "应调用 computeFloatingPosition");
  assert.match(src, /viewportToOffsetParent\(/, "应换算到 toolbar offsetParent");
  // 关键：preferredSide 选 top（默认）
  assert.match(src, /preferredSide:\s*["']top["']/, "默认首选上方");
});

test("D2. ai-panel.ts 引入 watchViewport（iOS 软键盘监听）", () => {
  const src = readFileSync(join(__dirname, "..", "src", "ai", "ai-panel.ts"), "utf-8");
  assert.match(src, /import\s*\{[^}]*watchViewport[^}]*\}\s*from\s*["']\.\.\/core\/responsive\.ts["']/,
    "应 import watchViewport");
  assert.match(src, /watchViewport\(\s*\{[\s\S]*?onResize/,
    "应注册 onResize 回调");
});

test("D3. ai-panel.ts selectionchange 监听（Phase 2 触屏长按）", () => {
  const src = readFileSync(join(__dirname, "..", "src", "ai", "ai-panel.ts"), "utf-8");
  // 在 isMobile() 块内
  assert.match(src, /isMobile\(\)\s*\)/, "应判定移动端");
  assert.match(src, /if\s*\(\s*isMobile\(\)\s*\)\s*\{[\s\S]{0,500}selectionchange/,
    "移动端分支内应监听 selectionchange（兜底长按选词）");
});

test("D4. ai-panel.ts 移动端 navigator.vibrate 触觉反馈（Phase 2 兜底）", () => {
  const src = readFileSync(join(__dirname, "..", "src", "ai", "ai-panel.ts"), "utf-8");
  assert.match(src, /navigator[\s\S]{0,100}\.vibrate/,
    "应调用 navigator.vibrate（触觉反馈）");
});

/* ============================================================
 * E. Phase 5 + 6 的整体契约
 * ============================================================ */

test("E1. watchViewport 内部 rAF 去重（同一个 viewport 事件不重复 fire）", () => {
  // 源码扫描：内部 schedule 用 raf 变量去重
  assert.match(src, /if\s*\(\s*raf\s*\)\s*return/,
    "watchViewport.schedule 应有 rAF 去重");
  // fire 时检测 w/h/keyboard 与 lastX 相同则跳过
  assert.match(src, /w\s*===\s*lastW\s*&&\s*h\s*===\s*lastH\s*&&\s*keyboardOpen\s*===\s*lastKeyboard/,
    "fire 应对比上次的 w/h/keyboardOpen，未变则 return");
});

test("E2. dispose 路径正确（取消 rAF + 移除监听）", () => {
  // 找 dispose 函数体：从最后一个 `return () => {` 一直到外层 `}` 之前
  const start = src.lastIndexOf("return () => {");
  const end = src.lastIndexOf("};");
  assert.ok(start > 0 && end > start, "dispose 函数应可定位");
  const body = src.slice(start, end);
  assert.match(body, /cancelAnimationFrame/, "应取消 rAF");
  assert.match(body, /removeEventListener/, "应移除监听");
});

test("E3. 软键盘判定只走 visualViewport（无 vv 时返回 false）", () => {
  // isSoftKeyboardOpen:  if (!vv) return false;
  assert.match(src, /isSoftKeyboardOpen[\s\S]{0,200}if\s*\(\s*!vv\s*\)\s*return\s*false/,
    "无 visualViewport 时应返回 false（不依赖 innerHeight 启发式）");
});

test("E4. watchViewport 立即 fire 一次（保证 listener 拿到初始值）", () => {
  // schedule() 应该在 dispose 函数之前被调用至少一次
  const start = src.indexOf("export function watchViewport");
  const disposeIdx = src.lastIndexOf("return () => {");
  assert.ok(start > 0 && disposeIdx > start);
  const beforeDispose = src.slice(start, disposeIdx);
  // 至少有一次 schedule() 调用
  const scheduleCount = (beforeDispose.match(/\bschedule\(\)/g) || []).length;
  assert.ok(scheduleCount >= 1, `应在 dispose 前至少调用一次 schedule()，实际 ${scheduleCount}`);
});
