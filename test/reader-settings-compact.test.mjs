// 阅读器 - 设置弹窗紧凑化（4 大分组高度溢出）测试（2026-08-25）
// ----------------------------------------------------------------
// 用户报告：4.7 中等：设置弹窗 4 大分组 → 26+ setting-row，弹窗高度溢出。
// 修复：
//   1) 紧凑化 CSS（max-height 70%→80vh、width 260px→300px、padding/gap 减小约 40%）
//   2) 4 边距（上/下/左/右）2x2 网格（reader-setting-grid-2col）
//   3) 「高级设置」二级折叠（主题/字体/行宽/模式/动画/点击翻页）

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewPath = join(__dirname, "..", "src/reader/ReaderView.svelte");
const viewSrc = readFileSync(viewPath, "utf-8");

// ============ A. CSS 紧凑化 ============

test("A1: .reader-settings 弹窗宽度 260px → 300px", () => {
  assert.match(viewSrc, /\.reader-settings\s*\{[^}]*width:\s*300px/s, "弹窗宽度应为 300px");
});

test("A2: .reader-settings max-height 70% → 80vh", () => {
  assert.match(viewSrc, /\.reader-settings\s*\{[^}]*max-height:\s*80vh/s, "弹窗 max-height 应为 80vh");
});

test("A3: .reader-settings gap 10px → 4px（紧凑化）", () => {
  assert.match(viewSrc, /\.reader-settings\s*\{[^}]*gap:\s*4px/s, "弹窗内部间距应紧凑化为 4px");
});

test("A4: .reader-setting-section-title padding 8px 10px → 5px 8px（紧凑化）", () => {
  assert.match(viewSrc, /\.reader-setting-section-title\s*\{[^}]*padding:\s*5px\s+8px/s, "section title padding 应紧凑化为 5px 8px");
});

test("A5: section 内部 row padding 4px 10px → 2px 8px（紧凑化）", () => {
  assert.match(viewSrc, /\.reader-setting-section\s*>\s*\.reader-setting-row\s*\{[^}]*padding:\s*2px\s+8px/s, "section row padding 应紧凑化为 2px 8px");
});

// ============ B. 4 边距 2x2 网格 ============

test("B1: 新增 .reader-setting-grid-2col 2x2 网格 class", () => {
  assert.match(viewSrc, /\.reader-setting-grid-2col\s*\{/, "应有 .reader-setting-grid-2col CSS 类");
});

test("B2: 4 边距改用 reader-setting-grid-2col 容器", () => {
  // 找"上边距"开始 + 4 个边距结束，验证外层用了 grid-2col
  const idx = viewSrc.indexOf("上边距");
  assert.ok(idx > 0, "应找到上边距 label");
  // 上边距前面 200 字符内应有 grid-2col 容器
  const before = viewSrc.slice(Math.max(0, idx - 300), idx);
  assert.match(before, /<div class="reader-setting-grid-2col">/, "上边距前应有 reader-setting-grid-2col 容器");
});

test("B3: 4 边距 row 内不再用 reader-setting-control 包裹 slider（grid-2col 直放 slider）", () => {
  // 找上边距 row，紧接 200 字符不应有 reader-setting-control
  const idx = viewSrc.indexOf("上边距");
  const after = viewSrc.slice(idx, idx + 400);
  // 紧凑化：grid-2col 内的 row 是 grid-template-columns: minmax(0, auto) 1fr
  assert.doesNotMatch(after, /<div class="reader-setting-control">/, "grid-2col 内不应再嵌套 reader-setting-control");
});

// ============ C. 「高级设置」二级折叠 ============

test("C1: 「高级设置」二级折叠组存在", () => {
  // 应有 ⚙ 高级设置 summary
  assert.match(viewSrc, /⚙ 高级设置/, "应有 ⚙ 高级设置 summary 标题");
});

test("C2: 高级设置内包含 主题 / 字体 / 行宽 / 模式 / 动画 / 点击翻页", () => {
  // 找「高级设置」summary 位置
  const idx = viewSrc.indexOf("⚙ 高级设置");
  assert.ok(idx > 0, "应找到 ⚙ 高级设置 summary");
  // 后续内容应包含 6 个次要项
  const after = viewSrc.slice(idx);
  // 取到对应的 </details> 结束位置
  const endIdx = after.indexOf("</details>");
  const block = after.slice(0, endIdx);
  for (const label of ["主题", "字体", "行宽", "模式", "动画", "点击翻页"]) {
    assert.match(block, new RegExp(`>${label}<`), `高级设置内应含 ${label}`);
  }
});

test("C3: 高级设置内不再包含 4 大分组的标签（不重复）", () => {
  const idx = viewSrc.indexOf("⚙ 高级设置");
  const after = viewSrc.slice(idx);
  const endIdx = after.indexOf("</details>");
  const block = after.slice(0, endIdx);
  // 4 大分组标签不应出现在高级设置内
  for (const label of ["字号", "字重", "字距", "段距", "首行缩进", "上边距", "下边距", "左边距", "右边距", "分栏间距"]) {
    assert.doesNotMatch(block, new RegExp(`>${label}<`), `高级设置内不应含 4 大分组项 ${label}`);
  }
});

// ============ D. 4 大分组 + 现有功能不破坏 ============

test("D1: 4 大分组（文本/段落/页面布局/笔记插入）仍在弹窗内", () => {
  for (const title of ["📖 文本设置", "📐 段落设置", "⬜ 页面布局", "📝 笔记插入"]) {
    assert.match(viewSrc, new RegExp(`>\\s*${title.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*<`), `4 大分组 ${title} 应仍在弹窗内`);
  }
});

test("D2: 4 大分组默认展开（open 属性）", () => {
  // 文本 + 段落 默认 open
  const matches = viewSrc.match(/<details class="reader-setting-section" open>/g);
  assert.ok(matches && matches.length >= 2, `默认展开的 details 应至少 2 个（文本 + 段落），实际 ${matches?.length}`);
});

test("D3: 页面布局 / 笔记插入 / 高级设置 默认折叠（无 open）", () => {
  const idx1 = viewSrc.indexOf("⬜ 页面布局");
  const idx2 = viewSrc.indexOf("📝 笔记插入");
  const idx3 = viewSrc.indexOf("⚙ 高级设置");
  for (const idx of [idx1, idx2, idx3]) {
    if (idx < 0) continue;
    // 找对应的 details 起始
    const detailStart = viewSrc.lastIndexOf("<details", idx);
    const detailEnd = viewSrc.indexOf("</details>", idx);
    const detailTag = viewSrc.slice(detailStart, Math.min(detailEnd, detailStart + 200));
    assert.doesNotMatch(detailTag, /<details[^>]*open[^>]*>/, "页面布局/笔记插入/高级设置应默认折叠");
  }
});

test("D4: 文本设置（字号/字重/字距）仍在弹窗内", () => {
  for (const label of ["字号", "字重", "字距"]) {
    assert.match(viewSrc, new RegExp(`>${label}<`), `文本设置应含 ${label}`);
  }
});

test("D5: 段落设置（行距/段距/首行缩进）仍在弹窗内", () => {
  for (const label of ["行距", "段距", "首行缩进"]) {
    assert.match(viewSrc, new RegExp(`>${label}<`), `段落设置应含 ${label}`);
  }
});

test("D6: 笔记插入（链接格式 textarea）仍存在", () => {
  // 链接格式 textarea 应存在
  assert.match(viewSrc, /setNoteLinkFormat/, "setNoteLinkFormat handler 应仍存在");
  assert.match(viewSrc, /linkFormat/, "linkFormat 设置项应仍存在");
});
