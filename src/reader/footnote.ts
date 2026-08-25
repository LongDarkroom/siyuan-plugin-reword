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
  } catch { /* ignore */ }
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

/** 抽取脚注内容 HTML。
 *  通过 book.sections[index].loadContent() 取章节 XHTML 源，DOMParser 解析后
 *  getElementById(hash) 定位脚注元素；相对图片 best-effort 解析为 blob URL。
 *  不依赖嵌套 foliate-view，气泡样式完全由 REword 控制（轻量、可控）。 */
export async function extractFootnote(book: any, href: string): Promise<FootnoteResult> {
  try {
    const target = await book?.resolveHref?.(href)
    if (!target || target.index == null) return { html: null, type: '脚注' }
    const hash = href.split('#')[1]
    if (!hash) return { html: null, type: '脚注' } // 无片段：整章链接，非脚注，降级跳转
    const section = book.sections?.[target.index]
    if (!section) return { html: null, type: '脚注' }
    const xhtml = await section.loadContent?.()
    if (!xhtml) return { html: null, type: '脚注' }
    const doc = new DOMParser().parseFromString(xhtml, 'text/html')
    const el: any = doc.getElementById(hash)
    if (!el) return { html: null, type: '脚注' }
    // 清除内联 display:none（隐藏脚注块在弹窗里应可见）
    if (el.style) el.style.display = ''
    // 相对图片解析为 blob URL（best-effort）
    await resolveImages(el, book, target.index)
    const type = classifyType(el)
    return { html: el.outerHTML, type }
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
    } catch {
      /* 单个图片失败不影响整体 */
    }
  }
}
