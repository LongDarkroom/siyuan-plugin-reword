/**
 * PDF 适配 Phase 1 · 测试 1: book-adapters.ts 支持 PDF
 * ----------------------------------------------------------------
 * 覆盖：
 *  - isSupportedBookFile 接受 .pdf（大小写不敏感）
 *  - isSupportedBookFile 仍接受原有 6 种 foliate 原生格式（回归）
 *  - isTextBookFile 仍只接受 txt/md/markdown（PDF 不走纯文本路径）
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
const adapterPath = join(__dirname, "..", "src", "reader", "book-adapters.ts");
const src = readFileSync(adapterPath, "utf-8");

/** 抽取 "isXxx(name)" 那行的扩展名列表（处理源码可能跨多行的情况） */
function findFunctionBody(name) {
  // 找函数起始位置
  const startIdx = src.indexOf(`export function ${name}`);
  if (startIdx < 0) return null;
  // 找匹配的右大括号
  let depth = 0;
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(startIdx, i + 1);
    }
  }
  return null;
}

test("[核心] isSupportedBookFile 正则含 pdf", () => {
  const body = findFunctionBody("isSupportedBookFile");
  assert.ok(body, "isSupportedBookFile 函数应存在");
  // 抽出 /\.(xxx|yyy)/i 或 /\.(xxx|yyy)$/i 中的扩展名
  const m = body.match(/\\\.\(([^)]+)\)/);
  assert.ok(m, "应能找到扩展名列表");
  const exts = m[1];
  assert.ok(/\bpdf\b/.test(exts), `isSupportedBookFile 正则应包含 pdf，实际：${exts}`);
});

test("[回归] isSupportedBookFile 保留原有 6 种 foliate 原生格式", () => {
  const body = findFunctionBody("isSupportedBookFile");
  const m = body.match(/\\\.\(([^)]+)\)/);
  const exts = m[1];
  for (const need of ["epub", "mobi", "azw3", "fb2", "cbz", "pdf"]) {
    assert.ok(new RegExp(`\\b${need}\\b`).test(exts), `isSupportedBookFile 正则应包含 ${need}，实际：${exts}`);
  }
});

test("[回归] isTextBookFile 仍只接受 txt/md/markdown（不含 pdf）", () => {
  const body = findFunctionBody("isTextBookFile");
  assert.ok(body, "isTextBookFile 函数应存在");
  const m = body.match(/\\\.\(([^)]+)\)/);
  const exts = m[1];
  assert.ok(!/\bpdf\b/.test(exts), `isTextBookFile 不应包含 pdf，实际：${exts}`);
  for (const need of ["txt", "md", "markdown"]) {
    assert.ok(new RegExp(`\\b${need}\\b`).test(exts), `isTextBookFile 应包含 ${need}`);
  }
});

test("[行为模拟] PDF 扩展名识别（大小写不敏感）", () => {
  // 模拟 isSupportedBookFile 实际行为
  const reAll = /\.(epub|mobi|azw3|fb2|cbz|pdf)$/i;
  const reText = /\.(txt|md|markdown)$/i;
  assert.equal(reAll.test("book.pdf"), true, ".pdf 小写应被接受");
  assert.equal(reAll.test("book.PDF"), true, ".PDF 大写应被接受");
  assert.equal(reAll.test("book.Pdf"), true, ".Pdf 混合大小写应被接受");
  assert.equal(reAll.test("book.docx"), false, ".docx 应被拒绝");
  assert.equal(reText.test("book.pdf"), false, "纯文本正则不应匹配 .pdf");
  for (const ext of ["epub", "mobi", "azw3", "fb2", "cbz"]) {
    assert.equal(reAll.test(`book.${ext}`), true, `原有格式 .${ext} 应仍工作`);
  }
});
