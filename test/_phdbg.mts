import * as jsMdict from "js-mdict";
import { initDict } from "../src/dict/dict-engine.ts";
const MDX = (jsMdict as any).MDX;
await initDict("dict/ecd2.mdx","ecd2","ECD2","en");
const mdx = new MDX("dict/ecd2.mdx");
function raw(w:string){ return String((mdx.lookup(w)||mdx.lookup(w.toLowerCase())||mdx.lookup(w.charAt(0).toUpperCase()+w.slice(1)))?.definition||""); }
const def = raw("come");
const phRe = /<span\s+class=["']ph["'][^>]*>([\s\S]*?)<\/span>/gi;
const phMatches = [...def.matchAll(phRe)];
console.log("phMatches:", phMatches.length);
const seen = new Set<string>();
let pushed=0, skippedEmpty=0, skippedDup=0;
for (let i=0;i<phMatches.length;i++){
  const pm = phMatches[i];
  const enRaw = pm[1].replace(/<[^>]+>/g,"").trim();
  if (!enRaw || enRaw.length<2){skippedEmpty++;continue;}
  const key = enRaw.toLowerCase();
  if (seen.has(key)){skippedDup++;continue;}
  seen.add(key);
  pushed++;
}
console.log("pushed:",pushed,"skippedEmpty:",skippedEmpty,"skippedDup:",skippedDup);
// show first 5 enRaw
for(let i=0;i<5;i++) console.log(`  [${i}] enRaw=`, JSON.stringify(phMatches[i][1].replace(/<[^>]+>/g,"").trim().slice(0,50)));
