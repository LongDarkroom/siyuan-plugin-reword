/**
 * doubledot parser：`word :: meaning`（2026-09-11 新增）
 * ------------------------------------------------------------------
 * 格式：
 *   abandon :: 放弃，遗弃
 *   benevolent :: 善良的，仁慈的
 *
 * 识别规则：
 *   - 至少 2 行
 *   - ≥60% 行包含 `::` 且左半是英文 token
 * 优先级：高（plain 之上）
 */

import type { ParsedWord, WordParser } from "./types.ts";

export function detectDoubledot(content: string): boolean {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  const matched = lines.filter(l => {
    const idx = l.indexOf("::");
    if (idx < 0) return false;
    const left = l.slice(0, idx).trim();
    return /^[A-Za-z][A-Za-z'\-]*$/.test(left);
  }).length;
  return matched / lines.length >= 0.6;
}

export const doubledotParser: WordParser = {
  format: "doubledot",
  parse(content: string): ParsedWord[] {
    const out: ParsedWord[] = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf("::");
      if (idx < 0) continue;
      const left = trimmed.slice(0, idx).trim();
      const right = trimmed.slice(idx + 2).trim();
      // 单词必须合法
      if (!/^[A-Za-z][A-Za-z'\-]*$/.test(left)) continue;
      // meaning 为空也保留（用户后续编辑）
      out.push({
        word: left.toLowerCase(),
        meaning: right || undefined,
        sourceLine: i + 1,
      });
    }
    return out;
  },
};
