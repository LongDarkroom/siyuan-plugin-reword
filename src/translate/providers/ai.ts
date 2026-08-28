/**
 * 自有 AI 兜底翻译
 * ------------------------------------------------------------------
 * 作为 fallback 链最后一道：当微软 / LibreTranslate 都未配置或失败时，
 * 用插件已配置的 AI 服务逐条翻译。为避免污染 AI 精读面板会话，调用方
 * 应传入一个「不落盘会话、只求译文」的 translateOne 函数（index.ts 中
 * 通过 runCopilotChat 直接补全实现）。
 *
 * 注意：逐条调用吞吐低，仅在兜底场景使用；AI 未配置时 available 为 false，
 * 会被 fallback 链跳过。
 */
import type { Translator, TranslateRequest } from "../types";

/** 单条 AI 翻译函数：输入原文 + 源/目标语言，输出译文（可为空串） */
export type AiTranslateFn = (text: string, from: string, to: string) => Promise<string>;

export class AiTranslator implements Translator {
  readonly name = "ai" as const;

  constructor(private translateOne: AiTranslateFn) {}

  get available(): boolean {
    return typeof this.translateOne === "function";
  }

  async translate(req: TranslateRequest): Promise<string[]> {
    const out: string[] = [];
    for (const t of req.texts) {
      try {
        out.push((await this.translateOne(t, req.from, req.to)) || "");
      } catch {
        out.push("");
      }
    }
    return out;
  }
}
