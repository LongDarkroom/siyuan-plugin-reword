/**
 * 在线完整词典兜底（P4 · 2026-08-15 新增）
 * ------------------------------------------------------------------
 * 与 online-phonetic.ts 的「在线音标兜底」互补：离线 NCECD/ECD2 词典
 * 查不到词条时，抓取欧路词典网页版完整内容（音标 + 释义）作为兜底，
 * 让生僻词/新词/专有名词也能有可读的在线释义。
 *
 * 数据来源：https://dict.eudic.net/dicts/en/{word}（免费公开网页，无需 API key）
 * 页面结构（2026-08-15 实测）：
 *   - 音标：<span class="phontype">英</span><span class="Phonitic">/'mɑːstəri/</span>
 *   - 释义：<div class="exp">n. 精通；优势；统治权；征服；掌握</div>（可多个）
 *
 * 设计（与 online-phonetic 同款）：
 *  - 内存 Map 缓存（2.4：含正/负 TTL，负缓存 30s 后可重试，避免一次网络抖动锁死整次会话）
 *  - 并发去重 + MAX_CONCURRENT=3 限流
 *  - 所有网络失败静默降级返回 null（调用方决定是否 toast 提示）
 *  - 结构化调试日志（任务 2：请求 URL/状态/耗时/解析结果）
 *
 * Node 可测：parseEudicFullHtml 为纯函数；网络层注入 transport 隔离。
 */

import { defaultTransport, type PhoneticTransport } from "./online-phonetic.ts";

/** 在线词典结果 */
export interface OnlineDictResult {
  word: string;
  /** 音标，如「英 /'mɑːstəri/ 美 /'mæstəri/」 */
  phonetic: string;
  /** 释义列表（词性 + 中文） */
  meanings: { pos: string; zh: string }[];
  /** 数据来源标记 */
  source: "eudic";
}

/** 欧路词典页面 URL */
function eudicUrl(word: string): string {
  return `https://dict.eudic.net/dicts/en/${encodeURIComponent(word)}`;
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
 * 解析欧路词典网页完整 HTML，提取音标 + 释义（纯函数，可测）。
 *
 * @returns OnlineDictResult；无任何释义/音标时返回 null
 */
export function parseEudicFullHtml(html: string, word: string): OnlineDictResult | null {
  if (!html) return null;
  const w = (word || "").trim();
  if (!w) return null;

  // 1) 音标（复用 online-phonetic 同款正则）
  const phonRe = /<span class="phontype">(英|美)<\/span><span class="Phonitic">\/([^/]+)\//g;
  let uk = "";
  let us = "";
  let m: RegExpExecArray | null;
  while ((m = phonRe.exec(html))) {
    const ph = m[2].trim().replace(/\s+/g, "");
    if (!ph) continue;
    if (m[1] === "英" && !uk) uk = ph;
    else if (m[1] === "美" && !us) us = ph;
  }
  const phonetic = [uk ? `英 /${uk}/` : "", us ? `美 /${us}/` : ""].filter(Boolean).join(" ");

  // 2) 释义：<div class="exp">…</div>（可能多个，每个一行）
  const expRe = /<div class="exp">([\s\S]*?)<\/div>/g;
  const meanings: { pos: string; zh: string }[] = [];
  while ((m = expRe.exec(html))) {
    const line = stripTags(m[1]);
    if (!line) continue;
    // 词性前缀：n. / v. / vt. / vi. / adj. / adv. / prep. / conj. / pron. / int. / num. / art. / abbr.
    const posMatch = line.match(/^(n\.|v\.|vt\.|vi\.|adj\.|adv\.|prep\.|conj\.|pron\.|int\.|num\.|art\.|abbr\.|aux\.)\s*(.*)$/i);
    if (posMatch) {
      const zh = posMatch[2].trim();
      if (zh) meanings.push({ pos: posMatch[1].toLowerCase(), zh });
    } else {
      // 无词性前缀：整行当释义（可能是中文词典内容）
      meanings.push({ pos: "", zh: line });
    }
  }

  // 无任何有效内容 → null
  if (!phonetic && meanings.length === 0) return null;
  return { word: w, phonetic, meanings, source: "eudic" };
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
 * 渲染在线词典卡片 HTML（含「在线词典」来源徽标）。
 * 结构对齐离线 renderDictCard 的视觉：词头 + 音标 + 释义列表。
 */
export function renderOnlineDictCard(r: OnlineDictResult, inVocab: boolean): string {
  const esc = (s: string): string =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));

  const meaningsHtml = r.meanings
    .map((m) => {
      const posChip = m.pos
        ? `<span class="hiword-online-pos">${esc(m.pos)}</span>`
        : "";
      return `<div class="hiword-online-meaning">${posChip}<span>${esc(m.zh)}</span></div>`;
    })
    .join("");

  return (
    `<div class="hiword-dict-card" data-word="${esc(r.word)}">` +
      `<div class="hiword-online-badge">🌐 在线词典（欧路）</div>` +
      `<div class="hiword-dict-header">` +
        `<strong class="hiword-dict-word">${esc(r.word)}</strong>` +
        (r.phonetic ? `<em class="hiword-dict-phonetic">${esc(r.phonetic)}</em>` : "") +
        `<div class="hiword-dict-actions">` +
          `<button class="hiword-dict-star ${inVocab ? "star-on" : ""}" data-action="vocab-star" data-word="${esc(r.word)}" title="${inVocab ? "移出词库" : "加入词库"}">${inVocab ? "★" : "☆"}</button>` +
          `<button class="b3-button b3-button--small" data-action="tts" data-word="${esc(r.word)}">朗读</button>` +
        `</div>` +
      `</div>` +
      `<div class="hiword-dict-body">` +
        (meaningsHtml || `<p class="hiword-online-empty">在线词典未返回释义</p>`) +
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
