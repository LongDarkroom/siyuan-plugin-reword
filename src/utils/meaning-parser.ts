/**
 * 复习卡片释义清洗解析器
 *
 * 词库中 `meaning` 字段可能来自：
 * 1. AI 精读直出（常带编号、例句、音标等噪声）
 * 2. 词典 fallback 纯文本（如 passive¹/'pæsɪv/adj.1.(submissive)顺从的；听之任之的…）
 * 3. 已干净的结构化拼接（1. 顺从的 2. 听之任之的）
 *
 * 本模块把任意上述格式归一化为「词性 + 最多 3 条中文释义」，供复习卡片简洁展示。
 */

const KNOWN_POS_BASE = [
  "adj", "adv", "n", "v", "vt", "vi", "prep", "conj", "pron", "art", "num",
  "int", "interj", "modal", "auxv", "phr", "abbr", "det",
];

// 词性标签（含 v.i. / vt. / v.t. / v.i. / a. / ad. 等变体），忽略大小写。
// a. / ad. 必须带点，避免把普通英文冠词/单词前缀误判为词性。
const POS_TAG_RE = `(?:${[
  ...KNOWN_POS_BASE,
  "a\\.", "ad\\.",
].join("|")})`;

// 从文本中提取词性：允许词性后出现数字编号（如 adj.1. / n.1.）
const POS_EXTRACT_RE = new RegExp(
  `(?:^|[\\s/.,；()（）])(${POS_TAG_RE})(?=[\\s/.,；()（）0-9①②③④⑤⑥⑦⑧⑨⑩]|$)`,
  "i"
);

const POS_NORMALIZE: Record<string, string> = {
  "adj": "adj.", "a": "adj.", "a.": "adj.",
  "adv": "adv.", "ad": "adv.", "ad.": "adv.",
  "n": "n.", "noun": "n.",
  "v": "v.", "verb": "v.",
  "vt": "vt.", "v.t.": "vt.", "vt.": "vt.",
  "vi": "vi.", "v.i.": "vi.", "vi.": "vi.",
  "prep": "prep.",
  "conj": "conj.",
  "pron": "pron.",
  "art": "art.",
  "num": "num.",
  "int": "int.", "interj": "int.",
  "modal": "modal.",
  "auxv": "auxv.",
  "phr": "phr.", "phrase": "phr.",
  "abbr": "abbr.",
  "det": "det.",
};

export function normalizePos(pos: string): string {
  const key = pos.toLowerCase().replace(/\./g, "");
  return POS_NORMALIZE[key] || (pos.endsWith(".") ? pos : pos + ".");
}

function stripHtmlEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ");
}

function hasChinese(s: string): boolean {
  return /[\u4e00-\u9fa5]/.test(s);
}

function isMostlyChinese(s: string): boolean {
  const visible = s.replace(/\s/g, "");
  if (!visible) return false;
  const zh = (visible.match(/[\u4e00-\u9fa5]/g) || []).length;
  return zh / visible.length >= 0.5;
}

function isEnglishSentence(s: string): boolean {
  const t = s.trim();
  if (!t || hasChinese(t)) return false;
  const letters = (t.match(/[a-zA-Z]/g) || []).length;
  return letters / t.length > 0.5 && t.length > 10;
}

function cleanSense(s: string): string {
  return s
    // 英文简释 (submissive) / [cheerful] / <贬>
    .replace(/\([^)]{0,60}\)/g, " ")
    .replace(/\[[^\]]{0,60}\]/g, " ")
    .replace(/<[^>]{0,60}>/g, " ")
    // 编号与词性残留（全局）
    .replace(new RegExp(`\\b${POS_TAG_RE}\\b`, "gi"), " ")
    .replace(/\b\d+\b/g, " ")
    // 例句标记
    .replace(/例：/g, " ")
    .replace(/\beg\b/gi, " ")
    .replace(/\be\.g\.\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[；;，,、\.\s]+|[；;，,、\.\s]+$/g, "")
    .trim();
}

export interface ParsedMeaning {
  /** 归一化词性，如 "adj." / "n."；未识别为空串 */
  pos: string;
  /** 清洗后的中文释义，最多 3 条 */
  senses: string[];
  /** 原始文本（供 debug / hover 查看） */
  raw: string;
}

/**
 * 把任意脏 meaning 字符串解析为复习卡片需要的简洁结构。
 * @param raw 原始 meaning（可能含音标/词性/编号/英文例句/中文释义）
 * @param fallbackPos 外部已解析出的词性（如 WordRecord.pos），当 raw 内未识别到词性时使用
 */
/**
 * 结构化单词表解析：把用户在思源笔记中整理的 `word pos 释义` 列表
 * 解析为干净的单词条目（词性归一化、释义原样保留）。
 *
 * 支持格式：
 *   1) word POS meaning   例: literature n 文学，文献，文学作品
 *                          presently adv . 不久，目前（POS 后可带空格+点）
 *   2) word — meaning     例: cock — 公鸡
 *   3) word meaning       例: boss 老板（无词性，释义含中文）
 *   4) 列表块前缀自动剥离（- / * / • / 数字. ）
 *
 * 仅当该行可识别为「单词 + 释义」结构时才产出 entry；无法识别的行进入 warnings，
 * 由调用方（showVocabImportDialog / handleReviewDrop）结合 isWordListLike 决定是否走结构化导入。
 */
export interface ParsedWordListEntry {
  word: string;
  pos: string;
  meaning: string;
  raw: string;
  lineNum: number;
}

const WORDLIST_POS_SET = new Set<string>([
  ...KNOWN_POS_BASE, "a", "ad", "noun", "verb",
]);

function isWordListPos(s: string): boolean {
  const p = s.replace(/\.$/, "").toLowerCase();
  return WORDLIST_POS_SET.has(p);
}

export function parseWordList(text: string): { entries: ParsedWordListEntry[]; warnings: string[] } {
  const lines = (text || "").split(/\r?\n/);
  const entries: ParsedWordListEntry[] = [];
  const warnings: string[] = [];
  const WORD_RE = /^([A-Za-z\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5'’.\-]*)\s+(\S+?)(?:\.\s*|\s+)(.+)$/;
  const DASH_RE = /^([A-Za-z\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5'’.\-]*)\s*[—\-–]\s*(.+)$/;
  const SPACE_RE = /^([A-Za-z\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5'’.\-]*)\s+(.+)$/;
  lines.forEach((rawLine, idx) => {
    const line = rawLine.replace(/^\s*(?:[-*•]\s*|\d+[.、)]\s*)/, "").trim();
    if (!line) return;
    // ① word POS meaning
    const m = line.match(WORD_RE);
    if (m) {
      const word = m[1];
      const maybePos = m[2];
      const rest = m[3];
      if (isWordListPos(maybePos)) {
        const meaning = rest.trim();
        if (meaning) {
          entries.push({ word, pos: normalizePos(maybePos), meaning, raw: rawLine, lineNum: idx + 1 });
          return;
        }
      }
      // 词性未识别 → 当作「word meaning」（无词性），要求释义含中文以免把散文误判为单词
      const meaning = (maybePos + " " + rest).trim();
      if (hasChinese(meaning)) {
        entries.push({ word, pos: "", meaning, raw: rawLine, lineNum: idx + 1 });
      } else {
        warnings.push(`第 ${idx + 1} 行无法识别为单词表条目：${rawLine}`);
      }
      return;
    }
    // ② word — meaning / word 释义（无词性）
    const m2 = line.match(DASH_RE) || line.match(SPACE_RE);
    if (m2) {
      const meaning = m2[2].trim();
      if (hasChinese(meaning)) {
        entries.push({ word: m2[1], pos: "", meaning, raw: rawLine, lineNum: idx + 1 });
      } else {
        warnings.push(`第 ${idx + 1} 行无法识别为单词表条目：${rawLine}`);
      }
      return;
    }
    warnings.push(`第 ${idx + 1} 行无法识别为单词表条目：${rawLine}`);
  });
  return { entries, warnings };
}

/** 文本是否像「结构化单词表」：≥3 条可解析，或全部非空行均可解析 */
export function isWordListLike(text: string): boolean {
  const { entries } = parseWordList(text);
  if (entries.length >= 3) return true;
  const nonEmpty = (text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length;
  return nonEmpty > 0 && entries.length === nonEmpty;
}

export function parseReviewMeaning(raw: string, fallbackPos = ""): ParsedMeaning {
  const origin = (raw || "").replace(/\u0000/g, "");
  if (!origin.trim()) return { pos: normalizePos(fallbackPos), senses: [], raw: "" };

  let text = stripHtmlEntities(origin);

  // 1) 提取词性（允许词性后紧跟数字编号）
  //    仅当词性之后还有释义内容时才采用，避免 "adj." 这类纯词性串被误判为有词性。
  let pos = "";
  const posMatch = text.match(POS_EXTRACT_RE);
  if (posMatch) {
    const candidate = posMatch[1].replace(/\./g, "").trim();
    const rest = text.slice(posMatch.index! + posMatch[0].length).trim();
    if (candidate && rest) {
      pos = normalizePos(candidate);
    }
  }
  if (!pos && fallbackPos) pos = normalizePos(fallbackPos);

  // 2) 移除头部「单词形变+音标+词性」噪声。
  //    顺序：单词 -> 音标 -> 词性（避免把词性一起删掉导致 fallback 失效）
  text = text.replace(/^\s*[A-Za-z][A-Za-z0-9·'¹²³⁴⁵⁶⁷⁸⁹⁰-]{0,50}\b\s*/, " ");
  text = text.replace(/^\s*\/[^/]+\/\s*/, " ");
  text = text.replace(new RegExp(`^\\s*${POS_TAG_RE}\\.?\\s*`, "i"), " ");

  // 3) 切分义项：优先按编号，无编号则按分号
  const markerRe = /(?:^|\s)((?:\d+)\.|①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩)/g;
  const markers: { idx: number; num: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(text))) {
    markers.push({ idx: m.index + m[0].indexOf(m[1]), num: m[1] });
  }

  const chunks: string[] = [];
  if (markers.length >= 1) {
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].idx + markers[i].num.length;
      const end = i + 1 < markers.length ? markers[i + 1].idx : text.length;
      chunks.push(text.slice(start, end));
    }
  } else {
    chunks.push(...text.split(/[；;]/).filter((s) => s.trim()));
  }

  // 4) 逐条清洗，并截断 trailing 英文例句
  let senses = chunks
    .map((chunk) => {
      let s = chunk;
      // 截断尾随英文例句（如 "His passive attitude made things easier."）
      const enTailMatch = s.match(/([.!?…][a-zA-Z\s,;'"-]{10,})$/);
      if (enTailMatch && isEnglishSentence(enTailMatch[1])) {
        s = s.slice(0, s.length - enTailMatch[1].length).trim();
      }
      // 中英混合且英文在后：保留最前中文片段
      if (hasChinese(s) && !isMostlyChinese(s)) {
        const zhRunRe = /[\u4e00-\u9fa5][\u4e00-\u9fa5，、；：]*/;
        const hit = s.match(zhRunRe);
        if (hit) s = hit[0];
      }
      return cleanSense(s);
    })
    .filter((s) => s.length >= 1);

  // 5) 兜底：若为空但原文含中文，整段作为一条
  if (senses.length === 0 && hasChinese(text)) {
    let fallback = text;
    const enTailMatch = fallback.match(/([.!?…][a-zA-Z\s,;'"-]{10,})$/);
    if (enTailMatch && isEnglishSentence(enTailMatch[1])) {
      fallback = fallback.slice(0, fallback.length - enTailMatch[1].length);
    }
    fallback = cleanSense(fallback);
    if (fallback) senses.push(fallback);
  }

  // 6) 合并被分号切得过碎的近义释义（如 "顺从的；听之任之的"）
  const merged: string[] = [];
  for (const s of senses) {
    if (merged.length && /[；;]$/.test(merged[merged.length - 1])) {
      merged[merged.length - 1] = merged[merged.length - 1].replace(/[；;]$/, "") + "；" + s;
    } else {
      merged.push(s);
    }
  }
  senses = merged.map(cleanSense).filter(Boolean);

  return { pos, senses: senses.slice(0, 3), raw: origin };
}
