import test from "node:test";
import assert from "node:assert/strict";
import { markAnnotatedBlocks, clearBlockMarks } from "../src/annotation/block-mark.ts";

/**
 * 极简 DOM mock：仅满足 markAnnotatedBlocks / clearBlockMarks 用到的 API。
 *  - 编辑区 .protyle-wysiwyg 内含若干 [data-node-id] 块元素。
 *  - 每个块支持 dataset.nodeId 与 classList(add/remove/contains)。
 */
function makeClassList() {
  const s = new Set();
  return {
    add: (c) => s.add(c),
    remove: (c) => s.delete(c),
    contains: (c) => s.has(c),
  };
}
function makeBlock(id) {
  return { dataset: { nodeId: id }, classList: makeClassList() };
}
// 按 [data-node-id="X"] 选择器在块列表中查找（markAnnotatedBlocks 用 querySelector 按 id 定位）
function findById(blocks, sel) {
  const m = /\[data-node-id="([^"]+)"\]/.exec(sel || "");
  if (!m) return null;
  return blocks.find((b) => b.dataset.nodeId === m[1]) || null;
}
function installDom(blocks) {
  const root = {
    querySelectorAll: (sel) => (sel === "[data-node-id]" ? blocks : []),
    querySelector: (sel) => (sel?.startsWith("[data-node-id") ? findById(blocks, sel) : null),
  };
  globalThis.document = {
    querySelectorAll: (sel) => {
      if (sel === ".protyle-wysiwyg") return [root];
      if (sel === ".hiword-ann-block")
        return blocks.filter((b) => b.classList.contains("hiword-ann-block"));
      return [];
    },
    querySelector: (sel) => (sel?.startsWith("[data-node-id") ? findById(blocks, sel) : null),
  };
}
const has = (b) => b.classList.contains("hiword-ann-block");

test("已批注的块被打标，未批注的块不动", () => {
  const a = makeBlock("blk-A");
  const b = makeBlock("blk-B");
  const c = makeBlock("blk-C");
  installDom([a, b, c]);

  markAnnotatedBlocks(new Set(["blk-A", "blk-C"]));

  assert.equal(has(a), true, "blk-A 应被标记");
  assert.equal(has(b), false, "blk-B 不应被标记");
  assert.equal(has(c), true, "blk-C 应被标记");
});

test("重复调用幂等：不会产生副作用", () => {
  const a = makeBlock("blk-A");
  const b = makeBlock("blk-B");
  installDom([a, b]);

  markAnnotatedBlocks(new Set(["blk-A"]));
  markAnnotatedBlocks(new Set(["blk-A"]));

  assert.equal(has(a), true);
  assert.equal(has(b), false, "blk-B 始终不应被标记");
});

test("数据删除后，残留标记被自动清除", () => {
  const x = makeBlock("blk-X");
  const y = makeBlock("blk-Y");
  installDom([x, y]);
  // 模拟上一次 DOM 残留：Y 仍带标记，但数据里已无 Y
  x.classList.add("hiword-ann-block");
  y.classList.add("hiword-ann-block");

  markAnnotatedBlocks(new Set(["blk-X"]));

  assert.equal(has(x), true, "X 仍应保留标记");
  assert.equal(has(y), false, "Y 的残留标记应被清除");
});

test("ids 为空时，所有残留标记被清空", () => {
  const a = makeBlock("blk-A");
  const b = makeBlock("blk-B");
  installDom([a, b]);
  a.classList.add("hiword-ann-block");
  b.classList.add("hiword-ann-block");

  clearBlockMarks();

  assert.equal(has(a), false);
  assert.equal(has(b), false);
});
