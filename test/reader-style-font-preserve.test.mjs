// 阅读器 - 字体保留测试（2026-08-23 修复回归）
// ----------------------------------------------------------------
// 用户反馈：原 buildReaderStyles 在 bodyStyles 中硬编码 CJK fallback font-family，
// 与 fontCss() 注入的宿主字体（如「霞鹜文楷」）冲突，导致用户字体被覆盖。
//
// 修复：bodyStyles 不再含 font-family，由 fontFamilyStyles(fontFamilyStack) 单独输出。
// ReaderView.svelte 的 buildFontInjection() 拼装完整栈（含用户字体 + CJK fallback）。
//
// 覆盖：
// - follow-siyuan 模式：buildReaderStyles 输出保留宿主字体栈（如「LXGW WenKai」）
// - custom 模式：保留自定义字体名（"MyFont"）
// - system 模式：仅 CJK fallback
// - bodyStyles 输出不含 font-family
// - buildReaderStyles 输出仅 1 个 body { font-family } 声明
// - 三模式都含 CJK fallback（兜底）
// - 模拟 ReaderView 的 buildFontInjection 流程（follow-siyuan + custom + system）

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReaderStyles,
  bodyStyles,
  fontFamilyStyles,
  getDefaultCjkFontStack,
  deriveStyleOutput,
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

test("[回归] follow-siyuan 模式保留宿主「霞鹜文楷」字体", () => {
  // 模拟：宿主页面已加载「霞鹜文楷」@font-face，宿主字体栈是 "LXGW WenKai", serif
  const hostFontFace = '@font-face { font-family: "LXGW WenKai"; src: url(blob:abc123); unicode-range: U+4E00-9FFF; }';
  const hostStack = '"LXGW WenKai", serif';
  // ReaderView 的 buildFontInjection 在 follow-siyuan 模式拼装：hostStack + CJK fallback
  const finalStack = `${hostStack}, ${getDefaultCjkFontStack()}`;

  const css = buildReaderStyles(
    mkSettings({ fontMode: "follow-siyuan" }),
    lightPreset,
    normalLineWidth,
    hostFontFace,
    finalStack
  );

  // 关键断言：宿主字体 @font-face 在 CSS 输出中
  assert.ok(css.includes("LXGW WenKai"), "should preserve LXGW WenKai @font-face");
  // 关键断言：body { font-family } 包含 LXGW WenKai（不是被 CJK fallback 覆盖）
  assert.match(css, /body\s*\{[^}]*font-family:[^}]*LXGW WenKai[^}]*!important/);
  // 关键断言：CJK fallback 也存在（兜底）
  assert.match(css, /font-family:[^}]*PingFang SC/);
});

test("[回归] custom 模式保留用户自定义字体（如「霞鹜文楷」自定义导入）", () => {
  // 模拟：用户导入了 "MyFont.ttf" 作为自定义字体
  const customFontFace = '@font-face { font-family: "MyFont"; src: url(blob:def456); }';
  const customStack = `"MyFont", ${getDefaultCjkFontStack()}`;

  const css = buildReaderStyles(
    mkSettings({ fontMode: "custom" }),
    lightPreset,
    normalLineWidth,
    customFontFace,
    customStack
  );

  // 关键断言：自定义字体 @font-face 在 CSS 输出中
  assert.ok(css.includes("MyFont"), "should preserve MyFont @font-face");
  // 关键断言：body { font-family } 包含 MyFont
  assert.match(css, /body\s*\{[^}]*font-family:[^}]*MyFont[^}]*!important/);
});

test("[回归] system 模式仅 CJK fallback", () => {
  const css = buildReaderStyles(
    mkSettings({ fontMode: "system" }),
    lightPreset,
    normalLineWidth,
    "",
    getDefaultCjkFontStack()
  );

  // 关键断言：不含任何**用户自带**字体（system 模式不注入用户字体文件）
  // 2026-09-29 P0：buildReaderStyles 现在会追加 cjkAliasFontFaces() —— 中文泛型字体族
  //   别名映射（楷体/仿宋/黑体/宋体 → 各平台真实注册名的 local() 候选链），
  //   用于解决「书里写 font-family:"Kaiti"，系统实际叫"Kaiti SC"→ 整段回落默认字体」。
  //   这些 @font-face 全部是 local() 本机映射、**不含在线兜底**，与用户字体无关。
  //   故断言改为：不得出现用户字体注入（url/blob/在线 src），但允许 CJK 别名映射。
  assert.doesNotMatch(css, /@font-face[^{]*\{[^}]*url\(/i, "system 模式不应注入用户字体文件（url/blob）");
  assert.doesNotMatch(css, /url\(blob:/i, "system 模式不应出现 blob 字体");
  // CJK 别名映射应存在且只用 local()（离线优先）
  const aliasFaces = css.match(/@font-face\{[^}]*\}/g) ?? [];
  assert.ok(aliasFaces.length > 0, "应输出 CJK 泛型字体族别名映射 @font-face");
  for (const f of aliasFaces) {
    assert.match(f, /src:local\(/, "CJK 别名映射应只用 local()（离线优先，不含在线兜底）");
  }
  // 关键断言：body { font-family } 包含 CJK fallback
  assert.match(css, /body\s*\{[^}]*font-family:[^}]*PingFang SC[^}]*!important/);
});

test("[回归] bodyStyles 不再输出 font-family（避免覆盖宿主字体）", () => {
  const o = deriveStyleOutput(mkSettings(), lightPreset, normalLineWidth);
  const css = bodyStyles(o, mkSettings());
  assert.doesNotMatch(css, /font-family/i, "bodyStyles should NOT output font-family");
});

test("[回归] buildReaderStyles 输出仅 1 个 body { font-family } 声明", () => {
  const css = buildReaderStyles(
    mkSettings(),
    lightPreset,
    normalLineWidth,
    '@font-face { font-family: "LXGW WenKai"; src: url(blob:abc); }',
    `"LXGW WenKai", ${getDefaultCjkFontStack()}`
  );
  // 数 body { ... font-family: ... !important } 出现次数
  const bodyFontFamilyCount = (css.match(/body\s*\{[^}]*font-family:[^}]*!important/g) || []).length;
  assert.equal(bodyFontFamilyCount, 1, `expected exactly 1 body { font-family } block, got ${bodyFontFamilyCount}: ${css.match(/body\s*\{[^}]*font-family:[^}]*!important/g)}`);
});

test("[回归] 模拟 ReaderView buildFontInjection follow-siyuan 完整流程", () => {
  // 模拟 ReaderView.svelte 的 buildFontInjection
  function buildFontInjection(settings, hostFaces, hostStack) {
    const cjkFallback = getDefaultCjkFontStack();
    if (settings.fontMode === "system") {
      return { fontFaceCss: "", fontFamilyStack: cjkFallback };
    }
    if (settings.fontMode === "custom") {
      return { fontFaceCss: "@font-face {}", fontFamilyStack: `"CustomFont", ${cjkFallback}` };
    }
    // follow-siyuan
    const fontFaceCss = hostFaces.length ? hostFaces.join("\n") + "\n" : "";
    const stack = hostStack ? `${hostStack}, ${cjkFallback}` : cjkFallback;
    return { fontFaceCss, fontFamilyStack: stack };
  }

  // 用户场景：宿主用「霞鹜文楷」插件
  const hostFaces = ['@font-face { font-family: "LXGW WenKai"; src: url(blob:abc); }'];
  const hostStack = '"LXGW WenKai", serif';
  const { fontFaceCss, fontFamilyStack } = buildFontInjection(
    mkSettings({ fontMode: "follow-siyuan" }),
    hostFaces,
    hostStack
  );

  const css = buildReaderStyles(
    mkSettings({ fontMode: "follow-siyuan" }),
    lightPreset,
    normalLineWidth,
    fontFaceCss,
    fontFamilyStack
  );

  // 1. 宿主 @font-face 完整保留
  assert.ok(css.includes('font-family: "LXGW WenKai"'), "should preserve LXGW WenKai @font-face");
  // 2. 字体栈含 LXGW WenKai（不是被 CJK fallback 覆盖）
  assert.match(css, /body\s*\{[^}]*font-family:[^}]*LXGW WenKai/);
  // 3. 字体栈也含 CJK fallback
  assert.match(css, /font-family:[^}]*Microsoft YaHei/);
  // 4. 没有重复的 body { font-family } 声明
  const bodyFontFamilyCount = (css.match(/body\s*\{[^}]*font-family:[^}]*!important/g) || []).length;
  assert.equal(bodyFontFamilyCount, 1);
});

test("[回归] 模拟 ReaderView buildFontInjection system 模式（无 @font-face）", () => {
  function buildFontInjection(settings) {
    const cjkFallback = getDefaultCjkFontStack();
    if (settings.fontMode === "system") {
      return { fontFaceCss: "", fontFamilyStack: cjkFallback };
    }
    return { fontFaceCss: "", fontFamilyStack: cjkFallback };
  }
  const { fontFaceCss, fontFamilyStack } = buildFontInjection(mkSettings({ fontMode: "system" }));
  const css = buildReaderStyles(
    mkSettings({ fontMode: "system" }),
    lightPreset,
    normalLineWidth,
    fontFaceCss,
    fontFamilyStack
  );
  // 2026-09-29 P0：CJK 泛型字体族别名映射会输出 local() 型 @font-face（见前一条测试说明），
  //   故此处不再断言「完全无 @font-face」，改为确认**用户字体未注入**（无 url/blob）。
  assert.doesNotMatch(css, /@font-face[^{]*\{[^}]*url\(/i, "system 模式不应注入用户字体文件");
  assert.doesNotMatch(css, /url\(blob:/i, "system 模式不应出现 blob 字体");
  assert.match(css, /body\s*\{[^}]*font-family:[^}]*PingFang SC[^}]*!important/);
});

test("fontFamilyStyles 独立函数可被外部使用", () => {
  const css = fontFamilyStyles('"LXGW WenKai", serif');
  // 2026-10-06：fontFamilyStyles 现经 withDigitFix() 在栈首注入 DIGIT_FIX_FAMILY
  //   （"RW Digit Fix"，修正书籍字体破坏数字/标点字形），不再与输入全等。
  //   改断言「用户栈完整保留 + 带 !important + 数字字体已前置」。
  assert.match(css, /^body \{ font-family: /, "应以 body { font-family: 开头");
  assert.match(css, /"LXGW WenKai", serif !important;/, "用户字体栈应完整保留并带 !important");
  assert.match(css, /"RW Digit Fix"/, "应注入数字字形修正字体");
});

test("[回归] 字体栈含特殊字符（如中文）仍可安全嵌入", () => {
  // 防御性测试：确保 fontFamilyStack 中含中文字体名（如「霞鹜文楷」无引号）不破坏 CSS
  // 注：实际使用时仍建议加引号
  const css = fontFamilyStyles('"霞鹜文楷", "PingFang SC"');
  // 2026-10-06：栈首会被注入 "RW Digit Fix"，故中文字体不要求紧跟 font-family: 之后。
  assert.match(css, /font-family:[^;]*"霞鹜文楷",\s*"PingFang SC"\s*!important/);
});

test("[回归] 用户主题切换（light/dark/custom）不破坏字体栈", () => {
  for (const theme of ["light", "dark", "custom", "night", "gold"]) {
    const userStack = `"LXGW WenKai", ${getDefaultCjkFontStack()}`;
    const css = buildReaderStyles(
      mkSettings({ theme }),
      theme === "dark" || theme === "night" || theme === "gold"
        ? { bg: "#000", fg: "#fff", fg2: "#888" }
        : lightPreset,
      normalLineWidth,
      "",
      userStack
    );
    assert.match(css, /body\s*\{[^}]*font-family:[^}]*LXGW WenKai[^}]*!important/, `${theme} theme should preserve LXGW WenKai`);
  }
});
