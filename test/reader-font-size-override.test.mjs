/**
 * 字号覆盖段（fontSizeOverrideStyles）测试 —— 2026-08-27 修复「字号设置无效」
 *
 * 根因回归背景：
 * 《Nate the Great on the Owl Express》正文 p.k_nonindent_lh { font-size: medium }，
 * CSS 关键字 medium 不随 html 根字号缩放 → 旧实现只有 html { font-size } 时 A+/A- 无反应。
 * 修复：body font-size !important + 正文容器 font-size: inherit !important 压平书籍字号。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildReaderStyles, fontSizeOverrideStyles } from "../src/reader/reader-style.ts";

const BASE = {
  lineHeight: 1.7,
  theme: "light",
  lineWidth: "normal",
  fontMode: "follow-siyuan",
};

test("flatten=true：输出 body { font-size: Xpx !important }（压过书籍 p.k_nonindent_lh { font-size: medium } 的前提）", () => {
  const css = fontSizeOverrideStyles(19, true);
  assert.match(css, /body\s*\{\s*font-size:\s*19px\s*!important/);
});

test("flatten=true：正文容器 font-size: inherit !important（压平书籍写死字号）", () => {
  const css = fontSizeOverrideStyles(19, true);
  assert.match(css, /p,\s*li,\s*blockquote,\s*div,\s*dd,\s*dt,\s*td,\s*th\s*\{[^}]*font-size:\s*inherit\s*!important/);
});

test("flatten=true：仍输出 html 根字号", () => {
  const css = fontSizeOverrideStyles(21, true);
  assert.match(css, /html\s*\{\s*font-size:\s*21px/);
});

test("flatten=false：仅 html 根字号，不输出 body/inherit 覆盖（保留书籍原排版）", () => {
  const css = fontSizeOverrideStyles(19, false);
  assert.match(css, /html\s*\{\s*font-size:\s*19px/);
  assert.doesNotMatch(css, /font-size:\s*19px\s*!important/);
  assert.doesNotMatch(css, /inherit\s*!important/);
});

test("默认（overrideBookFontSize 缺省）：buildReaderStyles 开启压平（向后兼容）", () => {
  const css = buildReaderStyles(
    { ...BASE, fontSize: 17 },
    { bg: "#ffffff", fg: "#222222", fg2: "#888888" },
    { padding: "2em 1.5em" },
    "",
    "sans-serif"
  );
  assert.match(css, /body\s*\{[^}]*font-size:\s*17px\s*!important/);
  assert.match(css, /p,\s*li,[^}]*font-size:\s*inherit\s*!important/);
});

test("overrideBookFontSize=false：buildReaderStyles 关闭压平（保留书籍字号）", () => {
  const css = buildReaderStyles(
    { ...BASE, fontSize: 17, overrideBookFontSize: false },
    { bg: "#ffffff", fg: "#222222", fg2: "#888888" },
    { padding: "2em 1.5em" },
    "",
    "sans-serif"
  );
  assert.match(css, /html\s*\{\s*font-size:\s*17px/);
  assert.doesNotMatch(css, /font-size:\s*17px\s*!important/);
});

test("压平不误伤：标题 h1-h6 保持 em 相对值（随 body 等比缩放），figcaption 不在压平列表", () => {
  const css = buildReaderStyles(
    { ...BASE, fontSize: 17 },
    { bg: "#ffffff", fg: "#222222", fg2: "#888888" },
    { padding: "2em 1.5em" },
    "",
    "sans-serif"
  );
  assert.match(css, /h1\s*\{[^}]*font-size:\s*1\.6em\s*!important/);
  // fontSizeOverrideStyles 的容器列表不应包含 h1/figcaption
  const seg = fontSizeOverrideStyles(17, true);
  assert.doesNotMatch(seg, /h1|h2|h3|figcaption/);
});
