/**
 * PDF 适配 Phase 1 · 测试 2: BookshelfView.svelte 接受 PDF
 * ----------------------------------------------------------------
 * 覆盖：
 *  - ACCEPT 常量包含 .pdf
 *  - ACCEPT 仍包含原有 8 种格式（回归）
 *  - 拖拽提示文案含 "PDF"
 *  - 空书架提示文案含 "PDF"
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
const viewPath = join(__dirname, "..", "src", "reader", "BookshelfView.svelte");
const src = readFileSync(viewPath, "utf-8");

test("[核心] ACCEPT 字符串包含 .pdf", () => {
  const m = src.match(/const ACCEPT = "([^"]+)"/);
  assert.ok(m, "ACCEPT 常量应存在");
  const accept = m[1];
  assert.ok(accept.includes(".pdf"), `ACCEPT 应包含 .pdf，实际：${accept}`);
});

test("[回归] ACCEPT 仍包含原有 8 种格式", () => {
  const m = src.match(/const ACCEPT = "([^"]+)"/);
  const accept = m[1];
  for (const need of [".epub", ".mobi", ".azw3", ".fb2", ".cbz", ".pdf", ".txt", ".md", ".markdown"]) {
    assert.ok(accept.includes(need), `ACCEPT 应包含 ${need}，实际：${accept}`);
  }
});

test("[UI 提示] 拖拽 dropzone hint 含 PDF", () => {
  // dropzone-hint 通常在 onDragEnter/onDragOver 区域附近
  const hintMatch = src.match(/bookshelf-dropzone-hint[^>]*>([^<]+)</);
  assert.ok(hintMatch, "dropzone hint 应存在");
  const hint = hintMatch[1];
  assert.ok(/PDF/.test(hint), `拖拽提示应含 PDF，实际：${hint}`);
  // 同时不应丢其他格式
  for (const need of ["EPUB", "MOBI", "AZW3", "FB2", "CBZ", "TXT", "Markdown"]) {
    assert.ok(hint.includes(need), `拖拽提示应含 ${need}，实际：${hint}`);
  }
});

test("[UI 提示] 空书架 empty-hint 含 PDF", () => {
  // 空书架文案通常含 "支持 EPUB"
  const emptyHints = src.match(/bookshelf-empty-hint[^>]*>([^<]+)</g) || [];
  assert.ok(emptyHints.length > 0, "应至少有一个 empty-hint");
  const allText = emptyHints.map((m) => m).join(" ");
  assert.ok(/PDF/.test(allText), `空书架提示应含 PDF，实际：${allText.slice(0, 200)}`);
});

test("[file input 绑定] fileInput 的 accept 属性绑定到 ACCEPT", () => {
  const inputMatch = src.match(/<input[^>]*type="file"[^>]*>/s);
  assert.ok(inputMatch, "file input 应存在");
  const input = inputMatch[0];
  assert.ok(/accept=\{ACCEPT\}/.test(input), "file input 应绑定到 ACCEPT 常量");
});
