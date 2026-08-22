/**
 * 统一 AI 设置（单一来源）
 * ------------------------------------------------------------------
 * 根因修复（对应审查项 #10）：历史上 reword 精读（hiword-ai.json）与 copilot
 * 对话（copilot-ai.json）各自维护一套 baseUrl/apiKey/model，用户必须填两次，
 * 且两处类型（promptTemplate vs systemPrompt）不一致。
 *
 * 本模块定义「统一 AI 设置」——连接字段（enabled/baseUrl/apiKey/model/
 * temperature/maxTokens/jsonMode）与两套提示词（promptTemplate=精读、
 * systemPrompt=对话）共存于同一对象，由 reword 与 copilot 共享同一引用，
 * 实现「一次填写、两处复用」。旧 copilot-ai.json 在 index.ts 加载期做一次性迁移。
 */

/** 统一 AI 设置（reword 精读 与 copilot 对话 共用） */
export interface UnifiedAiSettings {
  enabled: boolean; // 是否启用 AI
  baseUrl: string; // 基础地址，不含末尾 chat/completions
  apiKey: string; // 服务商 API Key（Authorization: Bearer）
  model: string; // 模型名（如 gpt-4o-mini / deepseek-chat）
  temperature: number; // 0~2
  maxTokens: number; // 单次最大生成 token（16~32768）
  jsonMode: boolean; // true: 要求结构化 JSON（精读）；false: 直出（对话）
  promptTemplate: string; // 精读系统提示词模板（支持占位符）
  systemPrompt: string; // 对话系统提示词
}

/** 默认精读系统提示词（沿用 reword 原值） */
export const DEFAULT_AI_DEEPREAD_SYSTEM = `你是 REword 英语学习助手，服务于用户在思源笔记中精读英文材料。

请基于用户提供的英文文本，给出准确、简洁、符合语境的讲解，并严格按如下 JSON 结构返回（不要输出 JSON 以外的说明文字）：

{
  "words": [
    { "word": "高亮或重点词（原词）", "phonetic": "音标（可选）", "pos": "词性如 n./v.（可选）", "meaning": "该词在此语境下的释义", "context": "含该词的原文短句（用于语境记忆，可选）" }
  ],
  "sentences": [
    { "sentence": "原文句子（逐句）", "structure": "该句的语法/结构拆解（如时态、从句、固定搭配）", "translation": "中文翻译" }
  ],
  "summary": "全文主旨或学习要点小结（1~3 句）"
}

要求：
- words 聚焦用户「已高亮」的词与真正影响理解的关键词，控制在 3~12 个，不要堆砌。
- sentences 按原文顺序逐句讲解，结构拆解面向英语学习者、避免过度学术化。
- 若文本无明显英文，可返回空数组并给出简短提示。`;

/** 默认对话系统提示词（沿用 copilot 原值） */
export const DEFAULT_COPILOT_SYSTEM = `你是思源笔记（SiYuan）内置的 AI 助手 Copilot。
请用简洁、准确、结构清晰的中文回答用户关于笔记内容、写作、知识管理的问题。`;

export const DEFAULT_UNIFIED_AI_SETTINGS: UnifiedAiSettings = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.3,
  maxTokens: 2048,
  jsonMode: true,
  promptTemplate: DEFAULT_AI_DEEPREAD_SYSTEM,
  systemPrompt: DEFAULT_COPILOT_SYSTEM,
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

/** 容错合并：用默认值补齐缺失/非法字段，数值限幅，避免脏数据导致请求异常。 */
export function normalizeUnifiedAiSettings(raw: any): UnifiedAiSettings {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: bool(r.enabled, false),
    baseUrl: str(r.baseUrl, DEFAULT_UNIFIED_AI_SETTINGS.baseUrl).trim(),
    apiKey: str(r.apiKey, "").trim(),
    model: str(r.model, DEFAULT_UNIFIED_AI_SETTINGS.model).trim() || DEFAULT_UNIFIED_AI_SETTINGS.model,
    temperature: num(r.temperature, 0.3, 0, 2),
    maxTokens: Math.round(num(r.maxTokens, 2048, 16, 32768)),
    jsonMode: bool(r.jsonMode, true),
    promptTemplate:
      str(r.promptTemplate, DEFAULT_UNIFIED_AI_SETTINGS.promptTemplate),
    systemPrompt:
      str(r.systemPrompt, DEFAULT_UNIFIED_AI_SETTINGS.systemPrompt),
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
