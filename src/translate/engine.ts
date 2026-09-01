/**
 * 翻译引擎编排
 * ------------------------------------------------------------------
 * buildProviders：根据 AI 设置里的引擎配置，组装一条带优先级的 provider 链。
 *   - 2026-08-30 重构：缓存由调用方（translateBatch）先行拦截，本链只负责
 *     「未命中缓存」的段落。链内顺序为：
 *       ① 免费机器翻译引擎（腾讯 / 有道 / 百度 / 微软 / LibreTranslate），
 *          按 translatePriority 顺序，仅加入「已启用 + 已配置」的；
 *       ② AI 翻译，恒为兜底（链尾），仅在全部免费引擎失败/未配置时承担成本。
 *     这样最省 token：免费额度内的段落不消耗任何 AI 调用。
 *
 * translateWithFallback：依次尝试，返回第一个「成功且译文非空」的结果；
 *   全部失败则返回全空串（provider: "none"）。
 */
import type { Translator, TranslateRequest, TranslateOutcome } from "./types.ts";
import { MicrosoftTranslator } from "./providers/microsoft.ts";
import { LibreTranslator } from "./providers/libretranslate.ts";
import { TencentTranslator } from "./providers/tencent.ts";
import { YoudaoTranslator } from "./providers/youdao.ts";
import { BaiduTranslator } from "./providers/baidu.ts";
import { AiTranslator } from "./providers/ai.ts";
import type { AiTranslateFn, AiTranslateBatchFn } from "./providers/ai.ts";

/** 引擎配置（来自 AiSettings 的翻译相关字段） */
export interface EngineConfig {
  // 腾讯翻译（Tencent Cloud TMT）
  tencentSecretId?: string;
  tencentSecretKey?: string;
  tencentEnabled?: boolean;
  // 有道翻译（有道智云）
  youdaoAppKey?: string;
  youdaoAppSecret?: string;
  youdaoEnabled?: boolean;
  // 百度翻译
  baiduAppId?: string;
  baiduKey?: string;
  baiduEnabled?: boolean;
  // 微软 Translator
  msKey?: string;
  msRegion?: string;
  /** 兜底引擎开关（默认关闭；AI 恒为首选） */
  msEnabled?: boolean;
  // LibreTranslate
  libreUrl?: string;
  libreEnabled?: boolean;
  /** 免费引擎优先级（仅当开关开启且已配置才生效；AI 永远兜底，不在此列） */
  priority?: string[];
  /** 腾讯翻译已用字符数（用于 400 万用量锁） */
  tencentCharsUsed?: number;
  /** 腾讯翻译用量锁 */
  tencentCharsLock?: number;
  /** AI 是否启用（用于可用性判断） */
  aiEnabled?: boolean;
  /** AI API Key */
  aiApiKey?: string;
  /** 可用 AI 模型列表 */
  aiModels?: string[];
  /** 百度翻译已用字符数 */
  baiduCharsUsed?: number;
  /** 百度翻译用量锁（0=不限；>0 达到后自动禁用百度引擎） */
  baiduCharsLock?: number;
  /** 有道智云已用字符数 */
  youdaoCharsUsed?: number;
  /** 有道智云用量锁（0=不限） */
  youdaoCharsLock?: number;
  /** AI 翻译累计消耗 Token（跨批次累加；监督中心配额显示用） */
  aiTokenUsed?: number;
  /** AI 翻译 Token 配额上限（0=不限） */
  aiTokenLimit?: number;
}

/** 引擎依赖（注入自有 AI 翻译函数） */
export interface EngineDeps {
  translateOne: AiTranslateFn;
  /** 批量翻译（可选）：注入后 AI 走「一次请求译 N 段」的批量模式 */
  translateBatch?: AiTranslateBatchFn;
}

/** 腾讯翻译是否已达到用量锁 */
export function isTencentLocked(cfg: EngineConfig): boolean {
  const used = cfg.tencentCharsUsed ?? 0;
  const lock = cfg.tencentCharsLock ?? 4_000_000;
  return lock > 0 && used >= lock;
}

/** 百度翻译是否已达到用量锁 */
export function isBaiduLocked(cfg: EngineConfig): boolean {
  const used = cfg.baiduCharsUsed ?? 0;
  const lock = cfg.baiduCharsLock ?? 0;
  return lock > 0 && used >= lock;
}

/** 有道智云是否已达到用量锁 */
export function isYoudaoLocked(cfg: EngineConfig): boolean {
  const used = cfg.youdaoCharsUsed ?? 0;
  const lock = cfg.youdaoCharsLock ?? 0;
  return lock > 0 && used >= lock;
}

/** AI 翻译是否已达到 Token 上限 */
export function isAiTokenLocked(cfg: EngineConfig): boolean {
  const used = cfg.aiTokenUsed ?? 0;
  const limit = cfg.aiTokenLimit ?? 0;
  return limit > 0 && used >= limit;
}

/** 判断单引擎当前是否可用（已启用 + 已配置 + 未达用量锁） */
export function isEngineAvailable(name: string, cfg: EngineConfig): boolean {
  switch (name) {
    case "tencent":
      return !!(cfg.tencentEnabled && cfg.tencentSecretId && cfg.tencentSecretKey && !isTencentLocked(cfg));
    case "youdao":
      return !!(cfg.youdaoEnabled && cfg.youdaoAppKey && cfg.youdaoAppSecret);
    case "baidu":
      return !!(cfg.baiduEnabled && cfg.baiduAppId && cfg.baiduKey && !isBaiduLocked(cfg));
    case "microsoft":
      return !!(cfg.msEnabled && cfg.msKey && cfg.msRegion);
    case "libretranslate":
      return !!(cfg.libreEnabled && cfg.libreUrl);
    case "ai":
      return !!(cfg.aiEnabled && cfg.aiApiKey && !isAiTokenLocked(cfg));
    default:
      return false;
  }
}

/**
 * 组装 provider 链：免费机器翻译引擎（按 priority 顺序）在前，AI 兜底在后。
 * 仅加入「已启用 + 已配置 credentials + 未达用量锁」的引擎；未启用的被链式跳过。
 *
 * @param engine 强制指定引擎："auto" 或不传则按 priority 链；"ai" 则只用 AI；
 *               其他具体引擎则仅该引擎 + AI 兜底（方便预翻译弹窗指定引擎）。
 */
export function buildProviders(cfg: EngineConfig, deps: EngineDeps, engine?: string): Translator[] {
  const providers: Translator[] = [];
  const requested = (engine || "auto").trim();

  // 单引擎强制模式：仅启用指定引擎（AI 兜底可选）
  if (requested && requested !== "auto") {
    if (requested === "tencent" && isEngineAvailable("tencent", cfg)) {
      providers.push(new TencentTranslator(cfg.tencentSecretId!, cfg.tencentSecretKey!));
    } else if (requested === "youdao" && isEngineAvailable("youdao", cfg)) {
      providers.push(new YoudaoTranslator(cfg.youdaoAppKey!, cfg.youdaoAppSecret!));
    } else if (requested === "baidu" && isEngineAvailable("baidu", cfg)) {
      providers.push(new BaiduTranslator(cfg.baiduAppId!, cfg.baiduKey!));
    } else if (requested === "microsoft" && isEngineAvailable("microsoft", cfg)) {
      providers.push(new MicrosoftTranslator(cfg.msKey!, cfg.msRegion!));
    } else if (requested === "libretranslate" && isEngineAvailable("libretranslate", cfg)) {
      providers.push(new LibreTranslator(cfg.libreUrl!));
    }
    // AI 引擎（或 fallback）：指定 ai 时只留 AI；指定其他引擎失败时也可用 AI 兜底
    if (requested === "ai" || isEngineAvailable("ai", cfg)) {
      providers.push(new AiTranslator({ translateOne: deps.translateOne, translateBatch: deps.translateBatch }));
    }
    return providers;
  }

  // ① 免费引擎链（默认顺序：腾讯 → 有道 → 百度 → 微软 → LibreTranslate）
  const order = Array.isArray(cfg.priority) && cfg.priority.length
    ? cfg.priority
    : ["tencent", "youdao", "baidu", "microsoft", "libretranslate"];

  for (const name of order) {
    if (name === "tencent" && isEngineAvailable("tencent", cfg)) {
      providers.push(new TencentTranslator(cfg.tencentSecretId!, cfg.tencentSecretKey!));
    } else if (name === "youdao" && isEngineAvailable("youdao", cfg)) {
      providers.push(new YoudaoTranslator(cfg.youdaoAppKey!, cfg.youdaoAppSecret!));
    } else if (name === "baidu" && isEngineAvailable("baidu", cfg)) {
      providers.push(new BaiduTranslator(cfg.baiduAppId!, cfg.baiduKey!));
    } else if (name === "microsoft" && isEngineAvailable("microsoft", cfg)) {
      providers.push(new MicrosoftTranslator(cfg.msKey!, cfg.msRegion!));
    } else if (name === "libretranslate" && isEngineAvailable("libretranslate", cfg)) {
      providers.push(new LibreTranslator(cfg.libreUrl!));
    }
  }

  // ② AI 兜底（链尾，仅在免费引擎全失败或未配置时承担成本）
  providers.push(
    new AiTranslator({ translateOne: deps.translateOne, translateBatch: deps.translateBatch })
  );

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
