/**
 * 书架 P2 · AnnotationStore 订阅机制
 * ----------------------------------------------------------------
 * 2026-09-01 新增:让 ReaderView 等 Svelte 组件响应式订阅数据变更,
 * 替代之前「每处写路径手动 refreshAnnotsList」的脆弱设计。
 *
 * 测试覆盖:
 *  - subscribe / unsubscribe 正确性
 *  - upsert 触发 notify
 *  - remove 触发 notify
 *  - load 触发 notify
 *  - emit (onChange) 抛错时 notify 仍能触发
 *  - 多个订阅者全部收到通知
 *  - 退订后不再收到通知
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AnnotationStore } from "../src/annotation/annotation-store.ts";

const mkItem = (over = {}) => ({
  id: over.id || `ann-${Math.random().toString(36).slice(2, 8)}`,
  blockId: over.blockId || "blk-1",
  docId: over.docId || "doc-1",
  bookId: over.bookId || "book-1",
  cfi: over.cfi || "cfi-1",
  sentence: over.sentence || "The quick brown fox.",
  selectedText: over.selectedText || "fox",
  note: over.note || "",
  noteFormat: "kramdown",
  color: over.color || "#06b6d4",
  style: over.style || "highlight",
  scope: over.scope || "word",
  type: over.type || "highlight",
  origin: over.origin || "manual",
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  group: over.group || "未分组",
});

test("[订阅] subscribe 返回的退订函数能正确注销", () => {
  const store = new AnnotationStore();
  let called = 0;
  const off = store.subscribe(() => called++);
  assert.equal(called, 0, "订阅后不会立即触发");

  // 触发一次
  store.upsert(mkItem({ id: "a1" }));
  assert.ok(called >= 1, "upsert 应至少触发一次");

  const before = called;
  off();
  store.upsert(mkItem({ id: "a2" }));
  assert.equal(called, before, "退订后不应再收到通知");
});

test("[订阅] upsert 触发 notify", async () => {
  const store = new AnnotationStore();
  let called = 0;
  store.subscribe(() => called++);
  await store.upsert(mkItem({ id: "u1" }));
  assert.ok(called >= 1, "upsert 应触发 notify");
});

test("[订阅] remove 触发 notify", async () => {
  const store = new AnnotationStore();
  await store.upsert(mkItem({ id: "r1" }));

  let called = 0;
  store.subscribe(() => called++);

  await store.remove("r1");
  assert.ok(called >= 1, "remove 应触发 notify");
});

test("[订阅] load 触发 notify", () => {
  const store = new AnnotationStore();
  let called = 0;
  store.subscribe(() => called++);

  // 准备持久化数据(合法格式)
  const data = { annotations: [mkItem({ id: "l1" })] };
  store.load(data);
  assert.ok(called >= 1, "load 应触发 notify");
});

test("[订阅] 多个订阅者全部收到通知", async () => {
  const store = new AnnotationStore();
  let a = 0, b = 0, c = 0;
  store.subscribe(() => a++);
  store.subscribe(() => b++);
  store.subscribe(() => c++);

  await store.upsert(mkItem({ id: "m1" }));
  assert.ok(a >= 1 && b >= 1 && c >= 1, "三个订阅者都应收到通知");
});

test("[订阅] onChange 抛错时 notify 仍能触发", async () => {
  // 注入一个会抛错的 onChange(模拟 saveData 失败)
  const store = new AnnotationStore(async () => {
    throw new Error("saveData 失败");
  });
  let called = 0;
  store.subscribe(() => called++);

  // 不应阻断 notify
  await store.upsert(mkItem({ id: "err1" }));
  assert.ok(called >= 1, "即使 onChange 抛错,notify 仍应触发");
});

test("[订阅] 订阅者内抛错不影响其他订阅者", async () => {
  const store = new AnnotationStore();
  let a = 0, b = 0;
  // 第一个订阅者会抛错
  store.subscribe(() => {
    a++;
    throw new Error("订阅者 A 出错");
  });
  store.subscribe(() => b++);

  // 不应阻断 B
  await store.upsert(mkItem({ id: "x1" }));
  assert.ok(a >= 1, "A 仍被调用");
  assert.ok(b >= 1, "B 仍被调用(A 抛错不应影响 B)");
});

test("[订阅] 退订一个不影响其他", async () => {
  const store = new AnnotationStore();
  let a = 0, b = 0;
  const offA = store.subscribe(() => a++);
  store.subscribe(() => b++);

  await store.upsert(mkItem({ id: "s1" }));
  assert.ok(a >= 1 && b >= 1, "初始都收到");

  offA();
  const aBefore = a;
  const bBefore = b;
  await store.upsert(mkItem({ id: "s2" }));
  assert.equal(a, aBefore, "A 退订后不再增加");
  assert.ok(b > bBefore, "B 仍收到");
});

test("[兼容] 无订阅者时 upsert 正常(不抛错)", async () => {
  const store = new AnnotationStore();
  // 没订阅就 upsert
  const item = await store.upsert(mkItem({ id: "c1" }));
  assert.ok(item?.id, "无订阅者时 upsert 也应正常返回");
});
