/**
 * 在线音标兜底（P4 · 2026-08-14 新增）
 * ------------------------------------------------------------------
 * 离线音标覆盖（NCECD <pron> + CMU phon_extra.json）达 76-78%，短语/生僻词缺口
 * 纯离线不可补。这里提供「欧路词典网页」在线兜底：
 *   GET https://dict.eudic.net/dicts/en/{word} → 解析英/美音标
 *
 * 设计（用户选定的最小版）：
 *  - 内存 Map 缓存（2.4：含正/负 TTL，负缓存 30s 后可重试，避免一次网络抖动锁死整次会话）
 *  - 并发去重（同一 word 多个渲染点同时请求只发一次）
 *  - MAX_CONCURRENT=3 限流（防词库面板批量补写打爆思源内核代理）
 *  - 所有网络失败静默降级：返回 null、不抛错、不阻塞查词
 *
 * Node 可测：parseEudicHtml 为纯函数；网络层通过注入 transport 隔离。
 */

/** 网络传输层（默认走思源内核 forwardProxy 代理绕 CORS；测试注入 mock） */
export type PhoneticTransport = (url: string) => Promise<{ status: number; body: string }>;

import { forwardProxyRaw } from "../siyuan/api.ts";
import { getLogger } from "../core/logger.ts";

/** 欧路词典页面 URL */
function eudicUrl(word: string): string {
  return `https://dict.eudic.net/dicts/en/${encodeURIComponent(word)}`;
}

// ============ 内存缓存与并发去重 ============

/** 2.4 缓存条目（带 TTL + 失败计数） */
interface CacheEntry {
  value: string | null; // null = 负缓存（请求过但未拿到音标）
  ts: number;
  /** 正缓存 TTL：查到音标后保留 5 分钟，避免对相同词反复请求 */
  ttlMs: number;
  /** 负缓存 TTL：失败/无音标后 30s 内不重试，30s 后允许重试 */
  negativeTtlMs: number;
  /** 失败计数（仅负缓存统计） */
  failCount: number;
}

/** 2.4 默认 TTL：正 5min、负 30s */
const DEFAULT_POS_TTL = 5 * 60 * 1000;
const DEFAULT_NEG_TTL = 30 * 1000;
let posTtlMs = DEFAULT_POS_TTL;
let negTtlMs = DEFAULT_NEG_TTL;

/** 缓存：word(小写) → CacheEntry */
const cache = new Map<string, CacheEntry>();
/** 进行中的请求（并发去重） */
const inflight = new Map<string, Promise<string | null>>();
/** 当前并发数 */
let activeCount = 0;
/** 限流队列 */
const queue: Array<() => void> = [];
const MAX_CONCURRENT = 3;

/** 2.4 缓存读取：命中且未过期才返回；过期则删除并视为未命中 */
function readCache(w: string): { hit: true; value: string | null } | { hit: false } {
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
function writeCache(w: string, value: string | null): void {
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

/** 2.4 测试/配置：自定义 TTL（毫秒） */
export function setOnlinePhoneticTtl(opts: { positiveMs?: number; negativeMs?: number }): void {
  if (typeof opts.positiveMs === "number" && opts.positiveMs > 0) posTtlMs = opts.positiveMs;
  if (typeof opts.negativeMs === "number" && opts.negativeMs > 0) negTtlMs = opts.negativeMs;
}

/** 2.4 测试/诊断：取某词的缓存状态 */
export function getOnlinePhoneticCacheState(w: string): "miss" | "positive" | "negative" {
  const e = cache.get(w);
  if (!e) return "miss";
  const now = Date.now();
  const ttl = e.value ? e.ttlMs : e.negativeTtlMs;
  if (now - e.ts >= ttl) return "miss";
  return e.value ? "positive" : "negative";
}

/** 内部：真正发起网络请求（经注入的 transport） */
async function doFetch(word: string, transport: PhoneticTransport): Promise<string | null> {
  const t0 = Date.now();
  try {
    const resp = await transport(eudicUrl(word));
    const cost = Date.now() - t0;
    if (!resp || resp.status !== 200 || !resp.body) {
      const preview = resp?.body ? ` body前200=${resp.body.slice(0, 200).replace(/\s+/g, " ")}` : "";
      console.debug(`[REword][在线音标] 请求失败 status=${resp?.status ?? 0} 耗时=${cost}ms 词=${word}${preview}`);
      return null;
    }
    const phon = parseEudicHtml(resp.body);
    const bodyPreview = resp.body.slice(0, 300).replace(/\s+/g, " ");
    console.debug(`[REword][在线音标] ${phon ? "解析成功" : "未解析到音标"} status=200 耗时=${cost}ms 词=${word} 结果=${phon || "无"} body前300=${bodyPreview}`);
    return phon;
  } catch {
    console.debug(`[REword][在线音标] 请求异常 耗时=${Date.now() - t0}ms 词=${word}`);
    return null;
  }
}

/**
 * 解析欧路词典网页 HTML，提取美/英双音标。
 * 页面结构（已验证）：
 *   <span class="phontype">英</span><span class="Phonitic">/hə'ləʊ/</span>
 *   <span class="phontype">美</span><span class="Phonitic">/hə'loʊ/</span>
 * 返回格式化字符串「英式 /x/ 美式 /y/」；无音标返回 null。纯函数。
 */
export function parseEudicHtml(html: string): string | null {
  if (!html) return null;
  const re = /<span class="phontype">(英|美)<\/span><span class="Phonitic">\/([^/]+)\//g;
  let uk = "";
  let us = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const ph = m[2].trim().replace(/\s+/g, "");
    if (!ph) continue;
    if (m[1] === "英" && !uk) uk = ph;
    else if (m[1] === "美" && !us) us = ph;
  }
  if (!uk && !us) return null;
  const parts: string[] = [];
  if (uk) parts.push(`英 /${uk}/`);
  if (us) parts.push(`美 /${us}/`);
  return parts.join(" ");
}

/**
 * 获取单词在线音标（内存缓存 + TTL + 并发去重 + 限流）。
 * @returns 音标字符串（如「英 /hə'ləʊ/ 美 /hə'loʊ/」），失败/未收录返回 null
 */
export async function fetchOnlinePhonetic(
  word: string,
  transport?: PhoneticTransport
): Promise<string | null> {
  const w = (word || "").trim().toLowerCase();
  if (!w) return null;
  // 2.4 缓存读取：命中且未过期才返回
  const hit = readCache(w);
  if (hit.hit) return hit.value;
  // 并发去重：先查进行中（含已占位未真正发起者）
  const existing = inflight.get(w);
  if (existing) return existing;

  // 先占位再排队：保证并发同词只会创建一个 promise（消除竞态）
  const p = (async (): Promise<string | null> => {
    // 限流：超过并发上限时排队
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
 * 默认传输：经思源内核 forwardProxy 代理（GET + UA + 禁 gzip，防欧路反爬与乱码）
 *
 * fetchSyncPost 标准返回：{ code: 0, msg: "", data: <body 字符串> }（成功时）
 * 失败：{ code: <非 0 整数>, msg: "<错误信息>", data: null }
 * 【2026-08-15 修复】旧版错误地把 resp.data 当作嵌套 {status, body} 对象解析，
 * 导致 body 永远为空字符串、解析器返回 null。现在直接取 data 作为 body。
 */
export const defaultTransport: PhoneticTransport = async (url: string) => {
  try {
    // 统一经枢纽 forwardProxyRaw（单一底层转发，消除此前散落的 require/超时分叉）
    const r = await forwardProxyRaw({
      url,
      method: "GET",
      timeout: 8000,
      contentType: "text/html",
      responseEncoding: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Encoding": "identity",
        Accept: "text/html,application/xhtml+xml",
      },
      payload: "",
    });
    // 失败时打印完整诊断信息，便于定位 forwardProxy 端点缺失 / 思源版本不兼容 / 网络失败
    if (r.code !== 0) {
      getLogger().warn(`[REword][在线传输] forwardProxy 返回非 0 code=${r.code} msg=${r.msg} url=${url}`);
    }
    // 关键修复：应返回实际 HTTP status（forwardProxyRaw 已解析到 data.status），
    // 而不是用思源内核 code 覆盖。旧逻辑把目标站 404/403 错误地当成 200，
    // 导致上层解析错误页面并误判为"未收录"。
    return { status: r.status, body: r.body };
  } catch (e) {
    getLogger().warn(`[REword][在线传输] forwardProxy 抛异常 ${(e as Error)?.message || e} url=${url}`);
    return { status: 0, body: "" };
  }
};

/** 查询词头元素：查词卡 / 词库简洁卡 / 词库详细卡 三类音标元素 */
const PHONETIC_SELECTORS = [".hiword-dict-phonetic", ".hiword-vb-card-phon", ".hiword-vb-detail-phon"];

/** 查询词头元素：查词卡 / 词库详细卡 的词头 selector（用于无音标元素时插入） */
const WORD_SELECTORS = [".hiword-dict-word", ".hiword-vb-detail-word", ".hiword-vb-card-word"];

/**
 * 渲染后异步补写音标（2026-08-14 新增）。
 * 在查词卡/词库卡渲染完成后调用：
 *  1. 容器内已有音标元素且非空 → 跳过（离线已覆盖）
 *  2. 无音标元素 → 在词头后插入 <em class="hiword-dict-phonetic">…</em>
 *  3. 异步拉取在线音标，成功 → textContent 写入（防 XSS）
 *  4. 元素已不在 DOM（用户已切词）→ 放弃写入
 */
export async function maybeFillPhonetic(container: HTMLElement, word: string): Promise<void> {
  if (!container || !word) return;
  const w = word.trim();
  if (!w) return;

  // 已有音标文本 → 跳过（离线已覆盖，不打扰）
  for (const sel of PHONETIC_SELECTORS) {
    const el = container.querySelector(sel);
    if (el && el.textContent && el.textContent.trim()) return;
  }

  // 无音标元素 → 找词头，在其后插入空 <em>
  let target: HTMLElement | null = null;
  for (const sel of PHONETIC_SELECTORS) {
    const el = container.querySelector(sel);
    if (el) { target = el as HTMLElement; break; }
  }
  if (!target) {
    for (const sel of WORD_SELECTORS) {
      const head = container.querySelector(sel);
      if (head) {
        const em = document.createElement("em");
        em.className = "hiword-dict-phonetic";
        em.style.color = "var(--hw-phon, var(--b3-protyle-inline-em-color, #888))";
        head.insertAdjacentElement("afterend", em);
        target = em;
        break;
      }
    }
  }
  if (!target) return;

  const phonetic = await fetchOnlinePhonetic(w);
  // 元素已不在 DOM（用户已切词/关闭弹窗）→ 放弃
  if (!target.isConnected) return;
  if (phonetic) {
    // textContent 天然防 XSS，禁止 innerHTML
    target.textContent = phonetic;
    if (target.tagName === "EM" || target.classList.contains("hiword-vb-card-phon") || target.classList.contains("hiword-vb-detail-phon")) {
      target.style.fontStyle = "italic";
    }
  } else {
    // 在线也没有 → 移除空占位元素，避免空白 em 干扰布局
    if (!target.textContent || !target.textContent.trim()) {
      target.remove();
    }
  }
}

/** 测试辅助：清空缓存与进行中请求（供测试 reset） */
export function resetOnlinePhoneticCache(): void {
  cache.clear();
  inflight.clear();
  activeCount = 0;
  queue.length = 0;
}
