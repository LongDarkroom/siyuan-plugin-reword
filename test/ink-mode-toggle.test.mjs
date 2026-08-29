/**
 * Apple Pencil 墨迹批注 · 测试 3: ink/store.ts 状态管理
 * ----------------------------------------------------------------
 * 覆盖：
 *  - inkState 默认值（off / ballpoint / 黄色 / solid）
 *  - cycleInkMode 循环（off → draw → erase → off）
 *  - setInkMode / setInkBrush / setInkColor / setInkStyle
 *  - applyInkPreset 切预设
 *  - addStroke / removeStroke / setInkContext
 *  - isInkMode / currentPageStrokes 派生
 *  - BRUSH_BASE_WIDTH 笔刷粗细映射
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
const storePath = join(__dirname, "..", "src", "reader", "ink", "store.ts");
const src = readFileSync(storePath, "utf-8");

test("[核心] inkState 默认值（off + ballpoint + 黄）", () => {
  const m = src.match(/const defaultState: InkState\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(m, "defaultState 应存在");
  const body = m[1];
  assert.ok(/mode:\s*["']off["']/.test(body), "默认 mode 关闭");
  assert.ok(/brush:\s*["']ballpoint["']/.test(body), "默认笔刷圆珠笔");
  assert.ok(/color:\s*["']#facc15["']/.test(body), "默认颜色黄色 #facc15");
  assert.ok(/style:\s*["']solid["']/.test(body), "默认线型 solid");
  assert.ok(/baseWidth:\s*2/.test(body), "默认 baseWidth = 2");
  assert.ok(/opacity:\s*1/.test(body), "默认 opacity = 1");
});

test("[核心] cycleInkMode 循环（off → draw → erase → off）", () => {
  // 找 cycleInkMode 函数体
  const fnStart = src.indexOf("export function cycleInkMode()");
  assert.ok(fnStart > 0, "cycleInkMode 应存在");
  let depth = 0;
  let bodyEnd = -1;
  for (let i = fnStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  assert.ok(bodyEnd > 0, "应能定位 cycleInkMode 函数体");
  const body = src.slice(fnStart, bodyEnd + 1);
  // 至少 off → draw + draw → erase 两个显式分支
  assert.ok(/s\.mode\s*===\s*["']off["']/.test(body), "off → draw（显式）");
  assert.ok(/s\.mode\s*===\s*["']draw["']/.test(body), "draw → erase（显式）");
  // erase → off 通常是 default 兜底（最后一个 return），
  // 或显式 s.mode === "erase"
  const hasEraseExplicit = /s\.mode\s*===\s*["']erase["']/.test(body);
  const hasDefaultOff = /return\s*\{\s*\.\.\.s\s*,\s*mode:\s*["']off["']\s*\}/.test(body);
  assert.ok(
    hasEraseExplicit || hasDefaultOff,
    "erase → off（要么显式判断要么 default 兜底）"
  );
});

test("[核心] setInkBrush 同步更新 baseWidth", () => {
  const m = src.match(/export function setInkBrush\([^)]*\)[\s\S]*?^}/m);
  assert.ok(m, "setInkBrush 应存在");
  const body = m[0];
  assert.ok(/brush,/.test(body), "应接受 brush 参数");
  assert.ok(/baseWidth:\s*BRUSH_BASE_WIDTH\[brush\]/.test(body), "应查 BRUSH_BASE_WIDTH 设置 baseWidth");
});

test("[核心] setInkColor / setInkStyle / setInkMode / setInkContext", () => {
  assert.ok(/export function setInkColor\(/.test(src), "setInkColor 应存在");
  assert.ok(/export function setInkStyle\(/.test(src), "setInkStyle 应存在");
  assert.ok(/export function setInkMode\(/.test(src), "setInkMode 应存在");
  assert.ok(/export function setInkContext\(/.test(src), "setInkContext 应存在");
});

test("[核心] addStroke / removeStroke 操作 inkStrokes 列表", () => {
  assert.ok(/export function addStroke\(/.test(src), "addStroke 应存在");
  assert.ok(/\[\.\.\.arr,\s*stroke\]/.test(src), "addStroke 应追加到列表");
  assert.ok(/export function removeStroke\(/.test(src), "removeStroke 应存在");
  assert.ok(/arr\.filter\(\(s\)\s*=>\s*s\.id\s*!==\s*strokeId\)/.test(src), "removeStroke 应按 id 过滤");
});

test("[核心] applyInkPreset 切预设（mode=draw + brush/color/style）", () => {
  const m = src.match(/export function applyInkPreset[\s\S]*?^}/m);
  assert.ok(m, "applyInkPreset 应存在");
  const body = m[0];
  // 应设 mode: "draw"
  assert.ok(/mode:\s*["']draw["']/.test(body), "applyInkPreset 应设 mode = draw");
  // 应从 INK_PRESETS 取 brush/color/style
  assert.ok(/preset\.brush/.test(body), "应从 preset 取 brush");
  assert.ok(/preset\.color/.test(body), "应从 preset 取 color");
  assert.ok(/preset\.style/.test(body), "应从 preset 取 style");
});

test("[核心] BRUSH_BASE_WIDTH 6 笔刷粗细映射（eraser=0）", () => {
  const m = src.match(/export const BRUSH_BASE_WIDTH: Record<InkBrush, number>\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(m, "BRUSH_BASE_WIDTH 应存在");
  const body = m[1];
  assert.ok(/ballpoint:\s*2/.test(body), "ballpoint 粗细 2");
  assert.ok(/pencil:\s*1\.5/.test(body), "pencil 粗细 1.5");
  assert.ok(/marker:\s*6/.test(body), "marker 粗细 6");
  assert.ok(/highlighter:\s*12/.test(body), "highlighter 粗细 12（最粗）");
  assert.ok(/fountain:\s*1\.2/.test(body), "fountain 粗细 1.2");
  assert.ok(/eraser:\s*0/.test(body), "eraser 粗细 0（橡皮不走 stroke）");
});

test("[核心] isInkMode 派生（mode !== off）", () => {
  assert.ok(/export const isInkMode\s*=\s*derived\(inkState/.test(src), "isInkMode 派生自 inkState");
  assert.ok(/s\.mode\s*!==\s*["']off["']/.test(src), "isInkMode 条件：mode !== off");
});

test("[核心] currentPageStrokes 派生（按 bookId + pageIndex 过滤）", () => {
  assert.ok(/export const currentPageStrokes\s*=\s*derived/.test(src), "currentPageStrokes 派生");
  const m = src.match(/export const currentPageStrokes[\s\S]*?^}/m);
  assert.ok(m, "currentPageStrokes 应存在");
  const body = m[0];
  // 应过滤 bookId + pageIndex
  assert.ok(/s\.bookId\s*===\s*\$ctx\.bookId/.test(body), "按 bookId 过滤");
  assert.ok(/s\.pageIndex\s*===\s*\$ctx\.pageIndex/.test(body), "按 pageIndex 过滤");
});

test("[核心] clearAllStrokes（debug 用）", () => {
  assert.ok(/export function clearAllStrokes\(\)/.test(src), "clearAllStrokes 应存在");
  assert.ok(/inkStrokes\.set\(\[\]\)/.test(src), "clearAllStrokes 应清空列表");
  assert.ok(/activeStroke\.set\(null\)/.test(src), "clearAllStrokes 应清 activeStroke");
});

test("[核心] activeStroke 状态", () => {
  assert.ok(/export const activeStroke: Writable<InkStroke \| null>\s*=\s*writable\(null\)/.test(src), "activeStroke 初始 null");
});

test("[核心] inkContext 状态（bookId + pageIndex）", () => {
  // 找 inkContext: Writable<{ bookId, pageIndex }>
  assert.ok(
    /export const inkContext: Writable[\s\S]*?<\s*\{[\s\S]*?bookId[\s\S]*?pageIndex[\s\S]*?\}[\s\S]*?>/.test(src),
    "inkContext 状态应包含 bookId + pageIndex"
  );
});
