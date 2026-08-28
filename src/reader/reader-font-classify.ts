/**
 * 阅读器 - 分类字体的 DOM 侧处理（2026-08-28 新增，参考 Readest utils/style.ts）
 * ------------------------------------------------------------------------------
 *
 * **为什么需要这个模块（纯 CSS 做不到的事）**
 *
 * EPUB 作者样式表里大量使用通用字体族关键词：
 *   body { font-family: Georgia, serif }
 *   code { font-family: monospace }
 *   h1   { font-family: serif }
 *
 * 这些声明位于**作者样式表**，我们的阅读器样式是**用户样式表**。
 * 用户样式表的 !important 确实能压过它们——但**仅限于我们显式声明了 font-family 的元素**。
 * 我们只声明了 body / pre / code 等少数选择器，于是出现割裂：
 *   - 标题 h1-h6 走书籍的 serif（不是用户选的衬线字体）
 *   - 各类 class 段落走书籍的 sans-serif（不是用户选的无衬线字体）
 * 结果是「分类字体只在部分元素生效」，体验不完整。
 *
 * **Readest 的同款解法**：加载完成后遍历内容文档的 CSSOM，把通用族关键词
 * 替换成对应的 CSS 变量引用。变量由 reader-style.ts 的 fontVariableStyles()
 * 定义在 `:root`（foliate 内容文档的 <html>）上，因此 var() 必然可解析。
 *
 * 替换规则：
 *   serif        → var(--reword-serif, serif)
 *   sans-serif   → var(--reword-sans-serif, sans-serif)
 *   monospace    → var(--reword-monospace, monospace)
 * 注意保留原声明的其它字体名（`Georgia, serif` → `Georgia, var(--reword-serif, serif)`），
 * 这样书籍自带的西文字体优先级仍在，只有「兜底族」被我们接管——最小侵入。
 *
 * **项目铁律遵守**：本模块只读写**运行时 CSSOM**，不修改 EPUB 文件、不写回磁盘、
 * 不修改元素的 style 属性。CSSOM 改动随 foliate 重建文档自然消失，卸载零残留。
 *
 * 全部逻辑 try-catch 包裹：任何 CSSOM 访问异常（跨域样式表）都静默跳过，
 * 最坏情况退化为「分类字体部分生效」，不会崩溃、不会白屏。
 */

/** 通用字体族关键词 → CSS 变量引用（带同名兜底，变量缺失时退化为原生行为） */
const KEYWORD_TO_VAR: Record<string, string> = {
  serif: "var(--reword-serif, serif)",
  "sans-serif": "var(--reword-sans-serif, sans-serif)",
  monospace: "var(--reword-monospace, monospace)",
  // cursive / fantasy 无对应链，映射到衬线（比系统默认更可控）
  cursive: "var(--reword-serif, cursive)",
  fantasy: "var(--reword-serif, fantasy)",
};

/**
 * 把 `font-family` 值里的通用族关键词替换为 CSS 变量引用。
 *
 * @example
 *   transformFontFamilyValue('Georgia, serif')      → 'Georgia, var(--reword-serif, serif)'
 *   transformFontFamilyValue('"Courier New",monospace') → '"Courier New", var(--reword-monospace, monospace)'
 *   transformFontFamilyValue('MyBookFont')          → 'MyBookFont'（未命中，原样返回）
 */
export function transformFontFamilyValue(value: string): string {
  if (!value) return value;
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      // 去引号后比较（CSS 允许 serif 不带引号，也允许 "serif"）
      const bare = trimmed.replace(/^["']+|["']+$/g, "").toLowerCase();
      const replacement = KEYWORD_TO_VAR[bare];
      return replacement || trimmed;
    })
    .join(", ");
}

/**
 * 单条声明重写：把 style.fontFamily 中的关键词换成变量。
 * @returns 是否发生了修改
 */
function rewriteDeclaration(style: CSSStyleDeclaration): boolean {
  let raw = "";
  try {
    raw = style.getPropertyValue("font-family");
  } catch {
    return false;
  }
  if (!raw) return false;

  const next = transformFontFamilyValue(raw);
  if (next === raw) return false;

  try {
    // 保留 original 的 !important 优先级，避免削弱书籍的强制声明
    const priority = style.getPropertyPriority("font-family");
    style.setProperty("font-family", next, priority);
    return true;
  } catch {
    return false;
  }
}

/** 递归遍历规则集（含 @media / @supports 等分组规则内的嵌套规则） */
function walkRules(rules: CSSRuleList | undefined): number {
  if (!rules) return 0;
  let n = 0;
  for (let i = 0; i < rules.length; i++) {
    let rule: CSSRule;
    try {
      rule = rules[i];
    } catch {
      continue; // 单条访问失败（跨域）跳过
    }
    try {
      // CSSStyleRule 有 .style；CSSFontFaceRule 也有（font-family 是字体名，不会命中关键词）
      const styleRule = rule as CSSStyleRule;
      if (styleRule.style) {
        if (rewriteDeclaration(styleRule.style)) n++;
      }
      // @media / @supports / @layer 等分组规则
      const grouped = rule as CSSGroupingRule;
      if (grouped && grouped.cssRules && grouped.cssRules.length) {
        n += walkRules(grouped.cssRules);
      }
    } catch {
      /* 单条规则失败不影响整体 */
    }
  }
  return n;
}

/**
 * 重写单个内容文档的字体族关键词。
 *
 * @param doc foliate 内容文档（来自 view.renderer.getContents()[i].doc）
 * @returns 被修改的规则条数（0 表示书籍未使用通用族关键词，或样式表不可访问）
 */
export function rewriteFontKeywordsInDocument(doc: Document): number {
  if (!doc) return 0;
  let n = 0;

  // 1) 文档样式表（含 <style> 与同源 <link>）
  try {
    const sheets = doc.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      let sheet: CSSStyleSheet;
      try {
        sheet = sheets[i];
      } catch {
        continue; // 索引访问抛错（跨域）
      }
      let rules: CSSRuleList | undefined;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // 跨域样式表读不到 cssRules（EPUB 内联资源一般同源，此分支少见）
      }
      n += walkRules(rules);
    }
  } catch {
    /* 整体失败静默 */
  }

  // 2) adoptedStyleSheets（现代 foliate 可能用 constructable stylesheets）
  try {
    const adopted = (doc as any).adoptedStyleSheets as CSSStyleSheet[] | undefined;
    if (Array.isArray(adopted)) {
      for (const sheet of adopted) {
        let rules: CSSRuleList | undefined;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        n += walkRules(rules);
      }
    }
  } catch {
    /* 不支持则跳过 */
  }

  return n;
}

/**
 * 对 foliate 当前所有已挂载内容文档执行关键词重写。
 *
 * @param getContents foliate 的 view.renderer.getContents()，
 *        返回 [{ index, overlayer, doc }, ...]（**Document 在 .doc 字段**，项目铁律）
 * @returns 被修改的规则总条数
 */
export function rewriteFontKeywordsInAllContents(
  getContents: () => any[] | undefined | null
): number {
  let list: any[] = [];
  try {
    list = getContents?.() || [];
  } catch {
    return 0;
  }
  let n = 0;
  for (const c of list) {
    const doc = (c as any)?.doc as Document | undefined;
    if (!doc) continue; // 项目铁律：必须解 .doc，直接把 c 当 Document 会抛 TypeError
    try {
      n += rewriteFontKeywordsInDocument(doc);
    } catch {
      /* 单文档失败跳过 */
    }
  }
  return n;
}
