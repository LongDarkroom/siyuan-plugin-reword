/**
 * 批注列表 HTML 渲染（v3：颜色支持 + HTML 白名单清洗）。
 * ------------------------------------------------------------------
 * 纯函数：提供 ANNOTATION_COLORS / resolveColor / sanitizeHtml / compactSentence 公共工具。
 *
 * renderAnnotationsList 已随旧版面板（hiword-ann-*）移除，批注列表渲染统一由
 * whale-renderer.ts 的 renderWhalePanel 承担；批注正文渲染统一由 renderAnnotationText
 * （基于思源 Lute，见 whale-renderer.ts）承担。手写 renderMd 渲染器已删除（D7 死代码）。
 */

// ============ 工具函数 ============
// （注：esc 实体转义原仅被已删除的 renderMd 使用，故一并移除，避免死代码 D7）

// ============ 轻量 Markdown 渲染（安全子集） ============
//
// 支持语法：
//   **bold** / __bold__    → <strong>
//   *italic* / _italic_   → <em>
//   `code`                → <code>
//   ~~strike~~            → <del>
//   [text](url)           → <a>（仅 http/https 协议）
//
// 安全策略：
//   1. 先转义所有 HTML 特殊字符（防 XSS）
//   2. 再用正则替换 Markdown 语法为安全标签
//   3. 不支持嵌套标签 / 不解析 HTML 块

// ============ HTML 白名单清洗（2026-08-14 新增）============
//
// note 编辑器是 contenteditable，用户可粘贴外部富文本。
// 保存时不能直接存 innerHTML（XSS 风险：onerror/javascript:、iframe 等），
// 必须经过白名单清洗。
//
// 白名单策略：
//  - 标签白名单：覆盖思源编辑器常用行内+块级格式
//  - 属性白名单：a 的 href（限 http/https/mailto）/target/rel/title，span 的 style（限颜色属性），mark 的颜色
//  - 剥除事件属性（on*）、javascript:/data: 链接、<script>/<style>/<iframe>/<object>/<form>/<link> 等
//
// 不依赖 DOMParser 在浏览器运行时可用；走 DOM 清洗最稳。

/** 允许的标签白名单（覆盖思源编辑器主要文本样式） */
const HTML_ALLOWED_TAGS = new Set([
  // 行内格式
  "strong", "b", "em", "i", "u", "del", "s", "ins", "mark", "small",
  // 行内代码 + 块级代码
  "code", "pre",
  // 链接
  "a",
  // 换行 + 段落
  "br", "p", "div", "span",
  // 列表
  "ul", "ol", "li",
  // 标题
  "h1", "h2", "h3", "h4", "h5", "h6",
  // 引用 + 强调
  "blockquote",
  // 表格（D1 fallback 保留结构，避免塌成一行拼接文字）
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col", "caption",
  // 行内语义
  "sub", "sup", "kbd",
]);

/** 每个标签允许的属性 */
const HTML_ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  span: new Set(["style", "data-color", "class"]),
  mark: new Set(["data-color", "class"]),
  code: new Set(["class"]),
  pre: new Set(["class"]),
  div: new Set(["data-color", "class"]),
  p: new Set(["data-color", "class"]),
};

/** 危险 URL 协议（防 javascript:、data: 等 XSS） */
const HTML_FORBIDDEN_URL = /^\s*(javascript|data|vbscript|file):/i;

/** style 属性允许的属性（仅限颜色与文字装饰，避免恶意 CSS） */
const HTML_ALLOWED_STYLE = /^(color|background-color|background|text-decoration|text-decoration-color|text-decoration-style|font-weight|font-style|font-size)\s*:/i;

/**
 * HTML 白名单清洗（2026-08-14 新增）。
 * 剥除危险标签/属性/事件/危险 URL，保留思源编辑器常用富文本格式。
 * @param html 原始 HTML 字符串
 * @returns 清洗后的安全 HTML
 */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  // 快速检测：不含标签当纯文本直接返回（避免无谓 DOM 解析）
  if (!/<[a-z][\s\S]*>/i.test(html)) return html;
  // 剥除脚本/style/iframe 等危险标签（最暴力但最稳的做法，避免依赖 DOMParser）
  let cleaned = html;
  // ① 移除注释
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  // ② 移除危险标签（连同内容）
  cleaned = cleaned.replace(
    /<\s*(script|style|iframe|object|embed|link|meta|form|input|button|select|textarea|base)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ""
  );
  cleaned = cleaned.replace(/<\s*(script|style|iframe|object|embed|link|meta|form|input|button|select|textarea|base)\b[^>]*\/?>/gi, "");
  // ③ 剥除所有 on* 事件属性
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "");
  // ④ 清洗 href / src 中的危险协议
  cleaned = cleaned.replace(
    /\b(href|src|xlink:href)\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (_m, attr: string, _whole: string, dq?: string, sq?: string) => {
      const v = dq !== undefined ? dq : sq !== undefined ? sq : "";
      if (HTML_FORBIDDEN_URL.test(v)) return "";
      // 仅保留 http/https/mailto
      if (!/^(https?:|mailto:|\/|#|\?)/i.test(v)) return "";
      return `${attr}=${dq !== undefined ? `"${v}"` : `'${v}'`}`;
    }
  );
  // ⑤ 剥除 style 属性中危险/不支持的声明（仅保留颜色/装饰相关）
  cleaned = cleaned.replace(
    /\s+style\s*=\s*("[^"]*"|'[^']*')/gi,
    (m: string, body: string) => {
      const content = body.slice(1, -1);
      // 按分号拆，过滤每条
      const safe = content
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d && HTML_ALLOWED_STYLE.test(d))
        .join("; ");
      return safe ? ` style="${safe}"` : "";
    }
  );
  // ⑥ 剥除 class 属性中可疑字符（保留字母数字- _）
  cleaned = cleaned.replace(/\s+class\s*=\s*("[^"]*"|'[^']*')/gi, (m, body) => {
    const v = body.slice(1, -1);
    if (!/^[a-zA-Z0-9_\- ]+$/.test(v)) return "";
    return m;
  });
  // ⑦ 标签白名单（移除不在白名单的标签，保留其内容）
  cleaned = cleaned.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (m: string, tag: string, attrs: string) => {
      const lc = tag.toLowerCase();
      if (!HTML_ALLOWED_TAGS.has(lc)) return ""; // 移除标签但保留内文
      // 属性白名单（仅 a/span/mark/code/pre/div/p 允许带属性）
      const allowedAttrs = HTML_ALLOWED_ATTRS[lc];
      if (!allowedAttrs) {
        // 自闭合/无属性保留；有属性的剥掉所有属性
        return attrs.trim() ? m.replace(attrs, "") : m;
      }
      const cleanedAttrs = (attrs.match(/\s+[a-zA-Z][\w-]*\s*=\s*("[^"]*"|'[^']*')/g) || [])
        .filter((a) => {
          const an = a.trim().split(/\s*=/)[0].toLowerCase();
          return allowedAttrs.has(an);
        })
        .join("");
      return `<${m.startsWith("</") ? "/" : ""}${lc}${cleanedAttrs}>`;
    }
  );
  // ⑧ 清理多余空白
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

/**
 * 折叠 sentence 中的冗余空白与换行（2026-08-14 新增）。
 * 选区上下文提取常包含选区所在块的整段文本（含多换行、多空格、制表符），
 * 直接渲染会导致批注卡片上下文显示松散、selectedText 跟前面的词脱节。
 * 这里做适度折叠：保留段落分隔（≤2 个换行），压缩行内空白与多余换行。
 */
export function compactSentence(s: string): string {
  if (!s) return "";
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/[ ]*\n[ ]*\n[ ]*\n+[ ]*/g, "\n\n") // 3+ 换行折叠为段落分隔
    .replace(/[ ]+\n/g, "\n") // 行尾多余空格
    .replace(/\n[ ]+/g, "\n") // 行首多余空格
    .replace(/^[ \t\n]+|[ \t\n]+$/g, "") // 头尾空白
    .trim();
}

/** 预定义批注调色板 */
export const ANNOTATION_COLORS: ReadonlyArray<{ name: string; value: string; cssVar: string }> = [
  { name: "默认蓝", value: "#4285f4", cssVar: "var(--b3-theme-primary, #4285f4)" },
  { name: "翠绿", value: "#0d9e5f", cssVar: "#0d9e5f" },
  { name: "琥珀", value: "#e6a23c", cssVar: "#e6a23c" },
  { name: "玫红", value: "#db3f84", cssVar: "#db3f84" },
  { name: "靛蓝", value: "#5b6ee1", cssVar: "#5b6ee1" },
  { name: "青色", value: "#17a2b8", cssVar: "#17a2b8" },
  { name: "珊瑚", value: "#f06543", cssVar: "#f06543" },
  { name: "石板", value: "#6c757d", cssVar: "#6c757d" },
] as const;

export type AnnotationColorValue = typeof ANNOTATION_COLORS[number]["value"];

/** 解析颜色值，返回可直接用于 CSS 的值 */
export function resolveColor(color?: string): string {
  if (!color) return ANNOTATION_COLORS[0].cssVar; // 默认蓝
  const found = ANNOTATION_COLORS.find((c) => c.value === color);
  return found ? found.cssVar : color; // 未知颜色直接透传（兼容旧数据）
}

// 注：原 renderMd（手写 Markdown→HTML 安全子集）已删除（D7 死代码，无调用方）。
// 批注正文渲染统一交由 whale-renderer.ts 的 renderAnnotationText（基于思源 Lute）。

/**
 * 剥离 kramdown 属性列表（IAL）裸文本，避免 `{.: id="…" updated="…"}` 这类属性码
 * 被当成正文显示（思源块导出的 kramdown 会带 `{: id="…" updated="…"}` / `{.class}` / `{#id}`，
 * 若被存进批注 note/sentence 且 Lute 无法识别为属性，就会原样输出成难看的「ID 码」）。
 *
 * 只匹配「花括号 + 冒号/点/井号开头」的 IAL 形式，**不碰** `((id))` 块引用（双圆括号）与
 * 普通正文的 `{x}`（x 非 `[:.#]` 开头不会命中），也不碰代码块/公式内的花括号（这些内容
 * 经 Lute 渲染后已非裸 IAL 文本）。
 *
 * @param s 含可能 IAL 的文本
 * @returns 剥离 IAL 后的文本（s 为空/非字符串原样返回）
 */
export function stripIal(s: string): string {
  if (!s) return s;
  // {:.class} / {: #id} / {: id="…" updated="…"} / {.class} / {#id} / 含点前缀的 {.: …} 等
  return s.replace(/\{\s*[:.#][^}]*\}/g, "");
}

/**
 * 把「单行空格分隔的伪 Markdown 表格」展开为真正的多行表格。
 * AI 生成或外部粘贴时可能把表格行的换行符压成空格，例如：
 *   `|问法|含义| |------|------| |What...|...|`
 * 这种格式 Lute 会当成普通段落文本输出 `<p>|...|</p>`。本函数按 `|...|...|`
 * 边界把表格行拆开并用换行连接，使 Lute 能正常识别为表格。
 *
 * @param t 原始 note 文本
 * @returns 若检测到单行伪表格则返回展开后的多行文本；否则原样返回
 */
export function expandInlineTableRows(t: string): string {
  if (!t) return t; // 空输入原样返回（保留旧行为）
  // 已是标准多行表格（含分隔行）→ 不破坏，直接返回。
  // 关键：不能「只要见到 \n 就返回原串」——AI/粘贴产生的伪表格常把换行压成空格、
  // 只在最末尾保留一个 \n（如 `|表头|数据| |分隔|数据|...\n`），这类文本虽含 \n 但仍是
  // 单行伪表格，必须展开，否则 Lute 仍会塌成 `|...|` 文本。
  if (/\n/.test(t)) {
    const lines = t.split(/\r?\n/).filter(Boolean);
    if (lines.length >= 2 && lines.some((l) => /^\s*\|?[\s:\-|]+\|?\s*$/.test(l) && l.includes("-"))) {
      return t;
    }
  }
  // 非贪婪匹配每个表格行：以 | 开头/结尾，行尾后必须是「空格 + 下一个 |」或字符串结束。
  // 旧正则 /\|(?:[^|]*\|)+/g 是贪婪匹配，会把整行伪表格吞成一个大匹配导致 rows.length===1
  // 直接返回原串、表格无法展开（侧栏 Lute 渲染仍塌成 `|...|` 文本）。
  const rows = t.match(/\|(?:[^|]*\|)+?(?=\s+\||\s*$)/g);
  if (!rows || rows.length < 2) return t;
  // 必须包含标准分隔行（只含 - : | 空白），避免误把普通 |xxx| 当表格
  const isSep = (s: string) => /^\s*\|?[\s:\-|]+\|?\s*$/.test(s) && s.includes("-");
  if (!rows.some(isSep)) return t;
  return rows.join("\n");
}

/**
 * 块级分隔标准化：确保表格（连续 `|..|` 行）前后有空行。
 * 思源 Lute（Md2HTML）要求块级元素之间以空行分隔，否则可能把表格与相邻文本
 * 合并解析、导致表格渲染失败（露出原始 `|...|` 文本）。
 *
 * @param md 归一化后的 Kramdown/Markdown
 * @returns 表格块前后已插入空行的文本（空输入原样返回）
 */
export function ensureBlockSeparators(md: string): string {
  if (!md) return md;
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l) || /^\s*\|[\s:\-|]+\|\s*$/.test(l);
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    if (isTableLine(cur)) {
      // 上一行不是空行且不是表格 → 表格前插空行，保证 Lute 把表格识别为独立块
      const prev = out[out.length - 1];
      if (prev !== undefined && prev.trim() !== "" && !isTableLine(prev)) {
        out.push("");
      }
    } else {
      // 上一行是表格、当前不是空行 → 表格后插空行收尾
      const prev = out[out.length - 1];
      if (prev !== undefined && isTableLine(prev) && cur.trim() !== "") out.push("");
    }
    out.push(cur);
  }
  return out.join("\n");
}
