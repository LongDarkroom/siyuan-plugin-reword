import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatUrl,
  buildRequestBody,
  extractContentFromBody,
  extractUsageFromBody,
  requestAIGenerate,
  requestAIStream,
  estimateTokens,
} from "../src/copilot/ai/ai-client.ts";
import {
  DEFAULT_AI_SETTINGS,
  normalizeAiSettings,
  fillAiTemplate,
  inferContextWindow,
} from "../src/ai/ai-settings.ts";

test("buildChatUrl: 归一化各种 baseUrl 为 chat/completions", () => {
  assert.equal(buildChatUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  assert.equal(buildChatUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1/chat/completions");
  assert.equal(buildChatUrl("https://api.deepseek.com"), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(buildChatUrl("https://x/v1/chat/completions"), "https://x/v1/chat/completions");
  assert.equal(buildChatUrl("https://x/v1/models"), "https://x/v1/chat/completions");
  assert.equal(buildChatUrl("https://x/chat/completions"), "https://x/chat/completions");
  assert.equal(buildChatUrl(""), "");
});

test("buildChatUrl: 去除末尾斜杠后追加", () => {
  assert.equal(buildChatUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1/chat/completions");
});

test("buildRequestBody: jsonMode 时带 response_format", () => {
  const s = { ...DEFAULT_AI_SETTINGS };
  const json = buildRequestBody([{ role: "user", content: "hi" }], s, true);
  assert.equal(json.response_format.type, "json_object");
  assert.equal(json.stream, false);
  assert.equal(json.model, "gpt-4o-mini");
  const plain = buildRequestBody([{ role: "user", content: "hi" }], s, false);
  assert.equal(plain.response_format, undefined);
});

test("extractContentFromBody: 普通 JSON choices[0].message.content", () => {
  const raw = JSON.stringify({ choices: [{ message: { content: "hello world" } }] });
  assert.equal(extractContentFromBody(raw).content, "hello world");
});

test("extractContentFromBody: SSE 流式累加 delta.content", () => {
  const raw = [
    'data: {"choices":[{"delta":{"content":"Hello "}}]}',
    'data: {"choices":[{"delta":{"content":"world"}}]}',
    "data: [DONE]",
  ].join("\n");
  assert.equal(extractContentFromBody(raw).content, "Hello world");
});

test("extractContentFromBody: 顶层 content 兜底", () => {
  assert.equal(extractContentFromBody(JSON.stringify({ content: "x" })).content, "x");
});

test("requestAIGenerate: 注入 mock transport 返回结构化内容（不触达 siyuan）", async () => {
  const transport = async (req) => {
    assert.equal(req.method, "POST");
    assert.equal(req.headers["Authorization"], "Bearer sk-test");
    const body = JSON.parse(req.body);
    assert.equal(body.model, "gpt-4o-mini");
    const resp = {
      status: 200,
      headers: {},
      body: JSON.stringify({ model: "gpt-4o-mini", choices: [{ message: { content: "AI says hi" } }] }),
    };
    return resp;
  };
  const res = await requestAIGenerate({
    messages: [{ role: "user", content: "hi" }],
    settings: { ...DEFAULT_AI_SETTINGS, apiKey: "sk-test" },
    jsonMode: false,
  }, transport);
  assert.equal(res.content, "AI says hi");
  assert.equal(res.model, "gpt-4o-mini");
});

test("requestAIGenerate: 非 2xx 抛错", async () => {
  const transport = async () => ({ status: 401, headers: {}, body: "unauthorized" });
  await assert.rejects(() =>
    requestAIGenerate({
      messages: [{ role: "user", content: "hi" }],
      settings: { ...DEFAULT_AI_SETTINGS, apiKey: "bad" },
    }, transport)
  );
});

test("normalizeAiSettings: 容错合并与数值限幅", () => {
  const s = normalizeAiSettings({ temperature: "1.5", maxTokens: 99999, enabled: "yes" });
  assert.equal(s.temperature, 1.5);
  assert.equal(s.maxTokens, 32768);
  assert.equal(s.enabled, true);
  const def = normalizeAiSettings(null);
  assert.equal(def.baseUrl, DEFAULT_AI_SETTINGS.baseUrl);
  assert.equal(def.jsonMode, true);
});

test("fillAiTemplate: 占位符替换，缺失留原样", () => {
  const t = fillAiTemplate("标题{{title}}词{{word}}", { title: "T", word: undefined });
  assert.equal(t, "标题T词{{word}}");
});

test("inferContextWindow: 常见模型上下文窗口推断", () => {
  assert.equal(inferContextWindow("deepseek-ai/DeepSeek-V4-Flash"), 1_048_576);
  assert.equal(inferContextWindow("deepseek-chat"), 64_000);
  assert.equal(inferContextWindow("gpt-4o-mini"), 128_000);
  assert.equal(inferContextWindow("claude-3-5-sonnet"), 200_000);
  assert.equal(inferContextWindow("unknown-model"), 128_000);
});

test("extractUsageFromBody: 普通 JSON 解析 usage", () => {
  const raw = JSON.stringify({
    choices: [{ message: { content: "hi" } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
  const u = extractUsageFromBody(raw);
  assert.deepEqual(u, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
});

test("extractUsageFromBody: SSE 流取最后一个含 usage 帧", () => {
  const raw = [
    'data: {"choices":[{"delta":{"content":"a"}}]}',
    'data: {"choices":[{"delta":{"content":"b"}}]}',
    'data: {"choices":[{"delta":{"content":""}}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}',
    "data: [DONE]",
  ].join("\n");
  const u = extractUsageFromBody(raw);
  assert.deepEqual(u, { promptTokens: 10, completionTokens: 3, totalTokens: 13 });
});

test("extractUsageFromBody: 无 usage 返回 undefined", () => {
  assert.equal(extractUsageFromBody(JSON.stringify({ choices: [{ message: { content: "x" } }] })), undefined);
  assert.equal(extractUsageFromBody(""), undefined);
  assert.equal(extractUsageFromBody("not json"), undefined);
});

test("estimateTokens: 空文本返回 0，非空文本做字符加权估算", () => {
  assert.equal(estimateTokens(""), 0);
  assert.ok(estimateTokens("hello world") > 0);
  assert.ok(estimateTokens("中文测试文本") >= 2);
  assert.ok(estimateTokens("a".repeat(400)) >= 80);
});

test("requestAIStream: 请求体包含 stream_options.include_usage", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody;
  try {
    globalThis.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        body: {
          getReader() {
            const encoder = new TextEncoder();
            let done = false;
            return {
              read() {
                if (done) return Promise.resolve({ done: true });
                done = true;
                return Promise.resolve({ done: false, value: encoder.encode("data: [DONE]\n") });
              },
            };
          },
        },
      };
    };
    await requestAIStream({
      messages: [{ role: "user", content: "hi" }],
      settings: { ...DEFAULT_AI_SETTINGS, baseUrl: "https://x/v1", apiKey: "k" },
    });
    assert.equal(capturedBody.stream, true);
    assert.deepEqual(capturedBody.stream_options, { include_usage: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestAIStream: 流式末端 usage 字段归一化为 camelCase", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      body: {
        getReader() {
          const lines = [
            'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
            'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}\n',
            "data: [DONE]\n",
          ];
          let i = 0;
          const encoder = new TextEncoder();
          return {
            read() {
              if (i >= lines.length) return Promise.resolve({ done: true });
              const value = encoder.encode(lines[i++]);
              return Promise.resolve({ done: false, value });
            },
          };
        },
      },
    });
    const res = await requestAIStream({
      messages: [{ role: "user", content: "hi" }],
      settings: { ...DEFAULT_AI_SETTINGS, baseUrl: "https://x/v1", apiKey: "k", maxTokens: 100 },
    });
    assert.equal(res.ok, true);
    assert.equal(res.content, "hi");
    assert.deepEqual(res.usage, { promptTokens: 7, completionTokens: 2, totalTokens: 9 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestAIStream: finish_reason=length 标记 truncated（流式末帧无结尾换行也需 flush）", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // 关键场景：最后一个 data 帧不带 \n（很多服务端实现如此），旧代码会吞掉该帧
    globalThis.fetch = async () => ({
      ok: true,
      body: {
        getReader() {
          const chunks = [
            'data: {"choices":[{"delta":{"content":"hello"}}]}\n',
            'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"length"}]}',
          ];
          let i = 0;
          const encoder = new TextEncoder();
          return {
            read() {
              if (i >= chunks.length) return Promise.resolve({ done: true });
              const value = encoder.encode(chunks[i++]);
              return Promise.resolve({ done: false, value });
            },
          };
        },
      },
    });
    const res = await requestAIStream({
      messages: [{ role: "user", content: "hi" }],
      settings: { ...DEFAULT_AI_SETTINGS, baseUrl: "https://x/v1", apiKey: "k" },
    });
    assert.equal(res.ok, true);
    assert.equal(res.content, "hello world");
    assert.equal(res.truncated, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestAIStream: 非截断流 truncated 为 false", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      body: {
        getReader() {
          const encoder = new TextEncoder();
          let done = false;
          return {
            read() {
              if (done) return Promise.resolve({ done: true });
              done = true;
              return Promise.resolve({ done: false, value: encoder.encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n') });
            },
          };
        },
      },
    });
    const res = await requestAIStream({
      messages: [{ role: "user", content: "hi" }],
      settings: { ...DEFAULT_AI_SETTINGS, baseUrl: "https://x/v1", apiKey: "k" },
    });
    assert.equal(res.truncated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildRequestBody: 采样参数 topP/frequencyPenalty/presencePenalty 透传", () => {
  const s = { ...DEFAULT_AI_SETTINGS, topP: 0.8, frequencyPenalty: 0.5, presencePenalty: -0.3 };
  const body = buildRequestBody([{ role: "user", content: "hi" }], s, false);
  assert.equal(body.top_p, 0.8);
  assert.equal(body.frequency_penalty, 0.5);
  assert.equal(body.presence_penalty, -0.3);
});

test("buildRequestBody: 未配置采样参数时不透传", () => {
  const s = { ...DEFAULT_AI_SETTINGS };
  delete s.topP;
  delete s.frequencyPenalty;
  delete s.presencePenalty;
  const body = buildRequestBody([{ role: "user", content: "hi" }], s, false);
  assert.equal(body.top_p, undefined);
  assert.equal(body.frequency_penalty, undefined);
  assert.equal(body.presence_penalty, undefined);
});

