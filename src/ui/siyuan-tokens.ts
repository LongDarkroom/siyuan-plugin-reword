/**
 * L0：思源设计令牌包（接口化第一阶段）
 * ------------------------------------------------------------------
 * 把思源笔记的 CSS 自定义属性（--b3-*）与 ReWord 语义令牌（--hw-*）
 * 从「父文档（思源主窗口）」注入到任意目标文档（典型：阅读器 foliate iframe）。
 *
 * 根因：CSS 自定义属性不跨 iframe 继承。阅读器运行在 foliate 的 srcdoc iframe 内，
 *       直接写 var(--b3-*) / var(--hw-*) 取不到思源的值，必须显式抓取后注入。
 *
 * 关键设计：
 * - injectTokens 读取「源文档 :root 的计算后样式」，把其中所有 --b3-* 与 --hw-*
 *   逐个 setProperty 写进目标文档 :root。无需维护一份变量名清单，
 *   思源或插件新增令牌都能自动跟随（DRY，不与 index.less 的 --hw-* 定义重复）。
 * - 目标文档内已有同名变量会被覆盖（取最新思源值），无同名则新增。
 *
 * 2026-09-01：作为「思源风格接口化」L0 落地，配合 theme-bridge（L3）在主题切换时自动重注。
 */

/** 需注入的令牌前缀（只搬运思源与 ReWord 的语义变量，避免把无关自定义属性带进 iframe） */
const TOKEN_PREFIXES = ["--b3-", "--hw-"];

/**
 * 把源文档 root 上的 --b3-*/--hw-* 计算值注入目标文档 root。
 * @param targetDoc 目标文档（如 iframe.contentDocument）
 * @param sourceDoc 源文档（默认 window.document，即思源主窗口）
 */
export function injectTokens(targetDoc: Document, sourceDoc?: Document): void {
  if (!targetDoc || !targetDoc.documentElement) return;
  const src = sourceDoc || document;
  let srcStyle: CSSStyleDeclaration;
  try {
    srcStyle = getComputedStyle(src.documentElement);
  } catch {
    return;
  }
  const dst = targetDoc.documentElement.style;
  // 遍历计算样式上所有自定义属性（含 --b3-* / --hw-*，标准行为）
  for (let i = 0; i < srcStyle.length; i++) {
    const name = srcStyle.item(i);
    if (!name || !TOKEN_PREFIXES.some((p) => name.startsWith(p))) continue;
    const val = srcStyle.getPropertyValue(name);
    if (val) {
      try {
        dst.setProperty(name, val);
      } catch {
        /* 个别浏览器对部分变量写保护，忽略即可 */
      }
    }
  }
}

/** 便捷封装：把令牌注入某个 iframe（取其 contentDocument） */
export function injectTokensIntoIframe(iframe: HTMLIFrameElement | null | undefined): void {
  if (!iframe) return;
  try {
    if (iframe.contentDocument) injectTokens(iframe.contentDocument);
  } catch {
    /* 跨域 / 尚未就绪时静默忽略 */
  }
}
