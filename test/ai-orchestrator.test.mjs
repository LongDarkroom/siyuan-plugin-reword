import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepareDeepReadInput,
  runAiDeepRead,
  runAiChat,
  parseAiResult,
  normalizeDeepRead,
  continueTruncatedGen,
} from "../src/ai/ai-orchestrator.ts";
import { DEFAULT_AI_SETTINGS } from "../src/ai/ai-settings.ts";

test("prepareDeepReadInput: 自动去标记、提取高亮、分句", () => {
  const input = prepareDeepReadInput({
    title: "Unit 1",
    text: "==apple== is red. **banana** is yellow.",
  });
  assert.equal(input.title, "Unit 1");
  assert.equal(input.text, "apple is red. banana is yellow.");
  assert.deepEqual(input.highlights, ["apple", "banana"]);
  assert.equal(input.sentences.length, 2);
});

test("normalizeDeepRead: 规整结构化结果", () => {
  const obj = {
    words: [{ word: "apple", meaning: "苹果" }],
    sentences: [{ sentence: "Apple is red.", translation: "苹果是红的。" }],
    summary: "水果主题。",
  };
  const r = normalizeDeepRead(obj, JSON.stringify(obj), "gpt-4o-mini");
  assert.equal(r.isJson, true);
  assert.equal(r.words.length, 1);
  assert.equal(r.words[0].meaning, "苹果");
  assert.equal(r.sentences.length, 1);
  assert.equal(r.summary, "水果主题。");
  assert.equal(r.model, "gpt-4o-mini");
});

test("parseAiResult: JSON 失败优雅降级为 markdown", () => {
  const r = parseAiResult("# Title\nplain markdown", true);
  assert.equal(r.isJson, false);
  assert.equal(r.raw, "# Title\nplain markdown");
});

test("runAiDeepRead: mock 返回结构化 JSON，解析为 deep read", async () => {
  const transport = async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({
      model: "gpt-4o-mini",
      choices: [{
        message: {
          content: JSON.stringify({
            words: [{ word: "apple", meaning: "苹果" }],
            sentences: [{ sentence: "Apple is red.", translation: "苹果是红的。" }],
            summary: "ok",
          }),
        },
      }],
    }),
  });
  const res = await runAiDeepRead(
    { title: "T", text: "Apple is red." },
    { ...DEFAULT_AI_SETTINGS, model: "gpt-4o-mini" },
    { transport }
  );
  assert.equal(res.ok, true);
  assert.equal(res.isJson, true);
  assert.equal(res.words.length, 1);
  assert.equal(res.words[0].word, "apple");
  assert.equal(res.sentences.length, 1);
});

test("runAiDeepRead: 网络异常返回 ok=false 与 error", async () => {
  const transport = async () => { throw new Error("network down"); };
  const res = await runAiDeepRead(
    { text: "hi" },
    { ...DEFAULT_AI_SETTINGS },
    { transport }
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /network down/);
});

test("runAiDeepRead: jsonMode 失败时回退补全高亮词语境", async () => {
  const transport = async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ choices: [{ message: { content: "这不是合法 JSON {" } }] }),
  });
  const res = await runAiDeepRead(
    { title: "T", text: "Apple is red.", highlights: ["apple"], sentences: ["Apple is red."] },
    { ...DEFAULT_AI_SETTINGS, jsonMode: true },
    { transport }
  );
  assert.equal(res.isJson, false);
  // 兜底：把高亮词 + 语境补进 words
  assert.equal(res.words.length, 1);
  assert.equal(res.words[0].word, "apple");
  assert.equal(res.words[0].context, "Apple is red.");
});

test("runAiChat: 对话模式直出 markdown，注入 system 并用 user_input 包裹用户消息", async () => {
  let capturedMessages = null;
  const transport = async (req) => {
    capturedMessages = JSON.parse(req.body).messages;
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        model: "gpt-4o-mini",
        choices: [{ message: { content: "你好，我明白了。" } }],
      }),
    };
  };
  const messages = [
    { role: "system", content: "" },
    { role: "user", content: "解释一下这句话" },
    { role: "assistant", content: "好的。" },
    { role: "user", content: "那这句呢" },
  ];
  const res = await runAiChat(messages, { ...DEFAULT_AI_SETTINGS, model: "gpt-4o-mini" }, { transport });
  assert.equal(res.ok, true);
  assert.equal(res.isJson, false);
  // 2026-08-21 精简：res.mode 字段已删除
  assert.equal(res.raw, "你好，我明白了。");
  assert.equal(res.words.length, 0);
  assert.equal(res.sentences.length, 0);
  // 2026-09-04 P0-1：空 system 被丢弃并替换为对话版 system（含角色与禁止续写约束）
  assert.equal(capturedMessages.length, 4);
  assert.equal(capturedMessages[0].role, "system");
  assert.match(capturedMessages[0].content, /英语学习助手/);
  assert.match(capturedMessages[0].content, /禁止续写/);
  // 2026-09-04 P0-2：user 消息被标签包裹，assistant 消息保持原样，历史条数不变
  assert.equal(capturedMessages[1].content, "<user_input>\n解释一下这句话\n</user_input>");
  assert.equal(capturedMessages[2].content, "好的。");
  assert.equal(capturedMessages[3].content, "<user_input>\n那这句呢\n</user_input>");
});

test("runAiChat [P0-1]: 调用方已带 system 时不覆盖", async () => {
  let capturedMessages = null;
  const transport = async (req) => {
    capturedMessages = JSON.parse(req.body).messages;
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({ model: "x", choices: [{ message: { content: "ok" } }] }),
    };
  };
  await runAiChat(
    [{ role: "system", content: "自定义提示词" }, { role: "user", content: "hi" }],
    { ...DEFAULT_AI_SETTINGS },
    { transport }
  );
  assert.equal(capturedMessages[0].content, "自定义提示词");
  assert.equal(capturedMessages[1].content, "<user_input>\nhi\n</user_input>");
});

test("runAiChat [P0-3]: 截断不再自动续传，只保留 truncated 标记", async () => {
  const calls = [];
  const transport = async (req) => {
    const body = JSON.parse(req.body);
    calls.push(body.messages.length);
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        model: "gpt-4o-mini",
        choices: [{ message: { content: "前半段" }, finish_reason: "length" }],
      }),
    };
  };
  const res = await runAiChat(
    [{ role: "user", content: "翻译一下" }],
    { ...DEFAULT_AI_SETTINGS, model: "gpt-4o-mini" },
    { transport }
  );
  assert.equal(res.ok, true);
  assert.equal(res.truncated, true);
  assert.equal(res.raw, "前半段");
  // 只有一次请求：不再追加「请从断点处继续输出」的续传轮
  assert.equal(calls.length, 1);
});

test("runAiChat: 网络异常返回 ok=false 与 error", async () => {
  const transport = async () => { throw new Error("timeout"); };
  const res = await runAiChat(
    [{ role: "user", content: "hi" }],
    { ...DEFAULT_AI_SETTINGS },
    { transport }
  );
  assert.equal(res.ok, false);
  // 2026-08-21 精简：res.mode 字段已删除
  assert.match(res.error, /timeout/);
});

test("continueTruncatedGen: 截断时追加续传内容并合并 raw", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      body: {
        getReader() {
          const chunks = [
            'data: {"choices":[{"delta":{"content":"（续传）"}}]}\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
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
    const merged = await continueTruncatedGen(
      { content: "前半段", raw: "前半段", truncated: true },
      [{ role: "user", content: "hi" }],
      { ...DEFAULT_AI_SETTINGS },
      { maxRounds: 1 }
    );
    assert.equal(merged.content, "前半段（续传）");
    assert.equal(merged.raw, "前半段（续传）");
    assert.equal(merged.truncated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 2026-08-22 修复 4.2 回归测试：reasoning 拼接的运算符优先级
// 旧实现 `streamRes.reasoning ? (current.reasoning || "") + streamRes.reasoning : current.reasoning`
// 依赖 `(current.reasoning || "")` 的外层括号;一旦括号被删,
// JS 优先级让表达式解析为 `current.reasoning || ("" + streamRes.reasoning)`,
// 在 current.reasoning 已 truthy 时整段只返回 current.reasoning,丢失新轮 reasoning。
// 以下三个测试覆盖三种边界,任何一个回归即破。

/**
 * 构造一个 SSE 响应(单条 delta),由 transport / fetch 注入。
 */
function makeSseResponse(deltas) {
  const lines = deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n`).join("");
  return {
    ok: true,
    body: {
      getReader() {
        const encoder = new TextEncoder();
        let i = 0;
        const chunks = [lines];
        return {
          read() {
            if (i >= chunks.length) return Promise.resolve({ done: true });
            const value = encoder.encode(chunks[i++]);
            return Promise.resolve({ done: false, value });
          },
        };
      },
    },
  };
}

test("continueTruncatedGen [4.2 修复]:两轮都带 reasoning 时正确拼接为 R1R2", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      makeSseResponse([
        { reasoning_content: "R2 续传思考", content: "续传内容" },
        {},
      ]);
    const merged = await continueTruncatedGen(
      { content: "前段", raw: "前段", reasoning: "R1 起始思考", truncated: true },
      [{ role: "user", content: "hi" }],
      { ...DEFAULT_AI_SETTINGS },
      { maxRounds: 1 }
    );
    // 旧实现若括号丢失,此处会等于 "R1 起始思考"(丢失 R2 续传思考)
    assert.equal(merged.reasoning, "R1 起始思考R2 续传思考", "两轮 reasoning 应拼接");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("continueTruncatedGen [4.2 修复]:续传轮 reasoning 为空(undefined)时保留首轮 reasoning", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // 注意 delta 里完全没有 reasoning_content 字段 → streamRes.reasoning = undefined
    globalThis.fetch = async () =>
      makeSseResponse([{ content: "续传内容" }, {}]);
    const merged = await continueTruncatedGen(
      { content: "前段", raw: "前段", reasoning: "R1 仅首轮", truncated: true },
      [{ role: "user", content: "hi" }],
      { ...DEFAULT_AI_SETTINGS },
      { maxRounds: 1 }
    );
    // 不应被 undefined 覆盖,也不应拼出 "R1 仅首轮undefined"
    assert.equal(merged.reasoning, "R1 仅首轮", "续传轮无 reasoning 时保留首轮");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("continueTruncatedGen [4.2 修复]:首轮无 reasoning / 续传轮带 reasoning → 直接采用续传轮", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      makeSseResponse([
        { reasoning_content: "R2 唯续传轮", content: "续传" },
        {},
      ]);
    const merged = await continueTruncatedGen(
      // 首轮 reasoning 缺失(undefined),内容被截断
      { content: "前段", raw: "前段", truncated: true },
      [{ role: "user", content: "hi" }],
      { ...DEFAULT_AI_SETTINGS },
      { maxRounds: 1 }
    );
    // 不应拼出 "undefinedR2 唯续传轮",应得到纯 R2
    assert.equal(merged.reasoning, "R2 唯续传轮", "首轮无 reasoning 时不应拼出 'undefined'");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runAiDeepRead: 截断时自动续传并合并，结果完整", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // 第一次请求（非流式）：finish_reason=length，JSON 被截断（末尾未闭合）
    const transport = async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        model: "gpt-4o-mini",
        choices: [{
          finish_reason: "length",
          message: { content: '{"words":[],"sentences":[]' },
        }],
      }),
    });
    // 续传请求（流式）：补上剩余内容（从断点接续，最终拼成完整 JSON）
    globalThis.fetch = async () => ({
      ok: true,
      body: {
        getReader() {
          const chunks = [
            'data: {"choices":[{"delta":{"content":",\\"summary\\":\\"苹果是红的。\\"}"}}]}\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
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
    const res = await runAiDeepRead(
      { text: "Apple is red." },
      { ...DEFAULT_AI_SETTINGS, model: "gpt-4o-mini", jsonMode: true, autoContinue: true },
      { transport }
    );
    assert.equal(res.ok, true);
    // 合并后 raw 完整，能解析出 summary
    assert.equal(res.truncated, false);
    assert.equal(res.summary, "苹果是红的。");
    assert.match(res.raw, /苹果是红的/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

