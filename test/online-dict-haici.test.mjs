/**
 * 海词在线词典解析单测（2026-09-07 新增，替代原 Eudic 测试）。
 * 验证 parseHaiciLiteHtml 纯函数：音标 / 简释+词性 / 词形变化 / 近反义词 四个字段。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHaiciLiteHtml,
  parseEudicFullHtml,
  renderOnlineDictCard,
  resetOnlineDictCache,
} from "../src/dict/online-dict.ts";

/**
 * 词海 borrow 页面真实结构采样（2026-09-07 web_fetch 抓取）
 * - 含 2 个音标（英/美）
 * - 1 条简释（v.）
 * - 5 个词形（名词/过去式/过去分词/现在分词/第三人称单数）
 * - 3 个近义词 + 2 个反义词
 */
const BORROW_HTML = `
<h1 class="keyword" tip="音节划分：bor·row">borrow</h1>
<div class="phonetic">
  <span>英 <bdo lang="EN-US">['bɒrəʊ]</bdo> <i class="sound"></i></span>
  <span>美 <bdo lang="EN-US">['bɑːroʊ]</bdo> <i class="sound"></i></span>
</div>
<div class="basic clearfix">
  <ul class="dict-basic-ul">
    <li><span>v.</span><strong>借；借鉴；抄袭</strong></li>
  </ul>
</div>
<div class="shape">
  <label>名词:</label> <a href="https://corp.dict.cn/borrower">borrower</a>
  <label>过去式:</label> <a href="https://corp.dict.cn/borrowed">borrowed</a>
  <label>过去分词:</label> <a href="https://corp.dict.cn/borrowed">borrowed</a>
  <label>现在分词:</label> <a href="https://corp.dict.cn/borrowing">borrowing</a>
  <label>第三人称单数:</label> <a href="https://corp.dict.cn/borrows">borrows</a>
</div>
<div class="section rel">
  <h2>borrow的相关资料：</h2>
  <h3>近反义词</h3>
  <div class="layout nfo">
    <div>【近义词】</div>
    <ul slider="12">
      <li><a href="https://corp.dict.cn/take">take</a> 拿</li>
      <li><a href="https://corp.dict.cn/use">use</a> 使用</li>
      <li><a href="https://corp.dict.cn/lend">lend</a> 借给</li>
    </ul>
    <div>【反义词】</div>
    <ul slider="12">
      <li><a href="https://corp.dict.cn/give">give</a></li>
      <li><a href="https://corp.dict.cn/return">return</a></li>
    </ul>
  </div>
  <h3>临近单词</h3>
  <div class="layout nwd">（被新 h3 截断，不应被本解析器处理）</div>
</div>
`;

/** 仅有音标 + 简释，无词形 / 近反义词的最小样本 */
const MINIMAL_HTML = `
<div class="phonetic">
  <span>英 <bdo lang="EN-US">['kæt]</bdo></span>
</div>
<div class="basic clearfix">
  <ul class="dict-basic-ul">
    <li><span>n.</span><strong>猫</strong></li>
  </ul>
</div>
`;

/** 整页空：用于验证 null 兜底 */
const EMPTY_HTML = `<html><body>未收录此单词</body></html>`;

/** 缺少某字段的样本：音标缺失，但有释义 */
const NO_PHONETIC_HTML = `
<div class="basic clearfix">
  <ul class="dict-basic-ul">
    <li><span>v.</span><strong>动作</strong></li>
  </ul>
</div>
`;

test("parseHaiciLiteHtml: borrow 4 字段全解析", () => {
  const r = parseHaiciLiteHtml(BORROW_HTML, "borrow");
  assert.ok(r, "应解析出结果");
  assert.equal(r.word, "borrow");
  assert.equal(r.source, "haici");

  // 1) 音标
  assert.match(r.phonetic, /英 \/bɒrəʊ\//);
  assert.match(r.phonetic, /美 \/bɑːroʊ\//);

  // 2) 简释 + 词性
  assert.equal(r.meanings.length, 1);
  assert.equal(r.meanings[0].pos, "v.");
  assert.equal(r.meanings[0].zh, "借；借鉴；抄袭");

  // 3) 词形变化：5 项
  assert.equal(r.inflections.length, 5, "应有 5 个词形");
  assert.deepEqual(
    r.inflections.map((i) => i.label),
    ["名词", "过去式", "过去分词", "现在分词", "第三人称单数"]
  );
  assert.equal(r.inflections[1].form, "borrowed");
  assert.equal(r.inflections[3].form, "borrowing");

  // 4) 近反义词（2026-09-07 全信息版：由纯字符串改为 {w, zh} 对象，zh 供 chip title 悬浮释义）
  assert.equal(r.synonyms.length, 3);
  assert.deepEqual(r.synonyms.map((s) => s.w), ["take", "use", "lend"]);
  assert.equal(r.synonyms[0].zh, "拿", "近义词应带中文注释");
  assert.equal(r.antonyms.length, 2);
  assert.deepEqual(r.antonyms.map((a) => a.w), ["give", "return"]);
});

test("parseHaiciLiteHtml: 最小样本（仅音标 + 简释）", () => {
  const r = parseHaiciLiteHtml(MINIMAL_HTML, "cat");
  assert.ok(r);
  assert.equal(r.phonetic, "英 /kæt/");
  assert.equal(r.meanings.length, 1);
  assert.equal(r.meanings[0].zh, "猫");
  assert.equal(r.inflections.length, 0);
  assert.equal(r.synonyms.length, 0);
  assert.equal(r.antonyms.length, 0);
});

test("parseHaiciLiteHtml: 空 HTML 返回 null", () => {
  assert.equal(parseHaiciLiteHtml(EMPTY_HTML, "xyz"), null);
  assert.equal(parseHaiciLiteHtml("", "xyz"), null);
});

test("parseHaiciLiteHtml: 音标缺失但有释义 → 仍返回结果", () => {
  const r = parseHaiciLiteHtml(NO_PHONETIC_HTML, "act");
  assert.ok(r, "释义存在应返回结果");
  assert.equal(r.phonetic, "");
  assert.equal(r.meanings.length, 1);
});

test("parseHaiciLiteHtml: 词形 label 尾冒号自动去掉", () => {
  const r = parseHaiciLiteHtml(BORROW_HTML, "borrow");
  // 词海 label 形如"过去式:"，应去除尾冒号
  assert.equal(r.inflections[0].label, "名词");
  assert.equal(r.inflections[1].label, "过去式");
});

test("parseEudicFullHtml 别名兜底：仍能解析（兼容旧调用）", () => {
  // 即使旧文件名 parseEudicFullHtml 被调用，内部走的是 parseHaiciLiteHtml
  const r = parseEudicFullHtml(BORROW_HTML, "borrow");
  assert.ok(r);
  assert.equal(r.source, "haici");
  assert.equal(r.synonyms.length, 3);
});

test("renderOnlineDictCard: 含 4 字段 + 徽标 + 词形 + 近反义 chips", () => {
  resetOnlineDictCache();
  const r = parseHaiciLiteHtml(BORROW_HTML, "borrow");
  assert.ok(r);
  const html = renderOnlineDictCard(r, false);
  // 徽标改为"海词"
  assert.match(html, /在线词典（海词）/);
  // 简释
  assert.match(html, /借；借鉴；抄袭/);
  // 词形行（2026-09-07 全信息版：不再用 <dl>/<dt>/<dd> section，
  // 改为并入简释义组的 hiword-dict-shapes，每项为可点击 chip）
  assert.match(html, /class="hiword-dict-shapes"/);
  assert.match(html, /hiword-dict-shape-k">过去式:<\/span>/);
  assert.match(html, /data-action="lookup-word" data-word="borrowed">borrowed<\/a>/);
  // 近反义词 chips（含 data-action="lookup-word" 用于递归查词）
  assert.match(html, /data-action="lookup-word"/);
  assert.match(html, /data-word="take"/);
  assert.match(html, /data-word="lend"/);
  assert.match(html, /data-word="give"/);
});

test("renderOnlineDictCard: 空 inflections/synonyms 不渲染空 section", () => {
  const r = parseHaiciLiteHtml(MINIMAL_HTML, "cat");
  assert.ok(r);
  const html = renderOnlineDictCard(r, false);
  // 不应出现词形行 / 近反义 chips（原 hiword-dict-section-title 已随改版移除，改断言实际产物）
  assert.doesNotMatch(html, /hiword-dict-shapes/);
  assert.doesNotMatch(html, /hiword-dict-syn-row/);
});
