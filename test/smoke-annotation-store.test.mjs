/**
 * 冒烟测试 · 批注 store 行为契约（阶段 0 新增）
 * ----------------------------------------------------------------
 * 为什么加这个：阅读器独立插件化切分后，批注模块**留在主插件**，阅读器经 bridge
 * 跨插件读写。这是切分后最易断裂的一条链路 —— 桥若读错字段 / 筛错 bookId，
 * 用户会看到「阅读器里画的批注在微阅批注面板里不出现」。
 * 故在切分前把「写 → 读 → 按书籍筛 → 软删」这条主链路钉住。
 *
 * 覆盖（真实调用，非 grep 源码）：
 *  - upsert 新增 / 同 id 更新（幂等，不产生重复条）
 *  - getByBook 按 bookId 精确隔离
 *  - isReading：带 bookId 即阅读批注（工作台/面板的筛选依据）
 *  - matchBookType：BookType 筛选（pdf/epub/other 区分来源）
 *  - remove 软删后 getAll 不再返回，但 getByBook 也不应命中
 *  - onChange 回调被触发（bridge 靠它推送变更通知）
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { AnnotationStore, isReading } = await import("../src/annotation/annotation-store.ts");
const { matchBookType, bookTypeFromFormat } = await import("../src/reader/reader-mode.ts");

/** 最小可用批注输入 */
function mkInput(overrides = {}) {
  return {
    blockId: "book:b1",
    docId: "b1",
    bookId: "b1",
    cfi: "epubcfi(/6/4!/4/2)",
    sentence: "The quick brown fox jumps over the lazy dog.",
    selectedText: "quick brown fox",
    note: "注意这个短语",
    ...overrides,
  };
}

test("冒烟·批注 upsert 新增后可读回", async () => {
  const store = new AnnotationStore(() => {});
  const ann = await store.upsert(mkInput());
  assert.ok(ann.id, "upsert 应返回带 id 的批注");
  const all = store.getAll();
  assert.equal(all.length, 1, "应有 1 条批注");
  assert.equal(all[0].selectedText, "quick brown fox");
  assert.equal(all[0].bookId, "b1", "bookId 应被保留（阅读器经 bridge 定位书籍靠它）");
  assert.equal(all[0].cfi, "epubcfi(/6/4!/4/2)", "cfi 应被保留（foliate 坐标锚点）");
});

test("冒烟·批注同 id upsert 是更新而非新增（bridge 幂等写）", async () => {
  const store = new AnnotationStore(() => {});
  const a = await store.upsert(mkInput());
  const b = await store.upsert({ ...mkInput(), note: "改过的笔记" });
  assert.equal(a.id, b.id, "同一输入应复用同一条记录");
  assert.equal(store.getAll().length, 1, "不应产生重复条目");
  assert.equal(store.getAll()[0].note, "改过的笔记", "应更新为新内容");
});

test("冒烟·getByBook 按 bookId 精确隔离多本书", async () => {
  const store = new AnnotationStore(() => {});
  await store.upsert(mkInput({ bookId: "b1", docId: "b1", blockId: "book:b1" }));
  await store.upsert(mkInput({ bookId: "b2", docId: "b2", blockId: "book:b2", selectedText: "lazy dog" }));
  const r1 = store.getByBook("b1");
  const r2 = store.getByBook("b2");
  assert.equal(r1.length, 1, "b1 应只有自己的 1 条");
  assert.equal(r2.length, 1, "b2 应只有自己的 1 条");
  assert.equal(r1[0].bookId, "b1");
  assert.equal(r2[0].bookId, "b2");
  assert.equal(r1[0].selectedText, "quick brown fox");
  assert.equal(r2[0].selectedText, "lazy dog", "不应串书");
});

test("冒烟·isReading：带 bookId 即阅读批注（思源块批注不带）", async () => {
  const store = new AnnotationStore(() => {});
  await store.upsert(mkInput({ bookId: "b1", docId: "b1", blockId: "book:b1" }));
  // 思源正文块批注：无 bookId
  await store.upsert({
    blockId: "20260101-abcdef",
    docId: "20260101",
    sentence: "正文里的句子。",
    selectedText: "正文",
    note: "",
  });
  const all = store.getAll();
  const reading = all.filter(isReading);
  assert.equal(all.length, 2, "共 2 条");
  assert.equal(reading.length, 1, "仅带 bookId 的一条算阅读批注");
  assert.equal(reading[0].bookId, "b1");
});

test("冒烟·BookType 筛选：pdf/epub/other 区分书籍来源", () => {
  assert.equal(bookTypeFromFormat("pdf"), "pdf");
  assert.equal(bookTypeFromFormat("epub"), "epub");
  assert.equal(bookTypeFromFormat("mobi"), "other");
  assert.equal(bookTypeFromFormat(null), "other");
  // 未标注 bookType 的条目应匹配任意当前书籍（老数据兼容）
  assert.equal(matchBookType(undefined, "pdf"), true);
  assert.equal(matchBookType(undefined, "epub"), true);
  // 已标注的必须严格相等
  assert.equal(matchBookType("pdf", "pdf"), true);
  assert.equal(matchBookType("pdf", "epub"), false);
  assert.equal(matchBookType("epub", "pdf"), false);
  assert.equal(matchBookType("other", "pdf"), false);
});

test("冒烟·remove 后 getAll 与 getByBook 均不再返回（bridge 删写一致性）", async () => {
  const store = new AnnotationStore(() => {});
  const a = await store.upsert(mkInput());
  assert.equal(store.getAll().length, 1);
  const ok = await store.remove(a.id);
  assert.equal(ok, true, "remove 应返回成功");
  assert.equal(store.getAll().length, 0, "getAll 不应再返回");
  assert.equal(store.getByBook("b1").length, 0, "getByBook 不应再返回");
});

test("冒烟·onChange 回调在写入时触发（bridge 推送变更的依据）", async () => {
  let changed = 0;
  const store = new AnnotationStore(() => {
    changed += 1;
  });
  await store.upsert(mkInput());
  assert.ok(changed > 0, "upsert 应触发 onChange（bridge 靠它通知阅读器刷新高亮）");
});
