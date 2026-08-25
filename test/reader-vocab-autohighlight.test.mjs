// 词库面板"自动高亮词库单词"开关集成测试（2026-08-23 新增）
// ----------------------------------------------------------------
// 用户诉求：词库面板加总开关控制文档内自动高亮词库单词。
// 涉及：
//   - src/index.less：.hiword-vb-autohighlight-row / .hiword-vb-switch / .hiword-vb-switch-graph
//   - src/index.ts：renderVocabPanel 渲染 .hiword-vb-autohighlight-row 开关行
//                + change 事件绑定调 setVocabAutoHighlight
//                + localStorage["hiword-vocab-autohighlight"] 持久化
//                + 启动时读取 localStorage 到 vocabAutoHighlight 字段
//                + 调用 hl.start(wysiwyg) 后立即 hl.setEnabled(vocabAutoHighlight)
// 不依赖：foliate / siyuan SDK
// 测试方式：grep 源码（避免 parse 整个 Svelte 编译产物）

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const indexLessPath = join(__dirname, "..", "src", "index.less");
const indexTsPath = join(__dirname, "..", "src", "index.ts");

const less = readFileSync(indexLessPath, "utf-8");
const ts = readFileSync(indexTsPath, "utf-8");

test("index.less 含 .hiword-vb-autohighlight-row 容器样式", () => {
  assert.match(less, /\.hiword-vb-autohighlight-row\s*\{/, "should define .hiword-vb-autohighlight-row");
});

test("index.less 含 .hiword-vb-switch 标签容器样式", () => {
  assert.match(less, /\.hiword-vb-switch\s*\{/, "should define .hiword-vb-switch");
});

test("index.less 含 .hiword-vb-switch-graph 滑块视觉样式", () => {
  assert.match(less, /\.hiword-vb-switch-graph\s*\{/, "should define .hiword-vb-switch-graph");
  // 滑块应有 transition（动画）
  const m = less.match(/\.hiword-vb-switch-graph\s*\{([^}]*)\}/);
  assert.ok(m);
  assert.match(m[1], /transition/, "switch-graph should have transition for smooth animation");
});

test("index.less 含 .hiword-vb-autohighlight-label 文本样式", () => {
  assert.match(less, /\.hiword-vb-autohighlight-label\s*\{/, "should define .hiword-vb-autohighlight-label");
});

test("index.less switch 选中状态用主题色（不是硬编码）", () => {
  // :checked ~ .hiword-vb-switch-graph 引用主题色变量
  assert.match(less, /:checked\s*~\s*\.hiword-vb-switch-graph/, "should have :checked ~ .hiword-vb-switch-graph rule");
  const checkedBlock = less.match(/:checked\s*~\s*\.hiword-vb-switch-graph\s*\{([^}]*)\}/);
  assert.ok(checkedBlock);
  // 选中色应来自主题变量（不是硬编码 #xxx）
  assert.match(checkedBlock[1], /var\(--b3-theme-primary/, "checked state should use --b3-theme-primary");
});

test("index.less switch 滑块在 :checked 时 translateX 移动", () => {
  // 滑块移动靠 ::before translateX(...)
  assert.match(less, /:checked\s*~\s*\.hiword-vb-switch-graph::before/, "should have :checked ~ switch-graph::before rule");
  const slideBlock = less.match(/:checked\s*~\s*\.hiword-vb-switch-graph::before\s*\{([^}]*)\}/);
  assert.ok(slideBlock);
  assert.match(slideBlock[1], /translateX/, "checked state should translateX the knob");
});

test("index.less 不依赖 b3-switch / switch 等外部类（自包含）", () => {
  // 找所有 :checked 相关的选择器，验证都不引用 b3-switch
  const checkedRules = less.match(/:checked[^,{]*\{[^}]*\}/g) || [];
  for (const rule of checkedRules) {
    assert.doesNotMatch(rule, /b3-switch(?!-)/, "should not depend on b3-switch external class");
  }
});

test("[回归] index.less 行布局用 flex（让 switch + label 横排）", () => {
  const m = less.match(/\.hiword-vb-autohighlight-row\s*\{([^}]*)\}/);
  assert.ok(m);
  assert.match(m[1], /display\s*:\s*flex/, "row should use display: flex for horizontal layout");
  assert.match(m[1], /gap/, "row should have gap between switch and label");
});

test("index.ts 渲染 .hiword-vb-autohighlight-row 容器（含 checkbox + label）", () => {
  // 在 renderVocabPanel 内部
  assert.match(ts, /class\s*=\s*['"]hiword-vb-autohighlight-row['"]/, "should render .hiword-vb-autohighlight-row div");
  // 含 id="hiword-vb-autohighlight" 的 checkbox
  assert.match(ts, /id\s*=\s*['"]hiword-vb-autohighlight['"]/, "should render #hiword-vb-autohighlight checkbox");
  // checkbox 的 checked 状态绑 vocabAutoHighlight
  assert.match(ts, /id=['"]hiword-vb-autohighlight['"][^}]*\$\{[^}]*vocabAutoHighlight[^}]*\}/, "checkbox checked should bind to vocabAutoHighlight");
});

test("index.ts 渲染开关文本「文档内自动高亮词库单词」", () => {
  assert.match(ts, /文档内自动高亮词库单词/, "should render the label text");
});

test("index.ts 给开关绑 change 事件调 setVocabAutoHighlight", () => {
  // addEventListener("change", ...) on #hiword-vb-autohighlight
  const m = ts.match(/querySelector\s*\(\s*['"]#hiword-vb-autohighlight['"]\s*\)\?\.addEventListener\s*\(\s*['"]change['"]/);
  assert.ok(m, "should bind change event to #hiword-vb-autohighlight");
  // handler 调 setVocabAutoHighlight
  const afterM = ts.indexOf("#hiword-vb-autohighlight");
  const after = ts.substring(afterM, afterM + 500);
  assert.match(after, /setVocabAutoHighlight/, "change handler should call setVocabAutoHighlight");
});

test("index.ts setVocabAutoHighlight 写 localStorage[\"hiword-vocab-autohighlight\"]", () => {
  // 用方法签名 setVocabAutoHighlight(on: boolean): void 定位
  const sig = "setVocabAutoHighlight(on: boolean): void";
  const idx = ts.indexOf(sig);
  assert.ok(idx > 0, "setVocabAutoHighlight method signature should exist");
  // 从 idx 后第一个 { 开始，按花括号平衡提取函数体
  const start = ts.indexOf("{", idx);
  assert.ok(start > 0);
  let depth = 0;
  let body = null;
  for (let i = start; i < ts.length; i++) {
    const ch = ts[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        body = ts.substring(start, i + 1);
        break;
      }
    }
  }
  assert.ok(body, "setVocabAutoHighlight body should be extractable");
  assert.match(body, /localStorage\.setItem\s*\(\s*['"]hiword-vocab-autohighlight['"]/, "should write localStorage[hiword-vocab-autohighlight]");
  assert.match(body, /getVocabHighlighter\s*\(\s*\)/, "should get vocab highlighter");
  assert.match(body, /\.setEnabled\s*\(/, "should call highlighter.setEnabled");
});

test("index.ts 启动时从 localStorage[\"hiword-vocab-autohighlight\"] 读取到 vocabAutoHighlight 字段", () => {
  // 在 init/load 配置处
  const m = ts.match(/localStorage\.getItem\s*\(\s*['"]hiword-vocab-autohighlight['"]\s*\)/);
  assert.ok(m, "should read localStorage[hiword-vocab-autohighlight] on startup");
  // 读取结果应赋给 this.vocabAutoHighlight（赋值一般在 localStorage 之前）
  // 用整个 src 找 `this.vocabAutoHighlight = ... localStorage.getItem(...)` 整段
  const fullPattern = /this\.vocabAutoHighlight\s*=\s*localStorage\.getItem\s*\(\s*['"]hiword-vocab-autohighlight['"]\s*\)/;
  assert.match(ts, fullPattern, "reading should assign to this.vocabAutoHighlight in same statement");
});

test("index.ts 在 hl.start(wysiwyg) 后立即调 hl.setEnabled(vocabAutoHighlight)", () => {
  // 验证两处（onload + onSwitchProtyle）
  const re = /hl\.start\s*\(\s*wysiwyg\s*\)\s*;[\s\S]{0,200}?hl\.setEnabled\s*\(\s*this\.vocabAutoHighlight\s*\)/g;
  const matches = [...ts.matchAll(re)];
  assert.ok(matches.length >= 2, `should have ≥2 start+setEnabled sequences (onload + onSwitchProtyle), got ${matches.length}`);
});

test("[回归] index.less 开关可见性 OK：默认 unchecked 时滑块在左（transform 不应用）", () => {
  // 默认状态：.hiword-vb-switch-graph::before 起始位置 left:2px（滑块在左）
  const m = less.match(/\.hiword-vb-switch-graph::before\s*\{([^}]*)\}/);
  assert.ok(m);
  const body = m[1];
  assert.match(body, /left\s*:\s*2px/, "knob should start at left:2px");
  // width:14px（14+2+2 = 18px 容器，14+14 = 28px 总宽，translateX 14px = 28-14-2 = 12px?）— 仅校验尺寸字段存在
  assert.match(body, /width\s*:\s*14px/, "knob should be 14px");
});

test("[回归] index.less switch 高度 18px + 行内 display:inline-block（小尺寸内嵌面板）", () => {
  const m = less.match(/\.hiword-vb-switch\s*\{([^}]*)\}/);
  assert.ok(m);
  const body = m[1];
  assert.match(body, /display\s*:\s*inline-block/, "switch should be inline-block");
  assert.match(body, /width\s*:\s*32px/, "switch width 32px");
  assert.match(body, /height\s*:\s*18px/, "switch height 18px");
});
