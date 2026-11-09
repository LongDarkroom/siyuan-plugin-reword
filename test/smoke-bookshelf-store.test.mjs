/**
 * 冒烟测试 · 书架 store 行为契约（阶段 0 新增）
 * ----------------------------------------------------------------
 * 为什么加这个：阅读器拆成独立插件后，书架是**新插件自己的数据**
 * （hiword-bookshelf.json 留在阅读器侧）。切分时若 store 的读写、分组、
 * 进度/时长累加任一环节坏掉，用户会「书还在但进度没了 / 分组丢了」。
 * 这里用内存 plugin 存根跑真实调用，把契约钉住。
 *
 * 覆盖：
 *  - load 从 plugin.loadData 读入；list 按最近阅读排序
 *  - saveProgress 写进度 + 自动流转阅读状态（读完 / 在读）
 *  - addReadingTime 累加总量 + 按本地日期分桶（阅读热力图数据源）
 *  - getProgress / get 按 id 取回
 *  - 分组：create / rename / 书籍归组
 *  - removeBook 后列表移除
 *  - 坏条隔离：非数组 bookmarks 的条目被丢弃，其余保留（安全恢复）
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { BookshelfStore } = await import("../src/reader/bookshelf-store.ts");

/** 内存 plugin 存根：只实现 loadData / saveData，够书架索引用 */
function mkPlugin(initial = {}) {
  const mem = new Map(Object.entries(initial));
  return {
    mem,
    async loadData(k) {
      return mem.get(k);
    },
    async saveData(k, v) {
      mem.set(k, JSON.parse(JSON.stringify(v)));
    },
  };
}

/** 合法书籍条目（对齐 isValidBookMeta 的必填字段） */
function mkBook(id, over = {}) {
  return {
    id,
    title: `Book ${id}`,
    format: "epub",
    path: `/data/${id}.epub`,
    size: 1024,
    addedAt: 1_700_000_000_000,
    ...over,
  };
}

test("冒烟·书架 load 能读出书籍并按最近阅读排序", async () => {
  const plugin = mkPlugin({
    "hiword-bookshelf.json": [mkBook("b1", { addedAt: 100 }), mkBook("b2", { addedAt: 200, lastReadAt: 999 })],
  });
  const store = new BookshelfStore(plugin);
  await store.load();
  const list = store.list;
  assert.equal(list.length, 2, "应读出 2 本书");
  assert.equal(list[0].id, "b2", "最近读过的应排最前");
  assert.equal(store.get("b1").title, "Book b1", "get 应按 id 取回");
});

test("冒烟·saveProgress 写进度并自动流转阅读状态", async () => {
  const plugin = mkPlugin({ "hiword-bookshelf.json": [mkBook("b1")] });
  const store = new BookshelfStore(plugin);
  await store.load();

  // 读到 40% → 在读
  await store.saveProgress("b1", { fraction: 0.4, cfi: "epubcfi(/6/2)" });
  let meta = store.get("b1");
  assert.equal(meta.status, "reading", "读到 40% 应自动置「在读」");
  assert.equal(store.getProgress("b1").fraction, 0.4);
  assert.equal(store.getProgress("b1").cfi, "epubcfi(/6/2)", "cfi 应被保存");
  assert.ok(meta.lastReadAt > 0, "应更新 lastReadAt");

  // 读到 99.5%+ → 读完
  await store.saveProgress("b1", { fraction: 0.999 });
  meta = store.get("b1");
  assert.equal(meta.status, "finished", "读到 99.5%+ 应自动置「读完」");
});

test("冒烟·addReadingTime 累加总量并按日期分桶", async () => {
  const plugin = mkPlugin({ "hiword-bookshelf.json": [mkBook("b1")] });
  const store = new BookshelfStore(plugin);
  await store.load();

  await store.addReadingTime("b1", 60_000, "2026-10-01");
  await store.addReadingTime("b1", 30_000, "2026-10-01");
  await store.addReadingTime("b1", 45_000, "2026-10-02");

  const meta = store.get("b1");
  assert.equal(meta.readingTimeMs, 135_000, "总时长应为三次累加");
  assert.equal(meta.readingLog["2026-10-01"], 90_000, "同日应合并进同一桶");
  assert.equal(meta.readingLog["2026-10-02"], 45_000, "不同日应独立分桶");
});

test("冒烟·addReadingTime 对不存在的书与非法时长静默忽略", async () => {
  const plugin = mkPlugin({ "hiword-bookshelf.json": [mkBook("b1")] });
  const store = new BookshelfStore(plugin);
  await store.load();
  await store.addReadingTime("nope", 1000, "2026-10-01");
  await store.addReadingTime("b1", 0, "2026-10-01");
  await store.addReadingTime("b1", -5, "2026-10-01");
  assert.equal(store.get("b1").readingTimeMs, undefined, "非法时长不应写入");
});

test("冒烟·分组：创建 → 书籍归组 → 重命名", async () => {
  const plugin = mkPlugin({ "hiword-bookshelf.json": [mkBook("b1"), mkBook("b2")] });
  const store = new BookshelfStore(plugin);
  await store.load();

  const g = await store.createGroup("英文小说");
  assert.ok(g && g.id, "createGroup 应返回带 id 的分组");
  assert.equal(g.name, "英文小说");

  const ok = await store.setGroup("b1", g.id);
  assert.equal(ok, true, "b1 归组应成功");
  assert.equal(store.get("b1").groupId, g.id, "书籍应记下分组 id");

  assert.equal(await store.renameGroup(g.id, "文学"), true, "重命名应成功");
  assert.equal(await store.createGroup(""), null, "空名分组应被拒绝");
});

test("冒烟·removeBook 后书籍从列表移除", async () => {
  const plugin = mkPlugin({ "hiword-bookshelf.json": [mkBook("b1"), mkBook("b2")] });
  const store = new BookshelfStore(plugin);
  await store.load();
  await store.removeBook("b1");
  const list = store.list;
  assert.equal(list.length, 1, "移除后应只剩 1 本");
  assert.equal(list[0].id, "b2");
  assert.equal(store.get("b1"), undefined, "被移除的书不应再取到");
});

test("冒烟·坏条隔离：非数组 bookmarks 的条目被丢弃，其余保留", async () => {
  const plugin = mkPlugin({
    "hiword-bookshelf.json": [
      mkBook("good1"),
      { ...mkBook("bad"), bookmarks: "not-an-array" }, // 损坏：bookmarks 应为数组
      mkBook("good2"),
    ],
  });
  const store = new BookshelfStore(plugin);
  await store.load();
  const ids = store.list.map((b) => b.id).sort();
  assert.deepEqual(ids, ["good1", "good2"], "仅坏条被隔离，好条应保留");
});

test("冒烟·重复 load 幂等（不重复叠加数据）", async () => {
  const plugin = mkPlugin({ "hiword-bookshelf.json": [mkBook("b1")] });
  const store = new BookshelfStore(plugin);
  await store.load();
  await store.load();
  await store.load();
  assert.equal(store.list.length, 1, "多次 load 不应产生重复条目");
});
