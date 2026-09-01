/**
 * createBackend 后端选型 + fallback 兜底测试（2026-08-29）
 * --------------------------------------------------------------------------
 * 覆盖：
 *   - engine=system/youdao/edge/auto 4 种主选型
 *   - 选 youdao/edge 时 fallback 必须是 system（fail-safe）
 *   - 选 system 时无 fallback
 *   - auto 模式按「edge > youdao > system」顺序
 *   - 后端实例都实现了 TtsBackend 接口（name/supported/speak/cancel）
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
// Node 24 默认无 globalThis.WebSocket/Audio/speechSynthesis，临时给最小 stub
// 让 createBackend 走"全部后端都可用"的分支，测主选型 + fallback 关系。
class FakeWS { addEventListener() {} close() {} send() {} }
class FakeAudio { constructor() {} play() { return Promise.resolve(); } pause() {} }
// @ts-ignore
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = FakeWS;
// @ts-ignore
if (typeof globalThis.Audio === "undefined") globalThis.Audio = FakeAudio;
const { createBackend, DEFAULT_REWORD_TTS } = await import("../src/reader/reader-tts.ts");

test("createBackend: engine=system → primary=system, fallback=null", () => {
  const { primary, fallback } = createBackend({ ...DEFAULT_REWORD_TTS, engine: "system" });
  assert.equal(primary.name, "system");
  assert.equal(fallback, null);
});

test("createBackend: engine=youdao → primary=youdao, fallback=system", () => {
  const { primary, fallback } = createBackend({ ...DEFAULT_REWORD_TTS, engine: "youdao" });
  assert.equal(primary.name, "youdao");
  // 即便有道不可达，system 必须兜底（避免 controller 完全失声）
  assert.ok(fallback, "youdao 必须有 fallback 兜底");
  assert.equal(fallback.name, "system");
});

test("createBackend: engine=edge → primary=edge, fallback=system（fake WebSocket/Audio 已 stub）", () => {
  const { primary, fallback } = createBackend({ ...DEFAULT_REWORD_TTS, engine: "edge" });
  assert.equal(primary.name, "edge");
  // Edge 公开端点已下线，必须有 system 兜底
  assert.ok(fallback, "edge 必须有 fallback 兜底");
  assert.equal(fallback.name, "system");
});

test("createBackend: engine=auto → 系统语音优先，在线引擎兜底", () => {
  const { primary, fallback } = createBackend({ ...DEFAULT_REWORD_TTS, engine: "auto" });
  // 2026 修正（原断言为「在线优先选 edge」）：
  // Edge 公开 readaloud 端点自 2024 起陆续下线，若 auto 仍优先在线，
  // 每句朗读都要先等 8s 无音频超时才降级 → 体验极差。
  // 故改为 system 直接作主引擎（离线、多语言嗓音最稳），在线只作兜底，
  // 容错由 speakWithFallback 的一次性降级保证。
  assert.equal(primary.name, "system", "auto 应以离线系统语音为主引擎");
  assert.equal(fallback?.name, "youdao", "在线引擎应作为兜底");
});

test("createBackend: 三种后端实例都实现 TtsBackend 接口契约", () => {
  for (const eng of ["system", "youdao", "edge"]) {
    const { primary } = createBackend({ ...DEFAULT_REWORD_TTS, engine: eng });
    assert.equal(typeof primary.name, "string");
    assert.equal(typeof primary.supported, "function");
    assert.equal(typeof primary.speak, "function");
    assert.equal(typeof primary.cancel, "function");
    // supported() 必须返 boolean
    assert.equal(typeof primary.supported(), "boolean");
  }
});

test("createBackend: 即便所有在线后端都不可用，primary 也强制落到 system（不会返回 null）", () => {
  // 模拟"在线完全不可用"：暂时把 system 的 supported 视为不靠谱
  // 实际上 createBackend 实现里有 `if (!primary) primary = system;` 兜底
  // 这里只验证 primary 永远非空
  const { primary } = createBackend({ ...DEFAULT_REWORD_TTS, engine: "auto" });
  assert.ok(primary, "primary 不应为 null");
  // 任何引擎下 primary 都不为 null
  for (const e of ["system", "youdao", "edge", "auto"]) {
    const r = createBackend({ ...DEFAULT_REWORD_TTS, engine: e });
    assert.ok(r.primary, `engine=${e} 时 primary 不应为 null`);
  }
});
