#!/usr/bin/env node
/**
 * P3 数据增强：从 CMU Pronouncing Dictionary（公有领域）生成外部音标补全表
 * ------------------------------------------------------------------
 * 用法：
 *   node scripts/build_phon_extra.mjs [cmudictPath]
 *      cmudictPath  CMU 词典文件路径（默认 /tmp/cmudict.dict）
 *
 * 原理：
 *   1) 解析 cmudict.dict（ARPABET），转换为 IPA（含主重音 ˈ / 次重音 ˌ）；
 *   2) 加载 NCECD 词表（dict/ncecd.mdx）建立小写词头集合；
 *   3) 只保留「NCECD 中存在」的词（cmudict ∩ NCECD），避免冗余；
 *   4) 输出 dict/phon_extra.json：{ "word": "/ipa/", ... }（键小写）。
 *
 * 运行时（dict-engine.ts）：词典加载成功后从同目录读 phon_extra.json 建 Map，
 * 解析释义无 <pron> 时按词头小写回退查询（getExtraPhonetic）。
 * ------------------------------------------------------------------
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const CMUDICT = process.argv[2] || "/tmp/cmudict.dict";
const OUT = path.join(PLUGIN_ROOT, "dict", "phon_extra.json");

if (!fs.existsSync(CMUDICT)) {
  console.error(`CMU 词典不存在: ${CMUDICT}（先下载：curl -L -o /tmp/cmudict.dict https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict）`);
  process.exit(1);
}

// ---------- ARPABET → IPA（含重音）----------
const VOWEL_MAP = {
  AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ",
  EH: "ɛ", ER: "ɝ", EY: "eɪ", IH: "ɪ", IY: "i", OW: "oʊ",
  OY: "ɔɪ", UH: "ʊ", UW: "u",
};
const CONSONANT_MAP = {
  B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h",
  JH: "dʒ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", P: "p",
  R: "r", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w",
  Y: "j", Z: "z", ZH: "ʒ",
};

function arpabetToIpa(phones) {
  let out = "";
  let lastVowelEnd = -1; // 输出串中上一个元音的结束位置 → 重音标应插在其后（音节起始）
  for (const ph of phones) {
    let stress = "";
    let base = ph;
    if (/[012]$/.test(ph)) {
      const d = ph[ph.length - 1];
      base = ph.slice(0, -1);
      stress = d === "1" ? "ˈ" : d === "2" ? "ˌ" : "";
    }
    const ip = VOWEL_MAP[base] || CONSONANT_MAP[base];
    if (!ip) continue;
    // IPA 重音标在「重读音节的起始」（上一个元音之后、音节辅音开头之前），而非紧跟元音
    if (stress) {
      const pos = lastVowelEnd + 1;
      out = out.slice(0, pos) + stress + out.slice(pos);
    }
    out += ip;
    if (VOWEL_MAP[base]) lastVowelEnd = out.length - 1;
  }
  if (!out) return "";
  return "/" + out + "/";
}

// ---------- 解析 CMU ----------
console.log("解析 CMU 词典:", CMUDICT);
const cmuNorm = new Map(); // 去标点小写 → ipa（取首个发音）
for (const line of fs.readFileSync(CMUDICT, "utf-8").split("\n")) {
  if (!line || line.startsWith(";;;")) continue;
  const sp = line.indexOf(" ");
  if (sp < 0) continue;
  const word = line.slice(0, sp).trim();
  const phones = line.slice(sp + 1).trim().split(/\s+/);
  if (!word || !phones.length) continue;
  const ipa = arpabetToIpa(phones);
  if (!ipa) continue;
  const key = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!cmuNorm.has(key)) cmuNorm.set(key, ipa);
}
console.log("CMU 词条(归一):", cmuNorm.size);

// ---------- 变形词干回退（镜像 dict-engine.generateLemmas 的常见变形） ----------
// NCECD 无音标词头可能是变形词（doweling → dowel / irksomely → irksome），
// 直接查不到时按常见词形还原找词干音标。仅用于补全表生成，运行时不受影响。
function lemmaCandidates(word) {
  const w = word.toLowerCase();
  const out = new Set();
  const add = (c) => { if (c && c.length >= 3) out.add(c); };
  if (w.endsWith("ies") && w.length > 4) add(w.slice(0, -3) + "y");
  if (/(ses|xes|zes|ches|shes)$/.test(w)) add(w.slice(0, -2));
  if (w.endsWith("ves")) { add(w.slice(0, -3) + "f"); add(w.slice(0, -3) + "fe"); }
  if (w.endsWith("s") && !w.endsWith("ss")) add(w.slice(0, -1));
  if (w.endsWith("ied") && w.length > 4) add(w.slice(0, -3) + "y");
  if (w.endsWith("ed") && w.length > 3) { add(w.slice(0, -2)); add(w.slice(0, -2) + "e"); }
  if (w.endsWith("ing") && w.length > 4) { add(w.slice(0, -3)); add(w.slice(0, -3) + "e"); }
  if (w.endsWith("iest") && w.length > 5) add(w.slice(0, -4) + "y");
  if (w.endsWith("est") && w.length > 4) { add(w.slice(0, -3)); add(w.slice(0, -3) + "e"); }
  if (w.endsWith("er") && w.length > 3) { add(w.slice(0, -2)); add(w.slice(0, -2) + "e"); }
  if (w.endsWith("ly") && w.length > 3) { add(w.slice(0, -2)); add(w.slice(0, -2) + "e"); }
  for (const suf of ["ness", "ment", "tion", "sion", "able", "ible", "ous", "ful", "less", "ity", "ist", "ism", "ize", "ise", "ify", "ation", "ition"]) {
    if (w.endsWith(suf) && w.length > suf.length + 2) { add(w.slice(0, -suf.length)); add(w.slice(0, -suf.length) + "e"); }
  }
  return [...out];
}

// ---------- 按 NCECD 词头生成补全表 ----------
const { MDX } = require("js-mdict");
const MDX_FILE = path.join(PLUGIN_ROOT, "dict", "ncecd.mdx");
console.log("加载 NCECD 词表:", MDX_FILE);
const mdx = new MDX(MDX_FILE);
const keywordList = Array.isArray(mdx.keywordList) ? mdx.keywordList.map((k) => k?.keyText ?? String(k)) : [];
console.log("NCECD 词头:", keywordList.length);

const out = {};
let matched = 0, matchedStem = 0;
for (const w of keywordList) {
  const lw = String(w).toLowerCase().trim();
  if (!lw || out[lw]) continue;
  // 人名条目（"Surname, Given (X)"）取逗号前姓氏作为音标查询形式；其余整词
  const namePart = lw.includes(",") ? lw.split(",")[0].trim() : lw;
  // 去标点归一（连字符/上撇/破折号）：pent-up → pentup；ichthyo- → ichthyo
  const norm = namePart.replace(/[^a-z0-9]/g, "");
  if (!norm) continue;
  let ipa = cmuNorm.get(norm);
  if (!ipa) continue;
  out[lw] = ipa;
  matched++;
}
console.log("写入词条:", matched);

fs.writeFileSync(OUT, JSON.stringify(out), "utf-8");
const size = fs.statSync(OUT).size;
console.log(`已写入 ${OUT}（${(size / 1024).toFixed(1)} KB）`);
