/**
 * REword · 鲸鱼批注 AI 助手小弹窗（2026-08-22）
 * ------------------------------------------------------------------
 * 在鲸鱼批注弹窗底部提供 🤖 AI 按钮，点击后弹出独立小窗：
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

// ============ 纯函数(可单测)============

/**
 * 构造 AI 助手的系统提示词：明确助手身份 + 输出约束。
 * 输出为纯文本批注草稿,无需 Markdown 包装,直接填入批注编辑器。
 */
export const ANNO_AI_SYSTEM_PROMPT = `你是 REword 英语学习助手，正在帮用户改进他/她在鲸鱼批注中写下的笔记。

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
 *  - 顶部:标题 + 关闭
 *  - 上下文卡(选中/上下文/现有批注) 折叠展示
 *  - 输入 textarea
 *  - 操作:发送 / 清空 / 填回批注 / 复制
 *  - 流式回复区
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
  const ctxText = opts.selectedText
    ? `<div class="hiword-anno-ai-context-line"><span class="hiword-anno-ai-context-label">选中</span><span class="hiword-anno-ai-context-value">${esc(opts.selectedText)}</span></div>`
    : "";
  const noteText = opts.existingNote
    ? `<div class="hiword-anno-ai-context-line"><span class="hiword-anno-ai-context-label">现有批注</span><span class="hiword-anno-ai-context-value">${esc(opts.existingNote)}</span></div>`
    : `<div class="hiword-anno-ai-context-line"><span class="hiword-anno-ai-context-label">现有批注</span><span class="hiword-anno-ai-context-value hiword-anno-ai-context-value--empty">（空）</span></div>`;
  const noKeyWarn = opts.hasApiKey
    ? ""
    : `<div class="hiword-anno-ai-nokey">未配置 AI 服务（API Key/BaseUrl 为空）<button type="button" class="hiword-anno-ai-open-settings" id="hiword-anno-ai-open-settings">去设置</button></div>`;

  return `
    <div class="hiword-anno-ai-dialog">
      <div class="hiword-anno-ai-head" data-drag-handle>
        <span class="hiword-anno-ai-title">🤖 AI 批注助手</span>
        <button class="hiword-anno-ai-close" id="hiword-anno-ai-close" title="关闭">✕</button>
      </div>
      <div class="hiword-anno-ai-context">
        ${ctxText}
        ${noteText}
      </div>
      <textarea class="hiword-anno-ai-textarea" id="hiword-anno-ai-input" rows="3"
        placeholder="附加问题（可空）— 翻译成中文 / 润色 / 加例句 ...">${esc("")}</textarea>
      ${noKeyWarn}
      <div class="hiword-anno-ai-actions">
        <button class="hiword-anno-ai-btn" id="hiword-anno-ai-clear" title="清空输入和回复">清空</button>
        <span class="hiword-anno-ai-spacer"></span>
        <button class="hiword-anno-ai-btn" id="hiword-anno-ai-copy" ${opts.reply ? "" : "disabled"}>复制回复</button>
        <button class="hiword-anno-ai-btn hiword-anno-ai-btn--ghost" id="hiword-anno-ai-cancel" ${opts.isStreaming ? "" : "disabled"}>取消</button>
        <button class="hiword-anno-ai-btn hiword-anno-ai-btn--primary" id="hiword-anno-ai-send" ${opts.isStreaming ? "disabled" : ""}>${opts.isStreaming ? "生成中..." : "发送"}</button>
        <button class="hiword-anno-ai-btn hiword-anno-ai-btn--primary" id="hiword-anno-ai-fill" ${opts.reply && !opts.isStreaming ? "" : "disabled"}>填回批注</button>
      </div>
      <div class="hiword-anno-ai-reply" id="hiword-anno-ai-reply">${esc(opts.reply || "")}</div>
    </div>
  `;
}

// ============ DOM 主入口(开弹窗 + 事件)============

/** AI 弹窗入参:从鲸鱼批注弹窗传来 */
export interface AnnoAiDialogOptions {
  selectedText: string;
  sentence: string;
  blockId: string;
  docId: string;
  existingNote?: string;
  /** 填回批注的回调(关闭 AI 弹窗后由调用方处理重开批注) */
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
  let reply = "";
  let isStreaming = false;
  let abortController: AbortController | null = null;

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
    bindEvents();
    positionPopup();
  };

  // 5) 事件绑定
  const bindEvents = () => {
    // 关闭
    root.querySelector("#hiword-anno-ai-close")?.addEventListener("click", () => close());
    // 打开设置
    root.querySelector("#hiword-anno-ai-open-settings")?.addEventListener("click", () => {
      close();
      opts.openAiSettings();
    });
    // 清空
    root.querySelector("#hiword-anno-ai-clear")?.addEventListener("click", () => {
      const input = root.querySelector("#hiword-anno-ai-input") as HTMLTextAreaElement | null;
      if (input) input.value = "";
      reply = "";
      render();
    });
    // 复制回复
    root.querySelector("#hiword-anno-ai-copy")?.addEventListener("click", async () => {
      if (!reply) return;
      try {
        await navigator.clipboard.writeText(reply);
        opts.showMessage("已复制到剪贴板", "success");
      } catch {
        // fallback: 选中 textarea 文本
        const ta = document.createElement("textarea");
        ta.value = reply;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          opts.showMessage("已复制到剪贴板", "success");
        } catch {
          opts.showMessage("复制失败,请手动选中", "error");
        } finally {
          ta.remove();
        }
      }
    });
    // 取消(中断流式)
    root.querySelector("#hiword-anno-ai-cancel")?.addEventListener("click", () => {
      abortController?.abort();
    });
    // 发送
    root.querySelector("#hiword-anno-ai-send")?.addEventListener("click", () => doSend());
    // 填回批注
    root.querySelector("#hiword-anno-ai-fill")?.addEventListener("click", () => {
      if (!reply) return;
      const finalReply = reply;
      close();
      opts.onFillBack(finalReply);
    });
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

  // 6) 定位(默认居中偏上,与批注弹窗同风格)
  const positionPopup = () => {
    const w = Math.min(480, window.innerWidth - 40);
    root.style.width = `${w}px`;
    if (!root.style.left) {
      root.style.left = `${Math.max(10, (window.innerWidth - w) / 2)}px`;
      root.style.top = "80px";
    }
    root.style.maxHeight = `${Math.min(560, window.innerHeight - 40)}px`;
  };

  // 7) 关闭
  const close = () => {
    if (isStreaming) abortController?.abort();
    const eh = (root as any).__escHandler;
    if (eh) document.removeEventListener("keydown", eh);
    const dc = (root as any).__dragClean;
    if (dc) dc();
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
    abortController = new AbortController();
    render();

    try {
      const result = await requestAIStream({
        messages,
        // 映射到 Copilot 引擎所需的精简字段（统一走 ai-orchestrator.toEngineSettings）
        settings: toEngineSettings(settings) as any,
        signal: abortController.signal,
        onToken: (chunk) => {
          reply += chunk;
          // 增量更新回复区(不重渲全弹窗,避免输入框光标跳动)
          const replyEl = root.querySelector("#hiword-anno-ai-reply");
          if (replyEl) {
            (replyEl as HTMLElement).textContent = reply;
            (replyEl as HTMLElement).scrollTop = (replyEl as HTMLElement).scrollHeight;
          }
        },
      });
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
