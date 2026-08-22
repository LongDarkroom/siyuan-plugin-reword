/**
 * REword · AI 精读编排
 * ------------------------------------------------------------------
 * 把「输入采集 → 提示词构造 → 调用 AI → 结果解析」串成一条可单测的纯函数链。
 * 不依赖 SiYuan SDK；网络通过 AiTransport 注入，便于用 mock 测试。
 */

import type { AiSettings } from "./ai-settings.ts";
import { fillAiTemplate } from "./ai-settings.ts";
import {
  type AiTransport,
  type AiGenerateResult,
  type AiMessage,
  type AiUsage,
  requestAIGenerate,
  requestAIStream,
} from "../copilot/ai/ai-client.ts";
import type { VocabStore } from "../vocab/vocab-store.ts";
import {
  type HighlightTerm,
  extractHighlights,
  findContextSentence,
  splitSentences,
  stripHighlightMarkers,
} from "./ai-text.ts";
import { getLogger } from "../core/logger.ts";

/** 精读输入（来自当前块 / 选区 / 本地文档） */
export interface DeepReadInput {
  title?: string;       // 文档或小节标题
  text: string;         // 待精读的原文（markdown 亦可）
  highlights?: string[]; // 已识别的高亮词（缺省时自动从 text 提取）
  sentences?: string[];  // 已分句（缺省时自动拆分）
  // 2026-08-21 精简：删除 mode 字段（双模式已删除,所有响应走统一渲染）
}

/** 结构化结果：一个重点词 */
export interface DeepReadWord {
  word: string;
  phonetic?: string;
  pos?: string;
  meaning: string;
  context?: string;
  /** 富词模型（copilot 升级）：多词性释义 */
  definitions?: { pos?: string; def: string }[];
  /** 富词模型：中英例句 */
  examples?: { en: string; zh?: string }[];
  /** 模型自评熟悉度 0~5（用于词库联动） */
  mastery?: number;
}

/** 结构化结果：一句讲解 */
export interface DeepReadSentence {
  sentence: string;
  structure?: string;
  translation?: string;
}

/** AI 精读结果（统一结构，喂给渲染层） */
export interface DeepReadResult {
  ok: boolean;          // 是否成功拿到内容
  isJson: boolean;      // true=结构化（可渲染交互）；false=直出 markdown
  title?: string;
  // 2026-08-21 精简：删除 mode 字段（双模式已删除,所有响应走统一渲染）
  words: DeepReadWord[];
  sentences: DeepReadSentence[];
  summary?: string;
  /** 自由阅读模式字段 */
  translation?: string; // 全文翻译
  keyPoints?: string[]; // 核心要点
  raw: string;          // markdown 兜底内容（isJson=false 时使用）
  model?: string;
  usage?: AiUsage;      // token 用量（部分服务商返回；缺失则 undefined）
  error?: string;       // 失败原因
  /** 用户点击「停止生成」中断（非失败，UI 不显示错误） */
  aborted?: boolean;
  /** 输出被 max_tokens 截断（finish_reason=length；续传后仍截断则保留 true） */
  truncated?: boolean;
  /** 本次生成走了内核代理缓冲回退（直连失败）：UI 可据此提示「缓冲模式」 */
  buffered?: boolean;
  /** 思考/推理过程（thinking 折叠面板用，可选） */
  thinking?: string;
  /** 词库联动：精读后自动写入词库的单词清单 */
  savedWords?: { word: string; added: boolean; updated?: boolean }[];
}

/** 精读可选项（全面采用 Copilot 引擎后的扩展参数） */
export interface DeepReadOptions {
  transport?: AiTransport;
  signal?: AbortSignal;
  /** 词库闭环：传入 VocabStore 实例即启用「已知词注入 + 精读后写回」 */
  vocabStore?: VocabStore;
  /** 来源块 ID（用于词库溯源 sourceBlockIds） */
  sourceBlockId?: string;
  /** 精读后是否自动写回词库（默认 true） */
  autoSaveVocab?: boolean;
  /** thinking 流式回调（每收到一个 reasoning chunk 即回调，用于实时显示思考过程） */
  onThinking?: (chunk: string) => void;
  /** 正文流式回调（每收到一个 content chunk 即回调，预留） */
  onToken?: (text: string) => void;
}

/**
 * 把 REword 精读设置映射为 Copilot 引擎所需的精简设置（仅取网络请求相关字段）。
 * 全面采用 Copilot 插件：深读的网络请求统一走 src/copilot/ai/ai-client.ts。
 * 2026-08-22 导出：批注 AI 助手(anno-ai-dialog)复用此映射。
 */
export function toEngineSettings(s: AiSettings) {
  return {
    enabled: true,
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    model: s.model,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    systemPrompt: "",
    jsonMode: s.jsonMode,
    // 2026-08-21 精简：topP/frequencyPenalty/presencePenalty/transportMode 已删除,走 engine 默认
  };
}

/** 截断自动续传的提示词（追加为 user 消息） */
const CONTINUE_HINT =
  "输出在上文被 max_tokens 截断了，请直接从断点处继续输出剩余内容，不要重复任何已输出的内容。";

/**
 * 截断自动续传：把已生成内容 + 续传提示发回模型，最多 maxRounds 轮。
 * 返回合并后的生成结果（content = 前段 + 续传段；truncated 反映最后一轮状态）。
 */
export async function continueTruncatedGen(
  gen: AiGenerateResult,
  messages: AiMessage[],
  settings: AiSettings,
  opts: { jsonMode?: boolean; transport?: AiTransport; signal?: AbortSignal; onThinking?: (c: string) => void; onToken?: (c: string) => void; maxRounds?: number }
): Promise<AiGenerateResult> {
  const maxRounds = opts.maxRounds ?? 1;
  let current = gen;
  for (let i = 0; i < maxRounds; i++) {
    if (!current.truncated || !current.content) break;
    const continueMessages: AiMessage[] = [
      ...messages,
      { role: "assistant", content: current.content },
      { role: "user", content: CONTINUE_HINT },
    ];
    const streamRes = await requestAIStream({
      messages: continueMessages,
      // 续传请求关闭 json 约束：模型以纯文本接续，最终 raw 合并后整体再解析
      settings: { ...toEngineSettings(settings), jsonMode: false },
      signal: opts.signal,
      onReasoning: opts.onThinking,
      onToken: opts.onToken,
    });
    if (!streamRes.ok || !streamRes.content) break;
    const nextContent = current.content + streamRes.content;
    // 2026-08-22 修复 4.2：reasoning 拼接的运算符优先级陷阱
    // 旧实现: streamRes.reasoning ? (current.reasoning || "") + streamRes.reasoning : current.reasoning
    //  - 依赖 `(current.reasoning || "")` 的外层括号
    //  - 去掉括号后 JS 优先级会让表达式解析为 current.reasoning || ("" + streamRes.reasoning)，
    //    在 current.reasoning 已 truthy 时整段只返回 current.reasoning,丢失新轮 reasoning
    //  - 单字符失误即崩,改用显式分支更稳健
    let nextReasoning: string | undefined = current.reasoning;
    if (streamRes.reasoning) {
      nextReasoning = (current.reasoning || "") + streamRes.reasoning;
    }
    current = {
      content: nextContent,
      raw: nextContent,
      model: streamRes.model ?? current.model,
      reasoning: nextReasoning,
      usage: streamRes.usage ?? current.usage,
      truncated: streamRes.truncated,
    };
    if (opts.signal?.aborted) break;
  }
  return current;
}

/** 系统提示词：用模板填充（2026-08-21 精简：统一用 promptTemplate,无 mode 参数） */
export function buildSystemPrompt(settings: AiSettings, vars?: {
  title?: string;
  text?: string;
  word?: string;
  sentence?: string;
}): string {
  return fillAiTemplate(settings.promptTemplate, vars || {});
}

/** 用户提示词：组织 title / 高亮词 / 正文 / 分句；自由阅读模式附加难度说明 */
export function buildUserPrompt(input: DeepReadInput): string {
  const parts: string[] = [];
  if (input.title) parts.push(`【材料标题】${input.title}`);
  if (input.highlights && input.highlights.length) {
    parts.push(`【已高亮重点词】请优先讲解并给出语境释义：${input.highlights.join("、")}`);
  }
  parts.push(`【请精读下列文本】\n${input.text}`);
  if (input.sentences && input.sentences.length) {
    parts.push(
      `【逐句参考】\n${input.sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    );
  }
  return parts.join("\n\n");
}

/**
 * 把文本预处理为精读输入：自动提取高亮词、分句、去标记正文。
 * 调用方若已具备这些（如来自 UI），可直接构造 DeepReadInput 跳过本步。
 */
export function prepareDeepReadInput(raw: { title?: string; text: string }): DeepReadInput {
  const clean = stripHighlightMarkers(raw.text);
  const highlights = extractHighlights(raw.text).map((h: HighlightTerm) => h.term);
  const sentences = splitSentences(clean);
  return { title: raw.title, text: clean, highlights, sentences };
}

/** 把任意对象规整为 DeepReadResult（容错取值） */
export function normalizeDeepRead(
  obj: any,
  raw: string,
  model?: string,
  usage?: AiUsage
): DeepReadResult {
  const words: DeepReadWord[] = Array.isArray(obj?.words)
    ? obj.words
        .map((w: any) => ({
          word: typeof w?.word === "string" ? w.word : "",
          phonetic: typeof w?.phonetic === "string" ? w.phonetic : undefined,
          pos: typeof w?.pos === "string" ? w.pos : undefined,
          meaning: typeof w?.meaning === "string" ? w.meaning : "",
          context: typeof w?.context === "string" ? w.context : undefined,
          definitions: Array.isArray(w?.definitions)
            ? w.definitions
                .map((d: any) => ({ pos: typeof d?.pos === "string" ? d.pos : undefined, def: typeof d?.def === "string" ? d.def : "" }))
                .filter((d: { def: string }) => d.def)
            : undefined,
          examples: Array.isArray(w?.examples)
            ? w.examples
                .map((e: any) => ({ en: typeof e?.en === "string" ? e.en : "", zh: typeof e?.zh === "string" ? e.zh : undefined }))
                .filter((e: { en: string }) => e.en)
            : undefined,
          mastery: typeof w?.mastery === "number" ? Math.max(0, Math.min(5, Math.round(w.mastery))) : undefined,
        }))
        .filter((w: DeepReadWord) => w.word)
    : [];

  const sentences: DeepReadSentence[] = Array.isArray(obj?.sentences)
    ? obj.sentences
        .map((s: any) => ({
          sentence: typeof s?.sentence === "string" ? s.sentence : "",
          structure: typeof s?.structure === "string" ? s.structure : undefined,
          translation: typeof s?.translation === "string" ? s.translation : undefined,
        }))
        .filter((s: DeepReadSentence) => s.sentence)
    : [];

  const summary = typeof obj?.summary === "string" ? obj.summary : undefined;
  const translation = typeof obj?.translation === "string" ? obj.translation : undefined;
  const keyPoints: string[] = Array.isArray(obj?.keyPoints)
    ? obj.keyPoints.filter((k: any) => typeof k === "string" && k.trim()).map((k: string) => k.trim())
    : [];
  const thinking = typeof obj?.thinking === "string" ? obj.thinking : undefined;

  return {
    ok: true,
    isJson: true,
    title: typeof obj?.title === "string" ? obj.title : undefined,
    words,
    sentences,
    summary,
    translation,
    keyPoints,
    raw,
    model,
    usage,
    thinking,
  };
}

/** 解析 AI 返回为统一结果（失败/非 JSON 优雅降级为 markdown 渲染） */
/** 从非 JSON 文本里尽量捞回 thinking 字段（容错：模型输出被 markdown 包裹、含转义等） */
function extractThinkingFallback(text: string): string | undefined {
  if (!text) return undefined;
  // 优先匹配 JSON 片段里的 "thinking": "..."
  const m = text.match(/"thinking"\s*:\s*"([\s\S]*?)"(?:\s*,\s*"|\s*\}\s*$|\s*]\s*$)/);
  if (m) {
    try {
      // 去掉 JSON 字符串里的 \\n 等转义
      return JSON.parse('"' + m[1].replace(/"/g, '\\"') + '"');
    } catch {
      return m[1];
    }
  }
  // 其次匹配 <think>...</think>
  const tag = text.match(/<think>([\s\S]*?)<\/think>/i);
  if (tag) return tag[1].trim();
  return undefined;
}

export function parseAiResult(
  content: string,
  isJsonExpected: boolean,
  model?: string,
  raw?: string,
  usage?: AiUsage
): DeepReadResult {
  const rawText = raw || content;
  if (isJsonExpected) {
    try {
      const obj = JSON.parse(content);
      const res = normalizeDeepRead(obj, rawText, model, usage);
      if (res.words.length || res.sentences.length || res.summary || res.translation || (res.keyPoints && res.keyPoints.length)) return res;
      // 解析成功但字段全空：仍按结构化，但保留原始以便排查
      return res;
    } catch {
      return {
        ok: true,
        isJson: false,
        words: [],
        sentences: [],
        raw: content,
        thinking: extractThinkingFallback(content),
        model,
        usage,
      };
    }
  }
  return {
    ok: true,
    isJson: false,
    words: [],
    sentences: [],
    raw: content,
    thinking: extractThinkingFallback(content),
    model,
    usage,
  };
}

/**
 * 执行一次精读：构造 messages → 调 Copilot 引擎 → 解析 → 词库闭环。
 * @param input 精读输入（可经 prepareDeepReadInput 预处理）
 * @param settings AI 设置（REword 精读设置，网络字段经 toEngineSettings 映射给 Copilot 引擎）
 * @param opts 可选项：transport / signal / vocabStore / sourceBlockId / autoSaveVocab / onThinking
 */
export async function runAiDeepRead(
  input: DeepReadInput,
  settings: AiSettings,
  opts?: DeepReadOptions
): Promise<DeepReadResult> {
  const logger = getLogger();
  const transport = opts?.transport;
  const signal = opts?.signal;
  const vocabStore = opts?.vocabStore;
  const sourceBlockId = opts?.sourceBlockId;

  const sys = buildSystemPrompt(settings, {
    title: input.title,
    text: input.text,
  });

  let buffered = false; // 是否走了代理缓冲回退（用于 UI 提示）

  // 词库联动①：注入已知词，避免重复讲解其基础释义
  let sysWithVocab = sys;
  if (vocabStore && input.highlights && input.highlights.length) {
    const known = input.highlights
      .map((h) => vocabStore.findRecord(h))
      .filter((r): r is NonNullable<typeof r> => !!r);
    if (known.length) {
      const lines = known.map((r) => `- ${r.word}：${r.meaning || "（无释义）"}（掌握度 ${r.mastery}/5）`);
      sysWithVocab = `${sys}\n\n【用户词库已掌握的词（无需重复讲解基础释义，可补充进阶用法/搭配）】\n${lines.join("\n")}`;
    }
  }

  const user = buildUserPrompt(input);
  const messages: AiMessage[] = [
    { role: "system", content: sysWithVocab },
    { role: "user", content: user },
  ];

  let gen: AiGenerateResult;
  const hasStreamCb = !!(opts?.onThinking || opts?.onToken);
  try {
    if (hasStreamCb) {
      // 流式模式：逐 chunk 回调 thinking / token，用于实时显示
      const streamRes = await requestAIStream(
        { messages, settings: toEngineSettings(settings), jsonMode: settings.jsonMode, signal,
          onReasoning: opts?.onThinking, onToken: opts?.onToken }
      );
      buffered = streamRes.buffered ?? false;
      gen = { content: streamRes.content, raw: streamRes.content, model: streamRes.model,
              reasoning: streamRes.reasoning, usage: streamRes.usage, truncated: streamRes.truncated };
    } else {
      gen = await requestAIGenerate(
        { messages, settings: toEngineSettings(settings), jsonMode: settings.jsonMode, signal,
          // 2026-08-21 精简：timeoutSec 已删除,固定 60s
          timeout: 60 * 1000 },
        transport
      );
    }
    // 输出被 max_tokens 截断时自动续传（2026-08-21 精简：autoContinue 已删除,固定开启）
    if (gen.truncated) {
      gen = await continueTruncatedGen(gen, messages, settings, {
        transport,
        signal,
        onThinking: opts?.onThinking,
        onToken: opts?.onToken,
        maxRounds: 1,
      });
    }
  } catch (e: any) {
    // 用户主动中断：标记 aborted，不记 error
    if (e?.name === "AbortError" || signal?.aborted) {
      logger.info("AI 精读已中断（用户停止）", { operation: "AI精读" });
      return {
        ok: false,
        isJson: false,
        words: [],
        sentences: [],
        raw: "",
        aborted: true,
      };
    }
    logger.error("AI 精读失败", {
      operation: "AI精读",
      error: e,
      data: { title: input.title, textLen: input.text.length },
    });
    return {
      ok: false,
      isJson: false,
      words: [],
      sentences: [],
      raw: "",
      error: e?.message || String(e),
    };
  }

  // 若使用结构化但模型未返回 JSON，尝试在本地的 highlights 上补一句语境，便于兜底渲染
  const result = parseAiResult(gen.content, settings.jsonMode, gen.model, gen.raw, gen.usage);
  // 思考过程来源优先级：流式 reasoning_content（gen.reasoning）> JSON 的 "thinking" 字段（normalizeDeepRead 已解析）。
  // 注意不能用 gen.reasoning 无条件覆盖——标准模型不返回 reasoning_content 时会把 JSON thinking 字段清掉。
  if (gen.reasoning) result.thinking = gen.reasoning;
  result.truncated = gen.truncated; // 截断标记（供 UI 提示）
  result.buffered = buffered; // 缓冲回退标记（供 UI 提示「缓冲模式」）

  if (result.isJson === false && settings.jsonMode) {
    // 结构化失败但内容非空：把已识别高亮词的语境补到 fallback 的 words 中（轻量增强）
    for (const h of input.highlights || []) {
      const ctx = findContextSentence(h, input.sentences || []);
      if (ctx && !result.words.some((w) => w.word.toLowerCase() === h.toLowerCase())) {
        result.words.push({ word: h, meaning: "", context: ctx });
      }
    }
  }

  // 词库联动②：精读后自动写回（默认开启，可被 autoSaveVocab 关闭）。
  // 并行写入（Promise.allSettled）替代串行 for-await：几十个词从 N 次串行文件 IO 降为一轮并行，
  // 显著缩短「生成完成 → 结果返回」的阻塞时间。
  if (vocabStore && (opts?.autoSaveVocab ?? true)) {
    const saved: { word: string; added: boolean; updated?: boolean }[] = [];
    const tasks = result.words
      .filter((w) => w.word && w.meaning)
      .map(async (w) => {
        try {
          const ups = await vocabStore.upsertWord(
            w.word,
            {
              phonetic: w.phonetic,
              // 词性兜底：顶层 pos 缺失时，优先取首个义项的词性，避免 AI 精读未给词性时存空值
              pos: w.pos || w.definitions?.[0]?.pos || "",
              meaning: w.meaning,
              example: w.context ?? w.examples?.[0]?.en,
              mastery: w.mastery,
            },
            sourceBlockId
          );
          saved.push({ word: w.word, added: ups.added, updated: ups.updated });
        } catch (err) {
          logger.warn("词库写回失败", { operation: "AI精读", data: { word: w.word }, error: err });
        }
      });
    await Promise.allSettled(tasks);
    if (saved.length) result.savedWords = saved;
  }

  logger.info("AI 精读完成", {
    operation: "AI精读",
    data: { ok: result.ok, isJson: result.isJson, words: result.words.length, sentences: result.sentences.length, saved: result.savedWords?.length ?? 0, model: gen.model },
  });
  return result;
}

/**
 * 执行一次对话（对话模式）：直接把消息序列发给模型，jsonMode=false，
 * 返回纯文本（markdown），不解析结构化 JSON。支持多轮上下文（调用方传入历史 + 当前输入）。
 * 全面采用 Copilot 引擎。
 */
export async function runAiChat(
  messages: AiMessage[],
  settings: AiSettings,
  opts?: { transport?: AiTransport; signal?: AbortSignal; onThinking?: (chunk: string) => void; onToken?: (chunk: string) => void }
): Promise<DeepReadResult> {
  const logger = getLogger();
  const signal = opts?.signal;
  let gen: AiGenerateResult;
  let buffered = false; // 是否走了代理缓冲回退（用于 UI 提示）
  try {
    const hasStreamCb = !!(opts?.onThinking || opts?.onToken);
    if (hasStreamCb) {
      const streamRes = await requestAIStream(
        { messages, settings: toEngineSettings(settings), jsonMode: false, signal,
          onReasoning: opts?.onThinking, onToken: opts?.onToken }
      );
      buffered = streamRes.buffered ?? false;
      gen = { content: streamRes.content, raw: streamRes.content, model: streamRes.model,
              reasoning: streamRes.reasoning, usage: streamRes.usage, truncated: streamRes.truncated };
    } else {
      gen = await requestAIGenerate(
        { messages, settings: toEngineSettings(settings), jsonMode: false, signal,
          timeout: 60 * 1000 },
        opts?.transport
      );
    }
    // 输出被 max_tokens 截断时自动续传（2026-08-21 精简：autoContinue 已删除,固定开启）
    if (gen.truncated) {
      gen = await continueTruncatedGen(gen, messages, settings, {
        transport: opts?.transport,
        signal,
        onThinking: opts?.onThinking,
        onToken: opts?.onToken,
        maxRounds: 1,
      });
    }
  } catch (e: any) {
    // 用户主动中断：标记 aborted，不记 error
    if (e?.name === "AbortError" || signal?.aborted) {
      logger.info("AI 对话已中断（用户停止）", { operation: "AI对话", data: { rounds: messages.length } });
      return {
        ok: false,
        isJson: false,
        words: [],
        sentences: [],
        raw: "",
        aborted: true,
      };
    }
    logger.error("AI 对话失败", {
      operation: "AI对话",
      error: e,
      data: { rounds: messages.length },
    });
    return {
      ok: false,
      isJson: false,
      words: [],
      sentences: [],
      raw: "",
      error: e?.message || String(e),
    };
  }
  logger.info("AI 对话完成", { operation: "AI对话", data: { rounds: messages.length, model: gen.model } });
  return {
    ok: true,
    isJson: false,
    words: [],
    sentences: [],
    raw: gen.content,
    model: gen.model,
    usage: gen.usage,
    truncated: gen.truncated,
    buffered,
    thinking: gen.reasoning,
  };
}
