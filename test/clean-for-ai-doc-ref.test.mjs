// 2026-08-21 A 任务 v3:cleanForAi 中 doc-ref（原生 block-ref 化）占位符还原测试
// 页签引用现走原生 block-ref 通道：
//   - getInputValue 把 <span data-type="block-ref" data-id=docId data-subtype="s">📄 文档 XXXXXX</span>
//     还原为 @@REWORD_REF_<docId>@@（与块引用同一标记），并把锚 "📄 文档 XXXXXX" 存入 lastDomRefs
//   - cleanForAi step 0 把 @@REWORD_REF_<docId>@@ → ((docId '📄 文档 XXXXXX'))
//   - expandDocRefs 按锚前缀 "📄 文档 " 识别为文档引用，调 fetchDocText 实时拉全文
// 不再有 @@REWORD_DOC_<id>@@ 这一层自定义占位符。

import { test } from "node:test";
import assert from "node:assert/strict";

// 用一个最小替身镜像 cleanForAi 的 step 0（block-ref 统一通道）
class FakeCleaner {
  constructor(domRefs) {
    this.lastDomRefs = domRefs || new Map();
  }
  // 镜像真实实现的 step 0 段：@@REWORD_REF_<id>@@ → ((id 'anchor'))
  // anchor 取自 lastDomRefs（块引用为块正文前几字，文档引用为 "📄 文档 XXXXXX"）
  cleanBlockRef(raw) {
    let s = raw;
    s = s.replace(/@@REWORD_REF_([a-z0-9_-]{14,})@@/g, (_m, id) => {
      if (!this.lastDomRefs.has(id)) return _m;
      const anchor = (this.lastDomRefs.get(id) || "").replace(/'/g, "’");
      return `((${id} '${anchor}'))`;
    });
    return s;
  }
  // 完整清理入口
  cleanAll(raw) {
    return this.cleanBlockRef(raw);
  }
}

const DOC_UUID = "20260813120000-aaaaaa";
const BLOCK_14 = "20260813120000-zzzzzz";
const DOC_ANCHOR = "📄 文档 aaaaaa";

test("CleanA:doc-ref @@REWORD_REF_<uuid>@@ → ((uuid '📄 文档 XXXXXX'))", () => {
  const domRefs = new Map([[DOC_UUID, DOC_ANCHOR]]);
  const c = new FakeCleaner(domRefs);
  const md = `前缀 @@REWORD_REF_${DOC_UUID}@@ 后缀`;
  const out = c.cleanAll(md);
  assert.match(out, /\(\(20260813120000-aaaaaa '📄 文档 aaaaaa'\)\)/);
  assert.ok(!out.includes("@@REWORD_REF_"));
});

test("CleanA:文档短 id 锚由 lastDomRefs 的「📄 文档 + 6 字符短码」决定", () => {
  const id = "20260813120000-xy12ab";
  const c = new FakeCleaner(new Map([[id, "📄 文档 xy12ab"]]));
  const md = `@@REWORD_REF_${id}@@`;
  const out = c.cleanAll(md);
  assert.match(out, /📄 文档 xy12ab/);
});

test("CleanA:不破坏普通块引用 @@REWORD_REF_<id>@@(锚为块正文)", () => {
  const domRefs = new Map([[BLOCK_14, "hello world"]]);
  const c = new FakeCleaner(domRefs);
  const md = `@@REWORD_REF_${BLOCK_14}@@`;
  const out = c.cleanAll(md);
  assert.match(out, /\(\(20260813120000-zzzzzz 'hello world'\)\)/);
});

test("CleanA:cleanAll 同时处理 doc-ref 和 block-ref", () => {
  const domRefs = new Map([
    [DOC_UUID, DOC_ANCHOR],
    [BLOCK_14, "anchor"],
  ]);
  const c = new FakeCleaner(domRefs);
  const md = `混合 @@REWORD_REF_${DOC_UUID}@@ 与 @@REWORD_REF_${BLOCK_14}@@`;
  const out = c.cleanAll(md);
  assert.match(out, /\(\(20260813120000-aaaaaa '📄 文档 aaaaaa'\)\)/);
  assert.match(out, /\(\(20260813120000-zzzzzz 'anchor'\)\)/);
  assert.ok(!out.includes("@@REWORD_"));
});

test("CleanA:未登记的 @@REWORD_REF_<id>@@ 原样保留（防御）", () => {
  const c = new FakeCleaner(new Map());
  const md = `@@REWORD_REF_${DOC_UUID}@@`;
  assert.equal(c.cleanAll(md), md);
});

test("CleanA:空字符串 → 空字符串", () => {
  const c = new FakeCleaner();
  assert.equal(c.cleanAll(""), "");
});

test("CleanA:没有占位符 → 原样返回", () => {
  const c = new FakeCleaner();
  const md = "普通 markdown 内容,没有 REword 占位符";
  assert.equal(c.cleanAll(md), md);
});
