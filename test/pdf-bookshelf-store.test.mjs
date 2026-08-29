/**
 * PDF 适配 Phase 1 · 测试 3: bookshelf-store.ts 接受 PDF
 * ----------------------------------------------------------------
 * 覆盖：
 *  - BookMeta.format 注释含 pdf
 *  - ReadingProgress 注释说明 PDF 用法（fraction + index）
 *  - importBook 扩展名正则含 pdf
 *  - importBook 增加 `else if (ext === "pdf")` 分支
 *  - extractPdfMeta 函数存在（private 但能 grep）
 *  - extractPdfMeta 内部使用 PDF.js vendor 路径
 *  - extractPdfMeta 有容错（try/catch 返回 {}）
 *  - PDF 分支保存 cover 到 covers 目录
 *
 * 不依赖：foliate / siyuan SDK（纯 grep 源码验证）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const storePath = join(__dirname, "..", "src", "reader", "bookshelf-store.ts");
const src = readFileSync(storePath, "utf-8");

/** 抽取 JSDoc 注释块（紧跟 target 之前） */
function jsDocBefore(target) {
  const idx = src.indexOf(target);
  if (idx < 0) return null;
  // 往前找 /** 起始
  const startMarker = "/**";
  const start = src.lastIndexOf(startMarker, idx);
  if (start < 0) return null;
  // 找 */ 结束
  const end = src.indexOf("*/", start);
  if (end < 0 || end > idx) return null;
  return src.slice(start + startMarker.length, end);
}

/** 抽取函数体（处理嵌套花括号） */
function functionBody(name) {
  const startIdx = src.indexOf(`private async ${name}`);
  if (startIdx < 0) return null;
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

test("[BookMeta] format 字段 JSDoc 注释含 pdf", () => {
  const comment = jsDocBefore("format: string;");
  assert.ok(comment, "format 字段前应有 JSDoc 注释");
  assert.ok(/\bpdf\b/.test(comment), `format 注释应含 pdf，实际：${comment.trim()}`);
});

test("[ReadingProgress] JSDoc 注释说明 fraction + index（PDF 用 pageIndex）", () => {
  const comment = jsDocBefore("export interface ReadingProgress");
  assert.ok(comment, "ReadingProgress 之前应有 JSDoc 注释");
  // 至少说明 fraction 和 index 字段（PDF 用这两个）
  assert.ok(/fraction/.test(comment), "注释应说明 fraction 字段");
  assert.ok(/index/.test(comment), "注释应说明 index 字段（PDF 用作页码）");
});

test("[importBook] 扩展名正则含 pdf", () => {
  // 找 nameBase = file.name.replace(/\.(...)/i, ...) 那一行
  const line = src.split("\n").find((l) => l.includes("nameBase = file.name.replace"));
  assert.ok(line, "nameBase 扩展名替换行应存在");
  const m = line.match(/\\\.\(([^)]+)\)/);
  assert.ok(m, "应能抽出扩展名列表");
  const exts = m[1];
  assert.ok(/\bpdf\b/.test(exts), `扩展名正则应含 pdf，实际：${exts}`);
  // 回归
  for (const need of ["epub", "mobi", "azw3", "fb2", "cbz", "pdf", "txt", "md", "markdown"]) {
    assert.ok(new RegExp(`\\b${need}\\b`).test(exts), `扩展名正则应含 ${need}`);
  }
});

test("[importBook] PDF 分支存在（else if ext === pdf）", () => {
  const epubIdx = src.indexOf('if (ext === "epub")');
  const pdfIdx = src.indexOf('else if (ext === "pdf")');
  assert.ok(epubIdx > 0, "EPUB 分支应存在");
  assert.ok(pdfIdx > 0, 'PDF 分支 `else if (ext === "pdf")` 应存在');
  assert.ok(pdfIdx > epubIdx, "PDF 分支应在 EPUB 分支之后");
});

test("[核心] extractPdfMeta 私有方法存在", () => {
  const m = src.match(/private async extractPdfMeta\(/);
  assert.ok(m, "extractPdfMeta 方法应存在");
});

test("[实现] PDF 分支调用 extractPdfMeta + 赋值元数据", () => {
  const pdfBlock = src.match(/else if \(ext === "pdf"\) \{([\s\S]*?)\n  \}/);
  assert.ok(pdfBlock, "PDF 分支应存在");
  const block = pdfBlock[1];
  assert.ok(/extractPdfMeta\(file\)/.test(block), "PDF 分支应调 extractPdfMeta");
  assert.ok(/title\s*=\s*meta\.title/.test(block), "应赋值 title");
  assert.ok(/author\s*=\s*meta\.author/.test(block), "应赋值 author");
  assert.ok(/meta\.cover/.test(block), "应处理封面");
});

test("[实现] extractPdfMeta 用 PDF.js vendor", () => {
  assert.ok(
    /vendor\/foliate-js\/vendor\/pdfjs\/pdf\.mjs/.test(src),
    "extractPdfMeta 应 import vendor PDF.js"
  );
  assert.ok(/globalThis.*pdfjsLib/.test(src), "应读 globalThis.pdfjsLib");
  assert.ok(/pdfjsLib\.getDocument/.test(src), "应调 pdfjsLib.getDocument");
});

test("[容错] extractPdfMeta 有顶层 try/catch + catch 返回 {}", () => {
  // 找 extractPdfMeta 函数末尾（下一个 `private async` 或 `  }` 单行）
  const startIdx = src.indexOf("private async extractPdfMeta");
  assert.ok(startIdx > 0, "extractPdfMeta 函数应存在");
  // 函数体起点：跳过 `Promise<{ ... }>` 签名后的第一个 ` {`
  // 签名以 `> {` 结尾，函数体以 ` {` 开头
  const sigEnd = src.indexOf("> {", startIdx);
  assert.ok(sigEnd > 0, "函数签名应以 `> {` 结尾");
  // 函数体起点 = ` {` 之后的 `{` 位置
  const bodyStart = sigEnd + 2; // 跳过 `> `
  // 找函数体右大括号（深度计数）
  let depth = 0;
  let bodyEnd = -1;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  assert.ok(bodyEnd > bodyStart, "应能找到函数体结束");
  const body = src.slice(bodyStart, bodyEnd);

  // 顶层 try/catch（函数体的第一个 try）
  const firstTry = body.indexOf("try {");
  assert.ok(firstTry > 0, "extractPdfMeta 应有顶层 try {");

  // 从 firstTry 之后找第一个 catch
  const catchIdx = body.indexOf("catch", firstTry);
  assert.ok(catchIdx > 0, "try 之后应有 catch");
  // catch 块（catch 之后到函数末尾）应包含 return {}
  const catchBlock = body.slice(catchIdx);
  assert.ok(/return\s*\{\s*\}/.test(catchBlock), "catch 应返回空对象 {}");
});

test("[封面] PDF 分支写 cover 路径 + putFile", () => {
  const pdfBlock = src.match(/else if \(ext === "pdf"\) \{([\s\S]*?)\n  \}/);
  assert.ok(pdfBlock, "PDF 分支应存在");
  const block = pdfBlock[1];
  assert.ok(/covers/.test(block) && /\$\{id\}/.test(block), "应有 covers/${id} 路径");
  assert.ok(/meta\.cover\.ext/.test(block), "应有 meta.cover.ext 扩展名");
  assert.ok(/putFile\(coverPath/.test(block), "应 putFile cover");
});

test("[扩展名] importBook 默认扩展名兜底仍为 epub（保持兼容）", () => {
  const line = src.split("\n").find((l) => l.includes("file.name.match"));
  assert.ok(line, "扩展名匹配行应存在");
  assert.ok(/\?\?\s*"epub"/.test(line), "fallback 应为 epub（向后兼容）");
});
