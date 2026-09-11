/**
 * AI 精读 · 本地后校验（2026-09-06 第 4 批 P1-B 第 3 层）
 * ------------------------------------------------------------------
 * 把 AI 返回的句子/词/引文与原文逐字比对（纯本地字符串操作，零额外 AI 调用），
 * 把「胡言乱语」在 UI 上显形而不是静默通过。
 *
 * 校验项：
 *  - sentence 是否逐字出现在原文（归一化空白后 indexOf；大小写差异放行——
 *    句首大写/专有名词大小写是模型常见行为，不算编造）
 *  - word 是否出现在原文（大小写不敏感）
 *  - quote（词的出处短句）是否逐字出现在原文；不符 → 清空该字段，不渲染
 *  - translation 为空 / 与 sentence 完全相同（直通作弊）→ 标记
 *
 * 严格模式（deepReadVerify = "strict"）下，被标记的词不自动写入词库。
 * 这层是 copilot 完全没有的——精读的正确性可机械验证（原文就在手边）。
 */
import type { DeepReadIssue, DeepReadResult } from "./ai-orchestrator.ts";
import { t as T } from "../i18n/index.ts";

/** 归一化：折叠所有空白为单空格、去首尾（「逐字比对」的统一口径） */
export function normText(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

export interface VerifyOptions {
  /** 预处理分句（用于为 sentence 派生 ordinal 回链序号，1-based） */
  sentences?: string[];
}

export interface VerifyOutcome {
  issues: DeepReadIssue[];
  /** 被标记「未见于原文」的词（原词大小写，strict 模式下不入词库） */
  flaggedWords: Set<string>;
  /** 是否清空/改写过字段（quote 清空、ordinal 派生不计） */
  mutated: boolean;
}

/**
 * 校验并就地修正一个结构化精读结果。
 * 仅处理 isJson=true 的结果；sourceText 为空时跳过全部比对（无从校验）。
 */
export function verifyDeepReadResult(
  result: DeepReadResult,
  sourceText: string,
  opts?: VerifyOptions
): VerifyOutcome {
  const outcome: VerifyOutcome = { issues: [], flaggedWords: new Set(), mutated: false };
  if (!result?.isJson || !sourceText || !sourceText.trim()) return outcome;

  const haystack = normText(sourceText);
  const haystackLoose = haystack.toLowerCase();

  // ── 逐句：原文逐字比对 + ordinal 派生 ──
  const refSentences = (opts?.sentences || []).map((s) => normText(s));
  for (const s of result.sentences || []) {
    const t = normText(s.sentence);
    if (!t) continue;
    if (!haystack.includes(t) && !haystackLoose.includes(t.toLowerCase())) {
      outcome.issues.push({ kind: "sentence", target: t.slice(0, 60), reason: T("与原文不符（未逐字出现）") });
    }
    // ordinal：AI 未给时，按预处理分句定位（回链定位用，1-based）
    if (s.ordinal == null && refSentences.length) {
      const idx = refSentences.findIndex((r) => r === t || r.toLowerCase() === t.toLowerCase());
      if (idx >= 0) s.ordinal = idx + 1;
    }
    // 翻译直通作弊：为空或与原句完全相同
    const tr = normText(s.translation || "");
    if (!tr) {
      outcome.issues.push({ kind: "translation", target: t.slice(0, 40), reason: T("翻译为空") });
    } else if (tr === t || tr.toLowerCase() === t.toLowerCase()) {
      outcome.issues.push({ kind: "translation", target: t.slice(0, 40), reason: T("翻译与原句相同（未翻译）") });
    }
  }

  // ── 逐词：见於原文 + 出处引文逐字比对 ──
  for (const w of result.words || []) {
    const word = (w.word || "").trim();
    if (!word) continue;
    if (!haystackLoose.includes(word.toLowerCase())) {
      outcome.flaggedWords.add(word);
      outcome.issues.push({ kind: "word", target: word, reason: T("未见于原文") });
    }
    // 引文（quote / context，normalize 已合并到 context）：不符 → 清空不渲染
    const q = normText(w.context || "");
    if (q && !haystack.includes(q) && !haystackLoose.includes(q.toLowerCase())) {
      w.context = undefined;
      outcome.mutated = true;
      outcome.issues.push({ kind: "quote", target: q.slice(0, 60), reason: T("引文与原文不符，已隐去") });
    }
  }

  return outcome;
}
