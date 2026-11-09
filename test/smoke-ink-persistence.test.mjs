/**
 * 冒烟测试 · 墨迹持久化（阶段 0 新增）
 * ----------------------------------------------------------------
 * 为什么加这个：墨迹数据（hiword-ink.json）是**阅读器与主插件唯一共用的数据文件**，
 * 切分时归属必须明确（现决策：归新插件，主插件移除读取）。
 * 解析容错尤其关键 —— 用户手坏 JSON、插件崩溃残留半截文件都不能让阅读器启动即崩。
 *
 * 覆盖：serializeInkPersisted 结构与 rev、parseInkPersisted 对
 *       undefined/null/坏条目/rev 不符的容错、往返一致性。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { parseInkPersisted, serializeInkPersisted, INK_STORAGE_KEY } =
  await import("../src/reader/ink/persistence.ts");

/** 构造合法笔触 */
function mkStroke(over = {}) {
  return {
    id: "s1",
    brush: "pen",
    color: "red",
    style: "solid",
    baseWidth: 2,
    opacity: 1,
    points: [{ x: 0, y: 0, t: 0 }],
    path: "M0 0 L1 1",
    createdAt: 1_700_000_000_000,
    bookId: "b1",
    pageIndex: 0,
    ...over,
  };
}

test("冒烟·墨迹存储键名固定（切分后归属要靠它对齐）", () => {
  assert.equal(INK_STORAGE_KEY, "hiword-ink.json", "存储键名不应变动，否则切分会读不到历史墨迹");
});

test("冒烟·serialize 输出 rev + strokes 结构", () => {
  const out = serializeInkPersisted([mkStroke()]);
  assert.equal(out.rev, 1, "应带格式版本号 rev");
  assert.ok(Array.isArray(out.strokes), "strokes 应是数组");
  assert.equal(out.strokes.length, 1);
  assert.equal(out.strokes[0].bookId, "b1", "bookId 应被保留（切分后按书隔离墨迹的依据）");
  assert.equal(out.strokes[0].pageIndex, 0);
});

test("冒烟·往返一致：serialize → parse 还原等价笔触", () => {
  const strokes = [mkStroke({ id: "s1" }), mkStroke({ id: "s2", bookId: "b2", pageIndex: 3 })];
  const back = parseInkPersisted(serializeInkPersisted(strokes));
  assert.equal(back.length, 2, "往返后数量应一致");
  assert.equal(back[0].id, "s1");
  assert.equal(back[1].bookId, "b2");
  assert.equal(back[1].pageIndex, 3, "页码应被保留");
});

test("冒烟·空输入输出空集合", () => {
  assert.deepEqual(parseInkPersisted(serializeInkPersisted([])), [], "空数组往返应得空");
});

test("冒烟·parse 对 undefined / null / 非对象容错为空数组", () => {
  for (const raw of [undefined, null, 0, "", "abc", 123, true]) {
    const out = parseInkPersisted(raw);
    assert.ok(Array.isArray(out), `${JSON.stringify(raw)} 应解析为数组`);
    assert.equal(out.length, 0, `${JSON.stringify(raw)} 应解析为空数组（不抛异常）`);
  }
});

test("冒烟·parse 过滤坏条目但保留好条目（部分损坏不丢全部墨迹）", () => {
  const out = parseInkPersisted({
    rev: 1,
    strokes: [
      mkStroke({ id: "good1" }),
      null, // 坏：非对象
      { id: "bad-no-book" }, // 坏：缺 bookId
      { ...mkStroke({ id: "bad-points" }), points: "not-array" }, // 坏：points 非数组
      { ...mkStroke({ id: "bad-page" }), pageIndex: "1" }, // 坏：pageIndex 非数字
      mkStroke({ id: "good2" }),
    ],
  });
  const ids = out.map((s) => s.id);
  assert.equal(out.length, 2, "应只保留 2 条好数据");
  assert.deepEqual(ids, ["good1", "good2"], "好数据应原样保留，坏数据被跳过");
});

test("冒烟·parse 对 strokes 非数组容错", () => {
  assert.deepEqual(parseInkPersisted({ rev: 1, strokes: "not-array" }), [], "strokes 非数组应得空");
  assert.deepEqual(parseInkPersisted({ rev: 1 }), [], "缺 strokes 字段应得空");
});

test("冒烟·parse 兼容 rev 不匹配（未来版本增量迁移友好）", () => {
  // rev 与当前不同，但仍应尽力读出 strokes，而不是整份丢弃
  const out = parseInkPersisted({ rev: 999, strokes: [mkStroke({ id: "future" })] });
  assert.equal(out.length, 1, "rev 不匹配时仍应读出 strokes");
  assert.equal(out[0].id, "future");
});
