// 竖排标点替换测试（2026-10-06）
// 覆盖：简繁映射差异、标签属性保护、文本长度不变（CFI 安全）、幂等性
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  transformVerticalPunctuation,
  shouldUseHant,
} from "../src/reader/vertical-punctuation.ts";

const stripTags = (s) => s.replace(/<[^>]+>/g, "");

test("简体映射：双引号→﹃﹄，单引号/直角引号→﹁﹂", () => {
  const out = transformVerticalPunctuation("<p>“好”‘来’「引」『强』</p>", false);
  assert.equal(out, "<p>﹃好﹄﹁来﹂﹁引﹂﹃强﹄</p>");
});

test("繁体映射：双引号与单引号的竖排字形归属与简体相反", () => {
  const out = transformVerticalPunctuation("<p>“好”‘来’</p>", true);
  // 繁：横排双引号 → 竖排单引号字形 ﹁﹂；横排单引号 → 竖排双引号字形 ﹃﹄
  assert.equal(out, "<p>﹁好﹂﹃来﹄</p>");
});

test("标签属性里的引号不被替换（保护 title 等）", () => {
  const html = '<a title="他说“话”">链接</a>';
  assert.equal(transformVerticalPunctuation(html, false), html);
});

test("纯文本长度不变 ⇒ 不破坏 EPUB CFI 定位与已有标注", () => {
  const html = "<p>他说“来吧”，然后说‘好’。「引用」和『强调』都试。</p>";
  const out = transformVerticalPunctuation(html, false);
  assert.equal(stripTags(html).length, stripTags(out).length);
});

test("已是竖排字形的内容不再被改动（不会二次替换）", () => {
  const html = "<p>﹃来吧﹄﹁好﹂</p>";
  assert.equal(transformVerticalPunctuation(html, false), html);
});

test("无引号 / 空串：原样返回", () => {
  assert.equal(transformVerticalPunctuation("<p>纯文本</p>", false), "<p>纯文本</p>");
  assert.equal(transformVerticalPunctuation("", false), "");
});

test("shouldUseHant：繁体地区语言判定", () => {
  assert.equal(shouldUseHant("zh-TW", "zh-CN"), true);
  assert.equal(shouldUseHant("zh-Hant", "zh-CN"), true);
  assert.equal(shouldUseHant("zh-CN", "zh-CN"), false);
  assert.equal(shouldUseHant(undefined, undefined), false);
  // 书籍语言优先，其次界面语言
  assert.equal(shouldUseHant("zh-CN", "zh-TW"), true);
});
