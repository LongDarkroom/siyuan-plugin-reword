/**
 * PDF 适配 Phase 1.5 · 测试 5: copy-dist.mjs 复制 PDF.js worker
 * ----------------------------------------------------------------
 * 覆盖：
 *  - copy-dist.mjs 含 pdf.worker.mjs 复制条目
 *  - 源路径指向 vendor 里的 pdf.worker.mjs
 *  - 目标路径是插件根目录（思源 webview 通过 /plugins/<name>/ 访问）
 *  - 源文件实际存在
 *
 * 不依赖：foliate / siyuan SDK
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scriptPath = join(__dirname, "..", "scripts", "copy-dist.mjs");
const src = readFileSync(scriptPath, "utf-8");

// 找 files 数组里包含 pdf.worker.mjs 的条目
// 简化：直接匹源 + 目标两个相邻的字符串
const allPdfWorkerStrings = src.match(/['"][^'"]*pdf\.worker\.mjs['"]/g) || [];
// files 数组中相邻两条：源 + 目标
const srcStr = allPdfWorkerStrings.find((s) => /vendor/.test(s));
const destStr = allPdfWorkerStrings.find((s) => !/vendor/.test(s) && !/plugins/.test(s));

test("[核心] copy-dist.mjs 含 pdf.worker.mjs 复制条目", () => {
  assert.ok(allPdfWorkerStrings.length >= 2, "应至少有 2 个 pdf.worker.mjs 字符串（源 + 目标）");
});

test("[路径] 源路径指向 vendor 里的 pdf.worker.mjs", () => {
  assert.ok(srcStr, "应能找到源路径字符串");
  assert.ok(
    /vendor\/foliate-js\/vendor\/pdfjs\/pdf\.worker\.mjs/.test(srcStr) ||
    /vendor\/pdfjs\/pdf\.worker\.mjs/.test(srcStr),
    `源路径应包含 vendor/pdfjs/pdf.worker.mjs，实际：${srcStr}`
  );
});

test("[路径] 目标路径是插件根目录（无 /dist/ 前缀）", () => {
  assert.ok(destStr, "应能找到目标路径字符串");
  // 去掉引号
  const dest = destStr.replace(/['"]/g, "");
  assert.ok(
    !/^dist\//.test(dest) && !/\//.test(dest),
    `目标应是根目录文件名（无路径前缀），实际：${dest}`
  );
  assert.equal(dest, "pdf.worker.mjs", "目标文件名应为 pdf.worker.mjs");
});

test("[实际文件] 源 pdf.worker.mjs 存在", () => {
  const workerFilePath = join(
    __dirname,
    "..",
    "src",
    "reader",
    "vendor",
    "foliate-js",
    "vendor",
    "pdfjs",
    "pdf.worker.mjs"
  );
  assert.ok(existsSync(workerFilePath), `源文件应存在：${workerFilePath}`);
});

test("[入口] copy-dist.mjs 仍复制 index.js + style.css（回归）", () => {
  // 不能因为加了 pdf.worker.mjs 而丢了原条目
  assert.ok(/\[\s*["']dist\/index\.js["']\s*,\s*["']index\.js["']\s*\]/.test(src), "应保留 index.js 复制");
  assert.ok(/\[\s*["']dist\/style\.css["']\s*,\s*["']index\.css["']\s*\]/.test(src), "应保留 style.css 复制");
});

test("[注释] 复制条目附近应有 PDF 适配注释", () => {
  // 应该有 [REword patch] 注释说明
  const workerEntryIdx = src.indexOf("pdf.worker.mjs");
  assert.ok(workerEntryIdx > 0, "应能找到 pdf.worker.mjs");
  // 往前 500 字符内应有注释
  const before = src.slice(Math.max(0, workerEntryIdx - 500), workerEntryIdx);
  assert.ok(
    /\[REword patch[^\]]*\]/.test(before) || /PDF 适配/.test(before),
    "复制条目前应有 REword patch 注释"
  );
});
