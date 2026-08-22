#!/usr/bin/env node
/**
 * NCECD 命中率分层诊断脚本（90% 攻坚方案 §1 的落地实现）
 * ------------------------------------------------------------------
 * 用法：
 *   node scripts/diagnose_hitrate.mjs [count] [seedBase]
 *      count    抽样词条数，默认 1000
 *      seedBase 随机种子基数，默认 20260814（+99 = 与方案 §0 诊断同源）
 *
 * 输出指标（均按「用户可感知」口径统计）：
 *   - 中文可用率：重定向解析后含 <span class="zh"> 或 互见跟随补回(resolvedZh) 或 note 回退
 *   - 词性可见率：含 class 分区 或 词组词条(phr.) 或 互见含词性 或 习语/短语义项区(phr.) 或 变形说明型继承原词词性
 *   - 内容可渲染率：按词条类型分诊（standard=有义项/note；phrase=主词组提取成功；crossref=目标提取成功；plain=有字段）
 *   - 分层：纯单词 / 短语(含空格) / 其他，分别统计
 * ------------------------------------------------------------------
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const [countRaw = "1000", seedBaseRaw = "20260814"] = process.argv.slice(2);
const COUNT = Math.max(100, Math.min(5000, parseInt(countRaw, 10) || 1000));
const SEED_BASE = parseInt(seedBaseRaw, 10) || 20260814;
const SEED = SEED_BASE + 99;

const { MDX } = require("js-mdict");
const MDX_FILE = path.join(PLUGIN_ROOT, "dict", "ncecd.mdx");
const mdx = new MDX(MDX_FILE);
const keywordList = Array.isArray(mdx.keywordList) ? mdx.keywordList.map((k) => k?.keyText ?? String(k)) : [];

// P3 外部音标补全表（可选）
let phonExtra = null;
try {
  const phPath = path.join(PLUGIN_ROOT, "dict", "phon_extra.json");
  if (fs.existsSync(phPath)) phonExtra = JSON.parse(fs.readFileSync(phPath, "utf-8"));
} catch {
  phonExtra = null;
}
const hasExtraPhon = (w) => !!(phonExtra && phonExtra[String(w).toLowerCase()]);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clean(s) {
  return (s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
function getDef(w) {
  try {
    const e = mdx.lookup(w);
    return e && e.definition != null ? String(e.definition) : "";
  } catch {
    return "";
  }
}
function resolveRedirect(def) {
  let cur = def, d = 0;
  while (d < 5 && /^@@@LINK=/m.test(cur.trim())) {
    const t = cur.trim().replace(/^@@@LINK=/, "").split(/[\u0000\r\n]/)[0].trim();
    const r = mdx.lookup(t);
    if (!r || r.definition == null) break;
    cur = String(r.definition);
    d++;
  }
  return cur;
}
function crossTarget(def) {
  if (!def) return null;
  let raw = null;
  const a = /<div class="also">([\s\S]*?)<\/div>/.exec(def);
  if (a) {
    const inner = a[1];
    const lm = inner.match(/<a\s+href="entry:\/\/[^"]*">([\s\S]*?)<\/a>/);
    raw = lm ? lm[1] : inner.replace(/<span class="zh">[\s\S]*?<\/span>/g, "");
  } else {
    const im = def.match(/=\s*<a\s+href="entry:\/\/[^"]*">([\s\S]*?)<\/a>/i);
    if (im) raw = im[1];
  }
  if (!raw) return null;
  let t = clean(raw);
  if (!t) return null;
  if (/[，,]\s*\d+\s*$/.test(t)) return null;
  t = t.replace(/[，,]\s*\d+.*$/g, "").replace(/[\u00B9\u00B2\u00B3\u2070-\u209F]+$/g, "").trim();
  return t || null;
}
function followZh(def) {
  const seen = new Set();
  let t = crossTarget(def), d = 0;
  while (t && d < 3 && !seen.has(t.toLowerCase())) {
    seen.add(t.toLowerCase());
    const e = mdx.lookup(t);
    if (!e || e.definition == null) break;
    const td = resolveRedirect(String(e.definition));
    const z = /<span class="zh">([\s\S]*?)<\/span>/i.exec(td);
    if (z) return clean(z[1]);
    t = crossTarget(td);
    d++;
  }
  return "";
}
function kindOf(def) {
  if (/<div class="sense">/.test(def)) return "standard";
  if (/<div class="(?:maybe_phrase|collocation)[^"]*">/.test(def)) return "phrase";
  if (/<div class="also">/.test(def)) return "crossref";
  if (/=\s*<a\s+href="entry:\/\/[^"]*">/i.test(def)) return "crossref";
  return "plain";
}

const rng = mulberry32(SEED);
const used = new Set();
const sample = [];
while (sample.length < COUNT) {
  const i = Math.floor(rng() * keywordList.length);
  if (used.has(i)) continue;
  used.add(i);
  sample.push(keywordList[i]);
}

const isWord = /^[a-z][a-z-]{1,19}$/i;
const isPhrase = /^[a-z].*\s/i;
const mk = () => ({ n: 0, phon: 0, zh: 0, pos: 0, cov: 0 });
const stat = { all: mk(), word: mk(), phrase: mk(), other: mk() };
const kindDist = {};

for (const w of sample) {
  const def = resolveRedirect(getDef(w));
  if (!def) continue;
  const layer = isWord.test(w) ? "word" : isPhrase.test(w) ? "phrase" : "other";
  const k = kindOf(def);
  kindDist[k] = (kindDist[k] || 0) + 1;

  const zhRaw = /<span class="zh">/.test(def);
  const fz = zhRaw ? "" : followZh(def); // 短路径：已有 zh 不再二次查词
  const note = !zhRaw && !fz && /<div class="sense">/.test(def);
  const hasClass = /<span class="class[^"]*">/.test(def);
  const phrasal = /<div class="(?:idiom|phr_s|phr)">/.test(def) || /<span class="(?:dodo_phrase_sense|phrase_sense)">/.test(def);
  const noteInh = !hasClass && /<div class="sense">/.test(def) &&
    /([A-Za-z][A-Za-z'-]{1,39})\s*的(?:过去式|过去分词|现在分词|第三人称单数|复数|比较级|最高级)/.test(def);
  const zhOk = zhRaw || fz || note;
  const posOk = hasClass || k === "phrase" || (k === "crossref" && hasClass) || phrasal || noteInh;
  const cov = k === "standard" ? /<div class="sense">/.test(def) : k === "phrase" || k === "crossref" ? true : zhRaw;
  const phonOk = /<pron[^>]*>/i.test(def) || hasExtraPhon(w); // P3：NCECD 无音标时回退 phon_extra

  for (const key of ["all", layer]) {
    const s = stat[key];
    s.n++;
    if (phonOk) s.phon++;
    if (zhOk) s.zh++;
    if (posOk) s.pos++;
    if (cov) s.cov++;
  }
}

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + "%" : "0%");
console.log(`NCECD 命中率诊断（${COUNT} 词条，种子 ${SEED}）`);
console.log("");
console.log("| 分层 | 样本 | 音标(含P3回退) | 中文可用率 | 词性可见率 | 内容可渲染率 |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const k of ["all", "word", "phrase", "other"]) {
  const s = stat[k];
  console.log(`| ${k} | ${s.n} | ${pct(s.phon, s.n)} | ${pct(s.zh, s.n)} | ${pct(s.pos, s.n)} | ${pct(s.cov, s.n)} |`);
}
console.log("");
console.log("类型分布:", JSON.stringify(kindDist));
console.log("口径说明：音标=NCECD<pron>+phon_extra回退；中文可用=zh原始+互见跟随+note回退；词性可见=class+phr.+互见+变形继承；覆盖=按类型分诊");
