// A 任务：思源页签 / 文档树拖入识别测试
// 覆盖：src/ai/drag-doc-id.ts 的 extractDocIdFromDrag 各种场景

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { extractDocIdFromDrag, isValidDocId, DOC_CONTAINERS } from "../src/ai/drag-doc-id.ts";

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

test("A:isValidDocId 接受 14+ 位字母数字连字符", () => {
  assert.equal(isValidDocId("20260813120000-aaaaaa"), true);
  assert.equal(isValidDocId("a"), false);
  assert.equal(isValidDocId(""), false);
  assert.equal(isValidDocId(null), false);
  assert.equal(isValidDocId(undefined), false);
  assert.equal(isValidDocId("short"), false);
});

test("A:DOC_CONTAINERS 至少覆盖 3 个常见选择器", () => {
  assert.ok(DOC_CONTAINERS.length >= 3);
  assert.ok(DOC_CONTAINERS.some((s) => s.includes("tab-bar")));
  assert.ok(DOC_CONTAINERS.some((s) => s.includes("file")));
});

test("A:页签栏 li[data-id] → 命中 docId", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <ul class="layout-tab-bar">
      <li data-id="${DOC_ID_A}" class="item">文档A</li>
    </ul>
  </body>`);
  const li = dom.window.document.querySelector("li[data-id]");
  const e = makeDragEvent(li);
  assert.equal(extractDocIdFromDrag(e), DOC_ID_A);
});

test("A:b3-tab-bar 容器内的 li[data-id] → 命中", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div class="b3-tab-bar">
      <ul><li data-id="${DOC_ID_A}">文档</li></ul>
    </div>
  </body>`);
  const li = dom.window.document.querySelector("li[data-id]");
  const e = makeDragEvent(li);
  assert.equal(extractDocIdFromDrag(e), DOC_ID_A);
});

test("A:文档树 .sy__file 内的 li[data-id] → 命中", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <ul class="sy__file">
      <li data-id="${DOC_ID_A}">笔记1</li>
      <li data-id="${DOC_ID_B}">笔记2</li>
    </ul>
  </body>`);
  const li = dom.window.document.querySelector(`li[data-id="${DOC_ID_B}"]`);
  const e = makeDragEvent(li);
  assert.equal(extractDocIdFromDrag(e), DOC_ID_B);
});

test("A:非页签/文档树容器的 [data-id] → 不命中(防误抓)", () => {
  // 假设某个普通按钮误带 data-id,不能被识别为文档
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <button data-id="${DOC_ID_A}">不是文档</button>
  </body>`);
  const btn = dom.window.document.querySelector("button");
  const e = makeDragEvent(btn);
  assert.equal(extractDocIdFromDrag(e), null, "无文档容器上下文的 [data-id] 不应被识别");
});

test("A:text/plain 含 siyuan://documents/<id> → 命中", () => {
  // 跨窗口拖拽（dragstart 不触发）,只能从 text/plain 兜底
  const dom = new JSDOM(`<!DOCTYPE html><body><div>foo</div></body>`);
  const div = dom.window.document.querySelector("div");
  const e = makeDragEvent(div, { "text/plain": `siyuan://documents/${DOC_ID_A}` });
  assert.equal(extractDocIdFromDrag(e), DOC_ID_A);
});

test("A:dataTransfer 自定义类型 siyuan/doc-id → 命中", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body><div></div></body>`);
  const div = dom.window.document.querySelector("div");
  const e = makeDragEvent(div, { "siyuan/doc-id": DOC_ID_A });
  assert.equal(extractDocIdFromDrag(e), DOC_ID_A);
});

test("A:dataTransfer 自定义类型 JSON {id: '...'} → 命中", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body><div></div></body>`);
  const div = dom.window.document.querySelector("div");
  const e = makeDragEvent(div, { "text/x-siyuan-doc": JSON.stringify({ id: DOC_ID_A }) });
  assert.equal(extractDocIdFromDrag(e), DOC_ID_A);
});

test("A:无 dataTransfer → null", () => {
  const e = { target: null, dataTransfer: null };
  assert.equal(extractDocIdFromDrag(e), null);
});

test("A:target 无 [data-id] 祖先 + 无任何 dataTransfer 数据 → null", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body><div>hello</div></body>`);
  const div = dom.window.document.querySelector("div");
  const e = makeDragEvent(div, { "text/plain": "普通文本" });
  assert.equal(extractDocIdFromDrag(e), null);
});

test("A:data-id 格式不合法（太短/非 ID 字符）→ null", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <ul class="layout-tab-bar">
      <li data-id="short">无效</li>
    </ul>
  </body>`);
  const li = dom.window.document.querySelector("li[data-id]");
  const e = makeDragEvent(li);
  assert.equal(extractDocIdFromDrag(e), null, "data-id 太短不应被识别");
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
  const e = makeDragEvent(li);
  assert.equal(extractDocIdFromDrag(e), DOC_ID_A);
});
