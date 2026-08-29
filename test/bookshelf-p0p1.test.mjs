/**
 * 书架 P0/P1 · 搜索 / 排序 / 视图 / 状态 / 分组 / 标签 / 评分 / 批量 / 封面替换
 * ----------------------------------------------------------------
 * 纯源码文本断言（不依赖 foliate / siyuan SDK），覆盖：
 *  数据层 bookshelf-store.ts
 *   - BookStatus / BookGroup / BookFilter / BookSortKey / SortDir 类型导出
 *   - BookMeta 新增 status/rating/favorite/tags/series/groupId（全 optional）
 *   - 分组用独立索引文件（书架索引保持纯数组，向后兼容）
 *   - query() 搜索 + 筛选 + 排序
 *   - 分组 CRUD / 标签 / 批量 / replaceCover
 *   - saveProgress 阅读状态自动流转，且不覆盖用户手动 finished
 *  UI 层 BookshelfView.svelte
 *   - 搜索框 / 排序下拉 / 排序方向 / 网格·列表切换 / 侧栏 / 批量条
 *   - 编辑弹窗扩展字段（丛书/状态/评分/收藏/标签/分组/封面）
 *   - 【关键回归】封面 input 必须排在主导入 input 之后
 *     （pdf-bookshelf-accept.test.mjs 用「首个 type="file"」定位主导入 input，
 *      若封面 input 提前就会把那条断言带崩）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const storeSrc = readFileSync(join(__dirname, "..", "src", "reader", "bookshelf-store.ts"), "utf-8");
const viewSrc = readFileSync(join(__dirname, "..", "src", "reader", "BookshelfView.svelte"), "utf-8");

/* ================= 数据层：类型 ================= */

test("[类型] 导出 BookStatus 三态", () => {
  const m = storeSrc.match(/export type BookStatus\s*=\s*([^;]+);/);
  assert.ok(m, "应导出 BookStatus");
  for (const s of ["unread", "reading", "finished"]) {
    assert.ok(m[1].includes(`"${s}"`), `BookStatus 应含 ${s}`);
  }
});

test("[类型] 导出 BookGroup / BookFilter / BookSortKey / SortDir", () => {
  assert.ok(/export interface BookGroup\s*\{/.test(storeSrc), "应导出 BookGroup");
  assert.ok(/export interface BookFilter\s*\{/.test(storeSrc), "应导出 BookFilter");
  assert.ok(/export type BookSortKey\s*=/.test(storeSrc), "应导出 BookSortKey");
  assert.ok(/export type SortDir\s*=/.test(storeSrc), "应导出 SortDir");
});

test("[类型] BookSortKey 覆盖 8 个排序维度", () => {
  const m = storeSrc.match(/export type BookSortKey\s*=([\s\S]*?);/);
  assert.ok(m, "应能抽出 BookSortKey");
  for (const k of ["lastRead", "addedAt", "title", "author", "progress", "readingTime", "rating", "size"]) {
    assert.ok(m[1].includes(`"${k}"`), `BookSortKey 应含 ${k}`);
  }
});

test("[BookMeta] 新增 6 个字段且全为 optional（老数据兼容）", () => {
  const m = storeSrc.match(/export interface BookMeta\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "应能抽出 BookMeta");
  const body = m[1];
  for (const f of ["status", "rating", "favorite", "tags", "series", "groupId"]) {
    assert.ok(new RegExp(`\\n\\s*${f}\\?:`).test(body), `BookMeta.${f} 应存在且为 optional（${f}?:）`);
  }
  // 回归：原有字段没被删
  for (const f of ["id", "title", "format", "path", "size", "addedAt"]) {
    assert.ok(new RegExp(`\\n\\s*${f}:`).test(body), `BookMeta.${f} 不应丢失`);
  }
});

/* ================= 数据层：持久化兼容 ================= */

test("[兼容] 分组走独立索引文件，书架索引仍是纯数组", () => {
  assert.ok(/const GROUPS_KEY\s*=\s*"[^"]+"/.test(storeSrc), "应有独立的 GROUPS_KEY");
  const idx = storeSrc.match(/const INDEX_KEY\s*=\s*"([^"]+)"/);
  const grp = storeSrc.match(/const GROUPS_KEY\s*=\s*"([^"]+)"/);
  assert.ok(idx && grp, "两个 key 都应存在");
  assert.notEqual(idx[1], grp[1], "两个索引文件名不能相同");
  // 书架索引读取仍用 Array.isArray 判定（说明格式未变）
  assert.ok(/loadData\(INDEX_KEY\)/.test(storeSrc), "应仍从 INDEX_KEY 读书架");
  assert.ok(/Array\.isArray\(data\)\s*\)\s*this\.books = data/.test(storeSrc), "书架索引应仍按数组解析");
  assert.ok(/loadData\(GROUPS_KEY\)/.test(storeSrc), "应从 GROUPS_KEY 读分组");
  assert.ok(/saveData\(GROUPS_KEY/.test(storeSrc), "应持久化分组到 GROUPS_KEY");
});

/* ================= 数据层：query ================= */

test("[query] 方法存在且支持 filter + sortKey + dir 三参数", () => {
  assert.ok(/\bquery\(\s*\n?\s*filter/.test(storeSrc) || /\bquery\(filter/.test(storeSrc), "应有 query 方法");
  const m = storeSrc.match(/query\(([\s\S]*?)\):\s*BookMeta\[\]/);
  assert.ok(m, "query 返回类型应为 BookMeta[]");
  const sig = m[1];
  assert.ok(/filter\s*:\s*BookFilter/.test(sig), "第 1 参为 BookFilter");
  assert.ok(/sortKey\s*:\s*BookSortKey/.test(sig), "第 2 参为 BookSortKey");
  assert.ok(/dir\s*:\s*SortDir/.test(sig), "第 3 参为 SortDir");
});

test("[query] 关键词覆盖书名/作者/丛书/标签四个字段", () => {
  const m = storeSrc.match(/const hay = \[([^\]]+)\]/);
  assert.ok(m, "应有 keyword 匹配用的 hay 拼接");
  const hay = m[1];
  assert.ok(/b\.title/.test(hay), "关键词应匹配书名");
  assert.ok(/b\.author/.test(hay), "关键词应匹配作者");
  assert.ok(/b\.series/.test(hay), "关键词应匹配丛书");
  assert.ok(/b\.tags/.test(hay), "关键词应匹配标签");
});

test("[query] 筛选支持状态/格式/标签/分组/收藏/评分", () => {
  const m = storeSrc.match(/query\([\s\S]*?\):\s*BookMeta\[\]\s*\{([\s\S]*?)\n  \}/);
  assert.ok(m, "应能抽出 query 函数体");
  const body = m[1];
  assert.ok(/filter\.status/.test(body), "应按 status 筛选");
  assert.ok(/filter\.format/.test(body), "应按 format 筛选");
  assert.ok(/filter\.tag/.test(body), "应按 tag 筛选");
  assert.ok(/filter\.groupId/.test(body), "应按 groupId 筛选");
  assert.ok(/"ungrouped"/.test(body), "应支持「未分组」视图");
  assert.ok(/filter\.favoriteOnly/.test(body), "应支持仅看收藏");
  assert.ok(/filter\.minRating/.test(body), "应支持最低评分");
});

test("[query] 缺省状态归入 unread（老数据无 status 字段）", () => {
  assert.ok(/b\.status\s*\?\?\s*"unread"/.test(storeSrc), "读 status 应用 ?? unread 兜底");
});

test("[query] 中文排序用 localeCompare zh，且有次级键防抖动", () => {
  assert.ok(/localeCompare\([^)]*"zh-Hans-CN"\)/.test(storeSrc), "中文排序应指定 zh-Hans-CN");
  const m = storeSrc.match(/out\.sort\(\(a, b\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(m, "应能抽出排序回调");
  assert.ok(/a\.title\.localeCompare/.test(m[1]), "数值相等时应用书名做次级键");
});

/* ================= 数据层：分组 / 标签 / 批量 / 封面 ================= */

test("[分组] CRUD 四个 API 齐备，删组不删书", () => {
  assert.ok(/get groups\(\)/.test(storeSrc), "应有 groups getter");
  assert.ok(/async createGroup\(/.test(storeSrc), "应有 createGroup");
  assert.ok(/async renameGroup\(/.test(storeSrc), "应有 renameGroup");
  assert.ok(/async deleteGroup\(/.test(storeSrc), "应有 deleteGroup");
  const m = storeSrc.match(/async deleteGroup\([\s\S]*?\n  \}/);
  assert.ok(m, "应能抽出 deleteGroup");
  assert.ok(/b\.groupId = undefined/.test(m[0]), "删组后组内书应回到未分组，而不是被删除");
  assert.ok(!/removeFile/.test(m[0]), "deleteGroup 不应删除任何文件");
});

test("[标签] 单本与批量标签 API 齐备，且做去重", () => {
  assert.ok(/async addTag\(/.test(storeSrc), "应有 addTag");
  assert.ok(/async removeTag\(/.test(storeSrc), "应有 removeTag");
  assert.ok(/async batchAddTag\(/.test(storeSrc), "应有 batchAddTag");
  assert.ok(/async batchRemoveTag\(/.test(storeSrc), "应有 batchRemoveTag");
  assert.ok(/new Set\(\[\.\.\.\(b\.tags \?\? \[\]\), t\]\)/.test(storeSrc), "批量加标签应用 Set 去重");
});

test("[分面] 侧栏计数 API 齐备", () => {
  for (const fn of ["tagCounts", "formatCounts", "statusCounts", "favoriteCount", "ungroupedCount", "groupCount"]) {
    assert.ok(new RegExp(`\\b${fn}\\(`).test(storeSrc), `应有 ${fn}`);
  }
});

test("[批量] 四个批量 API 齐备，批量删除复用 removeBook", () => {
  for (const fn of ["batchSetStatus", "batchAddTag", "batchSetGroup", "batchRemove"]) {
    assert.ok(new RegExp(`async ${fn}\\(`).test(storeSrc), `应有 ${fn}`);
  }
  const m = storeSrc.match(/async batchRemove\([\s\S]*?\n  \}/);
  assert.ok(m, "应能抽出 batchRemove");
  assert.ok(/this\.removeBook\(id, opts\)/.test(m[0]), "批量删除应复用 removeBook，保证源文件/封面清理一致");
});

test("[封面] replaceCover 先写新图再删旧图，且文件名带时间戳破缓存", () => {
  const m = storeSrc.match(/async replaceCover\([\s\S]*?\n  \}/);
  assert.ok(m, "应有 replaceCover");
  const body = m[0];
  assert.ok(/Date\.now\(\)\.toString\(36\)/.test(body), "新封面名应带时间戳，避免 webview 缓存旧图");
  const okIdx = body.indexOf("if (!ok) return null");
  const rmIdx = body.indexOf("removeFile(old)");
  assert.ok(okIdx > 0 && rmIdx > okIdx, "必须写入成功后才删旧封面，避免中途失败丢图");
});

/* ================= 数据层：状态自动流转 ================= */

test("[状态流转] saveProgress 读完自动置 finished，且不覆盖手动 finished", () => {
  const m = storeSrc.match(/async saveProgress\([\s\S]*?\n  \}/);
  assert.ok(m, "应能抽出 saveProgress");
  const body = m[0];
  assert.ok(/>=\s*0\.995/.test(body), "应有读完阈值判定");
  assert.ok(/meta\.status = "finished"/.test(body), "达阈值应置 finished");
  assert.ok(
    /!meta\.status \|\| meta\.status === "unread"/.test(body),
    "只在 unread/未设置时才自动置 reading，避免覆盖用户手动标记的 finished"
  );
});

/* ================= UI 层：工具栏 ================= */

test("[UI] 搜索框绑定 keyword，占位提示覆盖四个可搜字段", () => {
  assert.ok(/class="shelf-search-input"/.test(viewSrc), "应有搜索输入框");
  assert.ok(/bind:value=\{keyword\}/.test(viewSrc), "搜索框应双向绑定 keyword");
  const m = viewSrc.match(/placeholder="([^"]*搜索[^"]*)"/);
  assert.ok(m, "搜索框应有中文占位提示");
  for (const f of ["书名", "作者", "标签", "丛书"]) {
    assert.ok(m[1].includes(f), `占位提示应含 ${f}`);
  }
});

test("[UI] 排序下拉 + 升降序切换按钮存在", () => {
  assert.ok(/SORT_OPTIONS/.test(viewSrc), "应有 SORT_OPTIONS 排序项定义");
  assert.ok(/on:change=\{onSortKeyChange\}/.test(viewSrc), "排序下拉应接 onSortKeyChange");
  assert.ok(/on:click=\{toggleSortDir\}/.test(viewSrc), "应有升降序切换");
});

test("[UI] 网格 / 列表双视图切换", () => {
  assert.ok(/setViewMode\("grid"\)/.test(viewSrc), "应能切到网格");
  assert.ok(/setViewMode\("list"\)/.test(viewSrc), "应能切到列表");
  assert.ok(/\{#if viewMode === "grid"\}/.test(viewSrc), "模板应按 viewMode 分流");
  assert.ok(/class="shelf-list"/.test(viewSrc), "应有列表视图容器");
});

test("[UI] 列表渲染 visible（筛选排序后结果），不是原始 books", () => {
  const each = viewSrc.match(/\{#each visible as book \(book\.id\)\}/g) || [];
  assert.ok(each.length >= 2, "网格与列表都应遍历 visible");
  assert.ok(!/\{#each books as book \(book\.id\)\}/.test(viewSrc), "不应再直接遍历未筛选的 books");
});

test("[UI] UI 偏好持久化到 localStorage（与书架数据解耦）", () => {
  assert.ok(/localStorage\.getItem\(UI_KEY\)/.test(viewSrc), "应读取 UI 偏好");
  assert.ok(/localStorage\.setItem\(UI_KEY/.test(viewSrc), "应写入 UI 偏好");
  const m = viewSrc.match(/function loadUiPrefs\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(m, "应有 loadUiPrefs");
  assert.ok(/catch/.test(m[1]), "坏数据必须兜底，不能让书架打不开");
});

/* ================= UI 层：侧栏 ================= */

test("[UI] 侧栏含全部/收藏/未分组 + 状态 + 分组 + 标签 + 格式", () => {
  assert.ok(/class="shelf-sidebar"/.test(viewSrc), "应有侧栏");
  assert.ok(/pickScope\("all"\)/.test(viewSrc), "应有「全部」");
  assert.ok(/pickScope\("favorite"\)/.test(viewSrc), "应有「收藏」");
  assert.ok(/pickScope\("ungrouped"\)/.test(viewSrc), "应有「未分组」");
  assert.ok(/\{#each STATUS_ORDER as s\}/.test(viewSrc), "应有阅读状态智能分组");
  assert.ok(/\{#each facets\.groups as g \(g\.id\)\}/.test(viewSrc), "应有用户分组列表");
  assert.ok(/\{#each facets\.tags as t \(t\.tag\)\}/.test(viewSrc), "应有标签智能分组");
  assert.ok(/\{#each facets\.formats as f \(f\.format\)\}/.test(viewSrc), "应有格式智能分组");
});

test("[UI] 侧栏计数走 facets（模板里直调 store.xxx 不被 Svelte 追踪会显示过期数字）", () => {
  const m = viewSrc.match(/function computeFacets\(_b: BookMeta\[\]\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(m, "应有 computeFacets");
  assert.ok(/store\.groupCount\(g\.id\)/.test(m[1]), "分组计数应在 computeFacets 内一次算好");
  assert.ok(/\$: facets = computeFacets\(books\)/.test(viewSrc), "facets 应依赖 books 响应式重算");
  assert.ok(!/\{store\.groupCount\(/.test(viewSrc), "模板里不应直接调 store.groupCount");
});

test("[UI] 拖书入组：用私有 dataTransfer 类型，不与文件拖拽导入冲突", () => {
  const m = viewSrc.match(/const DRAG_TYPE = "([^"]+)"/);
  assert.ok(m, "应定义内部拖拽类型");
  assert.ok(!/^Files$/.test(m[1]), "内部拖拽类型不能是 Files，否则会误触发导入 dropzone");
  assert.ok(/onGroupDrop/.test(viewSrc), "分组应可接收拖放");
  // 文件导入 dropzone 仍按 Files 判定
  assert.ok(/dataTransfer\?\.types\?\.includes\("Files"\)/.test(viewSrc), "文件导入仍按 Files 判定");
});

/* ================= UI 层：批量 ================= */

test("[UI] 批量条含全选/清空/状态/分组/标签/删除", () => {
  assert.ok(/class="shelf-batch-bar"/.test(viewSrc), "应有批量操作条");
  assert.ok(/selectAllVisible/.test(viewSrc), "应能全选当前结果");
  assert.ok(/clearSelection/.test(viewSrc), "应能清空选择");
  assert.ok(/on:change=\{batchStatus\}/.test(viewSrc), "应能批量设状态");
  assert.ok(/on:change=\{batchGroup\}/.test(viewSrc), "应能批量设分组");
  assert.ok(/commitBatchTag/.test(viewSrc), "应能批量加标签");
  assert.ok(/confirmBatchRemove/.test(viewSrc), "应能批量删除");
});

test("[UI] 批量删除有二次确认 + 源文件保留选项（默认不删源文件）", () => {
  assert.ok(/\{#if batchRemoveOpen\}/.test(viewSrc), "批量删除应走确认弹窗");
  const m = viewSrc.match(/\{#if batchRemoveOpen\}([\s\S]*?)\{\/if\}/);
  assert.ok(m, "应能抽出批量删除弹窗");
  assert.ok(/bind:checked=\{removeWithFile\}/.test(m[1]), "应有「同时删除源文件」勾选");
  assert.ok(/removeWithFile = false;\s*\n\s*batchRemoveOpen = true;/.test(viewSrc), "打开弹窗时应重置为不删源文件");
});

/* ================= UI 层：编辑弹窗 ================= */

test("[UI] 编辑弹窗扩展到丛书/状态/评分/收藏/标签/分组", () => {
  assert.ok(/bind:value=\{editSeries\}/.test(viewSrc), "应可编辑丛书");
  assert.ok(/editStatus === s/.test(viewSrc), "应可选阅读状态");
  assert.ok(/editRating >= n/.test(viewSrc), "应可打星评分");
  assert.ok(/bind:checked=\{editFavorite\}/.test(viewSrc), "应可切收藏");
  assert.ok(/bind:value=\{editGroupId\}/.test(viewSrc), "应可选分组");
  assert.ok(/onEditTagKey/.test(viewSrc), "应可用回车/逗号加标签");
  assert.ok(/dropEditTag/.test(viewSrc), "应可移除标签");
});

test("[UI] saveEdit 把 7 个扩展字段都提交给 updateMeta", () => {
  const m = viewSrc.match(/async function saveEdit\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(m, "应有 saveEdit");
  for (const f of ["title", "author", "series", "status", "rating", "favorite", "tags", "groupId"]) {
    assert.ok(new RegExp(`${f}:`).test(m[1]), `saveEdit 应提交 ${f}`);
  }
});

test("[关键回归] 封面 input 必须排在主导入 input 之后", () => {
  const importIdx = viewSrc.indexOf("accept={ACCEPT}");
  const coverIdx = viewSrc.indexOf('accept="image/*"');
  assert.ok(importIdx > 0, "主导入 input 应存在");
  assert.ok(coverIdx > 0, "封面 input 应存在");
  assert.ok(
    coverIdx > importIdx,
    "封面 input 若排在主导入 input 之前，pdf-bookshelf-accept 的「首个 type=file 必须绑 ACCEPT」断言会被带崩"
  );
});

test("[封面] 路径变化即重取，并回收旧 objectURL 防泄漏", () => {
  assert.ok(/coverPaths\[b\.id\] === b\.cover/.test(viewSrc), "应按 cover 路径判定是否需要重取");
  assert.ok(/URL\.revokeObjectURL/.test(viewSrc), "旧 objectURL 应被回收");
  const m = viewSrc.match(/onDestroy\(\(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(m, "应有 onDestroy");
  assert.ok(/revokeObjectURL/.test(m[1]), "销毁时应回收全部封面 URL");
  assert.ok(/unsubStore\?\.\(\)/.test(m[1]), "销毁时应退订 store，避免泄漏");
});

test("[同步] 订阅书架 store，阅读进度变化后书架自动刷新", () => {
  assert.ok(/unsubStore = store\.subscribe\(/.test(viewSrc), "应订阅 store");
  assert.ok(/onDestroy/.test(viewSrc), "应有 onDestroy 配对清理");
});
