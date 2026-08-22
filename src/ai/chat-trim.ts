/**
 * 对话历史裁剪（P2-1）
 * ------------------------------------------------------------------
 * 多轮对话时整段全量发送会让请求体随轮次膨胀，导致首 token 延迟（TTFT）变长、
 * 表现为「越聊越慢」。本模块按 token 预算从【最旧】的整轮（user+assistant 成对）
 * 开始丢弃，保留最近上下文；被丢弃的轮次以一行摘要前置到首条保留消息，保持连贯。
 *
 * 纯函数 + 单测友好：不依赖任何运行时 API（token 估算复用 ai-client 的 estimateTokens）。
 */

import { estimateTokens } from "../copilot/ai/ai-client.ts";

/** 单条对话（与 ai-panel.chatHistory 同构：仅 user/assistant） */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TrimOptions {
  /** 发送预算（tokens）：超过则从最旧轮次丢弃。通常取 maxTokens * 0.6，给生成留余量 */
  maxTokens: number;
  /** 预算占 maxTokens 的比例（默认 0.6） */
  keepRecentRatio?: number;
  /** 消息条数硬上限（默认 24，超出再从头部丢整轮） */
  maxMessages?: number;
}

/**
 * 裁剪对话历史。
 *  - 总 token 与条数均在预算内 → 原样返回（零开销）。
 *  - 超出 → 从最旧开始成对（user+assistant）丢弃，直到满足预算或仅剩 1 对。
 *  - 若丢弃了轮次 → 在首条保留消息正文前追加「已省略最早 N 轮」一行摘要（不破坏 user/assistant 交替）。
 * 永不返回空数组（至少保留最近 1 对 / 1 条），避免把系统上下文彻底清空。
 */
export function trimChatHistory(messages: ChatTurn[], opts: TrimOptions): ChatTurn[] {
  const ratio = opts.keepRecentRatio ?? 0.6;
  const budget = Math.max(64, Math.round(opts.maxTokens * ratio));
  const maxMessages = opts.maxMessages ?? 24;

  const toks = messages.map((m) => estimateTokens(m.content));
  let total = toks.reduce((a, b) => a + b, 0);

  // 零开销路径：已满足预算与条数
  if (total <= budget && messages.length <= maxMessages) return messages;

  // 从最旧开始成对丢弃（保证保留段仍以 user 开头、严格交替）；
  // 同时满足「token 预算」与「消息条数上限」两个条件才停止丢弃
  let start = 0;
  let dropped = 0;
  while (start + 2 < messages.length) {
    const pairTokens = toks[start] + (toks[start + 1] ?? 0);
    const remainOverBudget = total - pairTokens > budget;
    const remainOverCount = messages.length - (start + 2) >= maxMessages;
    if (!remainOverBudget && !remainOverCount) break;
    total -= pairTokens;
    start += 2;
    dropped++;
  }

  let kept = messages.slice(start);
  if (kept.length === 0) kept = messages.slice(-2); // 极端兜底：至少留最近 1 对

  if (dropped > 0 && kept.length) {
    kept = [
      { ...kept[0], content: `（已省略最早 ${dropped} 轮对话，仅保留最近上下文以便连贯回答）\n\n${kept[0].content}` },
      ...kept.slice(1),
    ];
  }
  return kept;
}
