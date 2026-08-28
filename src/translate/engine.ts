/**
 * 翻译引擎编排
 * ------------------------------------------------------------------
 * buildProviders：根据 AI 设置里的引擎配置，组装一条带优先级的 provider 链。
 *   - 2026-08-28：AI 升为链首首选（支持批量，一次请求译 N 段）；
 *     微软 / LibreTranslate 按 translatePriority 排在后面，仅当已配置
 *     key/url 时加入，作为 AI 失败时的兜底。
 *
 * translateWithFallback：依次尝试，返回第一个「成功且译文非空」的结果；
 *   全部失败则返回全空串（provider: "none"）。
 */
import type { Translator, TranslateRequest, TranslateOutcome } from "./types.ts";
import { MicrosoftTranslator } from "./providers/microsoft.ts";
import { LibreTranslator } from "./providers/libretranslate.ts";
import { AiTranslator } from "./providers/ai.ts";
import type { AiTranslateFn, AiTranslateBatchFn } from "./providers/ai.ts";

/** 引擎配置（来自 AiSettings 的翻译相关字段） */
export interface EngineConfig {
  msKey?: string;
  msRegion?: string;
  /** 兜底引擎开关（2026-08-28 默认关闭；AI 恒为首选） */
  msEnabled?: boolean;
  libreUrl?: string;
  libreEnabled?: boolean;
  /** 免费引擎兜底顺序（仅当开关开启且已配置才生效） */
  priority?: string[];
}

/** 引擎依赖（注入自有 AI 翻译函数） */
export interface EngineDeps {
  translateOne: AiTranslateFn;
  /** 批量翻译（可选）：注入后 AI 走「一次请求译 N 段」的批量模式 */
  translateBatch?: AiTranslateBatchFn;
}

/** 组装 provider 链：AI 首选，免费引擎按配置兜底在后 */
export function buildProviders(cfg: EngineConfig, deps: EngineDeps): Translator[] {
  const providers: Translator[] = [];
  // 2026-08-28：AI 首选（批量模式），微软/LibreTranslate 失效场景直接命中
  providers.push(
    new AiTranslator({ translateOne: deps.translateOne, translateBatch: deps.translateBatch })
  );

  const order = Array.isArray(cfg.priority) && cfg.priority.length
    ? cfg.priority
    : ["microsoft", "libretranslate"];

  for (const name of order) {
    if (name === "microsoft" && cfg.msEnabled && cfg.msKey && cfg.msRegion) {
      providers.push(new MicrosoftTranslator(cfg.msKey, cfg.msRegion));
    } else if (name === "libretranslate" && cfg.libreEnabled && cfg.libreUrl) {
      providers.push(new LibreTranslator(cfg.libreUrl));
    }
  }
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
