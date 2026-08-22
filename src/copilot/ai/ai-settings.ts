/**
 * AI 设置
 * ------------------------------------------------------------------
 * 适配自 Achuan-2/siyuan-plugin-copilot 的 AI 请求能力，但裁剪为「通用对话」
 * 所需的最小配置：仅保留 OpenAI 兼容的对话字段，去除生图、agent、工具调用、
 * 视觉、多模态与小程序等无关项（符合需求 1：去除小程序相关部分）。
 *
 * 设计要点（与 copilot 一致）：
 *  - baseUrl 仅填「基础地址」，端点由 ai-client.buildChatUrl 归一化补全。
 *  - apiKey 通过内核代理 /api/network/forwardProxy 透传，前端不受 CORS 限制。
 *  - systemPrompt 为 Copilot 对话系统提示词。
 */
import type { AiSettings } from "../types.ts";

/** 默认系统提示词：通用 AI 助手 */
export const DEFAULT_COPILOT_SYSTEM = `你是思源笔记（SiYuan）内置的 AI 助手 Copilot。
你会结合用户提供的笔记上下文与对话，给出准确、简洁、有帮助的回答。
回答时使用 Markdown 格式，必要时给出结构化的列表或步骤。
如果用户提供了笔记文档上下文，请优先基于上下文作答，并注明信息来源。`;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.7,
  maxTokens: 2048,
  systemPrompt: DEFAULT_COPILOT_SYSTEM,
  jsonMode: false,
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

/** 容错合并：用默认值补齐缺失/非法字段，数值限幅，避免脏数据导致请求异常 */
export function normalizeAiSettings(raw: any): AiSettings {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: bool(r.enabled, false),
    baseUrl: str(r.baseUrl, DEFAULT_AI_SETTINGS.baseUrl).trim(),
    apiKey: str(r.apiKey, "").trim(),
    model: str(r.model, DEFAULT_AI_SETTINGS.model).trim() || DEFAULT_AI_SETTINGS.model,
    temperature: num(r.temperature, 0.7, 0, 2),
    maxTokens: Math.round(num(r.maxTokens, 2048, 16, 32768)),
    systemPrompt: str(r.systemPrompt, DEFAULT_COPILOT_SYSTEM),
    jsonMode: bool(r.jsonMode, false),
  };
}
