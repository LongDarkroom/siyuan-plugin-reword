/**
 * 页面边距重构（2026-08-29）
 * ----------------------------------------------------------------
 * 修复「4 边距滑块调了没反应、左右间距过大」的根因：body 的 margin 在 foliate 里
 * 基本不生效，真正撑开内容的是 body padding。改由 4 边距统一映射为 body padding，
 * 并新增三档预设（铺满 / 正常 / 宽松）+ 跟随思源文档边距。
 * 覆盖：
 *
 *  A. reader-style.ts：layoutMarginStyles 输出 body padding（不再是 margin）
 *  B. reader-style.ts：bodyStyles 不再输出 padding（padding 改由 layoutMarginStyles 独管）
 *  C. reader-settings.ts：LAYOUT_PRESETS 三档数值 + detectLayoutPreset 反推
 *  D. ReaderView.svelte：页面边距预设行（LAYOUT_PRESETS + onSetLayoutPreset + detectLayoutPreset 高亮）
 *  E. ReaderView.svelte：跟随思源文档边距（followSiyuanMargin + applySiyuanDocMargin + setFollowSiyuanMargin）
 *  F. 旧「行宽」控件已移除（onSetLineWidth 不再存在）
 *
 * 不依赖：foliate / siyuan SDK / DOM（纯源码文本校验，与仓库既有测试风格一致）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..", "src");

const styleSrc = readFileSync(join(root, "reader", "reader-style.ts"), "utf-8");
const settingsSrc = readFileSync(join(root, "reader", "reader-settings.ts"), "utf-8");
const viewSrc = readFileSync(join(root, "reader", "ReaderView.svelte"), "utf-8");

function bodyOf(src, name) {
  const idx = src.indexOf(name);
  if (idx < 0) return null;
  let open = -1;
  for (let i = idx; i < src.length - 1; i++) {
    if (src[i] === "{" && (src[i + 1] === "\n" || src[i + 1] === "\r")) {
      open = i;
      break;
    }
  }
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/* ================= A. layoutMarginStyles → padding ================= */

test("[A1] layoutMarginStyles 输出 body padding（不再是 margin）", () => {
  // 注：layoutMarginStyles 参数含内联类型对象，bodyOf 会误抓，故直接对源码断言返回值
  assert.match(styleSrc, /body \{ padding: \$\{mt\}px \$\{mr\}px \$\{mb\}px \$\{ml\}px !important/, "应以 4 边距生成 body padding");
  // 旧实现用 margin，确认已移除
  assert.doesNotMatch(styleSrc, /margin: \$\{mt\}px/, "不应再输出 body margin");
});

test("[A2] bodyStyles 不再输出 padding（padding 改由 layoutMarginStyles 独管）", () => {
  assert.doesNotMatch(styleSrc, /padding: \$\{o\.padding\}/, "bodyStyles 不应再输出 padding（避免与 layoutMarginStyles 双重 padding）");
});

/* ================= C. LAYOUT_PRESETS 三档 ================= */

test("[C1] LAYOUT_PRESETS 含铺满 / 正常 / 宽松 三档及数值", () => {
  assert.match(settingsSrc, /export const LAYOUT_PRESETS/, "应声明 LAYOUT_PRESETS");
  assert.match(settingsSrc, /fill: \{ label: "铺满", margins: \{ top: 4, right: 16, bottom: 8, left: 12 \}/, "铺满档数值");
  assert.match(settingsSrc, /normal: \{ label: "正常", margins: \{ top: 16, right: 24, bottom: 20, left: 20 \}/, "正常档数值");
  assert.match(settingsSrc, /loose: \{ label: "宽松", margins: \{ top: 32, right: 56, bottom: 48, left: 48 \}/, "宽松档数值");
});

test("[C2] detectLayoutPreset 反推当前预设（自定义兜底）", () => {
  assert.match(settingsSrc, /export function detectLayoutPreset\(layout: ReaderLayoutSettings\)/, "应导出 detectLayoutPreset");
  const b = bodyOf(settingsSrc, "export function detectLayoutPreset");
  assert.ok(b, "应取到函数体");
  assert.match(b, /return "custom"/, "都不匹配时应返回 custom");
});

/* ================= D. UI 预设行 ================= */

test("[D1] 页面边距预设行使用 LAYOUT_PRESETS + onSetLayoutPreset + detectLayoutPreset 高亮", () => {
  assert.match(viewSrc, /Object\.entries\(LAYOUT_PRESETS\)/, "预设行应遍历 LAYOUT_PRESETS");
  assert.match(viewSrc, /on:click=\{\(\) => onSetLayoutPreset\(key\)\}/, "点击应调 onSetLayoutPreset");
  assert.match(viewSrc, /detectLayoutPreset\(settings\.layout\) === key/, "当前档应高亮");
});

/* ================= E. 跟随思源文档边距 ================= */

test("[E1] ReaderLayoutSettings 含 followSiyuanMargin 且默认 false", () => {
  assert.match(settingsSrc, /followSiyuanMargin\?: boolean/, "接口应含 followSiyuanMargin");
  assert.match(settingsSrc, /followSiyuanMargin: false/, "默认应为 false");
});

test("[E2] applySiyuanDocMargin 读取宿主 .protyle-wysiwyg 水平 padding", () => {
  const b = bodyOf(viewSrc, "function applySiyuanDocMargin");
  assert.ok(b, "应取到 applySiyuanDocMargin 函数体");
  assert.match(b, /\.protyle-wysiwyg/, "应读取宿主编辑区");
  assert.match(b, /paddingLeft|paddingRight/, "应读取左右 padding");
  assert.match(b, /marginLeftPx|marginRightPx/, "应写回阅读器左右边距");
});

test("[E3] setFollowSiyuanMargin 绑定到开关，且 applyStyles 触发同步", () => {
  assert.match(viewSrc, /on:change=\{setFollowSiyuanMargin\}/, "开关应绑定 setFollowSiyuanMargin");
  assert.match(viewSrc, /function applyStyles\(\) \{/, "应有 applyStyles");
  assert.match(viewSrc, /\n\s*applySiyuanDocMargin\(\);/, "applyStyles 开头应调用 applySiyuanDocMargin");
});

/* ================= F. 旧「行宽」控件移除 ================= */

test("[F1] 旧 onSetLineWidth 已移除（由页面边距预设替代）", () => {
  assert.doesNotMatch(viewSrc, /onSetLineWidth/, "不应再存在 onSetLineWidth");
});
