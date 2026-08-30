import { test } from "node:test";
import assert from "node:assert/strict";
import { bookFingerprint } from "../src/reader/book-fingerprint.ts";
import { TranslationCache } from "../src/translate/cache.ts";

/* ============ 内容指纹 bookId ============ */

test("bookFingerprint 确定性：同输入同输出", () => {
  const a = { identifier: "isbn-123", title: "A", author: "X", size: 100, format: "epub" };
  assert.equal(bookFingerprint(a), bookFingerprint({ ...a }));
});

test("bookFingerprint：同 identifier 不同文件名也同 id（删除重导复用同一缓存）", () => {
  const a = bookFingerprint({ identifier: "isbn-123", title: "A", author: "X", size: 100, format: "epub" });
  const b = bookFingerprint({ identifier: "isbn-123", title: "Renamed Name", author: "X", size: 100, format: "epub" });
  assert.equal(a, b, "同一实体书（identifier 相同）必须得到同一 id，否则会生成多份缓存");
});

test("bookFingerprint：不同 identifier → 不同 id", () => {
  const a = bookFingerprint({ identifier: "id-1", title: "A", author: "X", size: 100, format: "epub" });
  const b = bookFingerprint({ identifier: "id-2", title: "A", author: "X", size: 100, format: "epub" });
  assert.notEqual(a, b);
});

test("bookFingerprint：无 identifier 时回退 title+author", () => {
  const a = bookFingerprint({ title: "A", author: "X", size: 100, format: "epub" });
  const b = bookFingerprint({ title: "A", author: "X", size: 100, format: "epub" });
  assert.equal(a, b);
  const c = bookFingerprint({ title: "B", author: "X", size: 100, format: "epub" });
  assert.notEqual(a, c, "不同书名应得到不同 id");
});

test("bookFingerprint：不同 size → 不同 id（去歧义）", () => {
  const a = bookFingerprint({ identifier: "id-1", title: "A", author: "X", size: 100, format: "epub" });
  const b = bookFingerprint({ identifier: "id-1", title: "A", author: "X", size: 200, format: "epub" });
  assert.notEqual(a, b);
});

test("bookFingerprint：不同 format → 不同 id", () => {
  const a = bookFingerprint({ identifier: "id-1", title: "A", author: "X", size: 100, format: "epub" });
  const b = bookFingerprint({ identifier: "id-1", title: "A", author: "X", size: 100, format: "pdf" });
  assert.notEqual(a, b);
});

/* ============ 孤儿缓存清理 ============ */

function makeCachePluginMock() {
  const store = new Map();
  const removed = [];
  return {
    store,
    removed,
    async loadData(p) {
      return store.has(p) ? store.get(p) : undefined;
    },
    async saveData(p, v) {
      store.set(p, v);
      return true;
    },
    async removeData(p) {
      if (store.has(p)) {
        store.delete(p);
        removed.push(p);
      }
      return true;
    },
  };
}

test("cleanOrphanCaches：仅清书架不存在的 id，保留在读书籍", async () => {
  const plugin = makeCachePluginMock();
  const cache = new TranslationCache(plugin, () => "salt");

  // 预置 4 本有缓存的书籍（2 本在书架、2 本孤儿）
  await cache.recordSections("valid1", [1, 2], "Book A");
  await cache.recordSections("valid2", [3], "Book B");
  await cache.recordSections("orphan1", [4], "Book C");
  await cache.recordSections("orphan2", [5], "Book D");

  // 预置孤儿1的落盘文件，验证 clear/clearFix 真的删文件
  plugin.store.set("translations/orphan1.json", { default: { x: "y" } });
  plugin.store.set("translations/orphan1.meta.json", { sections: [4] });
  plugin.store.set("translations/orphan1.fix.json", { k: { tr: "z", ts: 1 } });

  const removed = await cache.cleanOrphanCaches(new Set(["valid1", "valid2"]));
  assert.equal(removed, 2, "应清理 2 份孤儿缓存");

  // 下拉只剩在读书籍
  const list = await cache.listCachedBooks();
  assert.equal(list.length, 2);
  assert.deepEqual(new Set(list.map((b) => b.bookId)), new Set(["valid1", "valid2"]));

  // 孤儿1 的三种缓存文件均被删除
  assert.ok(plugin.removed.includes("translations/orphan1.json"), "应删除 .json");
  assert.ok(plugin.removed.includes("translations/orphan1.meta.json"), "应删除 .meta.json");
  assert.ok(plugin.removed.includes("translations/orphan1.fix.json"), "应删除 .fix.json");

  // 在读书籍（valid1/valid2）的缓存文件绝不可被清掉
  const touchedValid = plugin.removed.some(
    (p) => p.includes("valid1") || p.includes("valid2")
  );
  assert.equal(touchedValid, false, "在读书籍缓存不可误删");
});

test("cleanOrphanCaches：无孤儿时返回 0", async () => {
  const plugin = makeCachePluginMock();
  const cache = new TranslationCache(plugin, () => "salt");
  await cache.recordSections("v1", [1], "A");
  await cache.recordSections("v2", [2], "B");
  const removed = await cache.cleanOrphanCaches(new Set(["v1", "v2"]));
  assert.equal(removed, 0);
});
