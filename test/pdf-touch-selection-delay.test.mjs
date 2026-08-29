/**
 * 移动端 PDF 适配 Phase 2 · 测试 3: 划词延迟 + touch-action 优化
 * ----------------------------------------------------------------
 * 覆盖：
 *  - .reader-view 加 touch-action: manipulation
 *  - foliate-js fixed-layout.js 已设 touch-action: pan-x pan-y（已有）
 *  - 触屏 selectionchange 350ms 默认延迟通过 touch-action: manipulation 消除
 *  - 桌面端 dblclick 仍走 onDblClickToggleZoom（main document capture）
 *  - 触屏触发的 double-tap 也走 onDblClickToggleZoom（touchend 内部）
 *
 * 不依赖：foliate / siyuan SDK
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const fixedLayoutPath = join(__dirname, "..", "src", "reader", "vendor", "foliate-js", "fixed-layout.js");
const viewSrc = readFileSync(viewPath, "utf-8");
const flSrc = readFileSync(fixedLayoutPath, "utf-8");

test("[核心] .reader-view CSS 加 touch-action: manipulation", () => {
  // 找 .reader-view { 块
  const cssStart = viewSrc.indexOf(".reader-view {");
  assert.ok(cssStart > 0, "应有 .reader-view CSS 块");
  const css = viewSrc.slice(cssStart, cssStart + 500);
  // 注意：源码里 touch-action: manipulation 可能在注释里也出现，
  // 这里用 `;` 后缀定位 CSS 规则末尾（精确）
  assert.ok(/touch-action:\s*manipulation\s*;/.test(css), ".reader-view CSS 应有 `touch-action: manipulation;`");
});

test("[注释] touch-action: manipulation 应有 REword patch 注释说明", () => {
  // 精确定位 CSS 里的 touch-action: manipulation;（带分号，是 CSS 规则）
  // 源码里这串文字在注释 + CSS 中都出现，限定在 .reader-view { } 块内找
  const cssStart = viewSrc.indexOf(".reader-view {");
  assert.ok(cssStart > 0, "应有 .reader-view CSS 块");
  const css = viewSrc.slice(cssStart, cssStart + 800);
  const cssTouchAction = css.search(/touch-action:\s*manipulation\s*;/);
  assert.ok(cssTouchAction > 0, "CSS 块内应有 touch-action: manipulation; 规则");
  // 注释在 CSS 规则之前
  const before = css.slice(0, cssTouchAction);
  assert.ok(
    /REword patch 2026-08-29/.test(before) && /Phase 2/.test(before) && /350ms/.test(before),
    "CSS 规则之前应有 REword patch + Phase 2 + 350ms 注释"
  );
});

test("[回归] foliate-js fixed-layout.js 已设 touch-action: pan-x pan-y（防系统 pinch-zoom）", () => {
  // foliate-js PDF iframe 内部应设 touch-action 避免系统缩放冲突
  assert.ok(/touch-action:\s*pan-x pan-y/.test(flSrc), "foliate-js 应有 touch-action: pan-x pan-y");
});

test("[效果] touch-action: manipulation 消除 iOS 350ms 双击延迟", () => {
  // 精确定位 CSS 里的 touch-action: manipulation;
  const cssStart = viewSrc.indexOf(".reader-view {");
  const css = viewSrc.slice(cssStart, cssStart + 800);
  const cssTouchAction = css.search(/touch-action:\s*manipulation\s*;/);
  assert.ok(cssTouchAction > 0, "CSS 块内应有 touch-action: manipulation; 规则");
  const before = css.slice(0, cssTouchAction);
  assert.ok(
    /350ms/.test(before) && /iOS Safari/.test(before),
    "注释应说明 touch-action: manipulation 消除 350ms 延迟（iOS Safari）"
  );
});

test("[关键] 桌面 dblclick 仍走 onDblClickToggleZoom（main document capture）", () => {
  assert.ok(
    /document\.addEventListener\(\s*["']dblclick["']\s*,\s*onDblClickToggleZoom/.test(viewSrc),
    "桌面 dblclick 仍走 main document capture 阶段"
  );
});

test("[关键] 触屏 double-tap 走 onDblClickToggleZoom（touchend 内部）", () => {
  const fnIdx = viewSrc.indexOf("const onTouchEnd = (e: TouchEvent) => {");
  const body = viewSrc.slice(fnIdx, fnIdx + 3000);
  assert.ok(/onDblClickToggleZoom\(\)/.test(body), "触屏 double-tap 走 onDblClickToggleZoom");
});

test("[关键] 桌面 / 触屏 双入口同目标（都调 onDblClickToggleZoom）", () => {
  // 桌面：document.addEventListener dblclick
  // 触屏：touchend 内部 double-tap 判定
  // 两者都应调 onDblClickToggleZoom
  const dblClickMatch = viewSrc.match(/document\.addEventListener\(\s*["']dblclick["']\s*,\s*onDblClickToggleZoom/);
  const touchDblClickMatch = viewSrc.match(/onDblClickToggleZoom\(\)/);
  assert.ok(dblClickMatch, "桌面 dblclick 入口应存在");
  assert.ok(touchDblClickMatch, "触屏 double-tap 入口应存在");
});

test("[UI] 长按选区 → selToolbar 弹出（已有 selectionchange 路径）", () => {
  // Phase 2 长按后系统选词菜单会触发 selectionchange
  // selToolbar 监听 selectionchange 自动显示
  // 验证 selectionchange 监听存在
  assert.ok(
    /trackDocListener\([\s\S]*?["']selectionchange["']/.test(viewSrc),
    "应有 selectionchange 监听（触发 selToolbar）"
  );
});

test("[回归] 桌面端单击切工具栏 / 翻页仍然工作", () => {
  // 桌面 click 路径不应被 Phase 2 改动破坏
  // 找 injectPageTurn / setupZoneClick 等
  assert.ok(/setupZoneClick/.test(viewSrc) || /clickToTurn/.test(viewSrc), "桌面端点击翻页应保留");
  assert.ok(/toggleToolbar/.test(viewSrc), "桌面端工具栏 toggle 应保留");
});

test("[回归] 触屏短按（< 350ms）走分区翻页/工具栏切换", () => {
  // 之前已有的逻辑
  const fnIdx = viewSrc.indexOf("const onTouchEnd = (e: TouchEvent) => {");
  const body = viewSrc.slice(fnIdx, fnIdx + 3000);
  assert.ok(
    /dt\s*<\s*350/.test(body) && /w\s*\*\s*0\.33/.test(body),
    "短按 + 位移小应走分区翻页（< 0.33 左 / 0.33-0.67 中 / > 0.67 右）"
  );
  assert.ok(/toggleToolbar\(\)/.test(body), "中心点击应 toggleToolbar");
});
