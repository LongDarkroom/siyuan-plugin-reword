#!/usr/bin/env node
/**
 * 「新世纪英汉大词典(全量)」三轮 ×200 词对抽取 QA 脚本
 * ------------------------------------------------------------------
 * 用法：
 *   node scripts/sample_dict_qa.mjs [round] [count] [seedBase]
 *      round    1|2|3（每轮固定种子，可复现），默认 1
 *      count    每轮抽取词对数，默认 200
 *      seedBase 随机种子基数，默认 20260814
 *
 * 输出（写到 plugin 根目录 qa-reports/）：
 *   - dict_qa_round{N}_report.json    逐词结构化 QA 明细
 *   - dict_qa_round{N}_report.md      人读报告（统计 + 问题清单）
 *   - dict_qa_round{N}_preview.html   前 30 词渲染预览（内联样式，浏览器打开即可看 UI）
 *
 * 三轮聚焦：
 *   R1 结构完整性 & 字段命中率（音标/词性分区/义项数/例句是否命中/词组/交叉引用）
 *   R2 释义质量（中文通顺、实体残留、重复义项、编号连续、词性归属）
 *   R3 UI 呈现验收（信息层级、例句区分度、长词条折叠、暗色对比度）
 * ------------------------------------------------------------------
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");

const [roundRaw = "1", countRaw = "200", seedBaseRaw = "20260814"] = process.argv.slice(2);
const ROUND = Math.min(3, Math.max(1, parseInt(roundRaw, 10) || 1));
const COUNT = Math.max(10, Math.min(500, parseInt(countRaw, 10) || 200));
const SEED_BASE = parseInt(seedBaseRaw, 10) || 20260814;

// ---------- 可复现随机数（mulberry32）----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 加载词典 ----------
const { MDX } = require("js-mdict");
const MDX_FILE = path.join(PLUGIN_ROOT, "dict", "ncecd.mdx");
if (!fs.existsSync(MDX_FILE)) {
  console.error(`词典文件不存在: ${MDX_FILE}`);
  process.exit(1);
}
const mdx = new MDX(MDX_FILE);
const keywordList = Array.isArray(mdx.keywordList) ? mdx.keywordList.map((k) => k?.keyText ?? String(k)) : [];
console.log(`已加载词典词表：${keywordList.length} 条`);

// P3 外部音标补全表（phon_extra.json，可选；缺失时音标口径退化为纯 NCECD）
let phonExtra = null;
try {
  const phPath = path.join(PLUGIN_ROOT, "dict", "phon_extra.json");
  if (fs.existsSync(phPath)) {
    phonExtra = JSON.parse(fs.readFileSync(phPath, "utf-8"));
    console.log(`已加载外部音标补全表：${Object.keys(phonExtra).length} 条`);
  }
} catch {
  phonExtra = null;
}
const hasExtraPhon = (w) => !!(phonExtra && phonExtra[String(w).toLowerCase()]);

// ---------- 干净文本 ----------
function cleanHtml(s) {
  return (s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- 结构化抽取（镜像 dict-renderer.extractSenses 的 NCECD 分支 + 本次修复）----------
function extractSenses(definition, max = 4) {
  const out = [];
  if (!/class="sense"/.test(definition)) return out;
  const classRe = /<span class="class[^"]*">([^<]*)<\/span>/g;
  const posRegions = [];
  let cm;
  while ((cm = classRe.exec(definition))) posRegions.push({ pos: normPos(cm[1]), start: cm.index });
  const posFor = (at) => {
    let p = posRegions.length ? posRegions[0].pos : "";
    for (const r of posRegions) { if (r.start <= at) p = r.pos; else break; }
    return p;
  };
  const isPhrasalAt = (at) => {
    const upTo = definition.slice(0, at);
    return /<div class="(?:idiom|phr_s|phr)">/.test(upTo) || /<span class="(?:dodo_phrase_sense|phrase_sense)">/.test(upTo);
  };
  const exBlocks = [];
  const exRe = /<p class="ex">([\s\S]*?)<\/p>/g;
  let em;
  while ((em = exRe.exec(definition))) {
    const en = em[1].replace(/<span class="zh">[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const zm = em[1].match(/<span class="zh">([\s\S]*?)<\/span>/i);
    exBlocks.push({ start: em.index, en, zh: zm ? cleanHtml(zm[1]) : "" });
  }
  const senseMatches = [];
  const re = /<div class="sense">([\s\S]*?)<\/div>/g;
  let mm;
  while ((mm = re.exec(definition))) senseMatches.push({ inner: mm[1], start: mm.index, end: mm.index + mm[0].length });
  for (let si = 0; si < senseMatches.length && out.length < max; si++) {
    const sm = senseMatches[si];
    const inner = sm.inner;
    const numM = inner.match(/<b class="num">([^<]*)<\/b>/);
    const briefM = inner.match(/<strong class="brief_ex">([\s\S]*?)<\/strong>/);
    const labelM = inner.match(/<span class="label">([\s\S]*?)<\/span>/i);
    const zhParts = [...inner.matchAll(/<span class="zh">([\s\S]*?)<\/span>/g)].map((x) => cleanHtml(x[1]));
    let zh = zhParts.join("；");
    // 语法说明/变形说明型义项：sense 内无 zh span 时回退说明文字（与 dict-renderer.ts 一致）
    let note = "";
    if (!zh) {
      const briefOnly = briefM ? cleanHtml(briefM[1]) : "";
      const noteText = cleanHtml(
        inner
          .replace(/<b class="num">[\s\S]*?<\/b>/g, " ")
          .replace(/<strong class="brief_ex">[\s\S]*?<\/strong>/g, " ")
          .replace(/<span class="label">[\s\S]*?<\/span>/gi, " ")
          .replace(/<a\s+href="entry:\/\/[^"]*">/gi, " ")
          .replace(/<\/a>/gi, " ")
      );
      if (briefOnly && briefOnly !== "See") {
        note = briefOnly;
        zh = briefOnly;
      } else if (noteText && noteText !== "See") {
        note = noteText;
        zh = noteText;
      }
    }
    // 例句：先取 sense 内，再回退 sense 间（修复后逻辑）
    let example = "", exampleEn = "";
    const innerEx = inner.match(/<p class="ex">([\s\S]*?)<\/p>/i);
    if (innerEx) {
      exampleEn = innerEx[1].replace(/<span class="zh">[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const iz = innerEx[1].match(/<span class="zh">([\s\S]*?)<\/span>/i);
      example = iz ? cleanHtml(iz[1]) : "";
    } else {
      const nextStart = si + 1 < senseMatches.length ? senseMatches[si + 1].start : definition.length;
      for (const ex of exBlocks) {
        // 真实结构：<p class="ex"> 紧贴归属 sense 的 </div> 之后（ex.start == sense.end），用 >=
        if (ex.start >= sm.end && ex.start < nextStart) { exampleEn = ex.en; example = ex.zh; break; }
      }
    }
    out.push({
      num: numM ? numM[1].trim() : "",
      brief: briefM ? cleanHtml(briefM[1]) : "",
      zh,
      note,
      example,
      exampleEn,
      // 词性回填：class 分区 > 习语/短语区(phr.) > 变形说明型继承原词词性（P1-4）
      pos: (posFor(sm.start) || (isPhrasalAt(sm.start) ? "phr." : (note ? inheritNotePos(note) : ""))) || "",
      label: labelM ? cleanHtml(labelM[1]) : "",
    });
  }
  return out;
}

function normPos(raw) {
  if (!raw) return "";
  let s = raw.trim().toLowerCase();
  if (s.endsWith(".")) s = s.slice(0, -1);
  s = s.replace(/\./g, "");
  const full = { noun: "n", verb: "v", adverb: "adv", adjective: "adj", preposition: "prep", conjunction: "conj", pronoun: "pron", article: "art", numeral: "num", interjection: "int" };
  if (full[s]) s = full[s];
  return s ? s + "." : "";
}

// ---------- 单条 QA ----------
function analyze(word) {
  const result = { word, issues: [], senses: [] };
  let entry = null;
  try { entry = mdx.lookup(word); } catch (e) { result.issues.push("lookup 异常"); return result; }
  let def = entry?.definition ?? "";
  result.defLength = def.length;
  if (!def) { result.issues.push("释义为空"); return result; }

  // 跟随 MDX @@@LINK= 重定向（变形词条 → 原形），带深度保护
  // 注意：@@@LINK 值尾部常带 \r\n\0（NUL 终止符），必须清洗，否则目标查找失败
  if (/^@@@LINK=/m.test(def.trim())) {
    result.isRedirect = true;
    let depth = 0;
    let cur = def;
    while (depth < 5 && /^@@@LINK=/m.test(String(cur).trim())) {
      const t = String(cur).trim().replace(/^@@@LINK=/, "").split(/[\u0000\r\n]/)[0].trim();
      result.redirectTarget = t;
      const r2 = mdx.lookup(t);
      if (!r2) break;
      const rdef = typeof r2.definition === "string"
        ? r2.definition
        : Buffer.isBuffer(r2.definition) ? r2.definition.toString("utf-8") : "";
      if (!rdef) break;
      cur = rdef;
      depth++;
    }
    def = cur;
    result.defLength = def.length;
    if (/^@@@LINK=/m.test(String(def).trim())) result.issues.push("重定向链未解析到最终释义");
  }

  // 结构字段
  result.hasPhonetic = /<pron[^>]*>/i.test(def) || hasExtraPhon(word); // P3：NCECD 无音标时回退 phon_extra
  result.posCount = (def.match(/<span class="class[^"]*"/gi) || []).length;
  result.senseCount = (def.match(/<div class="sense"/gi) || []).length;
  result.zhCount = (def.match(/<span class="zh"/gi) || []).length;
  result.exTotal = (def.match(/<p class="ex"/gi) || []).length;
  // 例句是否嵌在 sense 内（旧模板漏取的关键结构）
  let innerEx = 0;
  const re = /<div class="sense">([\s\S]*?)<\/div>/g;
  let mm;
  while ((mm = re.exec(def))) if (/<p class="ex"/.test(mm[1])) innerEx++;
  result.innerExCount = innerEx;
  result.phraseCount = (def.match(/(maybe_phrase|collocation)/gi) || []).length;
  result.crossRefCount = (def.match(/href="entry:\/\//gi) || []).length;

  // 词条类型分诊（契合度：数据字段 ↔ 解析逻辑对应）
  result.kind = detectKind(def);
  result.kindOk = true;

  // 质量问题
  if (/\uFFFD/.test(def)) result.issues.push("含替换字符(乱码)");
  const cleaned = cleanHtml(def);
  if (/&(amp|nbsp|lt|gt);/.test(cleaned)) result.issues.push("清理后残留 HTML 实体(双重转义)");
  if (/<[a-z]/.test(cleaned)) result.issues.push("清理后仍含标签");
  // 只有 plain 型才可能是"模板不匹配"；词组/互见/标准各有对应解析路径
  if (result.kind === "plain" && result.senseCount === 0 && result.zhCount === 0) {
    result.issues.push("无 sense/zh 结构（plain 型且无字段，需人工确认）");
  }
  if (result.kind === "phrase") {
    // 纯词组词条：验证主词组提取（英文+中文+例句）
    const p = extractPhraseEntry(def);
    result.phraseEntry = p ? { en: p.en, zh: p.zh, hasEx: !!p.exampleEn } : null;
    if (!p) result.issues.push("词组词条主词组提取失败");
    else {
      if (!p.en) result.issues.push("词组英文缺失");
      if (!p.zh) result.issues.push("词组中文缺失");
      if (result.exTotal > 0 && !p.exampleEn) result.issues.push("词组例句未命中");
    }
  } else if (result.kind === "crossref") {
    // 互见词条：验证 = 目标词提取
    const c = extractCrossrefEntry(def);
    result.crossref = c ? { pos: c.pos, target: c.target, zh: c.zh } : null;
    if (!c || !c.target) result.issues.push("互见目标词提取失败");
    // P1：互见跟随补中文校验——无内联中文时应能跟随目标词取到中文；
    // 义项级引用（bay¹,9）与循环互见（alpha wave = alpha rhythm = alpha wave）无中文可取，属数据属性，不误报
    const rr = resolveCrossrefZh(def);
    result.crossrefResolvedZh = rr.zh;
    result.crossrefCyclic = rr.cyclic;
    const targetText = extractCrossrefTargetText(def) || "";
    const itemLevelRef = /[，,]\s*\d+\s*$/.test(targetText);
    if (c && c.target && !c.zh && !rr.zh && !itemLevelRef && !rr.cyclic) {
      result.issues.push("互见词条无中文（目标词跟随失败）");
    }
  }
  if (result.posCount === 0 && result.kind !== "phrase" && result.kind !== "crossref") {
    // 习语/短语区（idiom/phr_s）与变形说明型无词性分区是数据属性，不误报；
    // 仅当结构化抽取后仍有义项缺词性才提示
    const anyMissing = result.senses.some((s) => !s.pos && s.zh);
    if (anyMissing && !/<div class="(?:idiom|phr_s|phr)">/.test(def)) result.issues.push("无词性分区标记");
  }
  if (result.senseCount > 0 && result.exTotal > 0 && result.innerExCount === 0 && (def.match(/<p class="ex"/gi) || []).length === result.innerExCount) {
    // 全为内部例句时旧逻辑会漏——这里仅记录结构事实
  }

  // 结构化抽取（修复后）
  result.senses = extractSenses(def, 4);
  // P1-3 内容可渲染率（按类型分诊）：standard=有义项（含 note 回退）；phrase=主词组提取成功；
  // crossref=目标提取成功；plain=有 zh/sense 字段。词组/互见无 sense 结构不再是"缺口"。
  result.coverage =
    result.kind === "standard" ? result.senses.length > 0
    : result.kind === "phrase" ? !!result.phraseEntry
    : result.kind === "crossref" ? !!result.crossref
    : (result.zhCount > 0 || result.senseCount > 0);

  // 分层（纯单词 / 短语含空格 / 其他），对应读写双场景的验收口径
  result.layer = /^[a-z][a-z-]{1,19}$/i.test(word) ? "word" : /^[a-z].*\s/i.test(word) ? "phrase" : "other";

  // ---- 三项可用率（读写双场景阈值：中文≥92 / 词性≥92 / 短语搭配≥85）----
  const hasClass = result.posCount > 0;
  const phrasalRegion =
    /<div class="(?:idiom|phr_s|phr)">/.test(def) ||
    /<span class="(?:dodo_phrase_sense|phrase_sense)">/.test(def);
  // 中文可用：原始 zh + 互见跟随补回 + note 回退（用户查词时能看到中文即命中）
  result.zhUsable = result.zhCount > 0 || !!result.crossrefResolvedZh || result.senses.some((s) => s.zh);
  // 词性可见：class 分区 + 纯词组词条(phr.) + 互见含词性 + 习语/短语义项区(phr.) + 变形说明型继承
  result.posUsable =
    hasClass || result.kind === "phrase" || (result.kind === "crossref" && hasClass) ||
    phrasalRegion || result.senses.some((s) => s.pos);
  // 短语/搭配可用：词条含搭配/习语区块时，须渲染出「英文 + 中文」才算命中（写作需看到搭配中文与例句）
  const phraseBlocks = (def.match(/<div class="(?:maybe_phrase|collocation)[^"]*">/gi) || []).length;
  result.phraseBlocks = phraseBlocks;
  result.hasPhraseBlocks = phraseBlocks > 0 || phrasalRegion;
  result.phraseUsable = false;
  result.phraseSeeOnly = false; // 纯 See 引用型习语（如 a pig in a poke = See pig）：自身无中文，数据属性
  if (result.hasPhraseBlocks) {
    if (result.kind === "phrase") {
      result.phraseUsable = !!(result.phraseEntry && result.phraseEntry.en && result.phraseEntry.zh);
    } else if (phraseBlocks > 0) {
      // 任一搭配块内（或其紧邻例句）含中文即算可用
      const pbRe = /<div class="(?:maybe_phrase|collocation)[^"]*">([\s\S]*?)<\/div>/gi;
      let pm;
      while ((pm = pbRe.exec(def))) {
        if (/<span class="zh">/.test(pm[1])) { result.phraseUsable = true; break; }
        const tail = def.slice(pm.index + pm[0].length, pm.index + pm[0].length + 800);
        if (/<p class="ex">[\s\S]*?<span class="zh">/.test(tail)) { result.phraseUsable = true; break; }
      }
    } else {
      // 习语/短语义项区（idiom/phr_s）：短语 span 后 260 字符内出现 zh 即可用（to stop the rot 型）
      const psRe = /<span class="(?:dodo_phrase_sense|phrase_sense)">([^<]*)<\/span>/gi;
      let pm;
      while ((pm = psRe.exec(def))) {
        const win = def.slice(pm.index, pm.index + pm[0].length + 260);
        if (/<span class="zh">/.test(win)) { result.phraseUsable = true; break; }
      }
      // 纯 See 引用型（无 zh）：数据属性，不计入分母
      result.phraseSeeOnly = !result.phraseUsable;
    }
  }
  // 可读性抽查：超长释义（UI 阅读美观性的数据侧信号）
  if (result.senses.some((s) => (s.zh || "").length > 150)) result.issues.push("存在超长释义(>150字，检查可读性)");
  const withEx = result.senses.filter((s) => s.exampleEn).length;
  result.sensesWithExample = withEx;
  if (result.senseCount > 0 && withEx === 0 && result.exTotal > 0) result.issues.push("例句存在但未命中到义项（关联窗口问题）");
  if (result.senses.some((s) => !s.zh)) result.issues.push("存在缺中文释义的义项");
  // 序号连续性：NCECD 的序号是「词性内编号」（每词性从 1 重新开始），
  // 必须按词性分组校验；跨词性拉平校验会误报（如 vt.1,2 → vi.1,2,3,4 是数据属性）。
  const posGroups = new Map();
  for (const s of result.senses) {
    if (!s.num) continue;
    const key = s.pos || "";
    if (!posGroups.has(key)) posGroups.set(key, []);
    posGroups.get(key).push(parseInt(s.num, 10));
  }
  for (const nums of posGroups.values()) {
    if (nums.length < 2) continue;
    const sorted = [...nums].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) { result.issues.push("义项序号不连续（同词性内）"); break; }
    }
  }
  return result;
}

// ---------- 词条类型分诊（与 src/dict/dict-renderer.ts 保持一致）----------
function detectKind(def) {
  if (/<div class="sense">/.test(def)) return "standard";
  if (/<div class="(?:maybe_phrase|collocation)[^"]*">/.test(def)) return "phrase";
  if (/<div class="also">/.test(def)) return "crossref";
  if (/=\s*<a\s+href="entry:\/\/[^"]*">/i.test(def)) return "crossref";
  return "plain";
}

// ---------- 纯词组词条主条目提取 ----------
function extractPhraseEntry(def) {
  const m = /<div class="(maybe_phrase|collocation)[^"]*">([\s\S]*?)<\/div>/.exec(def);
  if (!m) return null;
  const inner = m[2];
  const pre = inner.replace(/<span class="or">([\s\S]*?)<\/span>/gi, " $1 ");
  const ph = pre.match(/<span class="(?:phrase_with_or|mphr_en to|mphr_en|phrase_sense)">([\s\S]*?)<\/span>/i);
  const en = ph ? cleanHtml(ph[1].replace(/<[^>]+>/g, "")) : cleanHtml(pre.replace(/<span class="zh">[\s\S]*?<\/span>/g, ""));
  const zhm = inner.match(/<span class="zh">([\s\S]*?)<\/span>/i);
  const after = def.slice(m.index + m[0].length, m.index + m[0].length + 1200);
  const exm = after.match(/<p class="ex">([\s\S]*?)<\/p>/i);
  let exampleEn = "", example = "";
  if (exm) {
    exampleEn = exm[1].replace(/<span class="zh">[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const ez = exm[1].match(/<span class="zh">([\s\S]*?)<\/span>/i);
    example = ez ? cleanHtml(ez[1]) : "";
  }
  if (!en) return null;
  return { en, zh: zhm ? cleanHtml(zhm[1]) : "", exampleEn, example };
}

// ---------- 互见词条目标提取 ----------
function extractCrossrefEntry(def) {
  const posM = def.match(/<span class="class[^"]*">([^<]*)<\/span>/);
  const alsoM = def.match(/<div class="also">([\s\S]*?)<\/div>/);
  const inlineM = !alsoM ? def.match(/=\s*<a\s+href="entry:\/\/[^"]*">([\s\S]*?)<\/a>/i) : null;
  if (!alsoM && !inlineM) return null;
  const inner = alsoM ? alsoM[1] : "";
  const linkM = alsoM ? inner.match(/<a\s+href="entry:\/\/[^"]*">([\s\S]*?)<\/a>/) : null;
  const zhM = alsoM ? inner.match(/<span class="zh">([\s\S]*?)<\/span>/i) : null;
  const target = alsoM
    ? (linkM ? cleanHtml(linkM[1]) : cleanHtml(inner.replace(/<span class="zh">[\s\S]*?<\/span>/g, "")))
    : (inlineM ? cleanHtml(inlineM[1]) : "");
  if (!target) return null;
  return { pos: posM ? normPos(posM[1]) : "", target, zh: zhM ? cleanHtml(zhM[1]) : "" };
}

// ---------- 互见跟随补中文（镜像 dict-engine.followCrossrefZh，供 QA 校验）----------
// 目标词原文（含可能的义项级引用 `,数字`，用于判定是否该跟随）
function extractCrossrefTargetText(def) {
  if (!def) return null;
  let raw = null;
  const alsoM = /<div class="also">([\s\S]*?)<\/div>/.exec(def);
  if (alsoM) {
    const inner = alsoM[1];
    const linkM = inner.match(/<a\s+href="entry:\/\/[^"]*">([\s\S]*?)<\/a>/);
    raw = linkM ? linkM[1] : inner.replace(/<span class="zh">[\s\S]*?<\/span>/g, "");
  } else {
    const inlineM = def.match(/=\s*<a\s+href="entry:\/\/[^"]*">([\s\S]*?)<\/a>/i);
    if (inlineM) raw = inlineM[1];
  }
  if (!raw) return null;
  const t = cleanHtml(raw);
  return t || null;
}
// 可跟随目标词：义项级引用（bay¹,9）不跟随（避免误导）；同形词上标（tacky²）剥离后跟随
function extractCrossrefTargetRaw(def) {
  const t = extractCrossrefTargetText(def);
  if (!t) return null;
  if (/[，,]\s*\d+\s*$/.test(t)) return null;
  const clean = t.replace(/[，,]\s*\d+.*$/g, "").replace(/[\u00B9\u00B2\u00B3\u2070-\u209F]+$/g, "").trim();
  return clean || null;
}
// 互见目标查词（镜像 dict-engine.lookupCrossrefTarget）：精确查 + 姓氏简写兜底
// 注意：mdx.lookup 可能返回 definition=null 的空对象（如 "Vignola" 只有带全名的人名词头），
// 必须判 definition 非空，否则会绕过姓氏兜底逻辑。
function lookupTargetQA(target) {
  try {
    const direct = mdx.lookup(target);
    if (direct && direct.definition != null) return direct;
    // 姓氏简写：Vignola → "Vignola, Giacomo Barozzi da"
    const want = target.toLowerCase() + ",";
    const block = mdx.associate(target) || [];
    for (const item of block) {
      const kt = item?.keyText ?? String(item);
      if (kt.toLowerCase().startsWith(want)) {
        const r = mdx.lookup(kt);
        if (r && r.definition != null) return r;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveCrossrefZh(def, depth = 0, seen = new Set()) {
  if (depth > 2) return { zh: "", cyclic: false };
  const target = extractCrossrefTargetRaw(def);
  if (!target) return { zh: "", cyclic: false };
  const key = target.toLowerCase();
  if (seen.has(key)) return { zh: "", cyclic: true };
  seen.add(key);
  try {
    const r = lookupTargetQA(target);
    if (!r) return { zh: "", cyclic: false };
    let tdef = typeof r.definition === "string" ? r.definition : Buffer.isBuffer(r.definition) ? r.definition.toString("utf-8") : "";
    let guard = 0;
    while (guard < 5 && /^@@@LINK=/m.test(tdef.trim())) {
      const t = tdef.trim().replace(/^@@@LINK=/, "").split(/[\u0000\r\n]/)[0].trim();
      const r2 = mdx.lookup(t);
      if (!r2) break;
      tdef = typeof r2.definition === "string" ? r2.definition : Buffer.isBuffer(r2.definition) ? r2.definition.toString("utf-8") : "";
      guard++;
    }
    const zhm = tdef.match(/<span class="zh">([\s\S]*?)<\/span>/i);
    if (zhm) return { zh: cleanHtml(zhm[1]), cyclic: false };
    if (extractCrossrefTargetRaw(tdef)) return resolveCrossrefZh(tdef, depth + 1, seen);
    return { zh: "", cyclic: false };
  } catch {
    return { zh: "", cyclic: false };
  }
}

// ---------- 变形说明型词性继承（镜像 dict-renderer.inheritNotePos）----------
const notePosCache = new Map();
function lookupWordMeta(word) {
  try {
    const e = mdx.lookup(word);
    if (!e) return null;
    let def = typeof e.definition === "string" ? e.definition : Buffer.isBuffer(e.definition) ? e.definition.toString("utf-8") : "";
    let guard = 0;
    while (guard < 5 && /^@@@LINK=/m.test(def.trim())) {
      const t = def.trim().replace(/^@@@LINK=/, "").split(/[\u0000\r\n]/)[0].trim();
      const r2 = mdx.lookup(t);
      if (!r2) break;
      def = typeof r2.definition === "string" ? r2.definition : Buffer.isBuffer(r2.definition) ? r2.definition.toString("utf-8") : "";
      guard++;
    }
    const posM = def.match(/<span class="class[^"]*">([^<]*)<\/span>/);
    const zhM = def.match(/<span class="zh">([\s\S]*?)<\/span>/i);
    return { pos: posM ? posM[1].trim() : "", zh: zhM ? cleanHtml(zhM[1]) : "" };
  } catch {
    return null;
  }
}
function inheritNotePos(note) {
  if (!note) return "";
  const m = note.match(/([A-Za-z][A-Za-z'-]{1,39})\s*的(?:过去式|过去分词|现在分词|第三人称单数|复数|比较级|最高级)/);
  if (!m) return "";
  const target = m[1].toLowerCase();
  if (notePosCache.has(target)) return notePosCache.get(target) || "";
  let pos = "";
  try {
    const meta = lookupWordMeta(target);
    if (meta && meta.pos) pos = normPos(meta.pos);
  } catch {
    /* ignore */
  }
  notePosCache.set(target, pos);
  return pos;
}

// ---------- 抽样 ----------
const rng = mulberry32(SEED_BASE + ROUND * 100003);
const sample = [];
const used = new Set();
let guard = 0;
while (sample.length < COUNT && guard < 200000) {
  guard++;
  const idx = Math.floor(rng() * keywordList.length);
  if (used.has(idx)) continue;
  used.add(idx);
  sample.push(keywordList[idx]);
}
console.log(`第 ${ROUND} 轮：抽取 ${sample.length} 词对`);

// ---------- 执行分析 ----------
const report = sample.map(analyze);

// ---------- 汇总 ----------
const agg = {
  round: ROUND, seed: SEED_BASE + ROUND * 100003, count: report.length,
  hasPhonetic: report.filter((r) => r.hasPhonetic).length,
  hasPos: report.filter((r) => r.posCount > 0).length,
  hasSense: report.filter((r) => r.senseCount > 0).length,
  hasZh: report.filter((r) => r.zhCount > 0).length,
  hasEx: report.filter((r) => r.exTotal > 0).length,
  exInsideSense: report.filter((r) => r.innerExCount > 0).length,
  senseHitExample: report.filter((r) => r.sensesWithExample > 0).length,
  hasPhrase: report.filter((r) => r.phraseCount > 0).length,
  hasCrossRef: report.filter((r) => r.crossRefCount > 0).length,
  withIssues: report.filter((r) => r.issues.length > 0).length,
  issueKinds: {},
  // 词条类型分布（契合度分诊）
  kindDist: {},
  phraseEntryOk: 0,
  phraseEntryWithEx: 0,
  crossrefOk: 0,
  noteFallback: 0,
  // P1-3 双口径：分诊口径「内容可渲染率」 vs 原始口径「含 sense 结构」
  coverage: report.filter((r) => r.coverage).length,
  rawSenseRate: report.filter((r) => r.senseCount > 0).length,
  // P1：互见词条有中文（内联 zh 或跟随目标词补回）；无中文者为义项级/循环引用（数据属性）
  crossrefWithZh: report.filter((r) => r.kind === "crossref" && (r.crossref?.zh || r.crossrefResolvedZh)).length,
  crossrefSkipped: report.filter((r) => r.kind === "crossref" && !(r.crossref?.zh || r.crossrefResolvedZh)).length,
  // 三项可用率（读写双场景阈值：中文≥92 / 词性≥92 / 短语搭配≥85）
  zhUsable: report.filter((r) => r.zhUsable).length,
  posUsable: report.filter((r) => r.posUsable).length,
  phraseBlocks: report.filter((r) => r.hasPhraseBlocks).length,
  phraseUsable: report.filter((r) => r.phraseUsable).length,
  phraseSeeOnly: report.filter((r) => r.phraseSeeOnly).length,
  // 分层可用率（纯单词/短语/其他）
  layerDist: {},
  layerZh: {},
  layerPos: {},
  avgSenses: report.length ? (report.reduce((a, r) => a + r.senseCount, 0) / report.length).toFixed(2) : 0,
  avgDefLen: report.length ? Math.round(report.reduce((a, r) => a + (r.defLength || 0), 0) / report.length) : 0,
};
for (const r of report) {
  for (const i of r.issues) agg.issueKinds[i] = (agg.issueKinds[i] || 0) + 1;
  agg.kindDist[r.kind] = (agg.kindDist[r.kind] || 0) + 1;
  agg.layerDist[r.layer] = (agg.layerDist[r.layer] || 0) + 1;
  if (r.zhUsable) agg.layerZh[r.layer] = (agg.layerZh[r.layer] || 0) + 1;
  if (r.posUsable) agg.layerPos[r.layer] = (agg.layerPos[r.layer] || 0) + 1;
  if (r.kind === "phrase") {
    if (r.phraseEntry) { agg.phraseEntryOk++; if (r.phraseEntry.hasEx) agg.phraseEntryWithEx++; }
  }
  if (r.kind === "crossref" && r.crossref?.target) agg.crossrefOk++;
  if (r.senses.some((s) => s.note)) agg.noteFallback++;
}

// ---------- 写文件 ----------
const outDir = path.join(PLUGIN_ROOT, "qa-reports");
fs.mkdirSync(outDir, { recursive: true });
const base = `dict_qa_round${ROUND}`;

fs.writeFileSync(path.join(outDir, `${base}_report.json`), JSON.stringify({ agg, report }, null, 2), "utf-8");

// Markdown 报告
const md = [];
md.push(`# NCECD 词典第 ${ROUND} 轮 QA 报告（${COUNT} 词对）`);
md.push("");
md.push(`- 种子: ${agg.seed}（可复现）｜词表总数: ${keywordList.length}`);
md.push("");
md.push("## 命中率统计");
md.push("");
md.push(`| 指标 | 命中/样本 | 比例 |`);
md.push(`| --- | --- | --- |`);
const pct = (n) => (agg.count ? ((n / agg.count) * 100).toFixed(1) + "%" : "0%");
md.push(`| 含音标 <pron> | ${agg.hasPhonetic}/${agg.count} | ${pct(agg.hasPhonetic)} |`);
md.push(`| 含词性分区 class | ${agg.hasPos}/${agg.count} | ${pct(agg.hasPos)} |`);
md.push(`| 含义项 sense | ${agg.hasSense}/${agg.count} | ${pct(agg.hasSense)} |`);
md.push(`| 含中文释义 zh | ${agg.hasZh}/${agg.count} | ${pct(agg.hasZh)} |`);
md.push(`| 含例句 ex | ${agg.hasEx}/${agg.count} | ${pct(agg.hasEx)} |`);
md.push(`| 例句嵌于 sense 内 | ${agg.exInsideSense}/${agg.count} | ${pct(agg.exInsideSense)} |`);
md.push(`| 义项命中例句(修复后) | ${agg.senseHitExample}/${agg.count} | ${pct(agg.senseHitExample)} |`);
md.push(`| 含词组/搭配 | ${agg.hasPhrase}/${agg.count} | ${pct(agg.hasPhrase)} |`);
md.push(`| 含交叉引用 | ${agg.hasCrossRef}/${agg.count} | ${pct(agg.hasCrossRef)} |`);
md.push(`| 内容可渲染率（分诊口径） | ${agg.coverage}/${agg.count} | ${pct(agg.coverage)} |`);
md.push(`| 义项原始口径（含 sense 结构） | ${agg.rawSenseRate}/${agg.count} | ${pct(agg.rawSenseRate)} |`);
md.push(`| 互见词条有中文（内联/跟随） | ${agg.crossrefWithZh}/${agg.kindDist.crossref || 0} | — |`);
md.push(`| 互见词条无中文（义项级/循环引用·数据属性） | ${agg.crossrefSkipped} | — |`);
md.push("");
md.push("### 三项可用率验收（读写双场景阈值：中文≥92 / 词性≥92 / 短语搭配≥85）");
md.push("");
const pctD = (n, d) => (d ? ((n / d) * 100).toFixed(1) + "%" : "0%");
const flag = (n, d, t) => (d && (n / d) * 100 >= t ? "✅ 达标" : "❌ 未达");
md.push("| 指标 | 命中/样本 | 比例 | 阈值 | 判定 |");
md.push("| --- | --- | --- | --- | --- |");
md.push(`| 中文可用率（zh原始+互见跟随+note回退） | ${agg.zhUsable}/${agg.count} | ${pctD(agg.zhUsable, agg.count)} | ≥92% | ${flag(agg.zhUsable, agg.count, 92)} |`);
md.push(`| 词性可见率（class+phr.+互见+变形继承） | ${agg.posUsable}/${agg.count} | ${pctD(agg.posUsable, agg.count)} | ≥92% | ${flag(agg.posUsable, agg.count, 92)} |`);
const phraseDenom = agg.phraseBlocks - agg.phraseSeeOnly;
md.push(`| 短语/搭配可用率（含搭配区块中完整渲染） | ${agg.phraseUsable}/${phraseDenom}（跳过 See 引用型 ${agg.phraseSeeOnly}） | ${pctD(agg.phraseUsable, phraseDenom)} | ≥85% | ${flag(agg.phraseUsable, phraseDenom, 85)} |`);
md.push("");
md.push("### 分层可用率（纯单词/短语/其他）");
md.push("");
md.push("| 分层 | 样本 | 中文可用 | 词性可见 |");
md.push("| --- | --- | --- | --- |");
for (const k of ["word", "phrase", "other"]) {
  const n = agg.layerDist[k] || 0;
  md.push(`| ${k} | ${n} | ${pctD(agg.layerZh[k] || 0, n)} | ${pctD(agg.layerPos[k] || 0, n)} |`);
}
md.push("");
md.push("## 词条类型分布（契合度分诊）");
md.push("");
md.push(`| 类型 | 数量 | 占比 |`);
md.push(`| --- | --- | --- |`);
for (const k of ["standard", "phrase", "crossref", "plain"]) {
  const v = agg.kindDist[k] || 0;
  md.push(`| ${k} | ${v}/${agg.count} | ${pct(v)} |`);
}
if (agg.kindDist.phrase) {
  md.push("");
  md.push(`词组词条主条目提取成功: ${agg.phraseEntryOk}/${agg.kindDist.phrase || 0}（含例句 ${agg.phraseEntryWithEx}）`);
}
if (agg.kindDist.crossref) {
  md.push(`互见词条目标提取成功: ${agg.crossrefOk}/${agg.kindDist.crossref || 0}`);
}
md.push(`语法说明型义项 note 回退: ${agg.noteFallback}`);
md.push("");
md.push(`平均义项数: ${agg.avgSenses}｜平均释义长度: ${agg.avgDefLen} 字符`);
md.push("");
md.push("## 问题分布");
md.push("");
const kinds = Object.entries(agg.issueKinds).sort((a, b) => b[1] - a[1]);
if (kinds.length === 0) md.push("（无）");
else for (const [k, v] of kinds) md.push(`- ${k}: ${v}`);
md.push("");
md.push("## 抽样明细（前 60 条）");
md.push("");
md.push("| 单词 | 类型 | 音标 | 词性 | 义项 | 例句 | 词组 | 引用 | 问题 |");
md.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of report.slice(0, 60)) {
  md.push(`| ${r.word} | ${r.kind} | ${r.hasPhonetic ? "✓" : "✗"} | ${r.posCount} | ${r.senseCount} | ${r.exTotal} | ${r.phraseCount} | ${r.crossRefCount} | ${r.issues.join("; ") || "—"} |`);
}
md.push("");
md.push("## 典型义项抽取样例（修复后，前 10 条有义项的词）");
md.push("");
for (const r of report.filter((x) => x.senses.length).slice(0, 10)) {
  md.push(`### ${r.word}`);
  for (const s of r.senses) {
    md.push(`- ${s.num || "·"} [${s.pos || "?"}] ${s.brief ? "(" + s.brief + ") " : ""}${s.zh}${s.note ? "（note: " + s.note + "）" : ""}`);
    if (s.exampleEn) md.push(`  - 例: ${s.exampleEn}${s.example ? " / " + s.example : ""}`);
  }
}
md.push("");
md.push("## 词组/互见词条样例（前 10 条）");
md.push("");
const special = report.filter((r) => r.kind === "phrase" || r.kind === "crossref").slice(0, 10);
if (special.length === 0) md.push("（本轮无）");
for (const r of special) {
  if (r.kind === "phrase" && r.phraseEntry) {
    md.push(`### ${r.word}（词组）`);
    md.push(`- ${r.phraseEntry.en} / ${r.phraseEntry.zh || "—"}${r.phraseEntry.hasEx ? ` / 例: ${r.phraseEntry.exampleEn}` : ""}`);
  } else if (r.kind === "crossref" && r.crossref) {
    const zhShow = r.crossref.zh || r.crossrefResolvedZh || "";
    md.push(`### ${r.word}（互见）`);
    md.push(`- [${r.crossref.pos || "?"}] = ${r.crossref.target}${zhShow ? " / " + zhShow : ""}${r.crossrefResolvedZh && !r.crossref.zh ? "（跟随补回）" : ""}`);
  }
}
fs.writeFileSync(path.join(outDir, `${base}_report.md`), md.join("\n"), "utf-8");

// HTML 预览（前 30 词，内联样式镜像插件 sense 卡片 + 顶部三项指标验收横幅）
const PREVIEW_N = 30;
const css = `
body{font-family:-apple-system,"PingFang SC",sans-serif;background:#f4f6f8;padding:24px;color:#1f2328}
.summary{background:#fff;border:1px solid #e4e7eb;border-radius:10px;padding:14px 16px;margin-bottom:18px;display:flex;gap:26px;flex-wrap:wrap}
.sum-item{display:flex;flex-direction:column;gap:3px}.sum-label{font-size:12px;color:#888}.sum-val{font-size:17px;font-weight:600}
.pass{color:#1d9e75}.fail{color:#e24b4a}
.card{background:#fff;border:1px solid #e4e7eb;border-radius:8px;padding:12px 14px;margin:0 0 12px;box-shadow:0 1px 4px rgba(0,0,0,.05)}
.head{font-weight:700;font-size:18px}.phon{font-family:monospace;color:#357abd;font-size:13px;margin-left:8px}
.senses{display:flex;flex-direction:column;gap:8px;margin-top:8px;list-style:none;padding:0}
.item{display:flex;gap:10px;padding:6px 0;background:transparent;border:none;border-bottom:1px dashed #e4e7eb}
.item:last-child{border-bottom:none}
.pos{flex:0 0 auto;min-width:30px;height:20px;padding:0 7px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#357abd;background:rgba(53,122,189,.12);border-radius:5px;margin-top:2px}
.num{flex:0 0 auto;min-width:28px;font-size:13px;font-weight:700;color:#999;margin-top:2px}
.item[data-pos="n."] .pos{color:#357abd;background:rgba(53,122,189,.12)}.item[data-pos="v."] .pos,.item[data-pos="vt."] .pos,.item[data-pos="vi."] .pos{color:#3a9a5f;background:rgba(58,154,95,.12)}
.item[data-pos="adj."] .pos{color:#e08a2e;background:rgba(224,138,46,.12)}.item[data-pos="adv."] .pos{color:#8b5cf6;background:rgba(139,92,246,.12)}.item[data-pos="prep."] .pos,.item[data-pos="conj."] .pos,.item[data-pos="phr."] .pos{color:#2f9e8f;background:rgba(47,158,143,.12)}
.body{flex:1}.main{display:flex;flex-wrap:wrap;gap:4px;align-items:baseline}
.brief{font-style:italic;color:#6b7280;font-size:12.5px}.zh{font-size:16px;font-weight:600}
.ex{margin:4px 0 0;padding:6px 10px;border-left:3px solid #4f6ef7;border-radius:0 6px 6px 0;background:rgba(79,110,247,.05);color:#666;font-size:13px;font-style:italic}
.ex-zh{color:#999;font-size:12.5px;font-style:normal}
.issue{color:#e0524f;font-size:12px;margin-top:4px}
`;
const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pctPV = (n, d) => (d ? ((n / d) * 100).toFixed(1) + "%" : "—");
const flagTxt = (n, d, t) => (d && (n / d) * 100 >= t ? '<span class="pass">✅ 达标</span>' : '<span class="fail">❌ 未达</span>');
const phraseDenomPV = agg.phraseBlocks - agg.phraseSeeOnly;
const html = [`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>NCECD 第 ${ROUND} 轮预览</title><style>${css}</style></head><body>`];
html.push(`<h2>NCECD 第 ${ROUND} 轮 · 前 ${Math.min(PREVIEW_N, report.length)} 词渲染预览（简洁醒目 · 三项指标验收）</h2>`);
html.push(`<div class="summary">
  <div class="sum-item"><span class="sum-label">中文可用率 ≥92%</span><span class="sum-val">${pctPV(agg.zhUsable, agg.count)} ${flagTxt(agg.zhUsable, agg.count, 92)}</span></div>
  <div class="sum-item"><span class="sum-label">词性可见率 ≥92%</span><span class="sum-val">${pctPV(agg.posUsable, agg.count)} ${flagTxt(agg.posUsable, agg.count, 92)}</span></div>
  <div class="sum-item"><span class="sum-label">短语/搭配可用率 ≥85%</span><span class="sum-val">${pctPV(agg.phraseUsable, phraseDenomPV)} ${flagTxt(agg.phraseUsable, phraseDenomPV, 85)}</span></div>
  <div class="sum-item"><span class="sum-label">问题数</span><span class="sum-val">${agg.withIssues}</span></div>
</div>`);
for (const r of report.slice(0, PREVIEW_N)) {
  html.push(`<div class="card"><div class="head">${esc(r.word)}${r.hasPhonetic ? '<span class="phon">/…/</span>' : ""}</div>`);
  html.push('<div class="senses">');
  for (const s of r.senses.slice(0, 6)) {
    html.push(`<div class="item" data-pos="${esc(s.pos)}">${s.pos ? `<span class="pos">${esc(s.pos)}</span>` : ""}${s.num ? `<span class="num">${esc(s.num)}</span>` : ""}<div class="body"><div class="main">${s.brief ? `<span class="brief">${esc(s.brief)}</span>` : ""}<span class="zh">${esc(s.zh)}</span></div>${s.exampleEn ? `<div class="ex">${esc(s.exampleEn)}${s.example ? `<span class="ex-zh"> — ${esc(s.example)}</span>` : ""}</div>` : ""}</div></div>`);
  }
  html.push("</div>");
  if (r.issues.length) html.push(`<div class="issue">⚠ ${esc(r.issues.join("；"))}</div>`);
  html.push("</div>");
}
html.push("</body></html>");
fs.writeFileSync(path.join(outDir, `${base}_preview.html`), html.join("\n"), "utf-8");

console.log(`\n第 ${ROUND} 轮完成：${report.length} 词对，有问题 ${agg.withIssues} 条`);
console.log("输出目录:", outDir);
console.log("  - " + base + "_report.json");
console.log("  - " + base + "_report.md");
console.log("  - " + base + "_preview.html");
