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
  // 2026-09-29 P0：inlineOverrideStyles 里的 `p span { font-family: inherit }` 已废弃，
  //   改由 fontFamilyStyles 统一处理（Readest 式：body !important + 全后代 revert，
  //   排除 code/译文块）。旧实现漏覆盖 div/span 布局的正文，且会抹平书内自带字体设计。
  //   故此处改为断言「不再有 per-tag font-family:inherit，且存在新的 revert 覆盖层」。
  assert.doesNotMatch(
    css,
    /p\s+span[^{]*\{[^}]*font-family:\s*inherit/,
    "p span 的 font-family:inherit 已废弃，应由 fontFamilyStyles 统一接管",
  );
  assert.match(
    css,
    /body\s*\*:not\([^)]*pre[^)]*\)[^{]*\{[^}]*font-family:\s*revert\s*!important/,
    "应存在新版全后代 font-family:revert 覆盖层（排除 pre/code 等）",
  );
  // 标题（2026-08-30 排版精修后为 1.5em / 1.32em，旧断言的 1.6em / 1.4em 已过期）
  assert.match(css, /h1\s*\{[^}]*font-size:\s*1\.5em\s*!important/);
  assert.match(css, /h2\s*\{[^}]*font-size:\s*1\.32em\s*!important/);
  // 引用（2026-08-30 思源化：左边线改为跟随思源 --b3-border-color，currentColor 降级为 fallback）
  assert.match(css, /blockquote\s*\{[^}]*border-left:\s*3px solid var\(--b3-border-color,\s*currentColor\)\s*!important/);
  // 列表
  assert.match(css, /ul,\s*ol\s*\{[^}]*margin:\s*0\.6em\s*0/);
  assert.match(css, /li\s*\{[^}]*margin:\s*0\.3em\s*0/);
  // 2026-10-06：列表 marker 回归断言（此前只断言 margin，漏掉了本 bug）
  // ① li 必须保留左内边距：list-style-position:outside 的 marker 画在 li 的 padding 盒外侧，
  //    清零会让项目符号被挤到容器边缘甚至裁掉
  assert.match(
    css,
    /html body li\s*\{[^}]*padding-left:\s*(?!0(?:[;\s]|$))[\d.]+em\s*!important/,
    "li 的 padding-left 不得为 0（marker 悬挂位）",
  );
  // ② 必须显式声明 list-style-type：书里常见 list-style:none，无声明则符号全丢
  assert.match(css, /ul,\s*ol\s*\{[^}]*list-style-type:\s*disc\s*!important/);
  assert.match(css, /ol\s*\{[^}]*list-style-type:\s*decimal\s*!important/);
  // ③ 必须有 ::marker 字体族兜底：图标字体缺字形时退回 serif，避免 .notdef 方框
  assert.match(css, /li::marker\s*\{[^}]*font-family:\s*serif\s*!important/);
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

// 2026-09 更新：旧断言 `body { padding: 2em 1.5em }`（来自 LINE_WIDTH_PRESETS）已过期。
// 2026-08-29 起 body padding 改由「页面布局」4 个边距滑块驱动（reader-style.ts layoutMarginStyles），
// lineWidth 预设的 padding 只经 deriveStyleOutput 透传、不再注入 CSS（见 reader-settings.ts:526 说明）。
// 2026-09-25 语义升级：左右边距不再用 marginLeft/RightPx 直出，而是由 widthPct
//   换算百分比（每侧 (100-pct)/2 %）随窗口伸缩；缺省 widthPct 未传时回落 80 → 10.00%。
//   widthMode="fixed" 时左右归零（书页宽交给 paginator 的 --_reword-content-fixed）。
test("body 内边距由「页面布局」边距滑块驱动（上下 px + 左右换算值 + column-gap 16px）", () => {
  const css = build();
  assert.match(css, /body\s*\{\s*padding:\s*16px\s+10\.00%\s+16px\s*!important;\s*column-gap:\s*16px;\s*\}/);
});

test("body 内边距随 settings.layout 四边与分栏间距变化", () => {
  const css = build(mkSettings({
    layout: { marginTopPx: 8, marginBottomPx: 12, marginLeftPx: 24, marginRightPx: 32, columnGapPx: 40 },
  }));
  // 上下用 layout 的 px；左右在默认 widthPct=80 下同为 10.00%（不再直出 32px/24px）
  assert.match(css, /body\s*\{\s*padding:\s*8px\s+10\.00%\s+12px\s*!important;\s*column-gap:\s*40px;\s*\}/);
  // 跟随思源页边时左右才回到宿主 px（此处未开启，故不应出现 32px/24px）
  assert.doesNotMatch(css, /padding:\s*8px\s+32px\s+12px\s+24px/, "未开启跟随思源页边时左右不应直出宿主 px");
});

test("行高 line-height 注入", () => {
  const css = build(mkSettings({ lineHeight: 1.9 }));
  assert.match(css, /line-height:\s*1\.9\s*!important/);
});

test("fontFaceCss 参数原样拼接到开头（@font-face 段）", () => {
  const userFont = '@font-face { font-family: "LXGW WenKai"; src: url(blob:abc); }';
  const css = build(mkSettings(), lightPreset, normalLineWidth, userFont, '"LXGW WenKai", serif');
  // 2026-09-29 P0：buildReaderStyles 现在会**前置** cjkAliasFontFaces()（中文泛型字体族
  //   别名映射，全部是 local() 型 @font-face），故用户 fontFaceCss 不再是整个输出的第一段。
  // 断言改为「用户字体段存在，且排在别名映射之后、body 主题规则之前」。
  //   注意：不能用 indexOf('font-family: "LXGW WenKai"') 判断位置 —— 该名字也出现在
  //   CJK 别名的 local() 候选链里（楷体系回退含 LXGW WenKai），会命中错误位置。
  assert.ok(css.includes(userFont), "fontFaceCss 应原样出现在输出中");
  // 注意：cjkAliasFontFaces() 输出的是**紧凑格式** @font-face{font-family:"楷体_GB2312"
  //   （冒号后无空格），不能用带空格的串去 indexOf，否则恒为 -1。
  const aliasEnd = css.indexOf('font-family:"楷体_GB2312"');
  assert.ok(aliasEnd > 0, "应存在 CJK 别名映射（楷体系，紧凑格式）");
  assert.ok(
    css.indexOf(userFont) > aliasEnd,
    "用户 fontFaceCss 应排在 CJK 别名映射之后（别名映射前置）",
  );
  // 用户字体段必须排在主题 body 规则之前（保证书籍字体声明优先落地）
  assert.ok(
    css.indexOf(userFont) < css.indexOf("color-scheme"),
    `fontFaceCss 应在 body 主题规则之前，got: ${css.slice(0, 120)}`,
  );
});

test("fontFamilyStack 注入到 body 块（单一职责）", () => {
  const userStack = '"LXGW WenKai", "Microsoft YaHei", sans-serif';
  const css = build(mkSettings(), lightPreset, normalLineWidth, "", userStack);
  // 2026-10-06：fontFamilyStyles 会经 withDigitFix() 在栈首注入 "RW Digit Fix"
  //   （修正书籍字体破坏数字/标点字形），故用户栈不再紧跟 font-family: 之后。
  const escaped = userStack.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(css, new RegExp(`body\\s*\\{[^}]*font-family:[^;]*${escaped}\\s*!important`));
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
  assert.match(css, /h1\s*\{[^}]*1\.5em/);                                // headingStyles
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
