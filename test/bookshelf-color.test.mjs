/**
 * 书架 P2 · macOS 风格 7 色 / 批量评分收藏 / 手动排序 / 续读
 * ----------------------------------------------------------------
 * 纯源码文本断言（不依赖 foliate / siyuan SDK），覆盖：
 *  数据层 bookshelf-store.ts
 *   - BookColor 类型 + BOOK_COLORS 字典 + isValidBookColor 守卫
 *   - BookGroup.color / BookMeta.color / BookMeta.order 扩字段
 *   - BookFilter.color / BookSortKey + "color"
 *   - 6 个新 API:setColor / setOrder / setGroupColor /
 *     batchSetColor / batchSetRating / batchSetFavorite
 *   - query() 颜色筛选 + 颜色排序稳定 + order 次级键优先
 *   - colorCounts() / seriesCounts() / getContinueReadId() facets
 *   - updateMeta Pick 含 color / order
 *  UI 层 BookshelfView.svelte
 *   - 编辑弹窗含「颜色」区块(7 色 swatch + 移除)
 *   - 管理分组弹窗含色点 + 颜色 popover
 *   - 侧边栏分组前可显示色点
 *   - 网格卡片 / 列表行有色点
 *   - 顶栏 ⏵ 续读按钮
 *   - 双击侧边栏组名进入编辑 + hover ✎
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

/* ================= 字典完整性 ================= */

test("[字典] BOOK_COLORS 含 7 色 token", () => {
  const m = storeSrc.match(/export const BOOK_COLORS[\s\S]*?\] as const;/);
  assert.ok(m, "应导出 BOOK_COLORS 常量");
  for (const c of ["red", "orange", "yellow", "green", "blue", "purple", "gray"]) {
    assert.ok(m[0].includes(`"${c}"`), `BOOK_COLORS 应含 ${c}`);
  }
  // 7 个色,每色 3 字段(token/label/hex),用 token 字符串匹配避免误中类型定义
  const tokens = Array.from(m[0].matchAll(/\btoken:\s*"(\w+)"/g)).map((x) => x[1]);
  assert.equal(tokens.length, 7, `应有 7 个 token 字段,实际 ${tokens.length}`);
  const hexes = Array.from(m[0].matchAll(/hex:\s*"([#0-9a-fA-F]+)"/g));
  assert.equal(hexes.length, 7, "应有 7 个 hex 字段");
});

test("[字典] 每色 hex 形如 #rrggbb", () => {
  const m = storeSrc.match(/export const BOOK_COLORS[\s\S]*?\] as const;/);
  const hexes = Array.from(m[0].matchAll(/hex:\s*"([#0-9a-fA-F]+)"/g)).map((x) => x[1]);
  assert.equal(hexes.length, 7);
  for (const h of hexes) {
    assert.match(h, /^#[0-9a-fA-F]{6}$/, `hex 应为 #rrggbb 格式: ${h}`);
  }
});

test("[字典] 每色有中文 label", () => {
  const m = storeSrc.match(/export const BOOK_COLORS[\s\S]*?\] as const;/);
  const labels = Array.from(m[0].matchAll(/label:\s*"([^"]+)"/g)).map((x) => x[1]);
  for (const l of labels) {
    assert.ok(/[一-龥]/.test(l), `label 应为中文: ${l}`);
  }
});

test("[守卫] isValidBookColor 判定合法 token", () => {
  assert.ok(/export function isValidBookColor/.test(storeSrc), "应导出 isValidBookColor 守卫");
  const m = storeSrc.match(/export function isValidBookColor[\s\S]*?\n\}/);
  assert.ok(m, "isValidBookColor 应有函数体");
  // 应走 BOOK_COLOR_INDEX 或 BOOK_COLORS 查找
  assert.ok(
    /BOOK_COLOR_INDEX|BOOK_COLORS/.test(m[0]),
    "isValidBookColor 应引用颜色字典"
  );
});

/* ================= 数据层类型扩展 ================= */

test("[类型] BookColor 含 7 个 token", () => {
  const m = storeSrc.match(/export type BookColor\s*=\s*([^;]+);/);
  assert.ok(m, "应导出 BookColor");
  for (const c of ["red", "orange", "yellow", "green", "blue", "purple", "gray"]) {
    assert.ok(m[1].includes(`"${c}"`), `BookColor 应含 ${c}`);
  }
});

test("[类型] BookGroup 加 color optional", () => {
  const m = storeSrc.match(/export interface BookGroup\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "应能抽出 BookGroup");
  assert.ok(/\n\s*color\?:\s*BookColor/.test(m[1]), "BookGroup.color 应为 optional BookColor");
});

test("[类型] BookMeta 加 color / order optional", () => {
  const m = storeSrc.match(/export interface BookMeta\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "应能抽出 BookMeta");
  assert.ok(/\n\s*color\?:\s*BookColor/.test(m[1]), "BookMeta.color 应为 optional BookColor");
  assert.ok(/\n\s*order\?:\s*number/.test(m[1]), "BookMeta.order 应为 optional number");
});

test("[类型] BookFilter 加 color optional", () => {
  const m = storeSrc.match(/export interface BookFilter\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "应能抽出 BookFilter");
  assert.ok(/\n\s*color\?:\s*BookColor/.test(m[1]), "BookFilter.color 应为 optional BookColor");
});

test("[类型] BookSortKey 加 color 排序键", () => {
  const m = storeSrc.match(/export type BookSortKey\s*=([\s\S]*?);/);
  assert.ok(m, "应能抽出 BookSortKey");
  assert.ok(m[1].includes('"color"'), "BookSortKey 应含 color");
});

/* ================= updateMeta Pick 扩展 ================= */

test("[updateMeta] Pick 包含 color / order", () => {
  const m = storeSrc.match(/updateMeta\([\s\S]*?Pick<[\s\S]*?>/);
  assert.ok(m, "应能抽出 updateMeta 的 Pick");
  const block = m[0];
  assert.ok(/"color"/.test(block) || /color/.test(block), "Pick 应含 color");
  assert.ok(/"order"/.test(block) || /order/.test(block), "Pick 应含 order");
});

test("[updateMeta] 颜色赋值时走 isValidBookColor 守卫", () => {
  const m = storeSrc.match(/if \(patch\.color !== undefined\)\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(m, "应有 patch.color 处理块");
  assert.ok(/isValidBookColor/.test(m[0]), "颜色赋值应走 isValidBookColor 校验");
});

/* ================= 单本新 API ================= */

test("[API] setColor 调 updateMeta", () => {
  assert.ok(
    /async setColor\(id:\s*string,\s*color\?:\s*BookColor\):\s*Promise<boolean>\s*\{[\s\S]*?return this\.updateMeta\(id,\s*\{\s*color\s*\}\)/.test(
      storeSrc
    ),
    "setColor 应调 updateMeta(id, { color })"
  );
});

test("[API] setOrder 调 updateMeta", () => {
  assert.ok(
    /async setOrder\(id:\s*string,\s*order:\s*number\):\s*Promise<boolean>\s*\{[\s\S]*?return this\.updateMeta\(id,\s*\{\s*order\s*\}\)/.test(
      storeSrc
    ),
    "setOrder 应调 updateMeta(id, { order })"
  );
});

test("[API] setGroupColor 修改 _groups + 持久化", () => {
  const m = storeSrc.match(/async setGroupColor\([\s\S]*?\n\s*\}\s*\n\s*\/\*/);
  assert.ok(m, "应有 setGroupColor 函数");
  const body = m[0];
  assert.ok(/_groups\.find/.test(body), "setGroupColor 应查 _groups");
  assert.ok(/saveGroups/.test(body), "setGroupColor 应调 saveGroups 持久化");
  assert.ok(/isValidBookColor/.test(body), "setGroupColor 应走 token 校验");
});

/* ================= 批量新 API ================= */

test("[API] batchSetColor 跳过未变更的书 + 计数", () => {
  const idx = storeSrc.indexOf("async batchSetColor(");
  assert.ok(idx > 0, "应有 batchSetColor 函数");
  const body = storeSrc.slice(idx, idx + 700);
  assert.ok(/ids\.includes/.test(body), "batchSetColor 应按 ids 过滤");
  assert.ok(/isValidBookColor/.test(body), "batchSetColor 应走 token 校验");
  assert.ok(/return n/.test(body), "batchSetColor 应返回数量");
});

test("[API] batchSetRating 边界裁剪 + 0 = 清除", () => {
  const idx = storeSrc.indexOf("async batchSetRating(");
  assert.ok(idx > 0, "应有 batchSetRating 函数");
  const body = storeSrc.slice(idx, idx + 700);
  assert.ok(/Math\.max\(0,\s*Math\.min\(5/.test(body), "batchSetRating 应 0-5 裁剪");
  assert.ok(/r\s*>\s*0\s*\?\s*r\s*:\s*undefined/.test(body), "0 应转为 undefined");
  assert.ok(/return n/.test(body), "应返回数量");
});

test("[API] batchSetFavorite 布尔归一 + 计数", () => {
  const idx = storeSrc.indexOf("async batchSetFavorite(");
  assert.ok(idx > 0, "应有 batchSetFavorite 函数");
  const body = storeSrc.slice(idx, idx + 700);
  assert.ok(/!!favorite|Boolean\(favorite\)/.test(body), "batchSetFavorite 应布尔归一");
  assert.ok(/return n/.test(body), "应返回数量");
});

/* ================= query 扩展 ================= */

test("[query] 颜色筛选(单色精确匹配)", () => {
  const m = storeSrc.match(/query\(\s*filter[\s\S]*?return out;/);
  assert.ok(m, "应能抽出 query() 函数");
  assert.ok(
    /filter\.color\s*&&\s*b\.color\s*!==\s*filter\.color/.test(m[0]),
    "query 应在 filter.color 时按颜色过滤"
  );
});

test("[query] 颜色排序按 BOOK_COLOR_INDEX 索引", () => {
  const m = storeSrc.match(/query\(\s*filter[\s\S]*?return out;/);
  assert.ok(m, "应能抽出 query() 函数");
  assert.ok(/sortKey\s*===\s*"color"/.test(m[0]), "query 应识别 color 排序键");
  assert.ok(/BOOK_COLOR_INDEX/.test(m[0]), "query 颜色排序应走 BOOK_COLOR_INDEX");
  // 无色书排在最后(索引 999)
  assert.ok(/999/.test(m[0]), "无色书应排在最后");
});

test("[query] order 字段作为次级键", () => {
  const m = storeSrc.match(/query\(\s*filter[\s\S]*?return out;/);
  assert.ok(m, "应能抽出 query() 函数");
  assert.ok(/typeof a\.order/.test(m[0]) || /a\.order/.test(m[0]), "query 应支持 order 次级排序");
  assert.ok(/a\.order\s*-\s*b\.order/.test(m[0]), "order 数字小应靠前");
});

/* ================= facets 计数 ================= */

test("[facets] colorCounts 按 BOOK_COLORS 顺序输出", () => {
  const idx = storeSrc.indexOf("colorCounts()");
  assert.ok(idx > 0, "应有 colorCounts 函数");
  // 取到下一个空行 + 4 空格缩进的方法边界(class 顶层)
  const body = storeSrc.slice(idx, idx + 600);
  assert.ok(/BOOK_COLORS/.test(body), "colorCounts 应按 BOOK_COLORS 顺序");
  assert.ok(/map\.has\(c\.token\)/.test(body) || /map\.has/.test(body), "colorCounts 应过滤未用色");
});

test("[facets] seriesCounts 至少 2 本才显示", () => {
  const idx = storeSrc.indexOf("seriesCounts()");
  assert.ok(idx > 0, "应有 seriesCounts 函数");
  const body = storeSrc.slice(idx, idx + 600);
  assert.ok(/count\s*>=\s*2/.test(body), "seriesCounts 应过滤 < 2 本的丛书");
  assert.ok(/localeCompare.*zh-Hans-CN/.test(body), "seriesCounts 应中文排序");
});

test("[facets] getContinueReadId 跳过读完 + 零进度", () => {
  const idx = storeSrc.indexOf("getContinueReadId()");
  assert.ok(idx > 0, "应有 getContinueReadId 函数");
  const body = storeSrc.slice(idx, idx + 700);
  assert.ok(/0\.995/.test(body), "应跳过已读完(>= 99.5%)");
  assert.ok(/<=\s*0/.test(body) || /<\s*0/.test(body) || /frac\s*<=\s*0/.test(body), "应跳过零进度");
  assert.ok(/lastReadAt/.test(body), "应按 lastReadAt 倒序");
});

/* ================= UI 集成 ================= */

test("[UI] 编辑弹窗含「颜色」区块 + 7 色 swatch + 移除色按钮", () => {
  // 编辑弹窗模板里出现 swatch 列表
  assert.ok(/editColor/.test(viewSrc), "应有 editColor 状态");
  // 应引用 BOOK_COLORS 字典(不硬编码 token)
  assert.ok(/BOOK_COLORS/.test(viewSrc), "swatch 应引用 BOOK_COLORS 字典");
  // 应有 7 色 swatch 渲染 + 选中态
  assert.ok(/shelf-swatch/.test(viewSrc), "应有 shelf-swatch 组件");
  assert.ok(/shelf-swatch-clear/.test(viewSrc) || /✕\s*移除/.test(viewSrc), "应有移除色按钮");
  // saveEdit 应把 color 字段也写进去
  assert.ok(/color:\s*editColor/.test(viewSrc), "saveEdit 应传 color 字段");
});

test("[UI] 管理分组弹窗分组行有色点 + 颜色 popover", () => {
  // group-item 模板里有颜色 popover 触发器
  assert.ok(/group-color|分组色|setGroupColor/.test(viewSrc), "管理分组弹窗应支持分组设色");
});

test("[UI] 侧边栏分组前显示色点(动态)", () => {
  // shelf-sb-label 之前或 g.name 之前有条件色点
  assert.ok(/g\.color/.test(viewSrc), "侧边栏应按 g.color 显示色点");
});

test("[UI] 网格卡片 / 列表行含色点", () => {
  // 卡片模板里有 book.color 渲染
  assert.ok(/book\.color/.test(viewSrc), "卡片模板应读 book.color");
});

test("[UI] 顶栏 ⏵ 续读按钮", () => {
  assert.ok(/getContinueReadId|continueRead|续读/.test(viewSrc), "应有续读按钮触发器");
});

test("[UI] 双击侧边栏组名进入编辑模式", () => {
  // 找到 sidebar 组渲染块,确保有 dblclick
  const sidebar = viewSrc.match(/shelf-sb-label[\s\S]*?\{g\.name\}/);
  assert.ok(sidebar, "应找到侧边栏组渲染");
  assert.ok(
    /dblclick|on:dblclick/.test(sidebar[0]),
    "侧边栏组名应绑 dblclick 进入编辑"
  );
});

test("[UI] 批量工具栏支持颜色 dropdown", () => {
  assert.ok(/batchSetColor|批量.*颜色|setColor.*selected/.test(viewSrc), "批量工具栏应支持批量设色");
});

test("[UI] 状态计数区块(想读/在读/读完)有数量", () => {
  // 现状已有 statusCounts,UI 暴露数字
  assert.ok(/facets\.status\[s\]/.test(viewSrc), "侧边栏应显示状态计数");
});

/* ================= 旧数据兼容 ================= */

test("[兼容] BookGroup.color / BookMeta.color / BookMeta.order 全 optional", () => {
  // 老数据无此字段,直接 undefined,UI 显示无色
  const m = storeSrc.match(/export interface BookGroup\s*\{([\s\S]*?)\n\}/);
  assert.ok(/\n\s*color\?:/.test(m[1]), "BookGroup.color 必须 optional");
  const m2 = storeSrc.match(/export interface BookMeta\s*\{([\s\S]*?)\n\}/);
  assert.ok(/\n\s*color\?:/.test(m2[1]), "BookMeta.color 必须 optional");
  assert.ok(/\n\s*order\?:/.test(m2[1]), "BookMeta.order 必须 optional");
});

test("[兼容] 旧字段全部保留", () => {
  const m = storeSrc.match(/export interface BookMeta\s*\{([\s\S]*?)\n\}/);
  for (const f of ["id", "title", "format", "path", "size", "addedAt", "status", "rating", "favorite", "tags", "series", "groupId", "bookmarks"]) {
    assert.ok(new RegExp(`\\n\\s*${f}\\??:`).test(m[1]), `BookMeta.${f} 应保留`);
  }
});
