/**
 * 搜索面板重做（2026-08-29）
 * ----------------------------------------------------------------
 * 对齐思阅 / Readest 的全文搜索体验：从「计数器」升级为「结果导航器」。
 * 覆盖：
 *
 *  A. ReaderView.svelte doSearch 正确扁平化 foliate 的嵌套 subitems（此前只取顶层
 *     r.cfi，导致实时全文搜索收集不到结果、上下跳转失效）
 *  B. 搜索范围：全书 / 当前章（当前章走 foliate view.search({ index })）
 *  C. 搜索选项：区分大小写 / 全字匹配（透传到 foliate searchMatcher）
 *  D. 输入即搜（防抖 300ms）
 *  E. 键盘导航：↑/↓ 切换、Esc 关闭；goSearchResultAt 按索引跳转
 *  F. 结果列表 UI：章节标签 + 进度 + 上下文片段 + 命中高亮（{@html highlightExcerpt}）
 *  G. highlightExcerpt：先转义再包裹 <mark>（防 XSS）
 *
 * 不依赖：foliate / siyuan SDK / DOM（纯源码文本校验，与仓库既有测试风格一致）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..", "src");

const viewSrc = readFileSync(join(root, "reader", "ReaderView.svelte"), "utf-8");

/** 抽取函数体（按花括号配对切片，跳过签名里的内联类型） */
function bodyOf(src, name) {
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

/* ================= A. doSearch 扁平化 subitems ================= */

test("[A1] doSearch 扁平化 foliate 嵌套 subitems（修复实时搜索收不到结果）", () => {
  const b = bodyOf(viewSrc, "async function doSearch");
  assert.ok(b, "应取到 doSearch 函数体");
  assert.match(b, /r\?\.subitems/, "应处理全书搜索的嵌套 subitems");
  assert.match(b, /chapterLabel: label/, "应把章节 label 带入结果项");
  assert.match(b, /flat\.push\(/, "应把每条命中 push 进扁平结果数组");
  // 旧实现只取顶层 r.cfi，缺 subitems 分支 → 这里反向确认存在 subitems 分支
  assert.match(b, /for \(const sub of r\.subitems\)/, "应遍历 subitems 取出每条 cfi");
});

test("[A2] doSearch 单章搜索分支（顶层 r.cfi 直接取）", () => {
  const b = bodyOf(viewSrc, "async function doSearch");
  assert.ok(b, "应取到 doSearch 函数体");
  assert.match(b, /if \(r\?\.cfi\)/, "单章搜索结果直接是顶层 {cfi}");
  assert.match(b, /progressPercent: sectionPercent\(/, "应记录命中位置百分比");
});

/* ================= B. 搜索范围 ================= */

test("[B1] 当前章范围透传 index 给 foliate view.search", () => {
  const b = bodyOf(viewSrc, "async function doSearch");
  assert.ok(b, "应取到 doSearch 函数体");
  assert.match(b, /searchScope === "chapter"/, "应有「当前章」范围判断");
  assert.match(b, /opts\.index = currentSectionIndex/, "当前章应把章节索引传给 foliate");
});

test("[B2] currentSectionIndex 由 relocate 事件驱动", () => {
  assert.match(viewSrc, /currentSectionIndex = typeof d\?\.index === "number"/, "relocate 应更新 currentSectionIndex");
});

/* ================= C. 搜索选项 ================= */

test("[C1] 区分大小写 / 全字匹配透传到 foliate searchMatcher", () => {
  const b = bodyOf(viewSrc, "async function doSearch");
  assert.ok(b, "应取到 doSearch 函数体");
  assert.match(b, /matchCase: searchCaseSensitive/, "应透传 matchCase");
  assert.match(b, /matchWholeWords: searchWholeWord/, "应透传 matchWholeWords");
});

/* ================= D. 输入即搜（防抖） ================= */

test("[D1] onSearchInput 做 300ms 防抖自动搜索", () => {
  const b = bodyOf(viewSrc, "function onSearchInput");
  assert.ok(b, "应取到 onSearchInput 函数体");
  assert.match(b, /searchDebounce = setTimeout\(\(\) => void doSearch\(\), 300\)/, "空查询外应防抖 300ms 触发 doSearch");
  assert.match(b, /searchResults = \[\];/, "空查询应清空结果列表");
  assert.match(b, /searchIndex = -1;/, "空查询应重置索引");
});

/* ================= E. 键盘导航 ================= */

test("[E1] onSearchKeydown 支持 ↑/↓ 切换与 Esc 关闭", () => {
  const b = bodyOf(viewSrc, "function onSearchKeydown");
  assert.ok(b, "应取到 onSearchKeydown 函数体");
  assert.match(b, /ArrowDown/, "↓ 应切换下一条");
  assert.match(b, /ArrowUp/, "↑ 应切换上一条");
  assert.match(b, /Escape/, "Esc 应关闭搜索");
  assert.match(b, /closeSearch\(\)/, "Esc 应调用 closeSearch");
});

test("[E2] goSearchResultAt 按索引跳转（点击结果用）", () => {
  const b = bodyOf(viewSrc, "async function goSearchResultAt");
  assert.ok(b, "应取到 goSearchResultAt 函数体");
  assert.match(b, /view\.goTo\(searchResults\[idx\]\.cfi\)/, "应按索引 goTo 命中 cfi");
  assert.match(b, /Math\.max\(0, Math\.min\(i, searchResults\.length - 1\)\)/, "应做边界钳制");
});

test("[E3] closeSearch 关闭面板并清空", () => {
  const b = bodyOf(viewSrc, "function closeSearch");
  assert.ok(b, "应取到 closeSearch 函数体");
  assert.match(b, /showSearch = false/, "应隐藏搜索面板");
  assert.match(b, /clearSearch\(\)/, "应清空搜索状态");
});

/* ================= F. 结果列表 UI ================= */

test("[F1] 搜索面板含结果列表 / 章节标签 / 上下文片段 / 命中高亮", () => {
  assert.match(viewSrc, /class="reader-search-list"/, "应有结果列表容器");
  assert.match(viewSrc, /class="reader-search-item"/, "应有结果项");
  assert.match(viewSrc, /reader-search-item-chapter/, "应显示章节标签");
  assert.match(viewSrc, /reader-search-item-pct/, "应显示进度百分比");
  assert.match(viewSrc, /\{@html highlightExcerpt\(/, "命中词应高亮（<mark>）");
});

test("[F2] 范围与选项的 UI 控件齐备", () => {
  assert.match(viewSrc, /reader-search-scope/, "应有范围选择区");
  assert.match(viewSrc, /当前章/, "应有「当前章」范围按钮");
  assert.match(viewSrc, /全书/, "应有「全书」范围按钮");
  assert.match(viewSrc, /大小写/, "应有区分大小写开关");
  assert.match(viewSrc, /全字/, "应有全字匹配开关");
});

/* ================= G. highlightExcerpt 安全高亮 ================= */

test("[G1] highlightExcerpt 先转义再包裹 <mark>（防 XSS）", () => {
  const b = bodyOf(viewSrc, "function highlightExcerpt");
  assert.ok(b, "应取到 highlightExcerpt 函数体");
  assert.match(b, /escapeHtml\(/, "应先转义原文");
  assert.match(b, /<mark>\$\{m\}<\/mark>/, "命中词应包进 <mark>");
  assert.match(b, /new RegExp\(esc, caseSensitive \? "g" : "gi"\)/, "应支持大小写选项");
});
