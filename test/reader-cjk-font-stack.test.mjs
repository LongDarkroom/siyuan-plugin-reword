// 阅读器 - CJK 字体栈测试
// ----------------------------------------------------------------
// 覆盖 getDefaultCjkFontStack()：
// - 跨平台（macOS / Windows / Linux）必含字体
// - 顺序（macOS 优先 → Windows → Linux 通用 → Noto → 兜底）
// - 含引号字体名格式（"PingFang SC" 而非 PingFang SC）
// - 兜底 sans-serif
// - 不空 / 不重复
// - 能嵌入到 body { font-family: ... } 整段 CSS 中无格式错误
// 不依赖：foliate / siyuan SDK

import { test } from "node:test";
import assert from "node:assert/strict";
import { getDefaultCjkFontStack, bodyStyles } from "../src/reader/reader-style.ts";

test("getDefaultCjkFontStack 返回非空字符串", () => {
  const stack = getDefaultCjkFontStack();
  assert.ok(typeof stack === "string" && stack.length > 50, "stack should be non-empty string");
});

test("含 macOS 字体（PingFang SC / Hiragino Sans GB）", () => {
  const stack = getDefaultCjkFontStack();
  assert.ok(stack.includes('"PingFang SC"'), "missing PingFang SC");
  assert.ok(stack.includes('"Hiragino Sans GB"'), "missing Hiragino Sans GB");
});

test("含 Windows 字体（Microsoft YaHei / 微软雅黑）", () => {
  const stack = getDefaultCjkFontStack();
  assert.ok(stack.includes('"Microsoft YaHei"'), "missing Microsoft YaHei");
  assert.ok(stack.includes('"微软雅黑"'), "missing 微软雅黑");
});

test("含跨平台 Source Han Sans CN / Noto Sans CJK SC / Noto Sans SC", () => {
  const stack = getDefaultCjkFontStack();
  assert.ok(stack.includes('"Source Han Sans CN"'), "missing Source Han Sans CN");
  assert.ok(stack.includes('"Noto Sans CJK SC"'), "missing Noto Sans CJK SC");
  assert.ok(stack.includes('"Noto Sans SC"'), "missing Noto Sans SC");
});

test("含 Linux 字体（WenQuanYi Micro Hei / WenQuanYi Zen Hei）", () => {
  const stack = getDefaultCjkFontStack();
  assert.ok(stack.includes('"WenQuanYi Micro Hei"'), "missing WenQuanYi Micro Hei");
  assert.ok(stack.includes('"WenQuanYi Zen Hei"'), "missing WenQuanYi Zen Hei");
});

test("含 -apple-system / BlinkMacSystemFont（macOS 系统栈）", () => {
  const stack = getDefaultCjkFontStack();
  assert.ok(stack.includes("-apple-system"), "missing -apple-system");
  assert.ok(stack.includes("BlinkMacSystemFont"), "missing BlinkMacSystemFont");
});

test("末尾含 sans-serif 兜底", () => {
  const stack = getDefaultCjkFontStack();
  assert.match(stack, /,\s*sans-serif\s*$/, "sans-serif should be last");
});

test("字体顺序：macOS 在 Windows 之前", () => {
  const stack = getDefaultCjkFontStack();
  const macIdx = stack.indexOf("PingFang SC");
  const winIdx = stack.indexOf("Microsoft YaHei");
  assert.ok(macIdx > -1 && winIdx > -1 && macIdx < winIdx, `macOS (${macIdx}) should be before Windows (${winIdx})`);
});

test("字体顺序：Windows 在 Linux 之前", () => {
  const stack = getDefaultCjkFontStack();
  const winIdx = stack.indexOf("Microsoft YaHei");
  const linIdx = stack.indexOf("WenQuanYi Micro Hei");
  assert.ok(winIdx > -1 && linIdx > -1 && winIdx < linIdx, `Windows (${winIdx}) should be before Linux (${linIdx})`);
});

test("多字字体名均带双引号", () => {
  const stack = getDefaultCjkFontStack();
  // 抽几个典型多字字体名
  for (const name of ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", "Source Han Sans CN", "Noto Sans CJK SC", "Noto Sans SC", "WenQuanYi Micro Hei", "WenQuanYi Zen Hei"]) {
    assert.ok(stack.includes(`"${name}"`), `expected "${name}" with double quotes, got: ${stack}`);
  }
});

test("单字系统字体（-apple-system / BlinkMacSystemFont）不带引号", () => {
  const stack = getDefaultCjkFontStack();
  // 单标识符不应有引号包裹
  assert.ok(!stack.includes('"-apple-system"'), "should NOT quote -apple-system");
  assert.ok(!stack.includes('"BlinkMacSystemFont"'), "should NOT quote BlinkMacSystemFont");
  // 但裸字符串应在
  assert.ok(stack.includes(", -apple-system,") || stack.includes("-apple-system,") || stack.includes(", -apple-system"), "should have -apple-system as identifier");
  assert.ok(stack.includes("BlinkMacSystemFont"), "should have BlinkMacSystemFont");
});

test("字体名不重复", () => {
  const stack = getDefaultCjkFontStack();
  // 按逗号拆分，去除空白
  const items = stack.split(",").map(s => s.trim()).filter(Boolean);
  const unique = new Set(items);
  assert.equal(unique.size, items.length, `duplicates found: ${items.length - unique.size} dups in ${items.join(" | ")}`);
});

test("getDefaultCjkFontStack 嵌入 bodyStyles 格式正确（bodyStyles 不再含 font-family）", () => {
  // 2026-08-23 修复：bodyStyles 不再含 font-family，由 fontFamilyStyles 单独输出
  // 避免与 fontCss() 注入的宿主字体（霞鹜文楷等）冲突
  const o = { bg: "#fff", fg: "#222", fg2: "#888", padding: "2em 1.5em", isDark: false, colorScheme: "light" };
  const settings = { fontSize: 17, lineHeight: 1.7, theme: "light", lineWidth: "normal", fontMode: "follow-siyuan" };
  const css = bodyStyles(o, settings);
  // bodyStyles 应当**不**含 font-family（避免与 fontFamilyStack 冲突）
  assert.doesNotMatch(css, /font-family/i, "bodyStyles should not output font-family (use fontFamilyStyles instead)");
  // 不应有未闭合的括号
  const opens = (css.match(/\{/g) || []).length;
  const closes = (css.match(/\}/g) || []).length;
  assert.equal(opens, closes, `unbalanced braces in bodyStyles: ${opens} open vs ${closes} close`);
});

test("getDefaultCjkFontStack 在多端环境无未转义引号问题", () => {
  // 把栈嵌入到 font-family: STACK !important 段不应破坏 CSS 解析
  const stack = getDefaultCjkFontStack();
  const fakeCss = `body { font-family: ${stack} !important; }`;
  // 检查双引号成对
  const dqCount = (fakeCss.match(/"/g) || []).length;
  assert.equal(dqCount % 2, 0, `unbalanced double quotes in: ${fakeCss}`);
});

test("getDefaultCjkFontStack 至少含 10 项字体（防回归被砍）", () => {
  const stack = getDefaultCjkFontStack();
  const items = stack.split(",").map(s => s.trim()).filter(Boolean);
  assert.ok(items.length >= 10, `CJK font stack should have ≥ 10 entries, got ${items.length}: ${items.join(" | ")}`);
});
