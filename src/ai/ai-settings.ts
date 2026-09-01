/**
 * REword · AI 设置
 * ------------------------------------------------------------------
 * 适配自 Achuan-2/siyuan-plugin-copilot 的 AI 请求能力，裁剪为 REword 英语学习
 * 所需的最小可用配置：仅保留 OpenAI 兼容的「对话 / 文本处理」字段，移除生图、
 * agent、工具调用、视觉、多模态等无关项。
 *
 * 设计要点（与 copilot 一致）：
 *  - baseUrl 仅填「基础地址」，端点由 ai-client.buildChatUrl 归一化补全
 *    （默认追加 /v1/chat/completions）。
 *  - apiKey 通过内核代理 /api/network/forwardProxy 透传，前端不受 CORS 限制。
 *  - promptTemplate 为系统提示词模板，支持占位符 {{title}} {{text}} {{word}} {{sentence}}。
 *  - jsonMode=true 时要求模型返回结构化 JSON，便于面板渲染「收藏/批注」交互按钮。
 */

/** AI 设置（持久化于 hiword-ai.json） */
export interface AiSettings {
  enabled: boolean;       // 是否启用 AI 精读
  baseUrl: string;        // 基础地址，不含末尾 chat/completions
  apiKey: string;         // 服务商 API Key（Authorization: Bearer）
  model: string;          // 模型名（如 gpt-4o-mini / deepseek-chat）
  models: string[];       // 预设模型列表（面板 header 下拉切换用）
  temperature: number;    // 0~2
  maxTokens: number;      // 单次最大生成 token（16~32768）
  promptTemplate: string; // 系统提示词模板（支持占位符）
  jsonMode: boolean;      // true: 要求结构化 JSON；false: 直出 markdown
  /** 显示与操作 */
  fontSize: number;       // 消息字体大小（px），默认 12（与思源 Copilot 插件的 messageFontSize 默认一致）
  inputFontSize: number;  // 输入框字体大小（px），默认 13
  /** 对话导出 */
  exportNotebookId: string; // 导出目标笔记本 ID（空=收集箱）
  exportSavePath: string;    // 全局保存文档路径（sprig 语法）
  /** 记忆文档 */
  soulDocId: string;         // SOUL 文档 ID（用于记忆上下文）
  /** 阅读器「翻译」按钮发送到 AI 精读时预置的提示词（如「请把下面这句话翻译一下」） */
  translatePrompt: string;
  /**
   * 段落级"简洁版"翻译的提示词（2026-08-30 v1.4.3 新增）。
   * 用户点击译文右上角 `🔄 简洁版` 按钮时使用，与 default 直译风格互不污染。
   * 留空则回退到 translatePrompt 拼"精简附加要求"后缀。
   */
  conciseTranslatePrompt?: string;
  /** 翻译引擎：微软 Translator 订阅 Key（Azure 认知服务） */
  msKey?: string;
  /** 翻译引擎：微软 Translator 区域（如 eastasia / westeurope） */
  msRegion?: string;
  /** 翻译引擎：启用微软 Translator（默认关闭；AI 恒为首选，此为兜底开关） */
  msEnabled?: boolean;
  /** 翻译引擎：LibreTranslate 实例地址（如 https://libretranslate.com） */
  libreUrl?: string;
  /** 翻译引擎：启用 LibreTranslate（默认关闭；AI 恒为首选，此为兜底开关） */
  libreEnabled?: boolean;
  /** 免费翻译引擎优先级（按数组顺序尝试；AI 永远兜底，不在此列） */
  translatePriority?: string[];
  /** 腾讯云机器翻译（TMT） */
  tencentSecretId?: string;
  tencentSecretKey?: string;
  tencentEnabled?: boolean;
  /** 腾讯翻译本月已用字符数（用于 500 万免费额度内的用量锁） */
  tencentCharsUsed?: number;
  /** 腾讯翻译用量锁（默认 400 万字符；达到后自动禁用腾讯引擎） */
  tencentCharsLock?: number;
  /** 有道智云文本翻译 */
  youdaoAppKey?: string;
  youdaoAppSecret?: string;
  youdaoEnabled?: boolean;
  /** 百度翻译开放平台 */
  baiduAppId?: string;
  baiduKey?: string;
  baiduEnabled?: boolean;
  /** 百度翻译已用字符数（用于用量监控，达到锁后自动禁用） */
  baiduCharsUsed?: number;
  /** 百度翻译用量锁（0=不限；>0 达到后自动禁用百度引擎） */
  baiduCharsLock?: number;
  /** 有道智云已用字符数（用于用量监控） */
  youdaoCharsUsed?: number;
  /** 有道智云用量锁（0=不限） */
  youdaoCharsLock?: number;
  /** AI 翻译累计消耗 Token（跨批次累加；监督中心配额显示用） */
  aiTokenUsed?: number;
  /** AI 翻译 Token 配额上限（0=不限） */
  aiTokenLimit?: number;
  /** AI Token 告警阈值（0~1，默认 0.8） */
  aiTokenAlertRatio?: number;
  /** AI 兜底翻译风格（2026-08-30）：literal 硬直译（默认，低温度）/ natural 允许轻微润色 */
  bilingualStyle?: "literal" | "natural";
  /**
   * 2026-08-31 v1.4.4：是否启用"段落级简洁版重译"功能。
   * - true（默认）：阅读器译文右上角显示 `🔄 简洁版` 按钮，user 可单段切换
   * - false：隐藏按钮（用户明确不需要此功能，避免 UI 噪音）
   * 注意：此开关与 cache.ts 的 TranslationMode 路由是独立的——关闭此开关只是 UI
   * 隐藏，缓存层仍支持多 mode（未来可作"自动简洁"等功能）。
   */
  conciseEnabled?: boolean;
  /** AI 翻译参数：每批段数（单次 API 请求合并的段落数，默认 8） */
  trBatchSize?: number;
  /** AI 翻译参数：翻译温度（覆写「AI 服务」的 temperature，默认 0.2，直译低稳） */
  trTemperature?: number;
  /** AI 翻译参数：并发桶数（同时发送的批次数，默认 2） */
  trConcurrency?: number;

  // 2026-08-21 精简：以下字段已删除(从 21 个 → 14 个,-33%)
  //  - chatApi: 强制 OpenAI 兼容,不再支持多格式
  //  - contextWindow: 用 inferContextWindow 自动推断
  //  - topP / frequencyPenalty / presencePenalty: 用 OpenAI 规范默认
  //  - timeoutSec / autoContinue / transportMode: 用代码默认(auto + 60s + 续传)
  //  - sendShortcut: 固定 Ctrl/⌘+Enter
  //  - defaultMode / chatPromptTemplate: 双模式删除(用户用 promptTemplate 自定义)
  // 老数据兼容：normalizeAiSettings 会忽略这些字段。
}

/** 默认预设模型列表（可在设置对话框增删） */
export const DEFAULT_MODELS: string[] = [
  "gpt-4o-mini",
  "gpt-4o",
  "deepseek-chat",
  "deepseek-reasoner",
  "claude-3-5-sonnet",
];

/** 根据常见模型名推断上下文窗口；未知模型返回 128000。 */
export function inferContextWindow(model: string): number {
  const m = (model || "").toLowerCase();
  if (m.includes("deepseek-v4") || m.includes("deepseek-v4-flash")) return 1_048_576;
  if (m.includes("deepseek-v3") || m.includes("deepseek-chat")) return 64_000;
  if (m.includes("deepseek-reasoner") || m.includes("deepseek-r1")) return 64_000;
  if (m.includes("gpt-4o") || m.includes("gpt-4-turbo") || m.includes("o1")) return 128_000;
  if (m.includes("gpt-4") && !m.includes("gpt-4o")) return 8_192;
  if (m.includes("claude-3") || m.includes("claude-4")) return 200_000;
  if (m.includes("gemini-1.5") || m.includes("gemini-2")) return 1_000_000;
  if (m.includes("gemini")) return 32_000;
  if (m.includes("qwen2.5") || m.includes("qwen3")) return 128_000;
  if (m.includes("qwen")) return 32_000;
  if (m.includes("llama-3.1") || m.includes("llama-3.2") || m.includes("llama-4")) return 128_000;
  return 128_000;
}

/** 默认系统提示词：明确输出 JSON 结构（与 jsonMode 配合） */
export const DEFAULT_AI_DEEPREAD_SYSTEM = `你是 REword 英语学习助手，服务于用户在思源笔记中精读英文材料。

请先独立思考（reasoning），再基于用户提供的英文文本，给出准确、简洁、符合语境的讲解，并严格按如下 JSON 结构返回（不要输出 JSON 以外的说明文字）：

{
  "thinking": "你梳理文本、确定重点词与讲解策略的内部思考过程（可选，帮助学习者理解分析思路）",
  "words": [
    { "word": "高亮或重点词（原词）", "phonetic": "音标（可选）", "pos": "词性如 n./v.（可选）", "meaning": "该词在此语境下的释义", "context": "含该词的原文短句（用于语境记忆，可选）", "definitions": [ { "pos": "词性", "def": "该词性下的释义" } ], "examples": [ { "en": "英文例句（可选）", "zh": "中文翻译（可选）" } ], "mastery": 0 }
  ],
  "sentences": [
    { "sentence": "原文句子（逐句）", "structure": "该句的语法/结构拆解（如时态、从句、固定搭配）", "translation": "中文翻译" }
  ],
  "summary": "全文主旨或学习要点小结（1~3 句）"
}

要求：
- words 聚焦用户「已高亮」的词与真正影响理解的关键词，控制在 3~12 个，不要堆砌。
- 每个 word 尽量给出多词性 definitions 与 examples（中英对照）；mastery 为 0~5 的自评熟悉度（5=极常见）。
- sentences 按原文顺序逐句讲解，结构拆解面向英语学习者、避免过度学术化。
- thinking 可选；若给出，请简明记录你的分析思路（不会被当作正文讲解）。
- 若文本无明显英文，可返回空数组并给出简短提示。`;

/**
 * 2026-08-21 精简：DEFAULT_CHAT_PROMPT 已删除(双模式不再存在)。
 *   旧的"对话模式"提示词由 normalizeAiSettings 自动迁移到 promptTemplate 末尾。
 */

/**
 * 2026-08-30 重构：翻译提示词收紧为「硬直译」。
 * 目标：限制 AI 不要发挥、不要润色、不要拓展，只做精确直译，省 token 且风格稳定。
 */
/** 硬直译（默认风格 literal）：逐词直译、禁止发挥 */
export const DEFAULT_TRANSLATE_PROMPT =
  "你是逐段直译助手。严格遵循：\n" +
  "1. 逐句翻译，不要合并或拆句子。\n" +
  "2. 忠于原文字面意思，禁止扩写、润色、添加解释、注音、词性、例句或任何额外内容。\n" +
  "3. 人名、地名、专有名词保留原文或按通用译法，不要意译。\n" +
  "4. 只输出中文译文，一段对应一段。\n" +
  "5. 保持原文语序，不要为通顺而调顺序。";

/**
 * 自然译（风格 natural）：允许在不改意前提下做极轻微润色，读起来更顺。
 *
 * 2026-08-31：末尾追加「排版引导」，让译文可携带轻量 Markdown 结构，
 * 由 lute 渲染层（bilingual-v2/render.ts 的 mdToHtml）美化排版——
 * 解决长译文糊成一坨、多义项无层次的「释义排版问题」。
 * 只改呈现形式，不改翻译内容要求（忠实 / 极轻微润色 / 只输出译文）。
 * 注：直译（literal）风格刻意保持不变，仍是纯译文。
 */
export const DEFAULT_TRANSLATE_PROMPT_NATURAL =
  "你是一位严谨的英译中翻译器。请逐句忠实翻译，不要过度发挥；仅在不改变单词基本意思的前提下做极轻微润色，使中文通顺易读。保持原文段落与句子顺序一一对应。只输出译文本身，不要添加解释、注音或任何额外内容。\n" +
  "排版（只影响呈现，不改变译文内容）：若一句含多个义项或并列成分，可用 Markdown 无序列表分行；需要留意的关键词用 **加粗**；多个自然段之间空一行。";

/**
 * 简洁版（2026-08-30 v1.4.3 新增）：段落级"重新翻译为简洁版"按钮触发的 prompt。
 * 默认策略：保留默认直译 prompt + 在末尾追加"精简附加要求"（控制 token / 不破坏用户自定义 base prompt）。
 * 进阶用户可在设置里覆盖 `conciseTranslatePrompt`，则完全替换。
 */
export const DEFAULT_CONCISE_TRANSLATE_PROMPT =
  "你是逐段直译助手（同默认模式），但对每段译文做极严格的长度控制与去冗余：\n" +
  "1. 用最简短的中文翻译原句，长度贴近原文（不扩写、不补充、不解释）。\n" +
  "2. 去掉语法分析、注释、背景信息、连接词、语气词、过渡短语。\n" +
  "3. 直接给译文，不要加任何前缀（如\"翻译：\"）或后缀（如\"。\" 之外的标点）。\n" +
  "4. 逐句翻译，不要合并或拆句子。\n" +
  "5. 忠于原文字面意思，禁止扩写、润色、添加解释、注音、词性、例句或任何额外内容。\n" +
  "6. 人名、地名、专有名词保留原文或按通用译法，不要意译。\n" +
  "7. 只输出中文译文，一段对应一段。";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  // 2026-08-21 精简：chatApi 字段删除,统一 openai-completion
  model: "gpt-4o-mini",
  conciseTranslatePrompt: DEFAULT_CONCISE_TRANSLATE_PROMPT,
  models: [...DEFAULT_MODELS],
  temperature: 0.3,
  maxTokens: 2048,
  // 2026-08-21 精简：contextWindow/topP/frequencyPenalty/presencePenalty/timeoutSec/autoContinue/transportMode/sendShortcut 已删除
  //   - contextWindow 用 inferContextWindow() 动态推断
  //   - 其余字段在调用处用硬编码默认
  promptTemplate: DEFAULT_AI_DEEPREAD_SYSTEM,
  jsonMode: true,
  // 显示与操作
  fontSize: 12,
  inputFontSize: 13,
  // 对话导出
  exportNotebookId: "",
  exportSavePath: "",
  // 记忆文档
  soulDocId: "",
  // 2026-08-27 阅读器「翻译」预置提示词
  translatePrompt: DEFAULT_TRANSLATE_PROMPT,
  // 2026-08-27 翻译引擎配置（免费引擎链 + AI 兜底）
  msKey: "",
  msRegion: "",
  msEnabled: false,
  libreUrl: "",
  libreEnabled: false,
  // 2026-08-30 新增三个免费引擎（默认关闭，用户填 key 后启用）
  tencentSecretId: "",
  tencentSecretKey: "",
  tencentEnabled: false,
  tencentCharsUsed: 0,
  tencentCharsLock: 4_000_000,
  youdaoAppKey: "",
  youdaoAppSecret: "",
  youdaoEnabled: false,
  baiduAppId: "",
  baiduKey: "",
  baiduEnabled: false,
  baiduCharsUsed: 0,
  baiduCharsLock: 0,
  youdaoCharsUsed: 0,
  youdaoCharsLock: 0,
  aiTokenUsed: 0,
  aiTokenLimit: 0,
  aiTokenAlertRatio: 0.8,
  // 免费引擎顺序（AI 永远兜底，不在此列）；缓存命中仍由调用方优先拦截
  translatePriority: ["tencent", "youdao", "baidu", "microsoft", "libretranslate"],
  // AI 兜底翻译风格（默认硬直译）
  bilingualStyle: "literal",
  // 2026-08-31 v1.4.4：段落级"简洁版"按钮默认开启（UI 暴露给用户可关）
  conciseEnabled: true,
  // 2026-08-28 AI 翻译参数（翻译引擎 Tab 可调；默认值与 index.ts 常量一致）
  trBatchSize: 8,
  trTemperature: 0.1,
  trConcurrency: 2,
  // 2026-08-21 精简：双模式字段 defaultMode / chatPromptTemplate 已删除
};

function num(v: any, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: any, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function bool(v: any, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "1" || s === "on") return true;
    if (s === "false" || s === "no" || s === "0" || s === "off" || s === "") return false;
  }
  return fallback;
}

/** 字符串数组容错（去空、去重、非字符串项剔除） */
function strArr(v: any, fallback: string[]): string[] {
  if (!Array.isArray(v)) return [...fallback];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length ? out : [...fallback];
}

/**
 * 容错合并：用默认值补齐缺失/非法字段，数值限幅，避免脏数据导致请求异常。
 */
export function normalizeAiSettings(raw: any): AiSettings {
  const r = raw && typeof raw === "object" ? raw : {};
  // 2026-08-21 精简：老数据 chatPromptTemplate 拼到 promptTemplate 末尾(仅一次,加标记)
  const legacyChatPrompt = str(r.chatPromptTemplate, "");
  let template = str(r.promptTemplate, DEFAULT_AI_SETTINGS.promptTemplate);
  if (legacyChatPrompt && !template.includes("[REword-legacy-chat-prompt]")) {
    // eslint-disable-next-line no-console
    console.info("[REword] 检测到老数据 chatPromptTemplate,已自动拼接到 promptTemplate 末尾");
    template = template + "\n\n[REword-legacy-chat-prompt]\n--- 以下为旧版「对话模式」提示词(自动迁移,可编辑/删除) ---\n" + legacyChatPrompt;
  }
  return {
    enabled: bool(r.enabled, false),
    baseUrl: str(r.baseUrl, DEFAULT_AI_SETTINGS.baseUrl).trim(),
    apiKey: str(r.apiKey, "").trim(),
    // 2026-08-21 精简：chatApi 字段已删除(默认 openai-completion,不再支持多格式选择)
    model: str(r.model, DEFAULT_AI_SETTINGS.model).trim() || DEFAULT_AI_SETTINGS.model,
    models: strArr(r.models, DEFAULT_MODELS),
    temperature: num(r.temperature, 0.3, 0, 2),
    maxTokens: Math.round(num(r.maxTokens, 2048, 16, 32768)),
    // 2026-08-21 精简：contextWindow/topP/frequencyPenalty/presencePenalty/timeoutSec/autoContinue/transportMode/sendShortcut 已删除
    //   - contextWindow 用 inferContextWindow 自动推断
    //   - 其余用代码默认(由 OpenAI 兼容规范保证)
    promptTemplate: template,
    jsonMode: bool(r.jsonMode, true),
    // 显示与操作
    fontSize: Math.round(num(r.fontSize, 12, 10, 24)),
    inputFontSize: Math.round(num(r.inputFontSize, 13, 10, 24)),
    // 对话导出
    exportNotebookId: str(r.exportNotebookId, ""),
    exportSavePath: str(r.exportSavePath, ""),
    // 记忆文档
    soulDocId: str(r.soulDocId, ""),
    // 2026-08-27 阅读器「翻译」预置提示词（缺省回退到默认，避免空串）
    translatePrompt: (typeof r.translatePrompt === "string" && r.translatePrompt.trim())
      ? r.translatePrompt
      : DEFAULT_TRANSLATE_PROMPT,
    // 2026-08-30 翻译引擎配置（免费引擎在前，AI 兜底）
    tencentSecretId: str(r.tencentSecretId, ""),
    tencentSecretKey: str(r.tencentSecretKey, ""),
    tencentEnabled: bool(r.tencentEnabled, false),
    tencentCharsUsed: Math.max(0, Math.round(num(r.tencentCharsUsed, 0, 0, Number.MAX_SAFE_INTEGER))),
    tencentCharsLock: Math.max(0, Math.round(num(r.tencentCharsLock, 4_000_000, 0, Number.MAX_SAFE_INTEGER))),
    youdaoAppKey: str(r.youdaoAppKey, ""),
    youdaoAppSecret: str(r.youdaoAppSecret, ""),
    youdaoEnabled: bool(r.youdaoEnabled, false),
    baiduAppId: str(r.baiduAppId, ""),
    baiduKey: str(r.baiduKey, ""),
    baiduEnabled: bool(r.baiduEnabled, false),
    baiduCharsUsed: Math.max(0, Math.round(num(r.baiduCharsUsed, 0, 0, Number.MAX_SAFE_INTEGER))),
    baiduCharsLock: Math.max(0, Math.round(num(r.baiduCharsLock, 0, 0, Number.MAX_SAFE_INTEGER))),
    youdaoCharsUsed: Math.max(0, Math.round(num(r.youdaoCharsUsed, 0, 0, Number.MAX_SAFE_INTEGER))),
    youdaoCharsLock: Math.max(0, Math.round(num(r.youdaoCharsLock, 0, 0, Number.MAX_SAFE_INTEGER))),
    aiTokenUsed: Math.max(0, Math.round(num(r.aiTokenUsed, 0, 0, Number.MAX_SAFE_INTEGER))),
    aiTokenLimit: Math.max(0, Math.round(num(r.aiTokenLimit, 0, 0, Number.MAX_SAFE_INTEGER))),
    aiTokenAlertRatio: num(r.aiTokenAlertRatio, 0.8, 0, 1),
    msKey: str(r.msKey, ""),
    msRegion: str(r.msRegion, ""),
    msEnabled: bool(r.msEnabled, false),
    libreUrl: str(r.libreUrl, ""),
    libreEnabled: bool(r.libreEnabled, false),
    bilingualStyle: r.bilingualStyle === "natural" ? "natural" : "literal",
    translatePriority: (() => {
      const valid = ["tencent", "youdao", "baidu", "microsoft", "libretranslate"];
      const arr = Array.isArray(r.translatePriority) ? r.translatePriority.filter((x: any) => valid.includes(x)) : [];
      // 去重保序；AI 不在此列（恒为最后兜底）
      const seen = new Set<string>();
      const out = arr.filter((x: string) => (seen.has(x) ? false : (seen.add(x), true)));
      return out.length ? out : ["tencent", "youdao", "baidu", "microsoft", "libretranslate"];
    })(),
    // 2026-08-28 AI 翻译参数（与翻译引擎 Tab 联动）
    trBatchSize: Math.round(num(r.trBatchSize, 8, 1, 30)),
    trTemperature: num(r.trTemperature, 0.1, 0, 1),
    trConcurrency: Math.round(num(r.trConcurrency, 2, 1, 8)),
    // 2026-08-31 v1.4.4 P1.2：段落级"简洁版"按钮总开关（默认 true，缺失回退到默认）
    //   当前 v2 模式下不消费此字段，但保留字段位以便 v1.5.0 恢复按钮时无缝衔接
    conciseEnabled: typeof r.conciseEnabled === "boolean" ? r.conciseEnabled : DEFAULT_AI_SETTINGS.conciseEnabled,
    // 2026-08-21 精简：defaultMode / chatPromptTemplate 双模式字段已删除
    //   若 raw 中存在,normalize 会忽略(用户可自行编辑 promptTemplate)
  };
}

/** 用上下文变量填充模板占位符（缺失变量留空，不抛错） */
export function fillAiTemplate(
  template: string,
  vars: { title?: string; text?: string; word?: string; sentence?: string }
): string {
  return (template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) => {
    if (key in vars && vars[key as keyof typeof vars] != null) {
      return String(vars[key as keyof typeof vars]);
    }
    return whole;
  });
}
