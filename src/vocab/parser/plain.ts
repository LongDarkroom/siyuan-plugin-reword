/**
 * plain parser：每行一词（2026-09-11 新增）
 * ------------------------------------------------------------------
 * 格式：
 *   abandon
 *   benevolent
 *   cognitive
 *
 * 识别规则（用于 detect）：
 *   - 至少 3 行
 *   - 每行（trim 后）含 1 个英文 token
 *   - 80% 以上的非空行匹配
 * 优先级：最低（兜底格式）
 */

import type { ParsedWord, WordParser } from "./types.ts";

/** 检测：≥3 行且 ≥80% 行是单 token 英文 */
export function detectPlain(content: string): boolean {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  const matched = lines.filter(l => /^[A-Za-z][A-Za-z'\-]*$/.test(l)).length;
  return matched / lines.length >= 0.8;
}

export const plainParser: WordParser = {
  format: "plain",
  parse(content: string): ParsedWord[] {
    const out: ParsedWord[] = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (!trimmed) continue;
      // 跳过非英文行（含中文 / 纯标点 / 多 token）
      if (!/^[A-Za-z][A-Za-z'\-]*$/.test(trimmed)) continue;
      out.push({
        word: trimmed.toLowerCase(),
        sourceLine: i + 1,
      });
    }
    return out;
  },
};
