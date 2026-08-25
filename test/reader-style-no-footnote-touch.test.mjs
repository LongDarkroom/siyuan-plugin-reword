// 阅读器 - "不碰脚注"测试
// ----------------------------------------------------------------
// 用户 2026-08-23 明确反馈：「不要隐藏注脚」+「千万千万不要改变书籍文件中内容」
//
// 覆盖：
// - buildReaderStyles 输出 CSS 字符串中**不包含**任何隐藏/影响脚注的规则
//   （aside[epub|type="footnote"] / sup a img.epub-footnote 不应被 display:none 等）
// - 输出不包含 element.style 写入 / 元素 textContent 写入（仅产出 CSS 字符串）
// - 输出能被 setStyles() 安全消费（CSS 字符串格式）
// - 输出不修改 epub xhtml 文件
//
// 这些测试的 negative intent：若未来有人想"优化脚注显示"，CI 会失败提醒再确认用户。
// 不依赖：foliate / siyuan SDK

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReaderStyles, inlineOverrideStyles, headingStyles, listStyles, wordWrapStyles } from "../src/reader/reader-style.ts";

const lightPreset = { bg: "#ffffff", fg: "#222222", fg2: "#888888" };
const normalLineWidth = { padding: "2em 1.5em" };

function mkSettings(overrides = {}) {
  return {
    fontSize: 17,
    lineHeight: 1.7,
    theme: "light",
    lineWidth: "normal",
    fontMode: "follow-siyuan",
    ...overrides,
  };
}

test("buildReaderStyles 输出 CSS 不隐藏 <aside epub:type=footnote>", () => {
  const css = buildReaderStyles(mkSettings(), lightPreset, normalLineWidth, "");
  // 负面断言：不应有任何规则隐藏脚注
  assert.doesNotMatch(css, /aside\[epub[^\]]*type=["']?footnote["']?\]/i,
    "should not have a selector for aside[epub|type=footnote]");
  // 也不应有 visibility:hidden / display:none 应用到 aside
  assert.doesNotMatch(css, /aside\s*\{[^}]*display\s*:\s*none/i,
    "should not set display:none on aside");
  assert.doesNotMatch(css, /aside\s*\{[^}]*visibility\s*:\s*hidden/i,
    "should not set visibility:hidden on aside");
  assert.doesNotMatch(css, /aside\s*\{[^}]*opacity\s*:\s*0/i,
    "should not set opacity:0 on aside");
});

test("buildReaderStyles 输出 CSS 不隐藏脚注引用图片 <a epub:type=noteref> img", () => {
  const css = buildReaderStyles(mkSettings(), lightPreset, normalLineWidth, "");
  // 负面断言：不应有针对脚注图片的 display:none
  assert.doesNotMatch(css, /a\[epub[^\]]*type=["']?noteref["']?\]\s*img/i,
    "should not have a selector for noteref img");
  assert.doesNotMatch(css, /sup\s+a\s+img\.epub-footnote/i,
    "should not have a selector for sup a img.epub-footnote");
  assert.doesNotMatch(css, /sup\s*\{[^}]*display\s*:\s*none/i,
    "should not set display:none on sup");
  // 也不应修改 sup 的字号或位置（用户原样显示）
  assert.doesNotMatch(css, /sup\s*\{[^}]*font-size\s*:/i,
    "should not modify sup font-size (preserve original)");
  assert.doesNotMatch(css, /sup\s*\{[^}]*vertical-align\s*:/i,
    "should not modify sup vertical-align (preserve original)");
});

test("buildReaderStyles 输出是纯 CSS 字符串（不写 JS / 不写 DOM）", () => {
  const css = buildReaderStyles(mkSettings(), lightPreset, normalLineWidth, "");
  // 不应包含任何 JS 关键字
  for (const keyword of ["function", "document.", "window.", "element.", "getElementById", "querySelector", "innerHTML", "outerHTML", "textContent", "setAttribute", "removeAttribute", ".style."]) {
    assert.doesNotMatch(css, new RegExp(keyword.replace(/\./g, "\\."), "i"),
      `CSS output should not contain "${keyword}"`);
  }
});

test("buildReaderStyles 输出 CSS 不含 HTML 标签", () => {
  const css = buildReaderStyles(mkSettings(), lightPreset, normalLineWidth, "");
  // 不应包含任何 HTML 标签（除了 CSS 注释 / 字符串中的偶然字符）
  for (const tag of ["<div", "<p ", "<span", "<aside", "<sup", "<img", "<a "]) {
    assert.doesNotMatch(css, new RegExp(tag, "i"), `CSS output should not contain "${tag}"`);
  }
});

test("buildReaderStyles 输出不含 EPUB 文件写回指令（saveData / file: / fetch / PUT / POST）", () => {
  const css = buildReaderStyles(mkSettings(), lightPreset, normalLineWidth, "");
  // 不应包含写回 EPUB 文件的指令
  for (const keyword of ["saveData", "fetch(", "fetchSync", "XMLHttpRequest", "PUT", "POST", "file://", "blob:", "JSZip", "writeFile"]) {
    assert.doesNotMatch(css, new RegExp(keyword.replace(/[().]/g, m => "\\" + m), "i"),
      `CSS output should not contain "${keyword}"`);
  }
});

test("buildReaderStyles 输出可作为 foliate view.renderer.setStyles() 输入（CSS 字符串）", () => {
  const css = buildReaderStyles(mkSettings(), lightPreset, normalLineWidth, "");
  // foliate setStyles 接受 string | [before, after]；我们传 string
  assert.equal(typeof css, "string");
  // CSS 字符串基本完整（{} 配对）
  const opens = (css.match(/\{/g) || []).length;
  const closes = (css.match(/\}/g) || []).length;
  assert.equal(opens, closes, `unbalanced braces: ${opens} open vs ${closes} close`);
});

test("buildReaderStyles 输出不含 .remove() / .delete() / 任何 DOM 删除 API", () => {
  const css = buildReaderStyles(mkSettings(), lightPreset, normalLineWidth, "");
  for (const api of [".remove()", ".delete()", "deleteNode", "removeChild"]) {
    assert.doesNotMatch(css, new RegExp(api.replace(/[().]/g, m => "\\" + m), "i"),
      `CSS output should not contain "${api}"`);
  }
});

test("各子函数也不碰脚注（仅无参函数：inlineOverrideStyles/headingStyles/listStyles/wordWrapStyles）", () => {
  // 验证无参子函数直接调用不输出脚注/footnote/noteref 相关
  // 注：部分函数带 (o) 参数（paragraphStyles 等），它们的副作用已被 buildReaderStyles 全集验证
  const noArgFns = [inlineOverrideStyles, headingStyles, listStyles, wordWrapStyles];
  for (const fn of noArgFns) {
    assert.equal(fn.length, 0, `${fn.name} should be no-arg for direct test`);
    const css = fn();
    assert.doesNotMatch(css, /aside/i, `${fn.name} should not reference aside`);
    assert.doesNotMatch(css, /footnote/i, `${fn.name} should not reference footnote`);
    assert.doesNotMatch(css, /noteref/i, `${fn.name} should not reference noteref`);
  }
});
