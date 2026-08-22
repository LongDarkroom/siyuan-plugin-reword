/**
 * 导出工具纯函数单测（2026-08-17 新增，随 index.ts 拆分落地）。
 * 覆盖：批注 → Markdown、词库 → CSV 的内容构造。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnnotationsMarkdown, buildVocabCsv } from "../src/export/download.ts";

test("buildAnnotationsMarkdown: 空批注列表生成头部", () => {
  const md = buildAnnotationsMarkdown([], {}, new Date("2026-08-17T00:00:00"));
  assert.match(md, /^# REword 批注导出/);
  assert.match(md, /> 共 0 条批注/);
});

test("buildAnnotationsMarkdown: 完整字段渲染（原文/批注/标签映射/样式/来源）", () => {
  const md = buildAnnotationsMarkdown(
    [
      {
        id: "a1",
        blockId: "b1",
        docId: "doc-1",
        sentence: "This is a sentence",
        selectedText: "sentence",
        note: "重点词",
        labels: ["l1", "missing"],
        color: "red",
        style: "underline",
        origin: "ai",
        createdAt: "2026-08-17T10:00:00",
        updatedAt: "2026-08-17T11:00:00",
      },
    ],
    { l1: "语法" },
    new Date("2026-08-17T12:00:00")
  );
  assert.match(md, /## 1\. sentence/);
  assert.match(md, /- \*\*原文\*\*：This is a sentence/);
  assert.match(md, /- \*\*批注\*\*：重点词/);
  assert.match(md, /- \*\*标签\*\*：#语法 #missing/);
  assert.match(md, /- \*\*样式\*\*：red \/ underline/);
  assert.match(md, /- \*\*来源\*\*：AI/);
  assert.match(md, /- \*\*来源文档\*\*：doc-1/);
  assert.match(md, /- \*\*创建时间\*\*：2026-08-17T10:00:00/);
  assert.match(md, /- \*\*更新时间\*\*：2026-08-17T11:00:00/);
});

test("buildVocabCsv: 字段转义与表头", () => {
  const csv = buildVocabCsv([
    {
      word: 'say "hello"',
      phonetic: "/seɪ/",
      pos: "v.",
      meaning: "说",
      mastery: 3,
      status: "learning",
    },
  ]);
  assert.match(csv, /^word,phonetic,pos,meaning,mastery,status\n/);
  assert.match(csv, /"say ""hello"""/);
  assert.match(csv, /learning$/);
});

test("buildVocabCsv: 空词库仅输出表头", () => {
  assert.equal(buildVocabCsv([]), "word,phonetic,pos,meaning,mastery,status\n");
});
