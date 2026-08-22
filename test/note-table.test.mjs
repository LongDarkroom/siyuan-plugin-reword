import test from "node:test";
import assert from "node:assert/strict";
import { noteContainsTable } from "../src/annotation/ann-preview.ts";

/**
 * noteContainsTable 回归测试（2026-08-18 表格修复补强）。
 * 根因：原检测强制要求表头/分隔行首尾带 `|`，漏判了 SiYuan/Kramdown
 * 省略左右边缘 `|` 的管道表格，使其被 lite Protyle 渲染成原始 `|...|` 文本。
 * 修复后需兼容带边缘与省略边缘两种写法，并已含 HTML <table> 也能命中。
 */

test("noteContainsTable：带边缘管道的标准 GFM 表格 → true", () => {
  const note = "前面有文本\n\n| 列1 | 列2 |\n| --- | --- |\n| a | b |\n\n下文";
  assert.equal(noteContainsTable(note), true);
});

test("noteContainsTable：省略边缘管道（SiYuan/Kramdown 写法） → true", () => {
  const note = "Col1 | Col2\n--- | ---\na | b";
  assert.equal(noteContainsTable(note), true);
});

test("noteContainsTable：首列分隔符无前置管道（截图同格式） → true", () => {
  // 用户截图中表格分隔行为：| ------| ---------------------|
  // 即行首有边缘管道，但第一列分隔符前无管道，需被识别为表格
  const note = "|问法|含义|\n| ------| ---------------------|\n|What...|文章的主旨...|";
  assert.equal(noteContainsTable(note), true);
});

test("noteContainsTable：省略边缘管道且带对齐符 → true", () => {
  const note = "左 | 中 | 右\n:-- | :-: | --:\nx | y | z";
  assert.equal(noteContainsTable(note), true);
});

test("noteContainsTable：已含 HTML <table> → true", () => {
  const note = "<p>说明</p><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>";
  assert.equal(noteContainsTable(note), true);
});

test("noteContainsTable：普通段落（无管道） → false", () => {
  const note = "这是一段普通批注，没有任何表格内容。\n第二行也没有。";
  assert.equal(noteContainsTable(note), false);
});

test("noteContainsTable：含单个管道但无分隔行 → false", () => {
  // 仅一行带 |，下一行不是分隔行，不应误判为表格
  const note = "选项 A | 选项 B\n这是普通说明文字，不是分隔行。";
  assert.equal(noteContainsTable(note), false);
});

test("noteContainsTable：分隔行缺失 → false", () => {
  const note = "| 列1 | 列2 |\n普通行\n| a | b |";
  assert.equal(noteContainsTable(note), false);
});

test("noteContainsTable：空输入 → false", () => {
  assert.equal(noteContainsTable(""), false);
});
