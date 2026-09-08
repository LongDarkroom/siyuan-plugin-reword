/**
 * 第 5 批 · SOUL 长期记忆回归（2026-09-06）。
 * 覆盖：
 *  A. stripMarkdown —— 链接/图片/粗体/标题/代码去噪
 *  B. loadSoulMemory —— 空 docId / 取数失败 / 截断 标志
 *  C. buildSoulSection —— 关闭 / 无 docId / 正常注入（经 __setSoulDocFetcher 覆盖取数）
 *
 * 不依赖内核：getDocText 经 __setSoulDocFetcher 替换为同步假数据。
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  stripMarkdown,
  loadSoulMemory,
  buildSoulSection,
  __setSoulDocFetcher,
  clearSoulCache,
} from "../src/ai/ai-soul.ts";

test("stripMarkdown：去除最嘈杂的语法，保留正文", () => {
  assert.equal(stripMarkdown("# 标题\n正文"), "标题\n正文");
  assert.equal(stripMarkdown("[百度](https://b.com)"), "百度");
  assert.equal(stripMarkdown("![图](x.png)"), "");
  assert.equal(stripMarkdown("**粗** 和 *斜*"), "粗 和 斜");
  assert.equal(stripMarkdown("`code`"), "code");
  assert.equal(stripMarkdown("a\n\n\n\nb"), "a\n\nb");
});

test("loadSoulMemory：空 docId 直接返回 null（不取数）", async () => {
  let called = false;
  __setSoulDocFetcher(async () => { called = true; return "x"; });
  assert.equal(await loadSoulMemory("", 4000), null);
  assert.equal(called, false, "空 docId 不应触发取数");
  clearSoulCache();
});

test("loadSoulMemory：取数抛错时返回 null（不崩）", async () => {
  __setSoulDocFetcher(async () => { throw new Error("kernel down"); });
  assert.equal(await loadSoulMemory("20240101000000-abc", 4000), null);
  clearSoulCache();
});

test("loadSoulMemory：超长文档标记 truncated 并截断到 maxChars", async () => {
  const long = "x".repeat(5000);
  __setSoulDocFetcher(async () => long);
  const mem = await loadSoulMemory("id1", 4000);
  assert.ok(mem, "应返回记忆");
  assert.equal(mem.text.length, 4000, "截断到 maxChars");
  assert.equal(mem.truncated, true, "原文超长应标记 truncated");
  clearSoulCache();
});

test("buildSoulSection：未开启 → 空串", async () => {
  __setSoulDocFetcher(async () => "# 关于我\n我喜欢英语");
  const s = await buildSoulSection({ soulEnabled: false, soulDocId: "id1", soulMaxChars: 4000 });
  assert.equal(s, "", "关闭时不应注入任何内容");
  clearSoulCache();
});

test("buildSoulSection：开启但无 docId → 空串", async () => {
  const s = await buildSoulSection({ soulEnabled: true, soulDocId: "", soulMaxChars: 4000 });
  assert.equal(s, "", "无文档 ID 不应注入");
  clearSoulCache();
});

test("buildSoulSection：开启且文档有效 → 注入 SOUL 段落（含 docId）", async () => {
  __setSoulDocFetcher(async () => "# 关于我\n我每天背 20 个单词，偏好美式发音");
  const s = await buildSoulSection({ soulEnabled: true, soulDocId: "20240101000000-soul", soulMaxChars: 4000 });
  assert.ok(s.includes("【长期记忆 SOUL"), "应含 SOUL 段标题");
  assert.ok(s.includes("20240101000000-soul"), "应含文档 ID");
  assert.ok(s.includes("美式发音"), "应含文档正文（已去 markdown #）");
  assert.ok(!s.includes("# 关于我"), "标题 # 应被 stripMarkdown 去除");
  clearSoulCache();
});
