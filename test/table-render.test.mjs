import test from "node:test";
import assert from "node:assert/strict";
import { ensureBlockSeparators } from "../src/annotation/annotation-render.ts";

/**
 * 表格渲染修复（2026-08-18）的关键纯逻辑回归测试。
 * 根因：lite Protyle（Md2BlockDOM）对管道表格支持不全，会残留原始 `|...|` 文本；
 * 修复改为「含表格的 note 走静态兜底（Lute Md2HTML）→ 真实 <table>」，并要求
 * 表格块前后有空行（ensureBlockSeparators）以保证 Lute 正确识别。
 */

test("ensureBlockSeparators：表格前无空行 → 插入空行", () => {
  const md = "前面有文本\n| 列1 | 列2 |\n| --- | --- |\n| a | b |";
  const out = ensureBlockSeparators(md);
  const lines = out.split("\n");
  const tableIdx = lines.findIndex((l) => /^\s*\|/.test(l));
  assert.ok(tableIdx > 0, "应检测到表格行");
  assert.equal(lines[tableIdx - 1].trim(), "", "表格前应有空行");
});

test("ensureBlockSeparators：表格后无空行 → 插入空行", () => {
  const md = "| 列1 | 列2 |\n| --- | --- |\n| a | b |\n后面有文本";
  const out = ensureBlockSeparators(md);
  const lines = out.split("\n");
  let lastTable = -1;
  lines.forEach((l, i) => { if (/^\s*\|/.test(l)) lastTable = i; });
  assert.ok(lastTable >= 0, "应检测到表格行");
  assert.equal(lines[lastTable + 1].trim(), "", "表格后应有空行");
});

test("ensureBlockSeparators：表格前后已是空行 → 不重复插入", () => {
  const md = "上文\n\n| 列1 | 列2 |\n| --- | --- |\n| a | b |\n\n下文";
  const out = ensureBlockSeparators(md);
  const lines = out.split("\n");
  // 连续两个空行都不应出现（即不存在 "" 紧邻 ""）
  let doubleBlank = false;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "" && lines[i - 1].trim() === "") { doubleBlank = true; break; }
  }
  assert.equal(doubleBlank, false, "不应插入连续空行");
});

test("ensureBlockSeparators：纯表格不变（仍含分隔行）", () => {
  const md = "| 列1 | 列2 |\n| --- | --- |\n| a | b |";
  const out = ensureBlockSeparators(md);
  assert.ok(out.includes("| --- | --- |"), "表格分隔行应保留");
});

test("ensureBlockSeparators：无表格文本原样返回", () => {
  const md = "第一段\n第二段";
  assert.equal(ensureBlockSeparators(md), md);
});

test("ensureBlockSeparators：空输入原样返回", () => {
  assert.equal(ensureBlockSeparators(""), "");
});
