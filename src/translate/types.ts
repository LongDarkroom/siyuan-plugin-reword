/**
 * 翻译引擎 · 公共类型
 * ------------------------------------------------------------------
 * 设计目标：统一「批量翻译」契约，让微软 / LibreTranslate / 自有 AI 三家
 * 实现可以无缝接入同一条 fallback 链。所有 provider 都接收「一批文本」，
 * 返回「同序同长的译文数组」，便于调用方按索引回填，也便于按书缓存。
 */

/** 翻译引擎提供方标识（2026-08-30 新增腾讯/有道/百度三个免费引擎） */
export type TranslateProviderName =
  | "tencent"
  | "youdao"
  | "baidu"
  | "microsoft"
  | "libretranslate"
  | "ai";

/** 一次翻译请求（批量） */
export interface TranslateRequest {
  /** 待译文本数组（保持顺序） */
  texts: string[];
  /** 源语言：ISO-639-1 代码或 "auto" */
  from: string;
  /** 目标语言：ISO-639-1 代码（如 "zh" / "en" / "ja"） */
  to: string;
  /**
   * 书籍 ID（2026-08-28 v1.3.0 新增，可选）。
   * 用于「本书前提上下文」注入：AI 引擎据此读取该书用户手写的背景资料
   * （人物/术语/背景），拼进 prompt 使译文前后一致（如 Sludge 恒译为「斯拉奇」）。
   * 其他引擎（微软/LibreTranslate）忽略此字段。
   */
  bookId?: string;
  /**
   * 翻译模式（可选，默认 "default"）。
   * - "default"：默认直译风格
   * - "concise"：简洁版（2026-08-30 v1.4.3 新增），段落级"简洁版"按钮触发
   *   不同 mode 走 cache.ts 的独立译文池，互不污染
   * 未来可扩展 literal / literary 等。
   */
  mode?: "default" | "concise";
}

/** 翻译结果（含实际命中的提供方，便于统计 / 调试） */
export interface TranslateOutcome {
  texts: string[];
  provider: TranslateProviderName | "none";
}

/**
 * 翻译提供方契约。
 * - available：当前配置是否可用（缺 key/url 即不可用，fallback 链会跳过）。
 * - translate：已保证入参与出参同序同长；失败时抛错（由 fallback 捕获）。
 */
export interface Translator {
  readonly name: TranslateProviderName;
  readonly available: boolean;
  translate(req: TranslateRequest): Promise<string[]>;
}
