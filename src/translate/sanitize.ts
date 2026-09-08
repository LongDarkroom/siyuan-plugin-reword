/**
 * 译文净化器（2026-09-05）
 * ------------------------------------------------------------------
 * 背景：缓存里混入了早期 AI 引擎的「解说体」输出——
 *   "**翻译：** …\n\n**重点词组解释：**\n- **can**：…" 整段被原样存进缓存，
 *   渲染层见空行走 lute 富文本，段落下挂多行解说块，排版杂乱。
 * 另有历史分段粒度变更遗留的多行块状译文。
 *
 * 本模块把任意译文规整为「整洁单行」：
 *   1. 截断解释区（重点词组解释 / 说明 / 注 / 分隔线…）；
 *   2. 剥 Markdown 脚手架（** 加粗、行首 #、列表符、反引号）；
 *   3. 提取「…的中文翻译是：」后的翻译主体；
 *   4. 删行内（注：…）夹注；
 *   5. 行整理：去空行、去相邻重复行，合并为单行。
 *
 * 铁律：任何一步都不能把译文变空——结果为空时一律回退原文输入。
 */

/** 解释区起始标记：行首出现即截断其后全部内容（短标记必须带冒号，防误伤「注意…」「说明书…」） */
const CUT_MARKERS = [
  "重点词组解释",
  "重点解释",
  "重点词组",
  "难词解释",
  "难词解析",
  "词汇解析",
  "词组解析",
  "词汇讲解",
  "语言点",
  "语法解析",
  "语法讲解",
  "用法解析",
  "用法说明",
  "翻译解析",
  "翻译说明",
  "重点难点",
  "词汇注释",
  "解释：",
  "解释:",
  "注释：",
  "注释:",
  "说明：",
  "说明:",
  "注：",
  "注:",
  "备注：",
  "备注:",
];

/** 行中解释区标记（前面须是句末标点/引号/空白）：「…。 解释：xxx」→ 截断其后 */
const MID_CUT_RE = /(?<=[。！？…”"'\s])(?:解释|注解|说明|备注)[：:]/;

/** 行中遗留的「翻译：」类前缀（剥掉前缀、保留其后译文） */
const LABEL_PREFIX_RE = /^\s*(?:\*\*)?\s*(?:中文翻译|参考译文|翻译|译文|中译)\s*(?:：|:)\s*(?:\*\*)?\s*/;

/** 整行都是标题性标记（剥离该行，不影响其余内容） */
const LABEL_LINE_RE = /^\s*(?:\*\*)?\s*(?:翻译|译文|参考译文|中文|中译)\s*(?:：|:)?\s*(?:\*\*)?\s*$/;

/** 分隔线：--- / *** / ___ */
const HR_LINE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** 行内夹注：（注：…） / (注：…) / （见…）不做，只删「注」类 */
const INLINE_NOTE_RE = /[（(]\s*(?:注|note)\s*[：:][^）)]*[）)]/gi;

/** 「…的中文翻译是：」「翻译如下：」等提取标记（命中后只保留标记之后的内容） */
const EXTRACT_RE = /(?:的)?(?:中文)?翻译(?:是|如下|为)[：:]/;

/** 剥单行 Markdown 脚手架：加粗、行首标题、行首列表符、行内代码反引号 */
function stripMdLine(line: string): string {
  let s = line;
  s = s.replace(/\*\*([^*]*)\*\*/g, "$1"); // **x** → x
  s = s.replace(/^\s{0,3}#{1,6}\s+/, ""); // 行首标题
  s = s.replace(/^\s{0,3}[-*+]\s+/, ""); // 行首无序列表符
  s = s.replace(/^\s{0,3}\d+\.\s+/, ""); // 行首有序列表符
  s = s.replace(/`([^`]*)`/g, "$1"); // `x` → x
  s = s.replace(/\*([^*\n]+)\*/g, "$1"); // 剩余单星斜体
  return s;
}

/** 去掉包裹整段的引号对（“…” / "…" / 「…」仅当引号包住全部内容时） */
function stripWrappingQuotes(s: string): string {
  const t = s.trim();
  const pairs: Array<[string, string]> = [["“", "”"], ["\"", "\""], ["「", "」"], ["『", "』"]];
  for (const [l, r] of pairs) {
    if (t.length >= 2 && t.startsWith(l) && t.endsWith(r)) {
      return t.slice(1, -1).trim();
    }
  }
  return t;
}

/**
 * 把任意译文规整为整洁单行。
 * - 输入已是纯文本（无换行、无标记）时原样返回（快路径）。
 * - 任何情况下不返回空串：净化结果为空则回退输入。
 */
export function sanitizeTranslation(raw: string): string {
  const input = (raw || "").replace(/\r\n?/g, "\n").trim();
  if (!input) return "";
  // 快路径：单行且无任何脚手架特征
  if (!input.includes("\n") && !/[*#`]|翻译|：/.test(input)) return input;

  let text = input;

  // 1) 「…的中文翻译是：」型：只保留标记之后的内容
  const m = text.match(EXTRACT_RE);
  const extracted = !!m;
  if (m && m.index !== undefined) {
    text = text.slice(m.index + m[0].length);
  }

  // 1.5) 行中解释区：「…垃圾。 解释：mole：此处指…」→ 译文后直接跟解说，截断
  const mid = text.match(MID_CUT_RE);
  if (mid && mid.index !== undefined) {
    text = text.slice(0, mid.index);
  }

  // 2) 逐行剥 Markdown + 行内「翻译：」前缀，并在解释区标记处截断
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    let stripped = stripMdLine(line).trim();
    if (HR_LINE_RE.test(stripped)) break; // 分隔线之后全是解释区
    if (LABEL_LINE_RE.test(line)) continue; // 整行「翻译：」标题剥离
    stripped = stripped.replace(LABEL_PREFIX_RE, "").trim();
    if (!stripped) continue;
    if (CUT_MARKERS.some((k) => stripped.startsWith(k))) break;
    kept.push(stripped);
  }
  // 截断把内容削没了（比如恰好整个值都是解释区）→ 回退原始输入逐行
  const base = kept.length ? kept : lines.map(stripMdLine).map((s) => s.trim()).filter(Boolean);

  // 3) 删行内夹注 + 相邻重复行去重；提取型只保留翻译主体首行（其后的「也可以说…」是冗余）
  const out: string[] = [];
  for (const l of base) {
    const cleaned = l.replace(INLINE_NOTE_RE, "").trim();
    if (!cleaned) continue;
    if (out.length && out[out.length - 1] === cleaned) continue;
    out.push(cleaned);
    if (extracted) break;
  }

  // 4) 合并为单行
  let result = out.join(" ").replace(/\s{2,}/g, " ").trim();
  // 整体被引号包住且内部还有引号时保留原样；仅去一层包裹引号
  if (result) result = stripWrappingQuotesUnquoted(result);
  // 兜底：净化结果为空 → 回退输入（绝不产生空译文）
  if (!result) return input.trim();
  return result;
}

/** 仅当剥掉包裹引号后剩余内容非空时才剥（防止把 “他说。” 这类剥成 他说。） */
function stripWrappingQuotesUnquoted(s: string): string {
  const stripped = stripWrappingQuotes(s);
  return stripped ? stripped : s.trim();
}
