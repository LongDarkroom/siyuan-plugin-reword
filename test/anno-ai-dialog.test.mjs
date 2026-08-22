/**
 * 批注 AI 助手小弹窗单测（2026-08-22）
 * 覆盖三块纯函数：
 *  1. buildAnnoAiUserMessage：用户消息拼装
 *  2. parseAnnoAiContext：上下文容错解析
 *  3. renderAnnoAiDialogHtml：弹窗 HTML 模板（含边界态）
 *  + ANNO_AI_SYSTEM_PROMPT：常量存在 + 关键约束
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnnoAiUserMessage,
  parseAnnoAiContext,
  renderAnnoAiDialogHtml,
  ANNO_AI_SYSTEM_PROMPT,
} from "../src/ai/anno-ai-dialog.ts";

// 简易 esc(与 anno-ai-dialog 内部 esc 同语义,够用)
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

// ============ ANNO_AI_SYSTEM_PROMPT ============

test("AI 助手系统提示词:常量存在且含 REword 身份标识", () => {
  assert.ok(typeof ANNO_AI_SYSTEM_PROMPT === "string" && ANNO_AI_SYSTEM_PROMPT.length > 0);
  assert.match(ANNO_AI_SYSTEM_PROMPT, /REword/);
  assert.match(ANNO_AI_SYSTEM_PROMPT, /批注|笔记/);
});

test("AI 助手系统提示词:明确禁止 Markdown 包装", () => {
  assert.match(ANNO_AI_SYSTEM_PROMPT, /纯文本/);
  assert.match(ANNO_AI_SYSTEM_PROMPT, /不要 Markdown/);
});

test("AI 助手系统提示词:说明批注草稿风格与长度", () => {
  assert.match(ANNO_AI_SYSTEM_PROMPT, /1~3 段|简短|简洁/);
});

// ============ parseAnnoAiContext ============

test("parseAnnoAiContext:三字段都正常时全部返回", () => {
  const out = parseAnnoAiContext({
    selectedText: "mastery",
    sentence: "mastery of the skill",
    existingNote: "老批注",
  });
  assert.equal(out.userSelectedText, "mastery");
  assert.equal(out.sentenceContext, "mastery of the skill");
  assert.equal(out.currentNote, "老批注");
});

test("parseAnnoAiContext:null/undefined 容错为空串", () => {
  const out = parseAnnoAiContext({
    selectedText: null,
    sentence: undefined,
    existingNote: null,
  });
  assert.equal(out.userSelectedText, "");
  assert.equal(out.sentenceContext, "");
  assert.equal(out.currentNote, "");
});

test("parseAnnoAiContext:前后空白自动 trim", () => {
  const out = parseAnnoAiContext({
    selectedText: "  mastery  ",
    sentence: "  mastery of the skill  ",
    existingNote: "  老批注  ",
  });
  assert.equal(out.userSelectedText, "mastery");
  assert.equal(out.sentenceContext, "mastery of the skill");
  assert.equal(out.currentNote, "老批注");
});

test("parseAnnoAiContext:缺失字段也安全(只传 selectedText)", () => {
  const out = parseAnnoAiContext({ selectedText: "word" });
  assert.equal(out.userSelectedText, "word");
  assert.equal(out.sentenceContext, "");
  assert.equal(out.currentNote, "");
});

// ============ buildAnnoAiUserMessage ============

test("buildAnnoAiUserMessage:四字段都齐时全部出现且按顺序", () => {
  const msg = buildAnnoAiUserMessage({
    selectedText: "mastery",
    sentence: "mastery of the skill",
    existingNote: "老批注",
    question: "翻译成中文",
  });
  const i1 = msg.indexOf("【选中片段】");
  const i2 = msg.indexOf("【上下文】");
  const i3 = msg.indexOf("【当前批注】");
  const i4 = msg.indexOf("【我的问题】");
  assert.ok(i1 >= 0 && i2 > i1 && i3 > i2 && i4 > i3, "四块应按固定顺序排列");
  assert.ok(msg.includes("mastery"));
  assert.ok(msg.includes("翻译成中文"));
});

test("buildAnnoAiUserMessage:无 question 且无 existingNote 时给新建提示", () => {
  const msg = buildAnnoAiUserMessage({
    selectedText: "ephemeral",
    sentence: "ephemeral joy",
  });
  assert.match(msg, /当前批注[\s\S]*空[\s\S]*新建/);
  assert.match(msg, /请基于选中片段写一段批注/);
});

test("buildAnnoAiUserMessage:无 question 但有 existingNote 时不补默认问题", () => {
  const msg = buildAnnoAiUserMessage({
    selectedText: "ephemeral",
    sentence: "ephemeral joy",
    existingNote: "已有批注:短暂的",
  });
  assert.match(msg, /【当前批注】\n已有批注/);
  // 不应自动生成"请基于选中片段写一段批注"
  assert.doesNotMatch(msg, /请基于选中片段写一段批注/);
});

test("buildAnnoAiUserMessage:sentence 与 selectedText 相同时省略【上下文】", () => {
  const msg = buildAnnoAiUserMessage({
    selectedText: "mastery",
    sentence: "mastery",
    existingNote: "",
    question: "解释",
  });
  assert.doesNotMatch(msg, /【上下文】/, "sentence 与 selectedText 重复时不应单独展示上下文");
});

test("buildAnnoAiUserMessage:仅 selectedText + question 时只输出两块", () => {
  const msg = buildAnnoAiUserMessage({
    selectedText: "word",
    question: "解释",
  });
  assert.match(msg, /【选中片段】/);
  assert.match(msg, /【我的问题】/);
  // 没有上下文,没有当前批注(空也要占位)
  assert.match(msg, /【当前批注】/);
});

test("buildAnnoAiUserMessage:全部为空时仍输出当前批注占位块", () => {
  const msg = buildAnnoAiUserMessage({});
  assert.match(msg, /【当前批注】/);
  assert.match(msg, /空.*新建/);
});

test("buildAnnoAiUserMessage:用户问题包含换行/特殊字符时原样保留", () => {
  const msg = buildAnnoAiUserMessage({
    selectedText: "foo",
    question: "Line1\nLine2",
  });
  assert.ok(msg.includes("Line1\nLine2"));
});

// ============ renderAnnoAiDialogHtml ============

test("renderAnnoAiDialogHtml:含主要结构(head/context/textarea/actions/reply)", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "word", existingNote: "note", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.match(html, /class="hiword-anno-ai-popup"|class="hiword-anno-ai-dialog"/);
  assert.match(html, /id="hiword-anno-ai-close"/);
  assert.match(html, /id="hiword-anno-ai-input"/);
  assert.match(html, /id="hiword-anno-ai-send"/);
  assert.match(html, /id="hiword-anno-ai-cancel"/);
  assert.match(html, /id="hiword-anno-ai-copy"/);
  assert.match(html, /id="hiword-anno-ai-fill"/);
  assert.match(html, /id="hiword-anno-ai-clear"/);
  assert.match(html, /id="hiword-anno-ai-reply"/);
});

test("renderAnnoAiDialogHtml:无 API Key 时显示警告 + 打开设置按钮", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: false, isStreaming: false, reply: "" },
    esc
  );
  assert.match(html, /hiword-anno-ai-nokey/);
  assert.match(html, /未配置 AI 服务/);
  assert.match(html, /id="hiword-anno-ai-open-settings"/);
});

test("renderAnnoAiDialogHtml:有 API Key 时不显示警告", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.doesNotMatch(html, /hiword-anno-ai-nokey/);
});

test("renderAnnoAiDialogHtml:流式中时发送按钮禁用 + 文案变化", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: true, reply: "半截" },
    esc
  );
  assert.match(html, /id="hiword-anno-ai-send"[^>]*disabled/);
  assert.match(html, /生成中\.\.\./);
  assert.match(html, /id="hiword-anno-ai-cancel"[^>]*(?<!disabled)/);
});

test("renderAnnoAiDialogHtml:有 reply 但未流式时填回批注按钮可用", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "完整回复" },
    esc
  );
  assert.match(html, /id="hiword-anno-ai-fill"[^>]*(?<!disabled)/);
  assert.doesNotMatch(html, /id="hiword-anno-ai-fill"[^>]*disabled/);
});

test("renderAnnoAiDialogHtml:无 reply 时填回批注按钮禁用", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.match(html, /id="hiword-anno-ai-fill"[^>]*disabled/);
});

test("renderAnnoAiDialogHtml:无 reply 时复制按钮也禁用", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.match(html, /id="hiword-anno-ai-copy"[^>]*disabled/);
});

test("renderAnnoAiDialogHtml:HTML 转义防 XSS(选中文字 + 现有批注)", () => {
  const html = renderAnnoAiDialogHtml(
    {
      selectedText: '<script>alert("xss")</script>',
      existingNote: "<img onerror=x>",
      hasApiKey: true,
      isStreaming: false,
      reply: "<b>bold</b>",
    },
    esc
  );
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img onerror=x>/);
  assert.match(html, /&lt;img onerror=x&gt;/);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
});

test("renderAnnoAiDialogHtml:existingNote 为空时显示占位文案", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.match(html, /hiword-anno-ai-context-value--empty/);
  assert.match(html, /（空）/);
});

test("renderAnnoAiDialogHtml:reply 文本出现(转义后)在回复区", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "这是 AI 回复" },
    esc
  );
  assert.match(html, /id="hiword-anno-ai-reply"[^>]*>这是 AI 回复</);
});
