/**
 * Apple Pencil 墨迹批注 · 测试 5: InkLayer.svelte + InkToolbar.svelte UI
 * ----------------------------------------------------------------
 * 覆盖：
 *  - InkLayer：渲染所有笔触（已完成 + active）
 *  - InkLayer：pointer-events: none（让事件穿透到 foliate iframe）
 *  - InkLayer：SVG viewBox + 绝对定位 + z-index
 *  - InkToolbar：仅 isInkMode 时显示
 *  - InkToolbar：5 笔刷 + 7 色 + 橡皮 + 关闭按钮
 *  - InkToolbar：触摸区 ≥44px（iPad HIG）
 *  - InkToolbar：预设 6 个
 *
 * 不依赖：foliate / siyuan SDK
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const layerPath = join(__dirname, "..", "src", "reader", "ink", "InkLayer.svelte");
const toolbarPath = join(__dirname, "..", "src", "reader", "ink", "InkToolbar.svelte");
const layerSrc = readFileSync(layerPath, "utf-8");
const toolbarSrc = readFileSync(toolbarPath, "utf-8");

/* ========== InkLayer 测试 ========== */

test("[核心] InkLayer 渲染所有笔触（currentPageStrokes + activeStroke）", () => {
  // 找 allStrokes 派生
  assert.ok(/\$:\s*allStrokes\s*=/.test(layerSrc), "应有 allStrokes 派生");
  // allStrokes 应合并 currentPageStrokes 和 activeStroke
  assert.ok(/\$currentPageStrokes/.test(layerSrc), "应读 currentPageStrokes");
  assert.ok(/\$activeStroke/.test(layerSrc), "应读 activeStroke");
});

test("[核心] InkLayer 用 brushToSvgProps 渲染 SVG 属性", () => {
  assert.ok(/brushToSvgProps/.test(layerSrc), "应调 brushToSvgProps 渲染");
});

test("[关键] InkLayer pointer-events: none（让事件穿透到 foliate iframe）", () => {
  assert.ok(/pointer-events:\s*none/.test(layerSrc), "SVG 应有 pointer-events: none");
  assert.ok(
    /pointer-events:\s*none\s*;/.test(layerSrc) || /\.ink-layer\s*\{[\s\S]*?pointer-events:\s*none/.test(layerSrc),
    "CSS 块应有 pointer-events: none"
  );
});

test("[核心] InkLayer SVG viewBox + 绝对定位", () => {
  assert.ok(/<svg\b/.test(layerSrc), "应有 <svg> 元素");
  assert.ok(/viewBox=/.test(layerSrc), "SVG 应有 viewBox");
  assert.ok(/position:\s*absolute/.test(layerSrc), "SVG 应绝对定位");
  assert.ok(/top:\s*0/.test(layerSrc) && /left:\s*0/.test(layerSrc), "应 top:0 left:0 覆盖整个 stage");
});

test("[核心] InkLayer 跳过橡皮笔触（橡皮不渲染 path）", () => {
  // {#if stroke.brush !== "eraser"}
  assert.ok(/stroke\.brush\s*!==\s*["']eraser["']/.test(layerSrc), "应过滤橡皮笔触");
});

test("[核心] InkLayer z-index 浮在 PDF 之上", () => {
  assert.ok(/z-index:\s*5/.test(layerSrc) || /z-index:\s*[1-9]/.test(layerSrc), "应有 z-index");
});

/* ========== InkToolbar 测试 ========== */

test("[核心] InkToolbar 仅 isInkMode 时显示", () => {
  // {#if $isInkMode}
  assert.ok(/\{#if\s+\$isInkMode\}/.test(toolbarSrc), "InkToolbar 应仅在 isInkMode 时显示");
});

test("[核心] InkToolbar 5 种笔刷按钮", () => {
  // {#each BRUSHES as brush}
  assert.ok(/\{#each\s+BRUSHES\s+as\s+brush/.test(toolbarSrc), "应循环 BRUSHES 数组");
  // BRUSHES 数组
  assert.ok(
    /const BRUSHES: InkBrush\[\]\s*=\s*\[["']ballpoint["']\s*,\s*["']pencil["']\s*,\s*["']marker["']\s*,\s*["']highlighter["']\s*,\s*["']fountain["']\]\s*;?/.test(toolbarSrc),
    "BRUSHES 应有 5 笔刷"
  );
});

test("[核心] InkToolbar 7 色调色板", () => {
  assert.ok(/\{#each\s+INK_COLORS\s+as\s+color/.test(toolbarSrc), "应循环 INK_COLORS 7 色");
});

test("[核心] InkToolbar 橡皮 + 关闭按钮", () => {
  // 橡皮按钮
  assert.ok(/setInkMode\(["']erase["']\)/.test(toolbarSrc), "应有橡皮按钮");
  // 关闭按钮
  assert.ok(/setInkMode\(["']off["']\)/.test(toolbarSrc), "应有关闭按钮");
});

test("[核心] InkToolbar 6 预设快捷", () => {
  assert.ok(/\{#each\s+INK_PRESETS\s+as\s+preset/.test(toolbarSrc), "应循环 INK_PRESETS 6 预设");
  assert.ok(/applyInkPreset\(/.test(toolbarSrc), "预设按钮应调 applyInkPreset");
});

test("[关键] InkToolbar iPad 触摸区 ≥44px（iOS HIG）", () => {
  // .ink-btn 应有 min-width: 44px + min-height: 44px
  assert.ok(/min-width:\s*44px/.test(toolbarSrc), "应有 min-width: 44px（iOS HIG）");
  assert.ok(/min-height:\s*44px/.test(toolbarSrc), "应有 min-height: 44px（iOS HIG）");
});

test("[UI] InkToolbar 浮动在 PDF 上方（top: 56px + right: 12px）", () => {
  // position: absolute 浮动
  assert.ok(/position:\s*absolute/.test(toolbarSrc), "应绝对定位");
  // 顶部右角
  assert.ok(/top:\s*56px/.test(toolbarSrc), "应 top: 56px");
  assert.ok(/right:\s*12px/.test(toolbarSrc), "应 right: 12px");
});

test("[UI] InkToolbar z-index 浮在 PDF 之上", () => {
  assert.ok(/z-index:\s*10/.test(toolbarSrc), "应有 z-index: 10（高于 InkLayer 的 5）");
});

test("[UI] 笔刷/颜色按钮 active 状态", () => {
  // ink-active class 标识当前选中
  assert.ok(/ink-active/.test(toolbarSrc), "应有 ink-active class 标识当前选中");
  // active 条件：brush === $inkState.brush && mode === draw
  assert.ok(/\$inkState\.brush\s*===\s*brush/.test(toolbarSrc), "笔刷 active 条件");
});

test("[关键] 笔刷图标 + label（中文 tooltip）", () => {
  // BRUSH_LABELS 映射
  assert.ok(/BRUSH_LABELS/.test(toolbarSrc), "应有 BRUSH_LABELS");
  // 中文 label
  assert.ok(/圆珠笔|铅笔|马克笔|荧光笔|钢笔/.test(toolbarSrc), "应有中文 label");
});

test("[关键] 颜色按钮圆形 + 选中描边", () => {
  // .ink-color border-radius: 50%
  assert.ok(/\.ink-color[\s\S]*?border-radius:\s*50%/.test(toolbarSrc), "颜色按钮应圆形");
  // active 状态边框
  assert.ok(/ink-color\.ink-active[\s\S]*?border-color/.test(toolbarSrc) || /ink-active[\s\S]*?border-color:/.test(toolbarSrc), "active 状态描边");
});
