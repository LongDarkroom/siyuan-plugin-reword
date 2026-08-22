/**
 * 安全的轻量 Markdown 渲染
 * ------------------------------------------------------------------
 * 集中实现「文本 → HTML」的渲染，避免在各面板里重复书写朴素且易漏掉 XSS
 * 过滤的解析逻辑。所有用户 / AI 文本统一经此函数渲染：
 *  - 先做 HTML 转义（防注入的第一道防线）；
 *  - 链接 URL 统一经 sanitizeUrl 过滤，拦截 javascript:/data:/vbscript:
 *    等危险协议，杜绝点击 AI 返回内容触发脚本执行。
 *
 * 元素 → CSS class 可通过 RenderMarkdownOptions.classes 覆盖；默认输出与
 * index.less 对齐的 cp-* 类，保证现有样式不失效。
 */

/** HTML 转义（防 XSS 的第一道防线） */
export function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 过滤链接 URL。
 *  - 放行相对路径（/、#、./、../ 开头）与 http/https/mailto 协议；
 *  - 拦截 javascript:/data:/vbscript:/ftp: 等危险或非常规协议，返回空串。
 * 调用方在得到空串时应降级为纯文本，避免构造出危险 href。
 */
export function sanitizeUrl(url: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  // 相对路径 / 锚点：无协议，安全
  if (/^(\/|#|\.\/|\.\.\/)/.test(u)) return u;
  // 协议白名单
  if (/^(https?|mailto):/i.test(u)) return u;
  // 其余（javascript:、data:、vbscript:、ftp: 等）一律拦截
  return "";
}

/** 可被自定义 CSS class 的元素类型 */
export type MdElement =
  | "code"
  | "inlineCode"
  | "heading"
  | "paragraph"
  | "listUl"
  | "listOl"
  | "blockquote"
  | "hr";

export interface RenderMarkdownOptions {
  /** 元素 → CSS class 映射；不传则使用默认 cp-* 类 */
  classes?: Partial<Record<MdElement, string>>;
}

const DEFAULT_CLASSES: Record<MdElement, string> = {
  code: "cp-code",
  inlineCode: "cp-icode",
  heading: "cp-h", // 实际使用时拼接级别，如 cp-h1
  paragraph: "cp-p",
  listUl: "cp-ul",
  listOl: "cp-ol",
  blockquote: "cp-quote",
  hr: "cp-hr",
};

/**
 * 渲染 Markdown 为 HTML。
 * 支持：代码块（```lang）、行内代码、**粗体** *斜体* ~~删除~~ `代码`、链接、
 * 标题（# ~ ####）、有序/无序列表、引用（>）、分隔线、换行。
 */
export function renderMarkdown(md: string, opts: RenderMarkdownOptions = {}): string {
  const c = { ...DEFAULT_CLASSES, ...(opts.classes || {}) };
  if (!md) return "";

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let inCode = false;
  let codeBuf: string[] = [];
  let listType: "" | "ul" | "ol" = "";

  const flushList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = "";
    }
  };

  for (const line of lines) {
    // 代码块围栏（支持 ```lang）
    if (/^```/.test(line.trim())) {
      if (!inCode) {
        flushList();
        inCode = true;
        codeBuf = [];
      } else {
        inCode = false;
        html += `<pre class="${c.code}"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const t = line.trim();
    if (!t) {
      flushList();
      continue;
    }

    // 标题
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const lvl = h[1].length;
      html += `<div class="${c.heading}${lvl}">${inline(h[2], c)}</div>`;
      continue;
    }

    // 分隔线
    if (/^---+$/.test(t)) {
      flushList();
      html += `<hr class="${c.hr}"/>`;
      continue;
    }

    // 引用
    if (t.startsWith(">")) {
      flushList();
      html += `<blockquote class="${c.blockquote}">${inline(t.slice(1).trim(), c)}</blockquote>`;
      continue;
    }

    // 无序列表
    const ul = t.match(/^[-*]\s+(.*)$/);
    if (ul) {
      if (listType !== "ul") {
        flushList();
        html += `<ul class="${c.listUl}">`;
        listType = "ul";
      }
      html += `<li>${inline(ul[1], c)}</li>`;
      continue;
    }

    // 有序列表
    const ol = t.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (listType !== "ol") {
        flushList();
        html += `<ol class="${c.listOl}">`;
        listType = "ol";
      }
      html += `<li>${inline(ol[1], c)}</li>`;
      continue;
    }

    flushList();
    html += `<div class="${c.paragraph}">${inline(t, c)}</div>`;
  }

  flushList();
  if (inCode && codeBuf.length) {
    html += `<pre class="${c.code}"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`;
  }
  return html;
}

/**
 * 行内格式：先整体转义，再按标记替换；链接 URL 经 sanitizeUrl 过滤。
 * 注意：正则作用在已转义字符串上，故文本与 URL 均已转义，href 注入安全。
 */
function inline(s: string, c: Record<MdElement, string>): string {
  let x = escapeHtml(s);
  x = x.replace(/`([^`\n]+)`/g, `<code class="${c.inlineCode}">$1</code>`);
  x = x.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  x = x.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  x = x.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  x = x.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m: string, text: string, url: string) => {
      const safe = sanitizeUrl(url);
      if (!safe) {
        // 危险协议：降级为纯文本（text 已转义），避免构造出危险 href
        return text;
      }
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
  );
  return x;
}
