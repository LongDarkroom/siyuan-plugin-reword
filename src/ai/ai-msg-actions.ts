/**
 * REword · AI 面板消息操作组（P1-4 自 ai-panel.ts 机械拆出）
 * ------------------------------------------------------------------
 * 结果气泡/消息工具栏的全部交互动作：词栏入库、复制、保存到笔记、
 * 编辑消息、重试、查询面板筛选。零行为变更——只是把类方法搬成
 * 「函数收 panel 参数」的独立模块；ai-panel.ts 保留同名薄委托方法。
 *
 * 依赖注入方式：`import type { AiPanel }` 仅类型引用（构建时擦除），
 * 不产生运行时循环依赖；被访问的 panel 字段/方法在 ai-panel.ts 侧
 * 标注 `@internal`（TS public）。
 */
import { t } from "../i18n/index.ts";
import type { AiPanel } from "./ai-panel.ts";
import type { DeepReadResult, DeepReadWord } from "./ai-orchestrator.ts";
import { renderWithLute } from "./ai-render.ts";
import { enhanceSiYuanRender } from "./ai-enhance.ts";
import { sessionStore } from "./ai-session-store.ts";
import { renderSaveToNoteDialog, renderSaveToNoteTree } from "./ai-dialogs.ts";
import { renderAnnotationHTML } from "../annotation/whale-renderer.ts";
import type { AnnotationQueryResult } from "../annotation/annotation-query.ts";
import { renderMarkdown, escapeHtml } from "../core/markdown.ts";
import { getLogger } from "../core/logger.ts";
import { logSwallow } from "../core/safe.ts";
import { showMessage } from "siyuan";

/** 绑定悬浮词栏（renderVocabBar 输出的全不选 / 主题 / 入库） */
export function bindVocabBar(p: AiPanel, resultEl: HTMLElement, result: DeepReadResult, blockId?: string): void {
  const bar = resultEl.querySelector(".hiword-ai-vocab-bar") as HTMLElement | null;
  if (!bar) return;

  // 填充目标本下拉（默认词库 + 用户词库）
  const targets = p.host.getVocabTargets();
  const bookSel = bar.querySelector('[data-field="book"]') as HTMLSelectElement | null;
  if (bookSel) {
    const opts = [`<option value="">${t("（默认词库）")}</option>`];
    targets.books.forEach((b) => {
      opts.push(`<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`);
    });
    bookSel.innerHTML = opts.join("");
  }

  const getCheckedWords = (): DeepReadWord[] => {
    const checked = Array.from(resultEl.querySelectorAll<HTMLInputElement>('.hiword-ai-sel[data-kind="word"]:checked'));
    if (checked.length) {
      const set = new Set(checked.map((c) => (c as HTMLElement).dataset.word || ""));
      return result.words.filter((w) => set.has(w.word));
    }
    return result.words;
  };

  // 「全不选」按钮
  bar.querySelector('[data-act="none"]')?.addEventListener("click", () => {
    resultEl.querySelectorAll<HTMLInputElement>('.hiword-ai-sel[data-kind="word"]').forEach((c) => {
      c.checked = false;
      c.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  // 主题 chips：点击切换 active（视觉态），具体主题随词库目标本决定，这里仅作为过滤标签
  const chips = bar.querySelectorAll<HTMLElement>(".hiword-ai-theme-chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
    });
  });

  // 「添加到词库」按钮
  bar.querySelector('[data-act="add"]')?.addEventListener("click", () => {
    const sel = getCheckedWords();
    if (!sel.length) {
      const statusEl = document.querySelector("#hiword-ai-status") as HTMLElement | null;
      if (statusEl) statusEl.textContent = t("请先勾选要入库的单词。");
      return;
    }
    const bookSel = bar.querySelector('[data-field="book"]') as HTMLSelectElement | null;
    const bookId = bookSel?.value || undefined;
    const activeTheme = bar.querySelector(".hiword-ai-theme-chip.active") as HTMLElement | null;
    const themeId = activeTheme?.dataset.theme || undefined;
    void collectCheckedWords(p, sel, bookId, themeId, resultEl, blockId);
  });
}

/** 把选中词写入词库（同步上下文例句 / 标记 #未掌握 / 继承主题标签） */
export async function collectCheckedWords(
  p: AiPanel,
  sel: DeepReadWord[],
  bookId: string | undefined,
  themeId: string | undefined,
  resultEl: HTMLElement,
  blockId?: string
): Promise<void> {
  const statusEl = document.querySelector("#hiword-ai-status") as HTMLElement | null;
  if (statusEl) statusEl.textContent = t("入库中（{n} 词）…", { n: sel.length });
  let added = 0;
  for (const w of sel) {
    try {
      const r = await p.host.collectWord(w, bookId, themeId, {
        example: w.context,
        markUnmastered: true,
        inheritThemeTags: true,
      });
      if (r.added) added++;
    } catch (__swallowErr) { logSwallow(__swallowErr, "ai-msg-actions.ts · collectCheckedWords", "debug"); }
  }
  if (statusEl) statusEl.textContent = t("入库完成：新增 {n} 个单词", { n: added });
  // 把已入库的复选框置灰
  resultEl.querySelectorAll<HTMLInputElement>('.hiword-ai-sel[data-kind="word"]').forEach((c) => {
    const word = (c as HTMLElement).dataset.word || "";
    if (sel.some((w) => w.word === word)) {
      c.checked = false;
      c.disabled = true;
    }
  });
}

/** 绑定结果区内的收藏按钮（单词收藏 / 上下文 + 学习模式 / 逐句批注） */
export function bindResult(p: AiPanel, resultEl: HTMLElement, blockId?: string, result?: DeepReadResult): void {
  // 学习模式下单词行内 ＋收藏
  resultEl.querySelectorAll(".hiword-ai-collect").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const w = (btn as HTMLElement).dataset.word || "";
      if (!w) return;
      try {
        await p.host.collectWord({ word: w, meaning: "" });
        (btn as HTMLButtonElement).textContent = t("已收藏");
        (btn as HTMLButtonElement).disabled = true;
      } catch (e: any) {
        (btn as HTMLElement).textContent = t("失败");
      }
    });
  });

  // P1-B 第 1 层：引文回链（点击跳回原文块，两段式回退见 openRefInSiyuan）
  resultEl.querySelectorAll<HTMLElement>(".hiword-ai-quote-jump[data-block-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.blockId || "";
      if (id) void p.openRefInSiyuan(id, "block");
    });
  });

  // 第 5 批：逐句「批注到原文」（settings.annotateSentences 开启才渲染出按钮）。
  // 单句粒度写入批注（note = 结构 + 译文），来源块优先取 result.sourceBlockId（原文块），
  // 回退到本次发送时携带的 blockId。
  resultEl.querySelectorAll<HTMLButtonElement>(".hiword-ai-anno[data-sent-idx]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.sentIdx);
      const s = result?.sentences?.[idx];
      if (!s) return;
      const bid = result?.sourceBlockId || blockId || "";
      if (!bid) {
        showMessage(t("无法定位来源块，请先在文档中选中内容再批注"), 3000, "error");
        return;
      }
      btn.disabled = true;
      btn.textContent = t("写入中…");
      try {
        const n = await p.host.annotateSentences([s], bid);
        btn.textContent = n > 0 ? t("已批注") : t("未写入");
        if (n > 0) btn.classList.add("hiword-ai-anno--done");
        else btn.disabled = false;
      } catch (e) {
        btn.textContent = t("失败");
        btn.disabled = false;
        getLogger().error("逐句批注写入失败", { operation: "annotateSentences", error: e as Error });
      }
    });
  });
}

/** 提取消息内容纯文本：克隆节点，将已渲染的数学公式还原为原始写法，再读取 innerText */
export function getMessagePlainText(content: HTMLElement): string {
  const clone = content.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-content]").forEach((n) => {
    const raw = (n as HTMLElement).getAttribute("data-content");
    if (raw != null) n.textContent = raw;
  });
  clone.querySelectorAll(".hiword-ai-collect, .hiword-ai-vocab-bar, .hiword-ai-word-cb").forEach((n) => n.remove());
  return (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
}

/** 绑定消息工具栏事件（复制 Markdown/TXT、保存到笔记、编辑、重试） */
export function bindMessageToolbar(p: AiPanel, msgEl: HTMLElement, index: number, role: "user" | "assistant"): void {
  const contentEl = msgEl.querySelector(".hiword-ai-msg-content") as HTMLElement | null;
  if (!contentEl) return;

  const getRawMd = (): string => {
    if (role === "user") {
      return p.chatHistory[index]?.content || "";
    }
    // 优先读 JS Map（P3-2 替代 data-raw-md 属性），兜底读旧属性/历史
    return p.rawMdByIndex.get(index) || contentEl.dataset.rawMd || p.chatHistory[index]?.content || "";
  };

  // 复制 Markdown
  msgEl.querySelector('[data-act="copy-md"]')?.addEventListener("click", () => {
    const md = getRawMd();
    if (!md.trim()) { showMessage(t("本条暂无 Markdown 可复制"), 2000, "info"); return; }
    p.host.copyText(md);
    showMessage(t("已复制 Markdown"), 2000, "info");
  });

  // 复制 TXT
  msgEl.querySelector('[data-act="copy-txt"]')?.addEventListener("click", () => {
    const text = getMessagePlainText(contentEl);
    if (!text) { showMessage(t("本条暂无内容可复制"), 2000, "info"); return; }
    p.host.copyText(text);
    showMessage(t("已复制纯文本"), 2000, "info");
  });

  // 保存到笔记
  msgEl.querySelector('[data-act="save-note"]')?.addEventListener("click", () => {
    void openSaveToNoteDialog(p, getRawMd());
  });

  // 编辑
  msgEl.querySelector('[data-act="edit"]')?.addEventListener("click", () => {
    if (role === "user") {
      editUserMessage(p, index);
    } else {
      void editAssistantMessage(p, msgEl, index);
    }
  });

  // 重试（仅 AI 消息）
  if (role === "assistant") {
    msgEl.querySelector('[data-act="retry"]')?.addEventListener("click", () => {
      void retryAssistantMessage(p, index);
    });
  }
}

/** 打开「保存到笔记」对话框 */
export async function openSaveToNoteDialog(p: AiPanel, markdown: string): Promise<void> {
  if (!p.openOverlay) {
    // P3-2：overlay 未初始化时不再静默 return，给出反馈避免「点保存无反应」
    showMessage(t("保存面板尚未就绪，请稍候重试"), 3000, "error");
    return;
  }
  const notebooks = await p.host.listNotebooks();
  if (!notebooks.length) {
    showMessage(t("未找到可用笔记本"), 3000, "error");
    return;
  }
  p.openOverlay(renderSaveToNoteDialog({ notebooks }));
  const panel = p.overlay?.querySelector(".hiword-ai-overlay-panel") as HTMLElement | null;
  if (!panel) return;

  const notebookSel = panel.querySelector('[data-field="notebook"]') as HTMLSelectElement;
  const pathInput = panel.querySelector('[data-field="path"]') as HTMLInputElement;
  const titleInput = panel.querySelector('[data-field="title"]') as HTMLInputElement;
  const treeEl = panel.querySelector('[data-field="tree"]') as HTMLElement;

  const loadTree = async (notebookId: string, path = "") => {
    if (!treeEl) return;
    treeEl.innerHTML = `<div class="hiword-ai-savenote-empty">${t("加载中…")}</div>`;
    try {
      const nodes = await p.host.listDocTree(notebookId, path);
      treeEl.innerHTML = renderSaveToNoteTree(nodes);
      bindTreeEvents();
    } catch {
      treeEl.innerHTML = `<div class="hiword-ai-savenote-empty">${t("加载失败")}</div>`;
    }
  };

  const bindTreeEvents = () => {
    panel.querySelectorAll(".hiword-ai-savenote-node").forEach((node) => {
      const el = node as HTMLElement;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const children = el.nextElementSibling as HTMLElement | null;
        if (children?.classList.contains("hiword-ai-savenote-children")) {
          const isHidden = children.style.display === "none";
          children.style.display = isHidden ? "" : "none";
          const toggle = el.querySelector(".hiword-ai-savenote-toggle");
          if (toggle) toggle.textContent = isHidden ? "▼" : "▸";
        }
        const pathVal = el.dataset.path;
        if (pathVal != null && pathInput) {
          pathInput.value = pathVal;
        }
      });
    });
  };

  notebookSel?.addEventListener("change", () => {
    const id = notebookSel.value;
    if (id) loadTree(id);
  });

  // 初始加载第一个笔记本的树
  if (notebooks[0]?.id) loadTree(notebooks[0].id);

  panel.querySelector('[data-act="cancel"]')?.addEventListener("click", () => {
    if (p.overlay) { p.overlay.style.display = "none"; p.overlay.innerHTML = ""; }
  });
  p.overlay?.querySelector('[data-act="close-overlay"]')?.addEventListener("click", () => {
    if (p.overlay) { p.overlay.style.display = "none"; p.overlay.innerHTML = ""; }
  });

  panel.querySelector('[data-act="confirm"]')?.addEventListener("click", async () => {
    const notebookId = notebookSel?.value || "";
    const path = pathInput?.value || "";
    const title = titleInput?.value || "";
    const openAfterSave = (panel.querySelector('[data-field="openAfterSave"]') as HTMLInputElement)?.checked ?? true;
    if (!notebookId) { showMessage(t("请选择笔记本"), 2500, "info"); return; }
    try {
      const docId = await p.host.saveToNote({ markdown, notebookId, path, title, openAfterSave });
      if (p.overlay) { p.overlay.style.display = "none"; p.overlay.innerHTML = ""; }
      showMessage(t("已保存到笔记 ({id}…)", { id: docId.slice(0, 8) }), 2500, "success" as any);
    } catch (e: any) {
      showMessage(t("保存失败：{msg}", { msg: e?.message || e }), 3000, "error");
    }
  });
}

/** 编辑用户消息：回填输入框并截断后续上下文 */
export function editUserMessage(p: AiPanel, index: number): void {
  const msg = p.chatHistory[index];
  if (!msg || msg.role !== "user") return;
  p.setInputMarkdown(msg.content);
  // 截断到该消息之前
  p.chatHistory = p.chatHistory.slice(0, index);
  // 同步 session store
  if (p.currentSessionId) {
    sessionStore.saveMessages(
      p.currentSessionId,
      p.chatHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content, ts: Date.now() }))
    );
  }
  // 删除 DOM 中该消息及之后的所有消息
  const messagesEl = p.contentEl?.querySelector("#hiword-ai-messages") as HTMLElement | null;
  if (messagesEl) {
    const all = Array.from(messagesEl.querySelectorAll(".hiword-ai-msg"));
    for (const el of all) {
      const idx = parseInt((el as HTMLElement).dataset.index || "-1", 10);
      if (idx >= index) el.remove();
    }
    // 重新校正剩余消息的索引
    reindexMessages(messagesEl);
  }
  const inputEl = p.contentEl?.querySelector("#hiword-ai-input") as HTMLElement | null;
  inputEl?.focus();
}

/** 重新校正消息 DOM 的 data-index */
export function reindexMessages(messagesEl: HTMLElement): void {
  const msgs = Array.from(messagesEl.querySelectorAll(".hiword-ai-msg"));
  msgs.forEach((el, i) => { (el as HTMLElement).dataset.index = String(i); });
}

/** 编辑 AI 消息：就地进入 Markdown 编辑，保存后更新并重渲染 */
export async function editAssistantMessage(p: AiPanel, msgEl: HTMLElement, index: number): Promise<void> {
  const contentEl = msgEl.querySelector(".hiword-ai-msg-content") as HTMLElement | null;
  if (!contentEl) return;
  const rawMd = p.rawMdByIndex.get(index) || contentEl.dataset.rawMd || p.chatHistory[index]?.content || "";

  contentEl.style.display = "none";
  const editor = document.createElement("div");
  editor.className = "hiword-ai-msg-editor";
  editor.innerHTML = `
    <textarea class="hiword-ai-msg-editor-text" spellcheck="false">${escapeHtml(rawMd)}</textarea>
    <div class="hiword-ai-msg-editor-actions">
      <button class="hiword-ai-btn hiword-ai-btn--ghost" data-act="cancel">取消</button>
      <button class="hiword-ai-btn hiword-ai-btn--primary" data-act="save">保存</button>
    </div>
  `;
  contentEl.after(editor);
  const textarea = editor.querySelector("textarea") as HTMLTextAreaElement;
  textarea.focus();

  const cleanup = () => {
    contentEl.style.display = "";
    editor.remove();
  };

  editor.querySelector('[data-act="cancel"]')?.addEventListener("click", cleanup);
  editor.querySelector('[data-act="save"]')?.addEventListener("click", () => {
    const newMd = textarea.value;
    // 更新内存与持久化
    if (p.chatHistory[index]) {
      p.chatHistory[index].content = newMd;
    }
    if (p.currentSessionId) {
      const sess = sessionStore.get(p.currentSessionId);
      if (sess && sess.messages[index]) {
        sess.messages[index].content = newMd;
        sess.messages[index].html = undefined; // 强制重新渲染
        sessionStore.saveMessages(p.currentSessionId, sess.messages);
      }
    }
    // 重渲染内容区（保留工具栏，避免 innerHTML 覆盖后丢失）
    const toolbar = contentEl.querySelector(".hiword-ai-msg-toolbar");
    contentEl.innerHTML = renderWithLute(newMd);
    if (toolbar) contentEl.appendChild(toolbar);
    p.rawMdByIndex.set(index, newMd);
    enhanceSiYuanRender(contentEl);
    cleanup();
    showMessage(t("已更新消息"), 2000, "success" as any);
  });
}

/** 重试 AI 消息：保留更早上下文，用前一条用户消息重新生成 */
export async function retryAssistantMessage(p: AiPanel, index: number): Promise<void> {
  if (index <= 0 || index >= p.chatHistory.length) {
    showMessage(t("没有可重试的用户消息"), 2000, "info");
    return;
  }
  const prevUser = p.chatHistory[index - 1];
  if (prevUser?.role !== "user") {
    showMessage(t("上一条不是用户消息，无法重试"), 2000, "info");
    return;
  }
  // 截断到前一条用户消息之前
  p.chatHistory = p.chatHistory.slice(0, index - 1);
  if (p.currentSessionId) {
    sessionStore.saveMessages(
      p.currentSessionId,
      p.chatHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content, ts: Date.now() }))
    );
  }
  // 删除 DOM 中前一条用户消息及之后的所有消息
  const messagesEl = p.contentEl?.querySelector("#hiword-ai-messages") as HTMLElement | null;
  if (messagesEl) {
    const all = Array.from(messagesEl.querySelectorAll(".hiword-ai-msg"));
    for (const el of all) {
      const idx = parseInt((el as HTMLElement).dataset.index || "-1", 10);
      if (idx >= index - 1) el.remove();
    }
    reindexMessages(messagesEl);
  }
  // 回填输入框并触发发送
  p.setInputMarkdown(prevUser.content);
  const runBtn = p.contentEl?.querySelector("#hiword-ai-run") as HTMLButtonElement | null;
  runBtn?.click();
}

/** 加载查询面板的筛选选项（颜色列表 + 文档列表） */
export async function loadQueryFilters(
  p: AiPanel,
  colorSelect: HTMLSelectElement | null,
  docSelect: HTMLSelectElement | null
): Promise<void> {
  // 颜色选项（与批注对话框一致）
  const colors = [
    { value: "", label: t("全部颜色") },
    { value: "#4285f4", label: t("蓝色") },
    { value: "#0d9e5f", label: t("翠绿") },
    { value: "#e6a23c", label: t("琥珀") },
    { value: "#db3f84", label: t("玫红") },
    { value: "#5b6ee1", label: t("靛蓝") },
    { value: "#17a2b8", label: t("青色") },
    { value: "#f06543", label: t("珊瑚") },
    { value: "#6c757d", label: t("石板") },
  ];
  if (colorSelect) {
    colorSelect.innerHTML = colors
      .map((c) => `<option value="${c.value}">${c.label}</option>`)
      .join("");
  }

  // 文档选项（从 host 获取已批注文档列表）
  if (docSelect) {
    try {
      const docIds = await p.host.getAnnotatedDocIds();
      docSelect.innerHTML = `<option value="">${t("全部文档")}</option>`;
      for (const did of docIds) {
        // 尝试获取文档标题
        const label = did.slice(0, 12) + (did.length > 12 ? "…" : "");
        const opt = document.createElement("option");
        opt.value = did;
        opt.textContent = label;
        docSelect.appendChild(opt);
      }
    } catch {
      // 静默失败，保持默认
    }
  }
}

/** 渲染查询结果列表 */
export function renderQueryResults(
  container: HTMLElement,
  result: AnnotationQueryResult
): void {
  if (!result.items.length) {
    container.innerHTML = `
      <div class="hiword-ai-query-empty">
        <p>未找到匹配的批注</p>
        <p class="hiword-ai-query-hint">试试放宽筛选条件或更换关键词</p>
      </div>`;
    return;
  }

  const renderNote = (note: string) => {
    const html = renderAnnotationHTML(note);
    return html || renderMarkdown(note);
  };

  const html = result.items.map((a, i) => {
    const colorDot = a.color
      ? `<span class="hiword-ai-q-color-dot" style="background:${escapeHtml(a.color)}"></span>`
      : "";
    const timeShort = a.createdAt.slice(5, 16).replace("T", " ");
    return `
      <div class="hiword-ai-q-item" data-id="${escapeHtml(a.id)}">
        <div class="hiword-ai-q-item-head">
          ${colorDot}
          <span class="hiword-ai-q-item-num">#${i + 1}</span>
          <span class="hiword-ai-q-item-origin">${a.origin === "ai" ? "AI" : t("手动")}</span>
          <span class="hiword-ai-q-item-time">${timeShort}</span>
        </div>
        ${a.selectedText
          ? `<div class="hiword-ai-q-item-sel">${t("选中：")}${escapeHtml(a.selectedText)}</div>`
          : ""}
        ${a.note ? `<div class="hiword-ai-q-item-note b3-typography">${renderNote(a.note)}</div>` : ""}
      </div>`;
  }).join("");

  container.innerHTML = `<div class="hiword-ai-q-list">${html}</div>`;
}
