/**
 * PDF 缩放 Phase 1 · 测试 3: ReaderView.svelte applyZoom 核心逻辑
 * ----------------------------------------------------------------
 * 覆盖：
 *  - applyZoom 函数存在
 *  - fit-width / fit-page / custom 三种状态都调 setAttribute
 *  - zoomIn / zoomOut 按 ZOOM_PRESETS 步进
 *  - cycleZoomPreset 循环切换档位
 *  - zoomPercentLabel 返回正确格式
 *  - onGlobalKey 加 Cmd+= / Cmd+- / Cmd+0 / Cmd+1 / Cmd+2 / Cmd+3 分支
 *  - isPdfBook() 判断当前书格式
 *  - lastNonFitWidthZoom 用于双击切回
 *
 * 不依赖：foliate / siyuan SDK
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const src = readFileSync(viewPath, "utf-8");

test("[核心] applyZoom 函数存在并处理三种 ZoomState", () => {
  assert.ok(/function applyZoom\(/.test(src), "applyZoom 函数应存在");
  // fit-width
  assert.ok(/setAttribute\(\s*["']zoom["']\s*,\s*["']fit-width["']\s*\)/.test(src), "fit-width 应调 setAttribute('zoom', 'fit-width')");
  // fit-page
  assert.ok(/setAttribute\(\s*["']zoom["']\s*,\s*["']fit-page["']\s*\)/.test(src), "fit-page 应调 setAttribute('zoom', 'fit-page')");
  // custom（带 scale）
  assert.ok(/setAttribute\(\s*["']zoom["']\s*,\s*String\(zoom\.scale\)/.test(src), "custom 应调 setAttribute('zoom', String(scale))");
  // custom 还要 set scale-factor
  assert.ok(/setAttribute\(\s*["']scale-factor["']\s*,/.test(src), "custom 模式应同时设 scale-factor");
});

// 2026-08-29 回归：曾出现「同一个 scale 同时写进 zoom 和 scale-factor」的 bug。
// foliate 的真实缩放是两者相乘（vendor/foliate-js/fixed-layout.js:544-561：
//   scale = (zoom 或 fit 计算值); scale *= this.#scaleFactor），
// 于是工具栏显示 200% 时画面实际是 400%；且从 custom 切回 fit-page/fit-width
// 时 scale-factor 不会自动复位，fit 结果同样被乘歪。
test("[回归 2026-08-29] scale-factor 必须钉死 100，不能把 scale 二次乘进去", () => {
  assert.ok(
    /setAttribute\(\s*["']scale-factor["']\s*,\s*["']100["']\s*\)/.test(src),
    "scale-factor 必须固定写 \"100\"（= 1.0），缩放倍只允许走 zoom 属性"
  );
  assert.ok(
    !/setAttribute\(\s*["']scale-factor["']\s*,\s*String\(pct\)\s*\)/.test(src),
    "不得再把 pct（= scale×100）写进 scale-factor——那会与 zoom 相乘导致实际缩放 = scale²"
  );
});

test("[回归 2026-08-29] PDF 滚轮缩放：⌘/Ctrl+滚轮（含触控板捏合）", () => {
  assert.ok(/function handlePdfWheel\(/.test(src), "应有滚轮缩放统一入口 handlePdfWheel");
  // 只有 ⌘/Ctrl（macOS 触控板捏合会被合成为 ctrlKey 的 wheel）才缩放
  assert.ok(
    /if\s*\(!e\.ctrlKey\s*&&\s*!e\.metaKey\)\s*return/.test(src),
    "无修饰键的滚轮应放行给原生滚动，不拦截"
  );
  // 必须阻止 Electron 整页缩放
  assert.ok(/function handlePdfWheel\([\s\S]*?e\.preventDefault\(\)/.test(src), "滚轮缩放必须 preventDefault");
  // 两处挂载：iframe 内 doc（页面本体，wheel 不跨 iframe 冒泡）+ .reader-stage（留白）
  assert.ok(/function onContentWheel\(/.test(src), "应挂在内容 iframe 内的 doc 上（页面本体）");
  assert.ok(/function onStageWheel\(/.test(src), "应挂在 .reader-stage 上（页面四周留白）");
  // passive:false 才能 preventDefault
  assert.ok(/addEventListener\(\s*["']wheel["']\s*,[\s\S]{0,80}passive:\s*false/.test(src), "wheel 监听必须 passive:false");
  // 光标锚点缩放
  assert.ok(/function zoomAtPoint\(/.test(src), "应以光标为锚点缩放（缩放后画面不跳走）");
});

// 2026-08-29 第二轮修复：用户反馈「按住 ⌘ + 滚轮没反应」。
// 根因是我们和 foliate 抢同一个 wheel 事件时排在它后面——foliate 在内容 doc 上挂了
// 【冒泡阶段】的 wheel（vendor/foliate-js/fixed-layout.js:1082），且它比我们先注册
// （injectPageTurn 早于 attachContentDoc 里的 wheel 绑定）。
// 捕获阶段先于冒泡阶段执行（与注册顺序无关），改用 capture:true 才能抢到。
test("[回归 2026-08-29] wheel 监听必须是 capture 阶段（抢在 foliate 自己的 wheel 之前）", () => {
  assert.ok(
    /trackDocListener\(\s*doc\s*,\s*["']wheel["'][\s\S]{0,160}capture:\s*true/.test(src),
    "内容文档里的 wheel 监听必须 capture:true，才能抢在 foliate 的冒泡监听之前"
  );
  assert.ok(
    /readerViewEl\.addEventListener\(\s*["']wheel["'][\s\S]{0,160}capture:\s*true/.test(src),
    "最外层 readerViewEl 的 wheel 监听必须 capture:true（页面四周留白区）"
  );
  assert.ok(
    /e\.stopImmediatePropagation\(\)/.test(src),
    "命中缩放必须 stopImmediatePropagation，把 foliate 自己的 wheel 一并挡掉"
  );
});

// 2026-08-29 第三轮修复：用户反馈「滚动模式下无法正常缩放」。
// 根因：foliate 两种布局的缩放公式完全不同，写错属性等于没缩放——
//   分页模式  #render()           → scale = zoom × scaleFactor          （zoom 有效）
//   滚动模式  #renderScrollMode() → scale = (容器宽/页宽) × scaleFactor   （zoom 被完全忽略！）
//           （fixed-layout.js:544-561 与 :1130-1132 对照）
// 上一轮为修 scale² 把 scale-factor 钉死 100，在分页模式正确，
// 但在滚动模式等于把缩放永久锁死在「适应宽度 × 1.0」。
test("[回归 2026-08-29] 滚动模式必须用 scale-factor 承载缩放（zoom 属性在该模式被忽略）", () => {
  // 必须按 flow 模式分支
  assert.ok(/function isScrollFlow\(\)/.test(src), "应有 isScrollFlow() 判断当前是否滚动模式");
  const zoomIdx = src.indexOf("function applyZoom");
  const body = src.slice(zoomIdx, zoomIdx + 2600);
  assert.ok(
    /isScrollFlow\(\)/.test(body),
    "applyZoom 必须按 isScrollFlow() 分流，两种模式写不同的属性"
  );
  // 滚动分支：改 scale-factor，并把 zoom 固定为 fit-width 作为基准
  assert.ok(
    /setAttribute\(\s*["']scale-factor["']\s*,\s*pct\s*\)/.test(body),
    "滚动分支必须把目标缩放写进 scale-factor（zoom 在该模式不参与计算）"
  );
  assert.ok(
    /setAttribute\(\s*["']zoom["']\s*,\s*["']fit-width["']\s*\)/.test(body),
    "滚动分支必须把 zoom 固定为 fit-width 作为缩放基准"
  );
  // 分页分支仍然只写 zoom、scale-factor 钉 100
  assert.ok(
    /setAttribute\(\s*["']scale-factor["']\s*,\s*["']100["']\s*\)/.test(body),
    "分页分支必须把 scale-factor 钉死 100（否则与 zoom 相乘出 scale²）"
  );
});

// 滚动模式下 foliate 自己用 captureScrollModeAnchor/restoreScrollModeAnchor 维持
// 视口顶部位置（fixed-layout.js:1128/1143）。我们再改 scrollTop 会与它拉扯、画面跳动。
test("[回归 2026-08-29] 滚动模式跳过光标锚点校正（交给 foliate 自己的滚动锚点）", () => {
  const fnIdx = src.indexOf("function zoomAtPoint");
  const body = src.slice(fnIdx, fnIdx + 1400);
  assert.ok(
    /isScrollFlow\(\)\s*\)\s*\{[\s\S]{0,220}applyZoom\(/.test(body),
    "zoomAtPoint 在滚动模式下应直接 applyZoom 后返回，不再手动改 scrollLeft/scrollTop"
  );
});

test("[回归 2026-08-29] 非 PDF 不挂被动 wheel 监听（避免拖累 EPUB 滚动性能）", () => {
  // 内容文档里的 wheel 监听必须被 isPdfBook() 门控
  const attachIdx = src.indexOf("function attachContentDoc");
  const body = src.slice(attachIdx, attachIdx + 2200);
  assert.ok(
    /if\s*\(\s*isPdfBook\(\)\s*\)\s*\{[\s\S]{0,200}["']wheel["']/.test(body),
    "attachContentDoc 里的 wheel 监听必须仅在 PDF 下挂载"
  );
  // stage 监听同样延迟到确认是 PDF 之后再绑
  assert.ok(/function bindStageWheel\(/.test(src), "stage wheel 监听应由 bindStageWheel 按需绑定");
});

test("[核心] zoomIn / zoomOut 按 ZOOM_PRESETS 步进", () => {
  // zoomIn 应有 "find" 找下一档
  assert.ok(/function zoomIn\(\)[\s\S]*?ZOOM_PRESETS\.find/.test(src), "zoomIn 应按 ZOOM_PRESETS.find 找下一档");
  // zoomOut 应有 "filter" 找上一档
  assert.ok(/function zoomOut\(\)[\s\S]*?ZOOM_PRESETS\.filter/.test(src), "zoomOut 应按 ZOOM_PRESETS.filter 找上一档");
});

test("[核心] cycleZoomPreset 循环切换档位", () => {
  // 应用 (idx + 1) % ZOOM_PRESETS.length
  assert.ok(/function cycleZoomPreset\(\)[\s\S]*?%\s*ZOOM_PRESETS\.length/.test(src), "cycleZoomPreset 应循环切换档位（mod 运算）");
});

test("[核心] zoomPercentLabel 返回 3 种格式", () => {
  assert.ok(/function zoomPercentLabel\(\)[\s\S]*?适应宽度/.test(src), "fit-width 应显示 '适应宽度'");
  assert.ok(/function zoomPercentLabel\(\)[\s\S]*?适应整页/.test(src), "fit-page 应显示 '适应整页'");
  assert.ok(/function zoomPercentLabel\(\)[\s\S]*?\$\{Math\.round\(currentZoom\.scale \* 100\)\}%/.test(src), "custom 应显示百分比");
});

test("[核心] isPdfBook() 判断当前书格式", () => {
  assert.ok(/function isPdfBook\(\)[\s\S]*?meta\?\.format\s*===\s*["']pdf["']/.test(src), "isPdfBook 应判断 meta.format === 'pdf'");
});

test("[核心] onGlobalKey 加 Cmd+= / Cmd+- / Cmd+0 / Cmd+1 / Cmd+2 / Cmd+3 分支", () => {
  // onGlobalKey 函数体内应含这 6 个分支
  const globalKeyIdx = src.indexOf("function onGlobalKey");
  const body = src.slice(globalKeyIdx, globalKeyIdx + 4000);
  // = 放大
  assert.ok(/k\s*===\s*["']=["']\s*\|\|\s*k\s*===\s*["']\+["']/.test(body), "应识别 = 或 + 键");
  // - 缩小
  assert.ok(/k\s*===\s*["']-["']\s*\|\|\s*k\s*===\s*["']_["']/.test(body), "应识别 - 或 _ 键");
  // 0 reset
  assert.ok(/k\s*===\s*["']0["']/.test(body), "应识别 0 键（zoomReset）");
  // 1 fit-width
  assert.ok(/k\s*===\s*["']1["']/.test(body), "应识别 1 键（fitWidth）");
  // 2 fit-page
  assert.ok(/k\s*===\s*["']2["']/.test(body), "应识别 2 键（fitPage）");
  // 3 cycle preset
  assert.ok(/k\s*===\s*["']3["']/.test(body), "应识别 3 键（cycleZoomPreset）");
});

test("[关键] 6 个分支都仅 PDF 生效（isPdfBook 包裹）", () => {
  const globalKeyIdx = src.indexOf("function onGlobalKey");
  const body = src.slice(globalKeyIdx, globalKeyIdx + 4000);
  // 6 个分支各自含 isPdfBook 检查
  for (const fn of ["zoomIn", "zoomOut", "zoomReset", "fitWidth", "fitPage", "cycleZoomPreset"]) {
    // 找 fn 调用附近的 isPdfBook
    const fnIdx = body.indexOf(`${fn}()`);
    assert.ok(fnIdx > 0, `${fn}() 应在 onGlobalKey 内被调用`);
    // 上文 200 字符内应有 isPdfBook（避免分流失效）
    const slice = body.slice(Math.max(0, fnIdx - 300), fnIdx);
    assert.ok(
      /isPdfBook\(\)/.test(slice),
      `${fn}() 上文应检查 isPdfBook（PDF only）`
    );
  }
});

test("[EPUB 兼容] Cmd+= / Cmd+- 在 EPUB 模式走 changeFont（不破坏字号快捷键）", () => {
  const globalKeyIdx = src.indexOf("function onGlobalKey");
  const body = src.slice(globalKeyIdx, globalKeyIdx + 4000);
  // 找 isPdfBook() 后跟 changeFont 的分支
  assert.ok(
    /isPdfBook\(\)\s*\)\s*zoomIn\(\)[\s\S]{0,100}changeFont\(1\)/.test(body),
    "EPUB 模式 Cmd+= 应走 changeFont(1) 字号+"
  );
  assert.ok(
    /isPdfBook\(\)\s*\)\s*zoomOut\(\)[\s\S]{0,100}changeFont\(-1\)/.test(body),
    "EPUB 模式 Cmd+- 应走 changeFont(-1) 字号-"
  );
});

test("[关键] lastNonFitWidthZoom 用于双击切回", () => {
  assert.ok(/let lastNonFitWidthZoom: ZoomState/.test(src), "lastNonFitWidthZoom 状态应存在");
  // fitWidth / fitPage 切换时记录 lastNonFitWidthZoom
  assert.ok(/lastNonFitWidthZoom\s*=\s*currentZoom/.test(src), "fitWidth 应记录 lastNonFitWidthZoom");
});

test("[性能 2026-08-29] 滚动模式走 foliate pinch 预览，连续缩放期间零重绘", () => {
  // 滚动模式最多 12 页 loaded，逐帧提交 = 每帧重绘 12 页 canvas（每页约 400ms）→ 必然卡顿。
  // 正确做法：预览期只改 scrollContainer 的 CSS transform，停手才提交一次真实渲染。
  const flushIdx = src.indexOf("function flushWheelZoom(");
  assert.ok(flushIdx > -1, "flushWheelZoom 应存在");
  // 精确提取函数体（切到下一个顶层 function 为止，避免定长切片被撑爆）
  const nextFn = src.indexOf("\n  function ", flushIdx + 10);
  const body = src.slice(flushIdx, nextFn > -1 ? nextFn : flushIdx + 3000);

  assert.ok(/isScrollFlow\(\)/.test(body), "flushWheelZoom 应区分滚动模式");
  assert.ok(
    /r\.pinchZoom\(wheelPinchRatio\)/.test(body),
    "滚动模式应调 renderer.pinchZoom() 做 CSS transform 预览（不重绘 canvas）"
  );
  // 预览期间绝不能调 applyZoom，否则又变回逐帧重绘 12 页
  assert.ok(
    !/applyZoom\(/.test(body),
    "滚动模式预览期间不得调 applyZoom（否则每帧触发 12 页重绘）"
  );
  assert.ok(
    /setTimeout\(commitScrollWheelZoom/.test(body),
    "应延迟提交真实渲染（停手后才画）"
  );
  // 提交时先 pinchEnd（清 transform + 快照锚点）再 applyZoom
  const commitIdx = src.indexOf("function commitScrollWheelZoom(");
  assert.ok(commitIdx > -1, "commitScrollWheelZoom 应存在");
  const commitNext = src.indexOf("\n  function ", commitIdx + 10);
  const commitBody = src.slice(commitIdx, commitNext > -1 ? commitNext : commitIdx + 2000);
  assert.ok(
    /r\.pinchEnd\(\)/.test(commitBody),
    "提交前应调 pinchEnd() 清 transform 并快照锚点"
  );
  assert.ok(
    /applyZoom\(\s*\{\s*kind:\s*"custom"/.test(commitBody),
    "pinchEnd 后应 applyZoom 提交一次真实渲染"
  );
});

test("[清理 2026-08-29] 预览态必须在 onDestroy 复位 #pinching", () => {
  // foliate 的 #pinching 只有 pinchEnd 会复位；若组件销毁时停在预览态，
  // #scheduleScrollPages 会永久 return，页面加载/回收全部停摆。
  const destroyIdx = src.indexOf("onDestroy(");
  assert.ok(destroyIdx > -1, "onDestroy 应存在");
  const body = src.slice(destroyIdx, destroyIdx + 6000);
  assert.ok(/wheelPinchActive\)\s*\{/.test(body), "onDestroy 应检查 wheelPinchActive");
  assert.ok(
    /pinchEnd\?\.\(\)/.test(body),
    "onDestroy 应调 pinchEnd() 复位 foliate 的 #pinching"
  );
  assert.ok(
    /clearTimeout\(wheelCommitTimer\)/.test(body),
    "onDestroy 应清除提交定时器"
  );
});
