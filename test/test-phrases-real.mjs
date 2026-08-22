import * as jsMdict from "js-mdict";
import { extractPhrases, parseDictEntry, renderVocabDetailCard } from "../src/dict/dict-renderer.ts";

const MDX = jsMdict.MDX;
const mdx = new MDX("./dict/ncecd.mdx", { locale: "en" });
const words = "run,break,get,make,take,look,put,set,go,come,bring,keep,turn,fall,hold".split(",");

let totalShown = 0, totalHidden = 0;
for (const w of words) {
  let raw = "";
  try { const r = mdx.lookup(w); raw = r && r.definition ? r.definition : (r && r.text ? r.text : ""); } catch {}
  if (!raw) { console.log(`${w}: lookup 空`); continue; }
  const entry = parseDictEntry({ word: w, definition: raw });
  const phrases = extractPhrases(entry.definition);
  const card = renderVocabDetailCard(entry, 1, "id_" + w, true);
  const hasSection = card.includes('data-section="phrase"');
  const status = hasSection ? "✅显示词组栏" : "❌无词组栏";
  if (hasSection) totalShown++; else totalHidden++;
  console.log(`${w}: extractPhrases=${phrases.length} 渲染词组栏=${hasSection} ${status}`);
  if (phrases.length && !hasSection) {
    console.log("   ⚠️ 矛盾：提取到词组但渲染未出现词组栏！");
  }
  if (phrases.length) {
    console.log("   样例: " + phrases.slice(0, 3).map(p => p.en + (p.zh ? "(" + p.zh + ")" : "")).join(" / "));
  }
}
console.log(`\n汇总：显示词组栏 ${totalShown} / 隐藏 ${totalHidden}（共 ${words.length} 词）`);
