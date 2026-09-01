/**
 * 书架 P2 · 阅读器「本书摘录」面板刷新
 * ----------------------------------------------------------------
 * 回归测试:2026-09-01 用户反馈"在阅读器中标注后本书摘录上没有显示出对应的文字"
 *
 * 根因:saveHighlight / onNoteSave / applyViewerColor / applyViewerStyle
 *      / applyEditStyle / applyEditColor / 打开「本书摘录」抽屉 / 开书
 *       这 7 个写路径都没调 refreshAnnotsList,导致 annotsList 永远是空
 *
 * 修复:每个写路径都补上 refreshAnnotsList();打开抽屉时也兜底刷一次
 *       开书时主动拉一次,确保历史摘录立即可见
 *       removeAnnotationById 内部已刷,removeAnnot 旧的双重调用去重
 *
 * 纯源码文本断言(不依赖 foliate / siyuan SDK)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewSrc = readFileSync(join(__dirname, "..", "src", "reader", "ReaderView.svelte"), "utf-8");

/* ================= 修复:核心 7 路径都得有 refreshAnnotsList ================= */

/**
 * 检查「函数 X 写完 annStore 后必须 refreshAnnotsList」契约
 * 实现:从函数体里找到下一个顶级 `}`(粗略),断言这段里至少有一次 refreshAnnotsList
 */
function assertRefreshInFn(fnName, label) {
  // 找函数定义开始
  const defRe = new RegExp(`(async\\s+)?function\\s+${fnName}\\s*\\(`);
  const m = viewSrc.match(defRe);
  assert.ok(m, `应有 ${fnName} 函数`);
  const start = m.index;
  // 找函数体:从 { 开始,到下一个匹配的 } 结束(简化:用 5000 字符窗口)
  const body = viewSrc.slice(start, start + 5000);
  assert.ok(/refreshAnnotsList\(\)/.test(body), `${label}: ${fnName} 写完 annStore 后必须调 refreshAnnotsList()`);
}

test("[核心] saveHighlight 创建标注后必须刷「本书摘录」", () => {
  assertRefreshInFn("saveHighlight", "标注创建");
});

test("[核心] removeAnnotationById 删除后必须刷「本书摘录」", () => {
  assertRefreshInFn("removeAnnotationById", "标注删除");
});

test("[核心] onNoteSave 编辑批注后必须刷「本书摘录」", () => {
  assertRefreshInFn("onNoteSave", "批注编辑");
});

test("[核心] applyViewerColor 改色后必须刷「本书摘录」", () => {
  assertRefreshInFn("applyViewerColor", "查看态改色");
});

test("[核心] applyViewerStyle 改样式后必须刷「本书摘录」", () => {
  assertRefreshInFn("applyViewerStyle", "查看态改样式");
});

test("[核心] applyEditStyle edit 态改样式后必须刷", () => {
  assertRefreshInFn("applyEditStyle", "edit 态改样式");
});

test("[核心] applyEditColor edit 态改色后必须刷", () => {
  assertRefreshInFn("applyEditColor", "edit 态改色");
});

/* ================= 修复:打开抽屉时兜底刷新 ================= */

test("[抽屉] toggleDrawer 打开 annots 时必须 refreshAnnotsList", () => {
  // 找 toggleDrawer 函数
  const m = viewSrc.match(/const toggleDrawer\s*=\s*async\s*\(\s*kind\s*:\s*DrawerKind\s*\)\s*=>\s*\{/);
  assert.ok(m, "应有 toggleDrawer 函数");
  const body = viewSrc.slice(m.index, m.index + 2000);
  assert.ok(
    /activeDrawer\s*===\s*"annots"[\s\S]{0,200}refreshAnnotsList\(\)/.test(body),
    "打开 annots 抽屉时应 refreshAnnotsList()"
  );
  // 不应再调死引用 reloadAnnots
  assert.ok(
    !/activeDrawer\s*===\s*"annots"[\s\S]{0,200}reloadAnnots\(/.test(body),
    "不能再调死引用 reloadAnnots()"
  );
});

test("[抽屉] toggleDrawer 打开 bookmarks 时必须 refreshBookmarks", () => {
  const m = viewSrc.match(/const toggleDrawer\s*=\s*async\s*\(\s*kind\s*:\s*DrawerKind\s*\)\s*=>\s*\{/);
  const body = viewSrc.slice(m.index, m.index + 2000);
  assert.ok(
    /activeDrawer\s*===\s*"bookmarks"[\s\S]{0,200}refreshBookmarks\(\)/.test(body),
    "打开 bookmarks 抽屉时应 refreshBookmarks()"
  );
  assert.ok(
    !/activeDrawer\s*===\s*"bookmarks"[\s\S]{0,200}reloadBookmarks\(/.test(body),
    "不能再调死引用 reloadBookmarks()"
  );
});

/* ================= 修复:开书时主动拉一次 ================= */

test("[开书] openBook 完成时主动拉一次 annots + bookmarks", () => {
  // openBook 函数体 10000 字符窗口内,最后应同时调 refreshAnnotsList + refreshBookmarks
  const m = viewSrc.match(/async function openBook\s*\(\s*\)\s*\{/);
  assert.ok(m, "应有 openBook 函数");
  const body = viewSrc.slice(m.index, m.index + 10000);
  // 开书路径应在 view.open/init 完成后调一次
  assert.ok(
    /refreshAnnotsList\(\)/.test(body) && /refreshBookmarks\(\)/.test(body),
    "openBook 应主动拉一次 annots + bookmarks,确保开书时历史摘录立即可见"
  );
});

/* ================= 修复:removeAnnot 去重(避免双重刷新) ================= */

test("[去重] removeAnnot 不应再单独调 refreshAnnotsList(已在 removeAnnotationById 内)", () => {
  // removeAnnot 现在是 await removeAnnotationById + toast,中间不应再调 refreshAnnotsList
  const m = viewSrc.match(/async function removeAnnot\s*\([\s\S]*?\n\s\s\}/);
  assert.ok(m, "应有 removeAnnot 函数");
  const body = m[0];
  // 应有 await removeAnnotationById
  assert.ok(/removeAnnotationById/.test(body), "removeAnnot 应调 removeAnnotationById");
  // 不应再调 refreshAnnotsList(已在 removeAnnotationById 里)
  assert.ok(!/refreshAnnotsList\(\)/.test(body), "removeAnnot 不应再单独调 refreshAnnotsList(去重)");
});

/* ================= 反向:确认函数本身存在 ================= */

test("[实现] refreshAnnotsList 函数存在且走 annStore.getByBook", () => {
  assert.ok(
    /function refreshAnnotsList\s*\(\s*\)\s*\{[\s\S]*?annStore\.getByBook\(bookId\)/.test(viewSrc),
    "refreshAnnotsList 应从 annStore 拉数据"
  );
  // 应过滤已软删
  assert.ok(/!it\.deletedAt/.test(viewSrc), "应过滤 deletedAt 标记");
  // 按 createdAt 倒序
  assert.ok(/createdAt/.test(viewSrc) && /sort/.test(viewSrc), "应按 createdAt 排序");
  // 2026-09-01：放宽 cfi 过滤(非 EPUB 格式 foliate-js 不生成 cfi,只靠 selectedText 也能展示)
  const fnBody = viewSrc.match(/function refreshAnnotsList\s*\(\s*\)\s*\{([\s\S]*?)\n\s\s\}/);
  assert.ok(fnBody, "应能抽出 refreshAnnotsList 函数体");
  const filterLine = (fnBody[1].match(/\.filter\([^)]*\)/) || [""])[0];
  assert.ok(!/it\.cfi/.test(filterLine), "filter 不应再要求 it.cfi 真值(放宽非 EPUB 支持)");
});

/* ================= 2026-09-01 新增:订阅机制 ================= */

test("[订阅] ReaderView 应订阅 annStore 数据变更", () => {
  // 应有 ensureAnnStoreSubscription 封装
  assert.ok(
    /function ensureAnnStoreSubscription\s*\(\s*\)\s*\{/.test(viewSrc),
    "应有 ensureAnnStoreSubscription 函数(订阅入口)"
  );
  // 应调 store.subscribe
  assert.ok(
    /store\.subscribe\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?refreshAnnotsList\(\)/.test(viewSrc),
    "订阅回调内必须调 refreshAnnotsList"
  );
  // onMount 应触发订阅
  assert.ok(
    /onMount[\s\S]*?ensureAnnStoreSubscription\(\)/.test(viewSrc),
    "onMount 内应触发订阅"
  );
});

test("[订阅] onDestroy 应注销 annStore 订阅", () => {
  assert.ok(
    /onDestroy[\s\S]*?unsubAnnStore\(\)/.test(viewSrc),
    "onDestroy 内应注销 annStore 订阅(防组件销毁后仍触发)"
  );
});

test("[订阅] bookId 变化应触发 refreshAnnotsList(响应式)", () => {
  // 找带 bookId 的 $: 块
  const m = viewSrc.match(/\$\:[\s\S]{0,500}bookId[\s\S]{0,500}refreshAnnotsList\(\)/);
  assert.ok(m, "应有 $: 响应式块监听 bookId 变化重拉摘录");
});
