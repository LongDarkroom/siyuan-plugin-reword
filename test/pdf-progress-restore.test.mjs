/**
 * PDF 阅读进度记忆修复（2026-09-09）源码切片断言。
 *
 * 实锤的三个根因：
 * 1. foliate fixed-layout 每次 relocate 固定上报 { fraction: 0, size: 1 }，
 *    SectionProgress.getProgress 把 fraction 算成「页尾边界」((index+1)/N)，
 *    恢复端 getSection 反解恰好落到下一页 → 每次会话 +1 页累积漂移。
 * 2. 缩放路径 scheduleProgressSave({ zoom }) 只带 zoom，saveProgress 整体替换
 *    meta.progress → cfi/fraction 被抹掉（存储实锤出现只剩 zoom 的记录）。
 * 3. onDestroy 只 clearTimeout 丢弃 pending——600ms 防抖窗口内的最后位置
 *    （快速翻页后立即关闭的场景）从未写盘。
 *
 * 修复：保存带显式 page（1-based）；PDF 恢复按 (page-1)/N 精确换算；
 * pendingSave 合并式（zoom-only 不再覆盖）；onDestroy flush。
 */
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const viewSrc = readFileSync(join(root, "src/reader/ReaderView.svelte"), "utf-8");
const typesSrc = readFileSync(join(root, "src/reader/library/library-types.ts"), "utf-8");

/** 花括号配对提取函数体（与 reader-bookmarks-annots.test.mjs 同款 bodyOf） */
function bodyOf(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return "";
  const start = src.indexOf("{", i);
  if (start < 0) return "";
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const ch = src[j];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  return "";
}

test("scheduleProgressSave：pendingSave 合并式，缩放-only 保存不再整体覆盖 cfi/fraction", () => {
  const b = bodyOf(viewSrc, "function scheduleProgressSave");
  assert.ok(b, "应取到 scheduleProgressSave 函数体");
  assert.match(b, /pendingSave\s*=\s*\{\s*\.\.\.\(pendingSave\s*\|\|\s*\{\}\),\s*\.\.\.p\s*\}/, "应先合并 pendingSave 再排定时器");
  assert.match(b, /600/, "防抖窗口仍为 600ms");
});

test("flushProgressSave：销毁时立即落盘挂起进度（快速翻页后立即关闭场景）", () => {
  assert.ok(viewSrc.includes("function flushProgressSave"), "应定义 flushProgressSave");
  const fb = bodyOf(viewSrc, "async function flushProgressSave");
  assert.ok(fb.includes("saveProgress"), "flush 应调 store.saveProgress");
  // onDestroy（主块）应调用 flush 而不是只 clearTimeout 丢弃
  const lastDestruct = viewSrc.lastIndexOf("onDestroy(");
  const tail = viewSrc.slice(lastDestruct, lastDestruct + 1600);
  assert.match(tail, /void flushProgressSave\(\)/, "onDestroy 应 flush 挂起进度");
});

test("保存端：PDF relocate 的 payload 带显式 page（1-based pdfCurrentPage）", () => {
  const i = viewSrc.indexOf("const savePayload: any = { cfi: d?.cfi, fraction: frac };");
  assert.ok(i > 0, "应找到保存 payload 构造点");
  const seg = viewSrc.slice(i, i + 400);
  assert.match(seg, /savePayload\.zoom\s*=\s*currentZoom/, "PDF 仍带 zoom");
  assert.match(seg, /savePayload\.page\s*=\s*pdfCurrentPage/, "PDF 应带显式页码");
});

test("恢复端：PDF 按 (page-1)/total 精确换算 fraction，不再吃页尾边界的 +1 漂移", () => {
  const i = viewSrc.indexOf("const saved = store.getProgress(bookId);");
  assert.ok(i > 0, "应找到恢复分支入口");
  const seg = viewSrc.slice(i, i + 1200);
  assert.match(seg, /saved\?\.page\s*&&\s*saved\.page\s*>\s*0/, "有 page 字段时走精确恢复");
  assert.match(seg, /\(saved\.page\s*-\s*1\)\s*\/\s*pdfTotalSections/, "fraction = (page-1)/total");
  assert.match(seg, /saved\?\.fraction/, "无 page 的旧数据回落 fraction 分支");
});

test("ReadingProgress 类型：新增可选 page 字段（老数据兼容）", () => {
  const i = typesSrc.indexOf("export interface ReadingProgress");
  const seg = typesSrc.slice(i, i + 500);
  assert.match(seg, /page\?:\s*number/, "应有 page?: number");
});

test("恢复端注释记录根因（fixed-layout size:1 → 页尾边界 → getSection +1）", () => {
  const i = viewSrc.indexOf("const saved = store.getProgress(bookId);");
  const seg = viewSrc.slice(i, i + 900);
  assert.match(seg, /getSection/, "注释应说明 getSection 反解偏移机制");
});
