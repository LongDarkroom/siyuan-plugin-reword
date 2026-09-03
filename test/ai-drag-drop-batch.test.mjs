// 批量拖入编排测试（面板级，直接跑生产 handleDrop）
// 覆盖：src/ai/ai-panel.ts handleDrop 的多块分支
//
// 为什么需要这个文件：test/ai-drag-block-ids.test.mjs 只覆盖「通道解析」纯函数，
// 而本次真正的风险在「解析出 N 个 ID 之后怎么插」——
//   - 是否 N 个块都插了（旧实现只插第一个）；
//   - 落点 dropPoint 是否只给第一块（每块都重设光标会导致顺序错乱）；
//   - 多块时类型提示是否置空（沿用被拖块的类型会让所有卡片图标相同）。
// 这一层过去零覆盖。
//
// 做法：把最底层的 insertBlockRef 换成探针，handleDrop 本身跑生产代码。

import { test } from "node:test";
import assert from "node:assert/strict";
import { AiPanel } from "../src/ai/ai-panel.ts";
import {
  SIYUAN_DROP_GUTTER,
  SIYUAN_ZWSP,
  collectDragBlockIds,
} from "../src/ai/drag-block-ids.ts";

const ID1 = "20260813120000-aaaaaa";
const ID2 = "20260813120000-bbbbbb";
const ID3 = "20260813120000-cccccc";
const WORKSPACE_DIR = "/Users/xieyue/Documents/SiYuan";

/** 思源真实 gutter 类型名：前缀 + dataType + ZWSP + subtype + ZWSP + ids + ZWSP + workspaceDir */
function gutterType(ids, dataType = "NodeParagraph") {
  return SIYUAN_DROP_GUTTER + dataType + SIYUAN_ZWSP + "" + SIYUAN_ZWSP + ids.join(",") + SIYUAN_ZWSP + WORKSPACE_DIR;
}

/** 构造 drop 事件：只需 handleDrop 真正用到的部分 */
function makeDropEvent(types) {
  const dt = {
    types,
    files: [],
    getData: () => "",
  };
  return {
    dataTransfer: dt,
    clientX: 120,
    clientY: 340,
    preventDefault() {},
    stopPropagation() {},
  };
}

/**
 * 最小面板替身：host 的 resolveDragBlockIds 直接调**生产**解析函数，
 * 于是 types → 解析 → 批量插入编排 是端到端的；
 * insertBlockRef 换成探针，记录每次插入的参数。
 */
function makePanel(resolveIds) {
  const inserted = [];
  const base = {
    // 只实现本次链路真正会调的方法，其余由 Proxy 兜成 no-op
    resolveDragBlockIds: (e) =>
      resolveIds
        ? resolveIds(e)
        : collectDragBlockIds({ types: [...e.dataTransfer.types] }),
    resolveDragBlockType: () => "p",
  };
  const host = new Proxy(base, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return () => null;
    },
  });
  const panel = new AiPanel(host);
  panel.insertBlockRef = async (blockId, typeHint, dropPoint) => {
    inserted.push({ blockId, typeHint, dropPoint });
  };
  return { panel, inserted };
}

// ──────────────────────────────────────────────────────────────
// 核心：多块必须全插
// ──────────────────────────────────────────────────────────────

test("D:拖 3 个块 → 插入 3 张卡片（旧实现只插第 1 个，本次核心回归）", async () => {
  const { panel, inserted } = makePanel();
  await panel.handleDrop(makeDropEvent([gutterType([ID1, ID2, ID3])]));
  assert.deepEqual(inserted.map((i) => i.blockId), [ID1, ID2, ID3]);
});

test("D:插入顺序与拖入顺序一致", async () => {
  const { panel, inserted } = makePanel();
  await panel.handleDrop(makeDropEvent([gutterType([ID3, ID1, ID2])]));
  assert.deepEqual(inserted.map((i) => i.blockId), [ID3, ID1, ID2]);
});

test("D:落点 dropPoint 只给第一块（其余为 undefined，防止每块重设光标导致顺序错乱）", async () => {
  const { panel, inserted } = makePanel();
  await panel.handleDrop(makeDropEvent([gutterType([ID1, ID2, ID3])]));
  assert.deepEqual(inserted[0].dropPoint, { x: 120, y: 340 });
  assert.equal(inserted[1].dropPoint, undefined);
  assert.equal(inserted[2].dropPoint, undefined);
});

test("D:多块时类型提示置空（让每块自查类型，混合段落/标题图标才正确）", async () => {
  const { panel, inserted } = makePanel();
  await panel.handleDrop(makeDropEvent([gutterType([ID1, ID2])]));
  assert.equal(inserted[0].typeHint, "");
  assert.equal(inserted[1].typeHint, "");
});

test("D:单块时沿用 dragstart 类型提示（省一次 SQL 查询）", async () => {
  const { panel, inserted } = makePanel();
  await panel.handleDrop(makeDropEvent([gutterType([ID1])]));
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].typeHint, "p");
  assert.deepEqual(inserted[0].dropPoint, { x: 120, y: 340 });
});

// ──────────────────────────────────────────────────────────────
// 边界与容错
// ──────────────────────────────────────────────────────────────

test("D:解析不到任何块 → 一次都不插（交给文档 / 纯文本兜底）", async () => {
  const { panel, inserted } = makePanel();
  await panel.handleDrop(makeDropEvent(["text/plain", "text/html"]));
  assert.equal(inserted.length, 0);
});

test("D:单块插入抛错不影响后续块（批量容错）", async () => {
  const { panel, inserted } = makePanel();
  let first = true;
  panel.insertBlockRef = async (id, hint, point) => {
    if (first) {
      first = false;
      throw new Error("protyle.insert 静默失败");
    }
    inserted.push({ blockId: id, typeHint: hint, dropPoint: point });
  };
  await panel.handleDrop(makeDropEvent([gutterType([ID1, ID2, ID3])]));
  assert.deepEqual(inserted.map((i) => i.blockId), [ID2, ID3]);
});

test("D:重复 ID 在解析层已去重 → 只插一次", async () => {
  const { panel, inserted } = makePanel();
  await panel.handleDrop(makeDropEvent([gutterType([ID1, ID1, ID2])]));
  assert.deepEqual(inserted.map((i) => i.blockId), [ID1, ID2]);
});
