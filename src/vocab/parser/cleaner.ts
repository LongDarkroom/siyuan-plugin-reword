/**
 * 解析结果清洗（2026-09-11 新增）
 * ------------------------------------------------------------------
 * 输入：parser 输出的 ParsedWord[]（可能含无效项）
 * 处理：
 *   1. 单词格式校验（必填 + 正则）
 *   2. 长度限制（≤30 字符）
 *   3. 停用词黑名单（the/a/an/to/in/on/of/for/with/...）
 *   4. 大小写归一 + 去重（按 word 字段，保留先出现的释义）
 * 输出：CleanedResult（accepted / skipped / 计数）
 */

import type { CleanedResult, ParsedWord } from "./types.ts";

/** 停用词（解析时跳过，避免无意义的虚词） */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "is", "are", "was", "were",
  "to", "of", "in", "on", "at", "for", "with", "by", "from", "as",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "this", "that", "these", "those",
  "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "should", "could", "may", "might", "must", "can",
  "not", "no", "yes", "if", "so", "than", "then", "when", "where", "why", "how",
]);

/** 最大词长（防止误解析长字符串） */
const MAX_WORD_LEN = 30;

/**
 * 清洗 + 去重
 * @param words parser 输出
 * @param originalRawLines 原始文本（用于 skipped 报告）
 */
export function cleanParsed(words: ParsedWord[], originalRawLines?: string[]): CleanedResult {
  const accepted: ParsedWord[] = [];
  const seen = new Map<string, ParsedWord>();
  const skipped: Array<{ line: number; reason: string; raw: string }> = [];

  for (const w of words) {
    const raw = originalRawLines?.[w.sourceLine - 1] ?? "";
    // 1) 单词必填
    if (!w.word) {
      skipped.push({ line: w.sourceLine, reason: "empty", raw });
      continue;
    }
    // 2) 大小写归一（已归一，但保险）
    const key = w.word.toLowerCase().trim();
    // 3) 长度
    if (key.length > MAX_WORD_LEN) {
      skipped.push({ line: w.sourceLine, reason: "too_long", raw });
      continue;
    }
    // 4) 黑名单
    if (STOP_WORDS.has(key)) {
      skipped.push({ line: w.sourceLine, reason: "stop_word", raw });
      continue;
    }
    // 5) 字母合法性
    if (!/^[a-z][a-z'\-]*$/.test(key)) {
      skipped.push({ line: w.sourceLine, reason: "invalid_chars", raw });
      continue;
    }
    // 6) 去重（保留先出现，且 meaning 更长的优先）
    const existing = seen.get(key);
    if (existing) {
      if (!existing.meaning && w.meaning) {
        existing.meaning = w.meaning;
      }
      if (!existing.phonetic && w.phonetic) {
        existing.phonetic = w.phonetic;
      }
      if (!existing.example && w.example) {
        existing.example = w.example;
      }
      // 不增加 accepted（合并到已存在）
      continue;
    }
    const cleaned: ParsedWord = { word: key, sourceLine: w.sourceLine };
    if (w.phonetic) cleaned.phonetic = w.phonetic;
    if (w.pos) cleaned.pos = w.pos;
    if (w.meaning) cleaned.meaning = w.meaning;
    if (w.example) cleaned.example = w.example;
    if (w.labels && w.labels.length) cleaned.labels = w.labels;
    seen.set(key, cleaned);
    accepted.push(cleaned);
  }

  return {
    accepted,
    skipped,
    rawCount: words.length,
    dedupedCount: accepted.length,
  };
}
