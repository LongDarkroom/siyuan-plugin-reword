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
  paragraphLayoutStyles,
  verticalWritingStyles,
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

test("body 主题 3 项均带 !important（bg/fg/line-height）", () => {
  // 2026-08-23 修复：bodyStyles 不再含 font-family（由 fontFamilyStyles 单独输出）
  // 2026-08-31 修正：padding 已从 bodyStyles 迁出，改由页面布局函数输出
  //   `body { padding: T R B L !important }`（4 边距滑块 / 三档预设统一驱动，见
  //   reader-style.ts 的 layoutStyles）。故此处不再断言 bodyStyles 含 padding，
  //   避免与「padding 确实存在且带 !important」的事实冲突。
  const o = deriveStyleOutput(mkSettings(), lightPreset, normalLineWidth);
  const css = bodyStyles(o, mkSettings());
  for (const prop of ["background", "color", "line-height"]) {
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
  // 2026-10-06：fontFamilyStyles 现经 withDigitFix() 在栈首注入 DIGIT_FIX_FAMILY
  // （"RW Digit Fix"，修正书籍字体破坏数字/标点字形），故断言不再写死栈首。
  assert.match(css, /body\s*\{\s*font-family:[^;]*"LXGW WenKai",\s*"PingFang SC",\s*sans-serif\s*!important/);
  // 关键回归：用户选定的字体必须仍在栈内（顺序可被数字字体前置）
  assert.match(css, /"LXGW WenKai"/, "用户选定字体应保留在 font-family 栈内");
  assert.match(css, /!important/, "font-family 需带 !important 压过书籍内联样式");
});

test("段落 p { margin: 0.6em 0 } 带 !important（核心段距修复）", () => {
  const css = paragraphStyles();
  const m = css.match(/p\s*\{([^}]*)\}/);
  assert.ok(m, "should have p block");
  assert.match(m[1], /margin:\s*0\.6em\s*0\s*!important/, "p margin should have !important");
  // 2026-10-06：段落级排版改由 paragraphLayoutStyles 按 overrideBookLayout 门控施加，
  // 此处**不再**声明 line-height / text-align / text-indent。
  // 原因：旧版 `line-height: inherit !important` 会架空用户的行距滑块
  // （inherit 取的是 body 值，而 body 上的书籍脏值又未被清洗），
  // 且 `text-indent: 0 !important` 靠注入顺序压过用户缩进滑块（脆弱）。
  // ⚠️ 断言只扫 p 的**规则体**（m[1]），不扫整段 CSS —— 否则会误匹配到
  //    解释这次改动的注释文字（注释里就写着这两个旧值）。
  // 2026-10-06：p 规则体内新增了 padding-left/right 清零，其后的说明注释里
  // 出现了 "line-height" / "text-indent" 字样 —— 必须先剥注释再断言，
  // 否则 doesNotMatch 会被注释文字命中（假失败）。
  const pBody = m[1].replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(
    pBody,
    /line-height/,
    "p 规则体内不应再有 line-height（会架空用户行距设置）",
  );
  assert.doesNotMatch(
    pBody,
    /text-indent/,
    "p 规则体内不应再有 text-indent（应由 overrideBookLayout 门控）",
  );
  assert.doesNotMatch(
    pBody,
    /text-align/,
    "p 规则体内不应再有 text-align（应由 overrideBookLayout 门控）",
  );
  // 同批新增：p 横向 padding/margin 显式清零，避免同页内不同 p 左缘参差。
  assert.match(pBody, /padding-left:\s*0\s*!important/, "p 应显式清零 padding-left（对齐左边界）");
  assert.match(pBody, /padding-right:\s*0\s*!important/, "p 应显式清零 padding-right（对齐右边界）");
  // 护栏：清洗层与施加层必须真的存在（Readest「脏样式让位」策略的核心）
  const layout = paragraphLayoutStyles({ paragraphSpacing: 0.8, textIndent: 2 }, true, 1.8);
  assert.match(layout, /html body\s*\{[\s\S]*?line-height:\s*unset/, "缺少清洗层：body 脏 line-height 未丢弃");
  assert.match(layout, /html body p[^{]*\{[\s\S]*?text-indent:\s*2em/, "缺少施加层：用户缩进未落到段落级");
  // 关闭开关时：清洗层与施加层都不应出现（尊重书籍原版排版）
  const off = paragraphLayoutStyles({ paragraphSpacing: 0.8, textIndent: 2 }, false, 1.8);
  assert.doesNotMatch(off, /line-height:\s*unset/, "关闭开关时不应有清洗层");
  assert.doesNotMatch(off, /text-indent/, "关闭开关时不应施加首行缩进");
  assert.match(off, /margin-bottom:\s*0\.8em/, "关闭开关时段距仍应保留（属容器观感）");
});

test("内联覆盖 p span { font-size: inherit !important } 必须带 !important（否则覆盖不到内联 style）", () => {
  const css = inlineOverrideStyles();
  // inlineOverrideStyles 是多选择器单块（p span, p div, ...）共享同一组声明
  for (const sel of ["p span", "p div", "p b", "p i"]) {
    assert.ok(css.includes(sel), `inlineOverrideStyles should include selector: ${sel}`);
  }
  // 2026-08-31 修正：原断言「≥4 个 inherit !important」（font-size / font-family /
  // font-style / font-weight），但后两项被**有意移除**——
  //   `p b { font-weight: inherit !important }` 会让书籍里的 <b>粗体</b>、<i>斜体</i>
  //   失去语义（被强制拉平成正文字重）。实现只保留 font-size（防止字号乱），
  //   font-family 则由 publisherFontOverrideStyles 按独立开关控制。
  // 故此处断言「font-size 必须是 inherit !important」，且**断言不得**再覆盖 font-weight。
  assert.match(css, /font-size:\s*inherit\s*!important/, "font-size 必须是 inherit !important");
  assert.doesNotMatch(
    css,
    /font-weight:\s*inherit/,
    "不应把 font-weight 拉平成 inherit（否则书籍粗体/斜体语义丢失）"
  );
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
  // 2026-08-31 修正：不再断言具体数值（1.3 / 1em 0 0.5em），排版调优会持续微调这些值
  // （现值 line-height 1.28、margin 1.1em 0 0.55em）。真正要守住的是「带 !important」——
  // 书籍常在 h1-h6 上写死行高/边距，不加 !important 就压不过。
  assert.match(shared, /font-weight:\s*600\s*!important/, "shared h block font-weight should have !important");
  assert.match(shared, /line-height:\s*[\d.]+.*!important/, "shared h block line-height should have !important");
  assert.match(shared, /margin:[^;]*!important/, "shared h block margin should have !important");
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

// ==== 2026-10-06 竖排（verticalWriting）回归断言 ====
test("竖排关闭时不注入任何 writing-mode（横排基线不被污染）", () => {
  const css = verticalWritingStyles(false);
  assert.equal(css, "", "关闭时应返回空串");
});

test("竖排开启：注入 writing-mode 且覆盖竖排不适用的横排属性", () => {
  const css = verticalWritingStyles(true);
  // ① 引擎的唯一触发条件就是这个属性
  assert.match(css, /html body\s*\{[\s\S]*?writing-mode:\s*vertical-rl\s*!important/);
  // ② 竖排下 line-height 撑开的是「列宽」而非行距，必须压回 1
  assert.match(css, /line-height:\s*1\s*!important/);
  // ③ 竖排下 text-indent 无位移，必须归零并改用 padding-top
  assert.match(css, /html body p\s*\{[\s\S]*?text-indent:\s*0\s*!important/);
  assert.match(css, /padding-top:\s*calc\(var\(--rwt-vertical-indent/);
  // ④ justify 在竖排里是沿垂直方向两端对齐，中文竖排惯例不做 ⇒ 回 start
  assert.match(css, /text-align:\s*start\s*!important/);
});
