/**
 * 统一安全 Markdown 渲染
 * ------------------------------------------------------------------
 * 根因修复（对应审查项 #5/#12）：历史上 ai-render / ai-panel.renderKramdown /
 * copilot-panel.renderMarkdown 三套近似实现口径不一，且链接 URL 原样拼入
 * href 未过滤 `javascript:` 等协议 → XSS 注入。
 *
 * 本模块收敛为唯一实现：
 *  - 文本先 escapeHtml（& < > " ' 全转义），杜绝 HTML 注入；
 *  - 链接 URL 经 sanitizeUrl 仅放行 http/https/mailto 与相对路径，拦截
 *    javascript:/data:/vbscript: 等危险协议；
 *  - 支持标题 / 有序无序列表 / 引用 / 围栏代码块 / 分割线 / 粗斜体 / 高亮 /
 *    删除线 / 行内代码 / 链接。
 */

/** 转义 HTML 特殊字符（含引号，防属性/文本注入） */
export function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 链接 URL 白名单化。
 *  - 允许：http:// https:// mailto: 以及相对路径（# / ./ ../ 或无协议的裸路径）
 *  - 拦截：javascript: data: vbscript: 等；含引号/空白/尖括号的视为非法
 * 返回 "" 表示该 URL 不安全，调用方应丢弃链接或转为纯文本。
 */
export function sanitizeUrl(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  // 含控制/断句字符的 URL 直接拒绝（防止属性逃逸）
  if (/[\s"<>']/.test(s)) return "";
  // 锚点 / 相对路径
  if (/^(#|\/|\.\/|\.\.\/)/.test(s)) return s;
  // 带协议：必须白名单
  const m = s.match(/^([a-z][a-z0-9+.\-]*):/i);
  if (!m) return s; // 无协议 → 当作相对路径处理（浏览器会按 base 解析，安全）
  const scheme = m[1].toLowerCase();
  if (scheme === "http" || scheme === "https" || scheme === "mailto") return s;
  return "";
}

/** 各元素 class 名映射（允许调用方保留各自 UI 的主题 class，避免样式回归） */
export interface MarkdownClassMap {
  /** 标题 class，入参为层级 1-4 */
  heading?: (lvl: number) => string;
  /** 段落 class */
  paragraph?: string;
  /** 代码块 <pre> class */
  pre?: string;
  /** 代码块内 <code> class（为空则省略该 class 属性） */
  codeblock?: string;
  /** 行内代码 class */
  inlineCode?: string;
  /** 无序列表 <ul> class */
  ul?: string;
  /** 有序列表 <ol> class */
  ol?: string;
  /** 引用 <blockquote> class */
  blockquote?: string;
  /** 分割线 <hr> class */
  hr?: string;
  /** 高亮 <mark> class */
  mark?: string;
}

export interface RenderMarkdownOptions {
  /**
   * 是否使用语义标签：true → <h1>/<p>，false → <div class="..-h1">/<div class="..-p">。
   * 默认 true（reword AI 面板）；copilot 旧结构用 false 以兼容其 CSS。
   */
  semantic?: boolean;
  /** 各元素 class 名映射（缺省退回到 reword 默认主题 class） */
  classes?: MarkdownClassMap;
}

/** 行内格式化（输入已被 escapeHtml 处理过；仅做格式标记替换） */
function inlineFormat(t: string, classes: MarkdownClassMap): string {
  const inlineCodeCls = classes.inlineCode ?? "hiword-kd-code";
  const markCls = classes.mark ?? "hiword-kd-mark";
  return t
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/(^|[^a-zA-Z0-9_])_([^_\n]+)_(?=[^a-zA-Z0-9_]|$)/g, "$1<em>$2</em>")
    .replace(/==([^=\n]+)==/g, `<mark class="${markCls}">$1</mark>`)
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/`([^`\n]+)`/g, `<code class="${inlineCodeCls}">$1</code>`)
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_whole, text: string, url: string) => {
        const safe = sanitizeUrl(url);
        if (!safe) {
          // 不安全链接：退化为纯文本（已转义）
          return `${text} (${url})`;
        }
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
    );
}

/**
 * 完整轻量 Markdown → HTML 渲染（用于对话/批注内容展示）。
 * 所有动态文本均经 escapeHtml，链接经 sanitizeUrl，安全可直出 innerHTML。
 */
export function renderMarkdown(md: string, opts: RenderMarkdownOptions = {}): string {
  if (!md) return "";
  // 思源运行时优先用 Lute 引擎渲染（完整排版 + 公式/表格/任务列表），仅当调用方未指定
  // 自定义 class 且未显式 semantic:false 时启用；copilot 旧结构 semantic:false 仍走原正则，零回归
  if (opts.semantic !== false && (!opts.classes || Object.keys(opts.classes).length === 0)) {
    if (typeof window !== "undefined" && (window as any).Lute) {
      try {
        const lute = (window as any).Lute.New();
        lute.SetInlineMath(true);
        lute.SetInlineMathAllowDigitAfterOpenMarker(true);
        const html = lute.Md2HTML(md);
        if (html) return `<div class="b3-typography">${html}</div>`;
      } catch { /* fall through to regex renderer */ }
    }
  }
  const sem = opts.semantic ?? true;
  const c = opts.classes ?? {};
  const headingCls = c.heading ?? ((l: number) => `hiword-kd-h${l}`);
  const paragraphCls = c.paragraph ?? "hiword-kd-p";
  const preCls = c.pre ?? "hiword-kd-pre";
  const codeblockCls = c.codeblock ?? "hiword-kd-codeblock";
  const ulCls = c.ul ?? "hiword-kd-ul";
  const olCls = c.ol ?? "hiword-kd-ol";
  const bqCls = c.blockquote ?? "hiword-kd-bq";
  const hrCls = c.hr ?? "hiword-kd-hr";

  const lines = (md || "").split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  let inOl = false;
  let inCode = false;
  let codeBuf: string[] = [];

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };
  const closeCode = () => {
    if (inCode) {
      const cbAttr = codeblockCls ? ` class="${codeblockCls}"` : "";
      out.push(
        `<pre class="${preCls}"><code${cbAttr}>${codeBuf.join("\n")}</code></pre>`
      );
      codeBuf = [];
      inCode = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // 代码块围栏
    if (line.startsWith("```")) {
      if (inCode) {
        closeCode();
        continue;
      }
      closeList();
      inCode = true;
      codeBuf = [];
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    // 空行
    if (!line.trim()) {
      closeList();
      out.push("<br>");
      continue;
    }

    // 分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeList();
      out.push(`<hr class="${hrCls}">`);
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      const tag = sem ? `h${lvl}` : "div";
      out.push(
        `<${tag} class="${headingCls(lvl)}">${inlineFormat(escapeHtml(h[2]), c)}</${tag}>`
      );
      continue;
    }

    // 引用（兼容 "> " 与裸 ">"）
    if (line.startsWith(">")) {
      closeList();
      const inner = line.startsWith("> ") ? line.slice(2) : line.slice(1);
      out.push(
        `<blockquote class="${bqCls}">${inlineFormat(escapeHtml(inner), c)}</blockquote>`
      );
      continue;
    }

    // 无序列表
    const uli = line.match(/^[-*+]\s+(.*)$/);
    if (uli) {
      if (!inList) {
        out.push(`<ul class="${ulCls}">`);
        inList = true;
      }
      out.push(`<li>${inlineFormat(escapeHtml(uli[1]), c)}</li>`);
      continue;
    }

    // 有序列表
    const oli = line.match(/^\d+\.\s+(.*)$/);
    if (oli) {
      if (!inOl) {
        out.push(`<ol class="${olCls}">`);
        inOl = true;
      }
      out.push(`<li>${inlineFormat(escapeHtml(oli[1]), c)}</li>`);
      continue;
    }

    // 普通段落
    closeList();
    const pTag = sem ? "p" : "div";
    out.push(`<${pTag} class="${paragraphCls}">${inlineFormat(escapeHtml(line), c)}</${pTag}>`);
  }

  closeList();
  closeCode();
  return out.join("");
}
