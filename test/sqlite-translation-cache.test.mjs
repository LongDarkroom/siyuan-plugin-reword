/**
 * Phase 2：译文缓存 SQLite 层 + 集成回归（2026-08-31）
 *
 * 覆盖：
 *  - translationKey 格式
 *  - 未配置归档文档时，SQLite 层整体静默跳过（不抛错、不污染主流程）
 *  - TranslationCache 在 SQLite 不可用时，getBatch / setBatch / deleteOne / size
 *    行为与 Phase 2 之前完全一致（这是最重要的零回归保证）
 *  - 内容编解码往返（块内换行转义），保证译文可原样取回
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TranslationCache } from "../src/translate/cache.ts";
import {
  getTranslationArchiveDoc,
  isSqliteCacheReady,
  setTranslationArchiveDoc,
  sqliteGetBatch,
  sqliteSetBatch,
  translationKey,
} from "../src/translate/sqlite-cache.ts";

function makeStubPlugin() {
  const store = new Map();
  return {
    async loadData(p) { return store.get(p); },
    async saveData(p, v) { store.set(p, v); },
    async removeData(p) { store.delete(p); },
    _store: store,
  };
}

/* ==================== 检索键 ==================== */

test("sqlite: translationKey 由 bookId|mode|hash 组成", () => {
  assert.equal(translationKey("b1", "default", "abc123"), "b1|default|abc123");
  assert.equal(translationKey("b1", "concise", "abc123"), "b1|concise|abc123");
  assert.notEqual(
    translationKey("b1", "default", "x"),
    translationKey("b2", "default", "x"),
    "不同书必须产生不同 key"
  );
});

/* ==================== 未配置时静默跳过 ==================== */

test("sqlite: 未配置归档文档时 isSqliteCacheReady 为 false", () => {
  setTranslationArchiveDoc("");
  assert.equal(getTranslationArchiveDoc(), "");
  assert.equal(isSqliteCacheReady(), false);
});

test("sqlite: 不可用时 getBatch 返回空 Map 且不抛错", async () => {
  setTranslationArchiveDoc("");
  const out = await sqliteGetBatch(["b1|default|a", "b1|default|b"]);
  assert.equal(out.size, 0);
});

test("sqlite: 不可用时 setBatch / deleteKeys 静默 no-op", async () => {
  setTranslationArchiveDoc("");
  await sqliteSetBatch([["k", "译文"]], { bookId: "b1", mode: "default" });
  const { sqliteDeleteKeys } = await import("../src/translate/sqlite-cache.ts");
  await sqliteDeleteKeys(["k"]);
  // 走到这里没抛错即通过
  assert.ok(true);
});

/* ==================== 零回归：TranslationCache 行为不变 ==================== */

test("cache: SQLite 不可用时 getBatch 命中/未命中与之前一致", async () => {
  setTranslationArchiveDoc("");
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin, () => "salt");
  await c.setBatch("b1", [["hello", "你好"], ["world", "世界"]]);

  const r = await c.getBatch("b1", ["hello", "world", "missing"]);
  assert.equal(r.hits[0], "你好");
  assert.equal(r.hits[1], "世界");
  assert.deepEqual(r.misses, [2], "未缓存项应落在 misses");
  assert.deepEqual(r.fromCache, [true, true, false]);
});

test("cache: 换 salt 后旧缓存失效（提示词改版不串味）", async () => {
  setTranslationArchiveDoc("");
  const plugin = makeStubPlugin();
  const c1 = new TranslationCache(plugin, () => "s1");
  await c1.setBatch("b1", [["hello", "译A"]]);

  const c2 = new TranslationCache(plugin, () => "s2");
  const r = await c2.getBatch("b1", ["hello"]);
  assert.equal(r.hits[0], undefined, "salt 变化后不应命中");
  assert.deepEqual(r.misses, [0]);
});

test("cache: default / concise 双 mode 互不污染", async () => {
  setTranslationArchiveDoc("");
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin, () => "salt");
  await c.setBatch("b1", [["x", "直译"]], "default");
  await c.setBatch("b1", [["x", "精简"]], "concise");

  const rd = await c.getBatch("b1", ["x"], "default");
  const rc = await c.getBatch("b1", ["x"], "concise");
  assert.equal(rd.hits[0], "直译");
  assert.equal(rc.hits[0], "精简");
});

test("cache: deleteOne 后该条不再命中", async () => {
  setTranslationArchiveDoc("");
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin, () => "salt");
  await c.setBatch("b1", [["a", "译A"], ["b", "译B"]]);
  await c.deleteOne("b1", "a");

  const r = await c.getBatch("b1", ["a", "b"]);
  assert.equal(r.hits[0], undefined, "已删除项不应命中");
  assert.equal(r.hits[1], "译B");
});

test("cache: size 按 mode 统计", async () => {
  setTranslationArchiveDoc("");
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin, () => "salt");
  await c.setBatch("b1", [["a", "A"], ["b", "B"]], "default");
  await c.setBatch("b1", [["a", "A2"]], "concise");
  assert.equal(await c.size("b1", "default"), 2);
  assert.equal(await c.size("b1", "concise"), 1);
});

test("cache: clear 清空该书缓存", async () => {
  setTranslationArchiveDoc("");
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin, () => "salt");
  await c.setBatch("b1", [["a", "A"]]);
  await c.clear("b1");
  const r = await c.getBatch("b1", ["a"]);
  assert.equal(r.hits[0], undefined);
});

/* ==================== 内容编解码（通过公开行为间接验证） ==================== */

test("cache: 译文含换行时仍可原样取回", async () => {
  setTranslationArchiveDoc("");
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin, () => "salt");
  const multi = "第一行\n\n第二行";
  await c.setBatch("b1", [[multi, "译文一\n\n译文二"]]);
  const got = await c.getOne("b1", multi);
  assert.equal(got, "译文一\n\n译文二", "多行译文不应被破坏");
});

test("cache: 译文含单引号/特殊字符不破坏流程", async () => {
  setTranslationArchiveDoc("");
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin, () => "salt");
  const tricky = "It's a \"test\" — 100%";
  await c.setBatch("b1", [[tricky, "这是 '测试' \"引号\""]]);
  const got = await c.getOne("b1", tricky);
  assert.equal(got, "这是 '测试' \"引号\"");
});
