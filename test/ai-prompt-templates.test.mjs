import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PromptTemplateStore,
  normalizeTemplate,
  buildDefaultTemplates,
} from "../src/ai/ai-prompt-templates.ts";

function makeStore() {
  const calls = { n: 0 };
  const store = new PromptTemplateStore(() => { calls.n++; });
  return { store, calls };
}

test("normalizeTemplate: 容错补齐字段", () => {
  const t = normalizeTemplate({ id: "t1", name: "模板" });
  assert.equal(t.id, "t1");
  assert.equal(t.name, "模板");
  assert.equal(t.content, "");
});

test("load: 空数据创建默认模板", () => {
  const { store } = makeStore();
  store.load(null);
  assert.ok(store.list().length >= 1);
});

test("upsert: 新增 + 更新", async () => {
  const { store, calls } = makeStore();
  store.load(null);
  const n0 = store.list().length;
  const t = await store.upsert({ name: "自定义", content: "你是助手" });
  assert.ok(t.id);
  assert.equal(store.list().length, n0 + 1);
  assert.ok(calls.n >= 1);

  const updated = await store.upsert({ id: t.id, name: "改名", content: "新的内容" });
  assert.equal(updated.name, "改名");
  assert.equal(updated.content, "新的内容");
  assert.equal(store.list().length, n0 + 1, "更新不应新增");
});

test("remove: 删除存在条目", async () => {
  const { store } = makeStore();
  store.load(null);
  const t = store.list()[0];
  const ok = await store.remove(t.id);
  assert.equal(ok, true);
  assert.equal(store.get(t.id), undefined);
});

test("buildDefaultTemplates: 至少一个默认模板", () => {
  const list = buildDefaultTemplates();
  assert.ok(list.length >= 1);
  assert.ok(list[0].name && list[0].content);
});
