// 2026-09-02 B 组：cleanForAi 对「引用」的契约变更锁
//
// 旧契约（已废弃）：cleanForAi step 0 要把 @@REWORD_REF_<id>@@ 还原成 ((id 'anchor'))，
//   再交给 renderUserMessage / expandBlockRefs / expandDocRefs 正则匹配。
//   为此还要每次调用全量扫一遍 wysiwyg DOM 修补「泄漏形态」（step 0 兜底 / 0b）。
//
// 新契约（B 组）：cleanForAi 只做纯清洗，绝不碰引用。
//   占位符原样穿过 → renderUserMessage 查 attachment 表渲染卡片、expandRefs 查表替换正文。
//   泄漏形态已不可能出现：readInputValue 在 Lute 序列化前就把 block-ref 节点换成占位符。
//
// 本文件锁定两条不变式：
//   ① 占位符在清洗中原样保留（不还原、不转义、不被 <[^>]+> 剥离）
//   ② IAL / 裸 HTML / 零宽字符 / HTML 注释 / 连续空行 仍被清洗

import { test } from "node:test";
import assert from "node:assert/strict";
import { refPlaceholderOf, docAnchorOf, isDocAnchor, scanRefMarkers } from "../src/ai/ai-refs.ts";

/** 镜像重构后的 cleanForAi：只保留 step 1-5 纯清洗 */
class FakeCleaner {
  cleanAll(raw) {
    let s = raw;
    s = s.replace(/\{:[^}]*\}/gs, ""); // 1. IAL
    s = s.replace(/<[^>]+>/g, ""); // 2. 裸 HTML 标签
    s = s.replace(/[​-‏⁠﻿­]/g, ""); // 3. 零宽字符
    s = s.replace(/<!--[\s\S]*?-->/g, ""); // 4. HTML 注释
    s = s.replace(/\n{3,}/g, "\n\n"); // 5. 连续空行
    return s.trim();
  }
}

const DOC_UUID = "20260813120000-aaaaaa";
const BLOCK_14 = "20260813120000-zzzzzz";
const DOC_ANCHOR = docAnchorOf(DOC_UUID); // 📄 文档 aaaaaa

test("CleanB:doc-ref 占位符清洗后原样保留（不再还原成 ((id 'anchor'))）", () => {
  const c = new FakeCleaner();
  const md = `前缀 ${refPlaceholderOf(DOC_UUID)} 后缀`;
  const out = c.cleanAll(md);
  assert.ok(out.includes(refPlaceholderOf(DOC_UUID)), "占位符必须原样穿过清洗");
  assert.ok(!out.includes("(("), "不得再生成 kramdown 块引用语法");
  assert.equal(out, md);
});

test("CleanB:占位符仍可被 scanRefMarkers 识别（清洗不破坏引用语义）", () => {
  const c = new FakeCleaner();
  const out = c.cleanAll(`前缀 ${refPlaceholderOf(DOC_UUID)} 后缀`);
  const marks = scanRefMarkers(out);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].id, DOC_UUID);
  assert.equal(marks[0].form, "placeholder");
});

test("CleanB:文档锚文本由 docAnchorOf 生成且可被 isDocAnchor 识别", () => {
  assert.equal(DOC_ANCHOR, "📄 文档 aaaaaa");
  assert.equal(isDocAnchor(DOC_ANCHOR), true);
});

test("CleanB:普通块引用占位符同样原样保留", () => {
  const c = new FakeCleaner();
  const md = refPlaceholderOf(BLOCK_14);
  assert.equal(c.cleanAll(md), md);
});

test("CleanB:混合 doc-ref 与 block-ref 均保留", () => {
  const c = new FakeCleaner();
  const md = `混合 ${refPlaceholderOf(DOC_UUID)} 与 ${refPlaceholderOf(BLOCK_14)}`;
  const out = c.cleanAll(md);
  assert.equal(scanRefMarkers(out).length, 2);
  assert.ok(!out.includes("(("));
});

test("CleanB:纯清洗仍然剥离 IAL / 裸 HTML / 零宽字符 / 注释", () => {
  const c = new FakeCleaner();
  const out = c.cleanAll(`文本{: id="x" custom="y"}<span data-type="inline-memo">注</span>​<!-- 注释 -->尾巴`);
  assert.ok(!out.includes("{:"));
  assert.ok(!out.includes("<span"));
  assert.ok(!out.includes("注释"));
  assert.ok(!out.includes("​"));
  assert.equal(out, "文本注尾巴");
});

test("CleanB:连续空行压缩为两个换行", () => {
  const c = new FakeCleaner();
  assert.equal(c.cleanAll("a\n\n\n\n\nb"), "a\n\nb");
});

test("CleanB:空字符串 / 无占位符原样返回", () => {
  const c = new FakeCleaner();
  assert.equal(c.cleanAll(""), "");
  assert.equal(c.cleanAll("普通 markdown 内容,没有 REword 占位符"), "普通 markdown 内容,没有 REword 占位符");
});
