/**
 * yaml parser：YAML frontmatter + 列表（2026-09-11 新增）
 * ------------------------------------------------------------------
 * 格式：
 *   ---
 *   name: TOEFL Core
 *   level: C1
 *   source: https://...
 *   ---
 *   - abandon
 *     - phonetic: /əˈbændən/
 *     - meaning: 放弃
 *   - benevolent
 *     - phonetic: /bəˈnevələnt/
 *     - meaning: 仁慈
 *
 * 识别规则：
 *   - 文件前 3 行是 `---` 起头
 *   - 第二个 `---` 关闭 frontmatter
 *   - 关闭后有 `- word` 列表
 *
 * 注意：本 parser 用极简正则处理，避免引 js-yaml 库（bundle 体积）
 *       仅支持"列表项 + 子对象"这一种结构，覆盖 90% 用例
 */

import type { ParsedWord, WordParser } from "./types.ts";

export function detectYaml(content: string): boolean {
  const lines = content.split(/\r?\n/);
  if (lines.length < 5) return false;
  if (lines[0].trim() !== "---") return false;
  // 找第二个 ---
  let end = -1;
  for (let i = 1; i < Math.min(lines.length, 20); i++) {
    if (lines[i].trim() === "---") { end = i; break; }
  }
  if (end < 0) return false;
  // 关闭后有 `- xxx` 列表
  for (let i = end + 1; i < lines.length; i++) {
    if (/^\s*-\s+\S+/.test(lines[i])) return true;
  }
  return false;
}

interface YamlEntry {
  word: string;
  phonetic?: string;
  meaning?: string;
  pos?: string;
  example?: string;
  labels?: string[];
  startLine: number;
}

function parseYamlBody(content: string): YamlEntry[] {
  const lines = content.split(/\r?\n/);
  // 找 frontmatter 边界
  let fmEnd = -1;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < Math.min(lines.length, 20); i++) {
      if (lines[i].trim() === "---") { fmEnd = i; break; }
    }
  }
  const bodyLines = fmEnd >= 0 ? lines.slice(fmEnd + 1) : lines;
  const entries: YamlEntry[] = [];
  let cur: YamlEntry | null = null;
  for (let i = 0; i < bodyLines.length; i++) {
    const raw = bodyLines[i];
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    // 列表项：`- word` / `- "word"` / `- 'word'`（引号必须成对匹配）
    const itemMatch = line.match(/^\s*-\s+(["']?)([A-Za-z][A-Za-z'\-]*)\1\s*$/);
    if (itemMatch) {
      if (cur) entries.push(cur);
      cur = {
        word: itemMatch[2].toLowerCase(),
        startLine: (fmEnd >= 0 ? fmEnd + 1 : 0) + i + 1,
      };
      continue;
    }
    // 子字段：`- key: value` 或 `  key: value`
    const subMatch = line.match(/^\s+-?\s*([a-zA-Z_]+)\s*:\s*(.+?)\s*$/);
    if (subMatch && cur) {
      const [, key, val] = subMatch;
      const v = val.replace(/^["']|["']$/g, "").trim();
      if (key === "phonetic") cur.phonetic = v;
      else if (key === "meaning" || key === "translation") cur.meaning = v;
      else if (key === "pos") cur.pos = v;
      else if (key === "example") cur.example = v;
      else if (key === "label" || key === "labels" || key === "tags") {
        cur.labels = v.split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
      }
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

export const yamlParser: WordParser = {
  format: "yaml",
  parse(content: string): ParsedWord[] {
    const entries = parseYamlBody(content);
    return entries.map(e => ({
      word: e.word,
      phonetic: e.phonetic,
      meaning: e.meaning,
      pos: e.pos,
      example: e.example,
      labels: e.labels,
      sourceLine: e.startLine,
    }));
  },
};
