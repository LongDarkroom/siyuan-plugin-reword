import * as jsMdict from "js-mdict";
import { initDict } from "../src/dict/dict-engine.ts";
import { extractPhrases } from "../src/dict/dict-renderer.ts";
const MDX = (jsMdict as any).MDX;
await initDict("dict/ecd2.mdx","ecd2","ECD2","en");
const mdx = new MDX("dict/ecd2.mdx");
function raw(w:string){ return String((mdx.lookup(w)||mdx.lookup(w.toLowerCase())||mdx.lookup(w.charAt(0).toUpperCase()+w.slice(1)))?.definition||""); }
for (const w of ["come","call","run","take","get","bring"]) {
  const def = raw(w);
  const phCount = (def.match(/<span\s+class="ph"/gi)||[]).length;
  const ext = extractPhrases(def);
  console.log(`\n${w}: 源ph=${phCount} 提取=${ext.length}`);
  if (ext.length>0) console.log("  首3:", JSON.stringify(ext.slice(0,3)));
  // debug: how many ph spans match phRe
  const phRe = /<span\s+class=["']ph["'][^>]*>([\s\S]*?)<\/span>/gi;
  const matches = [...def.matchAll(phRe)];
  console.log("  phRe匹配数:", matches.length, " 首个enRaw:", matches[0]? matches[0][1].slice(0,40):"none");
}
