/**
 * Copilot 宿主接口
 * ------------------------------------------------------------------
 * 面板（CopilotPanel）只负责 UI 与事件，不耦合 SiYuan SDK 细节；
 * 插件在 index.ts 中实现 CopilotHost，提供会话、设置、文档、AI 等能力。
 */
import type { ConversationStore } from "../store/conversation-store.ts";
import type { AiSettings, ChatSession, ContextDoc, PromptItem } from "../types.ts";

export interface ChatSendResult {
  ok: boolean;
  content: string;
  error?: string;
  /** 因取消信号中断而结束（content 为已生成的部分内容） */
  aborted?: boolean;
}

/** 流式发送参数 */
export interface ChatStream {
  /** 每收到一个增量片段回调 */
  onToken?: (chunk: string) => void;
  /** 取消信号（停止生成用） */
  signal?: AbortSignal;
}

export interface CopilotHost {
  /** 会话存储（面板读它来渲染列表与消息） */
  getStore(): ConversationStore;
  /** 当前 AI 设置 */
  getSettings(): AiSettings;

  /** 新建会话 */
  newSession(): ChatSession;
  /** 切换到历史会话（回溯） */
  selectSession(id: string): void;
  /** 删除会话 */
  deleteSession(id: string): void;
  /** 重命名会话 */
  renameSession(id: string, title: string): void;
  /** 置顶切换 */
  togglePin(id: string): void;

  /** 加入上下文文档 */
  addContextDoc(doc: ContextDoc): void;
  /** 移除上下文文档 */
  removeContextDoc(docId: string): void;

  /** 预设提示词 */
  getPrompts(): PromptItem[];

  /** 发送一条用户消息并请求 AI，返回结果（内部已写入 store） */
  sendToAI(userText: string, stream?: ChatStream): Promise<ChatSendResult>;

  /** 拉取全部文档列表 */
  fetchDocs(): Promise<ContextDoc[]>;
  /** 搜索文档 */
  searchDocs(keyword: string): Promise<ContextDoc[]>;

  /** 打开 AI 设置面板 */
  openSettings(): void;
  /** 复制文本 */
  copyText(text: string): void;
  /** 自定义确认弹窗（替代原生 window.confirm） */
  confirmDialog(message: string): Promise<boolean>;
  /** 自定义输入弹窗（替代原生 window.prompt），返回输入值或 null */
  promptDialog(message: string, defaultValue?: string): Promise<string | null>;
}
