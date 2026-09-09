/**
 * 书架 P2 Phase 1 · PDF 增强(大纲/页码/跳转)UI 集成测试
 * ----------------------------------------------------------------
 * 2026-09-01:对齐 Obsidian PDF++ 的 outline / 目录 / Go to page 三大能力。
 *
 * 覆盖 ReaderView.svelte 的 PDF 接入契约:
 *  - pdf-outline.ts 导入 + loadPdfOutline / extractPdfCurrentPage 调用
 *  - tocItems 形态兼容(EPUB / PDF 同一套扁平列表)
 *  - PDF 分支走 PDF.js 解析(else 分支走 foliate book.toc)
 *  - goToc 处理 pdf-page-{n} href 格式
 *  - 工具栏新加 reader-page-group / reader-page-input 组件
 *  - relocate 时更新 pdfCurrentPage + activeHref(findNearestPdfOutlineHref)
 *  - PDF 标题联动「第 N/T 页」,EPUB 维持原 tocItem.label
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewSrc = readFileSync(join(__dirname, "..", "src", "reader", "ReaderView.svelte"), "utf-8");
// 2026-09-02 拆分：PDF 缩放 + 页码控件迁入 PdfToolbar.svelte，样式在 reader-controls.less
const toolbarSrc = readFileSync(join(__dirname, "..", "src", "reader", "PdfToolbar.svelte"), "utf-8");
const controlsSrc = readFileSync(join(__dirname, "..", "src", "reader", "reader-controls.less"), "utf-8");
// R1 收敛：PDF 大纲抽取已从 ReaderView 迁入适配器层
//   DocumentLoader.buildBookDoc → adapters/pdf-adapter.ts → loadPdfOutline
const pdfAdapterSrc = readFileSync(join(__dirname, "..", "src", "reader", "adapters", "pdf-adapter.ts"), "utf-8");
const epubAdapterSrc = readFileSync(join(__dirname, "..", "src", "reader", "adapters", "epub-adapter.ts"), "utf-8");

/** 取源码中 `name` 函数的花括号配对函数体（纯切片，无 jsdom） */
function bodyOf2(src, name) {
  const idx = src.indexOf(name);
  if (idx < 0) return null;
  let open = -1;
  for (let i = idx; i < src.length - 1; i++) {
    if (src[i] === "{" && (src[i + 1] === "\n" || src[i + 1] === "\r")) {
      open = i;
      break;
    }
  }
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/* ================= 导入契约 ================= */

test("[导入] extractPdfCurrentPage 在 ReaderView / loadPdfOutline 在 pdf-adapter", () => {
  // R1 收敛：loadPdfOutline 是「打开 PDF 抽取大纲」，已随适配器拆到 pdf-adapter.ts；
  // ReaderView 只保留「阅读中反推当前页」的 extractPdfCurrentPage。
  assert.ok(
    /import\s*\{[^}]*loadPdfOutline[^}]*\}\s*from\s*"\.\.\/pdf-outline\.ts"/.test(pdfAdapterSrc),
    "pdf-adapter 应从 pdf-outline 导入 loadPdfOutline"
  );
  assert.ok(
    /import\s*\{[^}]*extractPdfCurrentPage[^}]*\}\s*from\s*"\.\.\/reader\/pdf-outline"/.test(viewSrc),
    "应从 pdf-outline 导入 extractPdfCurrentPage"
  );
});

/* ================= 状态变量 ================= */

test("[状态] 新增 pdfTotalPages + pdfCurrentPage", () => {
  assert.ok(/let pdfTotalPages\s*=\s*0/.test(viewSrc), "应有 pdfTotalPages 状态");
  assert.ok(/let pdfCurrentPage\s*=\s*0/.test(viewSrc), "应有 pdfCurrentPage 状态");
});

/* ================= openBook 接入 PDF outline ================= */

test("[openBook] PDF 大纲经适配器走 loadPdfOutline 拿 tocItems", () => {
  // R1 收敛：ReaderView 不再 if (isPdfBook()) 内联解析大纲，
  // 改为统一委托 DocumentLoader.buildBookDoc，由格式适配器分派。
  const idx = viewSrc.indexOf("Phase 1:PDF 与 EPUB 走不同数据源");
  assert.ok(idx > 0, "应能找到 Phase 1 锚点注释");
  const region = viewSrc.slice(idx, idx + 1500);
  assert.ok(/DocumentLoader\.buildBookDoc\(/.test(region), "应委托 DocumentLoader 抽取目录");
  assert.ok(/loadedModel\.book\.toc/.test(region), "应取统一 BookDoc.toc 赋给 tocItems");
  assert.ok(/loadedModel\.book\.pdfTotalPages/.test(region), "应取 pdfTotalPages");

  // PDF：pdf-adapter 调 loadPdfOutline → nodes 当 toc、totalPages 当总页数
  const pdfBody = pdfAdapterSrc.slice(pdfAdapterSrc.indexOf("async buildBookDoc"));
  assert.ok(/loadPdfOutline\(/.test(pdfBody), "PDF 适配器应调 loadPdfOutline");
  assert.ok(/pdf\.nodes/.test(pdfBody), "PDF 分支应取 nodes 作为 toc");
  assert.ok(/pdf\.totalPages/.test(pdfBody), "PDF 分支应取 totalPages 作为 pdfTotalPages");
  // EPUB 仍走 foliate toc 展平（旧 flattenToc 已更名 flattenFoliateToc）
  assert.ok(/flattenFoliateToc\(/.test(epubAdapterSrc), "EPUB 分支应继续展平 foliate toc");
});

/* ================= goToc 兼容 PDF href ================= */

test("[goToc] 处理 pdf-page-{N} href → 调 goPdfPage", () => {
  const m = viewSrc.match(/async function goToc\([\s\S]*?\n\s\s\}/);
  assert.ok(m, "应能抽出 goToc 函数体");
  assert.ok(/href\.startsWith\("pdf-page-"\)/.test(m[0]), "应识别 pdf-page- 前缀");
  assert.ok(/parseInt\(href\.slice\("pdf-page-"\.length\)/.test(m[0]), "应从 href 切出页码");
  assert.ok(/goPdfPage\(page\)/.test(m[0]), "应跳转到该页");
});

/* ================= goPdfPage 函数 ================= */

test("[goPdfPage] 三层方案:goToFraction → goToPage → lastLocation", () => {
  const m = viewSrc.match(/async function goPdfPage\([\s\S]*?\n\s\s\}/);
  assert.ok(m, "应有 goPdfPage 函数");
  // 方案 A:goToFraction
  assert.ok(/view\.goToFraction/.test(m[0]), "方案 A:用 goToFraction 反推 fraction");
  assert.ok(/\(targetPage\s*-\s*1\)\s*\/\s*pdfTotalPages/.test(m[0]), "fraction 公式正确");
  // 方案 B:goToPage 直接接口
  assert.ok(/\(view as any\)\.goToPage/.test(m[0]), "方案 B:fallback goToPage");
  // 方案 C:lastLocation 注入
  assert.ok(/view\.lastLocation\s*=/.test(m[0]), "方案 C:lastLocation 注入");
});

/* ================= findNearestPdfOutlineHref ================= */

test("[findNearestPdfOutlineHref] 找最近 ≤ 当前页 的 outline 节点", () => {
  // 函数定义 + 500 字符
  const idx = viewSrc.indexOf("function findNearestPdfOutlineHref");
  assert.ok(idx > 0, "应有 findNearestPdfOutlineHref 函数定义");
  const body = viewSrc.slice(idx, idx + 500);
  // 源码里 regex literal 是 `\\d+`(双反斜杠),测试侧要原样匹配
  assert.ok(/pdf-page-\(\\d\+\)/.test(body), "应正则匹配 pdf-page-N(双反斜杠 literal)");
  assert.ok(/<=\s*page/.test(body), "应找 ≤ 当前页的最近节点");
});

/* ================= relocate 接入 ================= */

test("[relocate] PDF 跳页时更新 pdfCurrentPage + activeHref", () => {
  const m = viewSrc.match(/view\.addEventListener\("relocate"[\s\S]*?\}\);/);
  assert.ok(m, "应有 relocate 事件处理器");
  // PDF 分支
  assert.ok(/if\s*\(isPdfBook\(\)\)\s*\{[\s\S]*?extractPdfCurrentPage\(/.test(m[0]),
    "PDF 分支应调 extractPdfCurrentPage");
  assert.ok(/findNearestPdfOutlineHref\(/.test(m[0]), "PDF 分支应调 findNearestPdfOutlineHref");
  // PDF 标题联动(在整个文件内查找,可能在 relocate 外)
  assert.ok(
    /chapterLabel\s*=\s*pdfTotalPages\s*>\s*0\s*\?\s*`第\s*\$\{page\}\/\$\{pdfTotalPages\}\s*页`/.test(viewSrc),
    "PDF 标题应为「第 N/T 页」"
  );
  // 非 PDF 走 tocItem.href
  assert.ok(/if\s*\(!isPdfBook\(\)\)/.test(m[0]), "非 PDF 应走 tocItem.href 旧逻辑");
});

/* ================= 工具栏 UI ================= */

test("[工具栏] PDF 页码控件在 PdfToolbar 组件，ReaderView 正确接线", () => {
  // 2026-09-02 拆分后控件本体在 PdfToolbar.svelte
  assert.ok(/reader-page-group/.test(toolbarSrc), "PdfToolbar 应含 reader-page-group");
  assert.ok(/reader-page-input/.test(toolbarSrc), "PdfToolbar 应含 reader-page-input");
  // ReaderView 在 readerMode === "pdf" 块内挂载并接线
  assert.ok(
    /{#if\s+readerMode\s*===\s*"pdf"\s*}\s*<PdfToolbar[\s\S]*?onGoPage=\{goPdfPage\}/.test(viewSrc),
    "ReaderView 应在 pdf 模式挂 PdfToolbar 并传 onGoPage={goPdfPage}"
  );
  assert.ok(/onPageInputKeydown=\{onPageInputKeydown\}/.test(viewSrc), "应接线 onPageInputKeydown");
  assert.ok(/onPageInputChange=\{onPageInputChange\}/.test(viewSrc), "应接线 onPageInputChange");
  assert.ok(/pdfTotalPages=\{pdfTotalPages\}/.test(viewSrc), "应传 pdfTotalPages");
});

test("[工具栏] 页码按钮 / 输入框 / 上下页按钮齐全（PdfToolbar）", () => {
  // 上一页 / 下一页
  assert.ok(/onGoPage\(Math\.max\(1,\s*pdfCurrentPage\s*-\s*1\)\)/.test(toolbarSrc),
    "上一页应调 onGoPage(currentPage - 1)");
  assert.ok(/onGoPage\(Math\.min\(pdfTotalPages,\s*pdfCurrentPage\s*\+\s*1\)\)/.test(toolbarSrc),
    "下一页应调 onGoPage(currentPage + 1)");
  // 输入框
  assert.ok(/reader-page-input[\s\S]*?type="number"/.test(toolbarSrc), "输入框应为 number 类型");
  assert.ok(/min="1"/.test(toolbarSrc), "输入框 min=1");
  assert.ok(/max=\{pdfTotalPages/.test(toolbarSrc), "输入框 max 绑 pdfTotalPages");
  // 回车跳转：ReaderView 的 onPageInputKeydown 内 Enter → goPdfPage
  const kb = bodyOf2(viewSrc, "function onPageInputKeydown");
  assert.ok(kb && /e\.key\s*!==\s*"Enter"/.test(kb) && /goPdfPage\(/.test(kb),
    "onPageInputKeydown 应在 Enter 时调 goPdfPage");
  // 失焦回填：onPageInputChange 内回填 pdfCurrentPage
  const chg = bodyOf2(viewSrc, "function onPageInputChange");
  assert.ok(chg && /String\(pdfCurrentPage\s*\|\|\s*""\)/.test(chg), "失焦后应回填 pdfCurrentPage");
  // 总页数显示
  assert.ok(/\{pdfTotalPages\s*\|\|\s*"\?"\}/.test(toolbarSrc), "总页数应为 pdfTotalPages || '?'");
});

/* ================= CSS 风格 ================= */

test("[CSS] reader-page-* 样式在 reader-controls.less 且用 SiYuan 主题变量", () => {
  assert.ok(/\.reader-page-group\s*\{/.test(controlsSrc), "应有 .reader-page-group 样式");
  assert.ok(/\.reader-page-input\s*\{/.test(controlsSrc), "应有 .reader-page-input 样式");
  assert.ok(/\.reader-page-btn\s*\{/.test(controlsSrc), "应有 .reader-page-btn 样式");
  // 关键:用 var(--b3-theme-primary) 等 SiYuan 主题变量
  assert.ok(/\.reader-page-btn:hover[\s\S]*?var\(--b3-theme-primary/.test(controlsSrc),
    "hover 态应用 SiYuan primary 主题色");
  assert.ok(/\.reader-page-input:focus[\s\S]*?var\(--b3-theme-primary/.test(controlsSrc),
    "input focus 态应用 SiYuan primary 主题色");
});

/* ================= TOC 抽屉复用 ================= */

test("[TOC] PDF 走现有 reader-toc 抽屉(不新增 UI 组件)", () => {
  // tocItems 已是 PDF 数据,抽屉无感切换
  assert.ok(/\{#each tocItems as item/.test(viewSrc), "抽屉应继续遍历 tocItems");
  assert.ok(/class:reader-toc-active=\{item\.href === activeHref\}/.test(viewSrc),
    "高亮判断走 activeHref(PDF 模式已被 relocate 正确更新)");
  // 不应新增 PDF 专用抽屉组件
  assert.ok(!/reader-toc-pdf|reader-pdf-toc/.test(viewSrc), "不应新增 PDF 专用抽屉(复用即可)");
});

/* ================= 容错 ================= */

test("[容错] PDF 加载失败不应崩溃(EPUB 路径仍可用)", () => {
  // loadPdfOutline 失败时 try/catch 兜底
  const m = viewSrc.match(/try\s*\{[\s\S]*?\}\s*catch\s*\{[\s\S]*?tocItems\s*=\s*\[\];/);
  assert.ok(m, "PDF 加载失败应被 catch 兜底,tocItems 置空");
  assert.ok(/pdfTotalPages\s*=\s*0/.test(viewSrc), "容错时 pdfTotalPages 归零");
});
