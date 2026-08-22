// 2026-08-21: 阶段 1 精简后,validate normalizeAiSettings 行为
// 覆盖:
//   - 老数据 defaultMode / chatPromptTemplate 兼容(忽略 + 拼接到 promptTemplate)
//   - 删字段(chatApi/topP/等)被忽略,默认开/关
//   - 字段精简后 AiSettings 不再含已删字段

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAiSettings, DEFAULT_AI_SETTINGS } from "../src/ai/ai-settings.ts";

test("Normalize:全字段缺省时回退到 DEFAULT_AI_SETTINGS", () => {
  const r = normalizeAiSettings({});
  assert.equal(r.enabled, DEFAULT_AI_SETTINGS.enabled);
  assert.equal(r.baseUrl, DEFAULT_AI_SETTINGS.baseUrl);
  assert.equal(r.apiKey, "");
  assert.equal(r.model, DEFAULT_AI_SETTINGS.model);
  assert.deepEqual(r.models, [...DEFAULT_AI_SETTINGS.models]);
  assert.equal(r.temperature, DEFAULT_AI_SETTINGS.temperature);
  assert.equal(r.maxTokens, DEFAULT_AI_SETTINGS.maxTokens);
  assert.equal(r.jsonMode, DEFAULT_AI_SETTINGS.jsonMode);
  assert.equal(r.fontSize, DEFAULT_AI_SETTINGS.fontSize);
  assert.equal(r.inputFontSize, DEFAULT_AI_SETTINGS.inputFontSize);
});

test("Normalize:null/undefined 输入不崩", () => {
  const r1 = normalizeAiSettings(null);
  assert.equal(r1.enabled, false);
  const r2 = normalizeAiSettings(undefined);
  assert.equal(r2.enabled, false);
});

test("Normalize:合法字段被正确读取", () => {
  const r = normalizeAiSettings({
    enabled: true,
    baseUrl: "https://example.com/v1",
    apiKey: "sk-test",
    model: "claude-3-5-sonnet",
    temperature: 0.7,
    maxTokens: 4096,
    jsonMode: false,
    fontSize: 14,
    inputFontSize: 15,
  });
  assert.equal(r.enabled, true);
  assert.equal(r.baseUrl, "https://example.com/v1");
  assert.equal(r.apiKey, "sk-test");
  assert.equal(r.model, "claude-3-5-sonnet");
  assert.equal(r.temperature, 0.7);
  assert.equal(r.maxTokens, 4096);
  assert.equal(r.jsonMode, false);
  assert.equal(r.fontSize, 14);
  assert.equal(r.inputFontSize, 15);
});

test("Normalize:老数据 defaultMode=\"chat\" 被忽略(无字段)", () => {
  const r = normalizeAiSettings({ defaultMode: "chat" });
  // 应无任何报错,字段被忽略
  assert.equal(r.enabled, false);
  assert.equal(r.promptTemplate, DEFAULT_AI_SETTINGS.promptTemplate);
  // 不应该有 defaultMode 字段
  assert.equal(r.defaultMode, undefined);
});

test("Normalize:老数据 defaultMode=\"learning\" 被忽略(无字段)", () => {
  const r = normalizeAiSettings({ defaultMode: "learning" });
  assert.equal(r.defaultMode, undefined);
});

test("Normalize:老数据 chatPromptTemplate 非空 → 拼接到 promptTemplate 末尾", () => {
  const legacy = "You are a friendly chat assistant. Be concise.";
  const r = normalizeAiSettings({ chatPromptTemplate: legacy });
  // 应包含原 promptTemplate 内容
  assert.ok(r.promptTemplate.includes("REword 英语学习助手"), "原 promptTemplate 应保留");
  // 应包含老 chatPromptTemplate
  assert.ok(r.promptTemplate.includes(legacy), "老 chatPromptTemplate 应被拼接");
  // 应有迁移标记
  assert.ok(r.promptTemplate.includes("[REword-legacy-chat-prompt]"), "应有迁移标记");
  // 二次 normalize 不应重复拼接
  const r2 = normalizeAiSettings({ chatPromptTemplate: legacy, promptTemplate: r.promptTemplate });
  assert.equal(r2.promptTemplate, r.promptTemplate, "二次迁移应幂等(不重复拼接)");
});

test("Normalize:chatPromptTemplate 空字符串 → 不触发迁移", () => {
  const r = normalizeAiSettings({ chatPromptTemplate: "" });
  assert.equal(r.promptTemplate, DEFAULT_AI_SETTINGS.promptTemplate, "空字符串不应触发迁移");
  assert.ok(!r.promptTemplate.includes("[REword-legacy-chat-prompt]"));
});

test("Normalize:删字段(chatApi/topP/freqPenalty/presencePenalty/autoContinue/contextWindow/timeoutSec/transportMode/sendShortcut)被忽略", () => {
  // 尝试写入这些已删字段,normalize 应静默忽略
  const r = normalizeAiSettings({
    chatApi: "gemini",
    topP: 0.5,
    frequencyPenalty: 0.8,
    presencePenalty: 0.3,
    autoContinue: false,
    contextWindow: 999999,
    timeoutSec: 999,
    transportMode: "proxy",
    sendShortcut: "enter",
  });
  // 不应报错,且不应有这些字段
  assert.equal(r.chatApi, undefined);
  assert.equal(r.topP, undefined);
  assert.equal(r.frequencyPenalty, undefined);
  assert.equal(r.presencePenalty, undefined);
  assert.equal(r.autoContinue, undefined);
  assert.equal(r.contextWindow, undefined);
  assert.equal(r.timeoutSec, undefined);
  assert.equal(r.transportMode, undefined);
  assert.equal(r.sendShortcut, undefined);
});

test("Normalize:数值限幅仍生效(温度/maxTokens)", () => {
  // 温度:0~2
  const r1 = normalizeAiSettings({ temperature: 5.0 });
  assert.equal(r1.temperature, 2, "温度 > 2 应限到 2");
  const r2 = normalizeAiSettings({ temperature: -1.0 });
  assert.equal(r2.temperature, 0, "温度 < 0 应限到 0");
  // maxTokens:16~32768
  const r3 = normalizeAiSettings({ maxTokens: 99999 });
  assert.equal(r3.maxTokens, 32768, "maxTokens > 32768 应限到 32768");
  const r4 = normalizeAiSettings({ maxTokens: 0 });
  assert.equal(r4.maxTokens, 16, "maxTokens < 16 应限到 16");
});

test("Normalize:字符串脏数据容错(数值字段给字符串)", () => {
  const r = normalizeAiSettings({
    temperature: "0.5",
    maxTokens: "2048",
    fontSize: "12",
  });
  assert.equal(r.temperature, 0.5);
  assert.equal(r.maxTokens, 2048);
  assert.equal(r.fontSize, 12);
});

test("Normalize:模型列表去重 + 去空", () => {
  const r = normalizeAiSettings({
    models: ["gpt-4o", "  ", "gpt-4o", "claude-3-5-sonnet", "", null, 123],
  });
  assert.deepEqual(r.models, ["gpt-4o", "claude-3-5-sonnet"]);
});

test("Normalize:模型列表空时回退默认", () => {
  const r = normalizeAiSettings({ models: [] });
  assert.ok(r.models.length > 0, "空数组应回退默认");
  assert.equal(r.models[0], "gpt-4o-mini");
});
