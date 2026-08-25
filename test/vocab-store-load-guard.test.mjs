// 词库 loaded 守卫测试（2026-08-23 修复词库丢失根因）
// ----------------------------------------------------------------
// 覆盖：
// - new VocabStore() 后 loaded=false（默认未加载）
// - load() 后 loaded=true（无论 valid 与否）
// - persist() 在 loaded=false 时不调 onChange（守卫生效）
// - addWord 在 loaded=false 时不调 onChange（守卫级联）
// - __forcePersistForMigration 强制 loaded=true 后 persist 正常写盘
// - 两个 VocabStore 实例互不影响各自 loaded 状态（热重载场景）
// 不依赖：annotation / reader / ai / dict

import { test } from "node:test";
import assert from "node:assert/strict";
import { VocabStore } from "../src/vocab/vocab-store.ts";

function makeValidData() {
  return {
    books: [
      { id: "b1", name: "B1", order: 0, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  };
}

test("new VocabStore() 后 loaded=false（默认未加载）", () => {
  const store = new VocabStore();
  assert.equal(store.__isLoaded(), false);
});

test("load() 后 loaded=true（valid 数据）", () => {
  const store = new VocabStore();
  store.load(makeValidData());
  assert.equal(store.__isLoaded(), true);
});

test("load() 后 loaded=true（null 数据：首次安装场景）", () => {
  const store = new VocabStore();
  store.load(null);
  assert.equal(store.__isLoaded(), true);
});

test("load() 后 loaded=true（损坏数据）", () => {
  const store = new VocabStore();
  store.load("not an object");
  assert.equal(store.__isLoaded(), true);
});

test("persist 在 loaded=false 时不调 onChange（核心守卫）", async () => {
  const store = new VocabStore();
  let onChangeCalls = 0;
  store.onChange = () => { onChangeCalls++; };
  // 此时 loaded=false
  // 调 export（不会触发 persist 本身，但 saveVocab 路径会）
  store.export();
  // 直接通过 saveVocab 路径（saveVocab 调 export() + persistVocab.update；此处只测 persist）
  // 内部 persist() 是 private,通过 addWord 间接调
  await store.addWord("hello");
  assert.equal(onChangeCalls, 0, "loaded=false 时 onChange 不应被调用");
  // 同时验证 __isLoaded 仍为 false
  assert.equal(store.__isLoaded(), false);
});

test("load() 后 addWord 调 onChange 正常（行为不变）", async () => {
  const store = new VocabStore();
  let onChangeCalls = 0;
  store.onChange = () => { onChangeCalls++; };
  store.load(makeValidData());
  await store.addWord("hello");
  assert.equal(onChangeCalls, 1, "loaded=true 后 addWord 应正常触发 onChange");
  assert.equal(store.__isLoaded(), true);
});

test("__forcePersistForMigration 强制 loaded=true 后 persist 写盘", async () => {
  const store = new VocabStore();
  let onChangeCalls = 0;
  store.onChange = () => { onChangeCalls++; };
  // 此时 loaded=false,正常 addWord 不会写盘
  await store.addWord("orphan");
  assert.equal(onChangeCalls, 0);
  // 运维场景:用户已丢数据,运维修复;强制 loaded=true 并 persist
  await store.__forcePersistForMigration();
  assert.equal(onChangeCalls, 1, "强制入口应触发 onChange");
  assert.equal(store.__isLoaded(), true);
});

test("两个 VocabStore 实例互不影响各自 loaded 状态（热重载场景）", () => {
  const a = new VocabStore();
  const b = new VocabStore();
  a.load(makeValidData());
  assert.equal(a.__isLoaded(), true);
  assert.equal(b.__isLoaded(), false, "实例 b 不应受 a load 影响");
  b.load(null);
  assert.equal(b.__isLoaded(), true);
});

test("load() 同步设置 loaded,不会有时序中间态", () => {
  // 验证 load() 期间不会暂时出现"data 已赋值但 loaded=false"的情况
  const store = new VocabStore();
  // 模拟 load 之前的读取
  assert.equal(store.__isLoaded(), false);
  store.load(makeValidData());
  // load() 返回后立即可读 loaded
  assert.equal(store.__isLoaded(), true);
});
