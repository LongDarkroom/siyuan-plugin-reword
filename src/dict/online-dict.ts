/**
 * 在线完整词典兜底（P4 · 2026-08-15 新增，2026-09-07 切换至海词）
 * ------------------------------------------------------------------
 * 与 online-phonetic.ts 的「在线音标兜底」互补：离线 NCECD/ECD2 词典
 * 查不到词条时，抓取海词词典网页版作为兜底，
 * 让生僻词/新词/专有名词也能有可读的在线释义。
 *
 * 2026-09-07 数据源从欧路（dict.eudic.net）切换至海词（corp.dict.cn）：
 *   - 稳定运营 23 年（2003-2026）
 *   - 公网直访无需鉴权，CORS 走思源 forwardProxy 绕开
 *
 * 2026-09-07 全信息版（demo v3 定稿）：解析 12 类字段——
 *   基础：音标 / 简释词性 / 词形变化 / 近反义词
 *   全信息：详尽释义 / 双解释义 / 英英释义 / 例句 / 常用短语 / 词汇搭配 / 经典引文 / 临近单词
 *   渲染为「三组手风琴 + 组内页签」，词形并入卡片顶部简释义组。
 *
 * 页面结构（2026-09-07 实测 borrow）：
 *   - 音标：<span>英 <bdo lang="EN-US">['bɒrəʊ]</bdo></span> / <span>美 <bdo lang="EN-US">['bɑːroʊ]</bdo></span>
 *   - 简释：<ul class="dict-basic-ul"><li><span>v.</span><strong>借；借鉴；抄袭</strong></li></ul>
 *   - 词形：<div class="shape"><label>过去式:</label> <a>borrowed</a>...</div>
 *   - 近反义词：<h3>近反义词</h3><div class="layout nfo">...<div>【近义词】</div><ul>...</ul><div>【反义词】</div><ul>...</ul></div>
 *
 * 设计（与 online-phonetic 同款）：
 *  - 内存 Map 缓存（2.4：含正/负 TTL，负缓存 30s 后可重试，避免一次网络抖动锁死整次会话）
 *  - 并发去重 + MAX_CONCURRENT=3 限流
 *  - 所有网络失败静默降级返回 null（调用方决定是否 toast 提示）
 *  - 结构化调试日志（请求 URL/状态/耗时/解析结果）
 *
 * Node 可测：parseHaiciLiteHtml 为纯函数；网络层注入 transport 隔离。
 */

import { defaultTransport, type PhoneticTransport } from "./online-phonetic.ts";

/** 在线词典结果 */
export interface OnlineDictResult {
  word: string;
  /** 音标，如「英 /'bɒrəʊ/ 美 /'bɑːroʊ/」 */
  phonetic: string;
  /** 释义列表（词性 + 中文），即"单词释义 + 词性"两个用户字段的统一表示 */
  meanings: { pos: string; zh: string }[];
  /** 词形变化（如"过去式: borrowed / 现在分词: borrowing"），可能为空数组 */
  inflections: { label: string; form: string }[];
  /** 近义词（{词, 中文}，chips 可点击递归查词），可能为空数组 */
  synonyms: { w: string; zh?: string }[];
  /** 反义词，可能为空数组 */
  antonyms: { w: string; zh?: string }[];
  /** 数据来源标记（2026-09-07 切换至 haici；保留 "eudic" 类型以兼容历史代码） */
  source: "haici" | "eudic";
  // ---- 2026-09-07 全信息扩展（demo v3 定稿：三组页签 + 词形并入简释义组）----
  /** 详尽释义：词性组 + 释义列表 */
  detailMeanings: { pos: string; defs: string[] }[];
  /** 双解释义：词性组 + 中英对照 */
  dualMeanings: { pos: string; items: { zh: string; en: string }[] }[];
  /** 英英释义：词性组 + 定义（可带例句） */
  enMeanings: { pos: string; defs: { en: string; ex: string }[] }[];
  /** 例句：词性组 + 英中例句 */
  examples: { pos: string; items: { en: string; zh: string }[] }[];
  /** 常用短语：短语名 + 释义（dd 取首个 <br> 前的第一行，避免例句撑爆卡片） */
  phrases: { name: string; def: string }[];
  /** 词汇搭配：搭配模式组（如「～+名词」）+ {搭配, 中文} */
  collocations: { group: string; items: { w: string; zh: string }[] }[];
  /** 经典引文：引文 + 出处 */
  quotes: { text: string; src: string }[];
  /** 临近单词（chips，可点击递归查词） */
  nearWords: string[];
}

/** 海词词典页面 URL（2026-09-07 切换） */
function eudicUrl(word: string): string {
  return `https://corp.dict.cn/search?q=${encodeURIComponent(word)}`;
}

/** 去掉 HTML 标签 + 折叠空白 + 反转义常见实体 */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 按 <h3>标题</h3> 截取区块：从该标题到下一个 <h3>（或文末）。
 * 海词 lite 页每个信息区块都以独立 <h3>小标题</h3> 开始，顺序稳定（2026-09-07 实测）。
 * 用「下一个 h3」做边界而非匹配闭合 div —— 区块内部有嵌套 div（dict-chart 等），非贪婪 </div> 会截断。
 */
function sectionByTitle(html: string, title: string): string {
  const marker = `<h3>${title}</h3>`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const next = html.indexOf("<h3>", start + marker.length);
  return html.substring(start, next >= 0 ? next : html.length);
}

/** 保护中文语域标记：海词 HTML 里有未转义的 <婉>/<古> 等，会被 stripTags 当标签吞掉 */
function protectCnTags(s: string): string {
  return s.replace(/<([婉古口书谑俚喻谦废])>/g, "&lt;$1&gt;");
}

/** 「词性 span + <ol> 列表」通用提取（详尽释义/双解释义/英英释义共用结构） */
function posGroups(seg: string): { pos: string; ol: string }[] {
  const out: { pos: string; ol: string }[] = [];
  const re = /<span>\s*([^<]+?)\s*(?:<bdo[^>]*>\s*\(([^)<]+)\)\s*<\/bdo>)?\s*<\/span>\s*<ol[^>]*>([\s\S]*?)<\/ol>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg))) {
    const pos = (m[1] + (m[2] ? ` (${m[2]})` : "")).trim();
    if (pos && m[3]) out.push({ pos, ol: m[3] });
  }
  return out;
}

/** <ol> 内 li 文本列表（保护中文语域标记后 strip） */
function olItems(olHtml: string): string[] {
  const out: string[] = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(olHtml))) {
    const t = stripTags(protectCnTags(m[1])).trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * 解析海词词典网页 HTML，提取全信息字段（2026-09-07 全信息版）：
 *   基础 4 字段：音标 + 简释/词性 + 词形变化 + 近反义词
 *   全信息 8 区块：详尽释义 / 双解释义 / 英英释义 / 例句 / 常用短语 /
 *                词汇搭配 / 经典引文 / 临近单词
 * 纯函数，可测。
 *
 * @returns OnlineDictResult；所有字段全空时返回 null
 */
export function parseHaiciLiteHtml(html: string, word: string): OnlineDictResult | null {
  if (!html) return null;
  const w = (word || "").trim();
  if (!w) return null;

  // 1) 音标：<span>英 <bdo lang="EN-US">['bɒrəʊ]</bdo></span> / <span>美 <bdo lang="EN-US">['bɑːroʊ]</bdo></span>
  // 词海格式：方括号 + 单引号 + IPA（IPA 内部可能含撇号 hə'ləʊ）+ 闭合方括号
  // 关键：捕获组用 [^\]]+ 允许内部撇号，否则 hə'ləʊ 会被截断成 "hə"
  let uk = "";
  let us = "";
  const phonRe = /<span>\s*([英美])\s*<bdo[^>]*>\['([^\]]+)[']?\]<\/bdo>/g;
  let m: RegExpExecArray | null;
  while ((m = phonRe.exec(html))) {
    const ph = m[2].trim();
    if (!ph) continue;
    if (m[1] === "英" && !uk) uk = ph;
    else if (m[1] === "美" && !us) us = ph;
  }
  const phonetic = [uk ? `英 /${uk}/` : "", us ? `美 /${us}/` : ""].filter(Boolean).join(" ");

  // 2) 简释 + 词性：<ul class="dict-basic-ul"><li><span>v.</span><strong>借；借鉴；抄袭</strong></li>...
  const meanings: { pos: string; zh: string }[] = [];
  const basicUl = html.match(/<ul class="dict-basic-ul">([\s\S]*?)<\/ul>/);
  if (basicUl) {
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    while ((m = liRe.exec(basicUl[1]))) {
      const liHtml = m[1];
      // 词性：<span>v.</span>
      const posMatch = liHtml.match(/<span[^>]*>([^<]+)<\/span>/);
      const pos = posMatch ? posMatch[1].trim() : "";
      // 中文：<strong>借；借鉴；抄袭</strong>（fallback 整段 li 文本）
      const zhMatch = liHtml.match(/<strong[^>]*>([\s\S]*?)<\/strong>/);
      const zh = zhMatch ? stripTags(zhMatch[1]).trim() : stripTags(liHtml).trim();
      if (zh) meanings.push({ pos, zh });
    }
  }

  // 3) 词形变化：<div class="shape"><label>过去式:</label> <a>borrowed</a>...</div>
  // 形如 <label>XXX:</label> <a>YYY</a> 配对提取
  const inflections: { label: string; form: string }[] = [];
  const shapeMatch = html.match(/<div class="shape">([\s\S]*?)<\/div>/);
  if (shapeMatch) {
    const lr = /<label[^>]*>([^<]+)<\/label>\s*<a[^>]*>([^<]+)<\/a>/g;
    while ((m = lr.exec(shapeMatch[1]))) {
      const label = m[1].trim().replace(/[:：]\s*$/, ""); // 去尾冒号
      const form = m[2].trim();
      if (label && form) inflections.push({ label, form });
    }
  }

  // 4) 详尽释义：<h3>详尽释义</h3><div class="layout detail"><span>v. <bdo>(动词)</bdo></span><ol><li>..</li></ol>...
  const detailMeanings: { pos: string; defs: string[] }[] = [];
  for (const g of posGroups(sectionByTitle(html, "详尽释义"))) {
    const defs = olItems(g.ol);
    if (defs.length) detailMeanings.push({ pos: g.pos, defs });
  }

  // 5) 双解释义：li 内 <strong>中文</strong> 英文
  const dualMeanings: { pos: string; items: { zh: string; en: string }[] }[] = [];
  for (const g of posGroups(sectionByTitle(html, "双解释义"))) {
    const items: { zh: string; en: string }[] = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let m2: RegExpExecArray | null;
    while ((m2 = liRe.exec(g.ol))) {
      const zhM = m2[1].match(/<strong[^>]*>([\s\S]*?)<\/strong>/);
      const zh = zhM ? stripTags(zhM[1]).trim() : "";
      const en = stripTags(m2[1].replace(/<strong[^>]*>[\s\S]*?<\/strong>/, "")).trim();
      if (zh || en) items.push({ zh, en });
    }
    if (items.length) dualMeanings.push({ pos: g.pos, items });
  }

  // 6) 英英释义：<span>Verb:</span><ol><li>get temporarily; <p>"May I borrow..."</p></li>...
  const enMeanings: { pos: string; defs: { en: string; ex: string }[] }[] = [];
  for (const g of posGroups(sectionByTitle(html, "英英释义"))) {
    const defs: { en: string; ex: string }[] = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let m2: RegExpExecArray | null;
    while ((m2 = liRe.exec(g.ol))) {
      const exM = m2[1].match(/<p>([\s\S]*?)<\/p>/);
      const ex = exM ? stripTags(exM[1]).trim() : "";
      const en = stripTags(m2[1].replace(/<p>[\s\S]*?<\/p>/g, "")).replace(/[;；]\s*$/, "").trim();
      if (en || ex) defs.push({ en, ex });
    }
    if (defs.length) enMeanings.push({ pos: g.pos, defs });
  }

  // 7) 例句：<div><b>用作动词 (v.)</b></div><ol><li>EN<br/>ZH</li>...</ol>
  const examples: { pos: string; items: { en: string; zh: string }[] }[] = [];
  {
    const sec = sectionByTitle(html, "例句");
    const gRe = /<div>\s*<b>([^<]*)<\/b>\s*<\/div>\s*<ol[^>]*>([\s\S]*?)<\/ol>/g;
    let m2: RegExpExecArray | null;
    while ((m2 = gRe.exec(sec))) {
      const pos = stripTags(m2[1]).trim();
      const items: { en: string; zh: string }[] = [];
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
      let m3: RegExpExecArray | null;
      while ((m3 = liRe.exec(m2[2]))) {
        const parts = m3[1].split(/<br\s*\/?>/i);
        const en = stripTags(parts[0] || "").trim();
        const zh = stripTags(parts.slice(1).join(" ")).trim();
        if (en) items.push({ en, zh });
      }
      if (items.length) examples.push({ pos, items });
    }
  }

  // 8) 常用短语：<dl><dt><b>borrow from〔of〕 (v.+prep.)</b></dt><dd>释义<br>例句...</dd></dl>
  // dd 只取首个 <br> 前的第一行释义，dd 内整段例句会撑爆卡片
  const phrases: { name: string; def: string }[] = [];
  {
    const sec = sectionByTitle(html, "常用短语");
    const re = /<dt>\s*<b>([^<]*)<\/b>\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g;
    let m2: RegExpExecArray | null;
    while ((m2 = re.exec(sec))) {
      const name = stripTags(m2[1]).trim();
      const def = stripTags(protectCnTags(m2[2].split(/<br\s*\/?>/i)[0] || "")).trim();
      if (name) phrases.push({ name, def });
    }
  }

  // 9) 词汇搭配：<b>～+名词</b><ul><li><a>borrow a book</a> 借书</li>...</ul>
  const collocations: { group: string; items: { w: string; zh: string }[] }[] = [];
  {
    const sec = sectionByTitle(html, "词汇搭配");
    const gRe = /<b>([^<]+)<\/b>\s*<ul[^>]*>([\s\S]*?)<\/ul>/g;
    let m2: RegExpExecArray | null;
    while ((m2 = gRe.exec(sec))) {
      const group = stripTags(m2[1]).trim();
      const items: { w: string; zh: string }[] = [];
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
      let m3: RegExpExecArray | null;
      while ((m3 = liRe.exec(m2[2]))) {
        const aM = m3[1].match(/<a[^>]*>([^<]+)<\/a>\s*([^<]*)/);
        if (aM) {
          const w = aM[1].trim();
          if (w) items.push({ w, zh: stripTags(aM[2] || "").trim() });
        }
      }
      if (group && items.length) collocations.push({ group, items });
    }
  }

  // 10) 经典引文：<li><p>句子</p><b>出自：X</b></li>
  const quotes: { text: string; src: string }[] = [];
  {
    const sec = sectionByTitle(html, "经典引文");
    const re = /<p>([\s\S]*?)<\/p>\s*<b>出自：\s*([^<]*)<\/b>/g;
    let m2: RegExpExecArray | null;
    while ((m2 = re.exec(sec))) {
      const text = stripTags(m2[1]).trim();
      const src = stripTags(m2[2]).trim();
      if (text) quotes.push({ text, src });
    }
  }

  // 11) 近反义词：<h3>近反义词</h3>...<div>【近义词】</div><ul><li><a>X</a> 中文</li>...</ul>
  const synonyms: { w: string; zh?: string }[] = [];
  const antonyms: { w: string; zh?: string }[] = [];
  {
    const relHtml = sectionByTitle(html, "近反义词");
    const grab = (marker: string): { w: string; zh?: string }[] => {
      const part = relHtml.match(new RegExp(`${marker}<\\/div>([\\s\\S]*?)(?:<div>|$)`));
      const out: { w: string; zh?: string }[] = [];
      if (!part) return out;
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
      let m2: RegExpExecArray | null;
      while ((m2 = liRe.exec(part[1]))) {
        const aM = m2[1].match(/<a[^>]*>([^<]+)<\/a>\s*([^<]*)/);
        if (aM) {
          const w = aM[1].trim();
          if (w) out.push({ w, zh: stripTags(aM[2] || "").trim() || undefined });
        }
      }
      return out;
    };
    synonyms.push(...grab("【近义词】"));
    antonyms.push(...grab("【反义词】"));
  }

  // 12) 临近单词：<div class="layout nwd"><a>..</a>...</div>（区块内无嵌套 div，非贪婪安全）
  const nearWords: string[] = [];
  {
    const nwd = html.match(/<div class="layout nwd">([\s\S]*?)<\/div>/);
    if (nwd) {
      const aRe = /<a[^>]*>([^<]+)<\/a>/g;
      while ((m = aRe.exec(nwd[1]))) {
        const w = m[1].trim();
        if (w) nearWords.push(w);
      }
    }
  }

  // 全字段空 → null（避免显示空卡片）
  if (
    !phonetic &&
    meanings.length === 0 &&
    inflections.length === 0 &&
    synonyms.length === 0 &&
    antonyms.length === 0 &&
    detailMeanings.length === 0 &&
    dualMeanings.length === 0 &&
    enMeanings.length === 0 &&
    examples.length === 0 &&
    phrases.length === 0 &&
    collocations.length === 0 &&
    quotes.length === 0 &&
    nearWords.length === 0
  ) {
    return null;
  }
  return {
    word: w, phonetic, meanings, inflections, synonyms, antonyms, source: "haici",
    detailMeanings, dualMeanings, enMeanings, examples, phrases, collocations, quotes, nearWords,
  };
}

/**
 * 兼容性别名：旧代码可能仍引用 parseEudicFullHtml。
 * 2026-09-07 数据源切换后，调用方应改用 parseHaiciLiteHtml；本别名兜底。
 * @deprecated 使用 parseHaiciLiteHtml 替代
 */
export function parseEudicFullHtml(html: string, word: string): OnlineDictResult | null {
  return parseHaiciLiteHtml(html, word);
}

// ============ 内存缓存与并发去重 ============

/** 2.4 缓存条目（带 TTL + 失败计数） */
interface CacheEntry {
  value: OnlineDictResult | null; // null = 负缓存（请求过但未拿到内容）
  ts: number;                      // 写入时间戳 ms
  /** 正缓存 TTL：查到内容后保留 5 分钟，避免对相同词反复请求 */
  ttlMs: number;
  /** 负缓存 TTL：失败/无内容后 30s 内不重试，30s 后允许重试避免「一次网络抖动锁死整次会话」 */
  negativeTtlMs: number;
  /** 失败计数（仅负缓存统计）：用于诊断「某词连续失败 N 次」 */
  failCount: number;
}

/** 2.4 默认 TTL：正 5min、负 30s。可通过 setOnlineDictTtl() 运行时调整 */
const DEFAULT_POS_TTL = 5 * 60 * 1000;
const DEFAULT_NEG_TTL = 30 * 1000;
let posTtlMs = DEFAULT_POS_TTL;
let negTtlMs = DEFAULT_NEG_TTL;

/** 缓存：word(小写) → CacheEntry */
const cache = new Map<string, CacheEntry>();
/** 进行中的请求（并发去重） */
const inflight = new Map<string, Promise<OnlineDictResult | null>>();
/** 当前并发数 */
let activeCount = 0;
/** 限流队列 */
const queue: Array<() => void> = [];
const MAX_CONCURRENT = 3;

/** 2.4 缓存读取：命中且未过期才返回；过期则删除并视为未命中 */
function readCache(w: string): { hit: true; value: OnlineDictResult | null } | { hit: false } {
  const e = cache.get(w);
  if (!e) return { hit: false };
  const now = Date.now();
  const ttl = e.value ? e.ttlMs : e.negativeTtlMs;
  if (now - e.ts >= ttl) {
    cache.delete(w);
    return { hit: false };
  }
  return { hit: true, value: e.value };
}

/** 2.4 写缓存：根据成功/失败选择 TTL 与是否累加 failCount */
function writeCache(w: string, value: OnlineDictResult | null): void {
  if (value) {
    cache.set(w, { value, ts: Date.now(), ttlMs: posTtlMs, negativeTtlMs: negTtlMs, failCount: 0 });
  } else {
    const prev = cache.get(w);
    cache.set(w, {
      value: null,
      ts: Date.now(),
      ttlMs: posTtlMs,
      negativeTtlMs: negTtlMs,
      failCount: (prev?.failCount ?? 0) + 1,
    });
  }
}

/** 2.4 测试/配置：自定义 TTL（毫秒）。传 0 / 负数重置为默认 */
export function setOnlineDictTtl(opts: { positiveMs?: number; negativeMs?: number }): void {
  if (typeof opts.positiveMs === "number" && opts.positiveMs > 0) posTtlMs = opts.positiveMs;
  if (typeof opts.negativeMs === "number" && opts.negativeMs > 0) negTtlMs = opts.negativeMs;
}

/** 2.4 测试/诊断：取某词的缓存状态（未命中 / 正缓存 / 负缓存） */
export function getOnlineDictCacheState(w: string): "miss" | "positive" | "negative" {
  const e = cache.get(w);
  if (!e) return "miss";
  const now = Date.now();
  const ttl = e.value ? e.ttlMs : e.negativeTtlMs;
  if (now - e.ts >= ttl) return "miss";
  return e.value ? "positive" : "negative";
}

/** 内部：真正发起网络请求 */
async function doFetch(word: string, transport: PhoneticTransport): Promise<OnlineDictResult | null> {
  const t0 = Date.now();
  const url = eudicUrl(word);
  try {
    const resp = await transport(url);
    const cost = Date.now() - t0;
    if (!resp || resp.status !== 200 || !resp.body) {
      const preview = resp?.body ? ` body前200=${resp.body.slice(0, 200).replace(/\s+/g, " ")}` : "";
      console.debug(`[REword][在线词典] 请求失败 status=${resp?.status ?? 0} 耗时=${cost}ms url=${url}${preview}`);
      return null;
    }
    const parsed = parseEudicFullHtml(resp.body, word);
    const bodyPreview = resp.body.slice(0, 300).replace(/\s+/g, " ");
    console.debug(
      `[REword][在线词典] ${parsed ? "解析成功" : "未解析到内容"} status=200 耗时=${cost}ms 词=${word} ` +
      `音标=${parsed?.phonetic || "无"} 释义=${parsed?.meanings.length ?? 0}条 body前300=${bodyPreview}`
    );
    return parsed;
  } catch (e) {
    console.debug(`[REword][在线词典] 请求异常 ${(e as Error)?.message || e} 耗时=${Date.now() - t0}ms url=${url}`);
    return null;
  }
}

/**
 * 获取单词在线完整释义（内存缓存 + TTL + 并发去重 + 限流 + 日志）。
 * @returns OnlineDictResult；失败/未收录返回 null
 */
export async function fetchOnlineDict(
  word: string,
  transport?: PhoneticTransport
): Promise<OnlineDictResult | null> {
  const w = (word || "").trim().toLowerCase();
  if (!w) return null;
  // 2.4 缓存读取：命中且未过期才返回
  const hit = readCache(w);
  if (hit.hit) return hit.value;
  const existing = inflight.get(w);
  if (existing) return existing;

  const p = (async (): Promise<OnlineDictResult | null> => {
    await new Promise<void>((resolve) => {
      if (activeCount < MAX_CONCURRENT) {
        activeCount++;
        resolve();
      } else {
        queue.push(resolve);
      }
    });
    try {
      const r = await doFetch(w, transport || defaultTransport);
      writeCache(w, r); // 2.4 走统一写路径：带 TTL 与失败计数
      return r;
    } finally {
      activeCount--;
      const next = queue.shift();
      if (next) {
        activeCount++;
        next();
      }
    }
  })();
  inflight.set(w, p);
  p.finally(() => inflight.delete(w)).catch(() => {});
  return p;
}

/**
 * 渲染在线词典卡片 HTML（2026-09-07 全信息 v3，demo 定稿结构）。
 *
 * 结构：词头 → 简释义组（简释速览 + 词形行，词形并入此处）→ 三组手风琴 + 组内页签：
 *   释义（默认展开）：详尽释义 | 双解释义 | 英英释义
 *   用例（默认收起）：例句 | 常用短语 | 词汇搭配 | 经典引文
 *   相关（默认收起）：近反义词 | 临近单词
 *
 * 交互走事件委托（handleDockClick）：
 *   组头 data-action="dict-group-toggle" / 页签 data-action="dict-pane-switch" /
 *   可点击词（词形/搭配/近反义/临近）data-action="lookup-word"。
 *
 * pane id 用模块级序号做前缀：侧边栏卡片与词库详情面板可能同时各有一张在线卡，id 不能冲突。
 */
let onlineCardSeq = 0;

export function renderOnlineDictCard(r: OnlineDictResult, inVocab: boolean): string {
  const esc = (s: string): string =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
  const uid = `oc${++onlineCardSeq}`;

  // 历史缓存结果可能缺全信息字段（内存缓存重启即清，防御为空即可）
  const detail = r.detailMeanings || [];
  const dual = r.dualMeanings || [];
  const en = r.enMeanings || [];
  const examples = r.examples || [];
  const phrases = r.phrases || [];
  const colls = r.collocations || [];
  const quotes = r.quotes || [];
  const nearWords = r.nearWords || [];
  const synonyms = r.synonyms || [];
  const antonyms = r.antonyms || [];

  // —— 顶部简释义组：简释速览（复用离线 senses 结构）——
  const sensesHtml = r.meanings
    .map(
      (m) =>
        `<li class="hiword-dict-sense-item">` +
        (m.pos ? `<span class="hiword-dict-sense-pos">${esc(m.pos)}</span>` : "") +
        `<div class="hiword-dict-sense-body"><strong class="hiword-dict-sense-zh">${esc(m.zh)}</strong></div>` +
        `</li>`
    )
    .join("");

  // —— 词形行（并入简释义组；每个词形都是海词链接，点击递归查词）——
  const shapesHtml = r.inflections.length
    ? `<div class="hiword-dict-shapes">` +
      `<span class="hiword-dict-shape-label">词形</span>` +
      r.inflections
        .map(
          (it) =>
            `<span class="hiword-dict-shape-item"><span class="hiword-dict-shape-k">${esc(it.label)}:</span>` +
            `<a class="hiword-dict-chip" data-action="lookup-word" data-word="${esc(it.form)}">${esc(it.form)}</a></span>`
        )
        .join("") +
      `</div>`
    : "";

  // —— 组壳 / 页签壳 helper ——
  const groupShell = (name: string, collapsed: boolean, inner: string): string =>
    inner
      ? `<div class="hiword-dict-group${collapsed ? " is-collapsed" : ""}">` +
        `<div class="hiword-dict-group-head" data-action="dict-group-toggle">${esc(name)}<span class="hiword-dict-group-arrow">▼</span></div>` +
        `<div class="hiword-dict-group-content">${inner}</div></div>`
      : "";
  const paneSet = (defs: { id: string; label: string; count: number; html: string }[]): string => {
    const live = defs.filter((d) => d.count > 0 && d.html);
    if (!live.length) return "";
    const tabs = live
      .map(
        (d, i) =>
          `<button class="hiword-dict-group-tab${i === 0 ? " is-active" : ""}" data-action="dict-pane-switch" data-pane="${d.id}">${esc(d.label)}<span class="tab-count">${d.count > 99 ? "99+" : d.count}</span></button>`
      )
      .join("");
    const panes = live
      .map((d, i) => `<div class="hiword-dict-pane" id="${d.id}"${i === 0 ? "" : " hidden"}>${d.html}</div>`)
      .join("");
    return `<div class="hiword-dict-group-tabs">${tabs}</div>${panes}`;
  };

  // —— 组一：释义 ——
  const detailHtml = detail
    .map(
      (g) =>
        `<div class="hiword-dict-detail-group">` +
        `<div class="hiword-dict-detail-pos">${esc(g.pos)}</div>` +
        `<ol class="hiword-dict-detail-ol">${g.defs.map((d) => `<li>${esc(d)}</li>`).join("")}</ol>` +
        `</div>`
    )
    .join("");
  const dualHtml = dual
    .map(
      (g) =>
        `<div class="hiword-dict-detail-group">` +
        `<div class="hiword-dict-detail-pos">${esc(g.pos)}</div>` +
        `<ol class="hiword-dict-detail-ol">` +
        g.items
          .map((it) => `<li>${it.zh ? `<strong>${esc(it.zh)}</strong> ` : ""}${esc(it.en)}</li>`)
          .join("") +
        `</ol></div>`
    )
    .join("");
  const enHtml = en
    .map(
      (g) =>
        `<div class="hiword-dict-detail-group">` +
        `<div class="hiword-dict-detail-pos">${esc(g.pos)}</div>` +
        g.defs
          .map(
            (d) =>
              `<div class="hiword-dict-en-item">` +
              `<div class="hiword-dict-en-def">${esc(d.en)}</div>` +
              (d.ex ? `<div class="hiword-dict-en-ex">${esc(d.ex)}</div>` : "") +
              `</div>`
          )
          .join("") +
        `</div>`
    )
    .join("");
  const meaningGroup = groupShell("释义", false, paneSet([
    { id: `${uid}-p-detail`, label: "详尽释义", count: detail.reduce((n, g) => n + g.defs.length, 0), html: detailHtml },
    { id: `${uid}-p-dual`, label: "双解释义", count: dual.reduce((n, g) => n + g.items.length, 0), html: dualHtml },
    { id: `${uid}-p-en`, label: "英英释义", count: en.reduce((n, g) => n + g.defs.length, 0), html: enHtml },
  ]));

  // —— 组二：用例 ——
  const exHtml = examples
    .map(
      (g) =>
        (g.pos ? `<div class="hiword-dict-example-pos">${esc(g.pos)}</div>` : "") +
        g.items
          .map(
            (it) =>
              `<div class="hiword-dict-example">` +
              `<div class="hiword-dict-example-en" data-action="tts" data-text="${esc(it.en)}">${esc(it.en)}</div>` +
              (it.zh ? `<div class="hiword-dict-example-zh">${esc(it.zh)}</div>` : "") +
              `</div>`
          )
          .join("")
    )
    .join("");
  const phHtml = phrases
    .map(
      (p) =>
        `<div class="hiword-dict-phrase">` +
        `<span class="hiword-dict-phrase-name">${esc(p.name)}</span>` +
        (p.def ? `<span class="hiword-dict-phrase-def">—— ${esc(p.def)}</span>` : "") +
        `</div>`
    )
    .join("");
  const collHtml = colls
    .map(
      (g) =>
        `<div class="hiword-dict-coll-pattern">${esc(g.group)}</div>` +
        g.items
          .map(
            (it) =>
              `<div class="hiword-dict-coll-item">` +
              `<a class="hiword-dict-chip" data-action="lookup-word" data-word="${esc(it.w)}">${esc(it.w)}</a>` +
              (it.zh ? `<span>${esc(it.zh)}</span>` : "") +
              `</div>`
          )
          .join("")
    )
    .join("");
  const quoteHtml = quotes
    .map(
      (q) =>
        `<div class="hiword-dict-quote">` +
        `<div class="hiword-dict-quote-text">${esc(q.text)}</div>` +
        (q.src ? `<div class="hiword-dict-quote-src">${esc(q.src)}</div>` : "") +
        `</div>`
    )
    .join("");
  const usageGroup = groupShell("用例", true, paneSet([
    { id: `${uid}-p-ex`, label: "例句", count: examples.reduce((n, g) => n + g.items.length, 0), html: exHtml },
    { id: `${uid}-p-ph`, label: "常用短语", count: phrases.length, html: phHtml },
    { id: `${uid}-p-coll`, label: "词汇搭配", count: colls.reduce((n, g) => n + g.items.length, 0), html: collHtml },
    { id: `${uid}-p-quote`, label: "经典引文", count: quotes.length, html: quoteHtml },
  ]));

  // —— 组三：相关 ——
  const synRow = (label: string, list: { w: string; zh?: string }[]): string =>
    list.length
      ? `<div class="hiword-dict-syn-row"><span class="hiword-dict-syn-label">${label}</span>` +
        list
          .map(
            (s) =>
              `<a class="hiword-dict-chip" data-action="lookup-word" data-word="${esc(s.w)}"${s.zh ? ` title="${esc(s.zh)}"` : ""}>${esc(s.w)}</a>`
          )
          .join("") +
        `</div>`
      : "";
  const synHtml = synRow("近义：", synonyms) + synRow("反义：", antonyms);
  const nearHtml = nearWords.length
    ? `<div class="hiword-dict-syn-row">` +
      nearWords
        .map((w) => `<a class="hiword-dict-chip" data-action="lookup-word" data-word="${esc(w)}">${esc(w)}</a>`)
        .join("") +
      `</div>`
    : "";
  const relGroup = groupShell("相关", true, paneSet([
    { id: `${uid}-p-syn`, label: "近反义词", count: synonyms.length + antonyms.length, html: synHtml },
    { id: `${uid}-p-near`, label: "临近单词", count: nearWords.length, html: nearHtml },
  ]));

  // 数据来源徽标（2026-09-07 切换至海词；保留 eudic 兼容）
  const sourceLabel = r.source === "haici" ? "海词" : "欧路";

  return (
    `<div class="hiword-dict-card hiword-dict-card--online-full" data-word="${esc(r.word)}" data-source="${esc(r.source)}">` +
      `<div class="hiword-online-badge">🌐 在线词典（${sourceLabel}）</div>` +
      `<div class="hiword-dict-header">` +
        `<strong class="hiword-dict-word">${esc(r.word)}</strong>` +
        (r.phonetic ? `<em class="hiword-dict-phonetic">${esc(r.phonetic)}</em>` : "") +
        `<div class="hiword-dict-actions">` +
          `<button class="hiword-dict-star ${inVocab ? "star-on" : ""}" data-action="vocab-star" data-word="${esc(r.word)}" title="${inVocab ? "移出词库" : "加入词库"}">${inVocab ? "★" : "☆"}</button>` +
          `<button class="b3-button b3-button--small" data-action="tts" data-word="${esc(r.word)}">朗读</button>` +
        `</div>` +
      `</div>` +
      `<div class="hiword-dict-body">` +
        (sensesHtml
          ? `<ul class="hiword-dict-senses">${sensesHtml}</ul>`
          : `<p class="hiword-online-empty">在线词典未返回释义</p>`) +
        shapesHtml +
        meaningGroup +
        usageGroup +
        relGroup +
      `</div>` +
    `</div>`
  );
}

/** 测试辅助：清空缓存与进行中请求 */
export function resetOnlineDictCache(): void {
  cache.clear();
  inflight.clear();
  activeCount = 0;
  queue.length = 0;
}

/**
 * 在线简化小窗卡（2026-09-07 查词典功能）：与离线 renderDictCardSimple 对称。
 * 保留音标、词性+释义（全部简释行，海词简释本就精简）、形态变化一行；
 * 去除近反义词 chips（详细内容由 🔍 按钮送侧边栏查词典展示）。
 * 🌐 按钮切回离线（data-action="dict-switch-offline"）。
 */
export function renderOnlineDictCardSimple(r: OnlineDictResult, opts: { showStar?: boolean; inVocab?: boolean } = {}): string {
  const esc = (s: string): string =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));

  const meaningsHtml = r.meanings
    .map(
      (m) =>
        `<li class="hiword-dict-sense-item">` +
        (m.pos ? `<span class="hiword-dict-sense-pos">${esc(m.pos)}</span>` : "") +
        `<div class="hiword-dict-sense-body"><div class="hiword-dict-sense-main"><strong class="hiword-dict-sense-zh">${esc(m.zh)}</strong></div></div></li>`
    )
    .join("");

  // 形态变化一行（与离线 renderInflectionLine 同结构）
  const inflParts = r.inflections
    .filter((it) => it.label && it.form && it.form.toLowerCase() !== r.word.toLowerCase())
    .map((it) => `<span class="hiword-dict-infl-item">${esc(it.label)} ${esc(it.form)}</span>`);
  const inflHtml = inflParts.length
    ? `<div class="hiword-dict-infl-line"><span class="hiword-dict-infl-title">形态变化</span>${inflParts.join('<span class="hiword-dict-infl-sep">·</span>')}</div>`
    : "";

  const inVocab = opts.inVocab ?? false;
  const starBtn = opts.showStar === false
    ? ""
    : `<button class="hiword-dict-star ${inVocab ? "star-on" : ""}" data-action="vocab-star" data-word="${esc(r.word)}" title="${inVocab ? "移出词库" : "加入词库"}">${inVocab ? "★" : "☆"}</button>`;

  return (
    `<div class="hiword-dict-card hiword-dict-card--simple" data-word="${esc(r.word)}" data-source="${esc(r.source)}">` +
      `<div class="hiword-online-badge">🌐 在线词典（${r.source === "haici" ? "海词" : "欧路"}）</div>` +
      `<div class="hiword-dict-header">` +
        `<strong class="hiword-dict-word">${esc(r.word)}</strong>` +
        (r.phonetic ? `<em class="hiword-dict-phonetic">${esc(r.phonetic)}</em>` : "") +
        `<div class="hiword-dict-actions">` +
          `<button class="hiword-dict-src-btn" data-action="dict-switch-offline" title="切换到离线词典">🌐</button>` +
          `<button class="hiword-dict-side-btn" data-action="lookup-in-sidebar" data-word="${esc(r.word)}" title="在侧边栏查词典中查看详细释义">🔍</button>` +
          starBtn +
          `<button class="b3-button b3-button--small" data-action="tts" data-word="${esc(r.word)}">朗读</button>` +
        `</div>` +
      `</div>` +
      `<div class="hiword-dict-body">` +
        (meaningsHtml
          ? `<ul class="hiword-dict-senses hiword-dict-senses--simple">${meaningsHtml}</ul>`
          : `<p class="hiword-online-empty">在线词典未返回释义</p>`) +
        inflHtml +
      `</div>` +
    `</div>`
  );
}
