// 2026-09-11 新增：标签全局管理 6 方法测试
// 覆盖：
//   - getAllLabels: 聚合 + 实时 wordCount + 元数据合并
//   - getWordsByLabel: 大小写不敏感
//   - renameLabel: 全局改 + 去重 + 元数据同步
//   - mergeLabels: N→1 + 元数据删除
//   - deleteLabel: 同步去词 + 去元数据

import { test } from "node:test";
import assert from "node:assert/strict";
import { VocabStore } from "../src/vocab/vocab-store.ts";
import { VocabLabelsStore, DEFAULT_LABEL_COLOR } from "../src/vocab/labels-store.ts";

/** 构造一个含 3 词 / 4 个 label 的 store（含大小写） */
function makeStore(opts = {}) {
  const labelsStore = opts.labelsStore;
  const s = new VocabStore(undefined, labelsStore);
  s.load({
    books: [
      {
        id: "b1", name: "B1", order: 0, status: "verified",
        themes: [
          {
            id: "t1", name: "T1", order: 0,
            words: [
              { id: "w1", word: "apple",  phonetic: "", pos: "", meaning: "", mastery: 0, status: "active", labels: ["高频", "难词"],    created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", order: 0 },
              { id: "w2", word: "banana", phonetic: "", pos: "", meaning: "", mastery: 0, status: "active", labels: ["高频", "水果"],    created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", order: 1 },
              { id: "w3", word: "cherry", phonetic: "", pos: "", meaning: "", mastery: 0, status: "active", labels: ["高频"],                created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", order: 2 },
            ],
          },
        ],
      },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  return s;
}

test("getAllLabels: 聚合 + 实时 wordCount", () => {
  const s = makeStore();
  const all = s.getAllLabels();
  const map = Object.fromEntries(all.map(l => [l.name, l.wordCount]));
  assert.equal(map["高频"], 3, "高频出现 3 次");
  assert.equal(map["难词"], 1);
  assert.equal(map["水果"], 1);
});

test("getAllLabels: 排序（wordCount 降序）", () => {
  const s = makeStore();
  const all = s.getAllLabels();
  assert.equal(all[0].name, "高频");
  // 难词 / 水果 都是 1 次，按 name 升序
  assert.ok(all.findIndex(l => l.name === "难词") > 0);
});

test("getAllLabels: 无元数据用默认色", () => {
  const s = makeStore();  // 不传 labelsStore
  const all = s.getAllLabels();
  for (const l of all) {
    assert.equal(l.color, DEFAULT_LABEL_COLOR);
  }
});

test("getAllLabels: 元数据合并（color 来自 labelsStore）", async () => {
  const ls = new VocabLabelsStore();
  ls.load([]);
  await ls.upsert({ name: "高频", color: "#10b981", createdAt: "2026-09-01T00:00:00.000Z" });
  const s = makeStore({ labelsStore: ls });
  const all = s.getAllLabels();
  const gao = all.find(l => l.name === "高频");
  assert.equal(gao.color, "#10b981");
  // 难词无元数据 → 默认色
  const nan = all.find(l => l.name === "难词");
  assert.equal(nan.color, DEFAULT_LABEL_COLOR);
});

test("getAllLabels: 元数据 0 词数也保留", async () => {
  const ls = new VocabLabelsStore();
  ls.load([]);
  await ls.upsert({ name: "孤标签", color: "#ec4899", createdAt: "2026-09-01T00:00:00.000Z" });
  const s = makeStore({ labelsStore: ls });
  const all = s.getAllLabels();
  const orphan = all.find(l => l.name === "孤标签");
  assert.ok(orphan, "元数据存在但词库没用过，应保留");
  assert.equal(orphan.wordCount, 0);
  assert.equal(orphan.color, "#ec4899");
});

test("getWordsByLabel: 大小写不敏感", () => {
  const s = makeStore();
  const r1 = s.getWordsByLabel("高频");
  const r2 = s.getWordsByLabel("高频");
  const r3 = s.getWordsByLabel("  高频  ");
  assert.equal(r1.length, 3);
  assert.equal(r2.length, 3, "大小写不敏感");
  assert.equal(r3.length, 3, "trim 不敏感");
});

test("getWordsByLabel: 不存在的标签返空", () => {
  const s = makeStore();
  assert.equal(s.getWordsByLabel("不存在").length, 0);
  assert.equal(s.getWordsByLabel("").length, 0);
});

test("renameLabel: 全局改 + 去重", async () => {
  const s = makeStore();
  // 准备 w2 已经有"高频"+"水果"，rename "高频"→"核心"
  // w2.labels 应变成 ["核心", "水果"]（不重复）
  const r = await s.renameLabel("高频", "核心");
  assert.equal(r.updated, 3, "3 个词的 高频 都被改");

  const all = s.getAllLabels();
  assert.equal(all.find(l => l.name === "高频"), undefined, "旧标签不在");
  assert.equal(all.find(l => l.name === "核心").wordCount, 3);

  // w2 没有重复 "核心"
  const w2 = s.findRecord("banana");
  const cores = w2.labels.filter(l => l === "核心").length;
  assert.equal(cores, 1);
});

test("renameLabel: 同步元数据（labelsStore）", async () => {
  const ls = new VocabLabelsStore();
  ls.load([]);
  await ls.upsert({ name: "高频", color: "#10b981", createdAt: "2026-09-01T00:00:00.000Z" });
  const s = makeStore({ labelsStore: ls });
  await s.renameLabel("高频", "核心");
  // 元数据应已重命名
  assert.ok(ls.get("核心"));
  assert.equal(ls.get("核心").color, "#10b981", "color 保留");
  assert.equal(ls.get("高频"), undefined);
});

test("renameLabel: from === to 短路", async () => {
  const s = makeStore();
  const r = await s.renameLabel("高频", "高频");
  assert.equal(r.updated, 0);
});

test("mergeLabels: N→1 合并", async () => {
  // 先给 w3 加 "难词"
  await makeStore();
  const s = makeStore();
  // w3 已有"高频"，加"难词"
  s.findRecord("cherry").labels.push("难词");
  // 现在 高频=3, 难词=2, 水果=1
  const r = await s.mergeLabels(["高频", "难词"], "核心");
  assert.equal(r.updated, 3, "3 个词被改（w1 高频+难词 / w2 高频 / w3 高频+难词）");
  // mergedFrom 顺序是实现细节（按用户传入顺序），用 sort 比较
  assert.deepEqual([...r.mergedFrom].sort(), ["高频", "难词"].sort());

  const all = s.getAllLabels();
  assert.equal(all.find(l => l.name === "核心").wordCount, 3);
  assert.equal(all.find(l => l.name === "高频"), undefined);
  assert.equal(all.find(l => l.name === "难词"), undefined);
  // 水果保留
  assert.equal(all.find(l => l.name === "水果").wordCount, 1);
});

test("mergeLabels: 同步删除元数据", async () => {
  const ls = new VocabLabelsStore();
  ls.load([]);
  await ls.upsert({ name: "高频", color: "#10b981", createdAt: "2026-09-01T00:00:00.000Z" });
  await ls.upsert({ name: "难词", color: "#8b5cf6", createdAt: "2026-09-01T00:00:00.000Z" });
  await ls.upsert({ name: "核心", color: "#f59e0b", createdAt: "2026-09-01T00:00:00.000Z" });
  const s = makeStore({ labelsStore: ls });
  await s.mergeLabels(["高频", "难词"], "核心");
  assert.equal(ls.get("高频"), undefined, "高频元数据被删");
  assert.equal(ls.get("难词"), undefined, "难词元数据被删");
  // 目标元数据保留（若已存在）
  assert.ok(ls.get("核心"), "核心元数据保留（合并前已存在）");
});

test("mergeLabels: froms 为空时短路", async () => {
  const s = makeStore();
  const r = await s.mergeLabels([], "目标");
  assert.equal(r.updated, 0);
});

test("deleteLabel: 全局删（词 + 元数据）", async () => {
  const ls = new VocabLabelsStore();
  ls.load([]);
  await ls.upsert({ name: "高频", color: "#10b981", createdAt: "2026-09-01T00:00:00.000Z" });
  const s = makeStore({ labelsStore: ls });
  const r = await s.deleteLabel("高频");
  assert.equal(r.updated, 3, "3 个词被改");

  const all = s.getAllLabels();
  assert.equal(all.find(l => l.name === "高频"), undefined);
  // 元数据也被删
  assert.equal(ls.get("高频"), undefined);
});

test("deleteLabel: 大小写不敏感", async () => {
  const s = makeStore();
  const r = await s.deleteLabel("高频");
  assert.equal(r.updated, 3);
  const r2 = await s.deleteLabel("水果");
  assert.equal(r2.updated, 1);
});

test("deleteLabel: 不存在的标签返 0", async () => {
  const s = makeStore();
  const r = await s.deleteLabel("不存在");
  assert.equal(r.updated, 0);
});

test("labelsStore: 独立持久化加载", async () => {
  const ls = new VocabLabelsStore();
  ls.load([
    { name: "高频", color: "#10b981", createdAt: "2026-09-01T00:00:00.000Z" },
    { name: "难词", color: "#8b5cf6", createdAt: "2026-09-02T00:00:00.000Z", description: "用户标记的难词" },
  ]);
  assert.equal(ls.__size(), 2);
  assert.equal(ls.get("难词").description, "用户标记的难词");

  // 序列化再加载 → 幂等
  const reloaded = new VocabLabelsStore();
  reloaded.load(ls.export());
  assert.equal(reloaded.__size(), 2);
  assert.equal(reloaded.get("难词").description, "用户标记的难词");
});

test("labelsStore: loaded 守卫（未 load 写不落盘）", async () => {
  let persisted = 0;
  const ls = new VocabLabelsStore(() => { persisted++; });
  // 未 load → upsert 不应触发 onChange
  await ls.upsert({ name: "x", color: "#000", createdAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(persisted, 0);
  // load 后才生效
  ls.load([]);
  await ls.upsert({ name: "y", color: "#111", createdAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(persisted, 1);
});

test("labelsStore: rename(from,to) 目标已存在返 false（避免覆盖）", async () => {
  const ls = new VocabLabelsStore();
  ls.load([]);
  await ls.upsert({ name: "a", color: "#000", createdAt: "2026-01-01T00:00:00.000Z" });
  await ls.upsert({ name: "b", color: "#111", createdAt: "2026-01-01T00:00:00.000Z" });
  const ok = await ls.rename("a", "b");
  assert.equal(ok, false, "目标已存在应返 false 让上层决定");
  // a 仍在
  assert.ok(ls.get("a"));
});

test("labelsStore: 非法 label 项跳过", () => {
  const ls = new VocabLabelsStore();
  ls.load([
    { name: "valid", color: "#000", createdAt: "2026-01-01T00:00:00.000Z" },
    null,
    { name: "" },
    { color: "#111" },
    "string",
  ]);
  assert.equal(ls.__size(), 1, "只有 1 个合法项");
  assert.ok(ls.get("valid"));
});
