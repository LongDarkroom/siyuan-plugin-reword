/**
 * EdgeBackend 失败兜底测试（2026-08-29）
 * --------------------------------------------------------------------------
 * 微软 readaloud 公开 WebSocket 端点 2024 年起陆续下线/分区屏蔽，
 * EdgeBackend 必须 fail-fast 让上层 fallback (system) 接管，否则 controller 会卡死。
 *
 * 覆盖：
 *   - WebSocket 构造抛错 → EdgeBackend.speak 立刻 reject
 *   - WebSocket 立刻触发 onerror → EdgeBackend.speak reject
 *   - WebSocket 打开后长时间无音频帧 → 8s 内 reject（避免无限挂起）
 *   - WebSocket 异常关闭且无音频 → reject
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// foliate vendor 用浏览器 NodeFilter API；Node 没这个全局，stub 一个最小实现。
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
const { EdgeBackend } = await import("../src/reader/reader-tts.ts");

function setWS(WSClass) {
  const Orig = globalThis.WebSocket;
  // @ts-ignore
  globalThis.WebSocket = WSClass;
  return () => { if (Orig) globalThis.WebSocket = Orig; else delete globalThis.WebSocket; };
}

test("EdgeBackend：WebSocket 构造抛错 → speak 立刻 reject", { timeout: 3000 }, async () => {
  const restore = setWS(function () { throw new Error("ws ctor fail"); });
  try {
    const b = new EdgeBackend();
    await assert.rejects(b.speak("hello", { lang: "en-US" }), /ws ctor fail/);
  } finally { restore(); }
});

test("EdgeBackend：WebSocket 立即 onerror → speak reject < 1s", { timeout: 3000 }, async () => {
  function ErrWS() {
    this.binaryType = "";
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    queueMicrotask(() => { if (this.onerror) this.onerror(new Event("error")); });
  }
  ErrWS.prototype.send = function () {};
  ErrWS.prototype.close = function () {};
  const restore = setWS(ErrWS);
  try {
    const b = new EdgeBackend();
    const t0 = Date.now();
    await assert.rejects(b.speak("hello", { lang: "en-US" }), /edge ws error/);
    assert.ok(Date.now() - t0 < 1000, "必须 fail-fast，不能等满 8s");
  } finally { restore(); }
});

test("EdgeBackend：open 后不发音频 → 8s 内 reject (no-audio-timeout)", { timeout: 12000 }, async () => {
  function SilentWS() {
    this.binaryType = "";
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    setTimeout(() => { if (this.onopen) this.onopen(); }, 1);
  }
  SilentWS.prototype.send = function () {};
  SilentWS.prototype.close = function () {};
  const restore = setWS(SilentWS);
  try {
    const b = new EdgeBackend();
    const t0 = Date.now();
    await assert.rejects(b.speak("hello", { lang: "en-US" }), /edge tts no audio in time|edge ws error/);
    const dur = Date.now() - t0;
    assert.ok(dur >= 7500 && dur <= 9500, `no-audio timeout 必须在 8s±0.5s 触发，实际 ${dur}ms`);
  } finally { restore(); }
});

test("EdgeBackend：异常关闭且无音频 → reject 触发 fallback", { timeout: 3000 }, async () => {
  function CrashingWS() {
    this.binaryType = "";
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    setTimeout(() => {
      if (this.onopen) this.onopen();
      setTimeout(() => { if (this.onclose) this.onclose({ code: 1006, reason: "abnormal" }); }, 1);
    }, 1);
  }
  CrashingWS.prototype.send = function () {};
  CrashingWS.prototype.close = function () {};
  const restore = setWS(CrashingWS);
  try {
    const b = new EdgeBackend();
    const t0 = Date.now();
    await assert.rejects(b.speak("hello", { lang: "en-US" }), /edge ws closed code=1006/);
    assert.ok(Date.now() - t0 < 1500, "异常关闭必须在 1.5s 内 reject");
  } finally { restore(); }
});
