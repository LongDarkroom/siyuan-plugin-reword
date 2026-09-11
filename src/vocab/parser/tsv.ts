/**
 * tsv parser：Anki 风格 Tab 分隔（2026-09-11 新增）
 * ------------------------------------------------------------------
 * 格式：
 *   word	meaning	example
 *   abandon	放弃	He abandoned his car.
 *   benevolent	仁慈	She is benevolent.
 *
 * 识别规则：
 *   - 至少 2 行
 *   - 第一行有 ≥2 个 tab（可能含表头）
 *   - 至少一行 ≥2 个 tab
 * 优先级：高于 plain/doubledot
 */

import type { ParsedWord, WordParser } from "./types.ts";

export function detectTsv(content: string): boolean {
  const lines = content.split(/\r?\n/).filter(l => l.includes("\t"));
  if (lines.length < 2) return false;
  // 第一行至少 2 个 tab
  const firstTabs = (lines[0].match(/\t/g) ?? []).length;
  if (firstTabs < 1) return false;
  return true;
}

/** 第一行是否像表头（首列是已知列名） */
function isHeaderRow(line: string): boolean {
  const cells = line.split("\t").map(c => c.trim().toLowerCase());
  const known = ["word", "单词", "词", "meaning", "释义", "中文", "example", "例句", "phonetic", "音标"];
  return cells.some(c => known.includes(c));
}

export const tsvParser: WordParser = {
  format: "tsv",
  parse(content: string): ParsedWord[] {
    const out: ParsedWord[] = [];
    const lines = content.split(/\r?\n/);
    let columns: string[] = [];
    let skipFirst = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.includes("\t")) continue;  // 跳过非 tab 行
      if (!skipFirst) {
        if (isHeaderRow(raw)) {
          // 表头：列名归一为小写
          columns = raw.split("\t").map(c => c.trim().toLowerCase());
          skipFirst = true;
          continue;
        } else {
          // 无表头：默认列序 [word, meaning, phonetic, example]
          columns = ["word", "meaning", "phonetic", "example"];
          skipFirst = true;
        }
      }
      const cells = raw.split("\t");
      const word = (cells[0] ?? "").trim();
      if (!word || !/^[A-Za-z][A-Za-z'\-]*$/.test(word)) continue;
      const item: ParsedWord = {
        word: word.toLowerCase(),
        sourceLine: i + 1,
      };
      cells.forEach((cell, idx) => {
        if (idx === 0) return;
        const colName = columns[idx] ?? "";
        const val = cell.trim();
        if (!val) return;
        if (colName.includes("phonetic") || colName.includes("音标") || colName === "ipa") {
          item.phonetic = val;
        } else if (colName.includes("pos") || colName.includes("词性")) {
          item.pos = val;
        } else if (colName.includes("example") || colName.includes("例句") || colName === "ex") {
          item.example = val;
        } else if (colName.includes("label") || colName.includes("标签")) {
          item.labels = val.split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
        } else {
          // 默认是 meaning/翻译
          item.meaning = val;
        }
      });
      out.push(item);
    }
    return out;
  },
};
