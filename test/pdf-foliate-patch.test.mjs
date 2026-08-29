/**
 * PDF 适配 Phase 1.5 · 测试 4: foliate vendor patch（view-light.js + pdf.js）
 * ----------------------------------------------------------------
 * 覆盖：
 *  - view-light.js 恢复 isPDF 函数（PDF 魔术字 %PDF-）
 *  - view-light.js 恢复 PDF 分支（去掉 "PDF removed" 注释）
 *  - pdf.js 改 import 路径从 npm '@pdfjs' 到本地 vendor
 *  - pdf.js worker 策略：构造绝对 URL（origin + /plugins/<name>/pdf.worker.mjs）
 *    copy-dist.mjs 手动复制 worker 到插件根目录，让思源 webview 能 fetch
 *  - getDocument 不再用 disableWorker: true（恢复 worker 模式）
 *  - cMap / standard_fonts 暂不加载（90% PDF 走内置字体）
 *  - 两处 patch 都有 [REword patch 2026-08-29] 标记
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
const vendorDir = join(__dirname, "..", "src", "reader", "vendor", "foliate-js");
const viewLightSrc = readFileSync(join(vendorDir, "view-light.js"), "utf-8");
const pdfSrc = readFileSync(join(vendorDir, "pdf.js"), "utf-8");

test("[view-light.js] isPDF 函数被恢复", () => {
  assert.ok(
    /const isPDF = async file => \{/.test(viewLightSrc),
    "isPDF 函数应被恢复"
  );
  // 关键魔术字 %PDF-
  assert.ok(
    /0x25[\s\S]*?0x50[\s\S]*?0x44[\s\S]*?0x46[\s\S]*?0x2d/.test(viewLightSrc),
    "isPDF 应检测 PDF 魔术字 0x25 0x50 0x44 0x46 0x2d (%PDF-)"
  );
});

test("[view-light.js] PDF 分支被恢复（去掉 PDF removed 注释）", () => {
  // 老的 "[REword-lite] PDF removed" 应被替换
  assert.ok(
    !/\[REword-lite\] PDF removed/.test(viewLightSrc),
    '老的 "[REword-lite] PDF removed" 注释应被替换/删除'
  );
  // 新的 PDF 分支应有 isPDF + makePDF
  assert.ok(
    /else if \(await isPDF\(file\)\)/.test(viewLightSrc),
    "PDF 分支应存在 (else if (await isPDF(file)))"
  );
  assert.ok(
    /await import\(['"]\.\/pdf\.js['"]\)/.test(viewLightSrc),
    "PDF 分支应动态 import './pdf.js'"
  );
  assert.ok(
    /makePDF\(file\)/.test(viewLightSrc),
    "PDF 分支应调 makePDF(file)"
  );
});

test("[view-light.js] PDF patch 带 [REword patch 2026-08-29] 标记", () => {
  // 至少有一处 PDF 适配的 REword patch 注释
  const rewordPatchCount = (viewLightSrc.match(/\[REword patch 2026-08-29\]/g) || []).length;
  assert.ok(
    rewordPatchCount >= 1,
    `view-light.js 应至少有 1 处 [REword patch 2026-08-29] 标记，实际：${rewordPatchCount}`
  );
});

test("[pdf.js] import 路径改为本地 vendor（不再用 npm @pdfjs）", () => {
  // 老的 npm import 应被替换
  assert.ok(
    !/^import\s+['"]@pdfjs\/pdf\.min\.mjs['"]/m.test(pdfSrc),
    "老的 `import '@pdfjs/pdf.min.mjs'` 应被替换"
  );
  // 新的相对路径 import
  assert.ok(
    /import\s+['"]\.\/vendor\/pdfjs\/pdf\.mjs['"]/.test(pdfSrc),
    "应改为 `import './vendor/pdfjs/pdf.mjs'` 相对路径"
  );
});

test("[pdf.js] worker 路径不再硬编码 /vendor/pdfjs/", () => {
  // 老代码：`const pdfjsPath = path => \`/vendor/pdfjs/${path}\``
  assert.ok(
    !/const pdfjsPath = path => `\/vendor\/pdfjs\/\$\{path\}`/.test(pdfSrc),
    "老的硬编码 /vendor/pdfjs/ 路径应被替换"
  );
  // 新代码：worker 用本地相对路径（pdfjsPath 还在，只是相对路径）
  assert.ok(
    /pdfjsPath\s*=\s*path\s*=>\s*`\.\/vendor\/pdfjs\/\$\{path\}`/.test(pdfSrc) ||
    /pdfjsPath\s*=\s*path\s*=>\s*['"]\.\/vendor\/pdfjs\//.test(pdfSrc),
    "pdfjsPath 应返回相对路径 ./vendor/pdfjs/..."
  );
});

test("[pdf.js] workerSrc 用绝对 URL 指向 /plugins/<name>/pdf.worker.mjs", () => {
  // Phase 1.5 修复：构造 origin + /plugins/siyuan-plugin-reword/pdf.worker.mjs
  // 让思源 webview 能 fetch 独立 worker 文件
  assert.ok(
    /location\.origin/.test(pdfSrc),
    "应用 globalThis.location.origin 构造绝对 URL"
  );
  assert.ok(
    /\/plugins\/siyuan-plugin-reword\/pdf\.worker\.mjs/.test(pdfSrc),
    "workerSrc 应指向 /plugins/siyuan-plugin-reword/pdf.worker.mjs"
  );
});

test("[pdf.js] 不再用 disableWorker: true（恢复 worker 模式）", () => {
  // Phase 1.5 恢复：worker 能成功加载，用 PDF.js 原生 worker 模式跑
  assert.ok(
    !/disableWorker\s*:\s*true/.test(pdfSrc),
    "getDocument 不应再含 disableWorker: true（已恢复 worker 模式）"
  );
});

test("[pdf.js] cMap / standard_fonts 暂不加载（避免 fetch 失败）", () => {
  // 90% PDF 用内置字体足够；如果有 PDF 显示为方块/乱码再补
  // 注意：排除 // 注释里的提及，只看实际代码行（不以 // 开头）
  const codeLines = pdfSrc.split("\n").filter((l) => !/^\s*\/\//.test(l));
  const codeOnly = codeLines.join("\n");
  assert.ok(
    !/cMapUrl\s*:\s*pdfjsPath/.test(codeOnly),
    "Phase 1.5 暂不设 cMapUrl（避免 fetch vendor/cmaps/ 失败）"
  );
  assert.ok(
    !/standardFontDataUrl\s*:\s*pdfjsPath/.test(codeOnly),
    "Phase 1.5 暂不设 standardFontDataUrl（避免 fetch vendor/standard_fonts/ 失败）"
  );
});

test("[pdf.js] REword patch 标记", () => {
  assert.ok(
    /\[REword patch 2026-08-29\]/.test(pdfSrc),
    "pdf.js 应有 [REword patch 2026-08-29] 标记"
  );
});

test("[回归] view-light.js 仍保留其他格式分支（EPUB/MOBI/FB2/CBZ）", () => {
  // 不应破坏其他格式
  assert.ok(/EPUB|epub\.js/.test(viewLightSrc), "EPUB 分支应保留");
  assert.ok(/isMOBI\(file\)/.test(viewLightSrc), "MOBI 分支应保留");
  assert.ok(/isFB2\(file\)/.test(viewLightSrc), "FB2 分支应保留");
  assert.ok(/isCBZ\(file\)/.test(viewLightSrc), "CBZ 分支应保留");
});

test("[回归] view-light.js 仍为 REword 自实现的 lite 版（行数 ~705）", () => {
  // 防止被替换回完整版 view.js
  const lineCount = viewLightSrc.split("\n").length;
  // view.js 是 704 行，view-light.js 应该是 705 左右（加了 isPDF 函数 + PDF 分支）
  assert.ok(lineCount >= 700 && lineCount <= 720, `view-light.js 行数应在 700-720 之间，实际：${lineCount}`);
});
