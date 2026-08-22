/**
 * REword · 文本处理（分句 + 高亮提取）
 * ------------------------------------------------------------------
 * 纯函数集合，不依赖 SiYuan SDK，可在 Node 下直接单测。供 AI 精读编排使用：
 *  - splitSentences：把英文文本稳健拆句（保留 Dr./Mr. 等缩写，兼容中文句号）。
 *  - extractHighlights：从 markdown 中识别用户高亮词（==mark== 与 **bold**，或 __bold__）。
 *  - stripHighlightMarkers：去除高亮标记，得到纯净正文（供 AI 阅读）。
 */

/** 常见英文缩写（结尾句点不应作为句边界） */
const ABBREV = [
  "mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "etc", "inc", "co",
  "ltd", "corp", "mt", "capt", "gen", "col", "sgt", "ph", "no", "vol", "fig",
  "approx", "esq", "rev", "hon", "al", "sq", "ave", "blvd", "dept",
  // 月份 / 星期缩写（去掉大写强约束后仍需保护，避免误切）
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
];

/**
 * 鲁棒分句。
 *  - 句边界：英文 .!? 之后跟随空白即切分；中文 。！？ 后接汉字即断（中文书写无空格）。
 *  - 通过占位符保护高频缩写词尾句点（Mr./Dr./Jan. 等），使其不被当作句边界。
 *  - 不再要求下一句首字母大写——小写开头的句子（banana is...）也应正常切分，避免逐句讲解被合并。
 *  - 支持 Node22 / Chromium 的正则后行断言 (?<!/?<=?)。
 */
export function splitSentences(text: string): string[] {
  if (!text || !text.trim()) return [];

  // 两阶段切分，规避嵌套 / 大小写敏感 lookbehind 的兼容性坑：
  //  阶段 1：用占位符保护「缩写词尾句点」（Mr./Dr./etc.），使它不被当作句边界。
  //  阶段 2：按句终符切分 ——
  //     ① 英文：句终符(.!?)后只要跟随空白即切分（不要求下一句大写开头）；
  //     ② 中文：句终符（。！？）后无空白、直接接汉字即断（中文书写无空格）。
  //  句终符保留在上一句末；最后把占位符还原回句点。
  const PROTECT = "\uE000"; // 私用区占位符（\uE000），正文几乎不可能出现
  const abbrevRe = new RegExp(`\\b(?:${ABBREV.join("|")})\\.`, "gi");
  const protectedText = text.replace(abbrevRe, (m) => m.replace(".", PROTECT));

  const SENT_RE =
    /(?<=[.!?])\s+|(?<=[\u3002\uff01\uff1f])(?=[\u4e00-\u9fff"'’"])/u;

  return protectedText
    .split(SENT_RE)
    .map((p) => p.split(PROTECT).join(".").trim())
    .filter((p) => p.length > 0);
}

export interface HighlightTerm {
  term: string;
  marker: "mark" | "bold" | "italic";
}

/**
 * 从 markdown 文本提取用户高亮词（去重、忽略空白）。
 *  - ==text==    → marker "mark"（思源 ==高亮==）
 *  - **text**    → marker "bold"
 *  - __text__    → marker "bold"
 *  - **text** 或 _text_ → marker "italic"（单个 * 或 _，需边界避免与粗体混淆）
 * 注：点选高亮在富文本模式下已写入 ==mark==，这里统一从文本识别。
 */
export function extractHighlights(markdown: string): HighlightTerm[] {
  const out: HighlightTerm[] = [];
  const seen = new Set<string>();
  const push = (term: string, marker: HighlightTerm["marker"]) => {
    const t = term.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ term: t, marker });
  };

  // ==mark==
  const markRe = /==([^=\n][^=]*?)==/g;
  let m: RegExpExecArray | null;
  while ((m = markRe.exec(markdown))) push(m[1], "mark");

  // **bold** / __bold__
  const boldRe = /(\*\*|__)(?=\S)([\s\S]+?)\1/g;
  while ((m = boldRe.exec(markdown))) push(m[2], "bold");

  // *italic* / _italic_
  const italRe = /(^|[^\*_])([*_])(?=\S)([^*\n][^*_]*?)\2(?!\2)/g;
  while ((m = italRe.exec(markdown))) push(m[3], "italic");

  return out;
}

/**
 * 去除高亮 / 强调标记，得到纯净正文（供 AI 阅读）。
 * 保留换行与基础结构，仅剥离 ==、**__、*_ 标记符号。
 */
export function stripHighlightMarkers(markdown: string): string {
  return (markdown || "")
    .replace(/==([^=\n][^=]*?)==/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]+?)\1/g, "$2")
    .replace(/(^|[^\*_])([*_])(?=\S)([^*\n][^*_]*?)\2(?!\2)/g, "$1$3");
}

/** 在给定文本中找出包含某高亮词的最短句子（用于给重点词附带语境） */
export function findContextSentence(
  term: string,
  sentences: string[]
): string | undefined {
  const lower = term.toLowerCase();
  let best: string | undefined;
  let bestLen = Infinity;
  for (const s of sentences) {
    if (s.toLowerCase().includes(lower)) {
      if (s.length < bestLen) {
        best = s;
        bestLen = s.length;
      }
    }
  }
  return best;
}
