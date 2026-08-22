/**
 * 思源 Lute 引擎单例访问封装（2026-08-18）。
 * ------------------------------------------------------------------
 * 统一 Lute 的获取与降级，供：
 *  - 渲染层 fallback（whale-renderer / ai-render）输出思源富文本 HTML；
 *  - 数据层迁移归一化（HTML note → Kramdown）；
 *  - 编辑器 contenteditable 回退读取（HTML → Kramdown）；
 * 复用同一入口，避免各处重复取 Lute / 各写一份降级逻辑。
 *
 * **无业务模块依赖**：本文件不 import 任何 plugin 业务模块，避免循环引用。
 */

/**
 * 获取思源 Lute 引擎实例（优先已初始化的全局实例，否则尝试构造）。
 * 兼容思源不同版本的 Lute 暴露方式：
 *  - 早期：window.siyuan.lute（已实例化实例）
 *  - 3.8.x：window.Lute 是工厂对象，通过 window.Lute.New() 创建实例
 *  - 旧版：window.Lute 是构造函数，可 new window.Lute()
 *  - 个别版本：window.Lute 本身就是已实例化实例
 */
export function getLute(): any {
  try {
    const g: any = typeof globalThis !== "undefined" ? globalThis : {};
    const w = g.window || g;
    if (w?.siyuan?.lute) return w.siyuan.lute;
    if (w?.Lute) {
      // 思源 3.8.x：window.Lute 是工厂对象，用 .New() 创建实例
      if (typeof w.Lute.New === "function") return w.Lute.New();
      // 旧版：window.Lute 是构造函数
      if (typeof w.Lute === "function") return new w.Lute();
      // 个别版本：window.Lute 本身是已实例化实例
      if (typeof w.Lute === "object" && typeof w.Lute.Md2HTML === "function") return w.Lute;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * 为 Lute 实例开启完整 Kramdown/GFM 能力（表格、删除线、IAL、块引用、高亮、标签、上下标、SuperBlock、Callout）。
 * 思源自带 Lute（尤其 window.siyuan.lute）默认未必启用 GFM Table，直接调用 Md2HTML/Md2BlockDOM
 * 会导致管道表格被当成普通段落，在批注面板/弹窗 fallback 里显示成原始 `|...|`。
 * 调用方在渲染前调用一次即可；多次调用幂等且带容错（缺失 setter 不抛错）。
 */
export function configureKramdownLute(lute: any): void {
  if (!lute) return;
  const opt = (name: string, val: boolean) => {
    const fn = lute[name];
    if (typeof fn === "function") {
      try { fn.call(lute, val); } catch { /* ignore */ }
    }
  };
  opt("SetSanitize", true);           // XSS 防护（note 来自用户/AI，不可信）
  opt("SetGFMTable", true);           // 管道表格 → NodeTable
  opt("SetGFMStrikethrough", true);   // ~~删除线~~
  opt("SetKramdownIAL", true);        // {: 行内属性}
  opt("SetBlockRef", true);           // ((id "anchor")) 块引用
  opt("SetMark", true);               // ==高亮==
  opt("SetTag", true);                // #标签
  opt("SetSup", true);                // ^上标^
  opt("SetSub", true);                // ~下标~
  opt("SetSuperBlock", true);         // {{ }}
  opt("SetCallout", true);            // 引述块
}

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * HTML → Kramdown（旧数据归一化 / contenteditable 回退读取）。
 * 无 Lute 时退化为原样返回（调用方据此判断是否真正转换成功，便于保留原格式）。
 */
export function htmlToMd(html: string): string {
  const lute = getLute();
  if (lute && typeof lute.HTML2Md === "function") {
    try { return lute.HTML2Md(html || ""); } catch { /* fallback below */ }
  }
  return html || "";
}

/**
 * Kramdown → 思源富文本 HTML（fallback / 兜底渲染，输出放入 b3-typography 容器）。
 * 无 Lute 时退化为转义 + 换行，保证至少可见。
 */
export function mdToHtml(md: string): string {
  const lute = getLute();
  if (lute && typeof lute.Md2HTML === "function") {
    try {
      configureKramdownLute(lute);      // 开启 GFM Table 等，避免表格 fallback 失效
      return lute.Md2HTML(md || "");
    } catch { /* fallback below */ }
  }
  return escapeHtml(md).replace(/\n/g, "<br>");
}
