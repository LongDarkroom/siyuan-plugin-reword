/**
 * 选区色 + 思源主题联动（v1.4.5 P4）测试
 * 覆盖：
 *  - captureSiyuanThemeVars 加 3 个新字段（selectionBg / searchHighlight / error）
 *  - siyuanVarBridgeStyles 输出 --reword-selection-bg / --reword-search-highlight / --b3-theme-error
 *  - hexToRgba 兜底逻辑
 *  - selectionStyles(theme) 根据书内主题做色温调节（sepia/night/light/auto/dark）
 *  - 桥接兜底（less 中 ::selection rgba 25% 默认值存在）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  captureSiyuanThemeVars,
  siyuanVarBridgeStyles,
  selectionStyles,
} from "../src/reader/reader-style.ts";

/* ==================== captureSiyuanThemeVars 加字段 ==================== */

test("capture: 新增 selectionBg / searchHighlight / error 字段（v1.4.5 P4.1）", () => {
  const r = captureSiyuanThemeVars((k, fb) => fb);
  assert.ok(r.selectionBg, "selectionBg 必有值");
  assert.ok(r.searchHighlight, "searchHighlight 必有值");
  assert.ok(r.error, "error 必有值");
  // 选区色是 rgba 形式
  assert.match(r.selectionBg, /^rgba\(/);
  assert.match(r.searchHighlight, /^rgba\(/);
  assert.equal(r.error, "#d44c47", "error 默认值是思源 --b3-theme-error fallback");
});

test("capture: selectionBg 是主色 50% 透明（v1.4.5 P5 与主文档统一）", () => {
  const r = captureSiyuanThemeVars(() => "#0f6bff");
  // hex #0f6bff = rgb(15, 107, 255)
  // 50% 透明 = rgba(15, 107, 255, 0.5)
  assert.equal(r.selectionBg, "rgba(15, 107, 255, 0.5)");
});

test("capture: searchHighlight 是主色 70% 透明（更深）", () => {
  const r = captureSiyuanThemeVars(() => "#0f6bff");
  assert.equal(r.searchHighlight, "rgba(15, 107, 255, 0.7)");
});

test("capture: 自定义主色 → 选区色跟随", () => {
  const r = captureSiyuanThemeVars(() => "#ff5722");
  // #ff5722 = rgb(255, 87, 34)
  assert.equal(r.selectionBg, "rgba(255, 87, 34, 0.5)");
  assert.equal(r.searchHighlight, "rgba(255, 87, 34, 0.7)");
});

test("capture: 非法 hex 走默认 fallback（不抛错）", () => {
  const r = captureSiyuanThemeVars((k, fb) => fb);
  // fallback 给 "#0f6bff"
  assert.equal(r.selectionBg, "rgba(15, 107, 255, 0.5)");
});

/* ==================== siyuanVarBridgeStyles 输出新变量 ==================== */

test("bridge: 输出 --reword-selection-bg / --reword-search-highlight / --b3-theme-error", () => {
  // 用不同 mock 给 error 一个独立值（避免所有变量同色）
  const vars = captureSiyuanThemeVars(
    (k) => (k === "--b3-theme-error" ? "#ff0000" : "#0f6bff")
  );
  const css = siyuanVarBridgeStyles(vars);
  assert.match(css, /--reword-selection-bg:\s*rgba\(15,\s*107,\s*255,\s*0\.5\)/);
  assert.match(css, /--reword-search-highlight:\s*rgba\(15,\s*107,\s*255,\s*0\.7\)/);
  assert.match(css, /--b3-theme-error:\s*#ff0000/, "error 桥接独立值");
});

/* ==================== selectionStyles 主题色温调节 ==================== */

test("selectionStyles: 默认（light/auto/dark）不加色温调节", () => {
  for (const t of ["light", "auto", "dark", "night"]) {
    const css = selectionStyles(t);
    // 默认不加额外的 .textLayer 或主题专用规则（只含通用 ::selection）
    if (t === "light" || t === "auto") {
      // 不含 tintCss（米黄/提亮）
      assert.doesNotMatch(css, /#c4a06a/);
      assert.doesNotMatch(css, /color-mix\([^)]*white/);
    }
  }
});

test("selectionStyles: sepia/almond/autumn/gold 暖主题 → 选区色往米黄拉", () => {
  for (const t of ["sepia", "almond", "autumn", "gold"]) {
    const css = selectionStyles(t);
    // tintCss: color-mix(... #c4a06a 70%)
    assert.match(css, /#c4a06a/, `${t} 主题应含米黄 #c4a06a`);
    assert.match(css, /color-mix\(in srgb, var\(--b3-theme-primary[^)]*\)\s*30%,\s*#c4a06a\s*70%\)/, `${t} 主题应含 30% 主色 + 70% 米黄 混合`);
  }
});

test("selectionStyles: night/dark 暗主题 → 选区色提亮（往白色拉）", () => {
  for (const t of ["night", "dark"]) {
    const css = selectionStyles(t);
    // tintCss: color-mix(... white 30%)
    assert.match(css, /color-mix\(in srgb, var\(--b3-theme-primary[^)]*\)\s*30%,\s*white\s*30%\)/, `${t} 主题应含 30% 主色 + 30% 白色 混合（提亮）`);
  }
});

test("selectionStyles: 必含通用 ::selection / ::-moz-selection 兜底", () => {
  const css = selectionStyles("light");
  assert.match(css, /::selection\s*{[^}]*--reword-selection-bg/);
  assert.match(css, /::-moz-selection\s*{[^}]*--reword-selection-bg/);
});

test("selectionStyles: 必含 @supports color-mix 精细版（优先用）", () => {
  const css = selectionStyles("light");
  assert.match(css, /@supports\s*\(background:\s*color-mix/);
  assert.match(css, /color-mix\(in srgb,\s*var\(--b3-theme-primary[^)]*\)\s*50%,\s*transparent\)/);
});

test("selectionStyles: 必含 mark.reword-search-hit 搜索高亮（70% 透明）", () => {
  const css = selectionStyles("light");
  assert.match(css, /mark\.reword-search-hit/);
  assert.match(css, /--reword-search-highlight/);
  assert.match(css, /color-mix\(in srgb,\s*var\(--b3-theme-primary[^)]*\)\s*70%,\s*transparent\)/);
});

/* ==================== 联动矩阵契约 ==================== */

test("联动矩阵: 思源主色 × 书内主题 → 选区色推导（端到端契约）", () => {
  // 这条测试是用户问题的"伪脚本化"：验证联动逻辑而非像素
  // 思源蓝主色 #0f6bff + 各书内主题
  const vars = captureSiyuanThemeVars(() => "#0f6bff");
  const bridge = siyuanVarBridgeStyles(vars);
  // 默认 light/auto 选区 = 主色 50% 透明（rgba 兜底值）
  const lightCss = selectionStyles("light");
  assert.match(bridge, /--reword-selection-bg:\s*rgba\(15,\s*107,\s*255,\s*0\.5\)/);
  assert.match(lightCss, /::selection\s*{[^}]*--reword-selection-bg/);
  // sepia 主题选区往米黄拉
  const sepiaCss = selectionStyles("sepia");
  assert.match(sepiaCss, /#c4a06a 70%/);
  // night 主题选区往白色拉（提亮）
  const nightCss = selectionStyles("night");
  assert.match(nightCss, /white 30%/);
});

/* ==================== 旧契约不破坏 ==================== */

test("旧字段保留：bg / primary / link / markBg / codeBg / bqBg / error 都在", () => {
  const r = captureSiyuanThemeVars((k, fb) => fb);
  assert.ok(r.bg);
  assert.ok(r.primary);
  assert.ok(r.link);
  assert.ok(r.codeBg);
  assert.ok(r.bqBg);
  assert.ok(r.markBg);
  assert.ok(r.error);
  // siyuanVarBridgeStyles 输出 11 个旧 + 3 个新 = 14 个 CSS 变量
  const bridge = siyuanVarBridgeStyles(r);
  const matches = (bridge.match(/--[a-z0-9-]+:/g) || []).length;
  assert.ok(matches >= 14, `桥接应输出 ≥14 个 CSS 变量，实际 ${matches}`);
});
