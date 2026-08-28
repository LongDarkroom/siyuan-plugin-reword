import { logSwallow } from "../core/safe.ts";
/**
 * REword · AI 输出思源原生样式增强
 * ------------------------------------------------------------------
 * 在 Lute 渲染出的 HTML 基础上，套用思源笔记原生「数学公式(KaTeX)」与「代码高亮(highlight.js)」，
 * 使 AI 输出在 代码块 / 表格 / 引用块 / 数学公式 等元素上与思源正文视觉一致。
 *
 * - 数学：思源运行时通常已注入 window.katex；缺失时按需从 CDN 拉取后渲染。
 * - 代码：优先复用 window.hljs；缺失时按需加载。
 * - 所有处理函数幂等（基于 data-* 标记），可安全重复调用（首次同步渲染 + 异步补全）。
 *
 * 表格 / 引用块 / 标题 / 列表 / 间距等由外层 `b3-typography` 类继承思源排版（思源主题全局提供）。
 */

const KATEX_CDN = "https://cdn.jsdelivr.net/npm/katex@0.16.9";
const HLJS_CDN = "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0";

function addStyleOnce(href: string, id: string): void {
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function addScriptOnce(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "true") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("加载失败: " + src)));
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("加载失败: " + src));
    document.head.appendChild(script);
  });
}

let katexLoading: Promise<boolean> | null = null;
let hljsLoading: Promise<boolean> | null = null;

/** 确保 KaTeX 可用（思源运行时多数已注入；否则从 CDN 拉取） */
export function ensureKatex(): Promise<boolean> {
  if ((window as any).katex) return Promise.resolve(true);
  if (!katexLoading) {
    katexLoading = (async () => {
      try {
        addStyleOnce(`${KATEX_CDN}/dist/katex.min.css`, "hiword-katex-style");
        await addScriptOnce(`${KATEX_CDN}/dist/katex.min.js`, "hiword-katex-script");
        return !!(window as any).katex;
      } catch {
        return false;
      }
    })();
  }
  return katexLoading;
}

/** 确保 highlight.js 可用（思源运行时多数已注入；否则从 CDN 拉取） */
export function ensureHljs(): Promise<boolean> {
  if ((window as any).hljs) return Promise.resolve(true);
  if (!hljsLoading) {
    hljsLoading = (async () => {
      try {
        // 代码主题跟随思源外观：浅色 github，深色 github-dark
        const dark = (window as any).siyuan?.config?.appearance?.mode === 1;
        const theme = dark ? "github-dark" : "github";
        addStyleOnce(`${HLJS_CDN}/styles/${theme}.min.css`, "hiword-hljs-style");
        await addScriptOnce(`${HLJS_CDN}/highlight.min.js`, "hiword-hljs-script");
        return !!(window as any).hljs;
      } catch {
        return false;
      }
    })();
  }
  return hljsLoading;
}

/** 渲染容器内所有数学公式（行内 / 块级 / 兼容旧 data-subtype 格式） */
export function applyMath(element: HTMLElement): void {
  const katex = (window as any).katex;
  if (!katex) return;
  const renderOne = (node: HTMLElement): void => {
    if (node.hasAttribute("data-math-rendered")) return;
    const content = node.getAttribute("data-content") || node.textContent?.trim() || "";
    if (!content) {
      node.setAttribute("data-math-rendered", "true");
      return;
    }
    try {
      if (!node.hasAttribute("data-content")) node.setAttribute("data-content", content);
      const displayMode = node.tagName.toUpperCase() === "DIV";
      node.innerHTML = katex.renderToString(content, {
        throwOnError: false,
        displayMode,
        strict: (code: string) => (code === "unicodeTextInMathMode" ? "ignore" : "warn"),
        trust: true,
      });
      node.setAttribute("data-math-rendered", "true");
    } catch {
      node.setAttribute("data-math-rendered", "true");
    }
  };
  element
    .querySelectorAll(".language-math:not([data-math-rendered]), [data-subtype='math']:not([data-math-rendered]), [data-type='math-block']:not([data-math-rendered]), [data-type='math-inline']:not([data-math-rendered])")
    .forEach((n) => renderOne(n as HTMLElement));
}

/** 高亮容器内所有代码块（pre > code） */
export function applyCode(element: HTMLElement): void {
  const hljs = (window as any).hljs;
  if (!hljs) return;
  element.querySelectorAll("pre > code:not([data-highlighted])").forEach((block: any) => {
    if (block.querySelector(".hljs-keyword, .hljs-string, .hljs-comment, .hljs-number")) return;
    try {
      const code = block.textContent || "";
      const langMatch = (block.className || "").match(/(?:^|\s)language-([a-zA-Z0-9_-]+)/);
      const language = langMatch && langMatch[1] ? langMatch[1] : "";
      const result = language ? hljs.highlight(code, { language, ignoreIllegals: true }) : hljs.highlightAuto(code);
      block.innerHTML = result.value;
      block.classList.add("hljs");
      block.setAttribute("data-highlighted", "true");
      if (language) block.setAttribute("data-language", language);
    } catch (__swallowErr) { logSwallow(__swallowErr, "ai-enhance.ts · applyCode", "debug"); }
  });
}

/**
 * 对 AI 输出容器执行思源原生样式增强：数学公式 + 代码高亮。
 * 文本已由 Lute 渲染并即时可见；KaTeX/高亮属「锦上添花」，改在浏览器空闲时异步补全
 * （P2-2），避免长回答在「出结果」那一刻再卡顿。幂等可重复调用。
 */
export function enhanceSiYuanRender(container: HTMLElement): void {
  if (typeof window === "undefined") return;
  const run = () => {
    if (!container.isConnected) return; // 元素已被移除（如流式替换），跳过避免无效工作
    applyMath(container);
    applyCode(container);
    ensureKatex().then((ok) => {
      if (ok && container.isConnected) applyMath(container);
    });
    ensureHljs().then((ok) => {
      if (ok && container.isConnected) applyCode(container);
    });
  };
  // 优先空闲回调（带超时兜底），否则退化为 setTimeout(0)，让首屏文本先绘制
  const ric = (window as any).requestIdleCallback;
  if (typeof ric === "function") ric(run, { timeout: 500 });
  else setTimeout(run, 0);
}
