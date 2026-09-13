/**
 * REword · 造句提示词与校验（内置可控，2026-09-12 新增）
 * ------------------------------------------------------------------
 * 与 AI 精读 / 自由对话的用户模板体系（ai-prompt-templates.ts）刻意分离：
 * 造句输出必须是固定 JSON schema（供程序解析入库），因此 prompt 为插件内置常量，
 * 不开放用户编辑；AI 精读自由对话不受本模块限制。
 *
 * 学科约束（英语五大基本句型，每句强制标注）：
 *   SV   主谓        The birds fly.
 *   SVO  主谓宾      I love English.
 *   SVC  主系表      She is a capable leader.
 *   SVOO 双宾        He gave me a book.
 *   SVOC 宾补        We made him monitor.
 * 词性 → 句型倾向（动词按典型搭配框架造）：
 *   v.   按 verb pattern 倾向（give→SVOO、make→SVOC、seem→SVC、fly→SV）
 *   n.   SVO 宾语 / SVC 表语为主
 *   adj. SVC 表语 / SVO 定语为主
 *   adv. SV / SVO 修饰动词
 *   其他（介词/连词等）允许标 phrase 兜底。
 *
 * 纯函数、零运行时依赖（仅类型 import），可被 node:test 直接覆盖。
 */

import type { AiMessage } from "../ai/ai-client.ts";

/** 五大基本句型 + phrase 兜底 */
export const SENTENCE_TYPES = ["SV", "SVO", "SVC", "SVOO", "SVOC", "phrase"] as const;
export type SentenceType = (typeof SENTENCE_TYPES)[number];

/** 默认生成句数（覆盖 2–3 种句型，token 成本可控） */
export const DEFAULT_SENT_N = 3;
/** 句子长度合规区间（词数） */
export const SENT_LEN_MIN = 6;
export const SENT_LEN_MAX = 24;

/** 词性 → 句型倾向提示（拼进 prompt，体现学科专业性） */
export function posBiasHint(pos: string | undefined): string {
  const p = (pos || "").toLowerCase();
  if (/\bv\b|动词/.test(p))
    return "动词：按其典型搭配框架造句（如 give→SVOO 双宾、make→SVOC 宾补、seem→SVC 系表、fly→SV 主谓），优先展示该词最常见的句型。";
  if (/\bn\b|名词/.test(p))
    return "名词：以 SVO（作宾语）或 SVC（作表语）为主，可含定语结构。";
  if (/\badj?\b|形容词/.test(p))
    return "形容词：以 SVC（作表语）和 SVO 结构中的定语为主。";
  if (/\badv?\b|副词/.test(p))
    return "副词：修饰动词，置于 SV / SVO 句中自然位置。";
  return "按该词真实用法选择最自然的句式；若不属于五大句型框架可标 phrase。";
}

/**
 * 组装造句消息对（内置模板，不可被用户模板覆盖）。
 * jsonMode 由调用方在 requestAIGenerate 开启。
 *
 * 2026-09-12：新增可选覆盖项（lenMin/lenMax/posBias/markWord/systemPrompt/
 * extraPrompt/userPrompt），全部经 opts 传入 —— 位置参数一个没动，
 * 既有 4 参调用（test/sentence-gen.test.mjs）行为完全不变。
 * 覆盖值只对**造句链路**生效，绝不读写 AI 精读 / 自由对话的模板体系。
 */
export interface BuildSentenceOpts {
  scenarios?: string[];
  verbPattern?: string;
  lenMin?: number;
  lenMax?: number;
  /** 附加「词性 → 句型倾向」学科提示（默认 true） */
  posBias?: boolean;
  /** 要求目标词用 ** 包裹（默认 true；入库时统一剥掉） */
  markWord?: boolean;
  /** 覆盖内置 system prompt（空 / 未传 = 内置） */
  systemPrompt?: string;
  /** 追加到内置 system prompt 末尾的补充要求（空 / 未传 = 不加） */
  extraPrompt?: string;
  /** 覆盖内置 user 模板，支持 {word} / {n} 占位（空 / 未传 = 内置） */
  userPrompt?: string;
}

export function buildSentenceMessages(
  word: string,
  pos: string,
  meaning: string,
  n: number,
  opts?: BuildSentenceOpts
): AiMessage[] {
  const scenarios = opts?.scenarios?.length ? opts.scenarios.join("、") : "日常、学术";
  const vp = opts?.verbPattern ? `\n动词搭配框架（来自词典）：${opts.verbPattern}` : "";
  const lenMin = opts?.lenMin ?? SENT_LEN_MIN;
  const lenMax = opts?.lenMax ?? SENT_LEN_MAX;
  const usePosBias = opts?.posBias !== false;
  const useMark = opts?.markWord !== false;
  const markClause = useMark
    ? `，并用 ** 包裹加粗（如 It was **plain** that…）`
    : "。";
  // 用户覆盖的 system prompt 优先（整段替换），否则用内置 7 条
  const baseSystem = (opts?.systemPrompt || "").trim();
  const builtin = [
    "你是资深英语教师，为学习者生成高质量例句。",
    "要求：",
    `1) 为单词 ${word}（${pos || "词性未知"}，释义：${meaning || "无"}）造 ${n} 个地道、自然的英文例句。${vp}`,
    `2) ${usePosBias ? posBiasHint(pos) : "按该词真实用法选择最自然的句式。"}`,
    `3) 每句标注句型 sentenceType，取值仅限：SV（主谓）/ SVO（主谓宾）/ SVC（主系表）/ SVOO（双宾）/ SVOC（宾补）/ phrase（非五型兜底）。`,
    `4) 每句附中文翻译 zh、时态 tense（一般现在/一般过去/现在进行/现在完成/一般将来）、场景 scenario（从 ${scenarios} 中选）、难度 cefr（A2/B1/B2/C1，按词句实际难度）。`,
    `5) 句子长度 ${lenMin}-${lenMax} 词；目标词在句中保持原形或常见变形${markClause}`,
    `6) 场景多样，避免生造语境；不同句尽量覆盖不同句型/时态。`,
    `7) 只输出 JSON，不要解释：{"sentences":[{"en":"...","zh":"...","sentenceType":"SVC","tense":"一般过去时","scenario":"日常","cefr":"B1"}]}`,
  ].join("\n");
  const extra = (opts?.extraPrompt || "").trim();
  const system = [baseSystem || builtin, extra].filter(Boolean).join("\n");
  const user = renderUser(opts?.userPrompt, word, n);
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** user 模板渲染（与 sentence-settings.renderSentenceUserPrompt 同语义，此处内联避免循环依赖） */
function renderUser(tpl: string | undefined, word: string, n: number): string {
  const t = (tpl || "").trim();
  if (!t) return `请为单词 ${word} 生成 ${n} 个例句。`;
  return t.replace(/\{word\}/g, word).replace(/\{n\}/g, String(n));
}

/** AI 返回的单句原始结构 */
export interface RawSentenceItem {
  en?: unknown;
  zh?: unknown;
  sentenceType?: unknown;
  tense?: unknown;
  scenario?: unknown;
  cefr?: unknown;
}

/**
 * 解析 AI 输出 JSON（容错：剥 ```json 围栏、截取首尾花括号）。
 * 解析失败返回 null（调用方决定重试/报错）。
 */
export function parseSentenceJson(content: string): RawSentenceItem[] | null {
  let text = (content || "").trim();
  // 剥代码围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // 截取第一个 { 到最后一个 }
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const j = JSON.parse(text.slice(s, e + 1));
    const arr = Array.isArray(j?.sentences) ? j.sentences : Array.isArray(j) ? j : null;
    return arr && arr.length ? arr : null;
  } catch {
    return null;
  }
}

/** 校验后的规整句子 */
export interface ValidatedSentence {
  en: string;
  zh: string;
  sentenceType: SentenceType;
  tense: string;
  scenario: string;
  cefr: string;
}

/** 目标词是否出现在句中（宽松词形匹配：取词干前缀 ≥4 字符或短词全匹配） */
export function containsWord(en: string, word: string): boolean {
  const w = (word || "").toLowerCase().trim();
  if (!w) return false;
  const stem = w.length > 5 ? w.slice(0, Math.max(4, w.length - 2)) : w;
  return new RegExp(`\\b${stem}[a-z]*\\b`, "i").test(en || "");
}

/**
 * 校验并规整：含目标词 / 长度合规 / 句型合法（非法标 phrase）/ 去重。
 * 返回通过校验的句子（可能少于请求数，调用方判断是否重试）。
 *
 * @param bounds 长度区间覆盖（来自造句设置）；不传 = 内置 6–24 词，老调用行为不变
 */
export function validateSentences(
  items: RawSentenceItem[] | null,
  word: string,
  bounds?: { lenMin?: number; lenMax?: number }
): ValidatedSentence[] {
  if (!items) return [];
  const lo = bounds?.lenMin ?? SENT_LEN_MIN;
  const hi = bounds?.lenMax ?? SENT_LEN_MAX;
  const out: ValidatedSentence[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const en = String(it?.en || "").replace(/\*\*/g, "").trim();
    const zh = String(it?.zh || "").trim();
    if (!en || !zh) continue;
    if (!containsWord(en, word)) continue;
    const wc = en.split(/\s+/).length;
    if (wc < lo || wc > hi) continue;
    const key = en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const stRaw = String(it?.sentenceType || "").toUpperCase().trim();
    const sentenceType: SentenceType = (SENTENCE_TYPES as readonly string[]).includes(stRaw)
      ? (stRaw as SentenceType)
      : "phrase";
    out.push({
      en,
      zh,
      sentenceType,
      tense: String(it?.tense || "").trim() || "未标注",
      scenario: String(it?.scenario || "").trim() || "未标注",
      cefr: String(it?.cefr || "").trim().toUpperCase() || "未标注",
    });
  }
  return out;
}

/** 测试辅助 */
export function __resetGenPromptForTest(): void {
  /* 无模块级状态 */
}
