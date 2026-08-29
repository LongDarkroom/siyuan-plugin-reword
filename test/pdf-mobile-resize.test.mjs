/**
 * 移动端 PDF 适配 Phase 1 · 测试 4: 横竖屏 resize 保持缩放
 * ----------------------------------------------------------------
 * 覆盖：
 *  - onDeviceClassResize 是命名函数（可注销）
 *  - 设备类变化时更新 deviceClass + isIphoneMode
 *  - iPhone 模式切换时强制 fit-width（避免 custom 缩放错位）
 *  - onDestroy 注销 resize + orientationchange 监听
 *  - PDF 缩放状态由 ReadingProgress.zoom 持久化（relocate 已存）
 *  - openBook 时按当前设备类决定 initialZoom
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

test("[核心] onDeviceClassResize 是命名函数（可 removeEventListener）", () => {
  // 命名函数形式 function onDeviceClassResize() {}
  // 而非 const onDeviceClassResize = () => {}
  assert.ok(
    /function onDeviceClassResize\(\)/.test(src),
    "onDeviceClassResize 应是命名函数"
  );
  // 不应是箭头函数赋值
  const arrowAssign = /const onDeviceClassResize\s*=\s*\(/.test(src);
  assert.ok(!arrowAssign, "不应是 const = () => 形式（无法 removeEventListener）");
});

test("[行为] 设备类变化时才更新（避免无谓响应）", () => {
  const fnIdx = src.indexOf("function onDeviceClassResize");
  const body = src.slice(fnIdx, fnIdx + 500);
  assert.ok(
    /if\s*\(\s*newCls\s*!==\s*deviceClass\s*\)/.test(body),
    "应只在设备类变化时更新（newCls !== deviceClass）"
  );
});

test("[行为] iPhone 模式切换时强制 fit-width（小屏不让 custom 缩放错位）", () => {
  const fnIdx = src.indexOf("function onDeviceClassResize");
  const body = src.slice(fnIdx, fnIdx + 600);
  // 切到 iPhone 模式 + 当前是 custom 缩放 → 强制 fit-width
  assert.ok(
    /isIphoneMode\s*&&[\s\S]*?currentZoom\.kind\s*===\s*['"]custom['"][\s\S]*?applyZoom\(\{\s*kind:\s*['"]fit-width['"]/.test(body),
    "iPhone 模式 + custom 缩放应自动 fit-width"
  );
});

test("[注册] onMount 注册 resize + orientationchange 监听", () => {
  const onMountIdx = src.indexOf("onMount(() => {");
  const body = src.slice(onMountIdx, onMountIdx + 5000);
  // resize
  assert.ok(
    /window\.addEventListener\(\s*['"]resize['"]\s*,\s*onDeviceClassResize\s*\)/.test(body),
    "onMount 应注册 resize 监听"
  );
  // orientationchange
  assert.ok(
    /window\.addEventListener\(\s*['"]orientationchange['"]\s*,\s*onDeviceClassResize\s*\)/.test(body),
    "onMount 应注册 orientationchange 监听"
  );
});

test("[注销] onDestroy 注销 resize + orientationchange", () => {
  const onDestroyIdx = src.indexOf("onDestroy(() => {");
  const body = src.slice(onDestroyIdx, onDestroyIdx + 2000);
  assert.ok(
    /window\.removeEventListener\(\s*['"]resize['"]\s*,\s*onDeviceClassResize\s*\)/.test(body),
    "onDestroy 应注销 resize 监听"
  );
  assert.ok(
    /window\.removeEventListener\(\s*['"]orientationchange['"]\s*,\s*onDeviceClassResize\s*\)/.test(body),
    "onDestroy 应注销 orientationchange 监听"
  );
});

test("[持久化] PDF 缩放状态由 ReadingProgress.zoom 持久化（PDF 翻页 / 跨重启用）", () => {
  // relocate 事件已 savePayload.zoom = currentZoom
  assert.ok(
    /savePayload\.zoom\s*=\s*currentZoom/.test(src),
    "relocate 事件应保存 currentZoom 到 savePayload.zoom"
  );
});

test("[持久化] openBook 恢复 zoom 时按 iPhone 模式分流", () => {
  // initialZoom: isIphoneMode ? fit-width : savedZoom ?? fit-page
  assert.ok(
    /initialZoom\s*:\s*ZoomState\s*=\s*isIphoneMode\s*\?\s*\{\s*kind:\s*['"]fit-width['"]\s*\}\s*:\s*\(savedZoom\s*\?\?/.test(src),
    "openBook 应按 iPhone 模式 + savedZoom 分流 initialZoom"
  );
});

test("[横屏 → 竖屏] iPad → iPhone 模式切换：缩放从 custom 改为 fit-width", () => {
  // 场景：iPad 上 100% 缩放 → 翻转到 iPhone（窄屏）
  // onDeviceClassResize 触发 → 设备类变 iphone → isIphoneMode true
  // currentZoom.kind === 'custom' → 强制 fit-width
  // 这正是 onDeviceClassResize 函数体的逻辑
  const fnIdx = src.indexOf("function onDeviceClassResize");
  const body = src.slice(fnIdx, fnIdx + 800);
  // 完整逻辑：isIphoneMode && isPdfBook() && currentZoom.kind === 'custom' → applyZoom({ kind: 'fit-width' })
  assert.ok(/isIphoneMode/.test(body), "应检查 isIphoneMode");
  assert.ok(/isPdfBook\(\)/.test(body), "应检查 isPdfBook（只在 PDF 模式强制 fit-width）");
});

test("[回归] 桌面端 resize 仍正常（不应被 iPhone 逻辑污染）", () => {
  // desktop → 任何设备类变化都不会触发 fit-width 强制
  // getDeviceClass() 在 desktop + maxDim >= 600 永远返回 desktop
  // 设备类不变 → newCls === deviceClass → 不进 if 块
  const fnIdx = src.indexOf("function onDeviceClassResize");
  const body = src.slice(fnIdx, fnIdx + 500);
  // if (newCls !== deviceClass) 守卫
  assert.ok(/if\s*\(\s*newCls\s*!==\s*deviceClass\s*\)/.test(body), "应守卫 newCls !== deviceClass");
});
