import * as jsMdict from "js-mdict";
import { initDict, lookupSmart } from "../src/dict/dict-engine.ts";
import { extractSenses, extractPhrases } from "../src/dict/dict-renderer.ts";
const MDX = (jsMdict as any).MDX;
await initDict("dict/ecd2.mdx","ecd2","ECD2","en");
const mdx = new MDX("dict/ecd2.mdx");
function raw(w:string){ return String((mdx.lookup(w)||mdx.lookup(w.toLowerCase())||mdx.lookup(w.charAt(0).toUpperCase()+w.slice(1)))?.definition||""); }

// === 例句漏捕诊断 ===
console.log("===== 例句漏捕诊断 =====");
const exWords = ["book","run","take","make","get","go","set","put","keep","turn","break","bring","call","come","cut","fall","find","give","hold","leave","look","pass","pay","pull","push","show","stand","start","stop","talk","tell","think","try","walk","want","work","write","love","help","play"];
let missEx = 0;
for (const w of exWords) {
  const def = raw(w);
  const eaCount = (def.match(/<span\s+class="ea"/gi)||[]).length;
  const senses = extractSenses(def, 99);
  const rendered = senses.filter(s=>s.exampleEn && s.exampleEn.trim()).length;
  if (eaCount>0 && rendered < eaCount) {
    missEx++;
    console.log(`\n[例句漏捕] ${w}: 源ea=${eaCount} 渲染=${rendered}`);
    // show the ea blocks raw
    const eam = def.match(/<span\s+class="ea"[^>]*>[\s\S]*?<\/span>/gi) || [];
    eam.slice(0,2).forEach((b,i)=> console.log(`   ea[${i}]=`, b.slice(0,160).replace(/\n/g,' ')));
    // show structure: where is ea relative to xh
    const xhPos = def.indexOf('class="xh"');
    const eaPos = def.indexOf('class="ea"');
    console.log(`   首个xh@${xhPos} 首个ea@${eaPos} (ea在xh前=整块例句区, 不在义项内)`);
  }
}
console.log(`\n例句漏捕单词数: ${missEx}/${exWords.length}`);

// === 词组漏捕诊断 ===
console.log("\n===== 词组漏捕诊断 =====");
const phWords = ["arrive","break","bring","call","carry","come","cut","do","fall","get","give","go","keep","look","make","pass","put","run","set","take","turn","work"];
let missPh = 0;
for (const w of phWords) {
  const def = raw(w);
  const phCount = (def.match(/<span\s+class="ph"/gi)||[]).length;
  if (phCount>0) {
    const ext = extractPhrases(def);
    if (ext.length === 0) {
      missPh++;
      console.log(`\n[词组漏捕] ${w}: 源ph=${phCount} 提取=0`);
      const phIdx = def.indexOf('class="ph"');
      console.log("   ph块上下文:", def.slice(phIdx-60, phIdx+200).replace(/\n/g,' '));
    } else if (ext.length < phCount) {
      console.log(`\n[词组部分] ${w}: 源ph=${phCount} 提取=${ext.length}`);
      const phIdx = def.indexOf('class="ph"');
      console.log("   首ph上下文:", def.slice(phIdx-60, phIdx+200).replace(/\n/g,' '));
    }
  }
}
console.log(`\n词组漏捕单词数: ${missPh}`);
