/**
 * AI 对话编排
 * ------------------------------------------------------------------
 * 把「提示词构造 → 调用 AI → 结果解析」串成一条可单测的纯函数链。
 * 不依赖 SiYuan SDK；网络通过 AiTransport 注入，便于用 mock 测试。
 *
 * 与 reword 的精读编排不同，这里是通用对话：把系统提示词、文档上下文、
 * 历史消息拼成一个 messages 数组后交给 ai-client。
 */
import type { AiSettings, ChatMessage } from "../types.ts";
import type { AiMessage, AiTransport } from "./ai-client.ts";
import { requestAIGenerate, requestAIStream } from "./ai-client.ts";

/** 上下文块（已拉取的文档正文） */
export interface DocContext {
  name: string;
  hpath: string;
  content: string;
}

/** 把文档上下文拼成一段 system 提示词 */
export function buildContextPrompt(docs: DocContext[]): string {
  if (!docs.length) return "";
  const parts = docs.map(
    (d, i) =>
      `【参考文档 ${i + 1}】标题：${d.name}\n路径：${d.hpath}\n内容：\n${d.content}`
  );
  return "以下是与用户问题相关的思源笔记内容，请基于其作答：\n\n" + parts.join("\n\n");
}

/**
 * 组装发送给模型的 messages：
 *  system = 用户系统提示词 + 文档上下文（两段合并）
 *  + 历史 user/assistant 消息
 */
export function assembleMessages(
  settings: AiSettings,
  contextDocs: DocContext[],
  history: ChatMessage[]
): AiMessage[] {
  const sysParts: string[] = [];
  if (settings.systemPrompt?.trim()) sysParts.push(settings.systemPrompt.trim());
  const ctx = buildContextPrompt(contextDocs);
  if (ctx) sysParts.push(ctx);

  const messages: AiMessage[] = [];
  if (sysParts.length) {
    messages.push({ role: "system", content: sysParts.join("\n\n---\n\n") });
  }
  for (const m of history) {
    if (m.role === "system") continue; // 系统消息已在前面统一处理
    messages.push({ role: m.role, content: m.content });
  }
  return messages;
}

export interface ChatResult {
  ok: boolean;
  content: string;
  model?: string;
  error?: string;
  /** 因取消信号中断而结束（content 为已生成的部分内容） */
  aborted?: boolean;
  /** token 用量（部分 AI 服务商返回；缺失则 undefined） */
  usage?: import("./ai-client.ts").AiUsage;
}

/** 流式参数：提供 onToken 时走流式，否则走缓冲式生成 */
export interface ChatStream {
  onToken?: (chunk: string) => void;
  signal?: AbortSignal;
}

/**
 * 执行一次对话补全。
 * @param settings AI 设置
 * @param contextDocs 已拉取正文的上下文文档
 * @param history 历史消息（含本次待发送的用户消息）
 * @param transport 可注入传输（默认走 SiYuan 内核代理，仅缓冲式生成使用）
 * @param stream 流式参数；提供 onToken 时改为逐字流式输出并支持取消
 */
export async function runChat(
  settings: AiSettings,
  contextDocs: DocContext[],
  history: ChatMessage[],
  transport?: AiTransport,
  stream?: ChatStream
): Promise<ChatResult> {
  const messages = assembleMessages(settings, contextDocs, history);
  try {
    if (stream?.onToken) {
      const gen = await requestAIStream({
        messages,
        settings,
        jsonMode: settings.jsonMode,
        signal: stream.signal,
        onToken: stream.onToken,
      });
      if (!gen.ok) return { ok: false, content: "", error: gen.error };
      return { ok: true, content: gen.content, model: gen.model, aborted: gen.aborted, usage: gen.usage };
    }
    const gen = await requestAIGenerate(
      { messages, settings, jsonMode: settings.jsonMode },
      transport
    );
    return { ok: true, content: gen.content, model: gen.model, usage: gen.usage };
  } catch (e: any) {
    return {
      ok: false,
      content: "",
      error: e?.message || String(e),
    };
  }
}
