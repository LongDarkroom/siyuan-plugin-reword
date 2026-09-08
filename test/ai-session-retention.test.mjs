/**
 * AI 会话保留天数 + 落盘节流测试（2026-09-06 第 5 批）
 * 覆盖：sessionRetentionDays 过期剔除 / 0 = 永久 / 全过期后 activeId 回退 /
 *       PersistentStore.setDelay 0 与大窗口合并 / 非法值忽略
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { AiSessionStore } from "../src/ai/ai-session-store.ts";
import { PersistentStore } from "../src/core/persist.ts";

const DAY = 86_400_000;

function mkSession(id, ageDays, msgs = 1) {
  const now = Date.now();
  return {
    id,
    title: `会话 ${id}`,
    messages: Array.from({ length: msgs }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
      ts: now - ageDays * DAY,
    })),
    createdAt: now - ageDays * DAY,
    updatedAt: now - ageDays * DAY,
  };
}

function mkStore(sessions, activeId) {
  const s = new AiSessionStore();
  s.load({ activeId: activeId ?? null, sessions }, 0);
  return s;
}

// ───────────────────── 会话保留天数 ─────────────────────

test("retention: 0 = 永久保留（不过滤任何会话）", () => {
  const s = new AiSessionStore();
  s.load({ activeId: "a", sessions: [mkSession("a", 400), mkSession("b", 900)] }, 0);
  assert.deepEqual(s.list().map((x) => x.id).sort(), ["a", "b"]);
});

test("retention: 缺省 retentionDays 等同永久", () => {
  const s = new AiSessionStore();
  s.load({ activeId: "a", sessions: [mkSession("a", 400)] });
  assert.equal(s.list().length, 1);
});

test("retention: 超期会话被剔除，未超期保留", () => {
  const s = new AiSessionStore();
  s.load(
    { activeId: "old", sessions: [mkSession("old", 40), mkSession("new", 10)] },
    30
  );
  assert.deepEqual(s.list().map((x) => x.id), ["new"]);
});

test("retention: 边界 —— 恰好在窗口内的会话保留", () => {
  const s = new AiSessionStore();
  // 29.9 天前 → 在 30 天窗口内（updatedAt >= cutoff）
  s.load({ activeId: "edge", sessions: [mkSession("edge", 29.9)] }, 30);
  assert.equal(s.list().length, 1);
});

test("retention: 激活会话超期被清 → activeId 回退到最近会话", () => {
  const s = new AiSessionStore();
  s.load(
    { activeId: "old", sessions: [mkSession("old", 60), mkSession("mid", 5)] },
    30
  );
  assert.equal(s.getActive()?.id, "mid");
});

test("retention: 全部超期 → 空库（index.ts 有空库 create() 兜底）", () => {
  const s = new AiSessionStore();
  s.load({ activeId: "a", sessions: [mkSession("a", 90), mkSession("b", 120)] }, 30);
  assert.equal(s.list().length, 0);
  assert.equal(s.getActive(), null);
});

test("retention: 开启保留后仍可正常新建会话（不被 retention 影响）", () => {
  const s = mkStore([], null);
  s.load({ activeId: null, sessions: [] }, 30);
  const created = s.create("新会话");
  assert.equal(s.getActive()?.id, created.id);
});

test("retention: 负值与非法值等同永久", () => {
  const s = new AiSessionStore();
  s.load({ activeId: "a", sessions: [mkSession("a", 500)] }, -7);
  assert.equal(s.list().length, 1);
  const s2 = new AiSessionStore();
  s2.load({ activeId: "a", sessions: [mkSession("a", 500)] }, undefined);
  assert.equal(s2.list().length, 1);
});

// ───────────────────── 落盘节流 setDelay ─────────────────────

function mkPersist(sink) {
  return new PersistentStore(async (d) => {
    sink.push(d);
  });
}

test("throttle: setDelay(0) 立即落盘", async () => {
  const calls = [];
  const p = mkPersist(calls);
  p.setDelay(0);
  p.update({ n: 1 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { n: 1 });
});

test("throttle: 大窗口内多次 update 合并为一次写盘", async () => {
  const calls = [];
  const p = mkPersist(calls);
  p.setDelay(300);
  p.update({ n: 1 });
  p.update({ n: 2 });
  p.update({ n: 3 });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.length, 0, "300ms 窗口内不应落盘");
  p.setDelay(0);
  await p.flush();
  assert.equal(calls.length, 1, "合并后只写一次");
  assert.deepEqual(calls[0], { n: 3 }, "落盘的是最新数据");
});

test("throttle: 非法 delay 被忽略（不改变既有窗口）", async () => {
  const calls = [];
  const p = mkPersist(calls);
  p.setDelay(0);
  p.setDelay(NaN);
  p.setDelay(undefined);
  p.update({ n: 1 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 1, "NaN/undefined 应被忽略，仍按 0ms 落盘");
});

test("throttle: 负数 delay 收敛到 0（不产生负 setTimeout）", async () => {
  const calls = [];
  const p = mkPersist(calls);
  p.setDelay(-500);
  p.update({ n: 1 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 1);
});
