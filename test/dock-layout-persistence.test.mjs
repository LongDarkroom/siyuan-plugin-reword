/**
 * Dock 布局持久化回归测试（2026-08-30）
 * ----------------------------------------------------------------
 * 修复「重启思源后 Reword 侧边栏图标位置重置」：
 * 根因是 clearStaleDockCache() 每次启动都清空 local-plugin-docks 缓存，
 * 导致用户拖拽的图标顺序/位置丢失。本测试锁定：
 *  - 缓存清理函数改为「修正 icon/title」而非「删除条目」；
 *  - fixStandaloneDockIcons 会把正确 icon/title 写回缓存；
 *  - onLayoutReady 中调用 restoreDockOrderFromCache 做顺序兜底。
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
const indexPath = join(__dirname, "..", "src", "index.ts");
const indexSrc = readFileSync(indexPath, "utf-8");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const indexCode = stripComments(indexSrc);

function bodyOf(src, name) {
  // 从函数/方法定义处开始：name(...) : Type { ... } 或 name(...) { ... }
  const re = new RegExp(`${name}\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\{`);
  const m = src.match(re);
  if (!m || m.index === undefined) return "";
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return "";
}

/* ============================================================
 * A. clearStaleDockCache：从「清空」改为「修正 icon/title」
 * ============================================================ */

test("A1. clearStaleDockCache 不再删除缓存条目", () => {
  const fn = bodyOf(indexCode, "clearStaleDockCache");
  assert.ok(fn.length > 0, "应存在 clearStaleDockCache 函数");
  assert.doesNotMatch(fn, /delete\s+root\[this\.name\]\[[kK]\]/,
    "不应再删除整个缓存条目");
  assert.doesNotMatch(fn, /for\s*\(\s*const\s+k\s+of\s+Object\.keys\s*\(\s*root\[this\.name\]\s*\)\s*\)\s*delete/,
    "不应遍历并删除缓存条目");
});

test("A2. clearStaleDockCache 修正 hiword-sidebar 与 standalone 的 icon/title", () => {
  const fn = bodyOf(indexCode, "clearStaleDockCache");
  assert.match(fn, /type\s*===\s*["']hiword-sidebar["']/,
    "应识别组合栏 sidebar 缓存");
  assert.match(fn, /type\.startsWith\s*\(\s*["']hiword-standalone-["']\s*\)/,
    "应识别独立 Dock 缓存");
  assert.match(fn, /cfg\.icon\s*=\s*ICON_REWORD/, "应修正 sidebar icon");
  assert.match(fn, /cfg\.title\s*=\s*["']RE word["']/, "应修正 sidebar title");
  assert.match(fn, /cfg\.icon\s*=\s*f\.icon/, "应修正 feature icon");
  assert.match(fn, /cfg\.title\s*=\s*f\.title/, "应修正 feature title");
});

/* ============================================================
 * B. fixStandaloneDockIcons：同步写回缓存
 * ============================================================ */

test("B1. fixStandaloneDockIcons 读取并写回 local-plugin-docks", () => {
  const fn = bodyOf(indexCode, "fixStandaloneDockIcons");
  assert.ok(fn.length > 0, "应存在 fixStandaloneDockIcons 函数");
  assert.match(fn, /pluginDocks\s*=\s*root\?\.\[this\.name\]/,
    "应读取本插件缓存（可选链写法）");
  assert.match(fn, /const\s+shortType\s*=\s*type\.slice\s*\(\s*this\.name\.length\s*\)/,
    "应截取短 type 用于缓存 key");
  assert.match(fn, /cfg\.icon\s*=\s*iconId/, "应把 iconId 写回缓存");
  assert.match(fn, /if\s*\(\s*title\s*\)\s*cfg\.title\s*=\s*title/, "应把 title 写回缓存");
});

/* ============================================================
 * C. restoreDockOrderFromCache：启动时恢复顺序
 * ============================================================ */

test("C1. restoreDockOrderFromCache 存在并按缓存恢复顺序", () => {
  const fn = bodyOf(indexCode, "restoreDockOrderFromCache");
  assert.ok(fn.length > 0, "应存在 restoreDockOrderFromCache 函数");
  assert.match(fn, /local-plugin-docks["']\]\?\.\[this\.name\]/,
    "应读取本插件缓存（可选链写法）");
  assert.match(fn, /document\.querySelector\s*\(\s*[`"']\.dock__item\[data-type=/,
    "应查找当前图标 DOM");
  assert.match(fn, /this\.positionToSlot\s*\(\s*cfg\.position\s*\)/,
    "应按缓存 position 解析 slot");
  assert.match(fn, /this\.resolveTargetDock\s*\(\s*slot\s*\)/,
    "应解析目标 Dock 与分组");
  assert.match(fn, /dock\.add\s*\(\s*index\s*,\s*item\s*\)/,
    "应调用 dock.add 恢复位置");
});

test("C2. onLayoutReady 中调用 restoreDockOrderFromCache", () => {
  const fn = bodyOf(indexCode, "onLayoutReady");
  assert.ok(fn.length > 0, "应存在 onLayoutReady 函数");
  assert.match(fn, /this\.restoreDockOrderFromCache\s*\(\s*\)/,
    "应在 onLayoutReady 中恢复顺序");
  assert.match(fn, /this\.fixStandaloneDockIcons\s*\(\s*\)/,
    "仍应修正图标");
});

test("C3. positionToSlot 支持常见 position 字符串", () => {
  const fn = bodyOf(indexCode, "positionToSlot");
  assert.ok(fn.length > 0, "应存在 positionToSlot 函数");
  for (const pos of ["LeftTop", "LeftBottom", "RightTop", "RightBottom", "Bottom"]) {
    assert.match(fn, new RegExp(`case\\s+["']${pos}["']`), `应支持 ${pos}`);
  }
});
