// 阅读器 - !important 优先级测试
// ----------------------------------------------------------------
// 覆盖 buildReaderStyles 输出中 !important 的完整性：
// - body bg/fg/font-family/line-height/padding 全部带 !important
// - 段距 p { margin } 带 !important（覆盖 epub 内联 style）
// - 内联覆盖 p span { font-size: inherit !important } 必须带 !important
//   （epub 内联 style="font-size:16px" specificity 1,0,0,0，普通选择器压不过）
// - 标题 h1-h6 font-size/line-height/margin 带 !important
// - 引用 blockquote border-left/margin/padding/font-style 带 !important
// - 列表 ul/ol/li 带 !important
// - 链接 a 带 !important
// - 代码 pre 带 !important
// 不依赖：foliate / siyuan SDK

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReaderStyles,
  bodyStyles,
  paragraphStyles,
  inlineOverrideStyles,
  headingStyles,
  quoteStyles,
  listStyles,
  linkStyles,
  codeStyles,
  deriveStyleOutput,
  fontFamilyStyles,
} from "../src/reader/reader-style.ts";

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

test("body 主题 4 项均带 !important（bg/fg/line-height/padding）", () => {
  // 2026-08-23 修复：bodyStyles 不再含 font-family（由 fontFamilyStyles 单独输出）
  const o = deriveStyleOutput(mkSettings(), lightPreset, normalLineWidth);
  const css = bodyStyles(o, mkSettings());
  for (const prop of ["background", "color", "line-height", "padding"]) {
    // 找到 body { ... } 块
    const m = css.match(/body\s*\{([^}]*)\}/);
    assert.ok(m, "should have body block");
    const body = m[1];
    assert.ok(body.includes(`${prop}:`), `body should have ${prop}`);
    // 找该 prop 所在声明，确认带 !important
    const decl = body.match(new RegExp(`${prop}\\s*:[^;]*`));
    assert.ok(decl, `body should have ${prop} declaration`);
    assert.match(decl[0], /!important/, `body ${prop} should have !important: ${decl[0]}`);
  }
});

test("bodyStyles 不输出 font-family（避免覆盖宿主字体如霞鹜文楷）", () => {
  const o = deriveStyleOutput(mkSettings(), lightPreset, normalLineWidth);
  const css = bodyStyles(o, mkSettings());
  assert.doesNotMatch(css, /font-family/i, "bodyStyles should not output font-family (2026-08-23 修复)");
});

test("fontFamilyStyles 单一职责输出 body font-family 段", () => {
  const css = fontFamilyStyles('"LXGW WenKai", "PingFang SC", sans-serif');
  assert.match(css, /body\s*\{\s*font-family:\s*"LXGW WenKai",\s*"PingFang SC",\s*sans-serif\s*!important/);
});

test("段落 p { margin: 0.6em 0 } 带 !important（核心段距修复）", () => {
  const css = paragraphStyles();
  const m = css.match(/p\s*\{([^}]*)\}/);
  assert.ok(m, "should have p block");
  assert.match(m[1], /margin:\s*0\.6em\s*0\s*!important/, "p margin should have !important");
  assert.match(m[1], /line-height:\s*inherit\s*!important/, "p line-height should have !important");
  assert.match(m[1], /text-align:\s*justify\s*!important/, "p text-align should have !important");
});

test("内联覆盖 p span { font-size: inherit !important } 必须带 !important（否则覆盖不到内联 style）", () => {
  const css = inlineOverrideStyles();
  // inlineOverrideStyles 是多选择器单块（p span, p div, ...）共享同一组声明
  // 验证整体输出含 p span 等关键选择器 + 4 个 inherit !important 声明
  for (const sel of ["p span", "p div", "p b", "p i"]) {
    assert.ok(css.includes(sel), `inlineOverrideStyles should include selector: ${sel}`);
  }
  // 4 个 inherit !important（font-size / font-family / font-style / font-weight）
  const inhs = css.match(/inherit\s*!important/g) || [];
  assert.ok(inhs.length >= 4, `expected ≥ 4 inherit !important declarations, got ${inhs.length}: ${css}`);
});

test("标题 h1-h6 字号 / 行高 / 边距均带 !important", () => {
  const css = headingStyles();
  for (const h of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    const re = new RegExp(`^${h}\\s*\\{([^}]*)\\}`, "m");
    const m = re.exec(css);
    assert.ok(m, `should have ${h} block`);
    const block = m[1];
    assert.match(block, /font-size:\s*[\d.]+em\s*!important/, `${h} font-size should have !important: ${block}`);
  }
  // 公共 h1-h6 块
  const m = css.match(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{([^}]*)\}/);
  assert.ok(m, "should have shared h1-h6 block");
  const shared = m[1];
  assert.match(shared, /font-weight:\s*600\s*!important/, "shared h block font-weight should have !important");
  assert.match(shared, /line-height:\s*1\.3\s*!important/, "shared h block line-height should have !important");
  assert.match(shared, /margin:\s*1em\s*0\s*0\.5em\s*!important/, "shared h block margin should have !important");
});

test("引用 blockquote 边距 / 内边距 / 边框 / 字体均带 !important", () => {
  const css = quoteStyles();
  const m = css.match(/blockquote\s*\{([^}]*)\}/);
  assert.ok(m, "should have blockquote block");
  for (const prop of ["margin", "padding", "border-left", "font-style"]) {
    const decl = m[1].match(new RegExp(`${prop}\\s*:[^;]+`));
    assert.ok(decl, `blockquote should have ${prop}`);
    assert.match(decl[0], /!important/, `blockquote ${prop} should have !important: ${decl[0]}`);
  }
});

test("列表 ul,ol { margin } / li { margin } 带 !important", () => {
  const css = listStyles();
  const ul = css.match(/ul,\s*ol\s*\{([^}]*)\}/);
  assert.ok(ul, "should have ul,ol block");
  const ulDecl = ul[1].match(/margin\s*:[^;]+/);
  assert.ok(ulDecl, "ul,ol should have margin");
  assert.match(ulDecl[0], /!important/, `ul,ol margin should have !important: ${ulDecl[0]}`);

  const li = css.match(/li\s*\{([^}]*)\}/);
  assert.ok(li, "should have li block");
  const liDecl = li[1].match(/margin\s*:[^;]+/);
  assert.ok(liDecl, "li should have margin");
  assert.match(liDecl[0], /!important/, `li margin should have !important: ${liDecl[0]}`);
});

test("链接 a 颜色带 !important（跟随思源 --b3-protyle-inline-link-color，fallback #185FA5）", () => {
  const css = linkStyles();
  assert.match(css, /a\s*\{\s*color:\s*var\(--b3-protyle-inline-link-color,\s*#185FA5\)\s*!important/, "a color should use siyuan var with fallback");
});

test("代码块 pre 背景带 !important（跟随思源 --b3-protyle-code-background，fallback rgba(128,128,128,.08)）", () => {
  const css = codeStyles();
  assert.match(css, /pre\s*\{[^}]*background:\s*var\(--b3-protyle-code-background,\s*rgba\(128,128,128,0\.08\)\)\s*!important/, "pre bg should use siyuan var");
});

test("buildReaderStyles 总输出 !important 出现次数 ≥ 30（防回归被砍）", () => {
  const css = buildReaderStyles(mkSettings(), lightPreset, normalLineWidth, "");
  const count = (css.match(/!important/g) || []).length;
  assert.ok(count >= 30, `expected ≥ 30 !important occurrences, got ${count}`);
});

test("buildReaderStyles 输出 !important 全为合法格式（不出现 !importantty / !importantxx 等）", () => {
  const css = buildReaderStyles(mkSettings(), lightPreset, normalLineWidth, "");
  // !important 前后只能是 ; 或 } 或空白或末尾
  const matches = css.match(/![a-zA-Z]+/g) || [];
  for (const m of matches) {
    assert.equal(m, "!important", `unexpected ! token in CSS: ${m}`);
  }
});
