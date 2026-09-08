// 跨平台拷贝 dist 产物到插件根目录（替代 npm script 中的 `cp`，兼容 Windows）。
// 用法：node scripts/copy-dist.mjs
//
// 2026-09-04 P0：全脚本不执行任何删除。此前对 cmaps/ standard_fonts/ 先 rmSync 再 cpSync，
// 单次删除 170+ 文件，会触发批量删除保护使构建中断；改为 cpSync(force:true) 覆盖写，
// 效果等价（同名文件被覆盖）且不产生删除动作。
import { copyFileSync, cpSync, existsSync } from "node:fs";
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

// 2026-09-04 P1 修复：复制 PDF.js cMap + standard_fonts 目录到插件根
// cMap 缺失会导致 CJK PDF 中文显示为方块，PDF.js 抛 "cMapUrl/cMapPacked required" 警告
// （思源 webview 走相对路径 ./cmaps/ / ./standard_fonts/ 加载，与 worker 同一策略）
const dirs = [
  [
    "src/reader/vendor/foliate-js/vendor/pdfjs/cmaps",
    "cmaps",
  ],
  [
    "src/reader/vendor/foliate-js/vendor/pdfjs/standard_fonts",
    "standard_fonts",
  ],
];
for (const [src, dest] of dirs) {
  const srcPath = resolve(ROOT, src);
  const destPath = resolve(ROOT, dest);
  if (!existsSync(srcPath)) {
    console.error(`[copy-dist] 未找到 ${src}`);
    ok = false;
    continue;
  }
  // force:true 覆盖写，避免旧版本残留导致 cMap 错位。
  // 不使用 rmSync —— 删除 170+ 文件会被批量删除保护拦截。
  cpSync(srcPath, destPath, { recursive: true, force: true });
  console.log(`[copy-dist] ${src}/ -> ${dest}/`);
}

if (!ok) process.exit(1);
