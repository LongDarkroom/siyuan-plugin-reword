/**
 * 在线完整词典解析单测（2026-08-15 新增）。
 * 验证 parseEudicFullHtml 纯函数：音标提取 + 释义提取 + 词性前缀拆分 + 兜底 null。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseEudicFullHtml, renderOnlineDictCard } from "../src/dict/online-dict.ts";

// 构造欧路网页真实结构的最小样本
const SAMPLE = `
<div id="translate">
  <div id="ExpFC" class="explain_wrap">
    <div class="expHead"><span class="explain_collapse"></span>英汉-汉英词典</div>
    <div id="ExpFCchild" class="expDiv">
      <div class="exp">n. 精通；优势；统治权；征服；掌握</div>
    </div>
  </div>
</div>
<span class="phontype">英</span><span class="Phonitic">/'mɑːstəri/</span>
<span class="phontype">美</span><span class="Phonitic">/'mæstəri/</span>
`;

test("parseEudicFullHtml: 提取英/美音标 + 词性释义", () => {
  const r = parseEudicFullHtml(SAMPLE, "mastery");
  assert.ok(r, "应解析出结果");
  assert.equal(r.word, "mastery");
  assert.match(r.phonetic, /英 \/'mɑːstəri\//);
  assert.match(r.phonetic, /美 \/'mæstəri\//);
  assert.equal(r.meanings.length, 1);
  assert.equal(r.meanings[0].pos, "n.");
  assert.match(r.meanings[0].zh, /精通；优势/);
  assert.equal(r.source, "eudic");
});

test("parseEudicFullHtml: 多词性多 exp div 各自拆分", () => {
  const html = `
    <div class="exp">n. 精通；掌握</div>
    <div class="exp">vt. 征服；统治</div>
    <div class="exp">adj. 熟练的</div>
  `;
  const r = parseEudicFullHtml(html, "x");
  assert.ok(r);
  assert.equal(r.meanings.length, 3);
  assert.equal(r.meanings[0].pos, "n.");
  assert.equal(r.meanings[1].pos, "vt.");
  assert.equal(r.meanings[2].pos, "adj.");
});

test("parseEudicFullHtml: 无词性前缀时整行作释义", () => {
  const html = `<div class="exp">熟练，精通</div>`;
  const r = parseEudicFullHtml(html, "x");
  assert.ok(r);
  assert.equal(r.meanings[0].pos, "");
  assert.equal(r.meanings[0].zh, "熟练，精通");
});

test("parseEudicFullHtml: 释义含 HTML 标签时正确 strip", () => {
  const html = `<div class="exp">n. <a href="/x">精通</a>；<i>优势</i></div>`;
  const r = parseEudicFullHtml(html, "x");
  assert.ok(r);
  assert.equal(r.meanings[0].pos, "n.");
  assert.equal(r.meanings[0].zh, "精通；优势");
});

test("parseEudicFullHtml: 空 HTML / 无内容返回 null", () => {
  assert.equal(parseEudicFullHtml("", "x"), null);
  assert.equal(parseEudicFullHtml("<div>nothing</div>", "x"), null);
});

test("renderOnlineDictCard: 含来源徽标 + 词头 + 音标 + 释义 + 收藏按钮", () => {
  const r = parseEudicFullHtml(SAMPLE, "mastery");
  assert.ok(r, "应解析出结果");
  const html = renderOnlineDictCard(r, false);
  assert.match(html, /🌐 在线词典（欧路）/, "应有在线来源徽标");
  assert.match(html, /mastery/, "应显示词头");
  assert.match(html, /hiword-dict-phonetic/, "应显示音标");
  assert.match(html, /hiword-online-meaning/, "应有释义行");
  assert.match(html, /data-action="vocab-star"/, "应有收藏按钮（☆）");
  assert.match(html, /data-action="tts"/, "应有朗读按钮");
});

test("renderOnlineDictCard: XSS 转义", () => {
  const r = { word: "<script>", phonetic: "", meanings: [{ pos: "n.", zh: '<img onerror=alert(1)>' }], source: "eudic" };
  const html = renderOnlineDictCard(r, false);
  assert.doesNotMatch(html, /<script>/, "词头应转义");
  assert.doesNotMatch(html, /<img onerror=alert/, "释义应转义");
});
