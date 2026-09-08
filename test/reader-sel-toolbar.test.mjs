// 阅读器划词工具栏交互回归测试（2026-08-24 新增）
// ------------------------------------------------------------
// 覆盖：
// - 工具栏按 selToolbar.x/y 定位到选区正上方（微信读书风格）
// - reader-sel-toolbar 不再使用 bottom:16px 固定底部居中
// - 存在 onAnnDeleteById 处理函数，响应 edit 模式「删除」按钮
// - show-annotation 事件中获取标注屏幕矩形并定位工具栏

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const tabPath = join(__dirname, "..", "src", "reader", "reader-tab.ts");
const viewSrc = readFileSync(viewPath, "utf-8");
const tabSrc = readFileSync(tabPath, "utf-8");

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "");
const viewSrcNoComment = stripComments(viewSrc);

test("reader-sel-toolbar 模板绑定 selToolbar.x/y 动态定位", () => {
  // 2026-09-04 对齐：模板新增 bind:this 与 place-below/left/right class，放宽中间属性匹配
  assert.match(
    viewSrcNoComment,
    /class="reader-sel-toolbar"[\s\S]{0,200}style="left:\{selToolbar\.x\}px;top:\{selToolbar\.y\}px"/,
    "工具栏应通过 left/top 绑定 selToolbar.x/y"
  );
});

test("reader-sel-toolbar CSS 使用 translate(-50%, -100%) 底部中心对齐选区上方", () => {
  const block = viewSrcNoComment.match(/\.reader-sel-toolbar\s*\{[^}]+\}/)?.[0] ?? "";
  assert.ok(block, "应能提取 .reader-sel-toolbar 样式块");
  assert.doesNotMatch(block, /bottom:\s*16px/, "工具栏不应固定 bottom:16px 底部居中");
  assert.match(block, /transform:\s*translate\(-50%,\s*-100%\)/, "工具栏应使用 translate(-50%, -100%) 使底部中心对齐定位点");
});

test("存在 onAnnDeleteById 函数处理 edit 模式删除按钮", () => {
  assert.match(
    viewSrcNoComment,
    /function\s+onAnnDeleteById\s*\(/,
    "应定义 onAnnDeleteById 函数"
  );
  assert.match(
    viewSrcNoComment,
    /on:click=\{onAnnDeleteById\}/,
    "edit 模式删除按钮应绑定 onAnnDeleteById"
  );
});

test("show-annotation 事件中获取标注屏幕矩形并定位工具栏", () => {
  const body = viewSrcNoComment;
  assert.match(body, /function\s+onShowAnnotation\s*\(/, "应定义 onShowAnnotation 函数");
  // 2026-08-24 修复：优先使用 foliate 事件已算好的屏幕矩形 e.detail.rect
  assert.match(body, /const\s*\{\s*value,\s*rect:\s*evRect\s*\}\s*=\s*e\.detail/, "应从 e.detail 解构 value 与 rect");
  // 2026-09-04 对齐：getAnnotationScreenRect 已删除；evRect 加 iframe 偏移后
  // 直接交给 openHighlightEditToolbar / showPreviewViewer 定位
  assert.match(body, /let\s+rect\s*=\s*evRect/, "应以 evRect 为初始矩形");
  assert.match(body, /openHighlightEditToolbar\(rec,\s*rect\)/, "纯高亮应调 openHighlightEditToolbar(rec, rect)");
  assert.match(body, /showPreviewViewer\(rec,\s*rect\)/, "批注应调 showPreviewViewer(rec, rect)");
});

test("reader-tab openBookTab 对新书启用 openNewTab + keepCursor:false + afterOpen", () => {
  // 提取 openBookTab 中 await openTab({...}) 的选项对象
  const match = tabSrc.match(/await\s+openTab\(\{[\s\S]*?\}\);/);
  assert.ok(match, "应存在 openBookTab 中的 openTab 调用");
  const opts = match[0];
  assert.match(opts, /openNewTab:\s*true/, "应传入 openNewTab: true");
  assert.match(opts, /keepCursor:\s*false/, "应传入 keepCursor: false 让思源切到新 tab");
  assert.match(opts, /afterOpen:\s*\(\)\s*=>/, "应传入 afterOpen 回调做兜底切换");
});

test("reader-tab openBookTab 对已有 tab 直接 switchTab", () => {
  const fn = tabSrc.match(/async\s+openBookTab[\s\S]*?(?=\n\s+\/\*\*|\n\s+async|\n\s+dispose|$)/)?.[0] ?? "";
  assert.match(fn, /existing\.tab\.parent\?\.switchTab/, "已有 tab 应通过 parent.switchTab 聚焦");
});

// ===== 2026-08-24 标注功能打磨回归（P0-P3）=====

test("P0: 存在统一 closeSelToolbar 且所有 onSel* 出口调用它（修 B1 样式条幽灵）", () => {
  assert.match(viewSrcNoComment, /function\s+closeSelToolbar\s*\(/, "应定义 closeSelToolbar 统一关闭函数");
  // 各 onSel* 函数体内必须收尾调用 closeSelToolbar（按单函数体提取，防跨函数误报）
  for (const fn of ["onSelCopy", "onSelDict", "onSelTranslate", "onSelSpeak", "onSelSend"]) {
    const re = new RegExp(`function\\s+${fn}\\s*\\([\\s\\S]*?\\n\\s*\\}`);
    const body = viewSrcNoComment.match(re)?.[0] ?? "";
    assert.ok(body, `应能提取 ${fn} 函数体`);
    assert.match(body, /closeSelToolbar\(\)/, `${fn} 应调用 closeSelToolbar 收尾`);
    assert.doesNotMatch(body, /selToolbar\s*=\s*\{\s*\.\.\.selToolbar,\s*visible:\s*false\s*\}/,
      `${fn} 不应再用分散式关闭，应走 closeSelToolbar`);
  }
});

test("P0: annEditor 死代码链路已移除（无 openAnnViewer/onAnnSave/onAnnCancel/onAnnDelete）", () => {
  assert.doesNotMatch(viewSrcNoComment, /function\s+openAnnViewer\b/, "openAnnViewer 应已删除");
  assert.doesNotMatch(viewSrcNoComment, /function\s+onAnnSave\b/, "onAnnSave 应已删除");
  assert.doesNotMatch(viewSrcNoComment, /function\s+onAnnCancel\b/, "onAnnCancel 应已删除");
  assert.doesNotMatch(viewSrcNoComment, /function\s+onAnnDelete\b/, "onAnnDelete 应已删除（edit 卡片版）");
  assert.doesNotMatch(viewSrcNoComment, /annEditor\s*=/, "不应再有 annEditor 状态赋值");
});

test("P1: 点样式即生效（O1 一键应用：样式条 onSelCreate / applyEditStyle）", () => {
  // 2026-09-04 对齐：pickStyle 已被「半分半合」两路取代——
  // create 模式点样式 = onSelCreate(s, lastColor) 立即落库；edit 模式 = applyEditStyle(s) 即改
  const row = viewSrcNoComment.match(/<div class="reader-style-row">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.ok(row, "应有 reader-style-row 样式条模板");
  assert.match(row, /onSelCreate\(s,\s*lastColor\)/, "create 模式点样式应立即 onSelCreate(s, lastColor) 落库");
  assert.match(row, /applyEditStyle\(s\)/, "edit 模式点样式应立即 applyEditStyle(s)");
  assert.match(viewSrcNoComment, /async\s+function\s+onSelCreate\s*\(/, "应定义 onSelCreate");
});

test("P2: 删除后提供撤销（O4 toastWithUndo + undoDelete）", () => {
  assert.match(viewSrcNoComment, /function\s+toastWithUndo\s*\(/, "应定义 toastWithUndo");
  assert.match(viewSrcNoComment, /function\s+undoDelete\s*\(/, "应定义 undoDelete");
  assert.match(viewSrcNoComment, /pendingDelete\s*=/, "应缓存刚删除记录用于撤销");
  // 模板撤销按钮
  assert.match(viewSrcNoComment, /on:click=\{undoDelete\}/, "toast 撤销按钮应绑定 undoDelete");
});

test("P2: 样式条内联展开（O5/R4 演进：reader-style-row 由 stripVisible 控制）", () => {
  // 2026-09-04 对齐：样式条不再用绝对定位 popover（.reader-style-strip 已删），
  // 改为工具栏内联行 .reader-style-row，由 selToolbar.stripVisible 控制展开，
  // ▾ 按钮绑定 toggleStyleStrip——天然规避顶部裁切。
  assert.match(viewSrcNoComment, /\.reader-style-row\s*\{/, "应有 .reader-style-row 内联样式条");
  assert.match(viewSrcNoComment, /stripVisible/, "应以 selToolbar.stripVisible 控制样式条显隐");
  assert.match(viewSrcNoComment, /toggleStyleStrip/, "▾ 按钮应绑定 toggleStyleStrip");
});

test("P3: 标注按钮一键快速落库（O2 演进：主按钮 onQuickAnnotate + ▾ 展开）", () => {
  // 2026-09-04 对齐：长按快速落库已演进为「半分半合」分体设计——
  // 主按钮单击 = onQuickAnnotate（上次样式直接落库）；▾ = toggleStyleStrip 展开样式条
  assert.match(viewSrcNoComment, /async\s+function\s+onQuickAnnotate\s*\(/, "应定义 onQuickAnnotate 快速落库");
  assert.match(viewSrcNoComment, /on:click=\{onQuickAnnotate\}/, "标注主按钮应绑定 onQuickAnnotate");
  assert.match(viewSrcNoComment, /on:click=\{toggleStyleStrip\}/, "▾ 展开按钮应绑定 toggleStyleStrip");
});

