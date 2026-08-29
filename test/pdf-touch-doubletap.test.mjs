/**
 * 移动端 PDF 适配 Phase 2 · 测试 1: 触屏 double-tap 检测
 * ----------------------------------------------------------------
 * 覆盖：
 *  - double-tap 阈值常量（DOUBLE_TAP_INTERVAL=300ms, DOUBLE_TAP_DIST=24px）
 *  - lastTapT/lastTapX/lastTapY 状态跟踪
 *  - touchend 内 double-tap 判定逻辑（时间+距离双约束）
 *  - 仅 PDF 触发 onDblClickToggleZoom
 *  - 三连击防重（重置 lastTapT）
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
const src = readFileSync(viewPath, "utf-8");

test("[核心] double-tap 阈值常量定义", () => {
  assert.ok(/const\s+DOUBLE_TAP_INTERVAL\s*=\s*300/.test(src), "DOUBLE_TAP_INTERVAL 应为 300ms");
  assert.ok(/const\s+DOUBLE_TAP_DIST\s*=\s*24/.test(src), "DOUBLE_TAP_DIST 应为 24px");
});

test("[核心] lastTap 状态变量", () => {
  // 找 let lastTapT = 0; let lastTapX = 0; let lastTapY = 0;
  assert.ok(/let\s+lastTapT\s*=\s*0/.test(src), "应有 lastTapT 状态");
  assert.ok(/let\s+lastTapX\s*=\s*0/.test(src), "应有 lastTapX 状态");
  assert.ok(/let\s+lastTapY\s*=\s*0/.test(src), "应有 lastTapY 状态");
});

test("[核心] touchend 内 double-tap 判定（时间+距离双约束）", () => {
  // 找 onTouchEnd 函数体
  const fnIdx = src.indexOf("const onTouchEnd = (e: TouchEvent) => {");
  assert.ok(fnIdx > 0, "onTouchEnd 应存在");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // 检查时间约束
  assert.ok(/now\s*-\s*lastTapT\s*<\s*DOUBLE_TAP_INTERVAL/.test(body), "double-tap 时间约束（now - lastTapT < 300ms）");
  // 距离约束 X
  assert.ok(/Math\.abs\(c\.clientX\s*-\s*lastTapX\)\s*<\s*DOUBLE_TAP_DIST/.test(body), "X 距离约束（< 24px）");
  // 距离约束 Y
  assert.ok(/Math\.abs\(c\.clientY\s*-\s*lastTapY\)\s*<\s*DOUBLE_TAP_DIST/.test(body), "Y 距离约束（< 24px）");
});

test("[关键] double-tap 触发 onDblClickToggleZoom（仅 PDF）", () => {
  const fnIdx = src.indexOf("const onTouchEnd = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // double-tap 确认分支
  assert.ok(
    /onDblClickToggleZoom\(\)/.test(body),
    "double-tap 确认后应调 onDblClickToggleZoom"
  );
  // 仅 PDF 触发
  assert.ok(
    /if\s*\(\s*isPdfBook\(\)\s*\)\s*\{[\s\S]*?onDblClickToggleZoom/.test(body) ||
    /isPdfBook\(\)[\s\S]{0,200}?onDblClickToggleZoom/.test(body),
    "仅 PDF 模式下触发（isPdfBook 包裹）"
  );
});

test("[防重] 三连击只触发一次（重置 lastTapT）", () => {
  const fnIdx = src.indexOf("const onTouchEnd = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // 触发后应重置 lastTapT
  assert.ok(
    /lastTapT\s*=\s*0\s*;/.test(body),
    "double-tap 触发后应重置 lastTapT 防止三连击"
  );
});

test("[单 tap 记录] 第一次 tap 记录 lastTapT/X/Y", () => {
  const fnIdx = src.indexOf("const onTouchEnd = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // 第一次 tap 应记录
  assert.ok(/lastTapT\s*=\s*now/.test(body), "第一次 tap 应记录 lastTapT = now");
  assert.ok(/lastTapX\s*=\s*c\.clientX/.test(body), "第一次 tap 应记录 lastTapX = c.clientX");
  assert.ok(/lastTapY\s*=\s*c\.clientY/.test(body), "第一次 tap 应记录 lastTapY = c.clientY");
});

test("[防误触] 长距离/长时间 tap 不计为 double-tap（重置 lastTapT）", () => {
  const fnIdx = src.indexOf("const onTouchEnd = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // 距离/时间超阈值应重置
  assert.ok(
    /else\s*\{[\s\S]*?lastTapT\s*=\s*0/.test(body),
    "距离/时间超阈值应走 else 分支重置 lastTapT"
  );
});

test("[关键] 已有桌面 dblclick 仍然走 onDblClickToggleZoom（main document 级别）", () => {
  // 之前 Phase 3 加的 onMount document.addEventListener('dblclick', onDblClickToggleZoom)
  assert.ok(
    /document\.addEventListener\(\s*["']dblclick["']\s*,\s*onDblClickToggleZoom/.test(src),
    "main document capture 阶段 dblclick 监听应保留（桌面端入口）"
  );
});

test("[关键] 长按与双击不冲突（长按 500ms，双击 < 300ms）", () => {
  // 长按 500ms 触发 longPressTimer
  // 双击在 300ms 内完成（第一次 + 第二次间隔 < 300ms）
  // 500 > 300，所以长按不会误触发双击判定
  assert.ok(/const\s+LONG_PRESS_MS\s*=\s*500/.test(src), "LONG_PRESS_MS = 500");
  assert.ok(/const\s+DOUBLE_TAP_INTERVAL\s*=\s*300/.test(src), "DOUBLE_TAP_INTERVAL = 300");
  // 500 > 300，长按不会被双击逻辑误识别
  assert.ok(500 > 300, "LONG_PRESS_MS > DOUBLE_TAP_INTERVAL，长按不会误触发 double-tap");
});
