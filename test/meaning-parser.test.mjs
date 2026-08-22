import test from "node:test";
import assert from "node:assert/strict";
import { parseReviewMeaning } from "../src/utils/meaning-parser.ts";

// 复习卡片「词性兜底」回归测试
// 覆盖：AI 精读未给词性、本地词典、存量旧数据三种来源的 pos 兜底与义项拆分。

test("fallbackPos 在文本无词性时被采用并归一化", () => {
  const r = parseReviewMeaning("顺从的；听之任之的", "adj");
  assert.equal(r.pos, "adj.");
  assert.deepEqual(r.senses.slice(0, 2), ["顺从的", "听之任之的"]);
});

test("文本自带词性优先于 fallbackPos", () => {
  const r = parseReviewMeaning("n. 苹果；果实", "adj");
  assert.equal(r.pos, "n.");
  assert.ok(r.senses.includes("苹果"));
});

test("AI 精读空 pos + 中文释义：仍返回义项，pos 为空（界面显示「词性未知」）", () => {
  const r = parseReviewMeaning("1. 顺从的 2. 听之任之的", "");
  assert.equal(r.pos, "");
  assert.equal(r.senses.length, 2);
  assert.equal(r.senses[0], "顺从的");
});

test("纯英文脏 meaning 被清洗为可读中文义项", () => {
  const r = parseReviewMeaning(
    "passive /'pæsɪv/ adj.1.(submissive)顺从的；听之任之的 2.被动的",
    ""
  );
  assert.equal(r.pos, "adj.");
  assert.ok(r.senses.some((s) => s.includes("顺从")));
});

test("带编号的英文脏文本（如 ECD2 直出）能拆出义项", () => {
  const r = parseReviewMeaning(
    "acquit vt. 1.宣告无罪 2.使履行",
    ""
  );
  assert.equal(r.pos, "vt.");
  assert.equal(r.senses.length, 2);
});
