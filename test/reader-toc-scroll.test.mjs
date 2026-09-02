// 阅读器 - 目录滚动/标题固定测试（2026-08-23 修订）
// ----------------------------------------------------------------
// 用户反馈：当目录项过多时（如 46 章）所有项被挤压在同一空间内不可滚动，
// 且滚动时目录标题会随内容一起移动。
//
// 实现演进：
//   第一轮：.reader-toc-list 独立滚动，需 min-height:0 + flex:1 + overflow-y:auto。
//   第二轮修复（Readest/思阅 同款）：整个 .reader-toc popover 作为滚动容器，
//     标题用 position:sticky 钉在顶部；列表不再独立滚动，避免 flex 撑破问题。
//
// 当前关键约束：
//   .reader-toc { max-height: 70vh; overflow-y: auto; overflow-x: hidden; }
//   .reader-popover-title { position: sticky; top: 0; }
//   .reader-toc-item { font-size: 13px; line-height: 1.7; padding: 8px 10px; }
//
// 2026-08-30 抽屉改造：.reader-toc 与 .reader-bookmarks / .reader-annots
// 合并为同一条分组选择器规则（跨行书写），宽度改为 width:280px + min-width:240px。
// 本文件的 getBlock() 已支持分组选择器，勿退回 `\.sel\s*\{` 形式的正则。
//
// 不依赖：foliate / siyuan SDK

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const readerViewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");

const readerViewSrc = readFileSync(readerViewPath, "utf-8");

/**
 * 抽取单个 CSS 块的【内容】（不含首尾花括号）。
 *
 * 必须支持多行分组选择器：抽屉改造后 .reader-toc 与 .reader-bookmarks /
 * .reader-annots 共享同一条规则，且选择器列表跨行书写：
 *     .reader-toc,
 *     .reader-bookmarks,
 *     .reader-annots { ... }
 * 旧正则 `\.reader-toc\s*\{` 要求选择器名后紧跟 `{`，命中不到分组选择器，
 * 静默取回空串，导致依赖它的断言全部误判为「样式丢失」—— 实际上样式一直在。
 *
 * 做法：先定位 `.选择器名`，再向后扫到第一个 `{`（中间允许逗号与其他选择器、
 * 允许换行），然后用花括号配对取完整块，兼顾嵌套（如 @media / @keyframes）。
 */
function getBlock(sel) {
  const idx = readerViewSrc.indexOf("." + sel);
  if (idx < 0) return "";
  const open = readerViewSrc.indexOf("{", idx);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < readerViewSrc.length; i++) {
    if (readerViewSrc[i] === "{") depth++;
    else if (readerViewSrc[i] === "}") {
      depth--;
      if (depth === 0) return readerViewSrc.slice(open + 1, i);
    }
  }
  return "";
}

const toc = getBlock("reader-toc");
const title = getBlock("reader-popover-title");
const list = getBlock("reader-toc-list");
const item = getBlock("reader-toc-item");

test(".reader-toc 高度限制为 70vh（更稳定）", () => {
  assert.match(toc, /max-height\s*:\s*70vh/, `.reader-toc should have max-height: 70vh, got: ${toc}`);
  assert.doesNotMatch(toc, /max-height\s*:\s*60%/, `.reader-toc should NOT have max-height: 60%, got: ${toc}`);
});

test(".reader-toc 自身作为滚动容器（overflow-y: auto）", () => {
  assert.match(toc, /overflow-y\s*:\s*auto/, `.reader-toc should have overflow-y: auto, got: ${toc}`);
});

test(".reader-toc 水平方向防溢出（overflow-x: hidden）", () => {
  assert.match(toc, /overflow-x\s*:\s*hidden/, `.reader-toc should have overflow-x: hidden, got: ${toc}`);
});

test(".reader-popover-title 使用 sticky 固定在 popover 顶部", () => {
  assert.match(title, /position\s*:\s*sticky/, `.reader-popover-title should be sticky, got: ${title}`);
  assert.match(title, /top\s*:\s*0/, `.reader-popover-title should have top: 0, got: ${title}`);
});

test(".reader-toc-list 不再独立滚动（交由 popover 滚动）", () => {
  assert.doesNotMatch(list, /overflow-y\s*:\s*auto/, `.reader-toc-list should NOT have its own overflow-y, got: ${list}`);
  assert.doesNotMatch(list, /min-height\s*:\s*0/, `.reader-toc-list should NOT need min-height:0 in sticky-title design, got: ${list}`);
  assert.doesNotMatch(list, /flex\s*:\s*1\s+1\s+auto/, `.reader-toc-list should NOT have flex:1 1 auto in sticky-title design, got: ${list}`);
});

test(".reader-toc-list 与标题之间有 margin-top 间距", () => {
  assert.match(list, /margin-top\s*:\s*\d+px/, `.reader-toc-list should have margin-top, got: ${list}`);
});

test(".reader-toc-item 字号 13px", () => {
  assert.match(item, /font-size\s*:\s*13px/, `.reader-toc-item should have font-size: 13px, got: ${item}`);
});

test(".reader-toc-item 行高 1.7（避免文字叠在一起）", () => {
  assert.match(item, /line-height\s*:\s*1\.7/, `.reader-toc-item should have line-height: 1.7, got: ${item}`);
});

test(".reader-toc-item padding 8px 10px", () => {
  assert.match(item, /padding\s*:\s*8px\s+10px/, `.reader-toc-item should have padding: 8px 10px, got: ${item}`);
});

test(".reader-toc-item 长章节名截断（white-space: nowrap + text-overflow: ellipsis）", () => {
  assert.match(item, /white-space\s*:\s*nowrap/);
  assert.match(item, /text-overflow\s*:\s*ellipsis/);
});

test(".reader-toc 最小宽度 240px（抽屉统一宽度）", () => {
  // 2026-08-30 抽屉改造：目录 / 书签 / 摘录三个抽屉共享同一条规则，
  // 宽度约束为 width: 280px + min-width: 240px（原 220px 随改造上调）。
  assert.match(toc, /min-width\s*:\s*240px/, `.reader-toc should have min-width: 240px, got: ${toc}`);
});

test("[回归] 目录 popover 不会撑破视口", () => {
  assert.ok(/max-height\s*:\s*70vh/.test(toc), "max-height: 70vh 必须存在");
  assert.ok(/overflow-y\s*:\s*auto/.test(toc), "overflow-y: auto 必须存在");
});
