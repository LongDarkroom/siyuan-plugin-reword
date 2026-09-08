/**
 * REword · AI 长期记忆（SOUL）
 * ------------------------------------------------------------------
 * 第 5 批（P0-5）：消除 soulDocId / soulEnabled / soulMaxChars 三个「零消费方」设置项。
 *
 * 设计：把用户在设置里指定的 SOUL 文档（通常是「关于我 / 学习偏好 / 长期上下文」类笔记）
 * 的正文读出来，截断到 soulMaxChars，注入到每次 AI 调用的 system 提示词里，
 * 让模型在精读与对话中都能「记得」用户是谁、有哪些长期偏好。
 *
 * 取数复用 ai-doc-search 的 getDocText（内核 exportMdContent，一次调用）；
 * 模块级单条缓存避免每次发送都重拉同一篇文档。
 */

import type { AiSettings } from "./ai-settings.ts";
import { getDocText } from "./ai-doc-search.ts";
import { getLogger } from "../core/logger.ts";

export interface SoulMemory {
  docId: string;
  text: string;
  truncated: boolean;
}

/** 模块级单条缓存：soulDocId 基本不变，避免每条消息都重拉文档 */
let cache: SoulMemory | null = null;

/** 取数 seam：默认走 getDocText（内核 exportMdContent）；测试可覆盖为同步假数据 */
type DocFetcher = (docId: string, maxLen: number) => Promise<string>;
let docFetcher: DocFetcher = (id, n) => getDocText(id, n);
export function __setSoulDocFetcher(f: DocFetcher | null): void {
  docFetcher = f ?? ((id, n) => getDocText(id, n));
  cache = null;
}

/** 轻量去 markdown：剥掉最嘈杂的语法（链接/图片/粗体/标题符），保留正文文本 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 图片
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // 链接 → 仅文本
    .replace(/\*\*([^*]+)\*\*/g, "$1") // 粗体
    .replace(/\*([^*\s][^*]*?)\*/g, "$1") // 斜体（仅内部无空格，避免误伤 2 * 3）
    .replace(/(^|\n)#{1,6}\s+/g, "$1") // 标题 # 前缀
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1") // 行内/围栏代码
    .replace(/\n{3,}/g, "\n\n") // 多余空行
    .trim();
}

export async function loadSoulMemory(docId: string, maxChars: number): Promise<SoulMemory | null> {
  if (!docId) return null;
  if (cache && cache.docId === docId) return cache;
  let raw = "";
  try {
    raw = await docFetcher(docId, maxChars);
  } catch (e) {
    getLogger().warn("SOUL 文档读取失败（本次跳过注入）", { operation: "loadSoulMemory", data: { docId }, error: e as Error });
    return null;
  }
  if (!raw || !raw.trim()) return null;
  const text = stripMarkdown(raw).slice(0, maxChars);
  const truncated = raw.length >= maxChars;
  cache = { docId, text, truncated };
  return cache;
}

export function clearSoulCache(): void {
  cache = null;
}

/**
 * 构造注入 system 提示词的 SOUL 段落；未开启 / 无文档 / 读取失败均返回空串。
 * 调用方直接 `sysWithVocab += await buildSoulSection(settings)` 即可（空串无副作用）。
 */
export async function buildSoulSection(settings: AiSettings): Promise<string> {
  if (!settings.soulEnabled || !settings.soulDocId) return "";
  const maxChars = settings.soulMaxChars ?? 4000;
  const mem = await loadSoulMemory(settings.soulDocId, maxChars);
  if (!mem || !mem.text) return "";
  const trunc = mem.truncated ? `（已截断至 ${mem.text.length} 字）` : "";
  return `\n\n【长期记忆 SOUL · 来自文档 ${mem.docId}${trunc}】\n${mem.text}`;
}
