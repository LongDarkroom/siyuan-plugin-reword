/**
 * 阅读器双语对照注入
 * ------------------------------------------------------------------
 * 2026-08-27 重设计：阅读器顶栏「双语」开关开启后，为每一段正文
 * （p / li / blockquote，仅顶层、不重复嵌套）在其后注入一段译文。
 *
 * 要点：
 *  - 翻译走 plugin.translateBatch（微软→LibreTranslate→AI 兜底 + 按书缓存）。
 *  - 注入标记 class="reword-bilingual"，幂等：已注入的段落跳过，重复调用安全。
 *  - 翻页（foliate 重新 load 内容）时由 ReaderView 调 onViewLoad() 重新注入。
 *  - 关闭时 removeAll() 清除全部注入节点，零正文污染、卸载无残留。
 */
export interface BilingualOptions {
  bookId: string;
  /** 返回当前 foliate 内容文档数组（view.renderer.getContents()） */
  getContents: () => Document[];
  /** 批量翻译（异步，返回与输入同序同长的译文数组） */
  translateBatch: (texts: string[], from: string, to: string, bookId: string) => Promise<string[]>;
  /** 源语言（默认 auto） */
  from?: string;
  /** 目标语言（默认 zh） */
  to?: string;
  /** 进度回调（done / total） */
  onProgress?: (done: number, total: number) => void;
}

export interface BilingualHandle {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /** 立即重新扫描并注入（如设置变更后） */
  refresh(): void;
  /** foliate 加载新内容（翻页）时调用 */
  onViewLoad(): void;
  destroy(): void;
}

/** 仅顶层正文块：p / li / blockquote，且不被嵌套在被选标签内（避免 blockquote 内 p 重复） */
const SELECTOR = "p, li, blockquote";

function cleanText(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

export function createBilingual(opts: BilingualOptions): BilingualHandle {
  let enabled = false;
  let suppress = false;
  let injectTimer: any = null;
  const from = opts.from || "auto";
  const to = opts.to || "zh";

  /** 取某内容文档下「待注入」的段落（已注入的自动跳过） */
  function getSegments(doc: Document): Array<{ el: Element; text: string }> {
    const all = Array.from(doc.querySelectorAll(SELECTOR)) as Element[];
    const out: Array<{ el: Element; text: string }> = [];
    for (const el of all) {
      // 跳过被嵌套在被选标签内的节点（如 blockquote 内的 p、li 内的 p）
      if (el.parentElement?.closest(SELECTOR)) continue;
      // 跳过已注入译文的（兄弟节点或 li 内部子节点）
      const next = el.nextElementSibling;
      const hasSibling = !!(next && next.classList && next.classList.contains("reword-bilingual"));
      const hasChild = !!el.querySelector(":scope > .reword-bilingual");
      if (hasSibling || hasChild) continue;
      const text = cleanText(el.textContent || "");
      if (!text) continue;
      out.push({ el, text });
    }
    return out;
  }

  async function injectAll(): Promise<void> {
    if (!enabled) return;
    const docs = opts.getContents() || [];
    const pending: Array<{ doc: Document; el: Element; text: string }> = [];
    for (const doc of docs) {
      for (const seg of getSegments(doc)) pending.push({ doc, el: seg.el, text: seg.text });
    }
    if (!pending.length) return;
    const total = pending.length;
    try {
      const translations = await opts.translateBatch(
        pending.map((p) => p.text),
        from,
        to,
        opts.bookId
      );
      suppress = true;
      let done = 0;
      pending.forEach((p, i) => {
        const tr = (translations[i] || "").trim();
        if (!tr) return; // 翻译失败（全引擎不可用）：留空，下次刷新重试
        const div = p.doc.createElement("div");
        div.className = "reword-bilingual";
        div.textContent = tr;
        if (p.el.tagName === "LI") p.el.appendChild(div);
        else p.el.after(div);
        done++;
      });
      suppress = false;
      opts.onProgress?.(done, total);
    } catch (e) {
      suppress = false;
      // eslint-disable-next-line no-console
      console.warn("[REword] 双语注入失败:", e);
    }
  }

  function scheduleInject(delay = 300): void {
    if (!enabled) return;
    clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      injectAll();
    }, delay);
  }

  function removeAll(): void {
    suppress = true;
    const docs = opts.getContents() || [];
    for (const doc of docs) {
      doc.querySelectorAll(".reword-bilingual").forEach((n) => n.remove());
    }
    suppress = false;
  }

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on: boolean) {
      enabled = on;
      if (on) injectAll();
      else removeAll();
    },
    refresh() {
      if (enabled) injectAll();
    },
    onViewLoad() {
      scheduleInject(300);
    },
    destroy() {
      clearTimeout(injectTimer);
      enabled = false;
      removeAll();
    },
  };
}
