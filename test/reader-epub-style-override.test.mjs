// 阅读器 - EPUB 排版增强样式输出测试
// ----------------------------------------------------------------
// 覆盖 buildReaderStyles() 输出的关键 CSS 段：
// - 段距 p { margin: 0.6em 0 }
// - fontFamilyStack（用户字体 + CJK fallback）正确注入
// - 取消 epub 内联 style（p span { font-size: inherit !important }）
// - 标题层级 h1-h6
// - 引用块 blockquote
// - 列表 ul/ol/li
// - 图片 figure/figcaption
// - word-wrap 防超长英文/URL 撑出右边界
// - 主题色（bg/fg）正确注入
// 不依赖：foliate / siyuan SDK

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReaderStyles,
  deriveStyleOutput,
  paragraphStyles,
  inlineOverrideStyles,
  headingStyles,
  quoteStyles,
  listStyles,
  figureStyles,
  bodyStyles,
  linkStyles,
  codeStyles,
  colorSchemeStyles,
  wordWrapStyles,
  getDefaultCjkFontStack,
} from "../src/reader/reader-style.ts";

/** 构造最小可用的 settings / 预设 */
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

const lightPreset = { bg: "#ffffff", fg: "#222222", fg2: "#888888" };
const darkPreset = { bg: "#121212", fg: "#d6d6d6", fg2: "#888888" };
const normalLineWidth = { padding: "2em 1.5em" };

/** 默认 fontFamilyStack = CJK fallback（多数测试不关心字体） */
const defaultFontStack = getDefaultCjkFontStack();

/** buildReaderStyles 5 参数便捷调用 */
function build(settings = mkSettings(), preset = lightPreset, lw = normalLineWidth, fontFace = "", fontStack = defaultFontStack) {
  return buildReaderStyles(settings, preset, lw, fontFace, fontStack);
}

test("buildReaderStyles 输出含必含段：段距/字体/内联覆盖/标题/引用/列表/图片/word-wrap", () => {
  const css = build();
  // 段距
  assert.match(css, /p\s*\{[^}]*margin:\s*0\.6em\s*0\s*!important/);
  // fontFamilyStack 注入（CJK fallback）
  assert.match(css, /font-family[^;]*PingFang SC/);
  assert.match(css, /font-family[^;]*Microsoft YaHei/);
  assert.match(css, /font-family[^;]*Noto Sans CJK SC/);
  // 内联覆盖
  assert.match(css, /p\s+span[^}]*font-size:\s*inherit\s*!important/);
  assert.match(css, /p\s+span[^}]*font-family:\s*inherit\s*!important/);
  // 标题
  assert.match(css, /h1\s*\{[^}]*font-size:\s*1\.6em\s*!important/);
  assert.match(css, /h2\s*\{[^}]*font-size:\s*1\.4em\s*!important/);
  // 引用
  assert.match(css, /blockquote\s*\{[^}]*border-left:\s*3px solid currentColor\s*!important/);
  // 列表
  assert.match(css, /ul,\s*ol\s*\{[^}]*margin:\s*0\.6em\s*0/);
  assert.match(css, /li\s*\{[^}]*margin:\s*0\.3em\s*0/);
  // 图片
  assert.match(css, /figure\s*\{[^}]*text-align:\s*center\s*!important/);
  // word-wrap
  assert.match(css, /overflow-wrap:\s*break-word/);
});

test("body 主题色正确注入（light 主题）", () => {
  const css = build();
  assert.match(css, /background:\s*#ffffff\s*!important/);
  assert.match(css, /color:\s*#222222\s*!important/);
});

test("body 主题色正确注入（dark 主题）", () => {
  const css = build(mkSettings({ theme: "dark" }), darkPreset);
  assert.match(css, /background:\s*#121212\s*!important/);
  assert.match(css, /color:\s*#d6d6d6\s*!important/);
});

test("body 主题色正确注入（custom 主题 + customBg/customFg）", () => {
  const css = build(mkSettings({ theme: "custom", customBg: "#fffbe6", customFg: "#5a4632" }));
  assert.match(css, /background:\s*#fffbe6\s*!important/);
  assert.match(css, /color:\s*#5a4632\s*!important/);
});

test("color-scheme 在暗主题时切换为 dark", () => {
  const css = build(mkSettings({ theme: "night" }), darkPreset);
  assert.match(css, /color-scheme:\s*dark/);
});

test("color-scheme 在亮主题时为 light", () => {
  const css = build();
  assert.match(css, /color-scheme:\s*light/);
});

test("行宽 padding 注入（normal=2em 1.5em）", () => {
  const css = build();
  assert.match(css, /padding:\s*2em 1\.5em\s*!important/);
});

test("行高 line-height 注入", () => {
  const css = build(mkSettings({ lineHeight: 1.9 }));
  assert.match(css, /line-height:\s*1\.9\s*!important/);
});

test("fontFaceCss 参数原样拼接到开头（@font-face 段）", () => {
  const userFont = '@font-face { font-family: "LXGW WenKai"; src: url(blob:abc); }';
  const css = build(mkSettings(), lightPreset, normalLineWidth, userFont, '"LXGW WenKai", serif');
  // fontFaceCss 出现在 buildReaderStyles 输出起始
  assert.ok(css.startsWith(userFont), `fontFaceCss should be at start of output, got: ${css.slice(0, 100)}`);
});

test("fontFamilyStack 注入到 body 块（单一职责）", () => {
  const userStack = '"LXGW WenKai", "Microsoft YaHei", sans-serif';
  const css = build(mkSettings(), lightPreset, normalLineWidth, "", userStack);
  assert.match(css, new RegExp(`body\\s*\\{[^}]*font-family:\\s*${userStack.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*!important`));
});

test("内联覆盖覆盖 p/li/blockquote/h 的 span/div/b/i/em/strong/a", () => {
  const css = inlineOverrideStyles();
  for (const sel of ["p span", "p div", "p b", "p i", "p em", "p strong", "p a",
                      "li span", "li div", "li b", "li i", "li em", "li strong", "li a",
                      "blockquote span", "blockquote div", "blockquote b", "blockquote i",
                      "h1 span", "h2 span", "h3 span", "h4 span", "h5 span", "h6 span"]) {
    assert.ok(css.includes(sel), `inlineOverrideStyles should include selector: ${sel}`);
  }
});

test("标题层级覆盖 6 档（h1-h6）", () => {
  const css = headingStyles();
  for (const h of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    assert.ok(css.includes(`${h} {`), `headingStyles missing ${h}`);
  }
});

test("deriveStyleOutput 处理 custom 主题（customBg/customFg 优先于预设）", () => {
  const o = deriveStyleOutput(
    mkSettings({ theme: "custom", customBg: "#fffbe6", customFg: "#5a4632" }),
    lightPreset,
    normalLineWidth
  );
  assert.equal(o.bg, "#fffbe6");
  assert.equal(o.fg, "#5a4632");
  assert.equal(o.isDark, false);
});

test("deriveStyleOutput 标记 isDark 主题（dark/night/gold）", () => {
  for (const t of ["dark", "night", "gold"]) {
    const o = deriveStyleOutput(mkSettings({ theme: t }), darkPreset, normalLineWidth);
    assert.equal(o.isDark, true, `${t} should be isDark`);
  }
  for (const t of ["light", "almond", "autumn", "green", "blue", "custom"]) {
    const o = deriveStyleOutput(mkSettings({ theme: t }), lightPreset, normalLineWidth);
    assert.equal(o.isDark, false, `${t} should NOT be isDark`);
  }
});

test("所有子函数均被 buildReaderStyles 调用", () => {
  const css = build();
  assert.match(css, /p\s*\{[^}]*margin:\s*0\.6em\s*0/);                  // paragraphStyles
  assert.match(css, /p span[\s\S]*?font-size:\s*inherit/);                // inlineOverrideStyles
  assert.match(css, /h1\s*\{[^}]*1\.6em/);                                // headingStyles
  assert.match(css, /blockquote\s*\{[^}]*border-left/);                    // quoteStyles
  assert.match(css, /ul,\s*ol\s*\{/);                                      // listStyles
  assert.match(css, /figure\s*\{[^}]*text-align:\s*center/);              // figureStyles
  assert.match(css, /body\s*\{[^}]*background:\s*#ffffff/);               // bodyStyles
  assert.match(css, /a\s*\{\s*color:\s*var\(--b3-protyle-inline-link-color,\s*#185FA5\)/);   // linkStyles
  assert.match(css, /pre\s*\{[^}]*background:\s*var\(--b3-protyle-code-background,\s*rgba\(128,128,128,0\.08\)\)/);  // codeStyles
  assert.match(css, /color-scheme:\s*light/);                              // colorSchemeStyles
  assert.match(css, /overflow-wrap:\s*break-word/);                       // wordWrapStyles
  // fontFamilyStyles
  assert.match(css, /body\s*\{[^}]*font-family:[^}]*!important/);
});
