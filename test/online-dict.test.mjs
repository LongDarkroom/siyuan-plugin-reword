/**
 * 在线完整词典解析单测（2026-08-15 新增，2026-09-07 切换至海词）。
 * 验证 parseEudicFullHtml 别名（=parseHaiciLiteHtml）：音标 / 简释+词性 / 兜底 null。
 *
 * 2026-09-07 切换数据源后，本文件 sample HTML 全部从欧路格式改为海词格式；
 * 函数名仍叫 parseEudicFullHtml（保持 API 兼容），内部已转发至 parseHaiciLiteHtml。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseEudicFullHtml, renderOnlineDictCard } from "../src/dict/online-dict.ts";

// 构造海词网页真实结构的最小样本（mastery 模式）
const SAMPLE = `
<div class="phonetic">
  <span>英 <bdo lang="EN-US">['mɑːstəri]</bdo></span>
  <span>美 <bdo lang="EN-US">['mæstəri]</bdo></span>
</div>
<div class="basic clearfix">
  <ul class="dict-basic-ul">
    <li><span>n.</span><strong>精通；优势；统治权；征服；掌握</strong></li>
  </ul>
</div>
`;

test("parseEudicFullHtml: 提取英/美音标 + 词性释义", () => {
  const r = parseEudicFullHtml(SAMPLE, "mastery");
  assert.ok(r, "应解析出结果");
  assert.equal(r.word, "mastery");
  assert.match(r.phonetic, /英 \/mɑːstəri\//);
  assert.match(r.phonetic, /美 \/mæstəri\//);
  assert.equal(r.meanings.length, 1);
  assert.equal(r.meanings[0].pos, "n.");
  assert.match(r.meanings[0].zh, /精通；优势/);
  assert.equal(r.source, "haici");
});

test("parseEudicFullHtml: 多词性多 basic-ul li 各自拆分", () => {
  // 海词格式：每个词性 = 一个 <li>，li 内 <span>X.</span> + <strong>释义</strong>
  const html = `
    <div class="basic clearfix">
      <ul class="dict-basic-ul">
        <li><span>n.</span><strong>精通；掌握</strong></li>
        <li><span>vt.</span><strong>征服；统治</strong></li>
        <li><span>adj.</span><strong>熟练的</strong></li>
      </ul>
    </div>
  `;
  const r = parseEudicFullHtml(html, "x");
  assert.ok(r);
  assert.equal(r.meanings.length, 3);
  assert.equal(r.meanings[0].pos, "n.");
  assert.equal(r.meanings[1].pos, "vt.");
  assert.equal(r.meanings[2].pos, "adj.");
});

test("parseEudicFullHtml: 无词性前缀时整行作释义", () => {
  // 海词无 pos span 的场景：strong 内直接中文
  const html = `<ul class="dict-basic-ul"><li><strong>熟练，精通</strong></li></ul>`;
  const r = parseEudicFullHtml(html, "x");
  assert.ok(r);
  assert.equal(r.meanings[0].pos, "");
  assert.equal(r.meanings[0].zh, "熟练，精通");
});

test("parseEudicFullHtml: 释义含 HTML 标签时正确 strip", () => {
  const html = `<ul class="dict-basic-ul"><li><span>n.</span><strong><a href="/x">精通</a>；<i>优势</i></strong></li></ul>`;
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
  assert.match(html, /🌐 在线词典（海词）/, "2026-09-07 切换后徽标改为「海词」");
  assert.match(html, /mastery/, "应显示词头");
  assert.match(html, /hiword-dict-phonetic/, "应显示音标");
  // 2026-09-07 全信息版改版：释义行由 hiword-online-meaning 改为复用离线 senses 结构
  assert.match(html, /hiword-dict-sense-item/, "应有释义行");
  assert.match(html, /data-action="vocab-star"/, "应有收藏按钮（☆）");
  assert.match(html, /data-action="tts"/, "应有朗读按钮");
});

test("renderOnlineDictCard: XSS 转义", () => {
  const r = { word: "<script>", phonetic: "", meanings: [{ pos: "n.", zh: '<img onerror=alert(1)>' }], inflections: [], synonyms: [], antonyms: [], source: "haici" };
  const html = renderOnlineDictCard(r, false);
  assert.doesNotMatch(html, /<script>/, "词头应转义");
  assert.doesNotMatch(html, /<img onerror=alert/, "释义应转义");
});
