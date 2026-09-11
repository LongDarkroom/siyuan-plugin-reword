// 2026-09-11 新增：5 个 parser + cleaner + autoParse 集成测试
// 覆盖：
//   - 5 parser 各自基本解析
//   - detect() 优先级（table > tsv > yaml > doubledot > plain）
//   - cleaner: 去重 / 停用词 / 长度 / 非法字符
//   - autoParse: 端到端

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoParse,
  detectFormat,
  cleanParsed,
  plainParser,
  doubledotParser,
  tableParser,
  tsvParser,
  yamlParser,
  detectPlain,
  detectDoubledot,
  detectTable,
  detectTsv,
  detectYaml,
} from "../src/vocab/parser/index.ts";
import { PARSERS } from "../src/vocab/parser/index.ts";

// ============ plain ============
test("plain: 基本解析（每行一词）", () => {
  const r = plainParser.parse("abandon\nbenevolent\ncognitive");
  assert.equal(r.length, 3);
  assert.equal(r[0].word, "abandon");
  assert.equal(r[0].sourceLine, 1);
  assert.equal(r[2].word, "cognitive");
});

test("plain: 跳过空行 + 非法行", () => {
  const r = plainParser.parse("abandon\n\n中文行\nbenevolent\n123\n");
  assert.equal(r.length, 2);
  assert.equal(r[0].word, "abandon");
  assert.equal(r[1].word, "benevolent");
});

test("plain: 大写归小写", () => {
  const r = plainParser.parse("Abandon\nBENEVOLENT");
  assert.equal(r[0].word, "abandon");
  assert.equal(r[1].word, "benevolent");
});

test("plain: 连字符/撇号合法", () => {
  const r = plainParser.parse("well-known\ndon't");
  assert.equal(r.length, 2);
  assert.equal(r[0].word, "well-known");
  assert.equal(r[1].word, "don't");
});

test("detectPlain: 80% 阈值", () => {
  assert.equal(detectPlain("abandon\nbenevolent\ncognitive"), true);
  assert.equal(detectPlain("abandon\n中文\nbenevolent"), false, "只有 2/3 是英文");
  assert.equal(detectPlain("ab\nbc"), false, "<3 行");
});

// ============ doubledot ============
test("doubledot: 基本解析", () => {
  const r = doubledotParser.parse("abandon :: 放弃\nbenevolent :: 仁慈");
  assert.equal(r.length, 2);
  assert.equal(r[0].word, "abandon");
  assert.equal(r[0].meaning, "放弃");
  assert.equal(r[1].meaning, "仁慈");
});

test("doubledot: 左侧必须合法英文", () => {
  const r = doubledotParser.parse("abandon :: 放弃\n123 :: 数字\nbenevolent :: 仁慈");
  assert.equal(r.length, 2);
  assert.equal(r[0].word, "abandon");
  assert.equal(r[1].word, "benevolent");
});

test("doubledot: 多个 :: 取第一个", () => {
  const r = doubledotParser.parse("abandon :: 放弃 :: 抛弃");
  assert.equal(r[0].meaning, "放弃 :: 抛弃");
});

test("detectDoubledot: 60% 阈值", () => {
  assert.equal(detectDoubledot("abandon :: 放弃\nbenevolent :: 仁慈"), true);
  assert.equal(detectDoubledot("abandon :: 放弃\n中文"), false);
});

// ============ table ============
test("table: 中文表头", () => {
  const r = tableParser.parse(
    "| 单词 | 音标 | 释义 | 例句 |\n" +
    "|------|------|------|------|\n" +
    "| abandon | /əˈbændən/ | 放弃 | He abandoned his car. |\n" +
    "| benevolent | /bəˈnevələnt/ | 仁慈 | She is benevolent. |"
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].word, "abandon");
  assert.equal(r[0].phonetic, "/əˈbændən/");
  assert.equal(r[0].meaning, "放弃");
  assert.equal(r[0].example, "He abandoned his car.");
});

test("table: 英文表头", () => {
  const r = tableParser.parse(
    "| word | phonetic | meaning | example |\n" +
    "|---|---|---|---|\n" +
    "| abandon | /x/ | test | sample |"
  );
  assert.equal(r[0].word, "abandon");
  assert.equal(r[0].phonetic, "/x/");
  assert.equal(r[0].meaning, "test");
  assert.equal(r[0].example, "sample");
});

test("table: 列别名识别（translation / 标签）", () => {
  const r = tableParser.parse(
    "| word | translation | tags |\n" +
    "|---|---|---|\n" +
    "| hello | 你好 | 高频, 基础 |"
  );
  assert.equal(r[0].meaning, "你好", "translation 映射到 meaning");
  assert.deepEqual(r[0].labels, ["高频", "基础"]);
});

test("table: 第一列不是合法英文 → 跳过该行", () => {
  const r = tableParser.parse(
    "| word |\n" +
    "|---|\n" +
    "| 123 |\n" +
    "| abandon |"
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].word, "abandon");
});

test("detectTable: 需要表头 + 分隔线 + 至少 1 个 word 列", () => {
  assert.equal(detectTable("| word |\n|---|\n| x |"), true);
  assert.equal(detectTable("| 单词 | 释义 |\n|---|---|\n| x | y |"), true);
  assert.equal(detectTable("| abc | def |\nnot a table"), false);
  assert.equal(detectTable("| random | other |\n|---|---|\n| a | b |"), false, "无 word 列");
});

// ============ tsv ============
test("tsv: 无表头（默认列序 word/meaning/phonetic/example）", () => {
  const r = tsvParser.parse("abandon\t放弃\t/x/\tsample\nbenevolent\t仁慈\t/y/\tex");
  assert.equal(r.length, 2);
  assert.equal(r[0].word, "abandon");
  assert.equal(r[0].meaning, "放弃");
  assert.equal(r[0].phonetic, "/x/");
  assert.equal(r[0].example, "sample");
});

test("tsv: 中文表头", () => {
  const r = tsvParser.parse(
    "单词\t音标\t释义\t例句\n" +
    "abandon\t/x/\t放弃\tsample"
  );
  assert.equal(r[0].word, "abandon");
  assert.equal(r[0].phonetic, "/x/");
  assert.equal(r[0].meaning, "放弃");
  assert.equal(r[0].example, "sample");
});

test("tsv: 跳过非 tab 行", () => {
  const r = tsvParser.parse("abandon\t放弃\nthis is not tsv\nbenevolent\t仁慈");
  assert.equal(r.length, 2);
});

test("detectTsv: 至少 2 tab 行", () => {
  assert.equal(detectTsv("a\tb\nc\td"), true);
  assert.equal(detectTsv("no tabs here\nno tabs"), false);
});

// ============ yaml ============
test("yaml: frontmatter + 列表 + 子字段", () => {
  const r = yamlParser.parse(
    "---\n" +
    "name: TOEFL\n" +
    "level: C1\n" +
    "---\n" +
    "- abandon\n" +
    "  - phonetic: /x/\n" +
    "  - meaning: 放弃\n" +
    "- benevolent\n" +
    "  - meaning: 仁慈\n"
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].word, "abandon");
  assert.equal(r[0].phonetic, "/x/");
  assert.equal(r[0].meaning, "放弃");
  assert.equal(r[1].word, "benevolent");
  assert.equal(r[1].meaning, "仁慈");
});

test("yaml: 无 frontmatter 也支持", () => {
  const r = yamlParser.parse(
    "- abandon\n" +
    "  - meaning: 放弃\n" +
    "- benevolent"
  );
  assert.equal(r.length, 2);
});

test("yaml: 带引号的 word", () => {
  const r = yamlParser.parse(
    "- \"abandon\"\n" +
    "- 'benevolent'"
  );
  assert.equal(r[0].word, "abandon");
  assert.equal(r[1].word, "benevolent");
});

test("yaml: 标签字段", () => {
  const r = yamlParser.parse(
    "- hello\n" +
    "  - labels: 高频, 难词"
  );
  assert.deepEqual(r[0].labels, ["高频", "难词"]);
});

test("detectYaml: 需要 --- + 列表", () => {
  assert.equal(detectYaml("---\nname: x\n---\n- a\n- b"), true);
  assert.equal(detectYaml("- a\n- b"), false, "无 frontmatter 不算 yaml");
  assert.equal(detectYaml("plain text\nlines"), false);
});

// ============ cleaner ============
test("cleaner: 去重（保留先出现 + 合并字段）", () => {
  const words = [
    { word: "abandon", meaning: "放弃", sourceLine: 1 },
    { word: "abandon", meaning: "抛弃", example: "He abandoned.", sourceLine: 2 },
    { word: "benevolent", meaning: "仁慈", sourceLine: 3 },
  ];
  const r = cleanParsed(words);
  assert.equal(r.accepted.length, 2);
  // 第一个的 meaning 是 "放弃"（先出现），第二个的 example 补上
  assert.equal(r.accepted[0].meaning, "放弃");
  assert.equal(r.accepted[0].example, "He abandoned.");
});

test("cleaner: 停用词黑名单", () => {
  const words = [
    { word: "the", sourceLine: 1 },
    { word: "abandon", sourceLine: 2 },
    { word: "to", sourceLine: 3 },
  ];
  const r = cleanParsed(words);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.skipped.length, 2);
  assert.equal(r.skipped[0].reason, "stop_word");
});

test("cleaner: 太长跳过", () => {
  const long = "a".repeat(31);
  const r = cleanParsed([{ word: long, sourceLine: 1 }]);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.skipped[0].reason, "too_long");
});

test("cleaner: 非法字符", () => {
  const r = cleanParsed([
    { word: "abandon", sourceLine: 1 },
    { word: "abc 123", sourceLine: 2 },
    { word: "中文", sourceLine: 3 },
  ]);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.skipped.length, 2);
  assert.equal(r.skipped[0].reason, "invalid_chars");
});

test("cleaner: 空 word 跳过", () => {
  const r = cleanParsed([
    { word: "", sourceLine: 1 },
    { word: "   ", sourceLine: 2 },
  ]);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.skipped[0].reason, "empty");
});

test("cleaner: 合并字段（保留非空）", () => {
  const r = cleanParsed([
    { word: "x", sourceLine: 1 },
    { word: "x", phonetic: "/x/", sourceLine: 2 },
  ]);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].phonetic, "/x/");
});

// ============ detect 优先级 ============
test("detect 优先级：table > tsv > yaml > doubledot > plain", () => {
  // 纯 plain
  assert.equal(detectFormat("abandon\nbenevolent\ncognitive"), "plain");
  // doubledot
  assert.equal(detectFormat("abandon :: 放弃\nbenevolent :: 仁慈"), "doubledot");
  // yaml
  assert.equal(detectFormat("---\nname: x\n---\n- a\n- b"), "yaml");
  // tsv
  assert.equal(detectFormat("abandon\t放弃\nbenevolent\t仁慈"), "tsv");
  // table 优先
  assert.equal(
    detectFormat("| word | meaning |\n|---|---|\n| a | b |"),
    "table"
  );
});

test("detect 全部不识别 → null", () => {
  assert.equal(detectFormat(""), null);
  assert.equal(detectFormat("\n\n\n"), null);
  assert.equal(detectFormat("random text\nthat doesn't match\nany format"), null);
});

// ============ autoParse 端到端 ============
test("autoParse: plain 端到端", () => {
  const r = autoParse("abandon\nbenevolent\ncognitive");
  assert.ok(r);
  assert.equal(r.result.format, "plain");
  assert.equal(r.result.words.length, 3);
  assert.equal(r.cleaned.rawCount, 3);
  assert.equal(r.cleaned.dedupedCount, 3);
  assert.equal(r.cleaned.skipped.length, 0);
});

test("autoParse: table 端到端", () => {
  const r = autoParse(
    "| word | phonetic | meaning |\n|---|---|---|\n" +
    "| abandon | /x/ | 放弃 |\n| benevolent | /y/ | 仁慈 |"
  );
  assert.ok(r);
  assert.equal(r.result.format, "table");
  assert.equal(r.result.words.length, 2);
});

test("autoParse: 含停用词 + 重复", () => {
  const r = autoParse("abandon\nthe\nabandon\nbenevolent");
  assert.ok(r);
  assert.equal(r.result.words.length, 2, "去重 + 跳停用词");
  assert.equal(r.cleaned.skipped.length, 1, "the 被跳");
  assert.equal(r.cleaned.skipped[0].reason, "stop_word");
});

test("autoParse: 不识别返 null", () => {
  assert.equal(autoParse(""), null);
  assert.equal(autoParse("@@@###$$$"), null);
});

// ============ PARSERS 注册表完整性 ============
test("PARSERS: 5 个格式都注册", () => {
  assert.ok(PARSERS.plain);
  assert.ok(PARSERS.doubledot);
  assert.ok(PARSERS.table);
  assert.ok(PARSERS.tsv);
  assert.ok(PARSERS.yaml);
  for (const fmt of ["plain", "doubledot", "table", "tsv", "yaml"]) {
    assert.equal(PARSERS[fmt].format, fmt);
  }
});
