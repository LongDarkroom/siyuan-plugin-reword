/**
 * 翻译批处理核心（R0 地基 · 行为保持不变的重构）
 * ---------------------------------------------------------------
 * index.ts 的 translateBatch / translateBatchDetailed 原为近乎完全
 * copy-paste 的双胞胎（仅返回值不同，双改必漂移）。本模块抽取公共
 * 核心 runTranslate：缓存查询 → 引擎链 fallback → 写侧净化 → 写回
 * 缓存 → 用量统计。宿主能力（缓存/AI/用量/配额提示）由 deps 注入，
 * run 层零插件状态、可独立单测。
 *
 * 行为对齐原实现：
 * - overwrite 时跳过缓存，全部当作未命中重新翻译；
 * - 引擎链为空 → 配额耗尽提示后原样返回（已命中缓存照常返回）；
 * - 引擎返回经 sanitizeTranslation 规整后才入缓存（拦截「AI 解说体」）；
 * - 空译文不入缓存（pairs 只收非空）；
 * - 用量按实际命中引擎分流（tencent/baidu/youdao/ai）。
 */
import { getLogger } from "../core/logger.ts";
import { buildProviders, translateWithFallback, type EngineConfig } from "./engine.ts";
import { sanitizeTranslation } from "./sanitize.ts";
import { DEFAULT_TRANSLATION_MODE, type TranslationCache, type TranslationMode } from "./cache.ts";

const DEBUG_TRANSLATE = false;
function trLog(...args: unknown[]): void {
  if (DEBUG_TRANSLATE) console.log("[REword]", ...args);
}

export interface TranslateBatchMeta {
  title?: string;
  author?: string;
  language?: string;
  toc?: string;
}

export interface TranslateBatchOpts {
  model?: string;
  overwrite?: boolean;
  signal?: AbortSignal;
  mode?: TranslationMode;
  engine?: string;
}

export interface TranslateRunResult {
  texts: string[];
  /** 每段来源：命中缓存为 "cache"，引擎译出为 provider 名，空译为 null */
  providers: (string | null)[];
  fromCache: boolean[];
}

/** runTranslate 宿主依赖（插件实例注入，run 层不持有状态） */
export interface TranslateRunDeps {
  /** 日志前缀（"translateBatch" / "translateBatchDetailed"） */
  tag: string;
  cache: Pick<TranslationCache, "getBatch" | "setBatch">;
  aiSettings: EngineConfig;
  aiTranslateText: (text: string, from: string, to: string, bookId?: string) => Promise<string>;
  aiTranslateBatch: (
    texts: string[],
    from: string,
    to: string,
    bookId: string | undefined,
    ctxBefore: (string | null)[] | undefined,
    meta: TranslateBatchMeta | null,
    opts: TranslateBatchOpts | undefined,
  ) => Promise<string[]>;
  /** 用量预警（黄色，宿主侧节流） */
  warnUsage(): void;
  /** 配额耗尽提示（红色，宿主侧去重） */
  notifyQuotaExhausted(): void;
  /** 按实际命中引擎累计用量并持久化 */
  recordUsage(provider: string | undefined, submitChars: number, mode: TranslationMode): Promise<void>;
}

export interface TranslateRunRequest {
  texts: string[];
  from: string;
  to: string;
  bookId: string;
  ctxBefore?: (string | null)[];
  meta?: TranslateBatchMeta | null;
  opts?: TranslateBatchOpts;
}

/**
 * 批量翻译公共核心：先查按书缓存，未命中走引擎链，写侧净化后回写缓存。
 * 返回恒为 { texts, providers, fromCache }（translateBatch 取 texts 即旧行为）。
 */
export async function runTranslate(
  deps: TranslateRunDeps,
  req: TranslateRunRequest,
): Promise<TranslateRunResult> {
  const { texts, from, to, bookId, ctxBefore, meta, opts } = req;
  if (!Array.isArray(texts) || texts.length === 0) {
    return { texts: [], providers: [], fromCache: [] };
  }
  const mode: TranslationMode = opts?.mode ?? DEFAULT_TRANSLATION_MODE;
  const out: string[] = new Array(texts.length).fill("");
  const providers: (string | null)[] = new Array(texts.length).fill(null);
  const fromCache: boolean[] = new Array(texts.length).fill(false);

  // 1) 查缓存（按书 + 模式）；overwrite 时跳过缓存全部重译
  const { hits, misses, fromCache: hitFlags } = opts?.overwrite
    ? { hits: {} as Record<number, string>, misses: texts.map((_, i) => i), fromCache: texts.map(() => false) }
    : await deps.cache.getBatch(bookId, texts, mode);
  for (let i = 0; i < texts.length; i++) fromCache[i] = hitFlags[i];
  for (const k in hits) {
    out[+k] = hits[k];
    providers[+k] = "cache";
  }
  trLog(`${deps.tag}: 缓存命中 ${Object.keys(hits).length}, 未命中 ${misses.length}/${texts.length}${opts?.overwrite ? " (覆盖缓存)" : ""}`);

  // 2) 未命中部分走引擎链（免费引擎在前、AI 兜底在后）
  if (misses.length) {
    const reqTexts = misses.map((i) => texts[i]);
    // 前文参考与 misses 对齐（每个未命中索引对应的前文段）
    const reqCtx = ctxBefore ? misses.map((i) => (ctxBefore[i] ? ctxBefore[i] : null)) : undefined;
    try {
      deps.warnUsage();
      const chain = buildProviders(deps.aiSettings, {
        translateOne: (t, f, t2, bid) => deps.aiTranslateText(t, f, t2, bid),
        translateBatch: (ts, f, t2, bid) =>
          deps.aiTranslateBatch(ts, f, t2, bid, reqCtx, meta ?? null, { ...opts, mode }),
      }, opts?.engine);
      if (chain.length === 0) {
        deps.notifyQuotaExhausted();
        return { texts: out, providers, fromCache };
      }
      trLog(`${deps.tag}: ${chain.length} 个引擎, 调用 translateWithFallback...`);
      const res = await translateWithFallback(chain, { texts: reqTexts, from, to, bookId });
      const tr = res.texts || [];
      trLog(`${deps.tag}: 引擎返回 provider=${res.provider}, ${tr.length} 条译文, 非空 ${tr.filter((t) => t?.trim()).length} 条`);
      const pairs: Array<[string, string]> = [];
      misses.forEach((idx, j) => {
        // 写侧净化：引擎返回先规整为整洁单行再入缓存（拦截「AI 解说体」）
        const translation = sanitizeTranslation(tr[j] || "");
        out[idx] = translation;
        providers[idx] = translation ? res.provider : null;
        if (translation) pairs.push([texts[idx], translation]);
      });
      if (pairs.length) await deps.cache.setBatch(bookId, pairs, mode);
      // 用量按实际命中引擎累计（按提交字符数 / AI Token 计费）
      const submitChars = reqTexts.reduce((s, t) => s + t.length, 0);
      await deps.recordUsage(res.provider === "none" ? undefined : res.provider, submitChars, mode);
    } catch (e) {
      console.error(`[REword] ${deps.tag}: 引擎链异常:`, e);
      getLogger().error("[REword] 批量翻译失败:", { error: e });
    }
  }
  trLog(`${deps.tag}: 最终返回 ${out.length} 条, 非空 ${out.filter((t) => t?.trim()).length} 条`);
  return { texts: out, providers, fromCache };
}
