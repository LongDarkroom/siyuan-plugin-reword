import test from "node:test";
import assert from "node:assert/strict";
import { AnnotationStore } from "../src/annotation/annotation-store.ts";

const mkItem = (over = {}) => ({
  id: "ann-1",
  blockId: "blk-1",
  docId: "doc-1",
  sentence: "The quick brown fox.",
  selectedText: "fox",
  note: "my note",
  origin: "manual",
  createdAt: "2026-08-13T10:00:00.000Z",
  updatedAt: "2026-08-13T10:00:00.000Z",
  ...over,
});

test("cleanIal：剥离 note 中的裸 IAL 并返回清理条数", async () => {
  const store = new AnnotationStore();
  store.load({
    annotations: [
      mkItem({ id: "a", note: '{.: id="20260818-abc" updated="20260818"}我的备注内容' }),
      mkItem({ id: "b", note: "normal note" }),
    ],
  });
  const cleaned = await store.cleanIal();
  assert.equal(cleaned, 1, "仅含 IAL 的那条被清理");
  const a = store.get("a");
  assert.ok(a, "a 仍在库");
  assert.equal(a.note, "我的备注内容", "IAL 已从 note 移除，真实内容保留");
  const b = store.get("b");
  assert.equal(b.note, "normal note", "无 IAL 的 note 不变");
});

test("cleanIal：剥离 sentence / selectedText 中的 IAL 并重建去重索引", async () => {
  const store = new AnnotationStore();
  store.load({
    annotations: [
      mkItem({ id: "c", sentence: "{: .src}原文句子", selectedText: "{: .sel}选中" }),
    ],
  });
  const cleaned = await store.cleanIal();
  assert.equal(cleaned, 1);
  const c = store.get("c");
  assert.equal(c.sentence, "原文句子", "sentence 的 IAL 已移除");
  assert.equal(c.selectedText, "选中", "selectedText 的 IAL 已移除");
  // 去重索引可用：用清洗后的 sentence/selectedText 能命中
  assert.ok(store.exists("blk-1", "原文句子", "选中"), "清洗后去重键可命中");
});

test("cleanIal：无 IAL 数据时返回 0 且不产生脏写入（version 不变）", async () => {
  const store = new AnnotationStore();
  store.load({ annotations: [mkItem({ id: "d", version: 3 })] });
  const cleaned = await store.cleanIal();
  assert.equal(cleaned, 0);
  assert.equal(store.get("d").version, 3, "version 不应变化");
});
