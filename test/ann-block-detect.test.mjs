import test from "node:test";
import assert from "node:assert/strict";
import { noteShouldUseLite } from "../src/annotation/ann-preview.ts";
import { hasBlockTable } from "../src/annotation/ann-editor.ts";
import { expandInlineTableRows } from "../src/annotation/annotation-render.ts";

/**
 * noteShouldUseLite 回归测试（2026-08-19 表格/块级渲染修复）。
 * 该函数决定批注预览走「静态兜底 Md2HTML」还是「lite Protyle 增强」：
 *  - 含任意块级结构（表格/标题/列表/引用/代码块/分割线/Callout/超级块）→ false（走静态兜底）
 *  - 仅行内格式 → true（可挂 lite Protyle）
 * 这是修复「表格被塌缩成 |...| 文本」的关键判断。
 */

test("noteShouldUseLite：纯行内加粗文本 → true", () => {
  assert.equal(noteShouldUseLite("这是 **重点** 词汇，需要掌握。"), true);
});

test("noteShouldUseLite：行内混合（加粗/高亮/链接） → true", () => {
  assert.equal(noteShouldUseLite("**bold** 与 ==mark== 与 [链接](https://x.com) 都属于行内。"), true);
});

test("noteShouldUseLite：空输入 → true（无块级，可走 lite）", () => {
  assert.equal(noteShouldUseLite(""), true);
  assert.equal(noteShouldUseLite("   "), true);
});

test("noteShouldUseLite：管道表格 → false", () => {
  const note = "前面有文本\n\n| 列1 | 列2 |\n| --- | --- |\n| a | b |\n\n下文";
  assert.equal(noteShouldUseLite(note), false);
});

test("noteShouldUseLite：省略边缘管道表格 → false", () => {
  assert.equal(noteShouldUseLite("Col1 | Col2\n--- | ---\na | b"), false);
});

test("noteShouldUseLite：对齐符表格（|:-:|） → false", () => {
  assert.equal(noteShouldUseLite("左 | 中 | 右\n:-- | :-: | --:\nx | y | z"), false);
});

test("noteShouldUseLite：单行空格分隔的伪表格 → false", () => {
  // AI/粘贴常把换行压成空格，整行只剩一个末尾 \n
  const note = "|问法|含义| | ------| ------------------------| |**What?**|什么？|\n";
  assert.equal(noteShouldUseLite(note), false);
});

test("noteShouldUseLite：末尾带换行的伪表格（真实数据形态） → false", () => {
  // 与用户实际批注一致：整段只有末尾一个 \n，表格行之间全是空格
  const note =
    "|问法|含义| | ------| ------------------------| |**What is the main idea of the passage?**|文章的主旨是什么？| |**Which sentence best summarizes the passage?**|哪个句子最能概括文章？|\n";
  assert.equal(noteShouldUseLite(note), false);
});

test("expandInlineTableRows：末尾带换行的伪表格也能展开", () => {
  const note =
    "|问法|含义| | ------| ------------------------| |**What is the main idea?**|文章主旨是什么？|\n";
  const out = expandInlineTableRows(note);
  assert.ok(out.includes("\n"), "应展开出换行符");
  const lines = out.split("\n").filter(Boolean);
  assert.ok(lines.length >= 3, `应拆出至少 3 行，实际 ${lines.length} 行`);
});

test("noteShouldUseLite：ATX 标题 → false", () => {
  assert.equal(noteShouldUseLite("## 本节重点\n一些说明文字。"), false);
});

test("noteShouldUseLite：有序/无序列表 → false", () => {
  assert.equal(noteShouldUseLite("- 項目一\n- 項目二"), false);
  assert.equal(noteShouldUseLite("1. 第一步\n2. 第二步"), false);
});

test("noteShouldUseLite：引用块 → false", () => {
  assert.equal(noteShouldUseLite("> 这是一句引用说明。"), false);
});

test("noteShouldUseLite：分割线 → false", () => {
  assert.equal(noteShouldUseLite("上文\n\n---\n\n下文"), false);
});

test("noteShouldUseLite：围栏代码块 → false", () => {
  assert.equal(noteShouldUseLite("示例：\n```\nconst a = 1;\n```"), false);
});

test("noteShouldUseLite：Callout / 超级块 → false", () => {
  assert.equal(noteShouldUseLite("::: info\n提示内容\n:::"), false);
  assert.equal(noteShouldUseLite("{{ 超级块内容 }}"), false);
});

test("noteShouldUseLite：旧 HTML 块级标签（table/div/p） → false", () => {
  assert.equal(noteShouldUseLite("<table><tr><td>a</td></tr></table>"), false);
  assert.equal(noteShouldUseLite("<div>包裹文本</div>"), false);
  assert.equal(noteShouldUseLite("<p>段落</p>"), false);
});

/**
 * hasBlockTable 回归测试：编辑态分流提示用。
 * lite Protyle（blockId:""）对表格仅支持单元格文本编辑，故含表格时需给出能力提示。
 */
test("hasBlockTable：HTML <table> → true", () => {
  assert.equal(hasBlockTable("<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>"), true);
});

test("hasBlockTable：管道表格 → true", () => {
  assert.equal(hasBlockTable("| 列1 | 列2 |\n| --- | --- |\n| a | b |"), true);
});

test("hasBlockTable：纯行内文本 → false", () => {
  assert.equal(hasBlockTable("只是普通批注，没有表格。"), false);
});

test("hasBlockTable：含单个管道但无分隔行 → false", () => {
  assert.equal(hasBlockTable("选项 A | 选项 B\n普通说明文字。"), false);
});

/**
 * expandInlineTableRows 回归测试（2026-08-19 修复：贪婪正则吞行导致表格不展开）。
 * 该函数把「单行空格分隔的伪 Markdown 表格」拆成多行，是侧栏 Lute 渲染表格的前提。
 */
test("expandInlineTableRows：单行伪表格被正确展开为多行", () => {
  const input = "|问法|含义| | ------| ------------------------| |What is the main idea?|文章主旨是什么？|";
  const out = expandInlineTableRows(input);
  // 必须出现换行（拆成多行），且行数 >= 3（表头/分隔/数据）
  assert.ok(out.includes("\n"), "应展开出换行符");
  const lines = out.split("\n").filter(Boolean);
  assert.ok(lines.length >= 3, `应拆出至少 3 行，实际 ${lines.length} 行`);
  // 分隔行应被识别保留
  assert.ok(lines.some((l) => /^-{2,}/.test(l) || /^\s*\|?[\s:\-|]+\|?\s*$/.test(l)), "应保留分隔行");
});

test("expandInlineTableRows：多行表格原样返回（不破坏）", () => {
  const input = "| 列1 | 列2 |\n| --- | --- |\n| a | b |";
  assert.equal(expandInlineTableRows(input), input);
});

test("expandInlineTableRows：无表格的普通行内文本原样返回", () => {
  const input = "这是 **重点** 词汇，需要掌握。";
  assert.equal(expandInlineTableRows(input), input);
});
