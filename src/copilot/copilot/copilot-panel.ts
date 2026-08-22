/**
 * Copilot dock 面板主界面
 * ------------------------------------------------------------------
 * 按 achuan-2 copilot 的 dock 面板组织方式编写（裁剪小程序相关 UI）。
 *
 * 功能落点：
 *  - 头部右上角：＋（新会话）、⚙（AI 设置入口）
 *  - 头部左侧：📜（会话历史抽屉，可查看并回溯过往对话）
 *  - 消息区：用户/AI 气泡，支持 Markdown 渲染（经集中式安全渲染器）
 *  - 上下文区：已加入文档的 chips，可移除
 *  - 底部左下角三按钮：添加文档 / 搜索文档 / 提示词
 *  - 工具抽屉：根据三按钮展开对应面板
 *  - 发送：流式输出（AbortController 可取消），用「停止生成」按钮中断
 *
 * 面板不持有业务状态，所有数据来自 CopilotHost.getStore()；
 * 任何写操作都委托给 host，由插件统一落盘。
 *
 * 安全：所有 AI / 用户文本统一经 ../markdown 的 renderMarkdown（带 XSS 过滤）
 * 渲染，链接 URL 经 sanitizeUrl 过滤，杜绝 javascript:/data: 协议注入。
 */
import { Dialog } from "siyuan";
import type { CopilotHost } from "./copilot-host.ts";
import type { ChatSession, ContextDoc, PromptItem } from "../types.ts";
import { renderMarkdown, escapeHtml } from "../markdown.ts";

export class CopilotPanel {
  private host: CopilotHost;
  private root!: HTMLElement;
  private bodyEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private welcomeEl!: HTMLElement;
  private historyEl!: HTMLElement;
  private contextEl!: HTMLElement;
  private drawerEl!: HTMLElement;
  private inputEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private sending = false;
  /** 进行中的流式请求控制器（停止生成时 abort） */
  private abortController: AbortController | null = null;
  /** 流式渲染滚动节流时间戳 */
  private lastScroll = 0;
  /** 工具抽屉当前类型 */
  private drawerKind: "add" | "search" | "prompt" | null = null;

  constructor(host: CopilotHost) {
    this.host = host;
  }

  /** 在 dock 容器内渲染面板 */
  render(dockElement: HTMLElement): void {
    const existing = dockElement.querySelector(".cp-panel");
    if (existing) (existing as HTMLElement).remove();

    const panel = document.createElement("div");
    panel.className = "cp-panel";
    panel.innerHTML = this.template();
    dockElement.appendChild(panel);
    this.root = panel;

    this.bodyEl = panel.querySelector("#cp-body")!;
    this.messagesEl = panel.querySelector("#cp-messages")!;
    this.welcomeEl = panel.querySelector("#cp-welcome")!;
    this.historyEl = panel.querySelector("#cp-history")!;
    this.contextEl = panel.querySelector("#cp-context")!;
    this.drawerEl = panel.querySelector("#cp-tool-drawer")!;
    this.inputEl = panel.querySelector("#cp-input")!;
    this.statusEl = panel.querySelector("#cp-status")!;
    this.titleEl = panel.querySelector("#cp-title")!;

    this.bindHeader();
    this.bindFooter();
    this.bindDrawer();
    this.renderAll();
  }

  /** 全量刷新（会话切换 / 重渲染时调用） */
  renderAll(): void {
    this.renderTitle();
    this.renderHistory();
    this.renderMessages();
    this.renderContextChips();
  }

  private template(): string {
    return `
      <div class="cp-header">
        <button class="cp-hist-btn" id="cp-hist-btn" title="会话历史">📜</button>
        <div class="cp-title" id="cp-title">新会话</div>
        <div class="cp-header-right">
          <button class="cp-icon-btn" id="cp-new" title="新会话">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
          <button class="cp-icon-btn" id="cp-settings" title="AI 设置">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 10.5A2.5 2.5 0 108 5.5a2.5 2.5 0 000 5z" stroke="currentColor" stroke-width="1.3"/><path d="M13 8a5 5 0 00-.1-.9l1.3-1-1-1.7-1.5.9a5 5 0 00-1.5-.9L10 2H6l-.2 1.5a5 5 0 00-1.5.9l-1.5-.9-1 1.7 1.3 1A5 5 0 003 8c0 .3 0 .6.1.9l-1.3 1 1 1.7 1.5-.9c.5.4 1 .7 1.5.9L6 14h4l.2-1.5c.5-.2 1-.5 1.5-.9l1.5.9 1-1.7-1.3-1c.1-.3.1-.6.1-.9z" stroke="currentColor" stroke-width="1.1"/></svg>
          </button>
        </div>
      </div>

      <div class="cp-history" id="cp-history" hidden></div>

      <div class="cp-body" id="cp-body">
        <div class="cp-welcome" id="cp-welcome">
          <div class="cp-welcome-bubble">💬</div>
          <p class="cp-welcome-text">开始与 Copilot 对话吧</p>
          <p class="cp-welcome-hint">输入问题，或从左下角添加笔记文档作为上下文</p>
        </div>
        <div class="cp-messages" id="cp-messages"></div>
      </div>

      <div class="cp-context" id="cp-context"></div>

      <div class="cp-tool-drawer" id="cp-tool-drawer" hidden></div>

      <div class="cp-footer">
        <div class="cp-toolbar">
          <button class="cp-tool-btn" id="cp-add-doc" title="添加思源文档到上下文">
            <span class="cp-tool-ico">📄</span><span>添加文档</span>
          </button>
          <button class="cp-tool-btn" id="cp-search-doc" title="搜索思源文档并加入上下文">
            <span class="cp-tool-ico">🔍</span><span>搜索文档</span>
          </button>
          <button class="cp-tool-btn" id="cp-prompt" title="插入预设提示词">
            <span class="cp-tool-ico">📝</span><span>提示词</span>
          </button>
        </div>
        <div class="cp-input-row">
          <div class="cp-input" id="cp-input" contenteditable="true"
            data-placeholder="输入消息，Enter 发送，Shift+Enter 换行…"></div>
          <button class="cp-stop" id="cp-stop" title="停止生成" aria-label="停止生成" hidden>
            <span class="cp-stop-label">停止</span>
          </button>
          <button class="cp-send" id="cp-send" title="发送" aria-label="发送">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M2 10L18 2L10 18L8 11L2 10Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="cp-status" id="cp-status"></div>
      </div>
    `;
  }

  private bindHeader(): void {
    this.root.querySelector("#cp-hist-btn")?.addEventListener("click", () => this.toggleHistory());
    this.root.querySelector("#cp-new")?.addEventListener("click", () => {
      this.host.newSession();
      this.closeHistory();
      this.renderAll();
      this.inputEl.focus();
    });
    this.root.querySelector("#cp-settings")?.addEventListener("click", () => this.host.openSettings());
  }

  /* ===================== 历史抽屉 ===================== */
  private toggleHistory(): void {
    if (this.historyEl.hasAttribute("hidden")) this.openHistory();
    else this.closeHistory();
  }
  private openHistory(): void {
    this.renderHistory();
    this.historyEl.classList.add("cp-history--open");
    this.historyEl.removeAttribute("hidden");
  }
  private closeHistory(): void {
    this.historyEl.classList.remove("cp-history--open");
    this.historyEl.setAttribute("hidden", "");
  }

  private renderHistory(): void {
    const sessions = this.host.getStore().list();
    const items = sessions
      .map((s: ChatSession) => `
        <div class="cp-hist-item" data-id="${s.id}">
          <div class="cp-hist-item-main">
            <div class="cp-hist-title">${escapeHtml(s.title || "新会话")}</div>
            <div class="cp-hist-meta">${this.fmtTime(s.updatedAt)}${s.pinned ? " · 置顶" : ""}</div>
          </div>
          <div class="cp-hist-actions">
            <button class="cp-hist-act" data-action="select" title="打开">↩</button>
            <button class="cp-hist-act" data-action="pin" title="${s.pinned ? "取消置顶" : "置顶"}">📌</button>
            <button class="cp-hist-act" data-action="rename" title="重命名">✎</button>
            <button class="cp-hist-act" data-action="delete" title="删除">🗑</button>
          </div>
        </div>`)
      .join("");

    this.historyEl.innerHTML = `
      <div class="cp-hist-head">
        <span>会话历史</span>
        <button class="cp-hist-close" id="cp-hist-close" title="关闭">✕</button>
      </div>
      <div class="cp-hist-list">${items}</div>
    `;

    this.historyEl.querySelector("#cp-hist-close")?.addEventListener("click", () => this.closeHistory());

    this.historyEl.querySelectorAll(".cp-hist-item").forEach((el) => {
      const item = el as HTMLElement;
      const id = item.dataset.id!;
      item.querySelector('[data-action="select"]')?.addEventListener("click", () => {
        this.host.selectSession(id);
        this.closeHistory();
        this.renderAll();
        this.inputEl.focus();
      });
      item.querySelector('[data-action="pin"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.host.togglePin(id);
        this.renderHistory();
      });
      item.querySelector('[data-action="rename"]')?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const cur = this.host.getStore().get(id)?.title ?? "";
        const name = await this.promptRename(cur);
        if (name != null) {
          this.host.renameSession(id, name);
          this.renderHistory();
          this.renderTitle();
        }
      });
      item.querySelector('[data-action="delete"]')?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await this.confirmDelete();
        if (ok) {
          this.host.deleteSession(id);
          this.renderHistory();
          this.renderAll();
        }
      });
    });
  }

  /* ===================== 消息区 ===================== */
  private renderMessages(): void {
    const session = this.host.getStore().getActive();
    if (!session.messages.length) {
      this.welcomeEl.style.display = "";
      this.messagesEl.innerHTML = "";
      return;
    }
    this.welcomeEl.style.display = "none";
    this.messagesEl.innerHTML = session.messages
      .map((m) => this.messageHtml(m.role, m.content))
      .join("");
    this.scrollToBottom();
  }

  private messageHtml(role: string, content: string): string {
    const cls = role === "user" ? "cp-msg--user" : "cp-msg--ai";
    const avatar = role === "user" ? "我" : "AI";
    const inner = role === "user" ? escapeHtml(content) : renderMarkdown(content);
    return `
      <div class="cp-msg ${cls}">
        <div class="cp-msg-avatar">${avatar}</div>
        <div class="cp-msg-content">${inner}</div>
      </div>`;
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
    });
  }

  private renderTitle(): void {
    const s = this.host.getStore().getActive();
    this.titleEl.textContent = s.title || "新会话";
  }

  /* ===================== 上下文 chips ===================== */
  private renderContextChips(): void {
    const docs = this.host.getStore().getActive().contextDocs;
    if (!docs.length) {
      this.contextEl.innerHTML = "";
      this.contextEl.style.display = "none";
      return;
    }
    this.contextEl.style.display = "";
    this.contextEl.innerHTML =
      `<span class="cp-context-label">上下文</span>` +
      docs
        .map(
          (d: ContextDoc) => `
        <span class="cp-chip" data-id="${d.id}" title="${escapeHtml(d.hpath)}">
          📄 ${escapeHtml(d.name)}
          <button class="cp-chip-x" data-id="${d.id}" title="移除">✕</button>
        </span>`
        )
        .join("");

    this.contextEl.querySelectorAll(".cp-chip-x").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        this.host.removeContextDoc(id);
        this.renderContextChips();
      });
    });
  }

  /* ===================== 底部输入 + 发送 ===================== */
  private bindFooter(): void {
    const sendBtn = this.root.querySelector("#cp-send") as HTMLButtonElement;
    sendBtn?.addEventListener("click", () => this.handleSend());

    const stopBtn = this.root.querySelector("#cp-stop") as HTMLButtonElement;
    stopBtn?.addEventListener("click", () => this.abortController?.abort());

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // 左下角三按钮
    this.root.querySelector("#cp-add-doc")?.addEventListener("click", () => this.toggleDrawer("add"));
    this.root.querySelector("#cp-search-doc")?.addEventListener("click", () => this.toggleDrawer("search"));
    this.root.querySelector("#cp-prompt")?.addEventListener("click", () => this.toggleDrawer("prompt"));
  }

  private async handleSend(): Promise<void> {
    if (this.sending) return;
    const text = (this.inputEl.textContent ?? "").trim();
    if (!text) {
      this.setStatus("请输入内容后再发送。");
      return;
    }
    const settings = this.host.getSettings();
    if (!settings.enabled) {
      this.setStatus("AI 未启用：请点击右上角 ⚙ 设置并填写 API。");
      return;
    }
    if (!settings.apiKey) {
      this.setStatus("缺少 API Key：请点击右上角 ⚙ 设置中填写。");
      return;
    }

    // 清空输入
    this.inputEl.innerHTML = "";

    // 立即渲染用户消息
    this.welcomeEl.style.display = "none";
    const userBubble = document.createElement("div");
    userBubble.className = "cp-msg cp-msg--user";
    userBubble.innerHTML = `<div class="cp-msg-avatar">我</div><div class="cp-msg-content">${escapeHtml(text)}</div>`;
    this.messagesEl.appendChild(userBubble);

    // AI 流式气泡（先显示加载动画，流式内容到达后实时替换）
    const aiBubble = document.createElement("div");
    aiBubble.className = "cp-msg cp-msg--ai";
    aiBubble.innerHTML = `<div class="cp-msg-avatar">AI</div><div class="cp-msg-content"><span class="cp-dots"><i></i><i></i><i></i></span></div>`;
    this.messagesEl.appendChild(aiBubble);
    const aiContentEl = aiBubble.querySelector(".cp-msg-content") as HTMLElement;
    this.scrollToBottom();

    this.sending = true;
    this.setStatus("AI 思考中…");
    this.showStop(true);

    // 可取消的流式请求
    this.abortController = new AbortController();
    let acc = "";

    const res = await this.host.sendToAI(text, {
      signal: this.abortController.signal,
      onToken: (chunk: string) => {
        acc += chunk;
        aiContentEl.innerHTML = renderMarkdown(acc);
        this.scrollToBottomThrottled();
      },
    });

    this.abortController = null;
    this.showStop(false);

    if (res.aborted) {
      // 已生成的部分内容已由 onToken 渲染在气泡内；此处再渲染一次确保与落盘内容一致
      aiContentEl.innerHTML = renderMarkdown(res.content);
      this.setStatus("已停止生成。");
    } else if (res.ok) {
      aiContentEl.innerHTML = renderMarkdown(res.content);
      this.setStatus("");
    } else {
      aiBubble.querySelector(".cp-msg-avatar")?.classList.add("cp-msg-avatar--err");
      aiContentEl.classList.add("cp-msg-content--err");
      aiContentEl.textContent = res.error || "请求失败";
      this.setStatus("对话出错，详见消息区。");
    }

    this.scrollToBottom();
    this.sending = false;

    // 刷新标题（首条消息可能已生成标题）
    this.renderTitle();
  }

  /* ===================== 工具抽屉（左下角三功能） ===================== */
  private bindDrawer(): void {
    // 抽屉内事件通过事件委托在各自 render 时绑定
  }

  private toggleDrawer(kind: "add" | "search" | "prompt"): void {
    if (this.drawerKind === kind) {
      this.closeDrawer();
      return;
    }
    this.drawerKind = kind;
    this.drawerEl.removeAttribute("hidden");
    this.drawerEl.classList.add("cp-tool-drawer--open");
    if (kind === "add") this.renderAddDoc();
    else if (kind === "search") this.renderSearchDoc();
    else this.renderPrompt();
  }

  private closeDrawer(): void {
    this.drawerKind = null;
    this.drawerEl.setAttribute("hidden", "");
    this.drawerEl.classList.remove("cp-tool-drawer--open");
    this.drawerEl.innerHTML = "";
  }

  /** 添加文档：列出全部文档，点击加入上下文 */
  private async renderAddDoc(): Promise<void> {
    this.drawerEl.innerHTML = `
      <div class="cp-drawer-head">
        <span>添加文档</span>
        <button class="cp-drawer-close" id="cp-drawer-close" title="关闭">✕</button>
      </div>
      <div class="cp-drawer-body"><div class="cp-loading">加载文档列表中…</div></div>
    `;
    this.drawerEl.querySelector("#cp-drawer-close")?.addEventListener("click", () => this.closeDrawer());

    let docs: ContextDoc[] = [];
    try {
      docs = await this.host.fetchDocs();
    } catch (e: any) {
      this.drawerEl.querySelector(".cp-drawer-body")!.innerHTML = `<div class="cp-err">加载失败：${escapeHtml(e?.message || e)}</div>`;
      return;
    }
    const body = this.drawerEl.querySelector(".cp-drawer-body")!;
    if (!docs.length) {
      body.innerHTML = `<div class="cp-empty">没有可添加的文档</div>`;
      return;
    }
    body.innerHTML = `<div class="cp-doc-list">${docs
      .map(
        (d: ContextDoc) => `
        <div class="cp-doc-item">
          <div class="cp-doc-info">
            <div class="cp-doc-name" title="${escapeHtml(d.hpath)}">${escapeHtml(d.name)}</div>
            <div class="cp-doc-path">${escapeHtml(d.hpath)}</div>
          </div>
          <button class="cp-add-ctx" data-id="${d.id}">添加到上下文</button>
        </div>`
      )
      .join("")}</div>`;

    body.querySelectorAll(".cp-add-ctx").forEach((btn) => {
      const id = (btn as HTMLElement).dataset.id!;
      btn.addEventListener("click", () => {
        const doc = docs.find((d) => d.id === id);
        if (!doc) return;
        if (this.isDocAdded(doc.id)) this.host.removeContextDoc(doc.id);
        else this.host.addContextDoc(doc);
        this.renderAddDoc();
        this.renderContextChips();
      });
      // 刷新按钮状态
      if (this.isDocAdded(id)) {
        (btn as HTMLButtonElement).textContent = "已添加 ✓";
        (btn as HTMLButtonElement).classList.add("cp-add-ctx--added");
      }
    });
  }

  /** 搜索文档：左侧文档名，右侧「添加到上下文」 */
  private renderSearchDoc(): void {
    this.drawerEl.innerHTML = `
      <div class="cp-drawer-head">
        <span>搜索文档</span>
        <button class="cp-drawer-close" id="cp-drawer-close" title="关闭">✕</button>
      </div>
      <div class="cp-drawer-search">
        <input class="cp-search-input" id="cp-search-input" placeholder="输入关键词搜索思源文档…" />
        <button class="cp-search-go" id="cp-search-go">搜索</button>
      </div>
      <div class="cp-drawer-body"><div class="cp-hint">输入关键词后点击搜索</div></div>
    `;
    this.drawerEl.querySelector("#cp-drawer-close")?.addEventListener("click", () => this.closeDrawer());

    const input = this.drawerEl.querySelector("#cp-search-input") as HTMLInputElement;
    const goBtn = this.drawerEl.querySelector("#cp-search-go") as HTMLButtonElement;
    const body = this.drawerEl.querySelector(".cp-drawer-body")!;

    const doSearch = async () => {
      const kw = input.value.trim();
      if (!kw) {
        body.innerHTML = `<div class="cp-hint">请输入关键词</div>`;
        return;
      }
      body.innerHTML = `<div class="cp-loading">搜索中…</div>`;
      let docs: ContextDoc[] = [];
      try {
        docs = await this.host.searchDocs(kw);
      } catch (e: any) {
        body.innerHTML = `<div class="cp-err">搜索失败：${escapeHtml(e?.message || e)}</div>`;
        return;
      }
      if (!docs.length) {
        body.innerHTML = `<div class="cp-empty">未找到匹配「${escapeHtml(kw)}」的文档</div>`;
        return;
      }
      body.innerHTML = `<div class="cp-doc-list">${docs
        .map(
          (d: ContextDoc) => `
          <div class="cp-doc-item">
            <div class="cp-doc-info">
              <div class="cp-doc-name" title="${escapeHtml(d.hpath)}">${escapeHtml(d.name)}</div>
              <div class="cp-doc-path">${escapeHtml(d.hpath)}</div>
            </div>
            <button class="cp-add-ctx" data-id="${d.id}">添加到上下文</button>
          </div>`
        )
        .join("")}</div>`;

      body.querySelectorAll(".cp-add-ctx").forEach((btn) => {
        const id = (btn as HTMLElement).dataset.id!;
        if (this.isDocAdded(id)) {
          (btn as HTMLButtonElement).textContent = "已添加 ✓";
          (btn as HTMLButtonElement).classList.add("cp-add-ctx--added");
        }
        btn.addEventListener("click", () => {
          const doc = docs.find((d) => d.id === id);
          if (!doc) return;
          if (this.isDocAdded(doc.id)) this.host.removeContextDoc(doc.id);
          else this.host.addContextDoc(doc);
          this.renderSearchDoc();
          this.renderContextChips();
        });
      });
    };

    goBtn.addEventListener("click", doSearch);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
    });
  }

  /** 提示词：逗号分隔预设，点击直接插入输入框 */
  private renderPrompt(): void {
    const prompts: PromptItem[] = this.host.getPrompts();
    this.drawerEl.innerHTML = `
      <div class="cp-drawer-head">
        <span>提示词</span>
        <button class="cp-drawer-close" id="cp-drawer-close" title="关闭">✕</button>
      </div>
      <div class="cp-drawer-body">
        <div class="cp-prompt-tip">点击提示词，直接插入到输入框</div>
        <div class="cp-prompt-list">${prompts
          .map((p: PromptItem) => `<button class="cp-prompt-chip" data-id="${p.id}" title="${escapeHtml(p.content)}">${escapeHtml(p.label)}</button>`)
          .join("")}</div>
      </div>
    `;
    this.drawerEl.querySelector("#cp-drawer-close")?.addEventListener("click", () => this.closeDrawer());

    this.drawerEl.querySelectorAll(".cp-prompt-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).dataset.id!;
        const p = prompts.find((x) => x.id === id);
        if (!p) return;
        this.insertPrompt(p.content);
        this.closeDrawer();
      });
    });
  }

  /** 把提示词插入输入框（追加，不覆盖已有内容） */
  private insertPrompt(content: string): void {
    const cur = (this.inputEl.textContent ?? "").trim();
    const next = cur ? cur + "\n" + content : content;
    this.inputEl.textContent = next;
    this.inputEl.focus();
    // 光标移到末尾
    const range = document.createRange();
    range.selectNodeContents(this.inputEl);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  private isDocAdded(id: string): boolean {
    return this.host.getStore().getActive().contextDocs.some((d) => d.id === id);
  }

  /* ===================== 流式 / 生命周期 / 对话框 ===================== */

  /** 显示 / 隐藏「停止生成」按钮 */
  private showStop(show: boolean): void {
    const btn = this.root.querySelector("#cp-stop") as HTMLButtonElement | null;
    if (btn) btn.toggleAttribute("hidden", !show);
  }

  /** 流式渲染时节流滚动到底部，避免每帧 scroll 抖动 */
  private scrollToBottomThrottled(): void {
    const now = Date.now();
    if (now - this.lastScroll < 60) return;
    this.lastScroll = now;
    this.scrollToBottom();
  }

  /** 面板销毁：中断可能进行中的流式请求，避免卸载后仍写入已销毁 DOM */
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /** 重命名会话：用 SiYuan 原生对话框替代 window.prompt（更美观、可稳定弹出） */
  private promptRename(current: string): Promise<string | null> {
    return new Promise((resolve) => {
      const content = `
        <div class="cp-dlg">
          <input class="cp-dlg-input" id="cp-dlg-rename" value="${escapeHtml(current)}" placeholder="会话名称"/>
          <div class="cp-dlg-actions">
            <button class="cp-dlg-btn" id="cp-dlg-cancel">取消</button>
            <button class="cp-dlg-btn cp-dlg-btn--primary" id="cp-dlg-ok">确定</button>
          </div>
        </div>`;
      const dlg = new Dialog({ title: "重命名会话", content, width: "320px", height: "180px" });
      const root = dlg.element;
      const input = root.querySelector("#cp-dlg-rename") as HTMLInputElement | null;
      const finish = (val: string | null) => { dlg.destroy(); resolve(val); };
      root.querySelector("#cp-dlg-cancel")?.addEventListener("click", () => finish(null));
      root.querySelector("#cp-dlg-ok")?.addEventListener("click", () => finish((input?.value ?? "").trim() || null));
      input?.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); finish((input.value ?? "").trim() || null); }
        else if (e.key === "Escape") finish(null);
      });
      setTimeout(() => input?.focus(), 0);
    });
  }

  /** 删除确认：用 SiYuan 原生对话框替代 window.confirm */
  private confirmDelete(): Promise<boolean> {
    return new Promise((resolve) => {
      const content = `
        <div class="cp-dlg">
          <div class="cp-dlg-text">确认删除该会话？此操作不可撤销。</div>
          <div class="cp-dlg-actions">
            <button class="cp-dlg-btn" id="cp-dlg-cancel">取消</button>
            <button class="cp-dlg-btn cp-dlg-btn--danger" id="cp-dlg-ok">删除</button>
          </div>
        </div>`;
      const dlg = new Dialog({ title: "删除会话", content, width: "320px", height: "160px" });
      const root = dlg.element;
      const finish = (val: boolean) => { dlg.destroy(); resolve(val); };
      root.querySelector("#cp-dlg-cancel")?.addEventListener("click", () => finish(false));
      root.querySelector("#cp-dlg-ok")?.addEventListener("click", () => finish(true));
    });
  }

  /* ===================== 工具方法 ===================== */
  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  private fmtTime(ts: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
