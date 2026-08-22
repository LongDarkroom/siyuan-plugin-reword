import test from "node:test";
import assert from "node:assert/strict";
import { createStreamThrottle } from "../src/ai/stream-throttle.ts";

/**
 * 流式渲染节流器回归测试（2026-08-19 AI 面板 P0 流式骨架）。
 * 保证高频 onToken 回调被合并为固定窗口内一次渲染，避免每 token 全量重绘卡死主线程。
 */

/** 让真实计时器驱动 setTimeout，保证时序稳定 */
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("节流：窗口内多次 schedule 合并为一次执行", async () => {
  let calls = 0;
  const t = createStreamThrottle(() => { calls++; }, 100);
  t.schedule();
  t.schedule();
  t.schedule();
  assert.equal(calls, 0, "窗口边界未到不应执行");
  await tick(160);
  assert.equal(calls, 1, "窗口内 3 次 schedule 应合并为 1 次渲染");
});

test("节流：跨窗口连续 schedule 会多次执行（周期刷新）", async () => {
  let calls = 0;
  const t = createStreamThrottle(() => { calls++; }, 60);
  t.schedule();
  await tick(90);
  t.schedule();
  await tick(90);
  assert.equal(calls, 2, "跨窗口的两批 schedule 应各自执行一次");
});

test("节流：flush 立即执行未决渲染（生成完成保底不丢字）", async () => {
  let calls = 0;
  const t = createStreamThrottle(() => { calls++; }, 1000);
  t.schedule();
  assert.equal(calls, 0, "窗口未到不应执行");
  t.flush();
  assert.equal(calls, 1, "flush 应立即执行一次");
  await tick(1100);
  assert.equal(calls, 1, "flush 后 timer 已清，不应再重复执行");
});

test("节流：cancel 取消未决渲染", async () => {
  let calls = 0;
  const t = createStreamThrottle(() => { calls++; }, 200);
  t.schedule();
  t.cancel();
  await tick(260);
  assert.equal(calls, 0, "cancel 后未决渲染不应执行");
});

test("节流：窗口内重复 schedule 不重置计时", async () => {
  let calls = 0;
  const t = createStreamThrottle(() => { calls++; }, 80);
  t.schedule();
  await tick(40);
  t.schedule(); // 未到窗口：合并，不重置计时
  await tick(50); // t0+90，窗口边界(t0+80)已过
  assert.equal(calls, 1, "两次 schedule 合并为窗口边界一次执行");
});

test("节流：flush 后再次 schedule 可继续排队", async () => {
  let calls = 0;
  const t = createStreamThrottle(() => { calls++; }, 50);
  t.schedule();
  t.flush(); // 立即执行未决
  assert.equal(calls, 1);
  t.schedule(); // 新一轮排队
  await tick(70);
  assert.equal(calls, 2, "flush 后新 schedule 正常进入下一窗口");
});
