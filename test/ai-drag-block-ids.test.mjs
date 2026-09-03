// 批量块拖入解析测试
// 覆盖：src/ai/drag-block-ids.ts 的 parseGutterBlockIds / parseBlockRefIds / collectDragBlockIds
//
// 2026-09-03 背景（旧行为回归锁）：
//   旧实现从设计上只能拿到一个块 ID —— dragstart 用 closest("[data-node-id]")
//   只抓一个元素（拖块标时干脆抓不到），drop 时即便解析 text/html 也取 ids[0]。
//   于是「框选多块 / 拖块标多选」永远只进一个块。
//
// 通道编码以本机 SiYuan.app 前端产物为准（stage/build/app/common.*.js）：
//   SIYUAN_DROP_GUTTER = "application/siyuan-gutter"（旧版为 "siyuan/gutter"）
//   类型名 = 前缀 + dataType + ZWSP + subtype + ZWSP + ids + ZWSP + workspaceDir
//   → ids 固定在第 3 段（index 2），**不是最后一段**（最后一段是工作区路径）

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIYUAN_DROP_GUTTER,
  SIYUAN_DROP_GUTTER_LEGACY,
  SIYUAN_DROP_BLOCK_REF,
  SIYUAN_ZWSP,
  MAX_BLOCK_IDS,
  gutterPrefixes,
  parseGutterBlockIds,
  parseBlockRefIds,
  collectDragBlockIds,
} from "../src/ai/drag-block-ids.ts";

const ZWSP = SIYUAN_ZWSP;
const ID1 = "20260813120000-aaaaaa";
const ID2 = "20260813120000-bbbbbb";
const ID3 = "20260813120000-cccccc";
/** 新版 gutter 的第 4 段是工作区绝对路径，绝不能被当成块 ID */
const WORKSPACE_DIR = "/Users/xieyue/Documents/SiYuan";

/** 拼出思源真实的新版 gutter 类型名：前缀 + dataType + ZWSP + subtype + ZWSP + ids + ZWSP + workspaceDir */
function gutterType(ids, dataType = "NodeParagraph", subtype = "") {
  return SIYUAN_DROP_GUTTER + dataType + ZWSP + subtype + ZWSP + ids.join(",") + ZWSP + WORKSPACE_DIR;
}

test("A:常量与 ZWSP", () => {
  assert.equal(SIYUAN_DROP_GUTTER, "application/siyuan-gutter");
  assert.equal(SIYUAN_DROP_GUTTER_LEGACY, "siyuan/gutter");
  assert.equal(SIYUAN_DROP_BLOCK_REF, "application/siyuan-block-ref");
  assert.equal(ZWSP, "\u200b");
  assert.equal(ZWSP.length, 1);
  assert.ok(MAX_BLOCK_IDS >= 10);
});

test("A:gutterPrefixes 无 window.siyuan 时回落字面量（新前缀在旧前缀之前）", () => {
  const list = gutterPrefixes();
  assert.equal(list[0], SIYUAN_DROP_GUTTER);
  assert.ok(list.includes(SIYUAN_DROP_GUTTER_LEGACY));
});

// ──────────────────────────────────────────────────────────────
// gutter 通道解析（核心）
// ──────────────────────────────────────────────────────────────

test("A:types 里没有 gutter 通道 → 空数组", () => {
  assert.deepEqual(parseGutterBlockIds(["text/plain", "text/html"]), []);
  assert.deepEqual(parseGutterBlockIds([]), []);
  assert.deepEqual(parseGutterBlockIds(undefined), []);
  assert.deepEqual(parseGutterBlockIds(null), []);
});

test("A:单块拖拽 → 1 个 ID", () => {
  assert.deepEqual(parseGutterBlockIds(["text/plain", gutterType([ID1])]), [ID1]);
});

test("A:多块拖拽 → 全部 ID 且保持顺序（本次需求核心）", () => {
  assert.deepEqual(parseGutterBlockIds([gutterType([ID1, ID2, ID3])]), [ID1, ID2, ID3]);
});

test("A:ids 取第 3 段而非最后一段（最后一段是工作区路径，关键回归）", () => {
  // 旧写法 "取最后一段" 会拿到 /Users/xieyue/Documents/SiYuan，清洗后为空 → 功能全废
  const types = [gutterType([ID1, ID2])];
  assert.deepEqual(parseGutterBlockIds(types), [ID1, ID2]);
  assert.ok(!parseGutterBlockIds(types).some((id) => id.includes("/")));
});

test("A:列表块（subtype 非空 / dataType=NodeListItem）同样命中", () => {
  const types = [gutterType([ID1, ID2], "NodeListItem", "u")];
  assert.deepEqual(parseGutterBlockIds(types), [ID1, ID2]);
});

test("A:旧版前缀 siyuan/gutter（2 段结构 [gutterType, ids]）仍可兼容", () => {
  const legacy = SIYUAN_DROP_GUTTER_LEGACY + ZWSP + "NodeParagraph" + ZWSP + [ID1, ID2].join(",");
  assert.deepEqual(parseGutterBlockIds([legacy]), [ID1, ID2]);
});

test("A:只有前缀或 ids 段为空 → 空数组（不得误返回）", () => {
  assert.deepEqual(parseGutterBlockIds([SIYUAN_DROP_GUTTER]), []);
  assert.deepEqual(parseGutterBlockIds([SIYUAN_DROP_GUTTER + "NodeParagraph"]), []);
  assert.deepEqual(
    parseGutterBlockIds([SIYUAN_DROP_GUTTER + "NodeParagraph" + ZWSP + ZWSP + ZWSP + WORKSPACE_DIR]),
    []
  );
});

test("A:过滤非法 / 空白 ID，并去重", () => {
  const types = [gutterType([ID1, " short ", "", ID1, ID2, "###"])];
  assert.deepEqual(parseGutterBlockIds(types), [ID1, ID2]);
});

test("A:数量超上限时截断，防输入框被撑爆", () => {
  const many = Array.from({ length: MAX_BLOCK_IDS + 20 }, (_, i) => `20260813120000-${String(i).padStart(6, "0")}`);
  assert.equal(parseGutterBlockIds([gutterType(many)]).length, MAX_BLOCK_IDS);
});

test("A:其它 siyuan 通道（file / tab）不得被 gutter 解析误吃", () => {
  assert.deepEqual(parseGutterBlockIds(["application/siyuan-file", "application/siyuan-tab"]), []);
});

// ──────────────────────────────────────────────────────────────
// block-ref 通道（书签 / 块引面板拖入）
// ──────────────────────────────────────────────────────────────

test("B:block-ref JSON {ids:[…]} → 多块 ID", () => {
  const raw = JSON.stringify({ ids: [ID1, ID2, ID3], workspaceDir: WORKSPACE_DIR });
  assert.deepEqual(parseBlockRefIds(raw), [ID1, ID2, ID3]);
});

test("B:block-ref 顶层数组也接受", () => {
  assert.deepEqual(parseBlockRefIds(JSON.stringify([ID1, ID2])), [ID1, ID2]);
});

test("B:block-ref 非 JSON / 空 / 无 ids → 空数组", () => {
  assert.deepEqual(parseBlockRefIds("not-json"), []);
  assert.deepEqual(parseBlockRefIds(""), []);
  assert.deepEqual(parseBlockRefIds(null), []);
  assert.deepEqual(parseBlockRefIds(JSON.stringify({ workspaceDir: WORKSPACE_DIR })), []);
});

// ──────────────────────────────────────────────────────────────
// 通道汇总策略
// ──────────────────────────────────────────────────────────────

test("C:gutter 优先于 text/html（官方数据更可信）", () => {
  const got = collectDragBlockIds({
    types: [gutterType([ID1, ID2])],
    htmlIds: [ID2, ID3],
  });
  assert.deepEqual(got, [ID1, ID2]);
});

test("C:gutter 与 block-ref 同时存在 → 取覆盖更全的那个", () => {
  const got = collectDragBlockIds({
    types: [gutterType([ID1]), SIYUAN_DROP_BLOCK_REF],
    blockRefRaw: JSON.stringify({ ids: [ID1, ID2, ID3] }),
  });
  assert.deepEqual(got, [ID1, ID2, ID3]);
});

test("C:dragstart DOM 多选覆盖面更全时取 dragstart（老版本 gutter 只带 1 个）", () => {
  const got = collectDragBlockIds({
    types: [gutterType([ID1])],
    dragstartIds: [ID1, ID2, ID3],
    htmlIds: [ID1],
  });
  assert.deepEqual(got, [ID1, ID2, ID3]);
});

test("C:数量相同 → gutter 优先（官方通道优先序）", () => {
  const got = collectDragBlockIds({
    types: [gutterType([ID1, ID2])],
    dragstartIds: [ID3, ID2],
  });
  assert.deepEqual(got, [ID1, ID2]);
});

test("C:仅 dragstart 有值时用 dragstart（未接 gutter 的老路径不回归）", () => {
  assert.deepEqual(collectDragBlockIds({ types: ["text/plain"], dragstartIds: [ID1] }), [ID1]);
});

test("C:高可信通道都空 → 回退 text/html 多块", () => {
  assert.deepEqual(collectDragBlockIds({ types: ["text/html"], htmlIds: [ID2, ID3] }), [ID2, ID3]);
});

test("C:全通道为空 → 空数组（交给文档 / 纯文本兜底，不得伪造）", () => {
  assert.deepEqual(collectDragBlockIds({}), []);
  assert.deepEqual(collectDragBlockIds({ types: [], dragstartIds: [], htmlIds: [] }), []);
  assert.deepEqual(collectDragBlockIds({ types: ["text/plain"], dragstartIds: ["bad"], htmlIds: ["x"] }), []);
});

test("C:入参含 null/undefined 不抛异常", () => {
  assert.doesNotThrow(() =>
    collectDragBlockIds({ types: null, blockRefRaw: undefined, dragstartIds: undefined, htmlIds: [null, ID1] })
  );
  assert.deepEqual(collectDragBlockIds({ htmlIds: [null, ID1] }), [ID1]);
});
