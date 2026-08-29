// 跨平台拷贝 dist 产物到插件根目录（替代 npm script 中的 `cp`，兼容 Windows）。
// 用法：node scripts/copy-dist.mjs
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const files = [
  // 主 bundle + 样式
  ["dist/index.js", "index.js"],
  ["dist/style.css", "index.css"],
  // [REword patch 2026-08-29] PDF 适配 Phase 1.5：PDF.js worker 独立文件
  // vite 单 CJS bundle 模式（inlineDynamicImports）下无法自动 emit worker，
  // 手动复制到插件根目录，让思源 webview 通过 /plugins/siyuan-plugin-reword/pdf.worker.mjs 访问
  [
    "src/reader/vendor/foliate-js/vendor/pdfjs/pdf.worker.mjs",
    "pdf.worker.mjs",
  ],
];

let ok = true;
for (const [src, dest] of files) {
  const srcPath = resolve(ROOT, src);
  const destPath = resolve(ROOT, dest);
  if (!existsSync(srcPath)) {
    console.error(`[copy-dist] 未找到 ${src}，请先运行 vite build`);
    ok = false;
    continue;
  }
  copyFileSync(srcPath, destPath);
  console.log(`[copy-dist] ${src} -> ${dest}`);
}

if (!ok) process.exit(1);
