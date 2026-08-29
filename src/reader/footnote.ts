import { logSwallow } from "../core/safe.ts";

// 脚注内容缓存：避免同一脚注高频触发（hover 防抖后仍可能反复、或连续点击多个脚注）
// 时重复 loadContent + DOMParser（整章 XHTML 重解析，开销大）。
// key = 书籍标识 + href，换书自动隔离；仅缓存成功结果（含已转 blob 的图片 url）。
const footnoteCache = new Map<string, FootnoteResult>();
function footnoteCacheKey(book: any, href: string): string {
  const bid = book?.metadata?.identifier ?? book?.metadata?.title ?? "book";
  return `${bid}::${href}`;
}
// src/reader/footnote.ts
// 脚注检测 + 内容抽取 + 类型分类。
// 设计：scoped 复制 foliate-js/footnotes.js 的检测思路，并额外加「不规范书籍」兜底
//  （无 epub:type/role 语义标记、上标数字链接、同章节内联脚注、隐藏脚注块）。
// 不修改 foliate vendor 内核（符合 reword 维护铁律：改动 scoped 在 reader 侧）。
//
// 接入点：foliate-view 在内容文档点击 <a> 时发出可取消的 `link` 事件
//  （view-light.js #handleLinks → emit('link', {a, href}, cancelable)），
//  只要监听并 e.preventDefault()，foliate 就不会执行 goTo 跳转——改由本模块弹气泡展示。

const EP_NS = 'http://www.idpf.org/2007/ops'

function getTypes(el: any): Set<string> {
  const out = new Set<string>()
  // 带命名空间的属性用 attributes 节点取（foliate 同款做法）
  const t1 = el?.attributes?.getNamedItem?.('epub:type')?.value
  const t2 = el?.getAttribute?.('epub:type')
  ;[t1, t2].forEach((v: string | undefined) => {
    if (v) v.split(/\s+/).forEach((x: string) => x && out.add(x))
  })
  return out
}
function getRoles(el: any): Set<string> {
  const r = el?.getAttribute?.('role')
  return new Set(r ? r.split(/\s+/).filter(Boolean) : [])
}
function isSuper(el: any): boolean {
  if (!el || !el.matches) return false
  if (el.matches('sup')) return true
  try {
    const va: string = getComputedStyle(el).verticalAlign
    return va === 'super' || va === 'top' || va === 'text-top' || /^\d/.test(va)
  } catch {
    return false
  }
}

// 规范语义标记
const REF_TYPES = ['biblioref', 'glossref', 'noteref']
const REF_ROLES = ['doc-biblioref', 'doc-glossref', 'doc-noteref']
const NOTE_TYPES = ['biblioentry', 'glossdef', 'endnote', 'rearnote', 'footnote', 'note']
const NOTE_ROLES = ['doc-biblioentry', 'doc-noteref', 'definition', 'doc-endnote', 'doc-footnote', 'note', 'doc-note']

// 不规范书兜底：href 形如 #fn1 / #note3 / #footnote-2 / #endnote_4
const HREF_RE = /#(fn|foot|footnote|endnote|rearnote|annot|cite)[-_]?\d*/i
const HREF_RE2 = /#note\d+/i

function cssEscape(s: string): string {
  try {
    return (globalThis as any).CSS?.escape?.(s) ?? s
  } catch {
    return s.replace(/["\\]/g, '\\$&')
  }
}

/** 目标元素是否像「脚注/尾注/注释」块（不规范书兜底用） */
function elLooksLikeNote(el: any): boolean {
  const types = getTypes(el)
  const roles = getRoles(el)
  if (NOTE_TYPES.some(t => types.has(t)) || NOTE_ROLES.some(r => roles.has(r))) return true
  // 隐藏块（Calibre 常见：脚注 aside 设 display:none）
  try {
    if (getComputedStyle(el).display === 'none') return true
  } catch (__swallowErr) { logSwallow(__swallowErr, "footnote.ts · elLooksLikeNote", "debug"); }
  // id/class 含 note/foot/fn 等特征词
  const sig = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase()
  return /\b(note|foot|fn|endnote|rearnote)\b/.test(sig)
}

/** 判断 <a> 是否为脚注/尾注/注释引用（含不规范书兜底）。
 *  - 规范书：epub:type/role 语义标记（noteref/doc-noteref 等）
 *  - 不规范书：href 模式、同章节内联目标元素特征、上标数字链接启发式 */
export function isFootnoteRef(a: any): boolean {
  if (!a || (a.tagName || '').toLowerCase() !== 'a') return false
  const types = getTypes(a)
  const roles = getRoles(a)
  const yes = REF_ROLES.some(r => roles.has(r)) || REF_TYPES.some(t => types.has(t))
  if (yes) return true

  const href: string = a.getAttribute('href') || ''
  // 兜底 1：href 片段像脚注
  if (HREF_RE.test(href) || HREF_RE2.test(href)) return true

  // 兜底 2：同章节内联脚注——目标元素语义/隐藏/id 特征
  const hash = href.split('#')[1]
  if (hash) {
    const doc = a.ownerDocument
    if (doc) {
      const target: any =
        doc.getElementById(hash) ||
        doc.querySelector(`[name="${cssEscape(hash)}"]`)
      if (target && elLooksLikeNote(target)) return true
    }
  }

  // 兜底 3：上标链接启发式（纯上标数字链接，无语义标记——不规范书常见）
  const maybe =
    !types.has('backlink') &&
    !roles.has('doc-backlink') &&
    (isSuper(a) ||
      (a.children.length === 1 && isSuper(a.children[0])) ||
      isSuper(a.parentElement))
  return maybe
}

/** 分类脚注类型 → 中文徽标 */
export function classifyType(el: any): string {
  if (!el) return '脚注'
  const types = getTypes(el)
  const roles = getRoles(el)
  if (roles.has('doc-biblioentry') || types.has('biblioentry')) return '参考文献'
  if (roles.has('definition') || types.has('glossdef')) return '释义'
  if (roles.has('doc-endnote') || types.has('endnote') || types.has('rearnote')) return '尾注'
  if (roles.has('doc-footnote') || types.has('footnote')) return '脚注'
  if (roles.has('note') || types.has('note')) return '注释'
  return '脚注'
}

export interface FootnoteResult {
  html: string | null // 脚注内容 HTML（抽取失败为 null）
  type: string // 中文徽标：脚注/尾注/注释/参考文献/释义
}

function findFootnoteElement(doc: Document, hash: string): Element | null {
  if (!hash) return null
  return doc.getElementById(hash)
    || doc.querySelector(`[name="${cssEscape(hash)}"]`)
    || doc.querySelector(`[id$="${cssEscape(hash)}"]`)
    || null
}

function parseXhtml(xhtml: string): Document {
  // EPUB 章节本质 XHTML，优先用 text/html（容错强），若找不到目标再回退 XML 解析
  let doc = new DOMParser().parseFromString(xhtml, 'text/html')
  return doc
}

function textLength(el: Element | null): number {
  return (el?.textContent || '').trim().length
}

function looksEmpty(el: Element | null): boolean {
  return textLength(el) === 0
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return map[c] ?? c
  })
}

function isBacklinkAnchor(el: Element): boolean {
  if (el.tagName.toLowerCase() !== 'a') return false
  const href = el.getAttribute('href') || ''
  if (!href.startsWith('#')) return false
  const t = (el.textContent || '').trim()
  // backlink 文本常见：↩ ← ↑ ▲ 返回 return 空 或 纯数字序号
  return /^[↩←↑▲⇧返回return]*$/i.test(t) || /^\d+$/.test(t) || t === ''
}

/** 从解析后的文档中挑选「真正承载脚注文本」的元素。
 *  很多中文 EPUB 的 id 直接打在脚注号 <a> 上，而正文在该 <a> 的父 <p>/<li> 里；
 *  若只取 <a>.outerHTML，气泡会显示为空。 */
function pickFootnoteContainer(el: Element | null): Element | null {
  if (!el) return null
  const tag = el.tagName.toLowerCase()

  // 情况 A：目标是个 <a>，但父块级元素包含更多文字 → 用父元素
  if (tag === 'a') {
    const parent = el.parentElement
    if (parent) {
      const parentText = (parent.textContent || '').trim()
      const anchorText = (el.textContent || '').trim()
      if (parentText.length > anchorText.length + 2) {
        return parent
      }
    }
  }

  // 情况 B：元素本身为空 → 文本可能在下一个兄弟
  if (looksEmpty(el)) {
    let sib = el.nextElementSibling
    while (sib && looksEmpty(sib)) sib = sib.nextElementSibling
    if (sib) return sib
  }

  // 情况 C：元素只有返回锚点 → 用父元素
  if (el.children.length === 1 && isBacklinkAnchor(el.children[0])) {
    const parent = el.parentElement
    if (parent && textLength(parent) > textLength(el) + 2) return parent
  }

  return el
}

function cleanHiddenStyle(style: string): string {
  const cleaned = style
    .replace(/display\s*:\s*[^;]+;?/gi, '')
    .replace(/visibility\s*:\s*[^;]+;?/gi, '')
    .replace(/opacity\s*:\s*[^;]+;?/gi, '')
    .replace(/height\s*:\s*0[^;]*;?/gi, '')
    .replace(/width\s*:\s*0[^;]*;?/gi, '')
  return `${cleaned}; display:block; visibility:visible; opacity:1;`.replace(/;+/g, ';')
}

/** 清理克隆后的脚注 DOM：去返回锚点、去空隐藏占位、强制可见 */
function sanitizeFootnoteElement(root: Element): void {
  // 1. 移除返回正文锚点
  for (const a of Array.from(root.querySelectorAll('a[href^="#"]'))) {
    if (isBacklinkAnchor(a)) a.remove()
  }
  // 2. 移除空 hidden / aria-hidden 占位
  for (const e of Array.from(root.querySelectorAll('[hidden], [aria-hidden="true"]'))) {
    if (looksEmpty(e)) e.remove()
  }
  // 3. 递归清除内联隐藏样式
  const walker = (node: Element) => {
    const style = node.getAttribute('style') || ''
    if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|height\s*:\s*0|width\s*:\s*0/i.test(style)) {
      node.setAttribute('style', cleanHiddenStyle(style))
    }
    node.removeAttribute('hidden')
    for (const child of Array.from(node.children)) walker(child)
  }
  walker(root)
}

function prepareFootnoteHtml(el: Element): string {
  const container = pickFootnoteContainer(el)
  if (!container) return ''
  const clone = container.cloneNode(true) as Element
  sanitizeFootnoteElement(clone)
  // 清理后仍无文字：兜底用纯文本
  if (looksEmpty(clone)) {
    const text = (container.textContent || '').trim()
    if (text) return `<p>${escapeHtml(text)}</p>`
    return ''
  }
  return clone.outerHTML
}

/** 抽取脚注内容 HTML。
 *  通过 book.sections[index].loadContent() 取章节 XHTML 源，DOMParser 解析后
 *  getElementById(hash) 定位脚注元素；相对图片 best-effort 解析为 blob URL。
 *  不依赖嵌套 foliate-view，气泡样式完全由 REword 控制（轻量、可控）。
 *  2026-08-29 增强：处理中文 EPUB 常见脚注结构（id 打在锚点上、返回锚点、隐藏块）。 */
export async function extractFootnote(book: any, href: string): Promise<FootnoteResult> {
  try {
    const cacheKey = footnoteCacheKey(book, href);
    const cached = footnoteCache.get(cacheKey);
    if (cached) return cached;
    const target = await book?.resolveHref?.(href)
    if (!target || target.index == null) return { html: null, type: '脚注' }
    const hash = href.split('#')[1]
    if (!hash) return { html: null, type: '脚注' } // 无片段：整章链接，非脚注，降级跳转
    const section = book.sections?.[target.index]
    if (!section) return { html: null, type: '脚注' }
    const xhtml = await section.loadContent?.()
    if (!xhtml) return { html: null, type: '脚注' }
    const doc = parseXhtml(xhtml)
    let el = findFootnoteElement(doc, hash)
    // XML 解析回退（text/html 偶有 xmlns 前缀导致 id 定位失败）
    if (!el) {
      const xmlDoc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml')
      el = findFootnoteElement(xmlDoc, hash)
    }
    if (!el) return { html: null, type: '脚注' }
    const type = classifyType(el)
    const html = prepareFootnoteHtml(el)
    if (!html) return { html: null, type }
    // 相对图片解析为 blob URL（best-effort）：在临时容器上操作，避免污染缓存的原始 DOM
    const tmp = doc.createElement('div')
    tmp.innerHTML = html
    await resolveImages(tmp, book, target.index)
    const result: FootnoteResult = { html: tmp.innerHTML, type }
    footnoteCache.set(cacheKey, result)
    return result
  } catch {
    return { html: null, type: '脚注' }
  }
}

async function resolveImages(el: any, book: any, index: number) {
  const imgs = el.querySelectorAll?.('img')
  if (!imgs || !imgs.length) return
  const section = book?.sections?.[index]
  for (const img of Array.from<HTMLImageElement>(imgs)) {
    const src: string | null = img.getAttribute?.('src')
    if (!src || /^(https?:|data:|blob:)/i.test(src)) continue
    try {
      const resolved = section?.resolveHref?.(src) ?? src
      const blob = await book?.loadBlob?.(resolved)
      if (blob) {
        const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob as any]))
        img.setAttribute('src', url)
      }
    } catch (__swallowErr) { logSwallow(__swallowErr, "footnote.ts · resolveImages", "debug"); }
  }
}
