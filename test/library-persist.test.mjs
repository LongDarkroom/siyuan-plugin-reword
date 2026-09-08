/**
 * library-persist 安全恢复单测
 * ---------------------------------------------------------------
 * 覆盖：backupKeyOf 命名、有效数组、坏条 quarantine、主索引损坏回退 .bak、
 * 两者皆坏降级空架、首次运行不告警、save 镜像 .bak、save 指数退避重试、
 * save 最终失败上报（不再静默）。
 *
 * 运行：node --experimental-loader=./test/siyuan-stub-loader.mjs --experimental-strip-types test/library-persist.test.mjs
 * （或直接 npm test，由 run-all.mjs 自动发现）
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  loadLibraryIndex,
  saveLibraryIndex,
  backupKeyOf,
  INDEX_KEY,
  GROUPS_KEY,
} from "../src/reader/library/library-persist.ts";
import { isValidBookMeta, isValidBookGroup } from "../src/reader/library/library-types.ts";

/* ============ 通用 mock 后端 ============ */

function makeBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    async loadData(key) {
      return map.has(key) ? structuredClone(map.get(key)) : undefined;
    },
    async saveData(key, v) {
      map.set(key, structuredClone(v));
    },
  };
}

/** loadData 对指定 key 抛错（模拟主索引损坏/文件缺失但读取异常） */
function throwingBackend(throwKeys, fallback = {}) {
  const map = new Map(Object.entries(fallback));
  return {
    map,
    async loadData(key) {
      if (throwKeys.has(key)) throw new Error("corrupt: " + key);
      return map.has(key) ? structuredClone(map.get(key)) : undefined;
    },
    async saveData(key, v) {
      map.set(key, structuredClone(v));
    },
  };
}

/** saveData 前 failTimes 次抛错，之后成功（验证指数退避重试） */
function flakyBackend(failTimes) {
  let n = 0;
  const map = new Map();
  return {
    map,
    failCount: () => n,
    async loadData(key) {
      return map.has(key) ? structuredClone(map.get(key)) : undefined;
    },
    async saveData(key, v) {
      if (n < failTimes) {
        n++;
        throw new Error("write fail #" + n);
      }
      map.set(key, structuredClone(v));
    },
  };
}

const goodBook = (id) => ({
  id,
  title: "Book " + id,
  format: "epub",
  path: "/data/" + id + ".epub",
  size: 100,
  addedAt: 1,
});

const badBook = { title: "我缺 id 和 format", size: "not-a-number" };

/* ============ backupKeyOf ============ */

test("backupKeyOf：主索引键 → .bak 镜像键", () => {
  assert.equal(backupKeyOf("hiword-bookshelf.json"), "hiword-bookshelf.bak.json");
  assert.equal(backupKeyOf("hiword-bookshelf-groups.json"), "hiword-bookshelf-groups.bak.json");
});

test("backupKeyOf：非 .json 后缀兜底", () => {
  assert.equal(backupKeyOf("plain-key"), "plain-key.bak");
});

/* ============ loadLibraryIndex ============ */

test("loadLibraryIndex：合法数组原样返回，primaryFailed=false", async () => {
  const b = makeBackend({ [INDEX_KEY]: [goodBook("a"), goodBook("b")] });
  const r = await loadLibraryIndex(b, INDEX_KEY, isValidBookMeta);
  assert.equal(r.primaryFailed, false);
  assert.equal(r.recoveredFromBackup, false);
  assert.equal(r.quarantined.length, 0);
  assert.equal(r.data.length, 2);
  assert.deepEqual(r.data.map((x) => x.id), ["a", "b"]);
});

test("loadLibraryIndex：坏条被 quarantine，好条保留（绝不因一条坏数据清空整架）", async () => {
  const b = makeBackend({ [INDEX_KEY]: [goodBook("a"), badBook, goodBook("c")] });
  const r = await loadLibraryIndex(b, INDEX_KEY, isValidBookMeta);
  assert.equal(r.primaryFailed, false);
  assert.equal(r.data.length, 2, "好条应保留");
  assert.deepEqual(r.data.map((x) => x.id), ["a", "c"]);
  assert.equal(r.quarantined.length, 1, "坏条应被隔离");
});

test("loadLibraryIndex：主索引损坏 → 回退 .bak 恢复", async () => {
  const b = throwingBackend(new Set([INDEX_KEY]), {
    [backupKeyOf(INDEX_KEY)]: [goodBook("a"), goodBook("b")],
  });
  const r = await loadLibraryIndex(b, INDEX_KEY, isValidBookMeta);
  assert.equal(r.primaryFailed, true);
  assert.equal(r.recoveredFromBackup, true);
  assert.equal(r.data.length, 2, "应从 .bak 恢复全部好条");
  assert.deepEqual(r.data.map((x) => x.id), ["a", "b"]);
});

test("loadLibraryIndex：主索引损坏且 .bak 含坏条 → 恢复好条并隔离坏条", async () => {
  const b = throwingBackend(new Set([INDEX_KEY]), {
    [backupKeyOf(INDEX_KEY)]: [goodBook("a"), badBook],
  });
  const r = await loadLibraryIndex(b, INDEX_KEY, isValidBookMeta);
  assert.equal(r.recoveredFromBackup, true);
  assert.equal(r.data.length, 1);
  assert.equal(r.quarantined.length, 1);
});

test("loadLibraryIndex：主索引与 .bak 均损坏 → 降级空架（primaryFailed=true，不抛）", async () => {
  const b = throwingBackend(new Set([INDEX_KEY, backupKeyOf(INDEX_KEY)]));
  const r = await loadLibraryIndex(b, INDEX_KEY, isValidBookMeta);
  assert.equal(r.primaryFailed, true);
  assert.equal(r.recoveredFromBackup, false);
  assert.equal(r.data.length, 0, "降级为空架，绝不抛错");
});

test("loadLibraryIndex：首次运行（loadData 返回 undefined）→ 空架且不报损坏", async () => {
  const b = makeBackend({}); // 无任何键
  const r = await loadLibraryIndex(b, INDEX_KEY, isValidBookMeta);
  assert.equal(r.primaryFailed, false, "首次运行不算损坏");
  assert.equal(r.recoveredFromBackup, false);
  assert.equal(r.data.length, 0);
});

test("loadLibraryIndex：分组索引同样适用（独立键 + 校验器）", async () => {
  const groups = [
    { id: "g1", name: "小说", createdAt: 1 },
    { id: "g2", name: "技术", createdAt: 2 },
    { id: 123, name: "坏分组-id 非字符串", createdAt: 3 }, // 坏条
  ];
  const b = makeBackend({ [GROUPS_KEY]: groups });
  const r = await loadLibraryIndex(b, GROUPS_KEY, isValidBookGroup);
  assert.equal(r.data.length, 2, "好分组保留");
  assert.equal(r.quarantined.length, 1, "坏分组隔离");
});

/* ============ saveLibraryIndex ============ */

test("saveLibraryIndex：写主索引并镜像 .bak", async () => {
  const b = makeBackend({});
  const data = [goodBook("a"), goodBook("b")];
  const ok = await saveLibraryIndex(b, INDEX_KEY, data);
  assert.equal(ok, true);
  assert.deepEqual(b.map.get(INDEX_KEY), data);
  assert.deepEqual(b.map.get(backupKeyOf(INDEX_KEY)), data, "应镜像 .bak");
});

test("saveLibraryIndex：写失败前 3 次后成功 → 重试成功（指数退避）", async () => {
  const b = flakyBackend(3); // 第 1/2/3 次失败，第 4 次（attempt=3）成功
  const data = [goodBook("a")];
  const ok = await saveLibraryIndex(b, INDEX_KEY, data);
  assert.equal(ok, true, "重试后写入成功");
  assert.equal(b.failCount(), 3, "应恰好失败 3 次后在第 4 次成功");
  assert.deepEqual(b.map.get(INDEX_KEY), data);
});

test("saveLibraryIndex：持续失败（超过 3 次重试）→ 返回 false 并触发 onError 上报（不再静默）", async () => {
  const b = flakyBackend(99); // 永远失败
  let reported = null;
  const ok = await saveLibraryIndex(b, INDEX_KEY, [goodBook("a")], (e) => {
    reported = e;
  });
  assert.equal(ok, false, "最终失败应返回 false");
  assert.ok(reported instanceof Error, "应通过 onError 上报（不再静默吞掉）");
});

test("saveLibraryIndex：.bak 镜像失败不计入主索引失败", async () => {
  // 主索引写入成功，但 .bak 写入抛错 —— 主索引仍算成功
  const map = new Map();
  const b = {
    async loadData(key) {
      return map.has(key) ? structuredClone(map.get(key)) : undefined;
    },
    async saveData(key, v) {
      if (key.endsWith(".bak.json")) throw new Error("bak write fail");
      map.set(key, structuredClone(v));
    },
  };
  const ok = await saveLibraryIndex(b, INDEX_KEY, [goodBook("a")]);
  assert.equal(ok, true, "主索引成功即视为成功，备份失败不阻断");
  assert.deepEqual(map.get(INDEX_KEY), [goodBook("a")]);
});
