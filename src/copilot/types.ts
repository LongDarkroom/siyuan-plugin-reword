/**
 * 全局类型定义
 * ------------------------------------------------------------------
 * 一个 Copilot 插件 = 多个「会话」(ChatSession)；每个会话含若干消息、
 * 一组加入上下文的文档、以及一组提示词。会话历史可记录 / 查看 / 回溯。
 */

/** 角色 */
export type ChatRole = "system" | "user" | "assistant";

/** 流式传输模式（影响 requestAIStream 的直连/代理回退策略） */
export type AiTransportMode = "auto" | "direct" | "proxy";

/** 单条聊天消息 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  createdAt: number;
  /** 来源标记：普通对话 / 来自文档上下文 */
  origin?: "chat" | "doc";
}

/** 加入上下文的文档（不存储正文，按需拉取，避免数据膨胀） */
export interface ContextDoc {
  id: string; // 文档根块 id
  name: string; // 文档标题
  hpath: string; // 完整路径
  addedAt: number;
}

/** 预设提示词（以逗号分隔呈现，可点击直接插入） */
export interface PromptItem {
  id: string;
  label: string; // 展示名（如「总结」「翻译」）
  content: string; // 实际插入内容
}

/** AI 设置（持久化于 copilot-ai.json；无小程序 / 生图等无关字段） */
export interface AiSettings {
  enabled: boolean; // 是否启用 AI
  baseUrl: string; // 基础地址，不含末尾 chat/completions
  apiKey: string; // 服务商 API Key（Authorization: Bearer）
  model: string; // 模型名（如 gpt-4o-mini / deepseek-chat）
  temperature: number; // 0~2
  maxTokens: number; // 单次最大生成 token（16~32768）
  systemPrompt: string; // 系统提示词（Copilot 对话风格）
  jsonMode: boolean; // 是否要求结构化 JSON（对话通常 false）
  /** 采样/超时扩展（可选，缺失时使用服务商默认） */
  topP?: number;          // 核采样 0~1，默认 1
  frequencyPenalty?: number; // 频率惩罚 -2~2，默认 0
  presencePenalty?: number;  // 存在惩罚 -2~2，默认 0
  /** 流式传输模式：auto=直连失败回退代理（默认）；direct=仅直连不回退；proxy=始终代理缓冲 */
  transportMode?: AiTransportMode;
}

/** 单个聊天会话（会话历史基本单位） */
export interface ChatSession {
  id: string;
  title: string; // 会话标题（首条用户消息自动生成 / 可改名）
  messages: ChatMessage[];
  contextDocs: ContextDoc[];
  createdAt: number;
  updatedAt: number;
  /** 置顶标记 */
  pinned?: boolean;
}
