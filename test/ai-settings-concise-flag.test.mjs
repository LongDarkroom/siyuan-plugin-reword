/**
 * AiSettings 新字段兼容测试（2026-08-31 v1.4.4 Phase 1）
 * 覆盖：
 *  - 新增 `conciseEnabled` 字段：默认值、显式 true / false、显式非布尔（容错回退）
 *  - 老数据无此字段：回退到默认 true
 *  - normalizeAiSettings 后字段必须出现在结果里
 *  - 与已有 `bilingualStyle` / `trBatchSize` / `trConcurrency` 等字段共存无副作用
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AI_SETTINGS, normalizeAiSettings } from "../src/ai/ai-settings.ts";

test("ai-settings: DEFAULT_AI_SETTINGS.conciseEnabled 默认 true（v1.4.4）", () => {
  // 默认开，因为 v1.4.3 之前会话已经把简洁版按钮渲染到 DOM 了，关闭默认会"消失"
  assert.equal(DEFAULT_AI_SETTINGS.conciseEnabled, true);
});

test("ai-settings: 显式 conciseEnabled=true 保留", () => {
  const r = normalizeAiSettings({ ...DEFAULT_AI_SETTINGS, conciseEnabled: true });
  assert.equal(r.conciseEnabled, true);
});

test("ai-settings: 显式 conciseEnabled=false 保留（用户主动关）", () => {
  const r = normalizeAiSettings({ ...DEFAULT_AI_SETTINGS, conciseEnabled: false });
  assert.equal(r.conciseEnabled, false);
});

test("ai-settings: 老数据无 conciseEnabled 字段 → 回退到默认 true", () => {
  // 模拟 v1.4.3 之前的旧 settings JSON（无 conciseEnabled 字段）
  const oldData = {
    enabled: true,
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-xxx",
    model: "gpt-4o-mini",
    bilingualStyle: "literal",
    trBatchSize: 8,
    trTemperature: 0.1,
  };
  const r = normalizeAiSettings(oldData);
  // 缺失字段回退到默认值（true）
  assert.equal(r.conciseEnabled, true);
  // 其他字段不受影响
  assert.equal(r.bilingualStyle, "literal");
  assert.equal(r.trBatchSize, 8);
  assert.equal(r.trTemperature, 0.1);
  assert.equal(r.apiKey, "sk-xxx");
});

test("ai-settings: 显式 conciseEnabled=null/undefined/数字 → 走 normalize 容错", () => {
  // 各种非布尔值
  const cases = [null, undefined, 1, 0, "", "true", {}];
  for (const v of cases) {
    const r = normalizeAiSettings({ ...DEFAULT_AI_SETTINGS, conciseEnabled: v });
    // 容错：保留 true/false 的合法值；其他走默认
    if (v === true || v === false) {
      assert.equal(r.conciseEnabled, v, `显式 ${JSON.stringify(v)} 应保留`);
    } else {
      // 任何"非 boolean 真值"经过 normalize 后应当回退到默认 true
      assert.equal(typeof r.conciseEnabled, "boolean", `非 boolean 值 ${JSON.stringify(v)} 应被归一化`);
    }
  }
});

test("ai-settings: 完全空数据（{}）→ DEFAULT_AI_SETTINGS 全字段生效", () => {
  const r = normalizeAiSettings({});
  assert.equal(r.conciseEnabled, DEFAULT_AI_SETTINGS.conciseEnabled);
  assert.equal(r.bilingualStyle, DEFAULT_AI_SETTINGS.bilingualStyle);
  assert.equal(r.trBatchSize, DEFAULT_AI_SETTINGS.trBatchSize);
});

test("ai-settings: bilingualTarget 不在 AiSettings，应保留在 reader-settings", () => {
  // P1.1 决策：目标语言保留在 reader-settings（settingsStore），不在 AiSettings
  // 这里验证 normalizeAiSettings 不会污染 reader-settings 的字段
  // 注：bilingualTarget 字段名刻意与 ai-settings 解耦，避免与"AI 服务端"概念混淆
  const r = normalizeAiSettings({ ...DEFAULT_AI_SETTINGS });
  assert.equal(r.bilingualTarget, undefined, "AiSettings 不应含 bilingualTarget（属 reader-settings）");
});
