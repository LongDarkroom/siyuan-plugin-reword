/**
 * 批注只读预览实例池（2026-08-18）
 * ------------------------------------------------------------------
 * 把批注 note 以「原生 SiYuan lite Protyle 只读实例」形式 1:1 还原展示，
 * 取代原先「Lute Md2BlockDOM + 手写 blockDom2Typo 转换器 → b3-typography」的渲染链路。
 *
 * 设计要点：
 *  - 每条含 note 的批注 = 一个 lite Protyle 只读实例，挂在 `.whale-notes-protyle[data-ann-id]` 宿主里；
 *  - IntersectionObserver 懒挂载 / 离屏销毁（列表多大都不卡）；
 *  - LRU 上限（maxLive）+ 离屏宽限（unmountDelay）抑制实例数与快滚抖动；
 *  - 面板 innerHTML 重建前必须 destroyAllPreviews()，否则 Protyle 内核监听指向 detached 节点；
 *  - 块引用点击在 capture 阶段拦截，转 openBlock（blockId:"" 的 lite 实例不触发内核 ref 事务）；
 *  - sweepDetached() 自愈：任何未走 helper 的 innerHTML 覆写留下的悬垂实例。
 *
 * 单一职责：本模块不反向 import index.ts / whale-renderer.ts，避免循环依赖。
 */

import { mountAnnEditor, type AnnEditor } from "./ann-editor.ts";
import { expandInlineTableRows } from "./annotation-render.ts";
import { getLogger } from "../core/logger.ts";

/** 预览宿主选择器（由 whale-renderer.ts 渲染产出） */
export const PREVIEW_HOST_SELECTOR = ".whale-notes-protyle";
/** 原生预览挂载成功后加在 `.whale-notes-text` 上，CSS 据此隐藏静态兜底 */
const LIVE_CLASS = "whale-notes-text--live";

export interface PreviewRegistryOptions {
  /** window.siyuan.ws.app —— 挂载 lite Protyle 必需 */
  app: any;
  /** 按 annId 取 note 内容（Kramdown / 旧 HTML） */
  getNote: (annId: string) => string;
  /** 块引用被点击时的回调（通常转 openAnnotationBlock） */
  onBlockRefClick?: (blockId: string) => void;
  /** 同屏最大存活实例数（默认 12，超出按 LRU 淘汰） */
  maxLive?: number;
  /** 离屏后宽限销毁时长 ms（默认 600，快滚回弹不抖动） */
  unmountDelay?: number;
  /** IntersectionObserver rootMargin（默认 "320px 0px"，提前一屏挂载） */
  rootMargin?: string;
}

let opts: PreviewRegistryOptions | null = null;
const live = new Map<string, AnnEditor>();       // annId -> editor
const pending = new Map<string, number>();        // annId -> 离屏销毁定时器
const lastSeen = new Map<string, number>();        // annId -> 最近可见时间（LRU）
const editing = new Set<string>();                 // annId -> 正在编辑中（预览让位，D6）
const failed = new Set<string>();                  // annId -> 挂载失败负缓存（防重试风暴，D6）
let io: IntersectionObserver | null = null;

/** 配置注册表（每次面板重渲染都会重新 configure，app 统一从 window.siyuan 取） */
export function configurePreviewRegistry(o: PreviewRegistryOptions): void {
  opts = o;
}

/**
 * 面板每次重渲染后调用：重建 observer（旧 root 已被 innerHTML 销毁）+ 登记全部宿主。
 * 必须在 destroyAllPreviews() 之后调用。
 */
export function setupPreviews(container: HTMLElement): void {
  sweepDetached();
  const root = container.querySelector("#whale-panel-list") as HTMLElement | null;
  io?.disconnect();
  io = new IntersectionObserver(onIntersect, {
    root: root ?? null,                       // root 为 null 时退化为视口，仍可用
    rootMargin: opts?.rootMargin ?? "320px 0px",
    threshold: 0,
  });
  container.querySelectorAll<HTMLElement>(PREVIEW_HOST_SELECTOR).forEach((h) => {
    if (editing.has(h.dataset.annId || "")) return; // 编辑中的卡片不挂预览（D6）
    io!.observe(h);
  });
}

function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const e of entries) {
    const host = e.target as HTMLElement;
    const id = host.dataset.annId || "";
    if (!id) continue;
    if (e.isIntersecting) {
      if (editing.has(id)) return;                 // 编辑中即使进入视口也不挂载（D6）
      cancelUnmount(id);
      lastSeen.set(id, Date.now());
      mountPreview(host, id);
    } else {
      scheduleUnmount(id);
    }
  }
}

/**
 * 判断 note 是否含 Markdown/Kramdown 管道表格，需走静态兜底（Lute Md2HTML）。
 *  - 已含 HTML <table> → 直接兜底；
 *  - 管道表格：表头行含 `|` 分隔，紧接分隔行（仅 | : - 与空白，且含 `-`）。
 *    兼容 SiYuan/Kramdown 省略左右边缘 `|` 的写法（如 `Col1 | Col2` 紧接 `--- | ---`）。
 *  lite Protyle（Md2BlockDOM）对表格支持不全，漏判会导致原始 `|...|` 文本残留。
 */
export function noteContainsTable(note: string): boolean {
  if (/<table[\s>]/i.test(note)) return true;
  const lines = note.split(/\r?\n/);
  const isSep = (l: string) => /^\s*\|?[\s:\-|]+\|?\s*$/.test(l) && l.includes("-");
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i];
    const sep = lines[i + 1];
    if (header.includes("|") && isSep(sep)) return true;
  }
  return false;
}

/**
 * 判断 note 是否「仅含行内格式」，值得用 lite Protyle 做增强预览（可选中/1:1 还原）。
 *  - 返回 true  = 仅行内（加粗/斜体/高亮/链接/行内代码等），可挂 lite Protyle；
 *  - 返回 false = 含任意块级结构（表格/标题/列表/引用/代码块/分割线/Callout/超级块），
 *               必须走静态兜底（Lute Md2HTML），lite Protyle 对块级结构解析不全易塌缩。
 *
 * 2026-08-19 表格渲染修复核心：旧 `noteContainsTable` 只识别表格，漏判的表格误走 lite
 * Protyle 导致 `|...|` 文本塌缩；现扩大为「任意块级结构都静态兜底」，杜绝漏判。
 */
export function noteShouldUseLite(note: string): boolean {
  if (!note || !note.trim()) return true;
  // 2026-08-19 修复：先展开「单行空格分隔的伪表格」（AI/粘贴常把换行压成空格、只在末尾留 \n），
  // 否则 note 形如 `|表头|数据| |分隔|数据|...\n` 时：多行分支不命中（拆行后仅一行 + 空行）、
  // 单行分支因含 \n 被跳过 → 误判为纯行内、挂载 lite Protyle，表格塌成 `|...|` 文本。
  const n = expandInlineTableRows(note);
  // 1) 旧 HTML 数据：含任意块级 HTML 标签 → 静态兜底（HTML2Md 转换在渲染层完成，此处只看原始 note）
  if (/<(table|thead|tbody|tfoot|tr|td|th|caption|colgroup|col|h[1-6]|ul|ol|li|blockquote|pre|hr|div|p|details|summary|figure)\b/i.test(n)) {
    return false;
  }
  const lines = n.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i];
    const sep = lines[i + 1];
    // 管道表格：表头含 `|`，紧接分隔行（仅 | : - 与空白，含 `-`；兼容 |:-:|、| --- |、无边缘 |）
    if (header.includes("|") && /^\s*\|?[\s:\-|]+\|?\s*$/.test(sep) && sep.includes("-")) return false;
  }
  // 1b) 单行空格分隔的伪表格（AI/粘贴常把换行压成空格）
  if (!/\n/.test(n)) {
    // 与 expandInlineTableRows 一致：非贪婪 + lookahead 按行边界拆分
    const rows = n.match(/\|(?:[^|]*\|)+?(?=\s+\||\s*$)/g);
    if (rows && rows.length >= 2 && rows.some(r => /^\s*\|?[\s:\-|]+\|?\s*$/.test(r) && r.includes("-"))) {
      return false;
    }
  }
  // 2) ATX 标题
  if (/^\s{0,3}#{1,6}\s+\S/m.test(n)) return false;
  // 3) 分割线（--- / *** / ___）
  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m.test(n)) return false;
  // 4) 无序列表
  if (/^\s{0,3}[-*+]\s+\S/m.test(n)) return false;
  // 5) 有序列表
  if (/^\s{0,3}\d+\.\s+\S/m.test(n)) return false;
  // 6) 引用
  if (/^\s{0,3}>\s?/m.test(n)) return false;
  // 7) 围栏代码块 / 超级块 / Callout
  if (/```|~~~|{{|:::/m.test(n)) return false;
  return true;
}

export function mountPreview(host: HTMLElement, annId: string): void {
  if (!opts || !annId || live.has(annId) || !host.isConnected) return;
  if (editing.has(annId)) return;                  // 编辑锁：编辑中跳过挂载（D6）
  if (failed.has(annId)) return;                   // 负缓存：上次挂载失败不再重试
  // 2026-08-19 修复：先展开「单行伪表格」，再判断与挂载。否则末尾带 \n 的伪表格会漏判为
  // 纯行内、误挂 lite Protyle 把表格塌成 `|...|` 文本；即便判断命中，传给 Protyle 的也需
  // 是展开后的多行表格才能正确渲染。
  const note = expandInlineTableRows(opts.getNote(annId) || "");
  if (!note) return;                                   // 纯标注（bare 分支）本就没有宿主
  // 2026-08-19 块级/表格修复：含任意块级结构（表格/标题/列表/引用/代码块/分割线/Callout）
  // 的 note 一律走静态兜底（renderAnnotationHTML → Lute Md2HTML），不再挂 lite Protyle，
  // 彻底杜绝漏判导致表格 `|...|` 文本塌缩。仅纯行内 note 才用 lite Protyle 增强。
  if (!noteShouldUseLite(note)) return;
  evictIfNeeded();
  const wrap = host.closest(".whale-notes-text") as HTMLElement | null;
  const editor = mountAnnEditor(host, {
    app: opts.app,
    initial: note,
    readonly: true,
    toolbar: [],
    onReady: (ok) => {
      if (ok) wrap?.classList.add(LIVE_CLASS);          // 成功后才隐藏静态兜底 → 零闪白
      else { live.delete(annId); failed.add(annId); }   // 回退：不占池位；记负缓存防重试风暴
    },
  });
  live.set(annId, editor);
  lastSeen.set(annId, Date.now());
  bindRefClicks(host);
}

export function destroyPreview(annId: string): void {
  cancelUnmount(annId);
  editing.delete(annId);                            // 释放编辑锁（D6）
  failed.delete(annId);                             // 清除负缓存
  const ed = live.get(annId);
  live.delete(annId);
  if (!ed) return;
  const host = ed.el;
  try { ed.destroy(); } catch (e) { getLogger().warn("[REword-Ann-Preview] 预览销毁异常", { error: e }); }
  if (host?.isConnected) {
    unbindRefClicks(host);
    host.removeAttribute("contenteditable");
    host.classList.remove("ann-editor--readonly");
    host.innerHTML = "";
    host.closest(".whale-notes-text")?.classList.remove(LIVE_CLASS);   // 回落静态兜底
  }
}

/** 面板 innerHTML 覆写前 / Tab 切走前必须调用 */
export function destroyAllPreviews(): void {
  for (const id of [...live.keys()]) destroyPreview(id);
  live.clear();
  pending.forEach((t) => clearTimeout(t));
  pending.clear();
  lastSeen.clear();
  editing.clear();
  failed.clear();
}

/** 插件卸载（index.ts onunload） */
export function disposePreviewRegistry(): void {
  destroyAllPreviews();
  io?.disconnect();
  io = null;
  opts = null;
  lastSeen.clear();
}

export function observeHost(host: HTMLElement | null): void { if (host) io?.observe(host); }
export function unobserveHost(host: HTMLElement | null): void { if (host) io?.unobserve(host); }
/** DevTools 自检：当前存活预览实例数 */
export function livePreviewCount(): number { return live.size; }

function scheduleUnmount(id: string): void {
  if (pending.has(id) || !live.has(id)) return;
  pending.set(id, window.setTimeout(() => {
    pending.delete(id);
    destroyPreview(id);
  }, opts?.unmountDelay ?? 600));
}

function cancelUnmount(id: string): void {
  const t = pending.get(id);
  if (t !== undefined) { clearTimeout(t); pending.delete(id); }
}

/** LRU 淘汰：超过 maxLive 时销毁最久未可见的实例 */
function evictIfNeeded(): void {
  const max = opts?.maxLive ?? 12;
  while (live.size >= max) {
    let oldest = "";
    let t = Infinity;
    for (const id of live.keys()) {
      const s = lastSeen.get(id) ?? 0;
      if (s < t) { t = s; oldest = id; }
    }
    if (!oldest) break;
    destroyPreview(oldest);
  }
}

/** 自愈：任何未走 helper 的 innerHTML 覆写留下的悬垂实例 */
function sweepDetached(): void {
  for (const [id, ed] of [...live.entries()]) {
    if (!ed.el?.isConnected) {
      try { ed.destroy(); } catch { /* ignore */ }
      live.delete(id);
    }
  }
}

/** 块引用点击：capture 阶段拦下，交调用方 openBlock（避免 blockId:"" 的 lite 实例走内核路径） */
function bindRefClicks(host: HTMLElement): void {
  if ((host as any).__refHandler) return;
  const handler = (e: MouseEvent) => {
    const t = (e.target as HTMLElement)?.closest?.('[data-type~="block-ref"]') as HTMLElement | null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const id = t.getAttribute("data-id") || "";
    if (id) opts?.onBlockRefClick?.(id);
  };
  (host as any).__refHandler = handler;
  host.addEventListener("click", handler, true);
}

/** 撤销 bindRefClicks 绑定的 capture 监听（destroyPreview 时调用，防泄漏） */
function unbindRefClicks(host: HTMLElement): void {
  const handler = (host as any).__refHandler;
  if (handler) {
    host.removeEventListener("click", handler, true);
    (host as any).__refHandler = undefined;
  }
}

/** 编辑锁：标记/解除某 annId 正在编辑（总控在 editAnnotationInline 起止调用，D6） */
export function markEditing(annId: string): void { editing.add(annId); }
export function unmarkEditing(annId: string): void { editing.delete(annId); }
