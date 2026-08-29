/**
 * RewordTtsSettings 字段合并 + DEFAULT 一致性测试（2026-08-29）
 * --------------------------------------------------------------------------
 * Plugin 端存的是 TtsSettings（6 字段）；Controller 期望 RewordTtsSettings（13 字段）。
 * ReaderView.ttsSettingsNow 用 `{ ...DEFAULT_REWORD_TTS, ...raw }` 合并。
 * 这里直接测合并语义，避免「Plugin 字段裁剪 → Controller 拿到空字段 → 高亮/自动翻页/睡眠定时全失效」。
 *
 * 覆盖：
 *   - DEFAULT_REWORD_TTS 必含全部 13 字段
 *   - 合并 partial 后字段不丢
 *   - 合并 null/undefined/{} 后等价于 DEFAULT
 *   - rate 等可被外部覆盖
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
const { DEFAULT_REWORD_TTS } = await import("../src/reader/reader-tts.ts");
/** 合并函数的本地副本（不依赖 ReaderView 内部实现，纯 JS） */
function mergeSettings(raw) {
  return { ...DEFAULT_REWORD_TTS, ...(raw || {}) };
}

// 必含的 13 字段（与 src/reader/reader-tts.ts:43-58 保持一致；preferVoiceURI 是可选字段，不在 DEFAULT 里）
const REQUIRED_KEYS = [
  "engine", "rate", "pitch", "volume", "accent",
  "granularity", "scope", "enableHighlight", "highlightStyle", "highlightColor",
  "autoPage", "sleepTimerMin", "interval",
];

test("DEFAULT_REWORD_TTS 必含全部 13 字段（RewordTtsSettings 完整契约）", () => {
  for (const k of REQUIRED_KEYS) {
    assert.ok(k in DEFAULT_REWORD_TTS, `DEFAULT_REWORD_TTS 缺字段: ${k}`);
  }
  // 关键默认值不能是 undefined
  assert.equal(typeof DEFAULT_REWORD_TTS.engine, "string");
  assert.equal(typeof DEFAULT_REWORD_TTS.rate, "number");
  assert.equal(typeof DEFAULT_REWORD_TTS.pitch, "number");
  assert.equal(typeof DEFAULT_REWORD_TTS.volume, "number");
  assert.equal(typeof DEFAULT_REWORD_TTS.interval, "number");
  assert.equal(typeof DEFAULT_REWORD_TTS.enableHighlight, "boolean");
  assert.equal(typeof DEFAULT_REWORD_TTS.autoPage, "boolean");
  assert.equal(typeof DEFAULT_REWORD_TTS.sleepTimerMin, "number");
  assert.equal(typeof DEFAULT_REWORD_TTS.highlightColor, "string");
  assert.equal(typeof DEFAULT_REWORD_TTS.granularity, "string");
  assert.equal(typeof DEFAULT_REWORD_TTS.scope, "string");
});

test("合并：partial + DEFAULT 后字段全部存在", () => {
  const partial = { engine: "edge", rate: 1.5 };
  const merged = { ...DEFAULT_REWORD_TTS, ...partial };
  for (const k of REQUIRED_KEYS) {
    assert.ok(k in merged, `合并后缺字段: ${k}`);
  }
  assert.equal(merged.engine, "edge");
  assert.equal(merged.rate, 1.5);
  // pitch 仍来自 DEFAULT
  assert.equal(merged.pitch, DEFAULT_REWORD_TTS.pitch);
  assert.equal(merged.enableHighlight, DEFAULT_REWORD_TTS.enableHighlight);
  assert.equal(merged.autoPage, DEFAULT_REWORD_TTS.autoPage);
});

test("合并：null/undefined/{} → 等价于 DEFAULT", () => {
  for (const raw of [null, undefined, {}]) {
    const merged = mergeSettings(raw);
    for (const k of REQUIRED_KEYS) {
      assert.deepEqual(merged[k], DEFAULT_REWORD_TTS[k], `raw=${JSON.stringify(raw)} 字段 ${k} 应等于 DEFAULT`);
    }
  }
});

test("合并：Plugin 端 TtsSettings（只有 6 字段）合并后扩展字段全部用 DEFAULT 兜底", () => {
  // 模拟 Plugin.getTtsSettings() 的返回值：只有基础 6 字段
  const pluginTts = {
    engine: "system",
    rate: 0.9,
    pitch: 1.0,
    accent: "uk",
    preferVoiceURI: "voice-en-GB",
    interval: 500,
  };
  const merged = mergeSettings(pluginTts);
  // 基础字段被覆盖
  assert.equal(merged.engine, "system");
  assert.equal(merged.rate, 0.9);
  assert.equal(merged.accent, "uk");
  assert.equal(merged.preferVoiceURI, "voice-en-GB");
  // 扩展字段走 DEFAULT
  assert.equal(merged.volume, DEFAULT_REWORD_TTS.volume);
  assert.equal(merged.granularity, DEFAULT_REWORD_TTS.granularity);
  assert.equal(merged.scope, DEFAULT_REWORD_TTS.scope);
  assert.equal(merged.enableHighlight, DEFAULT_REWORD_TTS.enableHighlight);
  assert.equal(merged.highlightStyle, DEFAULT_REWORD_TTS.highlightStyle);
  assert.equal(merged.highlightColor, DEFAULT_REWORD_TTS.highlightColor);
  assert.equal(merged.autoPage, DEFAULT_REWORD_TTS.autoPage);
  assert.equal(merged.sleepTimerMin, DEFAULT_REWORD_TTS.sleepTimerMin);
});
