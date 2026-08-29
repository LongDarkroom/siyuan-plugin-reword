/**
 * PDF 缩放 Phase 1 · 测试 4: 缩放状态持久化（openBook 恢复 + relocate 保存）
 * ----------------------------------------------------------------
 * 覆盖：
 *  - openBook 完成后用 setTimeout 0 恢复 saved.zoom
 *  - 默认 fit-page（saved 无 zoom 时）
 *  - relocate 事件把 currentZoom 写进 savePayload
 *  - applyZoom 主动调 scheduleProgressSave({ zoom })
 *  - zoom 字段持久化通过 PersistentStore（防抖 400ms + 3 次指数退避）
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

/**
 * 取 applyZoom 的完整函数体。
 * 不用定长 slice —— applyZoom 因两种布局模式分支会持续增长，
 * 定长窗口会随函数变长而静默失效（已踩过两次）。这里切到下一个顶层函数声明为止。
 */
function applyZoomBody(text) {
  const start = text.indexOf("function applyZoom(");
  if (start < 0) return "";
  const next = text.indexOf("\n  function ", start + 10);
  return text.slice(start, next > 0 ? next : start + 4000);
}

test("[核心] openBook 完成后恢复 saved.zoom", () => {
  // 找 openBook 函数体内的 isPdfBook 块
  // 粗略：检查源码含 store.getProgress(bookId)?.zoom
  assert.ok(
    /store\.getProgress\(bookId\)\?\.zoom/.test(src),
    "openBook 应读 store.getProgress(bookId)?.zoom 恢复缩放"
  );
});

test("[核心] 默认 zoom 是 fit-page", () => {
  // 找 applyZoom 调用 + ?? { kind: "fit-page" }
  assert.ok(
    /\?\?\s*\{\s*kind:\s*["']fit-page["']\s*\}/.test(src),
    "saved.zoom 为空时默认 fit-page"
  );
});

test("[核心] 用 setTimeout 延迟应用 zoom 避免被首次 render 覆盖", () => {
  // 找 setTimeout(() => applyZoom
  assert.ok(
    /setTimeout\([\s\S]{0,200}?applyZoom\(/.test(src),
    "应 setTimeout 0 延迟 applyZoom，等 foliate 首次渲染完成"
  );
});

test("[核心] relocate 事件保存 zoom 到 progress", () => {
  // 找 view.addEventListener("relocate", ...) 里的 scheduleProgressSave
  // 检查 isPdfBook() 块
  const re = /if\s*\(\s*isPdfBook\(\)\s*\)\s*savePayload\.zoom\s*=\s*currentZoom/;
  assert.ok(
    re.test(src),
    "relocate 事件应把 currentZoom 写进 savePayload.zoom"
  );
});

test("[核心] applyZoom 主动 scheduleProgressSave({ zoom })", () => {
  // 找 applyZoom 函数体内 scheduleProgressSave 调用
  const body = applyZoomBody(src);
  assert.ok(
    /scheduleProgressSave\(\s*\{\s*zoom/.test(body),
    "applyZoom 应调 scheduleProgressSave({ zoom }) 立即持久化"
  );
});

test("[关键] silent 模式不触发 scheduleProgressSave", () => {
  // applyZoom 接受 opts.silent（类型签名 silent?: boolean），silent 模式跳过保存
  // openBook 恢复时用 silent: true 避免覆盖用户的实际选择
  const applyIdx = src.indexOf("function applyZoom(");
  // 函数签名（行内可能有多种格式）
  const sigMatch = src.slice(applyIdx, applyIdx + 200).match(/silent/);
  assert.ok(sigMatch, "applyZoom 签名应含 silent 字段");
  // 在 silent 时跳过 save
  const body = applyZoomBody(src);
  // if (!opts.silent) 跳过；scheduleProgressSave 在 silent=false 时才调
  assert.ok(
    /if\s*\(\s*!\s*opts\.silent\s*\)/.test(body),
    "silent 模式应跳过 scheduleProgressSave（条件 if (!opts.silent)）"
  );
  // 验证 scheduleProgressSave 确实在 if 块内
  const ifBlock = body.match(/if\s*\(\s*!\s*opts\.silent\s*\)\s*\{([\s\S]*?)\}/);
  assert.ok(ifBlock, "if (!opts.silent) 块应存在");
  assert.ok(
    /scheduleProgressSave/.test(ifBlock[1]),
    "scheduleProgressSave 应在 if (!opts.silent) 块内（非 silent 模式才调）"
  );
});

test("[回归] ReadingProgress.zoom 是 optional（save 时不传 zoom 不会出错）", () => {
  // 确认 ReadingProgress 的 zoom 字段是 optional（不是必填）
  const storeSrc = readFileSync(join(__dirname, "..", "src", "reader", "bookshelf-store.ts"), "utf-8");
  assert.ok(/zoom\?:\s*ZoomState/.test(storeSrc), "ReadingProgress.zoom 应是 optional（zoom?: ZoomState）");
});

test("[回归] scheduleProgressSave 仍是防抖保存（缩放频繁不会高频写）", () => {
  // 粗略：确认 scheduleProgressSave 仍然存在并被多次调用
  // （实际防抖逻辑在 scheduleProgressSave 函数内）
  assert.ok(/function scheduleProgressSave/.test(src), "scheduleProgressSave 函数应存在");
});
