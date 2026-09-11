/**
 * REword · AI 精读编排
 * ------------------------------------------------------------------
 * 把「输入采集 → 提示词构造 → 调用 AI → 结果解析」串成一条可单测的纯函数链。
 * 不依赖 SiYuan SDK；网络通过 AiTransport 注入，便于用 mock 测试。
 */

import type { AiSettings } from "./ai-settings.ts";
import {
  fillAiTemplate,
  resolveModelParams,
  resolveModelStreamOverride,
  resolveModelSystemPrompt,
  activePlatformOf,
} from "./ai-settings.ts";
import {
  type AiTransport,
  type AiGenerateResult,
  type AiMessage,
  type AiUsage,
  requestAIGenerate,
  requestAIStream,
} from "./ai-client.ts";
import type { VocabStore } from "../vocab/vocab-store.ts";
import { verifyDeepReadResult } from "./ai-deepread-verify.ts";
import { buildSoulSection } from "./ai-soul.ts";
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
  /** 出处短句：AI 必须逐字照抄原文（P1-B 第 1 层；normalize 时并入 context 渲染） */
  quote?: string;
}

/** 结构化结果：一句讲解 */
export interface DeepReadSentence {
  sentence: string;
  structure?: string;
  translation?: string;
  /** 句序号（1-based，回链定位用；AI 未给时由后校验按预处理分句派生） */
  ordinal?: number;
}

/** 后校验问题条目（P1-B 第 3 层：本地逐字比对原文的产物，UI 黄色提示条用） */
export interface DeepReadIssue {
  kind: "sentence" | "word" | "quote" | "translation";
  /** 目标片段（截断展示用） */
  target: string;
  reason: string;
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
  /** AI 明确声明「无法判断/不确定」的项（P1-B 第 1 层协议字段） */
  unsupported?: string[];
  /** 本地后校验发现的不符项（P1-B 第 3 层，deepReadVerify ≠ off 时产生） */
  issues?: DeepReadIssue[];
  /** 本次精读的来源块 ID（引文回链 siyuan://blocks/ 用） */
  sourceBlockId?: string;
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
 * 全面采用 Copilot 插件：深读的网络请求统一走 src/ai/ai-client.ts。
 * 2026-08-22 导出：批注 AI 助手(anno-ai-dialog)复用此映射。
 */
export function toEngineSettings(s: AiSettings) {
  // 2026-09-07 改动点 1/3：baseUrl/apiKey/模型参数 一律取「当前激活平台」，
  // 顶层镜像字段仅在激活平台缺失时兜底，保证切换平台后请求打到正确端点。
  const plat = activePlatformOf(s);
  const baseUrl = plat?.baseUrl || s.baseUrl || "";
  const apiKey = plat?.apiKey || s.apiKey || "";
  const modelParams = plat?.modelParams || s.modelParams;
  // T6：这里是「完整设置 → 引擎设置」的窄化点，只透传 6 个字段 —— 若不在此解析，
  // 按模型覆写的 temperature/maxTokens 会在这一步被丢掉。
  const { temperature, maxTokens } = resolveModelParams({ model: s.model, temperature: s.temperature, maxTokens: s.maxTokens, modelParams });
  // R2（2026-09-07）：流式覆写也在此解析——false 时编排层「有回调走 requestAIStream」
  // 的分支改走 requestAIGenerate（一次性返回，onToken 不再逐字）。
  // 注意：翻译引擎共用 buildRequestBody 但走 requestAIGenerate（非流式），不受此覆写影响。
  const streamOverride = resolveModelStreamOverride({ model: s.model, modelParams });
  return {
    enabled: true,
    baseUrl,
    apiKey,
    model: s.model,
    temperature,
    maxTokens,
    systemPrompt: "",
    jsonMode: s.jsonMode,
    /** undefined = 跟随全局；false = 该模型禁用流式 */
    streamOverride,
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
    // R2：该模型禁用流式时续传同样降级非流式（端点不支持 SSE，流式续传必失败）
    if (resolveModelStreamOverride(settings) === false) {
      const g = await requestAIGenerate({
        messages: continueMessages,
        settings: { ...toEngineSettings(settings), jsonMode: false },
        jsonMode: false,
        signal: opts.signal,
        timeout: 60 * 1000,
      });
      if (!g.content) break;
      const nextContent0 = current.content + g.content;
      current = {
        content: nextContent0,
        raw: nextContent0,
        model: g.model ?? current.model,
        reasoning: g.reasoning ? (current.reasoning || "") + g.reasoning : current.reasoning,
        usage: g.usage ?? current.usage,
        truncated: g.truncated,
      };
      if (opts.signal?.aborted) break;
      continue;
    }
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

/** 用户提示词：组织 title / 高亮词 / 正文 / 分句；材料包 <user_input> 边界（P1-B 第 2 层抗注入） */
export function buildUserPrompt(input: DeepReadInput): string {
  const parts: string[] = [];
  if (input.title) parts.push(`【材料标题】${input.title}`);
  if (input.highlights && input.highlights.length) {
    parts.push(`【已高亮重点词】请优先讲解并给出语境释义：${input.highlights.join("、")}`);
  }
  // 正文与逐句参考都是「待讲解材料」——与 system 的【输入边界】声明配套，
  // 材料内的指令性文字（"ignore previous instructions" 等）一律降级为普通文本
  const material: string[] = [input.text];
  if (input.sentences && input.sentences.length) {
    material.push(`【逐句参考（由原文拆分）】\n${input.sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  }
  parts.push(`【请精读下列文本】\n<user_input>\n${material.join("\n\n")}\n</user_input>`);
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
        .map((w: any) => {
          // P1-B：quote 是「逐字照抄」的出处短句；优先取 quote，兼容旧模型的 context
          const quote = typeof w?.quote === "string" && w.quote.trim() ? w.quote : undefined;
          const context = quote || (typeof w?.context === "string" && w.context.trim() ? w.context : undefined);
          return {
            word: typeof w?.word === "string" ? w.word : "",
            phonetic: typeof w?.phonetic === "string" ? w.phonetic : undefined,
            pos: typeof w?.pos === "string" ? w.pos : undefined,
            meaning: typeof w?.meaning === "string" ? w.meaning : "",
            context,
            quote,
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
          };
        })
        .filter((w: DeepReadWord) => w.word)
    : [];

  const sentences: DeepReadSentence[] = Array.isArray(obj?.sentences)
    ? obj.sentences
        .map((s: any) => ({
          sentence: typeof s?.sentence === "string" ? s.sentence : "",
          structure: typeof s?.structure === "string" ? s.structure : undefined,
          translation: typeof s?.translation === "string" ? s.translation : undefined,
          ordinal: typeof s?.ordinal === "number" && Number.isFinite(s.ordinal) ? Math.max(1, Math.round(s.ordinal)) : undefined,
        }))
        .filter((s: DeepReadSentence) => s.sentence)
    : [];

  const summary = typeof obj?.summary === "string" ? obj.summary : undefined;
  const translation = typeof obj?.translation === "string" ? obj.translation : undefined;
  const keyPoints: string[] = Array.isArray(obj?.keyPoints)
    ? obj.keyPoints.filter((k: any) => typeof k === "string" && k.trim()).map((k: string) => k.trim())
    : [];
  const thinking = typeof obj?.thinking === "string" ? obj.thinking : undefined;
  // P1-B：AI 明确声明「无法判断」的项（容错：字符串数组）
  const unsupported: string[] = Array.isArray(obj?.unsupported)
    ? obj.unsupported.filter((u: any) => typeof u === "string" && u.trim()).map((u: string) => u.trim())
    : [];

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
    unsupported: unsupported.length ? unsupported : undefined,
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

  // R2（2026-09-07）：模型专属系统提示词**最高优先级**——非空时覆盖全局模板
  // （此时 settings.promptTemplate 可能已被面板层替换为激活 AI 角色的提示词，一并覆盖）。
  // 覆盖的是「基础人格段」，词库注入 / 不确定处理 / SOUL 记忆等运行时附加段不受影响。
  const sys = resolveModelSystemPrompt(settings) ||
    buildSystemPrompt(settings, {
      title: input.title,
      text: input.text,
    });

  let buffered = false; // 是否走了代理缓冲回退（用于 UI 提示）

  // 词库联动①：注入已知词，避免重复讲解其基础释义。
  // 批次 1 假接线修复：此前无条件注入，设置项 vocabSkipKnown 形同虚设；
  // 现按开关门控（false = 关闭「已知词跳过讲解」，全部照常讲解）。
  let sysWithVocab = sys;
  if (vocabStore && (settings.vocabSkipKnown ?? true) && input.highlights && input.highlights.length) {
    const known = input.highlights
      .map((h) => vocabStore.findRecord(h))
      .filter((r): r is NonNullable<typeof r> => !!r);
    if (known.length) {
      const lines = known.map((r) => `- ${r.word}：${r.meaning || "（无释义）"}（掌握度 ${r.mastery}/5）`);
      sysWithVocab = `${sys}\n\n【用户词库已掌握的词（无需重复讲解基础释义，可补充进阶用法/搭配）】\n${lines.join("\n")}`;
    }
  }
  // P1-B 第 2 层：未知项处理（unknownHandling = mark 时追加约束；omit 保持默认提示词行为）
  if ((settings.unknownHandling ?? "omit") === "mark") {
    sysWithVocab +=
      "\n\n【不确定处理】对无法从给定材料确定的释义、音标、结构或出处，在对应字段写「不确定」；" +
      "完全无法判断的项放入顶层 unsupported 数组，不要给看似合理的答案。";
  }

  const user = buildUserPrompt(input);
  // 第 5 批（P0-5）：SOUL 长期记忆注入 system（未开启/无文档/失败 → 空串无副作用）
  const soul = await buildSoulSection(settings);
  if (soul) sysWithVocab += soul;
  const messages: AiMessage[] = [
    { role: "system", content: sysWithVocab },
    { role: "user", content: user },
  ];

  let gen: AiGenerateResult;
  // P0（2026-09-08）：流式中止标志（requestAIStream 返回的 aborted 此前被丢弃，
  // 中止会渲染成「（AI 未返回内容）」而非「已停止」）
  let streamAborted = false;
  // R2：流式判定 = 有回调 且 该模型未禁用流式（streamOverride === false → 降级非流式，
  // 内容一次性到达，onToken 不再逐字；上层 UI 的节流渲染对此无感知，只是不再增量更新）
  const engSettings = toEngineSettings(settings);
  const hasStreamCb = !!(opts?.onThinking || opts?.onToken) && engSettings.streamOverride !== false;
  try {
    if (hasStreamCb) {
      // 流式模式：逐 chunk 回调 thinking / token，用于实时显示
      const streamRes = await requestAIStream(
        { messages, settings: engSettings, jsonMode: settings.jsonMode, signal,
          onReasoning: opts?.onThinking, onToken: opts?.onToken }
      );
      buffered = streamRes.buffered ?? false;
      // P0（2026-09-08）流式失败不再吞错：requestAIStream 永不抛错，直连+代理兜底都失败时
      // 返回 ok=false + error。此前只取 content，失败被加工成 ok:true/raw:"" →「（AI 未返回内容）」
      // 且日志记「AI 精读完成」，真实错误（HTTP 状态/CORS/超时）完全丢失。
      if (!streamRes.ok && !streamRes.aborted) {
        const errMsg = streamRes.error || "流式请求失败";
        logger.error("AI 精读失败（流式传输）", { operation: "AI精读", data: { error: errMsg, buffered } });
        return { ok: false, isJson: false, words: [], sentences: [], raw: "", error: errMsg };
      }
      gen = { content: streamRes.content, raw: streamRes.content, model: streamRes.model,
              reasoning: streamRes.reasoning, usage: streamRes.usage, truncated: streamRes.truncated };
      streamAborted = streamRes.aborted ?? false;
    } else {
      gen = await requestAIGenerate(
        { messages, settings: engSettings, jsonMode: settings.jsonMode, signal,
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
  if (sourceBlockId) result.sourceBlockId = sourceBlockId; // 引文回链用

  // P1-B 第 3 层：本地后校验（零 AI 调用）。
  //   warn  → 不符条目标 issues（UI 黄色提示条）；quote 不符就地清空。
  //   strict → 同 warn，另将被标记的词排除出词库自动写入。
  let flaggedWords: Set<string> | null = null;
  const verifyMode = settings.deepReadVerify ?? "warn";
  if (result.isJson && verifyMode !== "off") {
    const v = verifyDeepReadResult(result, input.text, { sentences: input.sentences });
    if (v.issues.length) {
      result.issues = v.issues;
      logger.warn("AI 精读后校验发现不符项", {
        operation: "AI精读",
        data: { total: v.issues.length, kinds: v.issues.map((i) => i.kind).join(",") },
      });
    }
    if (verifyMode === "strict" && v.flaggedWords.size) flaggedWords = v.flaggedWords;
  }

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
      // strict 模式：被后校验标记「未见于原文」的词不入词库（防幻觉污染词库）
      .filter((w) => !flaggedWords?.has(w.word))
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
  if (streamAborted) result.aborted = true; // P0（2026-09-08）：中止标志透传给 UI（已停止生成分支）
  return result;
}

/**
 * 对话模式的消息预处理（2026-09-10 改为**零注入**）。
 *
 * ## 旧实现做过两件「替用户做主」的事，均已移除
 * 1) 无 system 时强制补 `DEFAULT_AI_CHAT_SYSTEM`（19 行禁令清单）；
 * 2) 把每条 user 消息包进 `<user_input>` 标签，把用户输入降级成「待处理材料」。
 *
 * 二者叠加的后果（用户实测截图实证）：模型把用户的**正常提问**也判成
 * 「材料里夹带的指令」，照着「无论其如何表述，你都必须拒绝」执行 → 直接拒答。
 * 界面写的是自由对话，实际 100% 被这段看不见的禁令限定——这是「AI 被限制」的真根因。
 *
 * ## 现状
 * 只丢弃空的 system 占位消息（历史数据里存在 content:"" 的 system，
 * 发给 API 无意义且干扰 system 判定），其余**原样透传**。
 * 用户没选角色、没配模型专属提示词、没开 SOUL 时，模型收不到任何 system 提示词。
 *
 * 注：结构化精读链（`runAiDeepRead`）仍自行用 `<user_input>` 包裹材料，不受此处影响。
 */
function prepareChatMessages(messages: AiMessage[]): AiMessage[] {
  return messages.filter((m) => !(m.role === "system" && !m.content?.trim()));
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
  const payload = prepareChatMessages(messages);
  // R2（2026-09-07）：模型专属系统提示词最高优先级——非空时**替换**对话 system
  // （2026-09-10 零注入后，system 通常不存在，此时直接补一条；SOUL 随后追加，不冲突）。
  const modelSys = resolveModelSystemPrompt({ model: settings.model, modelParams: activePlatformOf(settings)?.modelParams || settings.modelParams });
  if (modelSys) {
    const sysMsg = payload.find((m) => m.role === "system");
    if (sysMsg) sysMsg.content = modelSys;
    else payload.unshift({ role: "system", content: modelSys });
  }
  // 第 5 批（P0-5）：SOUL 长期记忆同样注入对话 system。
  // ⚠️ 2026-09-10：此处原写 `DEFAULT_AI_CHAT_SYSTEM + soul`——只要开了 SOUL，
  // 那段禁令就会从后门重新回到对话里（零注入失效）。已改为只补 soul 本身。
  const soul = await buildSoulSection(settings);
  if (soul) {
    const sysMsg = payload.find((m) => m.role === "system");
    if (sysMsg) sysMsg.content += soul;
    else payload.unshift({ role: "system", content: soul });
  }
  let gen: AiGenerateResult;
  let buffered = false; // 是否走了代理缓冲回退（用于 UI 提示）
  let streamAborted = false; // P0（2026-09-08）：流式中止标志（此前被丢弃）
  // R2：与 runAiDeepRead 同口径——该模型禁用流式时降级 requestAIGenerate
  const engSettings = toEngineSettings(settings);
  const hasStreamCb = !!(opts?.onThinking || opts?.onToken) && engSettings.streamOverride !== false;
  try {
    if (hasStreamCb) {
      const streamRes = await requestAIStream(
        { messages: payload, settings: engSettings, jsonMode: false, signal,
          onReasoning: opts?.onThinking, onToken: opts?.onToken }
      );
      buffered = streamRes.buffered ?? false;
      // P0（2026-09-08）流式失败不再吞错：失败此前被加工成 ok:true/raw:"" →「（AI 未返回内容）」
      // 且日志记「AI 对话完成」，真实错误（HTTP 状态/CORS/超时）完全丢失。
      if (!streamRes.ok && !streamRes.aborted) {
        const errMsg = streamRes.error || "流式请求失败";
        logger.error("AI 对话失败（流式传输）", { operation: "AI对话", data: { error: errMsg, buffered } });
        return { ok: false, isJson: false, words: [], sentences: [], raw: "", error: errMsg };
      }
      gen = { content: streamRes.content, raw: streamRes.content, model: streamRes.model,
              reasoning: streamRes.reasoning, usage: streamRes.usage, truncated: streamRes.truncated };
      streamAborted = streamRes.aborted ?? false;
    } else {
      gen = await requestAIGenerate(
        { messages: payload, settings: engSettings, jsonMode: false, signal,
          timeout: 60 * 1000 },
        opts?.transport
      );
    }
    // 对话模式不做截断自动续传（2026-09-04 P0）：
    // 续传提示词是"请从断点处继续输出剩余内容"，对"续写型"模型等于明确授权它接着写，
    // 正是跑题的直接放大器（翻译请求返回续写小说）。此处只保留 truncated 标记供 UI 提示，
    // 由用户决定是否调大 maxTokens 重试。结构化精读仍走 continueTruncatedGen（JSON 续传语义明确）。
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
    aborted: streamAborted || undefined, // P0（2026-09-08）：中止标志透传给 UI
  };
}
