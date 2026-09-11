// 2026-08-21: 阶段 1 精简后,validate normalizeAiSettings 行为
// 覆盖:
//   - 老数据 defaultMode / chatPromptTemplate 兼容(忽略 + 拼接到 promptTemplate)
//   - 删字段(chatApi/topP/等)被忽略,默认开/关
//   - 字段精简后 AiSettings 不再含已删字段

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAiSettings,
  listNormalizeGaps,
  DEFAULT_AI_SETTINGS,
  DEFAULT_CONCISE_TRANSLATE_PROMPT,
} from "../src/ai/ai-settings.ts";

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

test("Normalize:删字段(chatApi/topP/freqPenalty/presencePenalty/autoContinue/contextWindow/timeoutSec/transportMode)被忽略", () => {
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
});

test("Normalize:sendShortcut 已于 2026-09-06 复活(枚举收窄,非忽略)", () => {
  // 该字段 2026-08-21 曾被精简删除,老断言要求 normalize 忽略它;
  // 2026-09-06 第 1 批把它提升为「发送快捷键」设置项(🟡 待接线),故行为改为枚举收窄。
  // 2026-09-10 P3:默认值由 "mod+enter" 改为 "enter",故三处回退断言随之更新。
  assert.equal(normalizeAiSettings({ sendShortcut: "enter" }).sendShortcut, "enter");
  assert.equal(normalizeAiSettings({ sendShortcut: "mod+enter" }).sendShortcut, "mod+enter");
  // 非法值(含 2026-08-21 之前的旧格式 "ctrl+enter")静默回退默认,不抛错
  assert.equal(normalizeAiSettings({ sendShortcut: "ctrl+enter" }).sendShortcut, "enter");
  assert.equal(normalizeAiSettings({ sendShortcut: 123 }).sendShortcut, "enter");
  assert.equal(normalizeAiSettings({}).sendShortcut, "enter");
});

test("Normalize:第 1 批功能蓝图字段枚举收窄(progressMode/deepReadVerify/unknownHandling)", () => {
  // 🔵 规划中字段同样要做枚举收窄:脏数据回退默认,不能让插件起不来
  assert.equal(normalizeAiSettings({ progressMode: "real" }).progressMode, "real");
  assert.equal(normalizeAiSettings({ progressMode: "bogus" }).progressMode, "infer");
  assert.equal(normalizeAiSettings({ deepReadVerify: "strict" }).deepReadVerify, "strict");
  assert.equal(normalizeAiSettings({ deepReadVerify: "nope" }).deepReadVerify, "warn");
  assert.equal(normalizeAiSettings({ unknownHandling: "mark" }).unknownHandling, "mark");
  assert.equal(normalizeAiSettings({ unknownHandling: "x" }).unknownHandling, "omit");
  // 数值型:限幅
  assert.equal(normalizeAiSettings({ chunkChars: 99999 }).chunkChars, 8000);
  assert.equal(normalizeAiSettings({ streamThrottleMs: -5 }).streamThrottleMs, 0);
  assert.equal(normalizeAiSettings({ sessionRetentionDays: 9999 }).sessionRetentionDays, 365);
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
  // 2026-09-07 改动点 1：默认平台即硅基流动，空模型列表回退默认平台的代表模型
  assert.equal(r.models[0], DEFAULT_AI_SETTINGS.models[0]);
});

// ── 2026-09-06 P0 修复：normalize 漏字段导致「用户配置重启即丢」──────────────
// 背景：conciseTranslatePrompt 在接口 / DEFAULT / 消费方三层都存在，唯独
// normalizeAiSettings 的返回对象里没有。因为它是可选字段，TS 不会报错，
// 于是缺陷静默存在：用户自定义简洁版提示词 → 保存 → 重启 → 回退默认。
// 下面两条用例把「字段完整性」固化为不变量，新增字段忘了补 normalize 立即变红。

test("P0:normalize 返回对象不得缺少任何默认字段(listNormalizeGaps 必须为空)", () => {
  assert.deepEqual(listNormalizeGaps(), [], "normalizeAiSettings 漏字段会导致配置无法持久化");
});

test("P0:conciseTranslatePrompt 往返不丢(自定义值能存能读)", () => {
  const custom = "极简翻译：只给中文，不要任何解释。";
  const r = normalizeAiSettings({ conciseTranslatePrompt: custom });
  assert.equal(r.conciseTranslatePrompt, custom);
  // 二次往返（模拟 保存 → 重启加载）
  const again = normalizeAiSettings(JSON.parse(JSON.stringify(r)));
  assert.equal(again.conciseTranslatePrompt, custom, "二次 normalize 后不得回退默认");
});

test("P0:conciseTranslatePrompt 缺失/空串时回退默认(与 translatePrompt 同口径)", () => {
  assert.equal(
    normalizeAiSettings({}).conciseTranslatePrompt,
    DEFAULT_CONCISE_TRANSLATE_PROMPT
  );
  assert.equal(
    normalizeAiSettings({ conciseTranslatePrompt: "   " }).conciseTranslatePrompt,
    DEFAULT_CONCISE_TRANSLATE_PROMPT
  );
  assert.equal(
    normalizeAiSettings({ conciseTranslatePrompt: 123 }).conciseTranslatePrompt,
    DEFAULT_CONCISE_TRANSLATE_PROMPT
  );
});

test("P0:save 语义——merge 后未出现在 UI 上的字段必须保留", () => {
  // 模拟 index.ts #ais-save 的修复语义：patch 只有 14 个字段，
  // merge + normalize 后，翻译引擎 Key 等其余字段必须原样存活。
  const stored = normalizeAiSettings({
    tencentSecretId: "AKIDxxx",
    tencentSecretKey: "secretxxx",
    youdaoAppKey: "yd-key",
    baiduKey: "bd-key",
    msKey: "ms-key",
    aiTokenUsed: 4321,
    bilingualStyle: "natural",
    trBatchSize: 12,
    conciseTranslatePrompt: "自定义简洁版",
  });
  const patch = {
    enabled: true,
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-new",
    model: "deepseek-chat",
    models: ["deepseek-chat"],
    temperature: 0.9,
    maxTokens: 8192,
    jsonMode: false,
    promptTemplate: "新提示词",
    fontSize: 16,
    inputFontSize: 17,
    useProtyleInput: true,
    exportNotebookId: "",
    exportSavePath: "",
    soulDocId: "",
  };
  const merged = normalizeAiSettings({ ...stored, ...patch });

  // patch 生效
  assert.equal(merged.apiKey, "sk-new");
  assert.equal(merged.temperature, 0.9);
  assert.equal(merged.fontSize, 16);
  // 未出现在 UI 上的字段存活（修复前会被整体替换抹掉）
  assert.equal(merged.tencentSecretId, "AKIDxxx");
  assert.equal(merged.tencentSecretKey, "secretxxx");
  assert.equal(merged.youdaoAppKey, "yd-key");
  assert.equal(merged.baiduKey, "bd-key");
  assert.equal(merged.msKey, "ms-key");
  assert.equal(merged.aiTokenUsed, 4321);
  assert.equal(merged.bilingualStyle, "natural");
  assert.equal(merged.trBatchSize, 12);
  assert.equal(merged.conciseTranslatePrompt, "自定义简洁版");
});
