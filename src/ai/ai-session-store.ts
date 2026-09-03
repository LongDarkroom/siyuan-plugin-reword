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
  /** 自动命名是否已尝试过（成败都记）：避免命名失败后每轮对话都白调一次命名 API */
  renameTried?: boolean;
}

/**
 * 落盘裁剪常量（2026-09-03）
 * ------------------------------------------------------------------
 * 背景：assistant 消息的 html 是「渲染后 HTML」，含 KaTeX / highlight.js 的 <span> 包装，
 * 体积通常是原始 markdown 的 3~8 倍。整段存盘会让 hiword-ai-sessions.json 快速膨胀，
 * 而每次落盘都是全量重写整个文件。
 * 对策：只保留最近若干条的 html，更老的消息在重开会话时走 renderWithLute 现场渲染
 * （ai-panel.ts 里已有 `m.html ?? renderWithLute(m.content)` 的回退分支）。
 */
const HTML_KEEP_RECENT = 10;
/** 会话总量上限：超出淘汰最旧（防止 JSON 只增不减，拖慢启动 loadData） */
const MAX_SESSIONS = 30;
/** 单会话消息上限：超出淘汰最旧 */
const MAX_MESSAGES_PER_SESSION = 100;

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

  /** 导出持久化数据（落盘前裁剪：老消息的渲染 HTML 剔除，历史回退现场渲染） */
  toJSON(): AiSessionData {
    return { activeId: this.activeId, sessions: this.list().map(pruneForDisk) };
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

  /** 创建新会话（自动激活）；超出总量上限时淘汰最旧的空会话 */
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
    this.evictOverflow();
    this.onChange();
    return s;
  }

  /**
   * 会话总量裁剪：先清空会话、再清最旧的，始终跳过激活会话
   *（激活会话被删会让用户当前对话凭空消失）。list() 按 updatedAt 倒序 → 末尾最旧。
   */
  private evictOverflow(): void {
    if (this.sessions.size <= MAX_SESSIONS) return;
    const oldestFirst = this.list().reverse().filter((s) => s.id !== this.activeId);
    for (const s of oldestFirst) {
      if (this.sessions.size <= MAX_SESSIONS) break;
      if (s.messages.length > 0) continue; // 第一轮：只清空会话
      this.sessions.delete(s.id);
    }
    for (const s of oldestFirst) {
      if (this.sessions.size <= MAX_SESSIONS) break;
      this.sessions.delete(s.id); // 第二轮：仍超限则清最旧的
    }
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
    // 消息数上限：超出丢弃最旧的（AI 侧另有 trimChatHistory 按 token 预算裁剪上下文，
    // 这里裁剪的是持久化，两者互不冲突）
    s.messages = messages.length > MAX_MESSAGES_PER_SESSION
      ? messages.slice(messages.length - MAX_MESSAGES_PER_SESSION)
      : messages;
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

  /** 是否尝试过自动命名（命名失败后不再每轮重试 API） */
  hasRenameTried(id: string): boolean {
    return this.sessions.get(id)?.renameTried === true;
  }

  /** 标记「已尝试自动命名」——成败都记，只记一次 */
  markRenameTried(id: string): void {
    const s = this.sessions.get(id);
    if (!s || s.renameTried) return;
    s.renameTried = true;
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

/**
 * 落盘裁剪：剔除超出上限的旧消息，并把「最近 HTML_KEEP_RECENT 条之外」的渲染 HTML 删掉。
 * 老消息重开会话时由 ai-panel 走 renderWithLute 现场渲染，视觉一致但体积只有原文量级。
 */
function pruneForDisk(s: AiSession): AiSession {
  const src = s.messages.length > MAX_MESSAGES_PER_SESSION
    ? s.messages.slice(s.messages.length - MAX_MESSAGES_PER_SESSION)
    : s.messages;
  const keepFrom = Math.max(0, src.length - HTML_KEEP_RECENT);
  const messages: AiMessageRecord[] = src.map((m, i) => {
    if (i >= keepFrom && m.html) return m;
    return { role: m.role, content: m.content, ts: m.ts };
  });
  return { id: s.id, title: s.title, messages, createdAt: s.createdAt, updatedAt: s.updatedAt, renameTried: s.renameTried };
}

/** 生成短 id */
function genId(): string {
  return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

/** 模块级单例（持久化由 index.ts 在 onChange 中接 saveData） */
export const sessionStore = new AiSessionStore();
