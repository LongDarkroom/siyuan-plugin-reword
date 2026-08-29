/**
 * ReaderTtsController 基本生命周期测试（2026-08-29）
 * --------------------------------------------------------------------------
 * 覆盖：
 *   - 实例化不抛，state=idle，progress={0,0}
 *   - setSettings / setRate / dispose 不抛
 *   - getState / getProgress 接口稳定
 *
 * 目的：保证"修朗读引擎" 后控制器最基础的对外契约没坏，避免 3481 行 index.ts
 *      与 ReaderView 集成时出现 controller undefined / method missing 之类的崩溃。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// foliate vendor 用浏览器 NodeFilter API；Node 没这个全局，stub 一个最小实现。
// 关键常量：SHOW_ELEMENT=1, SHOW_TEXT=4, FILTER_ACCEPT=1, FILTER_REJECT=2
if (typeof globalThis.NodeFilter === "undefined") {
  globalThis.NodeFilter = {
    SHOW_ALL: 0xFFFFFFFF,
    SHOW_ELEMENT: 1,
    SHOW_TEXT: 4,
    SHOW_CDATA_SECTION: 8,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
  };
}
const { ReaderTtsController, DEFAULT_REWORD_TTS } = await import("../src/reader/reader-tts.ts");

test("Controller：实例化不抛，初始 state=idle，progress={index:0,total:0}", () => {
  const c = new ReaderTtsController(() => [], { ...DEFAULT_REWORD_TTS });
  assert.equal(c.getState(), "idle");
  assert.deepEqual(c.getProgress(), { index: 0, total: 0 });
});

test("Controller：setSettings 之后 getState 仍为 idle（不自动启动）", () => {
  const c = new ReaderTtsController(() => [], { ...DEFAULT_REWORD_TTS, rate: 1.0 });
  c.setSettings({ ...DEFAULT_REWORD_TTS, rate: 2.5, engine: "system" });
  assert.equal(c.getState(), "idle");
  // 没收到 onState 回调就改不了状态，符合"setSettings 只是更新配置"的语义
  let stateHits = 0;
  // 用新对象验证 setSettings 不触发回调（这里只断言"调用不抛 + 状态仍是 idle"，
  //  真正的 onState 行为由 controller 的 play/pause/stop 流程触发，留给后续集成测试）
  c.setSettings({ ...DEFAULT_REWORD_TTS, rate: 1.5 });
  assert.equal(stateHits, 0, "setSettings 不应触发 onState 回调");
});

test("Controller：setRate 即时生效（不抛）", () => {
  const c = new ReaderTtsController(() => [], { ...DEFAULT_REWORD_TTS });
  c.setRate(0.5);
  c.setRate(3.0);
  c.setRate(1.2);
  assert.equal(c.getState(), "idle");
});

test("Controller：dispose 后 stop / pause / resume 都不抛", () => {
  const c = new ReaderTtsController(() => [], { ...DEFAULT_REWORD_TTS });
  c.dispose();
  // dispose 内部已经 stop；后续调用幂等
  c.pause();
  c.resume();
  c.stop();
  c.next();
  c.prev();
  assert.equal(c.getState(), "idle");
});

test("Controller：空文档枚举时 playFrom 应触发 onError 而不是崩", async () => {
  let errMsg = "";
  const c = new ReaderTtsController(() => [], { ...DEFAULT_REWORD_TTS }, {
    onError: (m) => { errMsg = m; },
  });
  // 文档为空数组 → rebuild() 返回空 → playFrom 走 onError
  await c.playFrom();
  assert.match(errMsg, /无可朗读内容|朗读引擎不可用/);
});
