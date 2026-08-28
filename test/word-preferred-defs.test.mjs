// 2026-08-22 释义偏好:WordRecord.preferredDefinitions 字段 + vocab-store 入参测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { VocabStore } from "../src/vocab/vocab-store.ts";
import { WordStatus } from "../src/types.ts";

function makeStore() {
  const s = new VocabStore();
  s.load({
    books: [
      { id: "b1", name: "B1", order: 0, themes: [
        { id: "t1", name: "未分类", order: 0, words: [] },
      ] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  return s;
}

test("PreferredDefs:addWord 接受 preferredDefinitions 入参并写入 record", async () => {
  const s = makeStore();
  const r = await s.addWord("apple", {
    phonetic: "/ˈæpəl/",
    pos: "n.",
    meaning: "苹果",
    preferredDefinitions: ["苹果", "苹果似的"],
  });
  assert.equal(r.added, true);
  assert.deepEqual(r.record.preferredDefinitions, ["苹果", "苹果似的"]);
});

test("PreferredDefs:addWord 不传 preferredDefinitions 时为空数组", async () => {
  const s = makeStore();
  const r = await s.addWord("banana", { meaning: "香蕉" });
  assert.equal(r.added, true);
  assert.deepEqual(r.record.preferredDefinitions, []);
});

test("PreferredDefs:preferredDefinitions 入参被复制(防外部数组突变)", async () => {
  const s = makeStore();
  const arr = ["释义A"];
  const r = await s.addWord("cherry", { preferredDefinitions: arr });
  arr.push("外部突变");
  assert.deepEqual(r.record.preferredDefinitions, ["释义A"]);
});

test("PreferredDefs:updateWordMeta 接受 preferredDefinitions 单独更新", async () => {
  const s = makeStore();
  const r1 = await s.addWord("date", { meaning: "枣" });
  assert.deepEqual(r1.record.preferredDefinitions, []);
  await s.updateWordMeta("date", { preferredDefinitions: ["椰枣", "约会的对象"] });
  assert.deepEqual(s.findRecord("date").preferredDefinitions, ["椰枣", "约会的对象"]);
});

test("PreferredDefs:updateWordMeta 传空数组可清空偏好", async () => {
  const s = makeStore();
  await s.addWord("elder", { meaning: "接骨木果", preferredDefinitions: ["接骨木果"] });
  await s.updateWordMeta("elder", { preferredDefinitions: [] });
  assert.deepEqual(s.findRecord("elder").preferredDefinitions, []);
});

test("PreferredDefs:upsertWord 不会覆盖已有偏好(老数据保护)", async () => {
  const s = makeStore();
  // 用户已选偏好
  await s.addWord("fig", { meaning: "无花果", preferredDefinitions: ["无花果"] });
  // AI 精读再次 upsert(没传 preferredDefinitions),不应覆盖
  const r2 = await s.upsertWord("fig", { meaning: "无花果树" });
  assert.deepEqual(r2.record.preferredDefinitions, ["无花果"]);
});

test("PreferredDefs:upsertWord 首次写入时合并", async () => {
  const s = makeStore();
  await s.addWord("grape", { meaning: "葡萄" });
  // 老数据无 preferredDefinitions → 用新 meta 写入
  const r = await s.upsertWord("grape", { preferredDefinitions: ["葡萄", "葡萄藤"] });
  assert.deepEqual(r.record.preferredDefinitions, ["葡萄", "葡萄藤"]);
});

test("PreferredDefs:byWord 索引同步(增/删词后 preferredDefinitions 一致)", async () => {
  const s = makeStore();
  await s.addWord("honey", { meaning: "蜂蜜", preferredDefinitions: ["蜂蜜"] });
  assert.equal(s.__byWordIndexSizeForTest(), 1);
  await s.removeWord("honey");
  assert.equal(s.__byWordIndexSizeForTest(), 0);
});

test("PreferredDefs:老数据无 preferredDefinitions 字段:加载后视为空数组", async () => {
  // 模拟老数据(无 preferredDefinitions 字段)
  const raw = {
    books: [
      { id: "b1", name: "B1", order: 0, themes: [
        { id: "t1", name: "未分类", order: 0, words: [
          { id: "w1", word: "ink", meaning: "墨水", mastery: 0, status: WordStatus.Active, created: "2026-01-01", updated: "2026-01-01", order: 0 },
        ] },
      ] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  };
  const s = new VocabStore();
  s.load(raw);
  // 老数据 addWord → 写入新字段
  await s.addWord("ink");
  const rec = s.findRecord("ink");
  assert.ok(rec);
  assert.deepEqual(rec.preferredDefinitions, []);
});

test("PreferredDefs:持久化往返:preferredDefinitions 序列化/反序列化不丢", async () => {
  // 模拟真实持久化:vocab-store 内部只持久化 VocabStoreData,不持久化 byWord 索引等私有 Map
  // (load 时会基于 books 重建 byWord 索引)
  const s = makeStore();
  await s.addWord("jam", { meaning: "果酱", preferredDefinitions: ["果酱", "堵塞"] });
  // 真实持久化:只序列化 data 字段(VocabStore.persist() 也是只持久化 data)
  const json = JSON.parse(JSON.stringify(s.data));
  // 创建新 store 加载
  const s2 = new VocabStore();
  s2.load(json);
  const rec = s2.findRecord("jam");
  assert.ok(rec);
  assert.deepEqual(rec.preferredDefinitions, ["果酱", "堵塞"]);
});
