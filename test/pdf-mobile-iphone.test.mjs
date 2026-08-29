/**
 * 移动端 PDF 适配 Phase 1 · 测试 3: ReaderView iPhone 降级模式
 * ----------------------------------------------------------------
 * 覆盖：
 *  - 设备分级状态 deviceClass + isIphoneMode
 *  - onMount 调用 getDeviceClass + isSmallMobile
 *  - onDeviceClassResize 函数存在（命名函数可被 removeEventListener）
 *  - resize + orientationchange 监听注册/注销
 *  - iPhone 模式强制 fit-width（openBook 恢复 zoom 时）
 *  - 工具栏 .reader-toolbar-iphone 类（仅 iPhone 模式）
 *  - 工具栏 iPhone 模式隐藏双语/设置/搜索按钮
 *  - 工具栏 iPhone 模式 CSS 触摸区 ≥44px
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

test("[核心] deviceClass + isIphoneMode 状态", () => {
  assert.ok(
    /let deviceClass:[\s\S]{0,200}getDeviceClass/.test(src),
    "deviceClass 状态应为 getDeviceClass 返回类型"
  );
  assert.ok(/let isIphoneMode\s*=\s*false/.test(src), "isIphoneMode 初始 false");
});

test("[核心] import 三个新 env 工具", () => {
  assert.ok(
    /import\s*\{[^}]*getDeviceClass[^}]*\}\s*from\s*['"]\.\.\/core\/env\.ts['"]/.test(src),
    "应 import getDeviceClass"
  );
  assert.ok(/isSmallMobile/.test(src), "应 import isSmallMobile");
  assert.ok(/isLargeMobile/.test(src), "应 import isLargeMobile");
});

test("[核心] onMount 调 getDeviceClass + isSmallMobile", () => {
  // 找 onMount 块里的 deviceClass = getDeviceClass()
  const onMountIdx = src.indexOf("onMount(() => {");
  const body = src.slice(onMountIdx, onMountIdx + 3000);
  assert.ok(/deviceClass\s*=\s*getDeviceClass\(\)/.test(body), "onMount 应调 getDeviceClass");
  assert.ok(/isIphoneMode\s*=\s*isSmallMobile\(\)/.test(body), "onMount 应调 isSmallMobile");
});

test("[核心] onDeviceClassResize 命名函数（可被 removeEventListener 移除）", () => {
  assert.ok(
    /function onDeviceClassResize\(\)/.test(src),
    "onDeviceClassResize 应是命名函数（不能用箭头函数）"
  );
});

test("[核心] onDeviceClassResize 内部更新 deviceClass + isIphoneMode", () => {
  const fnIdx = src.indexOf("function onDeviceClassResize");
  const body = src.slice(fnIdx, fnIdx + 500);
  assert.ok(/deviceClass\s*=\s*newCls/.test(body), "应更新 deviceClass");
  assert.ok(/isIphoneMode\s*=\s*isSmallMobile\(\)/.test(body), "应更新 isIphoneMode");
});

test("[核心] iPhone 模式强制 fit-width（小屏 custom 缩放过小）", () => {
  const fnIdx = src.indexOf("function onDeviceClassResize");
  const body = src.slice(fnIdx, fnIdx + 500);
  assert.ok(
    /isIphoneMode[\s\S]*?currentZoom\.kind\s*===\s*['"]custom['"][\s\S]*?applyZoom\(\{\s*kind:\s*['"]fit-width['"]/.test(body),
    "iPhone 模式 + custom 缩放应自动改 fit-width"
  );
});

test("[注册] resize + orientationchange 监听 main window", () => {
  const onMountIdx = src.indexOf("onMount(() => {");
  const body = src.slice(onMountIdx, onMountIdx + 3000);
  assert.ok(
    /window\.addEventListener\(\s*['"]resize['"]\s*,\s*onDeviceClassResize\s*\)/.test(body),
    "应注册 resize 监听"
  );
  assert.ok(
    /window\.addEventListener\(\s*['"]orientationchange['"]\s*,\s*onDeviceClassResize\s*\)/.test(body),
    "应注册 orientationchange 监听"
  );
});

test("[注销] onDestroy 注销 resize + orientationchange", () => {
  // 找 onDestroy 块
  const onDestroyIdx = src.indexOf("onDestroy(() => {");
  const body = src.slice(onDestroyIdx, onDestroyIdx + 1500);
  assert.ok(
    /window\.removeEventListener\(\s*['"]resize['"]\s*,\s*onDeviceClassResize\s*\)/.test(body),
    "应注销 resize 监听"
  );
  assert.ok(
    /window\.removeEventListener\(\s*['"]orientationchange['"]\s*,\s*onDeviceClassResize\s*\)/.test(body),
    "应注销 orientationchange 监听"
  );
});

test("[关键] openBook 恢复 zoom 时 iPhone 模式强制 fit-width", () => {
  // 找 openBook 内的 isPdfBook() 块
  const ifPdfBlock = src.match(/if\s*\(isPdfBook\(\)\)\s*\{([\s\S]*?setTimeout\([\s\S]*?applyZoom\([\s\S]*?\}\)\s*;)/);
  assert.ok(ifPdfBlock, "openBook 内 isPdfBook() 块应存在");
  const body = ifPdfBlock[1];
  assert.ok(
    /isIphoneMode\s*\?\s*\{\s*kind:\s*['"]fit-width['"]\s*\}\s*:/.test(body),
    "iPhone 模式应强制 fit-width 作为 initialZoom"
  );
});

test("[UI] 工具栏 iPhone 模式 class:reader-toolbar-iphone", () => {
  assert.ok(
    /class:reader-toolbar-iphone=\{isIphoneMode\}/.test(src),
    "工具栏应绑 iPhone 模式 class"
  );
});

test("[UI] 工具栏 iPhone 模式隐藏双语/设置/搜索按钮", () => {
  // {#if !isIphoneMode} 包裹这些按钮
  assert.ok(
    /\{#if\s+!isIphoneMode\s*\}/.test(src),
    "工具栏内 !isIphoneMode 块应存在（隐藏非核心按钮）"
  );
});

test("[CSS] 工具栏 iPhone 模式底部 + 触摸区 ≥44px", () => {
  // CSS 块有嵌套（.reader-toolbar-iphone + .reader-toolbar-iphone .reader-btn + .reader-zoom-btn + .reader-zoom-label），
  // 取起始后 1200 字符涵盖所有相关规则
  const cssStart = src.indexOf(".reader-toolbar-iphone {");
  assert.ok(cssStart > 0, "应有 .reader-toolbar-iphone CSS 块");
  const css = src.slice(cssStart, cssStart + 1200);
  // .reader-toolbar-iphone 顶层块应 bottom: 0
  assert.ok(/bottom:\s*0\s*;/.test(css), "iPhone 模式应 bottom: 0（底部）");
  // .reader-toolbar-iphone .reader-btn 子规则应 min-height: 44px
  assert.ok(/min-height:\s*44px/.test(css), "iPhone 模式按钮 min-height ≥44px");
  assert.ok(/min-width:\s*44px/.test(css), "iPhone 模式按钮 min-width ≥44px");
});
