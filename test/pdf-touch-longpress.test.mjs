/**
 * 移动端 PDF 适配 Phase 2 · 测试 2: 长按 500ms 检测
 * ----------------------------------------------------------------
 * 覆盖：
 *  - LONG_PRESS_MS = 500 常量
 *  - LONG_PRESS_MOVE_THRESHOLD = 12px
 *  - longPressTimer 状态跟踪
 *  - touchstart 启动定时器（单指）
 *  - touchmove 取消定时器（位移超阈值）
 *  - 多指触摸取消长按
 *  - touchend 取消定时器（松手）
 *  - 500ms 触发时检查选区（有/无）
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

test("[核心] 长按 500ms + 移动阈值 12px 常量", () => {
  assert.ok(/const\s+LONG_PRESS_MS\s*=\s*500/.test(src), "LONG_PRESS_MS = 500");
  assert.ok(/const\s+LONG_PRESS_MOVE_THRESHOLD\s*=\s*12/.test(src), "LONG_PRESS_MOVE_THRESHOLD = 12px");
});

test("[核心] longPressTimer 状态变量", () => {
  assert.ok(/let\s+longPressTimer:?\s*any/.test(src), "应有 longPressTimer 状态");
  assert.ok(/let\s+longPressStartX\s*=\s*0/.test(src), "longPressStartX 起始 0");
  assert.ok(/let\s+longPressStartY\s*=\s*0/.test(src), "longPressStartY 起始 0");
});

test("[核心] touchstart 启动长按定时器", () => {
  // 找 onTouchStart 函数（精确定位）
  const fnIdx = src.indexOf("const onTouchStart = (e: TouchEvent) => {");
  assert.ok(fnIdx > 0, "onTouchStart 应存在");
  // 找 setTimeout 行号（在 onTouchStart 块内）
  const setTimeoutIdx = src.indexOf("longPressTimer = setTimeout", fnIdx);
  assert.ok(setTimeoutIdx > 0, "应在 onTouchStart 内启动 setTimeout");
  // 验证 onTouchStart 函数体内有 e.touches.length === 1 单指分支（setTimeout 在其内部）
  const body = src.slice(fnIdx, setTimeoutIdx + 500);
  assert.ok(/e\.touches\.length\s*===\s*1/.test(body), "onTouchStart 内应有单指分支");
  // 验证 setTimeout 时长是 LONG_PRESS_MS
  // 源码：`}, LONG_PRESS_MS);` 完整模式（在 setTimeout 第二个参数位置）
  // 用 }, LONG_PRESS_MS) 模式（距离 setTimeout 可能 1000+ 字符）
  const fullAfter = src.slice(setTimeoutIdx);
  assert.ok(
    /\}\s*,\s*LONG_PRESS_MS\s*\)/.test(fullAfter),
    "setTimeout 第二个参数应为 LONG_PRESS_MS"
  );
});

test("[核心] 启动前先 clearTimeout（避免连按重叠）", () => {
  const fnIdx = src.indexOf("const onTouchStart = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // clearTimeout(longPressTimer) 应该在 setTimeout 之前
  assert.ok(
    /if\s*\(\s*longPressTimer\s*\)\s*clearTimeout\(longPressTimer\)/.test(body),
    "启动前应 clearTimeout 清理旧定时器"
  );
});

test("[核心] 双指/多指触摸取消长按", () => {
  const fnIdx = src.indexOf("const onTouchStart = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // 双指或 3+ 指应取消
  assert.ok(
    /e\.touches\.length\s*===\s*2[\s\S]{0,200}?clearTimeout\(longPressTimer\)/.test(body),
    "双指（touches.length === 2）应取消长按（避免捏合误触发）"
  );
  // 3+ 指 else 分支
  assert.ok(
    /else\s*\{[\s\S]{0,200}?clearTimeout\(longPressTimer\)/.test(body),
    "3+ 指应 else 取消长按"
  );
});

test("[核心] touchmove 移动超阈值取消长按", () => {
  const fnIdx = src.indexOf("const onTouchMove = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 1500);
  // 单指移动超 12px 应取消
  assert.ok(
    /Math\.hypot\([\s\S]*?LONG_PRESS_MOVE_THRESHOLD/.test(body),
    "应检查移动距离 vs LONG_PRESS_MOVE_THRESHOLD"
  );
  assert.ok(
    /clearTimeout\(longPressTimer\)/.test(body),
    "移动超阈值应 clearTimeout"
  );
});

test("[核心] touchmove 双指捏合也取消长按", () => {
  // 找 onTouchMove 函数
  const fnIdx = src.indexOf("const onTouchMove = (e: TouchEvent) => {");
  assert.ok(fnIdx > 0, "onTouchMove 应存在");
  // 找 clearTimeout(longPressTimer) 在 onTouchMove 块内的位置
  const clearIdx = src.indexOf("clearTimeout(longPressTimer)", fnIdx);
  assert.ok(clearIdx > 0, "onTouchMove 内应 clearTimeout(longPressTimer)");
  // 验证 clearIdx 之前是双指分支
  const before = src.slice(fnIdx, clearIdx);
  // 第一个 clearTimeout(longPressTimer) 应该在双指分支（length === 2）
  // 但 onTouchMove 可能先检查 length === 2
  // 简化：检查 before 含 touches.length === 2
  assert.ok(
    /e\.touches\.length\s*===\s*2/.test(before.slice(0, 200)),
    "clearTimeout 前应是双指分支"
  );
});

test("[核心] touchend 松手取消长按", () => {
  const fnIdx = src.indexOf("const onTouchEnd = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 500);
  // 第一时间应 clearTimeout
  assert.ok(
    /if\s*\(\s*longPressTimer\s*\)\s*\{\s*clearTimeout\(longPressTimer\)/.test(body),
    "touchend 第一步应 clearTimeout 长按"
  );
});

test("[行为] 500ms 触发时检查选区（有/无）", () => {
  const fnIdx = src.indexOf("const onTouchStart = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // setTimeout 回调内应检查选区
  const timerBody = body.match(/setTimeout\([\s\S]*?\}\s*,\s*LONG_PRESS_MS\s*\)\s*;/) || body.match(/setTimeout\(\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*LONG_PRESS_MS\)/);
  assert.ok(timerBody, "setTimeout 回调应存在");
  const cbBody = timerBody[1] || timerBody[0];
  // 应检查选区
  assert.ok(/doc\.getSelection/.test(cbBody) || /getSelection/.test(cbBody), "应检查选区");
  // 应区分有选区/无选区
  assert.ok(/sel\.toString/.test(cbBody) || /toString\(\)/.test(cbBody), "应检查选区文本");
});

test("[兜底] 长按检测有 try/catch 保护", () => {
  const fnIdx = src.indexOf("const onTouchStart = (e: TouchEvent) => {");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // 长按 500ms 回调内应 try/catch
  assert.ok(
    /try\s*\{[\s\S]{0,500}?logSwallow/.test(body) || /catch\s*\([\s\S]{0,200}?logSwallow/.test(body),
    "长按检测应 try/catch 保护"
  );
});

test("[关键] 长按 500ms 与双击 300ms 不冲突", () => {
  // 长按 > 双击间隔，所以长按不会误触发双击
  // 双击 < 长按，所以双击不会误触发长按
  assert.ok(/LONG_PRESS_MS\s*=\s*500/.test(src), "长按 500ms");
  assert.ok(/DOUBLE_TAP_INTERVAL\s*=\s*300/.test(src), "双击 300ms");
});
