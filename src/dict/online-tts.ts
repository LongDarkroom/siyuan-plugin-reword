/**
 * 海词在线发音兜底（2026-09-16 新增）
 * ------------------------------------------------------------------
 * 背景：Windows 上 Web Speech API（speechSynthesis，离线系统语音）经常
 * 无可用嗓音或静默无声 → 单词朗读没声音。用户拍板：直接用在线海词兜底。
 *
 * 链路（两步式，实测 2026-09-16）：
 *   1. GET https://corp.dict.cn/search?q={word}（与 online-dict.ts / online-phonetic.ts
 *      同一数据源，走 forwardProxy 绕 CORS）→ 页面内 <i naudio="…mp3?t=word"> 发音标记：
 *        fbTd30nP*.mp3（女·美）/ mbTd30nP*.mp3（男·美）/ fuk0nP*.mp3（女·英）/ muTd30nP*.mp3（男·英）
 *   2. https://audio.dict.cn/{naudio} → 直接 200 audio/mp3（<audio> 播媒体不受 CORS 限制）
 *
 * 设计：
 *  - 仅单词级发音：查不到 naudio（整句/短语/生僻词）→ 返回 false，由上层回退有道
 *  - word → audioUrl 正缓存（10 分钟，避免连点反复抓页面）；失败负缓存 30s
 *  - 所有失败静默：返回 false、不抛错、不阻塞朗读
 */

import { defaultTransport } from "./online-phonetic.ts";
import { getLogger } from "../core/logger.ts";

/** 正/负缓存 TTL（ms） */
const POS_TTL = 10 * 60 * 1000;
const NEG_TTL = 30 * 1000;

/** 缓存：word(小写+accent) → { url: string | null, ts: number }（url=null 为负缓存） */
const cache = new Map<string, { url: string | null; ts: number }>();

/** 进行中的请求（并发去重：同一词同时只抓一次页面） */
const inflight = new Map<string, Promise<string | null>>();

/** 从海词页面 HTML 提取发音 naudio（纯函数，Node 可测）。
 *  accent: us → mbTd30nP / fbTd30nP 优先；uk → muTd30nP / fuk0nP 优先。
 *  同口音内男生版在前（实测音质更稳）。 */
export function parseHaiciAudio(html: string, accent: "uk" | "us"): string | null {
  if (!html) return null;
  const items: Array<{ naudio: string; accent: "uk" | "us"; male: boolean }> = [];
  const re = /naudio="([^"]+?\.mp3[^"]*)"[^>]*title="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const naudio = m[1];
    const male = /^m/i.test(naudio);
    const isUk = /(^|[fmu])uk/.test(naudio);
    items.push({ naudio, accent: isUk ? "uk" : "us", male });
  }
  if (!items.length) return null;
  // 排序：口音匹配优先，其次男生版 → 保持页面原序（稳定）
  const scored = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const pa = (a.it.accent === accent ? 2 : 0) + (a.it.male ? 1 : 0);
      const pb = (b.it.accent === accent ? 2 : 0) + (b.it.male ? 1 : 0);
      return pb - pa || a.i - b.i;
    });
  return scored[0].it.naudio;
}

/** 查询海词发音 mp3 URL（带缓存与并发去重）。无发音时返回 null。 */
export async function fetchHaiciAudioUrl(word: string, accent: "uk" | "us" = "us"): Promise<string | null> {
  const w = (word || "").trim();
  // 整句/带空格短语：海词词条按单词收录，多词短语基本无发音 → 不浪费时间
  if (!w || /\s/.test(w)) return null;
  const key = w.toLowerCase() + "|" + accent;

  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.url ? POS_TTL : NEG_TTL;
    if (Date.now() - hit.ts < ttl) return hit.url;
    cache.delete(key);
  }
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async (): Promise<string | null> => {
    try {
      const r = await defaultTransport(`https://corp.dict.cn/search?q=${encodeURIComponent(w)}`);
      if (r.status !== 200 || !r.body) return null;
      const naudio = parseHaiciAudio(r.body, accent);
      if (!naudio) return null;
      return `https://audio.dict.cn/${naudio}`;
    } catch (e) {
      getLogger().warn(`[REword][海词发音] 获取失败 ${(e as Error)?.message || e} word=${w}`);
      return null;
    }
  })();
  inflight.set(key, p);
  const url = await p;
  inflight.delete(key);
  cache.set(key, { url, ts: Date.now() });
  return url;
}

/** 用海词发音朗读单词。成功播放返回 true；失败/无发音返回 false（上层自行回退）。 */
export function speakHaici(word: string, accent: "uk" | "us" = "us", volume = 1): Promise<boolean> {
  return fetchHaiciAudioUrl(word, accent).then((url) => {
    if (!url) return false;
    return new Promise<boolean>((resolve) => {
      try {
        const audio = new Audio(url);
        audio.volume = volume;
        audio.onended = () => resolve(true);
        audio.onerror = () => resolve(false);
        const p = audio.play();
        if (p && typeof p.catch === "function") p.catch(() => resolve(false));
      } catch {
        resolve(false);
      }
    });
  });
}

/** 清空缓存（测试用） */
export function resetHaiciTtsCache(): void {
  cache.clear();
}
