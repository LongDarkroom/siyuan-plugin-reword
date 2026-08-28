/**
 * 自有 AI 首选翻译
 * ------------------------------------------------------------------
 * 2026-08-28 重设计：AI 从「兜底」升级为「首选」引擎（微软 /
 * LibreTranslate 已失效场景下直接命中，省去无效探测）。
 *
 * 支持两种工作模式：
 *  - 批量（首选）：调用方注入 translateBatch（一次请求译 N 段，
 *    [[序号]] 对齐回传），吞吐高、成本低；
 *  - 逐段（兜底）：批量未注入或批量整体失败时，退回 translateOne
 *    逐条调用，保证可用性。
 *
 * parseNumberedTranslations 为纯函数，供批量解析与单测复用。
 */
import type { Translator, TranslateRequest } from "../types.ts";

/** 单条 AI 翻译函数：输入原文 + 源/目标语言，输出译文（可为空串） */
export type AiTranslateFn = (text: string, from: string, to: string) => Promise<string>;

/** 批量 AI 翻译函数：输入同序文本数组，输出同序同长译文数组 */
export type AiTranslateBatchFn = (texts: string[], from: string, to: string) => Promise<string[]>;

export interface AiTranslatorDeps {
  translateOne?: AiTranslateFn;
  translateBatch?: AiTranslateBatchFn;
}

export class AiTranslator implements Translator {
  readonly name = "ai" as const;

  private deps: AiTranslatorDeps;

  constructor(deps: AiTranslatorDeps) {
    this.deps = deps;
  }

  get available(): boolean {
    return (
      typeof this.deps.translateBatch === "function" ||
      typeof this.deps.translateOne === "function"
    );
  }

  async translate(req: TranslateRequest): Promise<string[]> {
    // ① 批量优先：一次请求译整批（内部自行分桶），失败退逐段
    if (typeof this.deps.translateBatch === "function") {
      try {
        const out = await this.deps.translateBatch(req.texts, req.from, req.to);
        if (Array.isArray(out) && out.length === req.texts.length) return out;
      } catch {
        /* 落到逐段兜底 */
      }
    }
    // ② 逐段兜底：简单可靠，仅在小批量 / 批量失败时承担成本
    if (typeof this.deps.translateOne === "function") {
      const out: string[] = [];
      for (const t of req.texts) {
        try {
          out.push((await this.deps.translateOne(t, req.from, req.to)) || "");
        } catch {
          out.push("");
        }
      }
      return out;
    }
    return req.texts.map(() => "");
  }
}

/**
 * 解析 [[序号]] 译文块（批量翻译的回传对齐）。
 * 兼容模型输出中序号块之间的空行 / 多余空白；译文为空的序号不返回，
 * 由调用方对缺失序号做逐段兜底。
 */
export function parseNumberedTranslations(content: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  if (!content) return out;
  const re = /\[\[(\d{1,4})\]\]([\s\S]*?)(?=\[\[\d{1,4}\]\]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const idx = parseInt(m[1], 10);
    const text = (m[2] || "").trim();
    if (idx > 0 && text) out.push([idx, text]);
  }
  return out;
}

/**
 * 位置兜底解析：当模型未遵守 [[序号]] 格式（返回纯译文 / 1. 2. 编号）时，
 * 把原文按空行（退化按换行）切分并顺序回填到 1..N，避免整批译文因格式不符而全丢。
 * 仅在 parseNumberedTranslations 命中 0 对时调用。
 */
export function parseTranslationsPositional(content: string, count: number): Array<[number, string]> {
  const raw = (content || "").trim();
  if (!raw || count <= 0) return [];
  const strip = (s: string) =>
    s.replace(/^\[\[\d{1,4}\]\]\s*/gm, "").replace(/^\s*\d{1,4}[\.、)]\s*/gm, "").trim();
  let parts = raw.split(/\n{2,}/).map(strip).filter(Boolean);
  if (parts.length < Math.min(2, count)) {
    parts = raw.split(/\n+/).map(strip).filter(Boolean);
  }
  const out: Array<[number, string]> = [];
  for (let i = 0; i < Math.min(count, parts.length); i++) out.push([i + 1, parts[i]]);
  return out;
}

