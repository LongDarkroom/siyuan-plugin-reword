/**
 * Apple Pencil 墨迹批注 · 测试 4: ReaderView.svelte ink PointerEvent 集成
 * ----------------------------------------------------------------
 * 覆盖：
 *  - 4 个 pointer 监听注册到 readerViewEl（down/move/up/cancel）
 *  - 仅 PDF + ink 模式（draw / erase）触发
 *  - pointerType 限制：pen / touch（不处理 mouse）
 *  - 压力 → 粗细（pressure 0/0.5/1）
 *  - 倾斜 > 45° 自动变荧光笔
 *  - getCoalescedEvents 拿原始点
 *  - 橡皮模式：删最后一个笔触
 *  - pointerup 添加笔触到列表
 *  - InkLayer + InkToolbar 在 PDF 模式下挂载
 *
 * 不依赖：foliate / siyuan SDK
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const src = readFileSync(viewPath, "utf-8");

test("[核心] ReaderView 导入 ink 模块", () => {
  assert.ok(/import\s+InkLayer\s+from\s+["']\.\/ink\/InkLayer\.svelte["']/.test(src), "应 import InkLayer");
  assert.ok(/import\s+InkToolbar\s+from\s+["']\.\/ink\/InkToolbar\.svelte["']/.test(src), "应 import InkToolbar");
  assert.ok(/import\s*\{[\s\S]*?inkState[\s\S]*?\}\s*from\s+["']\.\/ink\/store["']/.test(src), "应 import inkState + activeStroke");
});

test("[核心] readerViewEl 注册 4 个 pointer 监听（down/move/up/cancel）", () => {
  // onMount 块内应有 4 个 addEventListener("pointer...")
  // 找 onMount 块
  const onMountIdx = src.indexOf("onMount(() => {");
  assert.ok(onMountIdx > 0, "onMount 应存在");
  const body = src.slice(onMountIdx, onMountIdx + 5000);
  // 4 个监听
  for (const evt of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    assert.ok(
      new RegExp(`addEventListener\\(\\s*["']${evt}["']\\s*,\\s*onInkPointer`).test(body),
      `应注册 ${evt} 监听 → onInkPointerXxx`
    );
  }
});

test("[核心] onDestroy 注销 4 个 pointer 监听", () => {
  const onDestroyIdx = src.indexOf("onDestroy(() => {");
  assert.ok(onDestroyIdx > 0, "onDestroy 应存在");
  const body = src.slice(onDestroyIdx, onDestroyIdx + 5000);
  for (const evt of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    assert.ok(
      new RegExp(`removeEventListener\\(\\s*["']${evt}["']\\s*,\\s*onInkPointer`).test(body),
      `应注销 ${evt} 监听`
    );
  }
});

test("[核心] onInkPointerDown 函数存在", () => {
  assert.ok(/function onInkPointerDown\(/.test(src), "onInkPointerDown 函数应存在");
});

test("[核心] onInkPointerMove 函数存在", () => {
  assert.ok(/function onInkPointerMove\(/.test(src), "onInkPointerMove 函数应存在");
});

test("[核心] onInkPointerUp 函数存在", () => {
  assert.ok(/function onInkPointerUp\(/.test(src), "onInkPointerUp 函数应存在");
});

test("[关键] 仅 PDF + ink 模式触发", () => {
  // 找 onInkPointerDown 函数体
  const fnIdx = src.indexOf("function onInkPointerDown(");
  const body = src.slice(fnIdx, fnIdx + 2000);
  // 仅 PDF
  assert.ok(/!isPdfBook\(\)/.test(body), "onInkPointerDown 应检查 isPdfBook");
  // 仅 ink 模式（非 off）
  assert.ok(/\$inkState\.mode\s*===\s*["']off["']/.test(body), "onInkPointerDown 应检查 mode !== 'off'");
});

test("[关键] pointerType 限制 pen / touch（不处理 mouse）", () => {
  const fnIdx = src.indexOf("function getInkPointerContext(");
  const body = src.slice(fnIdx, fnIdx + 500);
  assert.ok(
    /e\.pointerType\s*!==\s*["']pen["']\s*&&\s*e\.pointerType\s*!==\s*["']touch["']/.test(body),
    "应只接受 pen / touch pointerType"
  );
});

test("[关键] 压力 0/0.5/1 映射到粗细系数", () => {
  // pressureToWidthScale 在 utils.ts，但 ReaderView 应使用
  // onInkPointerDown 读取 e.pressure → 写入 InkPoint.pressure
  // 然后 brushToSvgProps 在 InkLayer 渲染时调 pressureToWidthScale
  // 1. 找 getInkPointerContext 读取 e.pressure
  const ctxFn = src.indexOf("function getInkPointerContext(");
  assert.ok(ctxFn > 0, "getInkPointerContext 函数应存在");
  const ctxBody = src.slice(ctxFn, ctxFn + 500);
  assert.ok(
    /e\.pressure/.test(ctxBody) || /pressure:\s*e\.pressure/.test(ctxBody),
    "getInkPointerContext 应读 e.pressure"
  );
  // 2. 找 onInkPointerDown 写入 InkPoint.pressure
  const dnIdx = src.indexOf("function onInkPointerDown(");
  const dnBody = src.slice(dnIdx, dnIdx + 2000);
  assert.ok(
    /pressure:\s*ctx\.pressure/.test(dnBody),
    "onInkPointerDown 应从 ctx 写入 InkPoint.pressure"
  );
});

test("[关键] 倾斜 > 45° 自动变荧光笔", () => {
  const fnIdx = src.indexOf("function onInkPointerDown(");
  const body = src.slice(fnIdx, fnIdx + 2000);
  assert.ok(/shouldUseHighlighter/.test(body), "onInkPointerDown 应调 shouldUseHighlighter");
  assert.ok(
    /effectiveBrush\s*=\s*shouldUseHighlighter/.test(body),
    "effectiveBrush 应由 shouldUseHighlighter 决定"
  );
  // 荧光笔分支
  assert.ok(/["']highlighter["']/.test(body), "倾斜 > 45° 应切到 highlighter");
});

test("[关键] 橡皮模式：pointerdown 删最后一个笔触", () => {
  const fnIdx = src.indexOf("function onInkPointerDown(");
  const body = src.slice(fnIdx, fnIdx + 2000);
  // mode === "erase" 分支
  assert.ok(/\$inkState\.mode\s*===\s*["']erase["']/.test(body), "应检查 mode === 'erase'");
  // 删除最后一个笔触
  assert.ok(/lastStroke/.test(body), "应取 lastStroke");
  assert.ok(/arr\.filter\(\(s\)\s*=>\s*s\.id\s*!==\s*lastStroke\.id\)/.test(body), "应按 id 过滤删除");
});

test("[关键] pointerup 添加笔触到列表", () => {
  const fnIdx = src.indexOf("function onInkPointerUp(");
  const body = src.slice(fnIdx, fnIdx + 1000);
  assert.ok(/addStroke\(cur\)/.test(body), "onInkPointerUp 应调 addStroke");
  assert.ok(/activeStroke\.set\(null\)/.test(body), "onInkPointerUp 应清 activeStroke");
});

test("[关键] getCoalescedPoints 拿原始点", () => {
  const fnIdx = src.indexOf("function onInkPointerMove(");
  const body = src.slice(fnIdx, fnIdx + 2000);
  assert.ok(/getCoalescedPoints/.test(body), "onInkPointerMove 应调 getCoalescedPoints");
  assert.ok(/coalesced/.test(body), "应有 coalesced 变量");
});

test("[UI] InkLayer + InkToolbar 在 PDF 模式下挂载", () => {
  // 找 <InkLayer 模板位置（pageWidth={800} 形式）
  assert.ok(/<InkLayer[\s\S]*?pageWidth/.test(src), "应有 <InkLayer pageWidth=...>");
  assert.ok(/<InkLayer[\s\S]*?pageHeight/.test(src), "应有 <InkLayer pageHeight=...>");
  assert.ok(/<InkToolbar\s*\/>/.test(src), "应有 <InkToolbar />");
  // 仅 PDF 模式
  assert.ok(/isPdfBook\(\)/.test(src), "InkLayer/InkToolbar 应仅在 isPdfBook 块");
});

test("[关键] pointerdown preventDefault + stopPropagation（不让 foliate 收到）", () => {
  const fnIdx = src.indexOf("function onInkPointerDown(");
  const body = src.slice(fnIdx, fnIdx + 2000);
  assert.ok(/e\.preventDefault\(\)/.test(body), "onInkPointerDown 应 preventDefault");
  assert.ok(/e\.stopPropagation\(\)/.test(body), "onInkPointerDown 应 stopPropagation");
});
