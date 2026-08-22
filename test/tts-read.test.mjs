import { test } from "node:test";
import assert from "node:assert/strict";
import * as jsMdict from "js-mdict";
import {
  renderSensesList,
  renderVocabDetailSenses,
  renderDictCard,
  parseDictEntry,
} from "../src/dict/dict-renderer.ts";

const MDX = jsMdict.MDX;
const mdx = new MDX("./dict/ncecd.mdx", { locale: "en" });

function lookup(word) {
  let raw = "";
  try {
    const r = mdx.lookup(word);
    raw = r && r.definition ? r.definition : (r && r.text ? r.text : "");
  } catch { /* ignore */ }
  return raw;
}

// 用确认含例句的常用词（run/make/take 在 NCECD 中均有例句）
const WORDS = ["run", "make", "take"];
const entries = WORDS
  .map((w) => ({ w, raw: lookup(w) }))
  .filter((x) => x.raw && x.raw.includes("ex"));

test("例句朗读：渲染产物含可点击朗读入口 (data-action=tts + data-text)", () => {
  assert.ok(entries.length > 0, "测试词需至少有一个含例句，实际: " + entries.length);
  let found = false;
  for (const { w, raw } of entries) {
    const e = parseDictEntry({ word: w, definition: raw });
    for (const html of [renderSensesList(e.definition, 8), renderVocabDetailSenses(e.definition)]) {
      const rowOk = html.includes('class="hiword-dict-sense-ex-row" data-action="tts"');
      const textOk = html.includes("data-text=");
      if (rowOk && textOk) found = true;
    }
  }
  assert.ok(found, "至少一个词在任一种视图完整渲染出 data-action=tts 的例句朗读入口");
});

test("例句朗读：单词朗读(data-word) 与 例句朗读(data-text) 可明确区分", () => {
  const { w, raw } = { w: "run", raw: lookup("run") };
  const e = parseDictEntry({ word: w, definition: raw });
  // 单词朗读按钮在查词卡片层（data-word），例句朗读在释义列表层（data-text）
  const card = renderDictCard(e, { showStar: true, inVocab: true });
  assert.ok(card.includes("data-word="), "查词卡片应含单词朗读按钮 (data-word)");
  const list = renderSensesList(e.definition, 8);
  assert.ok(list.includes("data-text="), "释义列表应含例句朗读入口 (data-text)");
  // 例句行的 data-text 紧邻例句行定义
  const idxRow = list.indexOf("hiword-dict-sense-ex-row");
  const idxText = list.indexOf("data-text=", idxRow);
  assert.ok(idxText > idxRow && idxText < idxRow + 400, "例句行的 data-text 应紧邻例句行定义");
});
