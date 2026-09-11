/**
 * 词书解析入口（2026-09-11 新增）
 * ------------------------------------------------------------------
 * 5 种 parser 注册表 + autoParse(content) 智能检测 + 调度
 *
 * 优先级：table > tsv > yaml > doubledot > plain
 *   - table 优先：markdown 表格最结构化
 *   - tsv 次之：Anki 风格常见
 *   - yaml 再之：frontmatter 明确
 *   - doubledot 第四：`::` 是强信号
 *   - plain 兜底：纯英文词列表
 */

import type { AutoParseResult, ParserFormat, WordParser, ParsedWord, CleanedResult } from "./types.ts";
import { plainParser, detectPlain } from "./plain.ts";
import { doubledotParser, detectDoubledot } from "./doubledot.ts";
import { tableParser, detectTable } from "./table.ts";
import { tsvParser, detectTsv } from "./tsv.ts";
import { yamlParser, detectYaml } from "./yaml.ts";
import { cleanParsed } from "./cleaner.ts";

/** Re-export types for downstream consumers */
export type { AutoParseResult, CleanedResult, ParsedWord, ParserFormat, WordParser } from "./types.ts";

/** Parser 注册表（按优先级排序） */
export const PARSERS: Record<ParserFormat, WordParser> = {
  table: tableParser,
  tsv: tsvParser,
  yaml: yamlParser,
  doubledot: doubledotParser,
  plain: plainParser,
};

/** 单独导出（便于测试） */
export { detectTable, detectTsv, detectYaml, detectDoubledot, detectPlain };
export { cleanParsed };
export { plainParser, doubledotParser, tableParser, tsvParser, yamlParser };

/**
 * 自动检测文本格式
 * @returns 识别到的格式；null = 都不识别
 */
export function detectFormat(content: string): ParserFormat | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  // 按优先级检测
  if (detectTable(trimmed)) return "table";
  if (detectTsv(trimmed)) return "tsv";
  if (detectYaml(trimmed)) return "yaml";
  if (detectDoubledot(trimmed)) return "doubledot";
  if (detectPlain(trimmed)) return "plain";
  return null;
}

/**
 * 自动解析文本：detect → parse → clean
 * 一站式入口
 */
export function autoParse(content: string): { result: AutoParseResult; cleaned: CleanedResult } | null {
  const format = detectFormat(content);
  if (!format) return null;
  const parser = PARSERS[format];
  const words = parser.parse(content);
  const rawLines = content.split(/\r?\n/);
  const cleaned = cleanParsed(words, rawLines);
  return {
    result: {
      format,
      words: cleaned.accepted,  // 返回清洗后的
      rawLineCount: rawLines.length,
    },
    cleaned,
  };
}
