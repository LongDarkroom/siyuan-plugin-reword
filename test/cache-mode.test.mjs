/**
 * translate/cache.ts：多译文模式（mode）路由测试
 * ------------------------------------------------------------------
 * 同一段原文可同时缓存多种译文风格（default 直译 / concise 精简），互不污染。
 *
 * 2026-08-31：本文件原为 bilingual-concise.test.mjs；其中针对 v1「简洁版重译」
 * 按钮的用例随 v1（bilingual.ts）一并删除，桥接层用例迁至 bilingual-v2.test.mjs。
 * 此处仅保留与 cache.ts 自身相关的多 mode 路由用例。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TranslationCache } from "../src/translate/cache.ts";

/* ==================== 工具 ==================== */

/** 内存版插件桩：TranslationCache 只用到 loadData / saveData */
function makeStubPlugin() {
  const store = new Map();
  return {
    async loadData(p) { return store.get(p); },
    async saveData(p, v) { store.set(p, v); },
  };
}

/* ==================== cache.ts：mode 路由 ==================== */

test("cache: default 与 concise 同段不冲突（独立缓存区）", async () => {
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin, () => "salt-v1");
  await c.setBatch("b1", [["hello", "译:hello"]], "default");
  await c.setBatch("b1", [["hello", "简:hello"]], "concise");

  const rd = await c.getBatch("b1", ["hello"], "default");
  const rc = await c.getBatch("b1", ["hello"], "concise");
  assert.equal(rd.hits[0], "译:hello", "default 走默认译文");
  assert.equal(rc.hits[0], "简:hello", "concise 走简洁译文");
});

test("cache: 同段重写 default 译文不污染 concise（反之亦然）", async () => {
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin, () => "salt-v1");
  await c.setBatch("b1", [["hi", "旧直译"]], "default");
  await c.setBatch("b1", [["hi", "旧简译"]], "concise");
  await c.setBatch("b1", [["hi", "新直译"]], "default");
  const rd = await c.getBatch("b1", ["hi"], "default");
  const rc = await c.getBatch("b1", ["hi"], "concise");
  assert.equal(rd.hits[0], "新直译");
  assert.equal(rc.hits[0], "旧简译", "改 default 不应影响 concise");
});

test("cache: 显式 setBatch(mode=default) 落盘多 mode 形态，下次 load 仍可读", async () => {
  const plugin = makeStubPlugin();
  const c1 = new TranslationCache(plugin, () => "s");
  await c1.setBatch("b1", [["a", "译:a"]], "default");
  await c1.setBatch("b1", [["a", "简:a"]], "concise");
  // 等防抖落盘
  await new Promise((r) => setTimeout(r, 600));
  const c2 = new TranslationCache(plugin, () => "s");
  const rd = await c2.getBatch("b1", ["a"], "default");
  const rc = await c2.getBatch("b1", ["a"], "concise");
  assert.equal(rd.hits[0], "译:a");
  assert.equal(rc.hits[0], "简:a");
});

test("cache: 不同 salt 时 default/concise 都不命中（与原文 hash 解耦）", async () => {
  const plugin = makeStubPlugin();
  const c1 = new TranslationCache(plugin, () => "s1");
  await c1.setBatch("b1", [["hello", "译:hello"]], "default");
  await c1.setBatch("b1", [["hello", "简:hello"]], "concise");

  const c2 = new TranslationCache(plugin, () => "s2");
  const rd = await c2.getBatch("b1", ["hello"], "default");
  const rc = await c2.getBatch("b1", ["hello"], "concise");
  assert.equal(rd.hits[0], undefined);
  assert.equal(rc.hits[0], undefined);
});
