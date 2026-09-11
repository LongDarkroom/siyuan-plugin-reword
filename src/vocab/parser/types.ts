/**
 * 词书解析 · 公共类型（2026-09-11 新增）
 * ------------------------------------------------------------------
 * 5 种解析格式的输出统一为 ParsedWord，便于上层（导入向导、autoParse）处理。
 *
 * 解析流程：
 *   源文本（块/文档/文件/粘贴）
 *     ↓
 *   autoParse: detect(format) → parse(content, format)
 *     ↓
 *   cleaner.ts: 去重 / 跳过 / 黑名单
 *     ↓
 *   ParsedWord[]（clean 后）→ 导入向导预览 → 校验入库
 */

/** 支持的解析格式（5 种内置） */
export type ParserFormat = "plain" | "doubledot" | "table" | "tsv" | "yaml";

/** 单条解析结果（未清洗） */
export interface ParsedWord {
  /** 必填：单词（小写，trim 后） */
  word: string;
  /** 可选：音标（如 /əˈbændən/） */
  phonetic?: string;
  /** 可选：词性（如 n. / v. / adj.） */
  pos?: string;
  /** 可选：英文释义 */
  meaning?: string;
  /** 可选：中文翻译 */
  translation?: string;
  /** 可选：例句（英文） */
  example?: string;
  /** 可选：自动标签（解析器或向导推断） */
  labels?: string[];
  /** 源行号（从 1 开始），用于回溯/报错 */
  sourceLine: number;
}

/** 解析器统一接口（每个格式一个文件实现） */
export interface WordParser {
  /** 该 parser 支持的格式（用于注册表） */
  readonly format: ParserFormat;
  /**
   * 解析文本 → ParsedWord[]（未清洗）
   * @param content 原始文本（来自块/文档/文件/粘贴）
   * @returns 解析出的词条（可能含无效项，由 cleaner 清洗）
   */
  parse(content: string): ParsedWord[];
}

/** autoParse 返回 */
export interface AutoParseResult {
  format: ParserFormat;
  words: ParsedWord[];
  /** 原始行数（用于 UI 显示） */
  rawLineCount: number;
}

/** 清洗后汇总（导入向导用） */
export interface CleanedResult {
  /** 清洗后有效词 */
  accepted: ParsedWord[];
  /** 跳过的行（含原因） */
  skipped: Array<{ line: number; reason: string; raw: string }>;
  /** 原始总行数 */
  rawCount: number;
  /** 去重后数（accepted 长度，重复行已在 cleaner 中合并） */
  dedupedCount: number;
}
