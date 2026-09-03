import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AiPresetStore,
  normalizePreset,
} from "../src/ai/ai-preset.ts";

function makeStore() {
  const calls = { n: 0 };
  const store = new AiPresetStore(() => { calls.n++; });
  return { store, calls };
}

test("normalizePreset: 容错补齐缺省字段", () => {
  const p = normalizePreset({ id: "p1", name: "测试" });
  assert.equal(p.id, "p1");
  assert.equal(p.name, "测试");
  assert.equal(p.contextMessages, -1);
  assert.equal(p.temperature, 0.3);
  assert.equal(p.temperatureEnabled, false);
  assert.equal(p.autoCollectWords, false);
  assert.equal(p.autoAnnotateSentences, false);
});

test("normalizePreset: 非法值限幅", () => {
  const p = normalizePreset({ contextMessages: 999, temperature: 99 });
  assert.equal(p.contextMessages, 100);
  assert.equal(p.temperature, 2);
});

test("load: 空数据保持空（2026-08-16 不再自动播种默认预设）", () => {
  const { store } = makeStore();
  store.load(null);
  assert.equal(store.list().length, 0);
  assert.equal(store.getActive(), undefined);
});

test("upsert: 新增 + 更新 + 触发 onChange", async () => {
  const { store, calls } = makeStore();
  store.load(null);
  const p = await store.upsert({ name: "新预设" });
  assert.ok(p.id);
  assert.equal(store.list().length, 1);
  assert.ok(calls.n >= 1);

  const updated = await store.upsert({ id: p.id, name: "改名", temperature: 0.8 });
  assert.equal(updated.name, "改名");
  assert.equal(updated.temperature, 0.8);
  assert.equal(store.list().length, 1, "更新不应新增条目");
});

test("remove + setActive", async () => {
  const { store } = makeStore();
  store.load(null);
  const a = await store.upsert({ name: "预设 A" });
  const b = await store.upsert({ name: "预设 B" });
  await store.setActive(a.id);
  assert.equal(store.getActive()?.id, a.id);
  await store.setActive(b.id);
  await store.remove(a.id);
  assert.equal(store.getActive()?.id, b.id, "删除非激活项不应切换激活");
  // 删除所有预设后，active 应回到空
  await store.remove(b.id);
  assert.equal(store.list().length, 0);
  assert.equal(store.getActive(), undefined, "删完所有预设后 active 归空");
});
