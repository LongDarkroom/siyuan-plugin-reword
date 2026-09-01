/**
 * 书架 P2 · 右键菜单组件
 * ----------------------------------------------------------------
 * 纯源码文本断言,覆盖:
 *  - 组件导出 MenuItem 类型
 *  - 组件支持嵌套子菜单 + 危险项 + 选中态
 *  - 视口边缘 flip 逻辑存在
 *  - 关闭触发器齐全(外部点击 / Esc / 滚轮 / resize)
 *  - BookshelfView 已集成右键菜单(books + groups)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const menuSrc = readFileSync(join(__dirname, "..", "src", "reader", "bookshelf-context-menu.svelte"), "utf-8");
const viewSrc = readFileSync(join(__dirname, "..", "src", "reader", "BookshelfView.svelte"), "utf-8");

/* ================= 组件导出 ================= */

test("[组件] 导出 MenuItem 类型", () => {
  assert.ok(/export type MenuItem\s*=/.test(menuSrc), "应导出 MenuItem 类型");
});

test("[组件] MenuItem 字段(label / icon / onClick / children / divider / danger / disabled / active)", () => {
  const m = menuSrc.match(/export type MenuItem\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(m, "应能抽出 MenuItem");
  for (const f of ["label", "icon", "onClick", "children", "divider", "danger", "disabled", "active"]) {
    assert.ok(new RegExp(`\\s+${f}\\??:`).test(m[1]), `MenuItem.${f} 应存在`);
  }
});

test("[组件] 默认导出 Svelte 组件 + Svelte 4 风格", () => {
  assert.ok(/<script\s+lang="ts">/.test(menuSrc), "应使用 TS script");
  assert.ok(/export let items:/.test(menuSrc), "应接收 items prop");
  assert.ok(/export let x:/.test(menuSrc), "应接收 x prop");
  assert.ok(/export let y:/.test(menuSrc), "应接收 y prop");
});

/* ================= 关闭触发器 ================= */

test("[组件] Esc 关闭菜单", () => {
  assert.ok(/e\.key\s*===\s*"Escape"/.test(menuSrc), "应监听 Esc 键");
  assert.ok(/close\(\)/.test(menuSrc), "Esc 应调 close()");
});

test("[组件] 外部点击关闭", () => {
  assert.ok(/addEventListener\("mousedown"/.test(menuSrc), "应监听 mousedown");
  assert.ok(/addEventListener\("scroll"/.test(menuSrc), "应监听 scroll");
  assert.ok(/addEventListener\("resize"/.test(menuSrc), "应监听 resize");
  assert.ok(/removeEventListener/.test(menuSrc), "应在 destroy 移除监听");
});

test("[组件] 暴露 close 事件", () => {
  assert.ok(/createEventDispatcher/.test(menuSrc), "应使用 Svelte dispatcher");
  assert.ok(/dispatch\("close"/.test(menuSrc), "应派发 close 事件");
});

/* ================= 视口边缘 flip ================= */

test("[组件] 视口边缘 flip", () => {
  assert.ok(/adjustPosition/.test(menuSrc), "应有 adjustPosition");
  assert.ok(/innerWidth/.test(menuSrc) || /vw/.test(menuSrc), "应参考视口宽度");
  assert.ok(/rect\.right/.test(menuSrc) || /rect\.bottom/.test(menuSrc), "应测边界");
});

/* ================= 嵌套子菜单 ================= */

test("[组件] 嵌套子菜单 hover 展开", () => {
  assert.ok(/on:mouseenter/.test(menuSrc), "应监听 mouseenter");
  assert.ok(/openSubmenuIdx/.test(menuSrc), "应跟踪当前打开的子菜单");
  assert.ok(/shelf-menu-submenu/.test(menuSrc), "应渲染子菜单");
});

test("[组件] 子菜单(嵌套)渲染", () => {
  assert.ok(/#each items\[openSubmenuIdx\]\.children/.test(menuSrc), "子菜单应迭代 children");
});

/* ================= 视觉与交互 ================= */

test("[组件] 危险项(danger)红色", () => {
  assert.ok(/\.danger/.test(menuSrc), "应有 danger 样式");
  assert.ok(/color:\s*var\(--b3-theme-error/.test(menuSrc), "danger 应使用 --b3-theme-error");
});

test("[组件] 选中态(active)打勾", () => {
  assert.ok(/shelf-menu-check/.test(menuSrc), "应有选中打勾元素");
  assert.ok(/✓/.test(menuSrc), "应使用 ✓ 字符");
});

test("[组件] 禁用项(disable)灰化", () => {
  assert.ok(/\.disabled/.test(menuSrc), "应有 disabled 样式");
  assert.ok(/opacity:\s*0\.\d+/.test(menuSrc), "disabled 应降低 opacity");
});

test("[组件] 分隔线(divider)支持", () => {
  assert.ok(/shelf-menu-divider/.test(menuSrc), "应有 divider 元素");
});

/* ================= 集成 ================= */

test("[集成] BookshelfView 导入 BookshelfContextMenu", () => {
  assert.ok(/import BookshelfContextMenu/.test(viewSrc), "应导入 BookshelfContextMenu 组件");
  assert.ok(/type MenuItem/.test(viewSrc) && /import.*bookshelf-context-menu/.test(viewSrc), "应导入 MenuItem 类型");
});

test("[集成] BookshelfView 有 ctxMenu 状态 + openCtxMenu / closeCtxMenu", () => {
  assert.ok(/let ctxMenu/.test(viewSrc), "应有 ctxMenu 状态");
  assert.ok(/function openCtxMenu/.test(viewSrc), "应有 openCtxMenu 函数");
  assert.ok(/function closeCtxMenu/.test(viewSrc), "应有 closeCtxMenu 函数");
});

test("[集成] 右键菜单在 book cards 触发", () => {
  assert.ok(/class="book-card"[\s\S]*?on:contextmenu/.test(viewSrc), "book-card 应绑 on:contextmenu");
  assert.ok(/buildBookMenu\(book\)/.test(viewSrc), "应传 buildBookMenu(book)");
});

test("[集成] 右键菜单在 list rows 触发", () => {
  assert.ok(/class="shelf-row"[\s\S]*?on:contextmenu/.test(viewSrc), "shelf-row 应绑 on:contextmenu");
});

test("[集成] 右键菜单在 sidebar group items 触发", () => {
  assert.ok(/shelf-sb-group[\s\S]*?on:contextmenu/.test(viewSrc), "shelf-sb-group 应绑 on:contextmenu");
  assert.ok(/buildGroupMenu\(g\)/.test(viewSrc), "应传 buildGroupMenu(g)");
});

test("[集成] 右键菜单在模板中渲染", () => {
  assert.ok(/<BookshelfContextMenu/.test(viewSrc), "模板中应渲染 BookshelfContextMenu");
  assert.ok(/on:close={closeCtxMenu}/.test(viewSrc), "应绑 close 事件");
});

/* ================= 菜单项覆盖 ================= */

test("[书籍菜单] 包含续读/编辑/标签/分组/收藏/状态/评分/颜色/封面/书名复制/删除", () => {
  const m = viewSrc.match(/function buildBookMenu[\s\S]*?function buildGroupMenu/);
  assert.ok(m, "应能抽出 buildBookMenu");
  for (const k of ["续读", "开始阅读", "编辑信息", "设置标签", "移到分组", "收藏", "状态", "评分", "颜色", "替换封面", "复制书名", "从书架移除"]) {
    assert.ok(m[0].includes(k), `书籍菜单应含「${k}」`);
  }
});

test("[分组菜单] 包含重命名/颜色/打开/复制/删除", () => {
  const m = viewSrc.match(/function buildGroupMenu[\s\S]*?\/\* ----/);
  assert.ok(m, "应能抽出 buildGroupMenu");
  for (const k of ["重命名", "颜色", "在主区域打开", "复制组名", "删除分组"]) {
    assert.ok(m[0].includes(k), `分组菜单应含「${k}」`);
  }
});

test("[书籍菜单] 颜色子菜单含 7 色 + 移除色", () => {
  const m = viewSrc.match(/function buildBookMenu[\s\S]*?function buildGroupMenu/);
  assert.ok(/颜色[\s\S]{0,500}BOOK_COLORS\.map/.test(m[0]), "书籍颜色子菜单应迭代 BOOK_COLORS");
  assert.ok(m[0].includes("移除颜色"), "书籍颜色子菜单应有「移除颜色」");
});
