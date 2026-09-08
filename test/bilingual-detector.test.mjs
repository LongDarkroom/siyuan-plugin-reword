/**
 * 双语运行时 · 英文书籍识别（detector）测试
 * ------------------------------------------------------------------
 * 覆盖：
 *  - 元数据优先：en / en-US → 英文；zh / zh-CN / ja / fr → 非英文；表外语种 → 走采样
 *  - 采样兜底：英文正文 → en；中文 / 日文正文 → other；无输入 → unknown（放行不拦）
 *  - 拉丁绝对主导兜底（诗歌/目录体停用词天然偏少）
 *  - collectSampleTexts：跳过过短碎片、maxChars / maxBlocks 上限、duck-typing 容错
 *  - isEnglishBook / isNonEnglishBook 语义
 * 不依赖：foliate / siyuan SDK（detector 是纯函数）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectBookLanguage,
  isEnglishBook,
  isNonEnglishBook,
  collectSampleTexts,
} from "../src/reader/bilingual/runtime/detector.ts";

/* ================= 元数据优先 ================= */

test("元数据 en → 判定英文，来源 meta，置信度 1", () => {
  const r = detectBookLanguage({ metaLanguage: "en" });
  assert.equal(r.verdict, "en");
  assert.equal(r.source, "meta");
  assert.equal(r.confidence, 1);
});

test("元数据带地区码（en-US / en-GB）→ 仍判英文", () => {
  assert.equal(detectBookLanguage({ metaLanguage: "en-US" }).verdict, "en");
  assert.equal(detectBookLanguage({ metaLanguage: "en-GB" }).verdict, "en");
});

test("元数据非英文（zh / zh-CN / ja / fr）→ 判定非英文", () => {
  for (const lang of ["zh", "zh-CN", "ja", "fr"]) {
    const r = detectBookLanguage({ metaLanguage: lang });
    assert.equal(r.verdict, "other", `${lang} 应判非英文`);
    assert.equal(r.source, "meta", `${lang} 应走元数据判定`);
  }
});

test("元数据优先级高于采样：zh 元数据 + 英文正文 → 仍判非英文", () => {
  const r = detectBookLanguage({
    metaLanguage: "zh",
    sampleTexts: ["This is a long enough English sample paragraph for detection purposes."],
  });
  assert.equal(r.verdict, "other");
  assert.equal(r.source, "meta");
});

test("表外语种（无元数据结论）→ 回落到采样", () => {
  const r = detectBookLanguage({
    metaLanguage: "xx",
    sampleTexts: ["This is a long enough English sample paragraph for detection purposes."],
  });
  assert.equal(r.verdict, "en");
  assert.equal(r.source, "sample", "表外语种应回落到采样判定");
});

/* ================= 采样兜底 ================= */

const EN_SAMPLE = [
  "It was the best of times, it was the worst of times, it was the age of wisdom.",
  "We had everything before us, we had nothing before us, we were all going direct to Heaven.",
];
const ZH_SAMPLE = [
  "这是一个用于检测的中文段落示例，包含足够多的汉字以便统计字符占比。",
  "我们希望识别机制能够正确地把中文书籍判定为非英文书籍，从而避免浪费翻译额度。",
];
const JA_SAMPLE = [
  "これは日本語のテキストです。検出のために十分な長さの文字列を用意しています。",
  "ひらがなとカタカナが含まれているので、正しく非英語として判定されるはずです。",
];

test("英文正文采样 → 判定英文，来源 sample", () => {
  const r = detectBookLanguage({ sampleTexts: EN_SAMPLE });
  assert.equal(r.verdict, "en");
  assert.equal(r.source, "sample");
  assert.ok(r.confidence > 0, "置信度应大于 0");
});

test("中文正文采样 → 判定非英文（CJK 主导）", () => {
  const r = detectBookLanguage({ sampleTexts: ZH_SAMPLE });
  assert.equal(r.verdict, "other");
  assert.equal(r.source, "sample");
});

test("日文正文采样（假名为主）→ 判定非英文", () => {
  const r = detectBookLanguage({ sampleTexts: JA_SAMPLE });
  assert.equal(r.verdict, "other");
});

test("无元数据且无采样 → unknown（放行不拦，避免误杀）", () => {
  const r = detectBookLanguage({});
  assert.equal(r.verdict, "unknown");
  assert.equal(r.source, "none");
  assert.equal(r.confidence, 0);
});

test("样本无可统计字符（纯数字/标点）→ unknown", () => {
  const r = detectBookLanguage({ sampleTexts: ["1234567890", "!!! ??? ..."] });
  assert.equal(r.verdict, "unknown");
});

test("拉丁绝对主导 + 停用词极少（目录/章节体）→ 仍判英文", () => {
  // 目录/章节体：停用词天然极少，但拉丁字符占绝对主导且样本够长（≥200 字符）→ 兜底判英文
  const texts = [
    "Section 1: Introduction. Section 2: Methods. Section 3: Results. Section 4: Discussion.",
    "Figure 1. Figure 2. Table 1. Table 2. Appendix A. Appendix B. References. Index.",
    "Chapter 1. Chapter 2. Chapter 3. Chapter 4. Chapter 5. Chapter 6. Chapter 7. Chapter 8.",
  ];
  const r = detectBookLanguage({ sampleTexts: texts });
  assert.equal(r.verdict, "en", "拉丁占绝对主导时应判英文（兜底规则）");
});

/* ================= 语义辅助函数 ================= */

test("isEnglishBook / isNonEnglishBook 语义", () => {
  assert.equal(isEnglishBook({ metaLanguage: "en" }), true);
  assert.equal(isEnglishBook({ metaLanguage: "zh" }), false);
  assert.equal(isEnglishBook({}), false, "unknown 不算英文");

  assert.equal(isNonEnglishBook({ metaLanguage: "zh" }), true);
  assert.equal(isNonEnglishBook({ metaLanguage: "en" }), false);
  assert.equal(isNonEnglishBook({}), false, "unknown 不算明确非英文，避免误杀");
});

/* ================= collectSampleTexts ================= */

/** duck-typed 的假文档（detector 不依赖真实 DOM） */
function mockDoc(texts) {
  return { querySelectorAll: () => texts.map((t) => ({ textContent: t })) };
}

test("collectSampleTexts：收集正文并跳过过短碎片", () => {
  const doc = mockDoc(["短", "1", "这是一段足够长的正文文本用于采样统计用途"]);
  const out = collectSampleTexts([doc]);
  assert.equal(out.length, 1, "过短碎片（<20 字符）应被跳过");
});

test("collectSampleTexts：maxBlocks 上限生效", () => {
  const many = Array.from({ length: 100 }, (_, i) => `这是一段足够长的正文文本用于采样统计用途，序号 ${i}`);
  const out = collectSampleTexts([mockDoc(many)], { maxBlocks: 3 });
  assert.equal(out.length, 3);
});

test("collectSampleTexts：maxChars 上限生效", () => {
  const many = Array.from({ length: 50 }, () => "这是一段足够长的正文文本用于采样统计用途，长度可观");
  const out = collectSampleTexts([mockDoc(many)], { maxChars: 100 });
  assert.ok(out.join("").length >= 100, "应至少收满 maxChars");
  assert.ok(out.length < many.length, "应在达到 maxChars 时停止");
});

test("collectSampleTexts：多文档顺序收集", () => {
  const out = collectSampleTexts([
    mockDoc(["第一段的正文文本内容足够长以通过采样门槛"]),
    mockDoc(["第二段的正文文本内容足够长以通过采样门槛"]),
  ]);
  assert.equal(out.length, 2);
  assert.match(out[0], /第一段/);
});

test("collectSampleTexts：空输入 / 不支持 querySelectorAll 的文档不抛错", () => {
  assert.deepEqual(collectSampleTexts(null), []);
  assert.deepEqual(collectSampleTexts([]), []);
  assert.deepEqual(collectSampleTexts([null, undefined, {}]), []);
  // querySelectorAll 抛异常时也吞掉，不让识别链路崩
  assert.deepEqual(
    collectSampleTexts([{ querySelectorAll: () => { throw new Error("boom"); } }]),
    [],
  );
});

test("端到端：元数据缺失的英文书 → 靠采样放行", () => {
  const docs = [mockDoc(EN_SAMPLE)];
  const det = detectBookLanguage({ sampleTexts: collectSampleTexts(docs) });
  assert.equal(det.verdict, "en");
});

test("端到端：元数据缺失的中文书 → 靠采样拦下", () => {
  const docs = [mockDoc(ZH_SAMPLE)];
  const det = detectBookLanguage({ sampleTexts: collectSampleTexts(docs) });
  assert.equal(det.verdict, "other");
});
