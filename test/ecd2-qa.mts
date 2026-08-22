import * as jsMdict from "js-mdict";
import { initDict, lookupSmart } from "../src/dict/dict-engine.ts";
import { parseDictEntry, extractSenses, extractPhrases, renderDictCard } from "../src/dict/dict-renderer.ts";

const MDX = (jsMdict as any).MDX;
const ECD2 = "dict/ecd2.mdx";
const WORD_RE = /^[A-Za-z][A-Za-z'’-]{1,19}$/;
const CJK = /[一-鿿㐀-䶿]/;
const REPL = /\uFFFD/;
const MOJIBAKE = /Ã.|â€|Â©|Ã©|Ã¨|Ã¶|Ã¼/;
const PHON_SRC = /<span\s+class="tr">\s*([^<]+)/i;

function mulberry32(a: number) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function main() {
  console.log("[QA] 加载 ECD2 引擎 (initDict) ...");
  await initDict(ECD2, "ecd2", "英汉大词典（第2版）", "en");
  console.log("[QA] 引擎就绪，activeId =", "ecd2");

  // 单独只读实例用于抽样词表（抽样后释放，避免与引擎双份内存）
  console.log("[QA] 读取词表用于随机抽样 ...");
  const listMdx = new MDX(ECD2);
  const kl: any[] = listMdx.keywordList;
  console.log("[QA] 词表规模 =", kl.length);

  const rounds = 3, perRound = 200;
  const roundsData: any[] = [];

  for (let r = 1; r <= rounds; r++) {
    const rng = mulberry32(r * 1000 + 7);
    const sampled: string[] = [];
    let attempts = 0;
    while (sampled.length < perRound && attempts < perRound * 40) {
      attempts++;
      const k = kl[Math.floor(rng() * kl.length)]?.keyText || "";
      if (WORD_RE.test(k) && !sampled.includes(k)) sampled.push(k);
    }
    console.log(`[QA] 第${r}轮：抽样 ${sampled.length} 个单词（随机尝试 ${attempts} 次）`);

    const m = {
      round: r, total: sampled.length,
      hit: 0, miss: [] as string[],
      phonSrc: 0, phonExtracted: 0, phonMissingWhenSrc: [] as string[],
      meaningEntries: 0, meaningMissingWhenCJK: [] as string[],
      phraseSrcBlocks: 0, phraseExtractedEntries: 0, phraseGap: [] as string[],
      exampleSrcEA: 0, examplePlugin: 0, exampleReversed: [] as string[],
      garbled: 0, garbledWords: [] as string[], strayTr: 0,
      exampleWords: [] as string[], phraseWords: [] as string[],
    };

    for (const w of sampled) {
      const entry = lookupSmart(w);
      if (!entry) { m.hit = m.hit; m.miss.push(w); continue; }
      m.hit++;
      const def = entry.definition || "";
      const parsed = parseDictEntry(entry);

      // 音标：源有 / 插件提取
      const ph = def.match(PHON_SRC);
      if (ph) m.phonSrc++;
      if (parsed.phonetic && parsed.phonetic.trim()) m.phonExtracted++;
      else if (ph) m.phonMissingWhenSrc.push(w);

      // 意思
      const senses = extractSenses(def, 99);
      const withZh = senses.filter((s: any) => s.zh && CJK.test(s.zh));
      if (withZh.length > 0) m.meaningEntries++;
      else if (CJK.test(def)) m.meaningMissingWhenCJK.push(w);

      // 词组：源 class="ph" 块数 vs 插件 extractPhrases
      const srcPh = (def.match(/class="ph"/gi) || []).length;
      m.phraseSrcBlocks += srcPh;
      const extPh = extractPhrases(def);
      if (srcPh > 0) {
        if (extPh.length > 0) m.phraseExtractedEntries++;
        else m.phraseGap.push(w);
      }

      // 例句：源 ea(英文)/eb(中文) vs 插件 examples 数组（ECD2 一个义项可有多条）
      const eaCount = (def.match(/<span\s+class="ea"/gi) || []).length;
      m.exampleSrcEA += eaCount;
      const senses2 = extractSenses(def, 99);
      let pluginEx = 0, reversed = false;
      for (const s of senses2) {
        // 优先统计 examples 数组（全部配对例句），回退 exampleEn
        const list = (s.examples && s.examples.length) ? s.examples : (s.exampleEn ? [{ en: s.exampleEn, zh: s.example || "" }] : []);
        for (const ex of list) {
          if (ex.en && ex.en.trim()) {
            pluginEx++;
            if (CJK.test(ex.en)) reversed = true;
          }
        }
      }
      m.examplePlugin += pluginEx;
      if (reversed) m.exampleReversed.push(w);

      // 样式/乱码：渲染卡片后扫描
      const html = renderDictCard(parsed);
      if (REPL.test(html) || MOJIBAKE.test(html)) { m.garbled++; if (m.garbledWords.length < 15) m.garbledWords.push(w); }
      if (/<tr>/.test(def)) m.strayTr++;

      if (m.exampleWords.length < 6 && eaCount > 0) m.exampleWords.push(w);
      if (m.phraseWords.length < 6 && srcPh > 0) m.phraseWords.push(w);
    }

    roundsData.push(m);
    const acc = (m.hit / m.total * 100).toFixed(1);
    const phonCov = (m.phonExtracted / m.total * 100).toFixed(1);
    const phonOfSrc = m.phonSrc ? (m.phonExtracted / m.phonSrc * 100).toFixed(1) : "n/a";
    const meanCov = (m.meaningEntries / m.total * 100).toFixed(1);
    const phrCov = m.phraseSrcBlocks ? (m.phraseExtractedEntries / /*entries with src*/ 0) : "n/a";
    console.log(`[QA] 第${r}轮 -> 命中率 ${acc}% | 音标覆盖 ${phonCov}%(源有音标 ${m.phonSrc}, 插件提取 ${m.phonExtracted}) | 意思覆盖 ${meanCov}% | 源例句ea ${m.exampleSrcEA} 插件例句 ${m.examplePlugin} | 源词组块 ${m.phraseSrcBlocks} 插件提取词条 ${m.phraseExtractedEntries} | 乱码 ${m.garbled}`);
  }

  // 写出报告
  const fsMod = await import("node:fs");
  const out = { generatedAt: new Date().toISOString(), dict: "ECD2", rounds: roundsData };
  fsMod.writeFileSync("qa-reports/ecd2-qa-report.json", JSON.stringify(out, null, 2));
  console.log("[QA] 报告已写入 qa-reports/ecd2-qa-report.json");
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
