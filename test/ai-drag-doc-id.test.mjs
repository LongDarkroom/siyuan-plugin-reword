// 拖拽源识别测试（文档 / 块）
// 覆盖：src/ai/drag-doc-id.ts 的 extractDocIdFromDrag / resolveDocIdFromDragSource
//
// 2026-09-02 P0 回归：
//   旧实现用 drop 事件的 e.target 反推拖拽源，而 e.target 恒为"放置目标"（AI 面板自身），
//   于是把「拖文本块」误判成「拖页签」，并抓到 dock 面板自身的 UUID → AI 收不到任何内容。
//   本文件的 drop 语义用例即为该 bug 的回归锁。

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  extractDocIdFromDrag,
  resolveDocIdFromDragSource,
  isValidDocId,
  looksLikeUuid,
  blockTypeFromDomType,
  DOC_CONTAINERS,
} from "../src/ai/drag-doc-id.ts";

/** 构造一个 mock DragEvent,带 target 元素和可控的 DataTransfer */
function makeDragEvent(target, transferData = {}) {
  const dt = {
    types: Object.keys(transferData),
    getData(type) {
      return transferData[type] || "";
    },
    setData(type, val) { transferData[type] = val; },
  };
  return { target, dataTransfer: dt };
}

const DOC_ID_A = "20260813120000-aaaaaa";
const DOC_ID_B = "20260813120000-bbbbbb";
const BLOCK_ID = "20260813120000-zzzzzz"; // 块 ID 格式相同,可能被误识别
/** dock / 布局面板自身的 ID：思源块 ID 绝不会长成 8-4-4-4-12 */
const DOCK_UUID = "9283291e-3913-4044-a62b-867773067fa6";

test("A:isValidDocId 接受 14+ 位字母数字连字符", () => {
  assert.equal(isValidDocId("20260813120000-aaaaaa"), true);
  assert.equal(isValidDocId("a"), false);
  assert.equal(isValidDocId(""), false);
  assert.equal(isValidDocId(null), false);
  assert.equal(isValidDocId(undefined), false);
  assert.equal(isValidDocId("short"), false);
});

test("A:looksLikeUuid 识别 8-4-4-4-12 形态", () => {
  assert.equal(looksLikeUuid(DOCK_UUID), true);
  assert.equal(looksLikeUuid(DOC_ID_A), false);
  assert.equal(looksLikeUuid("not-a-uuid"), false);
  assert.equal(looksLikeUuid(""), false);
});

test("A:DOC_CONTAINERS 至少覆盖 3 个常见选择器", () => {
  assert.ok(DOC_CONTAINERS.length >= 3);
  assert.ok(DOC_CONTAINERS.some((s) => s.includes("tab-bar")));
  assert.ok(DOC_CONTAINERS.some((s) => s.includes("file")));
});

// ──────────────────────────────────────────────────────────────
// 显式拖拽源（dragstart 记录的源元素 / resolveDocIdFromDragSource）
// ──────────────────────────────────────────────────────────────

test("A:页签栏 li[data-id] → 命中 docId", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <ul class="layout-tab-bar">
      <li data-id="${DOC_ID_A}" class="item">文档A</li>
    </ul>
  </body>`);
  const li = dom.window.document.querySelector("li[data-id]");
  assert.equal(extractDocIdFromDrag(makeDragEvent(li), li), DOC_ID_A);
  assert.equal(resolveDocIdFromDragSource(li), DOC_ID_A);
});

test("A:b3-tab-bar 容器内的 li[data-id] → 命中", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div class="b3-tab-bar">
      <ul><li data-id="${DOC_ID_A}">文档</li></ul>
    </div>
  </body>`);
  const li = dom.window.document.querySelector("li[data-id]");
  assert.equal(extractDocIdFromDrag(makeDragEvent(li), li), DOC_ID_A);
});

test("A:文档树 .sy__file 内的 li[data-id] → 命中", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <ul class="sy__file">
      <li data-id="${DOC_ID_A}">笔记1</li>
      <li data-id="${DOC_ID_B}">笔记2</li>
    </ul>
  </body>`);
  const li = dom.window.document.querySelector(`li[data-id="${DOC_ID_B}"]`);
  assert.equal(extractDocIdFromDrag(makeDragEvent(li), li), DOC_ID_B);
});

test("A:文档树节点只有 data-node-id（值即文档 ID）→ 命中", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div class="sy__file"><ul>
      <li data-node-id="${DOC_ID_A}" class="b3-list-item">笔记</li>
    </ul></div>
  </body>`);
  const li = dom.window.document.querySelector("li[data-node-id]");
  assert.equal(resolveDocIdFromDragSource(li), DOC_ID_A);
});

test("A:拖文档正文里的块（.protyle-wysiwyg 内）→ 不是文档拖拽（关键回归）", () => {
  // 这是本次 P0 的核心场景：拖的是文本块，绝不能被判成拖页签
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div class="protyle"><div class="protyle-wysiwyg">
      <div data-node-id="${BLOCK_ID}" data-type="NodeParagraph">正文段落</div>
    </div></div>
  </body>`);
  const blockEl = dom.window.document.querySelector(`[data-node-id]`);
  assert.equal(resolveDocIdFromDragSource(blockEl), null, "正文内的块应交给块引用路径");
  assert.equal(extractDocIdFromDrag(makeDragEvent(blockEl), blockEl), null);
});

test("A:非页签/文档树容器的 [data-id] → 不命中(防误抓)", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <button data-id="${DOC_ID_A}">不是文档</button>
  </body>`);
  const btn = dom.window.document.querySelector("button");
  assert.equal(extractDocIdFromDrag(makeDragEvent(btn), btn), null, "无文档容器上下文的 [data-id] 不应被识别");
});

test("A:isInsideDocContainer 恒真 bug 回归：祖先层无页签/文档树容器时不命中", () => {
  // 旧实现用 parent.querySelector(sel) 做后代查询，走到 body 时必然命中 → 过滤器形同虚设
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div class="unrelated-panel"><div class="inner"><span data-id="${DOC_ID_A}">x</span></div></div>
  </body>`);
  const span = dom.window.document.querySelector("span[data-id]");
  assert.equal(extractDocIdFromDrag(makeDragEvent(span), span), null);
});

test("A:UUID 一票否决（DOM 猜测路径）", () => {
  // 场景还原：drop 时顺着 AI 面板往上找，抓到 dock 面板自身的 UUID
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div class="layout-tab-container">
      <div class="layout-tab-bar"><ul><li data-id="${DOCK_UUID}">REword</li></ul></div>
      <div class="protyle hiword-ai-protyle" data-node-id="${BLOCK_ID}"></div>
    </div>
  </body>`);
  const li = dom.window.document.querySelector("li[data-id]");
  assert.equal(extractDocIdFromDrag(makeDragEvent(li), li), null, "UUID 形态的 data-id 必须被拒绝");
  assert.equal(resolveDocIdFromDragSource(li), null);
});

test("A:页签栏内 protyle 反查命中真文档 ID，且排除 REword 自己的输入框", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div class="layout-tab-container">
      <div class="layout-tab-bar"><ul><li data-id="${DOCK_UUID}">标签页</li></ul></div>
      <div class="protyle hiword-ai-protyle" data-id="${DOCK_UUID}">REword 输入框</div>
      <div class="protyle" data-id="${DOC_ID_A}">真文档</div>
    </div>
  </body>`);
  const li = dom.window.document.querySelector("li[data-id]");
  assert.equal(resolveDocIdFromDragSource(li), DOC_ID_A, "应跳过 .hiword-ai-protyle 取到真文档");
});

test("A:文档树内不做 protyle 反查（防误命中布局里第一个 protyle）", () => {
  // 旧逻辑会一路找到 .sy__layout 再抓"布局中第一个 protyle" → 拿错文档
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div class="sy__layout">
      <div class="sy__file"><ul><li data-id="${DOC_ID_B}">笔记2</li></ul></div>
      <div class="layout-tab-container"><div class="protyle" data-id="${DOC_ID_A}">另一篇文档</div></div>
    </div>
  </body>`);
  const li = dom.window.document.querySelector("li[data-id]");
  assert.equal(resolveDocIdFromDragSource(li), DOC_ID_B, "文档树节点应直接用自身 ID，不得反查 protyle");
});

test("A:data-id 格式不合法（太短/非 ID 字符）→ null", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <ul class="layout-tab-bar">
      <li data-id="short">无效</li>
    </ul>
  </body>`);
  const li = dom.window.document.querySelector("li[data-id]");
  assert.equal(extractDocIdFromDrag(makeDragEvent(li), li), null, "data-id 太短不应被识别");
});

test("A:三层嵌套:页签栏 > ul > li[data-id] → 命中（closest 仍能找到）", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div class="layout-tab-container">
      <div class="layout-tab-bar">
        <ul><li data-id="${DOC_ID_A}">文档</li></ul>
      </div>
    </div>
  </body>`);
  const li = dom.window.document.querySelector("li[data-id]");
  assert.equal(extractDocIdFromDrag(makeDragEvent(li), li), DOC_ID_A);
});

// ──────────────────────────────────────────────────────────────
// drop 语义：未提供拖拽源元素时必须放弃 DOM 猜测（P0 回归锁）
// ──────────────────────────────────────────────────────────────

test("P0:drop 语义下未传 sourceEl → 一律返回 null（不得用 e.target 反推来源）", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div class="layout-tab-container">
      <div class="layout-tab-bar"><ul><li data-id="${DOC_ID_A}">文档</li></ul></div>
    </div>
  </body>`);
  const li = dom.window.document.querySelector("li[data-id]");
  // 即使 target 确实是页签（旧测试的 mock 语义），未提供 sourceEl 也不许猜
  assert.equal(extractDocIdFromDrag(makeDragEvent(li)), null);
});

test("P0:drop 语义下 e.target 是放置目标（REword 面板）时不得误判为文档", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div class="layout-tab-container">
      <div class="protyle hiword-ai-protyle" data-id="${DOCK_UUID}">REword 输入框</div>
    </div>
  </body>`);
  const panel = dom.window.document.querySelector(".hiword-ai-protyle");
  assert.equal(extractDocIdFromDrag(makeDragEvent(panel)), null);
  assert.equal(extractDocIdFromDrag(makeDragEvent(panel), panel), null);
});

// ──────────────────────────────────────────────────────────────
// dataTransfer 显式数据（跨窗口拖拽，无需 DOM）
// ──────────────────────────────────────────────────────────────

test("A:text/plain 含 siyuan://documents/<id> → 命中（无需 sourceEl）", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body><div>foo</div></body>`);
  const div = dom.window.document.querySelector("div");
  assert.equal(extractDocIdFromDrag(makeDragEvent(div, { "text/plain": `siyuan://documents/${DOC_ID_A}` })), DOC_ID_A);
});

test("A:dataTransfer 自定义类型 siyuan/doc-id → 命中（无需 sourceEl）", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body><div></div></body>`);
  const div = dom.window.document.querySelector("div");
  assert.equal(extractDocIdFromDrag(makeDragEvent(div, { "siyuan/doc-id": DOC_ID_A })), DOC_ID_A);
});

test("A:dataTransfer 自定义类型 JSON {id: '...'} → 命中（无需 sourceEl）", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body><div></div></body>`);
  const div = dom.window.document.querySelector("div");
  assert.equal(extractDocIdFromDrag(makeDragEvent(div, { "text/x-siyuan-doc": JSON.stringify({ id: DOC_ID_A }) })), DOC_ID_A);
});

test("A:无 dataTransfer → null", () => {
  assert.equal(extractDocIdFromDrag({ target: null, dataTransfer: null }), null);
});

test("A:target 无 [data-id] 祖先 + 无任何 dataTransfer 数据 → null", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body><div>hello</div></body>`);
  const div = dom.window.document.querySelector("div");
  assert.equal(extractDocIdFromDrag(makeDragEvent(div, { "text/plain": "普通文本" })), null);
});

test("A:源为 null / 非元素 → null", () => {
  assert.equal(resolveDocIdFromDragSource(null), null);
  assert.equal(resolveDocIdFromDragSource(undefined), null);
  assert.equal(resolveDocIdFromDragSource({}), null);
});

// ──────────────────────────────────────────────────────────────
// 块类型 DOM 映射（省掉一次 SELECT type 查询）
// ──────────────────────────────────────────────────────────────

test("B:blockTypeFromDomType 映射思源 DOM data-type → 短类型码", () => {
  assert.equal(blockTypeFromDomType("NodeParagraph"), "p");
  assert.equal(blockTypeFromDomType("NodeHeading"), "h");
  assert.equal(blockTypeFromDomType("NodeCodeBlock"), "c");
  assert.equal(blockTypeFromDomType("NodeList"), "l");
  assert.equal(blockTypeFromDomType("NodeListItem"), "i");
  assert.equal(blockTypeFromDomType("NodeBlockquote"), "quote");
});

test("B:blockTypeFromDomType 未知/缺失 → 空串（调用方回退 SQL 查询）", () => {
  assert.equal(blockTypeFromDomType("NodeSomethingNew"), "");
  assert.equal(blockTypeFromDomType(null), "");
  assert.equal(blockTypeFromDomType(undefined), "");
});
