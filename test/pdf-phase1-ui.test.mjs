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

/* ================= 导入契约 ================= */

test("[导入] ReaderView 引入 loadPdfOutline + extractPdfCurrentPage", () => {
  assert.ok(
    /import\s*\{[^}]*loadPdfOutline[^}]*\}\s*from\s*"\.\.\/reader\/pdf-outline"/.test(viewSrc),
    "应从 pdf-outline 导入 loadPdfOutline"
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

test("[openBook] PDF 分支走 loadPdfOutline 拿 tocItems", () => {
  // 找 Phase 1 PDF 注释作为锚点(更精确)
  const idx = viewSrc.indexOf("Phase 1:PDF 与 EPUB 走不同数据源");
  assert.ok(idx > 0, "应能找到 Phase 1 锚点注释");
  const region = viewSrc.slice(idx, idx + 1500);
  assert.ok(/if\s*\(isPdfBook\(\)\)/.test(region), "应按 isPdfBook 分支");
  assert.ok(/loadPdfOutline\(/.test(region), "PDF 分支应调 loadPdfOutline");
  assert.ok(/pdfResult\.nodes/.test(region), "PDF 分支应取 nodes 赋给 tocItems");
  assert.ok(/pdfResult\.totalPages/.test(region), "PDF 分支应取 totalPages 赋给 pdfTotalPages");
  // EPUB 仍走 flattenToc(在 else 分支)
  assert.ok(/flattenToc\(/.test(region), "EPUB 分支应继续用 flattenToc");
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

test("[工具栏] PDF 工具栏新增 reader-page-group + reader-page-input", () => {
  // 应在 isPdfBook() 块内
  assert.ok(
    /{#if\s+isPdfBook\(\)[\s\S]*?reader-page-group[\s\S]*?reader-page-input/.test(viewSrc),
    "isPdfBook 块内应含 reader-page-group + reader-page-input"
  );
});

test("[工具栏] 页码按钮 / 输入框 / 上下页按钮齐全", () => {
  // 抽 Phase 1 PDF 注释开头到 reader-page-group 的 </span> 段
  const idx = viewSrc.indexOf("<!-- [2026-09-01] Phase 1:PDF");
  assert.ok(idx > 0, "应有 Phase 1 注释");
  const region = viewSrc.slice(idx, idx + 4000);
  // 上一页
  assert.ok(/goPdfPage\(Math\.max\(1,\s*pdfCurrentPage\s*-\s*1\)\)/.test(region),
    "上一页应调 goPdfPage(currentPage - 1)");
  // 下一页
  assert.ok(/goPdfPage\(Math\.min\(pdfTotalPages,\s*pdfCurrentPage\s*\+\s*1\)\)/.test(region),
    "下一页应调 goPdfPage(currentPage + 1)");
  // 输入框
  assert.ok(/reader-page-input[\s\S]*?type="number"/.test(region),
    "输入框应为 number 类型");
  assert.ok(/min="1"/.test(region), "输入框 min=1");
  assert.ok(/max=\{pdfTotalPages/.test(region), "输入框 max 绑 pdfTotalPages");
  // 回车跳转 - 接受两种实现:内联箭头函数 或 命名函数
  const enterTriggersGoPdfPage =
    /e\.key\s*===\s*"Enter"[\s\S]*?goPdfPage/.test(region) ||
    /onPageInputKeydown[\s\S]*?e\.key\s*!==\s*"Enter"[\s\S]*?goPdfPage/.test(viewSrc);
  assert.ok(enterTriggersGoPdfPage, "回车应触发 goPdfPage");
  // 失焦回填 - 接受内联或命名函数
  const blurRefills =
    /String\(pdfCurrentPage\s*\|\|\s*""\)/.test(region) ||
    /onPageInputChange[\s\S]*?String\(pdfCurrentPage\s*\|\|\s*""\)/.test(viewSrc);
  assert.ok(blurRefills, "失焦后应回填 pdfCurrentPage");
  // 总页数显示
  assert.ok(/\{pdfTotalPages\s*\|\|\s*"\?"\}/.test(region), "总页数应为 pdfTotalPages || '?'");
});

/* ================= CSS 风格 ================= */

test("[CSS] reader-page-group 用 SiYuan 主题变量", () => {
  // 应有 reader-page-* CSS 类
  assert.ok(/\.reader-page-group\s*\{/.test(viewSrc), "应有 .reader-page-group 样式");
  assert.ok(/\.reader-page-input\s*\{/.test(viewSrc), "应有 .reader-page-input 样式");
  assert.ok(/\.reader-page-btn\s*\{/.test(viewSrc), "应有 .reader-page-btn 样式");
  // 关键:用 var(--b3-theme-primary) 等 SiYuan 主题变量
  assert.ok(/\.reader-page-btn:hover[\s\S]*?var\(--b3-theme-primary/.test(viewSrc),
    "hover 态应用 SiYuan primary 主题色");
  assert.ok(/\.reader-page-input:focus[\s\S]*?var\(--b3-theme-primary/.test(viewSrc),
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
