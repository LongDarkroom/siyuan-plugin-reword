/**
 * telemetry 总线单元测试（v2 重做核心基础设施）
 * 验证：订阅/退订、多监听、监听器异常隔离、engineLabel 映射。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { telemetry, engineLabel } from "../src/reader/bilingual-v2/telemetry.ts";

test("emit/on：订阅者收到事件，unsub 后不再收到", () => {
  const seen = [];
  const unsub = telemetry.on((e) => seen.push(e));
  telemetry.emit({ phase: "hit", engine: "cache", segmentCount: 3 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].engine, "cache");
  unsub();
  telemetry.emit({ phase: "hit", engine: "cache", segmentCount: 5 });
  assert.equal(seen.length, 1, "退订后不应再收到");
});

test("多监听器独立收到同一事件", () => {
  const a = [];
  const b = [];
  const u1 = telemetry.on((e) => a.push(e));
  const u2 = telemetry.on((e) => b.push(e));
  telemetry.emit({ phase: "try", engine: "tencent", segmentCount: 2, chars: 100 });
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  u1();
  u2();
});

test("监听器异常被隔离，不影响其他监听与主流程", () => {
  const good = [];
  const u1 = telemetry.on(() => {
    throw new Error("boom");
  });
  const u2 = telemetry.on((e) => good.push(e));
  // 不应抛出
  telemetry.emit({ phase: "done", segmentCount: 1 });
  assert.equal(good.length, 1);
  u1();
  u2();
});

test("engineLabel：引擎中文短标签", () => {
  assert.equal(engineLabel("tencent"), "腾讯");
  assert.equal(engineLabel("youdao"), "有道");
  assert.equal(engineLabel("baidu"), "百度");
  assert.equal(engineLabel("microsoft"), "微软");
  assert.equal(engineLabel("libretranslate"), "Libre");
  assert.equal(engineLabel("ai"), "AI");
  assert.equal(engineLabel("cache"), "缓存");
  assert.equal(engineLabel("unknown"), "unknown");
});
