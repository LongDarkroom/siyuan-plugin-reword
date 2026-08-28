/**
 * 翻译引擎编排
 * ------------------------------------------------------------------
 * buildProviders：根据 AI 设置里的引擎配置，组装一条带优先级的 provider 链。
 *   - 微软 / LibreTranslate 按 translatePriority 排序（仅当已配置 key/url）。
 *   - 自有 AI 永远作为最后兜底（不进 priority 列表）。
 *
 * translateWithFallback：依次尝试，返回第一个「成功且译文非空」的结果；
 *   全部失败则返回全空串（provider: "none"）。
 */
import type { Translator, TranslateRequest, TranslateOutcome } from "./types";
import { MicrosoftTranslator } from "./providers/microsoft";
import { LibreTranslator } from "./providers/libretranslate";
import { AiTranslator, AiTranslateFn } from "./providers/ai";

/** 引擎配置（来自 AiSettings 的翻译相关字段） */
export interface EngineConfig {
  msKey?: string;
  msRegion?: string;
  libreUrl?: string;
  /** 免费引擎优先级（AI 永远兜底，不在此列） */
  priority?: string[];
}

/** 引擎依赖（注入自有 AI 兜底函数） */
export interface EngineDeps {
  translateOne: AiTranslateFn;
}

/** 组装 provider 链：免费引擎按优先级在前，AI 兜底在末 */
export function buildProviders(cfg: EngineConfig, deps: EngineDeps): Translator[] {
  const order = Array.isArray(cfg.priority) && cfg.priority.length
    ? cfg.priority
    : ["microsoft", "libretranslate"];

  const providers: Translator[] = [];
  for (const name of order) {
    if (name === "microsoft" && cfg.msKey && cfg.msRegion) {
      providers.push(new MicrosoftTranslator(cfg.msKey, cfg.msRegion));
    } else if (name === "libretranslate" && cfg.libreUrl) {
      providers.push(new LibreTranslator(cfg.libreUrl));
    }
  }
  // 自有 AI 永远作为最后兜底
  providers.push(new AiTranslator(deps.translateOne));
  return providers;
}

/** 按顺序尝试 providers，返回首个成功且译文非空的结果 */
export async function translateWithFallback(
  providers: Translator[],
  req: TranslateRequest,
  opts?: { onTry?: (name: string) => void }
): Promise<TranslateOutcome> {
  let lastErr: unknown;
  for (const p of providers) {
    if (!p.available) continue;
    try {
      opts?.onTry?.(p.name);
      const texts = await p.translate(req);
      const ok =
        Array.isArray(texts) &&
        texts.length === req.texts.length &&
        texts.some((t) => t && t.trim());
      if (ok) return { texts, provider: p.name };
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    // eslint-disable-next-line no-console
    console.warn("[REword] 全部翻译引擎失败:", lastErr);
  }
  return { texts: req.texts.map(() => ""), provider: "none" };
}
