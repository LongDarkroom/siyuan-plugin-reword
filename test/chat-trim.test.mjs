import { test } from "node:test";
import assert from "node:assert/strict";
import { trimChatHistory } from "../src/ai/chat-trim.ts";

// 构造 N 轮（user+assistant）消息，每条内容等长，便于按 token 估算推算
function turns(n, perContent) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ role: "user", content: perContent });
    out.push({ role: "assistant", content: perContent });
  }
  return out;
}

test("零开销路径：预算与条数均满足时原样返回（含引用同一数组）", () => {
  const msgs = turns(2, "hello");
  const res = trimChatHistory(msgs, { maxTokens: 10000, keepRecentRatio: 0.6, maxMessages: 24 });
  assert.equal(res, msgs, "未超预算应返回同一引用，零拷贝");
});

test("超 token 预算：从最旧整轮丢弃，保留最近上下文", () => {
  // 每条约 100 token（400 个 a ≈ 100 token）；6 轮共 ~1200 token
  const msgs = turns(6, "a".repeat(400));
  const res = trimChatHistory(msgs, { maxTokens: 200, keepRecentRatio: 0.6, maxMessages: 24 });
  // 预算 = 200*0.6 = 120；逐对丢弃直到 <=120（仅剩最后 1 对 ~200 token 时停止，因再丢为空）
  assert.equal(res.length, 2, "应保留最近 1 对");
  assert.equal(res[0].role, "user", "保留段必须以 user 开头");
  assert.ok(res[0].content.includes("已省略最早"), "应前置省略摘要");
  assert.ok(res[0].content.includes("a".repeat(400)), "摘要应拼接在被保留消息正文前");
});

test("超条数上限：即使 token 在预算内也按 maxMessages 裁剪", () => {
  // 每条仅几个字符（token 极少），30 轮共 60 条，远超 maxMessages=8
  const msgs = turns(30, "hi");
  const res = trimChatHistory(msgs, { maxTokens: 100000, keepRecentRatio: 0.6, maxMessages: 8 });
  assert.equal(res.length, 8, "应裁剪到 maxMessages 条（4 轮）");
  assert.equal(res[0].role, "user");
  assert.ok(res[0].content.includes("已省略最早"), "应前置省略摘要");
});

test("永不返回空数组：极端情况下至少保留最近 1 对", () => {
  const msgs = turns(1, "a".repeat(4000));
  const res = trimChatHistory(msgs, { maxTokens: 10, keepRecentRatio: 0.6, maxMessages: 1 });
  assert.ok(res.length >= 2, "至少保留最近 1 对，不返回空");
});

test("keepRecentRatio 生效：比例越小保留越少", () => {
  const msgs = turns(8, "a".repeat(400));
  const wide = trimChatHistory(msgs, { maxTokens: 400, keepRecentRatio: 0.9, maxMessages: 100 });
  const narrow = trimChatHistory(msgs, { maxTokens: 400, keepRecentRatio: 0.3, maxMessages: 100 });
  assert.ok(narrow.length <= wide.length, "比例更小时保留应更少或相等");
});

test("交替结构保持：保留段严格 user/assistant 交替", () => {
  const msgs = turns(6, "a".repeat(400));
  const res = trimChatHistory(msgs, { maxTokens: 200, keepRecentRatio: 0.6, maxMessages: 24 });
  for (let i = 0; i < res.length; i++) {
    assert.equal(res[i].role, i % 2 === 0 ? "user" : "assistant", `位置 ${i} 角色应符合交替`);
  }
});
