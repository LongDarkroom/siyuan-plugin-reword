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
  extractReplyText,
  applyAnnoAiCollapsedState,
  computeAnnoAiInitialCollapsed,
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

test("renderAnnoAiDialogHtml:含主要结构(head/reply/textarea/selmenu)", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "word", existingNote: "note", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.match(html, /class="hiword-anno-ai-popup"|class="hiword-anno-ai-dialog"/);
  assert.match(html, /id="hiword-anno-ai-close"/);
  assert.match(html, /id="hiword-anno-ai-input"/);
  assert.match(html, /id="hiword-anno-ai-reply"/);
  assert.match(html, /id="hiword-anno-ai-selmenu"/);
  // 2026-08-22 改：5 个按钮（清空/复制回复/取消/发送/填回批注）已移除,改用回车+settings 菜单
  assert.doesNotMatch(html, /id="hiword-anno-ai-clear"/, "清空按钮已移除");
  assert.doesNotMatch(html, /id="hiword-anno-ai-copy"/, "复制回复按钮已移除");
  assert.doesNotMatch(html, /id="hiword-anno-ai-cancel"/, "取消按钮已移除");
  assert.doesNotMatch(html, /id="hiword-anno-ai-send"/, "发送按钮已移除");
  assert.doesNotMatch(html, /id="hiword-anno-ai-fill"/, "填回批注按钮已移除");
  // 新增：settings 按钮(填回批注设置菜单入口)
  assert.match(html, /id="hiword-anno-ai-settings"/, "应有 settings 按钮");
  assert.match(html, /id="hiword-anno-ai-settings-menu"/, "应有 settings 菜单");
  // 新增：8 向 resize 手柄
  assert.match(html, /hiword-anno-ai-resize-handle--nw/);
  assert.match(html, /hiword-anno-ai-resize-handle--se/);
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

test("renderAnnoAiDialogHtml:2026-08-22 改-回车发送占位文本(流式中再按回车取消)", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.match(html, /placeholder[^>]*回车发送/);
  assert.match(html, /placeholder[^>]*流式中回车取消/);
});

test("renderAnnoAiDialogHtml:2026-08-22 改-不再含 复制回复/取消/发送 按钮(回车键替代)", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "完整回复" },
    esc
  );
  assert.doesNotMatch(html, /id="hiword-anno-ai-copy"/, "复制回复按钮已移除");
  assert.doesNotMatch(html, /id="hiword-anno-ai-cancel"/, "取消按钮已移除");
  assert.doesNotMatch(html, /id="hiword-anno-ai-send"/, "发送按钮已移除");
});

test("renderAnnoAiDialogHtml:2026-08-22 改-填回批注改用 settings 菜单(无独立按钮)", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "完整回复" },
    esc
  );
  assert.doesNotMatch(html, /id="hiword-anno-ai-fill"/, "填回批注独立按钮已移除");
  // settings 菜单里有两个选项
  assert.match(html, /hiword-anno-ai-settings-menu[\s\S]*?data-fill="all"[\s\S]*?填入全部回复/);
  assert.match(html, /hiword-anno-ai-settings-menu[\s\S]*?data-fill="selection"[\s\S]*?填入选中部分/);
});

test("renderAnnoAiDialogHtml:HTML 转义防 XSS(选中文字 + 现有批注)", () => {
  // 2026-08-22 改：selectedText/existingNote 不再注入 HTML(去重后只剩 dialog 标题),
  // 这里改为测试 reply 文本不被注入(虽然 Lute 渲染时也 escape,模板层也保险)
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
  // 模板里 reply 不直接写 HTML(由 Lute 渲染负责)
  // 但应不出现未转义的 selectedText / existingNote
  assert.doesNotMatch(html, /<script>alert/, "selectedText 注入应被 esc 防御或干脆不渲染");
  assert.doesNotMatch(html, /<img onerror=x>/, "existingNote 注入应被防御");
});

// ============ 2026-08-22 新增：去重 + chevron + 选区菜单 ============

test("renderAnnoAiDialogHtml:2026-08-22 改-不再输出 hiword-anno-ai-context 上下文块(去重)", () => {
  // 用独特字符串 selectedText_UNIQUE_42 便于断言"确实没出现"
  const html = renderAnnoAiDialogHtml(
    { selectedText: "selectedText_UNIQUE_42", existingNote: "existingNote_UNIQUE_99", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.doesNotMatch(html, /hiword-anno-ai-context/);
  assert.doesNotMatch(html, /hiword-anno-ai-context-line/);
  assert.doesNotMatch(html, /hiword-anno-ai-context-label/);
  assert.doesNotMatch(html, /hiword-anno-ai-context-value/);
  assert.doesNotMatch(html, /hiword-anno-ai-context-value--empty/);
  // selectedText 和 existingNote 也不应再出现(去重)
  assert.doesNotMatch(html, /selectedText_UNIQUE_42/, "selectedText 不应在 HTML 中出现");
  assert.doesNotMatch(html, /existingNote_UNIQUE_99/, "existingNote 不应在 HTML 中出现");
  assert.doesNotMatch(html, /现有批注/, "「现有批注」label 不应再渲染");
  assert.doesNotMatch(html, />选中</, "「选中」label 不应再渲染");
});

test("renderAnnoAiDialogHtml:2026-08-22 新增-含 chevron 按钮 #hiword-anno-ai-resizer-toggle", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.match(html, /id="hiword-anno-ai-resizer"/);
  assert.match(html, /id="hiword-anno-ai-resizer-toggle"/);
  assert.match(html, /class="hiword-anno-ai-resizer"/);
  assert.match(html, /class="hiword-anno-ai-resizer-toggle"/);
  // 默认字符是 ▾(展开态)
  assert.match(html, /hiword-anno-ai-resizer-toggle[^>]*>▾/);
  assert.match(html, /aria-label="收起输入区"/);
});

test("renderAnnoAiDialogHtml:2026-08-22 新增-含选区菜单 #hiword-anno-ai-selmenu(默认 hidden)", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.match(html, /id="hiword-anno-ai-selmenu"/);
  assert.match(html, /style="display:none"/, "选区菜单默认 display:none");
  assert.match(html, /data-fill="all">全部填入</);
  assert.match(html, /data-fill="selection">选取填入</);
});

test("renderAnnoAiDialogHtml:2026-08-22 改-标题从「AI 批注助手」改为「微阅批注助手」", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.match(html, /class="hiword-anno-ai-title">🤖 微阅批注助手</);
  assert.doesNotMatch(html, /AI 批注助手</, "应不含旧标题「AI 批注助手」");
});

test("renderAnnoAiDialogHtml:2026-08-22 改-含 footer 包裹 textarea+actions(两段式布局)", () => {
  const html = renderAnnoAiDialogHtml(
    { selectedText: "w", existingNote: "", hasApiKey: true, isStreaming: false, reply: "" },
    esc
  );
  assert.match(html, /id="hiword-anno-ai-footer"/);
  // textarea 应在 footer 内
  assert.match(html, /<div class="hiword-anno-ai-footer"[\s\S]*?id="hiword-anno-ai-input"[\s\S]*?<\/div>\s*<\/div>/);
});

// ============ 2026-08-22 新增：纯函数 extractReplyText ============

test("extractReplyText:2026-08-22 新增-all 模式取纯文本(去标签 + 过滤 NBSP + trim)", () => {
  // 已渲染的 HTML(模拟 Lute 输出) —— 段间用 </p> 换行
  const html = "<p>这是 <strong>AI</strong> 回复</p><p>第二段</p>";
  const text = extractReplyText(html, "", "all");
  // 段间换行 + 段内单空格
  assert.equal(text, "这是 AI 回复\n第二段");
  assert.ok(!text.includes("<"), "不应有 HTML 标签");
});

test("extractReplyText:2026-08-22 新增-all 模式过滤 NBSP(不间断空格 → 普通空格)", () => {
  // &nbsp; 是 NBSP, 模拟 Lute 渲染输出
  const html = "foo&nbsp;bar";
  const text = extractReplyText(html, "", "all");
  assert.equal(text, "foo bar");
});

test("extractReplyText:2026-08-22 新增-all 模式空内容返回空串", () => {
  assert.equal(extractReplyText("", "", "all"), "");
  assert.equal(extractReplyText("<p></p>", "", "all"), "");
});

test("extractReplyText:2026-08-22 新增-selection 模式取选中文本(过滤 NBSP + trim)", () => {
  const selText = "  VS code  ";
  const text = extractReplyText("", selText, "selection");
  assert.equal(text, "VS code");
});

test("extractReplyText:2026-08-22 新增-selection 模式 NBSP → 普通空格", () => {
  const selText = "foo\u00A0bar";
  const text = extractReplyText("", selText, "selection");
  assert.equal(text, "foo bar");
});

test("extractReplyText:2026-08-22 新增-selection 模式空选区返回空串", () => {
  assert.equal(extractReplyText("", "", "selection"), "");
  assert.equal(extractReplyText("", "   ", "selection"), "");
});

// ============ 2026-08-22 新增：纯函数 computeAnnoAiInitialCollapsed ============

test("computeAnnoAiInitialCollapsed:localStorage=「true」时返回 true", () => {
  const store = { getItem: (k) => k === "hiword-anno-ai-collapsed" ? "true" : null };
  assert.equal(computeAnnoAiInitialCollapsed(store), true);
});

test("computeAnnoAiInitialCollapsed:localStorage=「false」或缺时返回 false(默认展开)", () => {
  const store1 = { getItem: (k) => k === "hiword-anno-ai-collapsed" ? "false" : null };
  assert.equal(computeAnnoAiInitialCollapsed(store1), false);
  const store2 = { getItem: () => null };
  assert.equal(computeAnnoAiInitialCollapsed(store2), false);
});

test("computeAnnoAiInitialCollapsed:localStorage 抛错时返回 false(隐私模式等)", () => {
  const store = { getItem: () => { throw new Error("blocked"); } };
  assert.equal(computeAnnoAiInitialCollapsed(store), false);
});

// ============ 2026-08-22 新增：applyAnnoAiCollapsedState(DOM 操作,源码结构测试) ============

test("applyAnnoAiCollapsedState:源码导出该函数 + 处理 collapsed 状态(classList+chevron)", async () => {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile("src/ai/anno-ai-dialog.ts", "utf8");
  assert.match(src, /export function applyAnnoAiCollapsedState/);
  // 关键 DOM 操作分支
  assert.match(src, /hiword-anno-ai-dialog--collapsed/, "应切换 --collapsed class");
  assert.match(src, /aria-label.*展开输入区|aria-label.*收起输入区/, "应切换 aria-label");
  assert.match(src, /▴/, "收起态应切到 ▴");
  assert.match(src, /▾/, "展开态应切到 ▾");
  // 写 localStorage
  assert.match(src, /localStorage\.setItem\("hiword-anno-ai-collapsed"/, "应写 localStorage");
});

test("applyAnnoAiCollapsedState:源码处理 lastFooterHeight(展开时恢复)", async () => {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile("src/ai/anno-ai-dialog.ts", "utf8");
  assert.match(src, /lastFooterHeight/, "应接受 lastFooterHeight 参数");
  assert.match(src, /maxHeight.*lastFooterHeight|footer\.style\.maxHeight.*=.*`?\$\{?lastFooterHeight/, "应把 lastFooterHeight 写入 footer maxHeight");
});

// ============ 2026-08-22 改:AnnoAiDialogOptions 接受 parentDialog(贴父批注弹窗) ============

test("2026-08-22 改:AnnoAiDialogOptions 含 parentDialog?: HTMLElement(贴父批注弹窗定位)", async () => {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile("src/ai/anno-ai-dialog.ts", "utf8");
  assert.match(src, /parentDialog\?: HTMLElement;/, "AnnoAiDialogOptions 应有 parentDialog?: HTMLElement");
});

test("2026-08-22 改:positionPopup 在有 parentDialog 时按 父右→父下→父左→父上 贴边", async () => {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile("src/ai/anno-ai-dialog.ts", "utf8");
  // 提取 positionPopup 函数体
  const fnMatch = src.match(/const positionPopup = \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(fnMatch, "应能找到 positionPopup 函数");
  // 四方向候选空间
  assert.match(fnMatch[0], /spaceRight/, "应有 spaceRight");
  assert.match(fnMatch[0], /spaceBottom/, "应有 spaceBottom");
  assert.match(fnMatch[0], /spaceLeft/, "应有 spaceLeft");
  assert.match(fnMatch[0], /spaceTop/, "应有 spaceTop");
  // 父弹窗有的话,优先用父的 getBoundingClientRect
  assert.match(fnMatch[0], /parent\.getBoundingClientRect/, "parent 应参与定位");
  // 兜底:父周围都没空间时居中偏上
  assert.match(fnMatch[0], /居中偏上|50%|\(window\.innerWidth - w\)/, "应保留居中偏上兜底");
});
