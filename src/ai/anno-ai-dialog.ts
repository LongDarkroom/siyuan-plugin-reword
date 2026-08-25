/**
 * REword · 微阅批注 AI 助手小弹窗（2026-08-22）
 * ------------------------------------------------------------------
 * 在微阅批注弹窗底部提供 🤖 AI 按钮，点击后弹出独立小窗：
 *  - 默认填入选中文字 + 上下文 + 现有批注
 *  - 用户可在输入框追加问题（"翻译成中文"、"扩写"、"改写更学术"等）
 *  - 复用 requestAIStream 流式生成（OpenAI 兼容设置）
 *  - 复制 / 取消 / 清空 / "填回批注" 全套
 *
 * 设计原则：
 *  - 简单、独立、不依赖 AI dock 开关（用户批注场景单独可用）
 *  - 弹窗 HTML 与发送逻辑都做纯函数化便于单测
 *  - 关闭 AI 弹窗后,点击"填回批注"会用 prefillNote 重开批注弹窗
 *    （与"新建批注"语义一致,颜色/标签等设置都保留）
 */
import { requestAIStream } from "../copilot/ai/ai-client.ts";
import type { AiMessage } from "../copilot/ai/ai-client.ts";
import type { AiSettings } from "./ai-settings.ts";
import { toEngineSettings } from "./ai-orchestrator.ts";
import { getLogger } from "../core/logger.ts";
import { renderWithLute } from "./ai-render.ts";

// ============ 纯函数(可单测)============

/**
 * 构造 AI 助手的系统提示词：明确助手身份 + 输出约束。
 * 输出为纯文本批注草稿,无需 Markdown 包装,直接填入批注编辑器。
 */
export const ANNO_AI_SYSTEM_PROMPT = `你是 REword 英语学习助手，正在帮用户改进他/她在微阅批注中写下的笔记。

【你的任务】
- 接收：用户选中的英文片段、上下文句子、当前批注内容（可能为空）、用户的附加问题。
- 输出：一段适合直接粘贴到批注编辑器的中文/中英混合批注草稿。
- 风格：简洁、贴合语境、像学习者自己写的笔记；避免学术化堆砌。
- 如果用户没给附加问题：基于选中词和上下文补写/润色当前批注（如果当前批注为空则新建；如果已写则润色/扩写）。
- 如果用户给了附加问题（如"翻译成中文"/"换成学术口吻"/"加一句例句"）：按问题执行。

【输出格式】
- 纯文本，不要 Markdown、不要代码块、不要解释。
- 1~3 段,每段不超过 80 字。
- 含例句时格式："例句: <英文> — <中文>"。`;

/**
 * 解析批注上下文：抽出选中文字、上下文、现有批注,做容错。
 */
export function parseAnnoAiContext(input: {
  selectedText?: string | null;
  sentence?: string | null;
  existingNote?: string | null;
}): { userSelectedText: string; sentenceContext: string; currentNote: string } {
  const userSelectedText = (input.selectedText || "").trim();
  const sentenceContext = (input.sentence || "").trim();
  const currentNote = (input.existingNote || "").trim();
  return { userSelectedText, sentenceContext, currentNote };
}

/**
 * 拼装给 AI 的用户消息：
 *   1) 选中片段 2) 上下文句子 3) 当前批注 4) 用户追加问题
 * 任一字段为空时省略对应行,但保留顺序稳定。
 */
export function buildAnnoAiUserMessage(input: {
  selectedText?: string | null;
  sentence?: string | null;
  existingNote?: string | null;
  question?: string | null;
}): string {
  const { userSelectedText, sentenceContext, currentNote } = parseAnnoAiContext(input);
  const question = (input.question || "").trim();

  const parts: string[] = [];
  if (userSelectedText) parts.push(`【选中片段】\n${userSelectedText}`);
  if (sentenceContext && sentenceContext !== userSelectedText) {
    parts.push(`【上下文】\n${sentenceContext}`);
  }
  if (currentNote) {
    parts.push(`【当前批注】\n${currentNote}`);
  } else {
    parts.push(`【当前批注】\n（空,需要新建）`);
  }
  if (question) {
    parts.push(`【我的问题】\n${question}`);
  } else if (!currentNote) {
    parts.push(`【我的问题】\n请基于选中片段写一段批注,2 段以内。`);
  }
  return parts.join("\n\n");
}

/**
 * 弹窗 HTML 模板(纯函数,便于单测)。
 *  - 2026-08-22 重构（plan §2.1）：
 *    移除与左侧微阅批注弹窗重复的 context 卡(选中/现有批注)；
 *    主体改为"AI 回复区 + chevron 手柄 + 输入区"两段式；
 *    reply 区由 textContent 改为 Lute 渲染容器（流式按 token 增量渲染）。
 *  - 2026-08-22 新增：选区菜单（全部填入 / 选取填入）默认 display:none，由 mouseup 触发显示。
 */
export function renderAnnoAiDialogHtml(
  opts: {
    selectedText: string;
    existingNote: string;
    hasApiKey: boolean;
    isStreaming: boolean;
    reply: string;
  },
  esc: (s: string) => string
): string {
  const noKeyWarn = opts.hasApiKey
    ? ""
    : `<div class="hiword-anno-ai-nokey">未配置 AI 服务（API Key/BaseUrl 为空）<button type="button" class="hiword-anno-ai-open-settings" id="hiword-anno-ai-open-settings">去设置</button></div>`;

  return `
    <div class="hiword-anno-ai-dialog">
      <div class="hiword-anno-ai-head" data-drag-handle>
        <span class="hiword-anno-ai-title">🤖 微阅批注助手</span>
        <button class="hiword-anno-ai-close" id="hiword-anno-ai-close" title="关闭">✕</button>
        <button class="hiword-anno-ai-settings" id="hiword-anno-ai-settings" title="填回批注设置">⚙</button>
      </div>
      <div class="hiword-anno-ai-no-key-wrap">${noKeyWarn}</div>

      <!-- 上：AI 内容展示区(Lute 渲染) -->
      <div class="hiword-anno-ai-reply" id="hiword-anno-ai-reply"></div>

      <!-- 中：chevron 手柄(可点击+可拖拽) -->
      <div class="hiword-anno-ai-resizer" id="hiword-anno-ai-resizer" title="点击收起输入区 / 拖动调整高度">
        <button class="hiword-anno-ai-resizer-toggle" id="hiword-anno-ai-resizer-toggle" aria-label="收起输入区" type="button">▾</button>
      </div>

      <!-- 下：输入区(可整体收起) -->
      <div class="hiword-anno-ai-footer" id="hiword-anno-ai-footer">
        <textarea class="hiword-anno-ai-textarea" id="hiword-anno-ai-input" rows="3"
          placeholder="附加问题（可空，回车发送 / 流式中回车取消）"></textarea>
      </div>

      <!-- 选区菜单(默认隐藏，reply 容器内选词时显示) -->
      <div class="hiword-anno-ai-selmenu" id="hiword-anno-ai-selmenu" style="display:none" role="menu">
        <button type="button" data-fill="all">全部填入</button>
        <button type="button" data-fill="selection">选取填入</button>
      </div>

      <!-- 2026-08-22 新增：弹窗 8 向 resize 手柄(4 边 + 4 角) -->
      <div class="hiword-anno-ai-resize-handle hiword-anno-ai-resize-handle--n"  data-dir="n"></div>
      <div class="hiword-anno-ai-resize-handle hiword-anno-ai-resize-handle--s"  data-dir="s"></div>
      <div class="hiword-anno-ai-resize-handle hiword-anno-ai-resize-handle--w"  data-dir="w"></div>
      <div class="hiword-anno-ai-resize-handle hiword-anno-ai-resize-handle--e"  data-dir="e"></div>
      <div class="hiword-anno-ai-resize-handle hiword-anno-ai-resize-handle--nw" data-dir="nw"></div>
      <div class="hiword-anno-ai-resize-handle hiword-anno-ai-resize-handle--ne" data-dir="ne"></div>
      <div class="hiword-anno-ai-resize-handle hiword-anno-ai-resize-handle--sw" data-dir="sw"></div>
      <div class="hiword-anno-ai-resize-handle hiword-anno-ai-resize-handle--se" data-dir="se"></div>

      <!-- 2026-08-22 新增：填回批注设置菜单(默认隐藏) -->
      <div class="hiword-anno-ai-settings-menu" id="hiword-anno-ai-settings-menu" style="display:none" role="menu">
        <button type="button" data-fill="all">填入全部回复</button>
        <button type="button" data-fill="selection">填入选中部分</button>
      </div>
    </div>
  `;
}

/**
 * 2026-08-22 新增：从 AI 回复容器提取要填入批注的文本（纯函数,可单测）。
 * - "all" 模式：取 innerText（已 trim，过滤 NBSP）
 * - "selection" 模式：取 window.getSelection().toString()
 */
export function extractReplyText(
  replyHtml: string,
  selectionText: string,
  mode: "all" | "selection",
): string {
  const normalize = (s: string) =>
    (s || "")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/[ \t]*\n[ \t]*/g, "\n")  // 去掉换行前后的空格
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  if (mode === "all") {
    // replyHtml 是已渲染的 HTML,block 边界(</p>/<br>)插入换行,内联标签替换为空格
    const withBreaks = replyHtml
      .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n");
    const plain = withBreaks
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    return normalize(plain);
  }
  return normalize(selectionText);
}

/**
 * 2026-08-22 新增：应用 AI 助手弹窗的"输入区收起/展开"状态。
 * - 写 localStorage["hiword-anno-ai-collapsed"] = "true"/"false"
 * - 切换 .hiword-anno-ai-dialog--collapsed class
 * - 切换 chevron 文字与 aria-label
 * 纯函数：DOM 操作隔离在此处，单元测试可通过 mock 容器调用。
 */
export function applyAnnoAiCollapsedState(
  root: HTMLElement,
  isCollapsed: boolean,
  lastFooterHeight?: number,
): void {
  const dialog = root.querySelector(".hiword-anno-ai-dialog") as HTMLElement | null;
  const footer = root.querySelector("#hiword-anno-ai-footer") as HTMLElement | null;
  const toggle = root.querySelector("#hiword-anno-ai-resizer-toggle") as HTMLElement | null;
  if (!dialog || !footer || !toggle) return;
  if (isCollapsed) {
    dialog.classList.add("hiword-anno-ai-dialog--collapsed");
    footer.style.maxHeight = "0";
    footer.style.minHeight = "0";
    toggle.setAttribute("aria-label", "展开输入区");
    toggle.textContent = "▴";
  } else {
    dialog.classList.remove("hiword-anno-ai-dialog--collapsed");
    if (lastFooterHeight && lastFooterHeight >= 80) {
      footer.style.maxHeight = `${lastFooterHeight}px`;
    } else {
      footer.style.maxHeight = "";
    }
    footer.style.minHeight = "";
    toggle.setAttribute("aria-label", "收起输入区");
    toggle.textContent = "▾";
  }
  try {
    localStorage.setItem("hiword-anno-ai-collapsed", String(isCollapsed));
  } catch {
    /* 隐私模式静默 */
  }
}

/**
 * 2026-08-22 新增：从 localStorage 读取初始收起/展开状态（纯函数,可单测）。
 * SSR/隐私模式下 localStorage 不可用 → 默认展开。
 */
export function computeAnnoAiInitialCollapsed(storage: { getItem(k: string): string | null }): boolean {
  try {
    return storage.getItem("hiword-anno-ai-collapsed") === "true";
  } catch {
    return false;
  }
}

// ============ DOM 主入口(开弹窗 + 事件)============

/** AI 弹窗入参:从微阅批注弹窗传来 */
export interface AnnoAiDialogOptions {
  selectedText: string;
  sentence: string;
  blockId: string;
  docId: string;
  existingNote?: string;
  /**
   * 父批注弹窗元素(2026-08-22 改:批注弹窗保持打开,AI 弹窗贴它旁边)
   *  - undefined 时回退到居中偏上定位
   */
  parentDialog?: HTMLElement;
  /**
   * 填回批注的回调(2026-08-22 改:由 host 决定具体填回策略)
   *  - 关闭 AI 弹窗在回调执行**之前**已完成,避免嵌套 DOM
   *  - 典型实现:whale-manager.setNoteContent(reply) 就地写编辑器
   */
  onFillBack: (reply: string) => void;
  getAiSettings: () => AiSettings;
  openAiSettings: () => void;
  showMessage: (msg: string, type?: "info" | "success" | "error") => void;
}

/**
 * 打开 AI 助手弹窗。
 * - 复用 requestAIStream 流式生成（OpenAI 兼容）
 * - "填回批注" 调用 onFillBack,由 index.ts 关闭 AI 弹窗并用 prefillNote 重开批注弹窗
 * - "复制回复" 走 navigator.clipboard（思源内可用）
 */
export function openAnnoAiDialog(opts: AnnoAiDialogOptions): void {
  // 1) 关旧弹窗（避免多弹窗并发）
  const old = document.getElementById("hiword-anno-ai-dialog-root");
  if (old) old.remove();

  // 2) 容器
  const root = document.createElement("div");
  root.id = "hiword-anno-ai-dialog-root";
  root.className = "hiword-anno-ai-popup";
  document.body.appendChild(root);

  // 3) 状态
  let reply = "";            // 原始 markdown 累积
  let replyHtml = "";        // 2026-08-22 新增：Lute 渲染后的 HTML（用于填回/复制）
  let isStreaming = false;
  let abortController: AbortController | null = null;
  // 2026-08-22 新增：流式渲染节流（raf 单帧合并，避免每 token 触发 Lute）
  let renderRaf = 0;
  let savedFooterHeight = 0;  // 收起时记下展开态高度,展开时恢复

  const esc = (s: string) =>
    (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // 4) 渲染函数
  const render = () => {
    const settings = opts.getAiSettings();
    root.innerHTML = renderAnnoAiDialogHtml(
      {
        selectedText: opts.selectedText,
        existingNote: opts.existingNote || "",
        hasApiKey: !!settings.apiKey,
        isStreaming,
        reply,
      },
      esc
    );
    // 2026-08-22 改：reply 容器走 Lute 渲染(独立于 innerHTML 重置)
    const replyEl = root.querySelector("#hiword-anno-ai-reply") as HTMLElement | null;
    if (replyEl) {
      if (replyHtml) {
        replyEl.innerHTML = replyHtml;
      } else {
        replyEl.innerHTML = "";
      }
    }
    // 2026-08-22 新增：恢复输入区收展状态
    const initiallyCollapsed = computeAnnoAiInitialCollapsed(localStorage);
    if (initiallyCollapsed) {
      const footer = root.querySelector("#hiword-anno-ai-footer") as HTMLElement | null;
      if (footer) savedFooterHeight = footer.offsetHeight || 0;
      applyAnnoAiCollapsedState(root, true, savedFooterHeight);
    }
    bindEvents();
    positionPopup();
  };

  // 5) 事件绑定
  const bindEvents = () => {
    // 关闭
    root.querySelector("#hiword-anno-ai-close")?.addEventListener("click", () => close());
    // 打开设置（2026-08-22 改：此按钮未配置 API key 时显示,常规不渲染）
    root.querySelector("#hiword-anno-ai-open-settings")?.addEventListener("click", () => {
      close();
      opts.openAiSettings();
    });
    // 2026-08-22 改：移除 [清空/复制回复/取消/发送/填回批注] 五个按钮,改用以下交互:
    //   - 发送: textarea 内回车
    //   - 取消: 流式中再按回车
    //   - 填回批注: 头部 ⚙ 按钮弹菜单(全部/选区)
    //   - 清空/复制: 不再提供,需要手动管理(复制走 ⌘C/右键)
    const inputEl = root.querySelector("#hiword-anno-ai-input") as HTMLTextAreaElement | null;
    inputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (isStreaming) {
          // 流式再按回车 → 取消生成
          abortController?.abort();
        } else {
          // 普通回车 → 发送
          doSend();
        }
      }
    });

    // ⚙ 填回批注设置菜单（2026-08-22 新增）
    const settingsBtn = root.querySelector("#hiword-anno-ai-settings") as HTMLElement | null;
    const settingsMenu = root.querySelector("#hiword-anno-ai-settings-menu") as HTMLElement | null;
    if (settingsBtn && settingsMenu) {
      settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const visible = settingsMenu.style.display !== "none";
        if (visible) {
          settingsMenu.style.display = "none";
        } else {
          settingsMenu.style.display = "flex";
          settingsMenu.style.flexDirection = "column";
          const rect = settingsMenu.getBoundingClientRect();
          const maxX = window.innerWidth - rect.width - 8;
          const maxY = window.innerHeight - rect.height - 8;
          settingsMenu.style.left = `${Math.min(rect.left, maxX)}px`;
          settingsMenu.style.top = `${Math.min(rect.bottom + 4, maxY)}px`;
        }
      });
      // 菜单点击
      settingsMenu.querySelectorAll("[data-fill]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const mode = (btn as HTMLElement).dataset.fill as "all" | "selection";
          if (mode === "all") {
            if (!reply) { settingsMenu.style.display = "none"; return; }
            const text = reply;
            close();
            opts.onFillBack(text);
          } else if (mode === "selection") {
            const sel = window.getSelection();
            const text = sel?.toString().replace(/\u00A0/g, " ").trim() || "";
            if (!text) { settingsMenu.style.display = "none"; return; }
            close();
            opts.onFillBack(text);
          }
        });
      });
      // 点击其他区域关闭菜单
      const onDocClickSettings = (e: MouseEvent) => {
        if (settingsMenu.style.display === "none") return;
        if (settingsMenu.contains(e.target as Node)) return;
        if (settingsBtn.contains(e.target as Node)) return;
        settingsMenu.style.display = "none";
      };
      document.addEventListener("mousedown", onDocClickSettings);
      (root as any).__settingsMenuClean = () => {
        document.removeEventListener("mousedown", onDocClickSettings);
      };
    }

    // ====== 2026-08-22 改：chevron 点击(收起/展开输入区)======
    const toggleBtn = root.querySelector("#hiword-anno-ai-resizer-toggle") as HTMLElement | null;
    const footer = root.querySelector("#hiword-anno-ai-footer") as HTMLElement | null;
    const dialog = root.querySelector(".hiword-anno-ai-dialog") as HTMLElement | null;
    toggleBtn?.addEventListener("click", (e) => {
      e.stopPropagation();  // 不触发 resizer 的 pointerdown
      if (!dialog || !footer) return;
      const isCollapsed = dialog.classList.contains("hiword-anno-ai-dialog--collapsed");
      if (!isCollapsed) {
        // 收起前记下当前高度
        savedFooterHeight = footer.offsetHeight || 0;
        try { localStorage.setItem("hiword-anno-ai-footer-height", String(savedFooterHeight)); } catch {}
        applyAnnoAiCollapsedState(root, true, savedFooterHeight);
      } else {
        applyAnnoAiCollapsedState(root, false, savedFooterHeight);
      }
    });

    // ====== 2026-08-22 改：chevron 拖拽(只调 footer 高度,不动 dialog 整体高度)======
    const resizer = root.querySelector("#hiword-anno-ai-resizer") as HTMLElement | null;
    if (resizer && footer) {
      let dragging = false, startY = 0, startH = 0;
      const MIN_H = 80;
      const onDown = (e: MouseEvent) => {
        // 只在 resizer 自身或 toggle button 上点才触发拖拽
        if (e.target !== resizer && e.target !== toggleBtn) return;
        dragging = true;
        startY = e.clientY;
        startH = footer.offsetHeight;
        e.preventDefault();
        e.stopPropagation();
      };
      const onMove = (e: MouseEvent) => {
        if (!dragging) return;
        // 2026-08-22 改：向上拖 → footer 变小(reply 区变大),让 reply 区域可以看全
        //             向下拖 → footer 变大(输入区更大)
        // 之前是 startY - e.clientY(向上为正)→footer 变大,造成 reply 被挤
        // 现改为 e.clientY - startY(向下为正)→footer 变大,符合直觉
        const dy = e.clientY - startY;
        const newH = Math.max(MIN_H, startH + dy);
        footer.style.height = `${newH}px`;
        // 不要再写 minHeight/maxHeight(那会导致 dialog 高度变化,出现"延伸边框"bug)
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        const finalH = footer.offsetHeight;
        if (finalH >= MIN_H) {
          savedFooterHeight = finalH;
          try { localStorage.setItem("hiword-anno-ai-footer-height", String(finalH)); } catch {}
        }
      };
      resizer.addEventListener("mousedown", onDown);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      (root as any).__resizeClean = () => {
        resizer.removeEventListener("mousedown", onDown);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
    }

    // ====== 2026-08-22 新增：弹窗 8 向 resize(4 边+4 角)======
    const dialogEl = root.querySelector(".hiword-anno-ai-dialog") as HTMLElement | null;
    const handles = root.querySelectorAll(".hiword-anno-ai-resize-handle");
    if (dialogEl && handles.length) {
      let resizing = false;
      let dir = "";
      let startX = 0, startY = 0;
      let startW = 0, startH = 0;
      let startL = 0, startT = 0;
      const MIN_W = 360;
      const MIN_H = 240;

      const onRDown = (e: MouseEvent) => {
        const target = e.currentTarget as HTMLElement;
        dir = target.dataset.dir || "";
        if (!dir) return;
        resizing = true;
        startX = e.clientX;
        startY = e.clientY;
        const r = root.getBoundingClientRect();
        startW = r.width;
        startH = r.height;
        startL = r.left;
        startT = r.top;
        // 先清掉 position 限制,改用 left/top + width/height
        if (!root.style.left || !root.style.top) {
          root.style.left = `${r.left}px`;
          root.style.top = `${r.top}px`;
        }
        root.style.transform = "none";
        e.preventDefault();
        e.stopPropagation();
      };
      const onRMove = (e: MouseEvent) => {
        if (!resizing) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let newW = startW, newH = startH, newL = startL, newT = startT;
        if (dir.includes("e")) newW = Math.max(MIN_W, startW + dx);
        if (dir.includes("s")) newH = Math.max(MIN_H, startH + dy);
        if (dir.includes("w")) {
          newW = Math.max(MIN_W, startW - dx);
          newL = startL + (startW - newW);
        }
        if (dir.includes("n")) {
          newH = Math.max(MIN_H, startH - dy);
          newT = startT + (startH - newH);
        }
        root.style.width = `${newW}px`;
        root.style.height = `${newH}px`;
        root.style.left = `${newL}px`;
        root.style.top = `${newT}px`;
      };
      const onRUp = () => {
        if (!resizing) return;
        resizing = false;
        // 持久化尺寸
        try {
          localStorage.setItem("hiword-anno-ai-width", root.style.width);
          localStorage.setItem("hiword-anno-ai-height", root.style.height);
        } catch {}
      };
      handles.forEach((h) => (h as HTMLElement).addEventListener("mousedown", onRDown));
      document.addEventListener("mousemove", onRMove);
      document.addEventListener("mouseup", onRUp);
      (root as any).__popupResizeClean = () => {
        handles.forEach((h) => (h as HTMLElement).removeEventListener("mousedown", onRDown));
        document.removeEventListener("mousemove", onRMove);
        document.removeEventListener("mouseup", onRUp);
      };
    }

    // ====== 2026-08-22 新增：AI 回复区选区菜单(全部填入/选取填入)======
    const replyEl = root.querySelector("#hiword-anno-ai-reply") as HTMLElement | null;
    const selMenu = root.querySelector("#hiword-anno-ai-selmenu") as HTMLElement | null;
    if (replyEl && selMenu) {
      let menuJustOpened = false;
      const hideMenu = () => { selMenu.style.display = "none"; };
      const showMenu = (x: number, y: number) => {
        selMenu.style.display = "flex";
        selMenu.style.flexDirection = "column";
        const rect = selMenu.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 8;
        const maxY = window.innerHeight - rect.height - 8;
        selMenu.style.left = `${Math.min(x, maxX)}px`;
        selMenu.style.top = `${Math.min(y + 12, maxY)}px`;
        menuJustOpened = true;
        // 下一帧重置 flag
        requestAnimationFrame(() => { menuJustOpened = false; });
      };
      replyEl.addEventListener("mouseup", (e) => {
        if (menuJustOpened) return;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { hideMenu(); return; }
        const range = sel.getRangeAt(0);
        if (!replyEl.contains(range.commonAncestorContainer)) { hideMenu(); return; }
        showMenu(e.clientX, e.clientY);
      });
      // 点击菜单按钮
      selMenu.querySelector('[data-fill="all"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!reply) { hideMenu(); return; }
        const finalReply = reply;
        close();
        opts.onFillBack(finalReply);
      });
      selMenu.querySelector('[data-fill="selection"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        const sel = window.getSelection();
        const text = sel?.toString().replace(/\u00A0/g, " ").trim() || "";
        if (!text) { hideMenu(); return; }
        close();
        opts.onFillBack(text);
      });
      // 点击菜单外区域关闭
      const onDocClick = (e: MouseEvent) => {
        if (selMenu.style.display === "none") return;
        if (selMenu.contains(e.target as Node)) return;
        if (replyEl.contains(e.target as Node)) return;
        hideMenu();
      };
      document.addEventListener("mousedown", onDocClick);
      (root as any).__selMenuClean = () => {
        document.removeEventListener("mousedown", onDocClick);
      };
    }

    // ESC 关闭
    if (!(root as any).__escBound) {
      const escHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape" && document.body.contains(root)) close();
      };
      document.addEventListener("keydown", escHandler);
      (root as any).__escHandler = escHandler;
      (root as any).__escBound = true;
    }
    // 头部拖拽
    const head = root.querySelector("[data-drag-handle]") as HTMLElement | null;
    if (head && !(head as any).__dragBound) {
      head.style.cursor = "move";
      let dragging = false, sx = 0, sy = 0, ol = 0, ot = 0;
      const onDown = (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest("button")) return;
        dragging = true; sx = e.clientX; sy = e.clientY;
        const rect = root.getBoundingClientRect();
        ol = rect.left; ot = rect.top;
        root.style.left = `${ol}px`; root.style.top = `${ot}px`;
        root.style.transform = "none";
        e.preventDefault();
      };
      const onMove = (e: MouseEvent) => {
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        const w = root.offsetWidth, h = root.offsetHeight;
        const ml = window.innerWidth - w - 6, mt = window.innerHeight - h - 6;
        root.style.left = `${Math.max(6, Math.min(ml, ol + dx))}px`;
        root.style.top = `${Math.max(6, Math.min(mt, ot + dy))}px`;
      };
      const onUp = () => { dragging = false; };
      head.addEventListener("mousedown", onDown);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      (head as any).__dragBound = true;
      (root as any).__dragClean = () => {
        head.removeEventListener("mousedown", onDown);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
    }
  };

  // 6) 定位(2026-08-22 改:若有 parentDialog,贴在它旁边;否则居中偏上;默认长方形 720x420)
  // 优先级:父弹窗右 → 父弹窗下 → 父弹窗左 → 父弹窗上 → 居中
  const positionPopup = () => {
    // 2026-08-22 改：默认长方形(宽>高),从 localStorage 恢复用户上次尺寸
    let w = Math.min(720, window.innerWidth - 40);
    let h = Math.min(420, window.innerHeight - 60);
    try {
      const sw = localStorage.getItem("hiword-anno-ai-width");
      const sh = localStorage.getItem("hiword-anno-ai-height");
      if (sw) {
        const nw = parseInt(sw, 10);
        if (Number.isFinite(nw) && nw >= 360 && nw <= window.innerWidth - 20) w = nw;
      }
      if (sh) {
        const nh = parseInt(sh, 10);
        if (Number.isFinite(nh) && nh >= 240 && nh <= window.innerHeight - 40) h = nh;
      }
    } catch { /* 默认尺寸 */ }
    root.style.width = `${w}px`;
    root.style.height = `${h}px`;
    // 首次定位(用户拖动后 style.left 已存在,不再覆盖)
    if (root.style.left && root.style.left !== "") return;

    const margin = 12;
    const parent = opts.parentDialog;

    if (parent && document.body.contains(parent)) {
      const pr = parent.getBoundingClientRect();
      const spaceRight = window.innerWidth - pr.right - margin;
      const spaceLeft = pr.left - margin;
      const spaceBottom = window.innerHeight - pr.top - margin;
      const spaceTop = pr.top - margin;

      let left = 0;
      let top = 0;
      let placed = false;

      // 1) 父右侧
      if (spaceRight >= w) {
        left = pr.right + margin;
        top = pr.top;
        placed = true;
      }
      // 2) 父下方
      else if (spaceBottom >= h) {
        left = pr.left;
        top = pr.top + h + margin;
        placed = true;
      }
      // 3) 父左侧
      else if (spaceLeft >= w) {
        left = pr.left - w - margin;
        top = pr.top;
        placed = true;
      }
      // 4) 父上方
      else if (spaceTop >= h) {
        left = pr.left;
        top = pr.top - h - margin;
        placed = true;
      }

      if (placed) {
        left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - h - margin));
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
        root.style.transform = "none";
      } else {
        // 父弹窗周围都没空间 → 居中
        root.style.left = `${Math.max(10, (window.innerWidth - w) / 2)}px`;
        root.style.top = `${Math.max(10, (window.innerHeight - h) / 2 - 40)}px`;
        root.style.transform = "none";
      }
    } else {
      // 无父弹窗 → 居中
      root.style.left = `${Math.max(10, (window.innerWidth - w) / 2)}px`;
      root.style.top = `${Math.max(10, (window.innerHeight - h) / 2 - 40)}px`;
      root.style.transform = "none";
    }
    root.style.maxHeight = `${window.innerHeight - 40}px`;
  };

  // 7) 关闭
  const close = () => {
    if (isStreaming) abortController?.abort();
    if (renderRaf) cancelAnimationFrame(renderRaf);
    const eh = (root as any).__escHandler;
    if (eh) document.removeEventListener("keydown", eh);
    const dc = (root as any).__dragClean;
    if (dc) dc();
    const rc = (root as any).__resizeClean;
    if (rc) rc();
    const sm = (root as any).__selMenuClean;
    if (sm) sm();
    const pmc = (root as any).__popupResizeClean;
    if (pmc) pmc();
    const smc = (root as any).__settingsMenuClean;
    if (smc) smc();
    root.remove();
  };

  // 8) 发送逻辑
  const doSend = async () => {
    if (isStreaming) return;
    const settings = opts.getAiSettings();
    if (!settings.apiKey) {
      opts.showMessage("未配置 API Key,请先在 AI 设置中填写", "error");
      return;
    }
    const input = root.querySelector("#hiword-anno-ai-input") as HTMLTextAreaElement | null;
    const question = input?.value || "";
    const userMsg = buildAnnoAiUserMessage({
      selectedText: opts.selectedText,
      sentence: opts.sentence,
      existingNote: opts.existingNote,
      question,
    });
    const messages: AiMessage[] = [
      { role: "system", content: ANNO_AI_SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ];

    isStreaming = true;
    reply = "";
    replyHtml = "";
    abortController = new AbortController();
    render();

    // 2026-08-22 改：流式回调用 Lute 渲染 + raf 单帧合并
    // 风险：markdown 半截（如未闭合的代码块）Lute 渲染可能异常 → renderWithLute 内部 catch 回退 renderMarkdown
    const scheduleRender = () => {
      if (renderRaf) return;
      renderRaf = requestAnimationFrame(() => {
        renderRaf = 0;
        try {
          replyHtml = renderWithLute(reply);
          const replyEl = root.querySelector("#hiword-anno-ai-reply") as HTMLElement | null;
          if (replyEl) {
            replyEl.innerHTML = replyHtml;
            replyEl.scrollTop = replyEl.scrollHeight;
          }
        } catch (e) {
          // 极端情况下（如 Lute 完全不可用）→ 兜底纯文本
          getLogger().warn("[REword-AnnoAI] Lute 渲染失败,回退 textContent", { error: e });
          const replyEl = root.querySelector("#hiword-anno-ai-reply") as HTMLElement | null;
          if (replyEl) {
            replyEl.textContent = reply;
            replyEl.scrollTop = replyEl.scrollHeight;
          }
        }
      });
    };

    try {
      const result = await requestAIStream({
        messages,
        // 映射到 Copilot 引擎所需的精简字段（统一走 ai-orchestrator.toEngineSettings）
        settings: toEngineSettings(settings) as any,
        signal: abortController.signal,
        onToken: (chunk) => {
          reply += chunk;
          scheduleRender();
        },
      });
      // 流式结束：补一次完整渲染（确保末尾 token 完整）
      scheduleRender();
      if (result.aborted) {
        opts.showMessage("已停止生成", "info");
      } else if (!result.ok) {
        opts.showMessage(`AI 生成失败: ${result.error || "未知错误"}`, "error");
      }
    } catch (e: any) {
      getLogger().error("[REword-AnnoAI] 流式调用失败:", e);
      opts.showMessage(`AI 生成失败: ${e?.message || e}`, "error");
    } finally {
      isStreaming = false;
      abortController = null;
      render();
    }
  };

  // 9) 首次渲染
  render();
}
