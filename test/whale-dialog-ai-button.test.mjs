/**
 * 鲸鱼批注弹窗 AI 按钮 + prefillNote 集成单测（2026-08-22）
 *
 * 覆盖：
 *  - buildWhaleDialogHtml: 底部含 🤖 AI 按钮(在「只上色」前)
 *  - buildWhaleDialogHtml: prefillNote 优先级 > existing.note
 *  - buildWhaleDialogHtml: prefillNote 与 existing.note 共存时 prefillNote 优先
 *  - buildWhaleDialogHtml: existing 无 note 但有 prefillNote → 隐藏字段写入 prefillNote
 *  - buildWhaleDialogHtml: prefillNote 为空字符串时回退到 existing.note
 *  - buildWhaleDialogHtml: prefillNote 与 existing 都不存在 → 隐藏字段为空
 *  - IWhaleHost 接口签名:含 getAiSettings / openAiSettings / openAnnoAiDialog 三个新方法
 *    (静态编译期校验)
 *  - HTML 转义: prefillNote 含 XSS 字符时正确转义
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildWhaleDialogHtml } from "../src/annotation/whale-manager.ts";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

const baseOpts = {
  selectedText: "mastery",
  sentence: "mastery in sentence",
  blockId: "b1",
  docId: "d1",
};

// ============ 🤖 AI 按钮存在性 ============

test("弹窗 HTML:底部含 🤖 AI 按钮(2026-08-22 批注 AI 助手)", () => {
  const html = buildWhaleDialogHtml(baseOpts, esc);
  assert.match(html, /id="whale-dlg-ai"/, "应含 AI 按钮");
  assert.match(html, /🤖 AI/, "应含 🤖 AI 文案");
});

test("弹窗 HTML:AI 按钮位于「只上色」之前(footer 顺序)", () => {
  const html = buildWhaleDialogHtml(baseOpts, esc);
  const aiIdx = html.indexOf('id="whale-dlg-ai"');
  const annotateOnlyIdx = html.indexOf('id="whale-dlg-annotate-only"');
  const okIdx = html.indexOf('id="whale-dlg-ok"');
  assert.ok(aiIdx > 0 && annotateOnlyIdx > 0 && okIdx > 0, "三个按钮都应存在");
  assert.ok(aiIdx < annotateOnlyIdx, "AI 按钮应在「只上色」之前");
  assert.ok(annotateOnlyIdx < okIdx, "「只上色」应在「保存」之前");
});

test("弹窗 HTML:AI 按钮带 title 提示", () => {
  const html = buildWhaleDialogHtml(baseOpts, esc);
  // title 文本中应含"AI 助手"
  assert.match(html, /title="[^"]*AI 助手[^"]*"/);
});

// ============ prefillNote 优先级 ============

test("prefillNote 优先级:仅 prefillNote 时,隐藏字段写入 prefillNote", () => {
  const html = buildWhaleDialogHtml(
    { ...baseOpts, prefillNote: "AI 生成的批注草稿" },
    esc
  );
  const initMatch = html.match(/id="whale-dlg-note-init" value="([^"]*)"/);
  assert.ok(initMatch, "应能找到 note-init 隐藏字段");
  assert.equal(initMatch[1], "AI 生成的批注草稿");
});

test("prefillNote 优先级:同时存在 prefillNote 与 existing.note 时,prefillNote 胜", () => {
  const html = buildWhaleDialogHtml(
    {
      ...baseOpts,
      prefillNote: "AI 新写的批注",
      existing: {
        id: "a1", blockId: "b1", docId: "d1",
        sentence: "old", selectedText: "mastery",
        note: "老批注内容", origin: "manual",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    esc
  );
  const initMatch = html.match(/id="whale-dlg-note-init" value="([^"]*)"/);
  assert.ok(initMatch, "应能找到 note-init 隐藏字段");
  assert.equal(initMatch[1], "AI 新写的批注", "prefillNote 应覆盖 existing.note");
});

test("prefillNote 优先级:prefillNote 为空字符串时回退到 existing.note", () => {
  const html = buildWhaleDialogHtml(
    {
      ...baseOpts,
      prefillNote: "",
      existing: {
        id: "a1", blockId: "b1", docId: "d1",
        sentence: "old", selectedText: "mastery",
        note: "老批注", origin: "manual",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    esc
  );
  const initMatch = html.match(/id="whale-dlg-note-init" value="([^"]*)"/);
  assert.ok(initMatch, "应能找到 note-init 隐藏字段");
  assert.equal(initMatch[1], "老批注", "空字符串 prefillNote 应被忽略,回退到 existing.note");
});

test("prefillNote 优先级:都无 → 隐藏字段为空(批注内容默认空白)", () => {
  const html = buildWhaleDialogHtml(baseOpts, esc);
  const initMatch = html.match(/id="whale-dlg-note-init" value="([^"]*)"/);
  assert.ok(initMatch, "应能找到 note-init 隐藏字段");
  assert.equal(initMatch[1], "", "默认应为空(原有行为保持不变)");
});

test("prefillNote HTML 转义:含 < > & 字符时正确转义", () => {
  const html = buildWhaleDialogHtml(
    { ...baseOpts, prefillNote: "<script>alert('xss')</script> & \"quote\"" },
    esc
  );
  const initMatch = html.match(/id="whale-dlg-note-init" value="([^"]*)"/);
  assert.ok(initMatch, "应能找到 note-init 隐藏字段");
  assert.equal(
    initMatch[1],
    "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt; &amp; &quot;quote&quot;",
    "prefillNote 应被 esc 转义"
  );
  assert.doesNotMatch(html, /<script>alert\('xss'\)/, "原始 <script> 标签不应存在");
});

test("弹窗 HTML:AI 按钮不影响原有 footer 元素(只上色/保存仍然存在)", () => {
  const html = buildWhaleDialogHtml(baseOpts, esc);
  assert.match(html, /id="whale-dlg-annotate-only"/, "只上色按钮仍存在");
  assert.match(html, /id="whale-dlg-ok"/, "保存按钮仍存在");
  assert.match(html, /class="whale-dlg-foot"/, "footer 容器仍存在");
});

// ============ IWhaleHost 接口签名(静态校验) ============

test("IWhaleHost 接口:含 getAiSettings / openAiSettings / openAnnoAiDialog(2026-08-22 新增)", async () => {
  // 通过 import 类型间接验证接口导出;此处走真实模块读取接口源
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(
    "src/annotation/whale-manager.ts",
    "utf8"
  );
  assert.match(src, /getAiSettings\(\): \{ apiKey: string;[^\n]*\}/, "IWhaleHost 应有 getAiSettings");
  assert.match(src, /openAiSettings\(\): void;/, "IWhaleHost 应有 openAiSettings");
  assert.match(src, /openAnnoAiDialog\(opts: \{/, "IWhaleHost 应有 openAnnoAiDialog");
});
