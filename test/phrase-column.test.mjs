import { test } from "node:test";
import assert from "node:assert/strict";
import * as jsMdict from "js-mdict";
import {
  extractPhrases,
  parseDictEntry,
  renderVocabDetailCard,
  renderDictCard,
  renderPhraseSection,
} from "../src/dict/dict-renderer.ts";

const MDX = jsMdict.MDX;
const mdx = new MDX("./dict/ncecd.mdx", { locale: "en" });

const WORDS = "run,break,get,make,take,look,put,set,go,come,bring,keep,turn,fall,hold,apple,red,water,book,computer,time,day,blue,house,love,work,money,hand,happy".split(",");

function lookup(word) {
  try {
    const r = mdx.lookup(word);
    return r && r.definition ? r.definition : (r && r.text ? r.text : "");
  } catch {
    return "";
  }
}

// 收集真实词典中确实含词组的词，以及真实无词组的词
const withPhrase = [];
const withoutPhrase = [];
for (const w of WORDS) {
  const raw = lookup(w);
  if (!raw) continue;
  const e = parseDictEntry({ word: w, definition: raw });
  if (extractPhrases(e.definition).length) withPhrase.push(w);
  else withoutPhrase.push(w);
}

test("词组提取：覆盖 NCECD 常见词（run/make/take 等均有词组）", () => {
  for (const w of ["run", "make", "take", "get", "look", "break"]) {
    const e = parseDictEntry({ word: w, definition: lookup(w) });
    const ph = extractPhrases(e.definition);
    assert.ok(ph.length > 0, `${w} 应提取到词组，实际 ${ph.length}`);
    // 每条应有英文（词组本身），中文可有可无
    assert.ok(ph.every((p) => p.en && p.en.length >= 2), `${w} 存在无效词组条目`);
  }
});

test("词组栏 - 词库详情视图：有词组时渲染可折叠词组栏", () => {
  for (const w of withPhrase) {
    const e = parseDictEntry({ word: w, definition: lookup(w) });
    const card = renderVocabDetailCard(e, 1, "id_" + w, true);
    assert.ok(card.includes('data-section="phrase"'), `${w} 词库详情应渲染词组栏`);
    assert.ok(card.includes("词组 · 短语"), `${w} 词组栏标题应存在`);
  }
});

test("词组栏 - 查词视图(renderDictCard)：修复后也应渲染词组栏", () => {
  // 这是本次修复的核心：之前查词视图完全没有词组栏
  for (const w of withPhrase) {
    const e = parseDictEntry({ word: w, definition: lookup(w) });
    const card = renderDictCard(e, { showStar: true, inVocab: true });
    assert.ok(card.includes('data-section="phrase"'), `${w} 查词视图应渲染词组栏（修复点）`);
  }
});

test("词组栏 - 无词组时不渲染区块（避免空栏）", () => {
  for (const w of withoutPhrase) {
    const e = parseDictEntry({ word: w, definition: lookup(w) });
    const card = renderDictCard(e, { showStar: true, inVocab: true });
    assert.ok(!card.includes('data-section="phrase"'), `${w} 无词组时不应渲染空词组栏`);
  }
});

test("renderPhraseSection：空数组返回空字符串", () => {
  assert.equal(renderPhraseSection([]), "");
  const html = renderPhraseSection([{ en: "to go home", zh: "回家" }]);
  assert.ok(html.includes('data-section="phrase"') && html.includes("to go home"));
});

test("词组提取：支持 maybe_phrase next 变体（含额外 class）", () => {
  const def = '<div class="maybe_phrase next"><span class="mphr_en">a test phrase</span><span class="zh">测试短语</span></div>';
  const ph = extractPhrases(def);
  assert.equal(ph.length, 1, "带 next 后缀的词组块应被提取");
  assert.equal(ph[0].en, "a test phrase");
});

console.log(`\n覆盖统计：含词组 ${withPhrase.length} 词，无词组 ${withoutPhrase.length} 词（${withoutPhrase.join(", ") || "无"}）`);
