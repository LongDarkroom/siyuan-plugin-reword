/**
 * AI 精读「引用附件」统一契约层（2026-09-02 B 组）
 *
 * ── 为什么要这一层 ──────────────────────────────────────────────
 * 旧链路把「引用」藏在字符串里来回变形，一条发送要经历 4 步：
 *   DOM  →  @@REWORD_REF_id@@ 占位符
 *        →  cleanForAi 还原成 ((id 'anchor'))
 *        →  expandBlockRefs / expandDocRefs 正则匹配
 *        →  再按 id 拉正文
 * 中间两步是纯字符串往返，代价是：
 *   · 双轨不一致（UI 走 cleanForAi，AI 走 expandPlaceholdersAsync，各还原一遍）
 *   · 每次 cleanForAi 都全量扫一遍 wysiwyg DOM 补「泄漏形态」
 *   · 三套重叠正则（占位符 / kramdown / 泄漏 HTML）分散在四个函数里
 *
 * B 组把「引用」提升为一等数据：拖入/序列化时登记成 RefAttachment，
 * 占位符退化为一个纯粹的 ID 指针。展开链路压缩为 1 步：
 *   DOM → 占位符 → 查 Map → 正文
 *
 * 本文件只放纯函数 + 类型（无 DOM / 无宿主依赖），便于直接单测。
 */

/** 引用种类：block = 思源块；doc = 思源文档（页签/文档树拖入） */
export type RefKind = "block" | "doc";

/** 引用附件的取正文状态 */
export type RefStatus = "pending" | "ready" | "failed";

/**
 * 引用附件：一次引用的全部信息（ID、显示标题、正文、取正文状态）。
 * body 为空表示尚未取到，取正文由调用方按需 await。
 */
export interface RefAttachment {
  kind: RefKind;
  id: string;
  /** 输入框/气泡卡片里显示的标题（块=正文前几字，文档=📄 文档 XXXXXX） */
  title: string;
  /** 正文（kramdown / markdown）；undefined = 尚未取到 */
  body?: string;
  status?: RefStatus;
}

/** 文本中扫描到的引用标记（占位符 / kramdown / 残留 HTML 三种形态统一表示） */
export interface RefMarker {
  from: number;
  to: number;
  id: string;
  /** 标记内自带的标题（占位符形态没有，需查 attachment） */
  anchor?: string;
  form: "placeholder" | "kramdown" | "html";
}

/** 一次文本替换（from/to 为左闭右开区间） */
export interface RefEdit {
  from: number;
  to: number;
  text: string;
}

// ── 占位符 ────────────────────────────────────────────────────────
// Lute 不认识的纯文本标记：序列化时原样输出，绝不会被二次解析截断
// （列表块 anchor 常含 {、数字. 等 kramdown 语法字符，正是旧 bug 的来源）

export const REF_PLACEHOLDER_PREFIX = "@@REWORD_REF_";
export const REF_PLACEHOLDER_SUFFIX = "@@";

/** 思源 ID 最短 14 字符（YYYYMMDDHHmmss-xxxxxx） */
const REF_ID_PATTERN = "[a-z0-9_-]{14,}";

const RE_PLACEHOLDER_SOURCE = `@@REWORD_REF_(${REF_ID_PATTERN})@@`;
const RE_KRAMDOWN_SOURCE = "\\(\\(([^\\s]+)(?:\\s+'([^']*?)'?)?\\)\\)";
const RE_HTML_SOURCE =
  `<span\\b[^>]*\\bdata-type\\s*=\\s*["']?block-ref["']?[^>]*` +
  `\\bdata-id\\s*=\\s*["']?(${REF_ID_PATTERN})["']?[^>]*>([\\s\\S]*?)<\\/span>`;

// ── 文档引用标识 ───────────────────────────────────────────────────

/** 文档引用的锚文本前缀（data-subtype="s" 静态锚，思源不会改写它） */
export const DOC_ANCHOR_PREFIX = "📄 文档 ";

// ── 体积上限（沿用旧链路实测值，勿随意放大，会撑爆 AI 上下文）──────

/** 单块正文硬上限：超过则静默丢弃正文，退化为锚文本 */
export const MAX_BLOCK_BODY = 8000;
/** 块正文展开总量上限：达到后其余块退化为锚文本 */
export const MAX_BLOCK_TOTAL = 8000;
/** 文档正文展开总量上限：达到后其余文档只保留标题 */
export const MAX_DOC_TOTAL = 12000;

// ── 纯函数 ────────────────────────────────────────────────────────

/** id → 占位符文本 */
export function refPlaceholderOf(id: string): string {
  return `${REF_PLACEHOLDER_PREFIX}${id}${REF_PLACEHOLDER_SUFFIX}`;
}

/** id → 6 字符短码（去掉连字符取末 6 位，用于卡片显示与文档标题） */
export function shortRefId(id: string): string {
  return (id || "").replace(/-/g, "").slice(-6);
}

/** id → 文档引用锚文本，如「📄 文档 abc123」 */
export function docAnchorOf(id: string): string {
  return `${DOC_ANCHOR_PREFIX}${shortRefId(id)}`;
}

/**
 * 是否像思源 ID（14+ 位字母数字/连字符/下划线）。
 * kramdown 兜底正则 ((...)) 会命中数学式等普通文本（如 ((a+b))），
 * 展开前先过这道闸，避免为垃圾 id 发无谓的 API 请求。
 */
export function looksLikeRefId(id: string | undefined | null): boolean {
  return !!id && /^[a-z0-9_-]{14,}$/i.test(id);
}

/** 锚文本是否为文档引用（静态锚，思源不会改写） */
export function isDocAnchor(anchor: string | undefined | null): boolean {
  return typeof anchor === "string" && anchor.startsWith(DOC_ANCHOR_PREFIX);
}

/** id → 文档正文的 Markdown 小标题，如「\n\n## 📄 文档 abc123\n\n」 */
export function docHeaderOf(id: string): string {
  return `\n\n## ${docAnchorOf(id)}\n\n`;
}

/** 文档正文不可用时的降级提示（让 AI 知道用户引用过文档，而不是「什么都没收到」） */
export function docUnavailableNotice(id: string): string {
  return `\n\n> ⚠️ 文档 ${shortRefId(id)} 内容暂不可用（可能文档已被删除或权限不足），请用户重新拖入或粘贴正文。\n\n`;
}

/** 把残留 HTML 块引用的内部片段转成纯文本锚 */
export function htmlRefAnchorToText(inner: string | undefined | null): string {
  return (inner || "").replace(/<[^>]+>/g, "").replace(/\n/g, " ").trim();
}

function withGlobal(source: string, flags: string): RegExp {
  return new RegExp(source, flags.includes("g") ? flags : `${flags}g`);
}

function collect(
  source: string,
  flags: string,
  text: string,
  form: RefMarker["form"],
  make: (m: RegExpExecArray) => { id: string; anchor?: string } | null,
): RefMarker[] {
  const re = withGlobal(source, flags);
  const out: RefMarker[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const built = make(m);
    if (built && built.id) {
      out.push({ from: m.index, to: m.index + m[0].length, form, ...built });
    }
  }
  return out;
}

/** 扫描占位符形态的引用（B 组主路径，供 expandRefs 使用） */
export function scanRefPlaceholders(text: string): RefMarker[] {
  if (!text) return [];
  return collect(RE_PLACEHOLDER_SOURCE, "g", text, "placeholder", (m) => ({ id: m[1] }));
}

/**
 * 扫描文本中全部引用形态（占位符 / ((id 'anchor')) / 残留 <span data-type="block-ref">）。
 * 返回值按位置升序且互不重叠，可直接顺序切片渲染。
 */
export function scanRefMarkers(text: string): RefMarker[] {
  if (!text) return [];
  const all: RefMarker[] = [
    ...collect(RE_PLACEHOLDER_SOURCE, "g", text, "placeholder", (m) => ({ id: m[1] })),
    // kramdown 形态：兼容缺闭合单引号的泄漏写法 ((id 'anchor))
    ...collect(RE_KRAMDOWN_SOURCE, "g", text, "kramdown", (m) => ({ id: m[1], anchor: m[2] || "" })),
    ...collect(RE_HTML_SOURCE, "gi", text, "html", (m) => ({ id: m[1], anchor: htmlRefAnchorToText(m[2]) })),
  ];
  all.sort((a, b) => a.from - b.from || b.to - a.to);
  const out: RefMarker[] = [];
  let cursor = -1;
  for (const mk of all) {
    if (mk.from < cursor) continue; // 与已入选区间重叠（多为 HTML 包裹 kramdown）→ 丢弃
    out.push(mk);
    cursor = mk.to;
  }
  return out;
}

/**
 * 按 edits 顺序拼接替换结果：自动升序、跳过重叠区间、压缩连续空行。
 * 所有展开函数共用，保证「多次展开」的输出格式一致。
 */
export function applyRefEdits(text: string, edits: RefEdit[]): string {
  if (!edits.length) return text;
  const sorted = [...edits].sort((a, b) => a.from - b.from);
  let out = "";
  let cursor = 0;
  for (const e of sorted) {
    if (e.from < cursor) continue; // 跳过理论上的重叠
    out += text.slice(cursor, e.from) + e.text;
    cursor = e.to;
  }
  out += text.slice(cursor);
  return out.replace(/\n{4,}/g, "\n\n\n").trim();
}

/**
 * 生成给 AI 的正文片段（块引用）：正文可用时前后各留一个空行，
 * 不可用/超限时退化为锚文本，避免把 ((id 'anchor')) 这种 AI 看不懂的语法发给模型。
 */
export function blockRefBodyText(body: string | undefined, fallbackAnchor?: string): string {
  const text = (body || "").trim();
  if (text && text.length <= MAX_BLOCK_BODY) return `\n\n${text}\n\n`;
  const fallback = (fallbackAnchor || "").trim();
  return fallback ? `\n\n${fallback}\n\n` : "";
}
