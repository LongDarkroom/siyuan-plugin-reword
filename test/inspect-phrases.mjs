import * as jsMdict from "js-mdict";
const MDX = jsMdict.MDX;

const path = process.argv[2] || "./dict/ncecd.mdx";
const words = (process.argv[3] || "run,break,get,make,take,look,put,set,go,come").split(",");

const mdx = new MDX(path, { locale: "en" });

function findPhraseMarkup(html) {
  const markers = [];
  const reMaybe = /<div class="(maybe_phrase|collocation)"/gi;
  let m;
  while ((m = reMaybe.exec(html))) markers.push(m[0]);
  const rePhr = /class="(phr\.?|phrase_with_or|mphr_en to|phrase_sense|collocation|colloc|idm)"/gi;
  while ((m = rePhr.exec(html))) markers.push(m[0]);
  // 任意含 phrase/colloc 的 class
  const reAny = /class="[^"]*(phrase|colloc|idm)[^"]*"/gi;
  while ((m = reAny.exec(html))) markers.push(m[0]);
  return [...new Set(markers)];
}

for (const w of words) {
  let def = "";
  try {
    const r = mdx.lookup(w);
    def = r && r.definition ? r.definition : (r && r.text ? r.text : "");
  } catch (e) {
    def = "";
  }
  if (!def) {
    console.log(`\n### ${w}: (lookup 失败/空)`);
    continue;
  }
  const markers = findPhraseMarkup(def);
  console.log(`\n### ${w}: 词组标记命中 = ${markers.length}`);
  markers.slice(0, 8).forEach((x) => console.log("   - " + x));
  // 截取含 maybe_phrase/collocation 的片段展示真实结构
  const idx = def.search(/maybe_phrase|collocation|class="phr|phrase_with_or|mphr_en to|idm/gi);
  if (idx >= 0) {
    console.log("--- 真实片段 ---");
    console.log(def.slice(idx - 30, idx + 320).replace(/\n/g, " "));
  }
}
