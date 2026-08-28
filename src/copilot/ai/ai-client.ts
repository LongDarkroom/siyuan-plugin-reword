import { logSwallow } from "../../core/safe.ts";
/**
 * AI 请求客户端
 * ------------------------------------------------------------------
 * 核心适配自 Achuan-2/siyuan-plugin-copilot（reword 中已二次裁剪）。
 *  - 通过 SiYuan 内核代理 /api/network/forwardProxy 转发请求（绕开前端 CORS）。
 *  - 兼容 OpenAI 兼容端点的非流式 JSON 与 SSE 流式两种返回。
 *
 * 为便于单测，所有网络行为收敛到 AiTransport 接口；生产用 forwardProxyFetch，
 * 测试可注入内存 mock。
 */
import type { AiSettings, AiTransportMode } from "../types.ts";

export type AiRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

/** token 用量（部分服务商返回；缺失则 undefined） */
export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** 传输层请求（与 fetch 入参对齐） */
export interface AiTransportRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeout: number;
  /** 取消信号（停止生成用；内核代理转发实际无法中断底层 HTTP，仅标记用） */
  signal?: AbortSignal;
}

/** 传输层响应 */
export interface AiTransportResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/** 可注入的传输实现（生产 = forwardProxyFetch，测试 = mock） */
export type AiTransport = (req: AiTransportRequest) => Promise<AiTransportResponse>;

export interface AiGenerateOptions {
  messages: AiMessage[];
  settings: AiSettings;
  jsonMode?: boolean;
  timeout?: number;
  /** 取消信号（停止生成用） */
  signal?: AbortSignal;
}

export interface AiGenerateResult {
  content: string; // 抽取出的正文
  raw: string; // 原始返回
  model?: string;
  /** 思考/推理过程（reasoning_content，可选） */
  reasoning?: string;
  /** 输出被 max_tokens 截断（finish_reason === "length"） */
  truncated?: boolean;
  /** token 用量（部分服务商返回；缺失则 undefined） */
  usage?: AiUsage;
}

/** 流式生成请求参数 */
export interface AiStreamOptions {
  messages: AiMessage[];
  settings: AiSettings;
  jsonMode?: boolean;
  timeout?: number;
  /** 取消信号（停止生成用） */
  signal?: AbortSignal;
  /** 每收到一个增量片段回调（已解码的 delta.content） */
  onToken?: (chunk: string) => void;
  /** 每收到一个推理增量片段回调（reasoning_content，可驱动「思考中」折叠面板） */
  onReasoning?: (chunk: string) => void;
}

/** 流式生成结果 */
export interface AiStreamResult {
  ok: boolean;
  content: string; // 完整正文（流式时已累积）
  model?: string;
  error?: string;
  /** 思考/推理过程（reasoning_content，可选） */
  reasoning?: string;
  /** 因 signal 中断而结束（content 为已生成的部分内容） */
  aborted?: boolean;
  /** 因 max_tokens 上限被服务端截断（finish_reason === "length"） */
  truncated?: boolean;
  /** token 用量统计（流式末端 chunk 携带，可选） */
  usage?: AiUsage;
  /** 是否走了内核代理缓冲回退（直连 CORS/网络失败）：UI 可据此提示「缓冲模式」 */
  buffered?: boolean;
}

/**
 * 端点归一化（改编自 copilot 的 j1 函数）。
 * 无论用户填 `https://api.openai.com/v1`、`https://api.deepseek.com`
 * 还是完整 `.../chat/completions`，都收敛为可用的 chat 补全地址。
 */
export function buildChatUrl(baseUrl: string): string {
  const raw = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (/\/chat\/completions$/i.test(raw)) return raw;
  if (/\/messages$/i.test(raw)) return raw;
  if (/\/v1$/i.test(raw)) return raw + "/chat/completions";
  if (/\/v1\/$/i.test(raw)) return raw + "chat/completions";
  if (/\/v1\//i.test(raw)) {
    if (/\/v1\/(models|embeddings|completions)$/i.test(raw)) {
      return raw.replace(/\/(models|embeddings|completions)$/i, "/chat/completions");
    }
    return raw;
  }
  return raw + "/v1/chat/completions";
}

/** 构造 OpenAI 兼容请求体 */
export function buildRequestBody(
  messages: AiMessage[],
  settings: AiSettings,
  jsonMode: boolean
): Record<string, any> {
  const body: Record<string, any> = {
    model: settings.model,
    messages: messages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    stream: false,
  };
  // 采样参数：仅在显式配置时透传（0 也是合法值，用 != null 判断避免被忽略）
  if (settings.topP != null) body.top_p = settings.topP;
  if (settings.frequencyPenalty != null) body.frequency_penalty = settings.frequencyPenalty;
  if (settings.presencePenalty != null) body.presence_penalty = settings.presencePenalty;
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

/**
 * 从响应正文抽取 AI 文本与思考过程。
 *  - SSE：累加 choices[].delta.content，同时累加 choices[].delta.reasoning_content（思考链）。
 *  - 普通 JSON：取 choices[].message.content 与 choices[].message.reasoning_content。
 *  - 其余：原样返回 content（兜底）。
 * 返回 { content, reasoning }，reasoning 缺失时为 undefined。
 */
export function extractContentFromBody(raw: string): { content: string; reasoning?: string } {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { content: "" };

  const looksSse = trimmed.startsWith("data:") || /\r?\ndata:/.test(trimmed);
  if (looksSse) {
    let acc = "";
    let reason = "";
    const lines = trimmed.split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const obj = JSON.parse(payload);
        const delta = obj?.choices?.[0]?.delta;
        if (delta) {
          if (typeof delta.content === "string") acc += delta.content;
          if (typeof delta.reasoning_content === "string") reason += delta.reasoning_content;
        } else {
          const msg = obj?.choices?.[0]?.message;
          if (msg && typeof msg.content === "string") acc += msg.content;
          if (msg && typeof msg.reasoning_content === "string") reason += msg.reasoning_content;
        }
      } catch (__swallowErr) { logSwallow(__swallowErr, "ai-client.ts · extractContentFromBody", "debug"); }
    }
    if (acc || reason) return { content: acc, reasoning: reason || undefined };
  }

  try {
    const obj = JSON.parse(trimmed);
    const msg = obj?.choices?.[0]?.message;
    let content = "";
    let reasoning: string | undefined;
    if (msg && typeof msg.content === "string") content = msg.content;
    else if (typeof obj?.content === "string") content = obj.content;
    if (msg && typeof msg.reasoning_content === "string") reasoning = msg.reasoning_content;
    return { content: content || trimmed, reasoning };
  } catch (__swallowErr) { logSwallow(__swallowErr, "ai-client.ts · try { const obj = JSON.parse(trimmed); const msg = obj?.choices…", "debug"); }
  return { content: trimmed };
}

/**
 * 从响应正文解析 token 用量（OpenAI 兼容 usage 字段）。
 * 部分服务商（如 DeepSeek）也返回 `usage`，字段名为 prompt_tokens /
 * completion_tokens / total_tokens。SSE 流式时取最后一个含 usage 的 data 帧。
 * 解析失败返回 undefined（调用方不显示用量）。
 */
export function extractUsageFromBody(raw: string): AiUsage | undefined {
  const trimmed = (raw || "").trim();
  if (!trimmed) return undefined;

  const parseUsage = (obj: any): AiUsage | undefined => {
    const u = obj?.usage;
    if (!u || typeof u !== "object") return undefined;
    const pt = typeof u.prompt_tokens === "number" ? u.prompt_tokens : (typeof u.promptTokens === "number" ? u.promptTokens : 0);
    const ct = typeof u.completion_tokens === "number" ? u.completion_tokens : (typeof u.completionTokens === "number" ? u.completionTokens : 0);
    const tt = typeof u.total_tokens === "number" ? u.total_tokens : (typeof u.totalTokens === "number" ? u.totalTokens : pt + ct);
    if (!pt && !ct && !tt) return undefined;
    return { promptTokens: pt, completionTokens: ct, totalTokens: tt };
  };

  // SSE：逐帧解析，保留最后一个带 usage 的帧
  if (trimmed.startsWith("data:") || /\r?\ndata:/.test(trimmed)) {
    let last: AiUsage | undefined;
    for (const line of trimmed.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const u = parseUsage(JSON.parse(payload));
        if (u) last = u;
      } catch (__swallowErr) { logSwallow(__swallowErr, "ai-client.ts · try { const u = parseUsage(JSON.parse(payload)); if (u) last = …", "debug"); }
    }
    return last;
  }

  // 普通 JSON
  try {
    return parseUsage(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

/**
 * 粗略估算文本 token 数（无本地 tiktoken 时按字符加权）。
 * 中文/日文/韩文按约 2 字符/token，英文按约 4 字符/token，空白与标点折半。
 * 结果仅供 UI 提示，不用于计费。
 */
export function estimateTokens(text: string): number {
  const t = text || "";
  if (!t) return 0;
  let chars = 0;
  let cjk = 0;
  let whitespace = 0;
  for (const ch of t) {
    const code = ch.codePointAt(0) || 0;
    const isCjk = (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x309f) ||
      (code >= 0x30a0 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3400 && code <= 0x4dbf);
    if (isCjk) cjk++;
    else if (/\s/.test(ch)) whitespace++;
    chars++;
  }
  const nonCjkNonSpace = Math.max(0, chars - cjk - whitespace);
  const est = Math.round(cjk / 2 + whitespace / 4 + nonCjkNonSpace / 4 + (chars > 0 ? 2 : 0));
  return Math.max(1, est);
}

/** 生产传输：经 SiYuan 内核代理转发（siyuan 仅在此处按需动态加载，避免测试环境静态依赖） */
export const forwardProxyFetch: AiTransport = async (req: AiTransportRequest) => {
  const { forwardProxy } = await import("../api/siyuan.ts");
  return forwardProxy({
    url: req.url,
    method: req.method || "POST",
    timeout: req.timeout || 60000,
    headers: req.headers,
    payload: req.body || "",
  });
};

/**
 * 执行一次 AI 生成。transport 缺省走 forwardProxyFetch。
 * 任何非 2xx 或网络异常都会抛出，由调用方决定降级。
 */
export async function requestAIGenerate(
  opts: AiGenerateOptions,
  transport: AiTransport = forwardProxyFetch
): Promise<AiGenerateResult> {
  const settings = opts.settings;
  const url = buildChatUrl(settings.baseUrl);
  if (!url) throw new Error("AI baseUrl 为空或无法解析为 chat 端点");

  const body = buildRequestBody(opts.messages, settings, opts.jsonMode ?? settings.jsonMode);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;

  const res = await transport({
    url,
    method: "POST",
    headers,
    body: JSON.stringify(body),
    timeout: opts.timeout ?? 60000,
    signal: opts.signal,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`AI 请求失败（HTTP ${res.status}）：${res.body.slice(0, 300)}`);
  }

  const { content, reasoning } = extractContentFromBody(res.body);
  let model: string | undefined;
  let usage: AiUsage | undefined;
  let truncated = false;
  try {
    const j = JSON.parse(res.body);
    if (typeof j?.model === "string") model = j.model;
    if (j?.usage) {
      usage = {
        promptTokens: j.usage.prompt_tokens,
        completionTokens: j.usage.completion_tokens,
        totalTokens: j.usage.total_tokens,
      };
    }
    if (j?.choices?.[0]?.finish_reason === "length") truncated = true;
  } catch (__swallowErr) { logSwallow(__swallowErr, "ai-client.ts · try { const j = JSON.parse(res.body); if (typeof j?.model === \"…", "debug"); }
  return { content, raw: res.body, model, reasoning, usage, truncated };
}

/**
 * 流式生成：优先「直连 fetch 读取 SSE」实现真实逐字输出；
 * 若端点不允许浏览器跨域（CORS）或直连零产出即失败，则回退到内核代理
 * forwardProxy 的缓冲式请求（仍可用，但非逐字）。
 *
 * 之所以直连而非走 forwardProxy：SiYuan 的 /api/network/forwardProxy 经
 * fetchSyncPost 是缓冲后一次性返回，不支持流式读取；对本地 LLM / 开启 CORS
 * 的网关，直连可拿到真正的 SSE 流。CORS 受限时自然降级，不阻塞用户。
 *
 * 支持 AbortSignal：调用方可在用户点击「停止生成」时中断，已生成内容保留。
 */
export async function requestAIStream(opts: AiStreamOptions): Promise<AiStreamResult> {
  const settings = opts.settings;
  const mode: AiTransportMode = settings.transportMode ?? "auto";
  const url = buildChatUrl(settings.baseUrl);
  if (!url) return { ok: false, content: "", error: "AI baseUrl 为空或无法解析为 chat 端点" };

  const body = buildRequestBody(opts.messages, settings, opts.jsonMode ?? settings.jsonMode);
  body.stream = true; // 覆盖 buildRequestBody 中的 stream:false
  // OpenAI/DeepSeek/硅基流动等需要显式声明才会在 SSE 末帧返回 usage
  body.stream_options = { include_usage: true };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;

  // 代理缓冲模式：跳过直连，直接走内核代理缓冲请求（非流式，但用打字机模拟渐进输出）
  if (mode === "proxy") {
    return runBufferMode(opts);
  }

  let acc = "";
  let reason = "";
  let model: string | undefined;
  let usage: AiUsage | undefined;
  let truncated = false;

  /** 解析单个 SSE data 帧（含 delta.content / reasoning / usage / finish_reason） */
  const processLine = (line: string) => {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const obj = JSON.parse(payload);
      const delta = obj?.choices?.[0]?.delta;
      if (delta?.content && typeof delta.content === "string") {
        acc += delta.content;
        opts.onToken?.(delta.content);
      }
      if (typeof delta?.reasoning_content === "string") {
        reason += delta.reasoning_content;
        opts.onReasoning?.(delta.reasoning_content);
      }
      if (typeof obj?.model === "string") model = obj.model;
      // finish_reason=length 表示被 max_tokens 截断
      if (obj?.choices?.[0]?.finish_reason === "length") truncated = true;
      // 流式末端可能携带 usage；统一归一化为 camelCase（与 ai-panel.ts 消费侧对齐）。
      if (obj?.usage) {
        const u = extractUsageFromBody(payload);
        if (u) usage = u;
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "ai-client.ts · processLine", "debug"); }
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`AI 请求失败（HTTP ${resp.status}）`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const raw of parts) processLine(raw);
    }
    // flush 残留：末帧可能没有结尾换行，直接吞掉会丢 content/usage/finish_reason
    if (buf) processLine(buf);

    if (opts.signal?.aborted) return { ok: true, content: acc, model, reasoning: reason || undefined, aborted: true, truncated, usage };
    return { ok: true, content: acc, model, reasoning: reason || undefined, truncated, usage };
  } catch (e: any) {
    // 用户主动中断：保留已生成的部分内容
    if (opts.signal?.aborted) return { ok: true, content: acc, model, reasoning: reason || undefined, aborted: true, truncated, usage };

    // 直连未产出任何 token 即失败（多为 CORS / 网络）：回退内核代理缓冲请求
    if (!acc) {
      if (mode === "direct") {
        // 直连模式：不回退代理，直接报错（用户明确选择直连）
        return { ok: false, content: "", error: e?.message || String(e) };
      }
      return runBufferMode(opts);
    }

    // 已产出部分 token 后中断：返回已得内容（避免丢字）
    return { ok: true, content: acc, model, reasoning: reason || undefined, truncated, usage };
  }
}

/**
 * 内核代理缓冲模式：经 forwardProxy 一次性请求（非流式），再把整段内容
 * 用打字机效果渐进回调 onToken，消除「等很久突然全出」的顿挫感。
 * 用于 transportMode=proxy，以及 auto 模式直连失败时的回退。
 */
async function runBufferMode(opts: AiStreamOptions): Promise<AiStreamResult> {
  const settings = opts.settings;
  const url = buildChatUrl(settings.baseUrl);
  if (!url) return { ok: false, content: "", error: "AI baseUrl 为空或无法解析为 chat 端点" };
  try {
    const gen = await requestAIGenerate(
      { messages: opts.messages, settings, jsonMode: opts.jsonMode ?? settings.jsonMode, timeout: opts.timeout },
      forwardProxyFetch
    );
    if (opts.onToken) {
      await playBufferTypewriter(gen.content, opts.onToken, opts.signal);
    }
    return { ok: true, content: gen.content, model: gen.model, reasoning: gen.reasoning, truncated: false, usage: gen.usage, buffered: true };
  } catch (e2: any) {
    return { ok: false, content: "", error: e2?.message || String(e2) };
  }
}

/** 把正文切成「句/行」粒度的块（保留标点与换行），超长块再按 ~80 字符细分；整体不超过 ~150 块以限制总时长 */
function splitTypewriterChunks(text: string): string[] {
  const parts = (text || "").match(/[\s\S]*?([。！？!?；;\n]|$)/g) ?? [text];
  let chunks = parts.filter((s) => s.length > 0);
  const MAX = 150;
  if (chunks.length > MAX) {
    const per = Math.ceil(chunks.length / MAX);
    const merged: string[] = [];
    for (let i = 0; i < chunks.length; i += per) merged.push(chunks.slice(i, i + per).join(""));
    chunks = merged;
  }
  const out: string[] = [];
  for (const c of chunks) {
    if (c.length <= 80) out.push(c);
    else for (let i = 0; i < c.length; i += 80) out.push(c.slice(i, i + 80));
  }
  return out;
}

/** 可中断的睡眠（signal 触发时立即 resolve，避免停止后仍逐字播放） */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { cleanup(); resolve(); };
    function cleanup() {
      clearTimeout(t);
      signal?.removeEventListener?.("abort", onAbort);
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/** 缓冲模式打字机：逐块回调 onToken，块间小延迟模拟渐进输出；受 signal 中断控制 */
async function playBufferTypewriter(text: string, onToken: (c: string) => void, signal?: AbortSignal): Promise<void> {
  const chunks = splitTypewriterChunks(text);
  if (chunks.length <= 1) {
    onToken(text);
    return;
  }
  for (const c of chunks) {
    if (signal?.aborted) return;
    onToken(c);
    await sleep(Math.min(45, Math.max(10, c.length * 4)), signal);
  }
}
