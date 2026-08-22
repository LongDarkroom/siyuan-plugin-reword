/**
 * 会话历史管理（记录 / 查看 / 回溯）
 * ------------------------------------------------------------------
 * 设计要点：
 *  - 纯逻辑、不依赖 SiYuan SDK，可直接在 Node 下单测。
 *  - 内存 Map<id, ChatSession> 索引，便于 O(1) 取会话。
 *  - 所有写操作通过 onChange 钩子落盘（由插件 index.ts 调用 saveData）。
 *  - 数据模型从第一天就内建「多会话 + 上下文文档 + 提示词」结构。
 *
 * 对应需求 2：支持记录、查看和回溯过往的绘画（对话）内容。
 */
import type { ChatMessage, ChatSession, ContextDoc } from "../types.ts";

/** 持久化结构 */
export interface ConversationData {
  activeId: string | null;
  sessions: ChatSession[];
}

export class ConversationStore {
  private sessions = new Map<string, ChatSession>();
  private activeId: string | null = null;
  private onChange: () => void;

  constructor(onChange: () => void = () => {}) {
    this.onChange = onChange;
  }

  /** 从持久化数据加载 */
  load(data: ConversationData | null | undefined): void {
    this.sessions.clear();
    this.activeId = null;
    const arr = data?.sessions ?? [];
    for (const s of arr) {
      this.sessions.set(s.id, s);
    }
    if (data?.activeId && this.sessions.has(data.activeId)) {
      this.activeId = data.activeId;
    } else {
      // 默认激活最近更新的会话
      const recent = this.list().find((s) => s.messages.length > 0) ?? this.list()[0];
      this.activeId = recent ? recent.id : null;
    }
  }

  /** 导出持久化数据 */
  toJSON(): ConversationData {
    return {
      activeId: this.activeId,
      sessions: this.list(),
    };
  }

  /** 创建新会话（自动激活） */
  createSession(title = "新会话"): ChatSession {
    const now = Date.now();
    const s: ChatSession = {
      id: genId(),
      title,
      messages: [],
      contextDocs: [],
      createdAt: now,
      updatedAt: now,
      pinned: false,
    };
    this.sessions.set(s.id, s);
    this.activeId = s.id;
    this.onChange();
    return s;
  }

  /** 当前激活会话（无则惰性创建） */
  getActive(): ChatSession {
    if (this.activeId && this.sessions.has(this.activeId)) {
      return this.sessions.get(this.activeId)!;
    }
    return this.createSession();
  }

  /** 按 id 取会话（用于回溯历史） */
  get(id: string): ChatSession | undefined {
    return this.sessions.get(id);
  }

  /** 切换激活会话（回溯历史对话） */
  setActive(id: string): ChatSession | undefined {
    if (!this.sessions.has(id)) return undefined;
    this.activeId = id;
    this.onChange();
    return this.sessions.get(id);
  }

  /** 列举所有会话（置顶优先，其次按更新时间倒序） */
  list(): ChatSession[] {
    return [...this.sessions.values()].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  /** 追加一条消息；自动用首条用户消息生成标题；更新 updatedAt */
  appendMessage(role: ChatMessage["role"], content: string, opts?: { sessionId?: string; origin?: ChatMessage["origin"] }): ChatMessage {
    const s = opts?.sessionId ? this.sessions.get(opts.sessionId) : this.getActive();
    if (!s) throw new Error("无可用会话");
    const msg: ChatMessage = {
      role,
      content,
      createdAt: Date.now(),
      origin: opts?.origin ?? "chat",
    };
    s.messages.push(msg);
    s.updatedAt = msg.createdAt;
    if (!s.title || s.title === "新会话") {
      if (role === "user") {
        s.title = content.slice(0, 24).replace(/\s+/g, " ").trim() || "新会话";
      }
    }
    this.onChange();
    return msg;
  }

  /** 替换最后一条 assistant 消息内容（流式/分片更新用） */
  updateLastAssistant(content: string, sessionId?: string): void {
    const s = sessionId ? this.sessions.get(sessionId) : this.getActive();
    if (!s) return;
    for (let i = s.messages.length - 1; i >= 0; i--) {
      if (s.messages[i].role === "assistant") {
        s.messages[i].content = content;
        s.messages[i].createdAt = Date.now();
        s.updatedAt = s.messages[i].createdAt;
        break;
      }
    }
    this.onChange();
  }

  /** 删除会话（若删除的是激活会话，自动切换到最近一个） */
  deleteSession(id: string): void {
    this.sessions.delete(id);
    if (this.activeId === id) {
      const recent = this.list()[0];
      this.activeId = recent ? recent.id : null;
    }
    this.onChange();
  }

  /** 重命名会话 */
  renameSession(id: string, title: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.title = title.trim() || s.title;
    this.onChange();
  }

  /** 置顶 / 取消置顶 */
  togglePin(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.pinned = !s.pinned;
    this.onChange();
  }

  /** 给会话加入上下文文档 */
  addContextDoc(doc: ContextDoc, sessionId?: string): boolean {
    const s = sessionId ? this.sessions.get(sessionId) : this.getActive();
    if (!s) return false;
    if (s.contextDocs.some((d) => d.id === doc.id)) return false;
    s.contextDocs.push(doc);
    s.updatedAt = Date.now();
    this.onChange();
    return true;
  }

  /** 移除上下文文档 */
  removeContextDoc(docId: string, sessionId?: string): void {
    const s = sessionId ? this.sessions.get(sessionId) : this.getActive();
    if (!s) return;
    s.contextDocs = s.contextDocs.filter((d) => d.id !== docId);
    s.updatedAt = Date.now();
    this.onChange();
  }

  /** 清空某会话消息（保留会话本身与上下文） */
  clearMessages(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.messages = [];
    s.updatedAt = Date.now();
    this.onChange();
  }
}

/** 生成短 id */
function genId(): string {
  return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}
