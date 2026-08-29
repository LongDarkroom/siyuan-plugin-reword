/**
 * 书签 / 摘录汇总 / 摘录回跳深链（2026-08-29 新增）
 * ----------------------------------------------------------------
 * 对齐 Obsidian weave 的「书签 + 摘录笔记汇总 + 双向溯源」沉淀链，
 * 补上 REword 之前缺的中间一段。覆盖：
 *
 *  A. bookshelf-store.ts 书签数据层
 *     - BookMark 接口 + BookMeta.bookmarks 字段（optional，老数据兼容）
 *     - updateMeta 的 Pick 放开 bookmarks，并做清洗 + 按 createdAt 升序
 *     - getBookmarks / addBookmark / removeBookmark / renameBookmark / toggleBookmark
 *     - addBookmark 同 cfi 幂等（不重复添加）
 *     - toggleBookmark 返回 { list, added }
 *     - bookmarks 为空时写回 undefined（不往索引里塞空数组）
 *
 *  B. ReaderView.svelte 深链（{{link}}）
 *     - buildBookDeepLink 存在，产出 siyuan://plugins/<插件名><tab 类型>?data=…
 *     - onSelSend 里 link 不再是恒空串（此前 link: "" 是死变量）
 *
 *  C. ReaderView.svelte 书签 / 摘录抽屉
 *     - 底栏 🔖 / 📑 按钮绑定 toggleBookmarkDrawer / toggleAnnots
 *     - showBookmarks / showAnnots 抽屉模板存在
 *     - refreshAnnotsList 走 annStore.getByBook 且过滤软删 deletedAt
 *     - exportAnnots 导出 Markdown 到剪贴板
 *     - toggleCurrentBookmark 取 view.lastLocation.cfi
 *
 *  D. index.ts 协议入口 + reader-tab.ts 兜底解析 + 默认模板
 *     - eventBus.on("open-siyuan-url-plugin") 注册并配对 off
 *     - onOpenBookUrl 解析 data JSON 后调用 jumpToReading
 *     - reader-tab init 对 custom.data 字符串做 JSON 兜底（防开空白页签）
 *     - READER_DEFAULT_SETTINGS.note.linkFormat 默认含 {{link}}
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

const storeSrc = readFileSync(join(root, "reader", "bookshelf-store.ts"), "utf-8");
const viewSrc = readFileSync(join(root, "reader", "ReaderView.svelte"), "utf-8");
const indexSrc = readFileSync(join(root, "index.ts"), "utf-8");
const tabSrc = readFileSync(join(root, "reader", "reader-tab.ts"), "utf-8");
const settingsSrc = readFileSync(join(root, "reader", "reader-settings.ts"), "utf-8");

/**
 * 抽取函数体（按花括号配对切片）。
 * 起点用 `{\n`（紧跟换行）定位函数体左花括号 —— 这样能跳过签名里的内联类型
 * （如 `bm: { cfi: string }`、`(e: { url?: string })`），否则会切到类型注解上。
 */
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

/* ================= A. 书签数据层 ================= */

test("[A1] BookMark 接口存在且字段齐备", () => {
  const m = storeSrc.match(/export interface BookMark \{([\s\S]*?)\n\}/);
  assert.ok(m, "应声明 BookMark 接口");
  for (const f of ["id", "cfi", "label", "excerpt", "createdAt"]) {
    assert.match(m[1], new RegExp(`\\b${f}\\??:`), `BookMark 应含 ${f}`);
  }
});

test("[A2] BookMeta 新增可选 bookmarks 字段（老数据兼容）", () => {
  const m = storeSrc.match(/export interface BookMeta \{([\s\S]*?)\n\}/);
  assert.ok(m, "应有 BookMeta 接口");
  assert.match(m[1], /bookmarks\?:\s*BookMark\[\]/, "BookMeta 应有可选 bookmarks 字段");
});

test("[A3] updateMeta 的 Pick 放开 bookmarks", () => {
  const m = storeSrc.match(/async updateMeta\(([\s\S]*?)\): Promise<boolean>/);
  assert.ok(m, "应有 updateMeta");
  assert.match(m[1], /"bookmarks"/, 'updateMeta 的 Pick 应含 "bookmarks"');
});

test("[A4] updateMeta 对 bookmarks 做清洗并按 createdAt 升序", () => {
  const b = bodyOf(storeSrc, "async updateMeta");
  assert.ok(b, "应取到 updateMeta 函数体");
  const seg = b.slice(b.indexOf("patch.bookmarks !== undefined"));
  assert.ok(seg.length > 0, "应有 bookmarks 分支");
  assert.match(seg, /\.filter\(/, "应过滤非法书签项");
  assert.match(seg, /createdAt/, "应处理 createdAt");
  assert.match(seg, /\.sort\(\(a, b\) => a\.createdAt - b\.createdAt\)/, "应按 createdAt 升序");
  assert.match(seg, /meta\.bookmarks = clean\.length \? clean : undefined/, "空列表应写回 undefined");
});

test("[A5] 五个书签方法齐备", () => {
  for (const fn of [
    "getBookmarks",
    "addBookmark",
    "removeBookmark",
    "renameBookmark",
    "toggleBookmark",
  ]) {
    assert.match(storeSrc, new RegExp(`async ${fn}\\(|${fn}\\(`), `应有 ${fn} 方法`);
  }
});

test("[A6] addBookmark 同 cfi 幂等（不重复添加）", () => {
  const b = bodyOf(storeSrc, "async addBookmark");
  assert.ok(b, "应取到 addBookmark 函数体");
  assert.match(b, /list\.some\(\(b\) => b\.cfi === cfi\)/, "应先查重");
  assert.match(b, /return list/, "命中已有 cfi 时应原样返回");
});

test("[A7] toggleBookmark 返回 { list, added } 且已存在则删除", () => {
  const b = bodyOf(storeSrc, "async toggleBookmark");
  assert.ok(b, "应取到 toggleBookmark 函数体");
  assert.match(b, /added: false/, "已存在时应返回 added:false");
  assert.match(b, /added: true/, "新增时应返回 added:true");
  assert.match(b, /removeBookmark\(id, hit\.id\)/, "已存在时应走删除分支");
});

/* ================= B. 摘录回跳深链 ================= */

test("[B1] buildBookDeepLink 存在且产出思源自定义协议", () => {
  assert.match(viewSrc, /function buildBookDeepLink\(/, "应有 buildBookDeepLink");
  const b = bodyOf(viewSrc, "function buildBookDeepLink");
  assert.ok(b, "应取到函数体");
  assert.match(b, /siyuan:\/\/plugins\/siyuan-plugin-rewordreader\?data=/, "应为 siyuan://plugins/<插件名><tab类型>?data=");
  assert.match(b, /encodeURIComponent\(JSON\.stringify\(/, "data 应 JSON + URL 编码（CFI 含特殊字符）");
  assert.match(b, /\[回原文\]/, "应渲染成可直接点 Markdown 链接");
});

test("[B2] onSelSend 的 link 不再是恒空串（此前是死变量）", () => {
  const b = bodyOf(viewSrc, "function onSelSend");
  assert.ok(b, "应取到 onSelSend 函数体");
  assert.match(b, /link: buildBookDeepLink\(/, "link 应调用 buildBookDeepLink");
  assert.doesNotMatch(b, /link:\s*"",/, "link 不应再硬编码为空串");
});

/* ================= C. 书签 / 摘录抽屉 ================= */

test("[C1] 底栏有书签与摘录按钮并绑定对应 toggle", () => {
  assert.match(viewSrc, /on:click=\{toggleBookmarkDrawer\}/, "🔖 应绑定 toggleBookmarkDrawer");
  assert.match(viewSrc, /on:click=\{toggleAnnots\}/, "📑 应绑定 toggleAnnots");
  const start = viewSrc.indexOf('<div class="reader-bottom-bar"');
  assert.ok(start > -1, "应定位到底栏");
  const end = viewSrc.indexOf("{#if showTtsBar}", start); // 底栏紧跟着朗读条
  const bar = viewSrc.slice(start, end > -1 ? end : start + 2500);
  assert.match(bar, /🔖/, "底栏应有书签按钮");
  assert.match(bar, /📑/, "底栏应有摘录按钮");
});

test("[C2] 两个抽屉模板存在且互斥关闭其它面板", () => {
  assert.match(viewSrc, /\{#if showBookmarks\}/, "应有书签抽屉");
  assert.match(viewSrc, /\{#if showAnnots\}/, "应有摘录抽屉");
  assert.match(viewSrc, /class="reader-popover reader-bookmarks"/, "书签抽屉应复用 popover 样式");
  assert.match(viewSrc, /class="reader-popover reader-annots"/, "摘录抽屉应复用 popover 样式");
  assert.match(viewSrc, /function closeOtherPanels\(/, "应有统一的互斥关闭逻辑");
});

test("[C3] refreshAnnotsList 走 annStore 且过滤软删", () => {
  const b = bodyOf(viewSrc, "function refreshAnnotsList");
  assert.ok(b, "应取到 refreshAnnotsList");
  assert.match(b, /annStore\.getByBook\(bookId\)/, "应按书取批注");
  assert.match(b, /!it\.deletedAt/, "应过滤软删项");
  assert.match(b, /createdAt/, "应按创建时间排序");
});

test("[C4] exportAnnots 导出 Markdown 到剪贴板", () => {
  const b = bodyOf(viewSrc, "function exportAnnots");
  assert.ok(b, "应取到 exportAnnots");
  assert.match(b, /navigator\.clipboard\?\.writeText\(md\)/, "应写入剪贴板");
  assert.match(b, /annotsList\.length/, "空列表应提示而不是导出空内容");
});

test("[C5] toggleCurrentBookmark 用 foliate 的 lastLocation.cfi", () => {
  const b = bodyOf(viewSrc, "function currentCfi");
  assert.ok(b, "应取到 currentCfi");
  assert.match(b, /view\?\.lastLocation\?\.cfi/, "应读 view.lastLocation.cfi（relocate 时由 foliate 写入）");
  const t = bodyOf(viewSrc, "async function toggleCurrentBookmark");
  assert.ok(t, "应取到 toggleCurrentBookmark");
  assert.match(t, /store\.toggleBookmark\(/, "应调用 store.toggleBookmark");
  assert.match(t, /toast\(/, "应有成功/失败反馈");
});

/* ================= D. 协议入口 + 兜底 + 默认模板 ================= */

test("[D1] index.ts 注册 open-siyuan-url-plugin 且配对 off", () => {
  assert.match(indexSrc, /on\("open-siyuan-url-plugin"/, "应监听 open-siyuan-url-plugin");
  assert.match(indexSrc, /off\("open-siyuan-url-plugin"/, "应配对 off（随 Disposables 释放）");
  assert.match(indexSrc, /addEventBus\(/, "应经 Disposables 托管");
});

test("[D2] onOpenBookUrl 解析 data 后跳回原书", () => {
  const b = bodyOf(indexSrc, "private onOpenBookUrl");
  assert.ok(b, "应取到 onOpenBookUrl");
  assert.match(b, /URLSearchParams/, "应按查询串解析");
  assert.match(b, /params\.get\("data"\)/, "应读 data 参数");
  assert.match(b, /JSON\.parse\(raw\)/, "data 应为 JSON");
  assert.match(b, /params\.get\("bookId"\)/, "应兼容扁平 bookId 参数");
  assert.match(b, /if \(!bookId\) return;/, "非本书链接应直接忽略");
  assert.match(b, /jumpToReading\(bookId, cfi\)/, "应跳转回原书对应位置");
});

test("[D3] reader-tab init 对 custom.data 字符串做 JSON 兜底", () => {
  const b = bodyOf(tabSrc, "init: function");
  assert.ok(b, "应取到 init");
  assert.match(b, /typeof rawData === "string"/, "应识别字符串形态的 data");
  assert.match(b, /JSON\.parse\(rawData\)/, "应兜底解析一次");
  assert.match(b, /if \(!bookId\) return;/, "拿不到 bookId 时不开空白页签");
});

test("[D4] 默认笔记模板含 {{link}}（新用户开箱即得回跳链接）", () => {
  const m = settingsSrc.match(/linkFormat:\s*\n?\s*"([^"]*\\n[^"]*)"/);
  assert.ok(m, "应有 linkFormat 默认值");
  assert.match(m[1], /\{\{link\}\}/, "默认模板应含 {{link}}");
});
