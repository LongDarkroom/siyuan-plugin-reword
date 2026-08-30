/**
 * 划词工具栏大修（2026-08-30）
 * ----------------------------------------------------------------
 * 两件事：
 *  ① 工具栏老是遮挡被选中文字 —— 位置算法从「放得下就选它」改为「四向统一打分」，
 *     压字面积权重远高于越界面积，并新增「贴导航栏/底栏」安全位兜底。
 *  ② 标注交互微信读书化 —— 点「标注」一键用上次样式高亮；点 ▼ 才展开样式条改样式。
 *
 * 覆盖：
 *  A. annotation-config.ts：lastStyle / lastColor 字段 + 归一化 + 防抖持久化
 *  B. ReaderView.svelte：上次样式接入 + onQuickAnnotate 一键高亮
 *  C. ReaderView.svelte：两段式「标注」按钮 UI（主按钮 / ▼ / 迷你样式预览）
 *  D. ReaderView.svelte：toolbarPlacement 打分式避让（不压字优先）
 *  E. 回归防护：样式条仍可展开、onSelCreate 仍记录偏好
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

const cfgSrc = readFileSync(join(root, "annotation", "annotation-config.ts"), "utf-8");
const viewSrc = readFileSync(join(root, "reader", "ReaderView.svelte"), "utf-8");

/**
 * 取函数体：从 name 之后**第一个紧跟换行的 `{`** 开始做花括号配对。
 * 必须锚定 `{\n`（而不是任意 `{`），否则会切到签名里的内联类型对象
 * （如 `: { place: ToolbarPlace; ... }`）。
 */
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

/**
 * 去掉块注释后再断言「旧代码已移除」。
 * 原因：改动说明里往往会点名旧标识符（如 roomAbove），
 * 直接对源码 doesNotMatch 会被自己的注释误伤。
 */
function stripBlockComments(src) {
  return String(src || "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/* ================= A. annotation-config：上次样式持久化 ================= */

test("[A1] AnnotationConfig 新增 lastStyle / lastColor 可选字段", () => {
  assert.match(cfgSrc, /lastStyle\?: AnnotationStyle;/, "应声明 lastStyle 可选字段");
  assert.match(cfgSrc, /lastColor\?: string;/, "应声明 lastColor 可选字段");
});

test("[A2] normalizeStyle 归一化旧线型并拒绝脏值", () => {
  const b = bodyOf(cfgSrc, "function normalizeStyle");
  assert.ok(b, "应存在 normalizeStyle");
  assert.match(b, /VALID_STYLES/, "应校验白名单（highlight/solid/wavy）");
  assert.match(b, /"dashed" \|\| s === "double"\) return "solid"/, "旧虚线/双线应降级为直线段");
  assert.match(b, /"dotted"\) return "wavy"/, "旧点线应降级为波浪线");
  assert.match(b, /return undefined;/, "无法识别的值应丢弃而非写入");
});

test("[A3] 加载时用 normalizeStyle 清洗历史 lastStyle，并校验颜色为 hex", () => {
  assert.match(cfgSrc, /lastStyle: normalizeStyle\(data\.lastStyle\)/, "载入时须归一化 lastStyle");
  assert.match(cfgSrc, /\^#\[0-9a-fA-F\]\{3,8\}\$\/\.test\(data\.lastColor\.trim\(\)\)/, "lastColor 应做 hex 校验");
});

test("[A4] getLastAnnotationStyle / Color 无历史时回退用户默认", () => {
  assert.match(cfgSrc, /export function getLastAnnotationStyle\(\): AnnotationStyle/, "应提供 getLastAnnotationStyle");
  assert.match(cfgSrc, /export function getLastAnnotationColor\(\): string/, "应提供 getLastAnnotationColor");
  assert.match(cfgSrc, /return current\.lastStyle \|\| getDefaultAnnotationStyle\(\);/, "线型应回退默认");
  assert.match(cfgSrc, /return current\.lastColor \|\| getDefaultAnnotationColor\(\);/, "颜色应回退默认");
});

test("[A5] setLastAnnotationStyle 走 300ms 防抖且拒绝非法入参", () => {
  const b = bodyOf(cfgSrc, "export function setLastAnnotationStyle");
  assert.ok(b, "应存在 setLastAnnotationStyle");
  assert.match(b, /if \(!s\) return;/, "非法线型应直接忽略");
  assert.match(b, /\^#\[0-9a-fA-F\]\{3,8\}\$/, "非法颜色应直接忽略");
  assert.match(b, /clearTimeout\(lastStyleSaveTimer\)/, "连续写入应重置防抖计时器");
  assert.match(cfgSrc, /LAST_STYLE_SAVE_MS = 300/, "防抖应为 300ms（避免连点颜色高频落盘）");
});

/* ================= B. ReaderView：上次样式接入 + 一键高亮 ================= */

test("[B1] ReaderView 引入上次样式读写 API", () => {
  assert.match(viewSrc, /getLastAnnotationColor,/, "应引入 getLastAnnotationColor");
  assert.match(viewSrc, /getLastAnnotationStyle,/, "应引入 getLastAnnotationStyle");
  assert.match(viewSrc, /setLastAnnotationStyle,/, "应引入 setLastAnnotationStyle");
});

test("[B2] lastStyle / lastColor 初值来自上次使用记录（而非用户默认）", () => {
  assert.match(viewSrc, /let lastStyle: AnnotationStyle = getLastAnnotationStyle\(\);/, "线型初值应读上次记录");
  assert.match(viewSrc, /let lastColor: string = getLastAnnotationColor\(\);/, "颜色初值应读上次记录");
});

test("[B3] 样式变更统一由响应式语句持久化（覆盖全部入口，不会漏）", () => {
  // 注意：必须写成带参调用。Svelte 的 `$:` 只跟踪语句里出现过的变量，
  // 若 persistLastStyle 无参（内部读闭包变量），依赖不会建立，记忆永不触发。
  assert.match(viewSrc, /\$: persistLastStyle\(lastStyle, lastColor\);/, "应显式传入依赖以建立响应式追踪");
  const b = bodyOf(viewSrc, "function persistLastStyle");
  assert.ok(b, "应存在 persistLastStyle");
  assert.match(b, /setLastAnnotationStyle\(style, color\)/, "应委托给 config 层落盘");
});

test("[B4] onQuickAnnotate 用 lastStyle + lastColor 一键创建高亮", () => {
  const b = bodyOf(viewSrc, "async function onQuickAnnotate");
  assert.ok(b, "应存在 onQuickAnnotate");
  assert.match(b, /if \(selToolbar\.mode === "edit"\) return;/, "edit 态不应触发一键高亮");
  assert.match(b, /saveHighlight\(cfi, text, lastStyle, lastColor, ""\)/, "应直接用上次样式+颜色创建");
  assert.match(b, /closeSelToolbar\(\);/, "创建后应收起工具栏");
});

test("[B5] onQuickAnnotate 缺少选区时给出提示而非静默失败", () => {
  const b = bodyOf(viewSrc, "async function onQuickAnnotate");
  assert.ok(b, "应存在 onQuickAnnotate");
  assert.match(b, /if \(!cfi \|\| !text\) \{ toast\("请先选中文本"\); return; \}/, "无选区应提示");
});

/* ================= C. 两段式「标注」按钮 ================= */

test("[C1] 模板存在两段式结构（容器 + 主按钮 + ▼）", () => {
  assert.match(viewSrc, /class="reader-sel-split"/, "应有 split 容器");
  assert.match(viewSrc, /reader-sel-item-accent reader-sel-split-main/, "主按钮应沿用 accent 外观");
  assert.match(viewSrc, /class="reader-sel-split-more"/, "应有 ▼ 展开按钮");
});

test("[C2] 主按钮绑定 onQuickAnnotate（一键高亮）", () => {
  assert.match(viewSrc, /on:click=\{onQuickAnnotate\}/, "左段应触发一键高亮");
});

test("[C3] ▼ 按钮绑定 toggleStyleStrip（仅改样式时才展开）", () => {
  assert.match(viewSrc, /on:click=\{toggleStyleStrip\}>▾<\/button>/, "右段 ▼ 应切换样式条");
  assert.match(viewSrc, /class:active=\{selToolbar\.stripVisible\}/, "▼ 应反映样式条展开态");
});

test("[C4] 主按钮带迷你样式预览（线型 + 颜色）", () => {
  assert.match(viewSrc, /reader-sel-style-preview style-\{lastStyle\}/, "预览应跟随当前线型");
  assert.match(viewSrc, /--spc:\{lastColor\}/, "预览颜色应跟随当前颜色");
});

test("[C5] 旧的「点标注=展开样式条」单按钮已移除", () => {
  assert.doesNotMatch(viewSrc, /标注：展开样式条/, "不应再保留旧的标注按钮提示文案");
});

/* ================= D. toolbarPlacement 打分式避让 ================= */

test("[D1] 压字权重远高于越界（不压住选中文字是首要目标）", () => {
  const b = bodyOf(viewSrc, "function toolbarPlacement");
  assert.ok(b, "应取到 toolbarPlacement 函数体");
  assert.match(b, /const OVERLAP_WEIGHT = 10000;/, "应声明压字权重常量");
  assert.match(b, /overlapOf\(bx\.l, bx\.t, bx\.r, bx\.b\) \* OVERLAP_WEIGHT/, "压字面积应乘大权重");
  assert.match(b, /\+ outsideOf\(bx\.l, bx\.t, bx\.r, bx\.b\)/, "再叠加越界面积");
});

test("[D2] 提供矩形/重叠/越界/打分四个几何工具", () => {
  const b = bodyOf(viewSrc, "function toolbarPlacement");
  assert.ok(b, "应取到 toolbarPlacement 函数体");
  assert.match(b, /const boxOf = \(place: ToolbarPlace, ax: number, ay: number\)/, "应由方向与锚点推占位矩形");
  assert.match(b, /const overlapOf = /, "应能算与选区的重叠面积");
  assert.match(b, /const outsideOf = /, "应能算越界面积");
  assert.match(b, /const scoreOf = /, "应能综合打分");
});

test("[D3] 候选位含「贴导航栏下沿 / 底栏上沿」安全位（选区很高时的兜底）", () => {
  const b = bodyOf(viewSrc, "function toolbarPlacement");
  assert.ok(b, "应取到 toolbarPlacement 函数体");
  assert.match(b, /navBottom \+ h : bottomTop - h/, "应生成贴边安全位候选");
});

test("[D4] 侧放候选已做垂直夹紧，上下候选已做水平夹紧", () => {
  const b = bodyOf(viewSrc, "function toolbarPlacement");
  assert.ok(b, "应取到 toolbarPlacement 函数体");
  assert.match(b, /const clampX = \(ax: number\): number/, "应水平夹紧上下方向的锚点");
  assert.match(b, /const clampY = \(ay: number\): number/, "应垂直夹紧侧放方向的锚点");
  assert.match(b, /clampY\(selCenterY\)/, "侧放应使用夹紧后的锚点");
});

test("[D5] 旧的「放得下就选它」布尔分支已移除（那会压字）", () => {
  const b = bodyOf(viewSrc, "function toolbarPlacement");
  assert.ok(b, "应取到 toolbarPlacement 函数体");
  // 剥掉块注释：函数内的改动说明会点名这些旧标识符，不剥会误判为「仍存在」
  const code = stripBlockComments(b);
  assert.doesNotMatch(code, /roomAbove/, "不应再用 roomAbove 布尔判断");
  assert.doesNotMatch(code, /roomBelow/, "不应再用 roomBelow 布尔判断");
  assert.doesNotMatch(code, /roomLeft/, "不应再用 roomLeft 布尔判断");
  assert.doesNotMatch(code, /roomRight/, "不应再用 roomRight 布尔判断");
});

test("[D6] 高度估算优先用实测样式条高度（替代写死 116）", () => {
  assert.match(
    viewSrc,
    /const measuredStripH = selStripEl\?\.getBoundingClientRect\(\)\.height \|\| 0;/,
    "应实测样式条高度"
  );
  assert.match(viewSrc, /const stripExtraH = measuredStripH > 0 \? measuredStripH/, "有实测值则优先用实测值");
  assert.match(viewSrc, /const effH = stripShown \? TOOLBAR_BAR_ONLY_H \+ stripExtraH/, "总高应为主栏高 + 样式条高");
});

/* ================= E. 回归防护 ================= */

test("[E1] toggleStyleStrip 仍存在（▼ 依赖它）", () => {
  const b = bodyOf(viewSrc, "function toggleStyleStrip");
  assert.ok(b, "应存在 toggleStyleStrip");
  assert.match(b, /stripVisible: !selToolbar\.stripVisible/, "应切换展开态");
  assert.match(b, /fixToolbarPlacement\(lastSelRect, 8\)/, "展开/收起后应重算位置");
});

test("[E2] 样式条里选样式/颜色仍会记录偏好并即时创建", () => {
  const b = bodyOf(viewSrc, "async function onSelCreate");
  assert.ok(b, "应存在 onSelCreate");
  assert.match(b, /lastStyle = style; lastColor = color;/, "应更新偏好（供下次一键高亮）");
  assert.match(b, /await saveHighlight\(cfi, text, style, color, ""\)/, "应即时创建高亮");
});

test("[E3] 样式条 DOM 已绑定引用（供实测高度）", () => {
  assert.match(viewSrc, /let selStripEl: HTMLElement \| null = null;/, "应声明 selStripEl");
  assert.match(viewSrc, /class="reader-sel-strip" bind:this=\{selStripEl\}/, "样式条应绑定 selStripEl");
});

/* ================= F. 内容区边界夹紧（避让思源左右 Dock） ================= */

test("[F1] toolbarPlacement 接收内容区 left/right 边界", () => {
  const b = bodyOf(viewSrc, "function toolbarPlacement");
  assert.ok(b, "应取到 toolbarPlacement 函数体");
  assert.match(
    viewSrc,
    /function toolbarPlacement\(\s*rect: SelRect,\s*h: number,\s*w: number,\s*navBottom: number,\s*bottomTop: number,\s*contentLeft: number,\s*contentRight: number,\s*gap: number\s*\)/,
    "签名应含 contentLeft / contentRight"
  );
});

test("[F2] 新增 getContentBounds 并优先用 readerStageEl 真实边界", () => {
  assert.match(viewSrc, /function getContentBounds\(\): \{[^}]*left: number; right: number; top: number; bottom: number[^}]*\}/, "应存在 getContentBounds 返回四边界");
  const b = bodyOf(viewSrc, "function getContentBounds");
  assert.ok(b, "应取到 getContentBounds 函数体");
  assert.match(b, /readerStageEl\.getBoundingClientRect\(\)/, "应优先用 readerStageEl 取边界");
});

test("[F3] 水平夹紧使用 contentLeft / contentRight 而非 [0, viewW]", () => {
  const b = bodyOf(viewSrc, "function toolbarPlacement");
  assert.ok(b, "应取到 toolbarPlacement 函数体");
  assert.match(b, /contentLeft \+ PAD - l/, "越界面积左边界应使用 contentLeft");
  assert.match(b, /contentRight - PAD/, "越界面积右边界应使用 contentRight");
  assert.match(b, /contentLeft \+ half/, "上下方向 clampX 最小值应使用 contentLeft");
  assert.match(b, /contentRight - half/, "上下方向 clampX 最大值应使用 contentRight");
});

test("[F4] positionToolbarAbove 用 getContentBounds 取边界传入 toolbarPlacement", () => {
  const b = bodyOf(viewSrc, "function positionToolbarAbove");
  assert.ok(b, "应取到 positionToolbarAbove 函数体");
  assert.match(b, /const bounds = getContentBounds\(\);/, "应调用 getContentBounds");
  assert.match(b, /toolbarPlacement\([^)]*bounds\.left,\s*bounds\.right,\s*gap\)/, "应传入 bounds.left / bounds.right");
  assert.doesNotMatch(b, /readerViewEl\?\.clientWidth/, "不应再用 readerViewEl.clientWidth 当可见宽度");
});

test("[F5] positionPopupNear 与 openHighlightEditToolbar 同样传入内容区边界", () => {
  const popup = bodyOf(viewSrc, "function positionPopupNear");
  assert.ok(popup, "应取到 positionPopupNear 函数体");
  assert.match(popup, /const bounds = getContentBounds\(\);/, "positionPopupNear 应调用 getContentBounds");
  assert.match(popup, /toolbarPlacement\([^)]*bounds\.left,\s*bounds\.right,\s*gap\)/, "positionPopupNear 应传入 bounds.left / bounds.right");

  const edit = bodyOf(viewSrc, "function openHighlightEditToolbar");
  assert.ok(edit, "应取到 openHighlightEditToolbar 函数体");
  assert.match(edit, /const bounds = getContentBounds\(\);/, "openHighlightEditToolbar 应调用 getContentBounds");
  assert.match(edit, /toolbarPlacement\([^)]*bounds\.left,\s*bounds\.right,\s*gap\)/, "openHighlightEditToolbar 应传入 bounds.left / bounds.right");
});

test("[F6] fixToolbarPlacement 用 bounds.left / bounds.right 做水平夹紧", () => {
  const b = bodyOf(viewSrc, "async function fixToolbarPlacement");
  assert.ok(b, "应取到 fixToolbarPlacement 函数体");
  assert.match(b, /const bounds = getContentBounds\(\);/, "应调用 getContentBounds");
  assert.match(b, /bounds\.left \+ half/, "上下夹紧最小值应使用 bounds.left");
  assert.match(b, /bounds\.right - half/, "上下夹紧最大值应使用 bounds.right");
  assert.match(b, /bounds\.left \+ PAD \+ w/, "左侧放置最小 anchorX 应使用 bounds.left");
  assert.match(b, /bounds\.right - PAD/, "右侧放置最大 anchorX 应使用 bounds.right");
});
