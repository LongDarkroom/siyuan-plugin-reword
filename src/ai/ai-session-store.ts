/**
 * AI 对话会话数据层（REword 对话模式多轮上下文持久化）
 * ------------------------------------------------------------------
 * 设计要点（对齐 copilot/store/conversation-store.ts）：
 *  - 纯逻辑、不依赖 SiYuan SDK，便于单测。
 *  - 内存 Map<id, AiSession> 索引，O(1) 取会话。
 *  - 所有写操作通过 onChange 钩子落盘；具体持久化由 index.ts 用
 *    saveData("hiword-ai-sessions.json", store.toJSON()) 完成。
 *  - 数据模型内建「多会话 + 消息记录 + 激活态」。
 */

export interface AiMessageRecord {
  role: "user" | "assistant";
  content: string;
  ts: number;
  /** 渲染后的展示 HTML（assistant 消息可选，用于会话重载时 1:1 还原现场渲染，避免原始 JSON/markdown 直接裸显） */
  html?: string;
}

export interface AiSession {
  id: string;
  title: string;
  messages: AiMessageRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface AiSessionData {
  activeId: string | null;
  sessions: AiSession[];
}

export class AiSessionStore {
  private sessions = new Map<string, AiSession>();
  private activeId: string | null = null;
  /** 任意写操作后触发（由插件设置为 saveData 落盘） */
  onChange: () => void = () => {};

  /** 从持久化数据加载 */
  load(data: AiSessionData | null | undefined): void {
    this.sessions.clear();
    this.activeId = null;
    const arr = data?.sessions ?? [];
    for (const s of arr) this.sessions.set(s.id, s);
    if (data?.activeId && this.sessions.has(data.activeId)) {
      this.activeId = data.activeId;
    } else {
      // 默认激活最近更新的会话
      const recent = this.list().find((s) => s.messages.length > 0) ?? this.list()[0];
      this.activeId = recent ? recent.id : null;
    }
  }

  /** 导出持久化数据 */
  toJSON(): AiSessionData {
    return { activeId: this.activeId, sessions: this.list() };
  }

  /** 列举所有会话（按更新时间倒序） */
  list(): AiSession[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 按 id 取会话（用于回溯历史） */
  get(id: string): AiSession | undefined {
    return this.sessions.get(id);
  }

  /** 当前激活会话（可能为 null，需惰性创建） */
  getActive(): AiSession | null {
    if (this.activeId && this.sessions.has(this.activeId)) return this.sessions.get(this.activeId)!;
    return null;
  }

  /** 创建新会话（自动激活） */
  create(title = "新会话"): AiSession {
    const now = Date.now();
    const s: AiSession = {
      id: genId(),
      title,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(s.id, s);
    this.activeId = s.id;
    this.onChange();
    return s;
  }

  /** 切换激活会话（回溯历史对话） */
  setActive(id: string): AiSession | undefined {
    if (!this.sessions.has(id)) return undefined;
    this.activeId = id;
    this.onChange();
    return this.sessions.get(id);
  }

  /** 整段覆盖某会话的消息（对话模式每轮发送后调用），并自动用首条用户消息生成标题 */
  saveMessages(id: string, messages: AiMessageRecord[]): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.messages = messages;
    s.updatedAt = Date.now();
    if (!s.title || s.title === "新会话") {
      const firstUser = messages.find((m) => m.role === "user");
      if (firstUser) {
        s.title = firstUser.content.slice(0, 24).replace(/\s+/g, " ").trim() || s.title;
      }
    }
    this.onChange();
  }

  /** 重命名会话 */
  rename(id: string, title: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.title = title.trim() || s.title;
    this.onChange();
  }

  /** 批量删除会话（若含激活会话，自动切换到最近一个） */
  delete(ids: string[]): void {
    const set = new Set(ids);
    for (const id of ids) this.sessions.delete(id);
    if (this.activeId && set.has(this.activeId)) {
      const recent = this.list()[0];
      this.activeId = recent ? recent.id : null;
    }
    this.onChange();
  }
}

/** 生成短 id */
function genId(): string {
  return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

/** 模块级单例（持久化由 index.ts 在 onChange 中接 saveData） */
export const sessionStore = new AiSessionStore();
