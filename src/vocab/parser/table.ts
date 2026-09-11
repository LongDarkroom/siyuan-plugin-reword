/**
 * table parser：markdown 表格（2026-09-11 新增）
 * ------------------------------------------------------------------
 * 格式：
 *   | 单词 | 音标 | 释义 | 例句 |
 *   |------|------|------|------|
 *   | abandon | /əˈbændən/ | 放弃 | He abandoned his car. |
 *   | benevolent | /bəˈnevələnt/ | 仁慈的 | She is a benevolent person. |
 *
 * 列名自动识别（大小写不敏感，支持中英文 + 别名）：
 *   - word:  word | 单词 | 词 | 英文
 *   - phonetic: phonetic | 音标 | 读音
 *   - pos:  pos | 词性
 *   - meaning:  meaning | 释义 | 中文 | 翻译 | 意思
 *   - example:  example | 例句 | 句子
 *   - labels:  label | 标签
 *
 * 识别规则：首行 `|...|...|` 格式 + 第二行 `|--|--|` 分隔线
 */

import type { ParsedWord, WordParser } from "./types.ts";

type ColumnKey = "word" | "phonetic" | "pos" | "meaning" | "example" | "labels";

/** 列名 → 字段的别名映射（小写匹配） */
const COLUMN_ALIASES: Record<ColumnKey, string[]> = {
  word:     ["word", "单词", "词", "英文", "w"],
  phonetic: ["phonetic", "音标", "读音", "ipa"],
  pos:      ["pos", "词性", "part of speech"],
  meaning:  ["meaning", "释义", "中文", "翻译", "意思", "translation", "def"],
  example:  ["example", "例句", "句子", "sample", "ex"],
  labels:   ["label", "labels", "标签", "tag", "tags"],
};

function matchColumn(header: string): ColumnKey | null {
  const h = header.trim().toLowerCase();
  if (!h) return null;
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(h)) return key as ColumnKey;
  }
  return null;
}

/** 检测：首行 `|...|` + 第二行 `|---` 分隔 */
export function detectTable(content: string): boolean {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  const first = lines[0];
  const second = lines[1];
  if (!first.startsWith("|") || !first.endsWith("|")) return false;
  if (!/^\|[\s\-:|]+\|$/.test(second)) return false;
  // 第一行必须能识别出 word 列
  const headers = first.slice(1, -1).split("|").map(h => h.trim());
  return headers.some(h => matchColumn(h) === "word");
}

export const tableParser: WordParser = {
  format: "table",
  parse(content: string): ParsedWord[] {
    const out: ParsedWord[] = [];
    const lines = content.split(/\r?\n/);
    let headers: (ColumnKey | null)[] | null = null;
    let sawSeparator = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
        // 表格结束
        if (headers !== null) break;
        continue;
      }
      const cells = trimmed.slice(1, -1).split("|").map(c => c.trim());
      // 第一行：表头
      if (headers === null) {
        headers = cells.map(matchColumn);
        continue;
      }
      // 第二行：分隔线
      if (!sawSeparator) {
        const inner = trimmed.slice(1, -1).replace(/\|/g, "");
        if (!/^[\s\-:|]+$/.test(inner)) {
          // 不是合法分隔行 → 表格格式错，停止
          break;
        }
        sawSeparator = true;
        continue;
      }
      // 数据行
      const word = headers[0] && cells[0] ? cells[0] : "";
      if (!word) continue;
      if (!/^[A-Za-z][A-Za-z'\-]*$/.test(word)) continue;
      const item: ParsedWord = {
        word: word.toLowerCase(),
        sourceLine: i + 1,
      };
      headers.forEach((key, idx) => {
        if (!key || idx === 0) return;
        const val = cells[idx]?.trim();
        if (!val) return;
        if (key === "labels") {
          item.labels = val.split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
        } else {
          // 任意字段都允许塞（meaning/translation 都用 meaning 字段）
          if (key === "phonetic") item.phonetic = val;
          else if (key === "pos") item.pos = val;
          else if (key === "meaning") item.meaning = val;
          else if (key === "example") item.example = val;
        }
      });
      out.push(item);
    }
    return out;
  },
};
