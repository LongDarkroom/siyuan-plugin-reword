<!--
  PDF 文本标注自建覆盖层（P1，2026-09-04）

  在 foliate PDF 文本层之上叠绝对定位矩形，按 page + 归一化坐标（0-1，相对当前页 iframe 框）存储，
  翻页 / 缩放 / 滚动时按当前页 iframe 框重映射回屏幕坐标，不写 PDF 本体。

  设计要点：
   - 视觉为单一真源：ReaderView 的 saveHighlight / onNoteSave 在 PDF 下已短路 foliate 原生
     addAnnotation，所有 PDF 文本高亮/下划线/波浪线只由本层绘制，避免双重绘制。
   - 仅 PDF 模式挂载（与 PdfOverlay 同处 {if readerMode === "pdf"}）。
   - pointer-events:none：不拦截划词 / 点击，选区与 foliate 原生交互照常工作；
     矩形标注（kind:"rect"）经层 contextmenu 委托右键弹菜单（换色/复制链接/删除，
     2026-09-09 P1.3），盒子本身不拦截指针。
   - 重绘触发：annStore.subscribe（数据变更）+ ResizeObserver（缩放/翻页换 iframe）
     + window resize/scroll + 响应式 prop（view/opened/pdfCurrentPage）。
-->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { getAnnotationStore } from "../annotation/store-singleton";
  import { type PdfRect, DEFAULT_ANNOTATION_COLOR, WHALE_COLORS } from "../annotation/annotation-store.ts";
  import { dedupeNestedRects } from "./pdf-rect-util.ts";
  import { t } from "../i18n/index.ts";

  /** 当前书籍 id（批注按 bookId 隔离） */
  export let bookId: string = "";
  /** foliate view 实例（开书后注入；未注入时本层不绘制） */
  export let view: any = null;
  /** 阅读器是否打开（关书后清空） */
  export let opened: boolean = false;
  /** 当前 PDF 页码（1-based），仅作响应式重绘触发（翻页） */
  export let pdfCurrentPage: number = 0;
  /** 2026-09-09 P1.3：右键菜单「复制链接」回调（ReaderView 注入，按标注重建 markdown 进剪贴板） */
  export let onRectCopyLink: ((annId: string) => void) | null = null;
  /** 2026-09-09 撤销：删除矩形后由 ReaderView 托管撤销窗口（快照延迟清理） */
  export let onRectDeleted: ((annId: string) => void) | null = null;
  /** 2026-09-09 撤销：是否存在未过期的待撤销删除（控制右键菜单「撤销删除」项） */
  export let pendingUndo: boolean = false;
  /** 2026-09-09 撤销：执行撤销（ReaderView 的 undoDelete） */
  export let onUndoDelete: (() => void) | null = null;
  /**
   * 2026-09-09 点击命中：点中文本标注（高亮/直线/波浪线）时回调，由 ReaderView 弹编辑态工具栏。
   * 参数为主文档（窗口）坐标：x/y 点击点，rect 命中的那条矩形（供工具栏上下避让定位）。
   */
  export let onAnnotClick: ((payload: { annId: string; x: number; y: number; rect: { left: number; top: number; right: number; bottom: number } }) => void) | null = null;

  type DrawRect = {
    left: number;
    top: number;
    width: number;
    height: number;
    color: string;
    style: string;
    /** 2026-09-09 P1：矩形框选标注（半透明填充 + 实线边框，区别于文本高亮） */
    kind?: string;
    /** 所属标注 id（矩形闪烁定位用；文本高亮可不带） */
    annId?: string;
  };

  let layerEl: HTMLDivElement;
  let rects: DrawRect[] = [];

  let annStore: any = null;
  try { annStore = getAnnotationStore(); } catch { annStore = null; }

  let rafId: number | null = null;
  let settleTimers: number[] = [];
  function scheduleRecompute() {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      recompute();
    });
    // 2026-09-09 漂移加固：翻页/开书/缩放时目标页 iframe 异步加载渲染，
    // rAF 当帧取到的 frame/textLayer 几何可能是初始化中途的脏值，画错后
    // 若无后续滚动/缩放就永远停在错位上。加两趟去抖收敛重绘兜底。
    for (const t of settleTimers) clearTimeout(t);
    settleTimers = [350, 1200].map((d) => window.setTimeout(() => recompute(), d) as unknown as number);
  }

  let lastRectsSig = "";
  /** 2026-09-09 发热治理：recompute 被 scroll(capture)/ResizeObserver/settle 定时器
   *  高频触发，几何不变时（静止态的定时器与 RO 突发）直接跳过 Svelte 赋值，
   *  不再反复失效 {#each} 重建全部盒子 DOM。 */
  function recompute() {
    const out = computeRects();
    const sig = out
      .map((r) => `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)},${r.color},${r.style},${r.kind || ""},${r.annId || ""}`)
      .join("|");
    if (sig === lastRectsSig) return;
    lastRectsSig = sig;
    rects = out;
  }

  function computeRects(): DrawRect[] {
    if (!annStore || !bookId || !view || !layerEl) return [];
    const renderer = view.renderer;
    if (!renderer || typeof renderer.getContents !== "function") return [];
    let contents: any[] = [];
    try { contents = renderer.getContents() || []; } catch { return []; }
    if (!contents.length) return [];

    const layerRect = layerEl.getBoundingClientRect();
    const annots = (annStore.getByBook(bookId) || []).filter(
      (a: any) => a.bookType === "pdf" && !a.deletedAt && a.pdfRects && a.pdfRects.length
    );
    if (!annots.length) return [];

    const out: DrawRect[] = [];
    for (const c of contents) {
      const doc = c.doc;
      // 右键菜单：确保该页 iframe 文档已挂 contextmenu 监听（幂等）
      try { ensureIframeContextmenu(doc); } catch { /* doc 异常跳过 */ }
      const frame = doc?.defaultView?.frameElement as HTMLElement | null;
      if (!frame) continue;
      const fr = frame.getBoundingClientRect();
      if (fr.width <= 0 || fr.height <= 0) continue;
      // 2026-09-08 基准统一：归一化坐标相对 iframe 内 .textLayer（与保存端同一参照系）。
      // 此前用 frame 框做基准，与选区 rect 的坐标系存在偏差 → 高亮错位、滚动缩放后跑丢。
      // 跨文档 getBoundingClientRect 返回相对 iframe 视口的坐标，加 frame 偏移换算到主文档。
      let tl: DOMRect | null = null;
      try { tl = (doc.querySelector?.(".textLayer") as HTMLElement | null)?.getBoundingClientRect() ?? null; } catch { tl = null; }
      const bw = (tl && tl.width > 0 ? tl.width : fr.width) || 1;
      const bh = (tl && tl.height > 0 ? tl.height : fr.height) || 1;
      const baseLeft = fr.left + (tl ? tl.left : 0);
      const baseTop = fr.top + (tl ? tl.top : 0);
      const p = (c.index ?? 0) + 1;
      for (const a of annots) {
        if (a.page !== p) continue;
        // 2026-09-09 双绘根治③：按标注去嵌套矩形。存量数据里实测有同一行两套
        // 嵌套矩形（getClientRects 双报），绘制端清洗后旧标注无需迁移即画单层。
        const pageRects = dedupeNestedRects((a.pdfRects as PdfRect[]).filter((r) => r.page === p));
        for (const r of pageRects) {
          const left = (baseLeft - layerRect.left) + r.x * bw;
          const top = (baseTop - layerRect.top) + r.y * bh;
          const width = r.w * bw;
          const height = r.h * bh;
          out.push({ left, top, width, height, color: a.color || "#06b6d4", style: a.style || "highlight", kind: a.kind, annId: a.id });
        }
      }
    }
    return out;
  }

  function rectCss(r: DrawRect): string {
    const color = r.color || "#06b6d4";
    if (r.style === "rectbox" || r.kind === "rect") {
      // 2026-09-09 P1 矩形框选标注：半透明填充 + 1.5px 实线边框（对齐思源内置 PDF 矩形标注视觉）
      return `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:${color}33;border:1.5px solid ${color};border-radius:2px;box-sizing:border-box;`;
    }
    if (r.style === "highlight") {
      // 背景半透明高亮（8 位 hex 第 4 组 = 透明度 ~13%）
      return `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:${color}22;border-radius:2px;box-sizing:border-box;`;
    }
    // 直线段：沿矩形底部画一条实线
    if (r.style === "solid") {
      return `position:absolute;left:${r.left}px;top:${r.top + r.height - 2}px;width:${r.width}px;height:0;border-bottom:2px solid ${color};box-sizing:border-box;`;
    }
    // 波浪线：2026-09-09 真波浪。此前用 border-bottom dotted 画点线近似，
    // 与 EPUB 侧 foliate Overlayer.squiggly 观感不一致。改为在矩形底部平铺
    // 一条 SVG 波形（颜色按标注色编码进 data URI，repeat-x 横向重复），
    // 无额外 DOM 节点，缩放时随矩形一起拉伸。
    const waveSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="6" viewBox="0 0 16 6">` +
      `<path d="M0 4 Q 2 0.5 4 4 T 8 4 T 12 4 T 16 4" fill="none" stroke="${color}" stroke-width="1.3" stroke-linecap="round"/>` +
      `</svg>`;
    const waveUrl = `url('data:image/svg+xml,${encodeURIComponent(waveSvg)}')`;
    return `position:absolute;left:${r.left}px;top:${r.top + r.height - 4}px;width:${r.width}px;height:6px;` +
      `background-image:${waveUrl};background-repeat:repeat-x;background-position:left bottom;` +
      `background-size:16px 6px;background-color:transparent;box-sizing:border-box;`;
  }

  let unsub: (() => void) | null = null;
  let ro: ResizeObserver | null = null;

  /** 2026-09-09 P1：跳转定位后让指定矩形闪烁强调（深链回跳 / 我的标记跳转共用）。
   *  跳页后目标页 iframe 异步加载渲染，矩形可能晚数百 ms 才画出来——
   *  轮询等待元素出现（上限 ~2.5s），再加动画类 1.2s 后移除。 */
  export async function flashRect(annId: string): Promise<void> {
    if (!annId || !layerEl) return;
    let el: HTMLElement | null = null;
    for (let i = 0; i < 25 && !el; i++) {
      await new Promise((r) => setTimeout(r, 100));
      el = layerEl.querySelector(`.pdf-text-hl-rect[data-ann-id="${annId}"]`) as HTMLElement | null;
    }
    if (!el) return;
    el.classList.remove("pdf-rect-flash");
    // 强制 reflow 重启动画
    void el.offsetWidth;
    el.classList.add("pdf-rect-flash");
    setTimeout(() => el.classList.remove("pdf-rect-flash"), 1300);
  }

  /** 2026-09-09 P1.3：矩形标注右键菜单（换色 / 复制链接 / 删除）。
   *  监听挂在每个页面 iframe 的 document 上（层与盒子 pointer-events:none 收不到
   *  iframe 事件），命中后弹菜单——划选零干扰（P1.2 的盒子可点方案已废弃）。 */
  let menuAnnId = "";
  let menuX = 0;
  let menuY = 0;
  /** 2026-09-09 撤销：删除后短期内的「撤销删除」小菜单（不含色板/复制/删除） */
  let menuUndoOpen = false;

  function closeRectMenu() {
    menuAnnId = "";
    menuUndoOpen = false;
  }

  function runUndoDelete() {
    menuUndoOpen = false;
    onUndoDelete?.();
  }

  function openRectMenuAtMain(mx: number, my: number, annId: string) {
    if (!layerEl) return;
    const lr = layerEl.getBoundingClientRect();
    // 菜单锚在右键点（主文档坐标），收进层边界内防止 overflow:hidden 裁切（含色板行，预留高度更大）
    menuX = Math.min(Math.max(8, mx - lr.left + 4), Math.max(8, lr.width - 132));
    menuY = Math.min(Math.max(8, my - lr.top + 4), Math.max(8, lr.height - 110));
    menuAnnId = annId;
  }

  /**
   * 2026-09-09 P1.3：iframe 内右键命中矩形标注。
   * 层与盒子都是 pointer-events:none，主文档收不到页面区域的 contextmenu（iframe 吞掉），
   * 故监听挂在每个页面 iframe 的 document 上，iframe 内坐标直接对归一化矩形做命中测试，
   * 命中后 preventDefault（屏蔽浏览器默认菜单）并换算主文档坐标弹菜单。
   */
  function onIframeContextmenu(doc: Document, e: MouseEvent) {
    if (!annStore || !bookId) return;
    let tl: DOMRect | null = null;
    try { tl = (doc.querySelector(".textLayer") as HTMLElement | null)?.getBoundingClientRect() ?? null; } catch { tl = null; }
    if (!tl || !(tl.width > 0) || !(tl.height > 0)) return;
    const tw = tl.width, th = tl.height;
    const px = e.clientX, py = e.clientY;
    // 顶层优先：后更新的标注排前（近似绘制次序）
    const annots = (annStore.getByBook(bookId) || [])
      .filter((a: any) => a.bookType === "pdf" && !a.deletedAt && a.kind === "rect" && a.pdfRects?.length)
      .sort((a: any, b: any) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    for (const a of annots) {
      for (const r of a.pdfRects as PdfRect[]) {
        const rl = tl.left + r.x * tw, rt = tl.top + r.y * th;
        if (px >= rl && px <= rl + r.w * tw && py >= rt && py <= rt + r.h * th) {
          e.preventDefault();
          e.stopPropagation();
          const frame = doc.defaultView?.frameElement as HTMLElement | null;
          if (!frame || !layerEl) return;
          const fr = frame.getBoundingClientRect();
          openRectMenuAtMain(fr.left + e.clientX, fr.top + e.clientY, a.id);
          return;
        }
      }
    }
    // 2026-09-09 撤销：未命中任何矩形时，若存在待撤销的删除 → 就地弹「撤销删除」小菜单
    if (pendingUndo) {
      e.preventDefault();
      e.stopPropagation();
      const frame = doc.defaultView?.frameElement as HTMLElement | null;
      if (!frame || !layerEl) return;
      const fr = frame.getBoundingClientRect();
      openRectMenuAtMain(fr.left + e.clientX, fr.top + e.clientY, "");
      menuUndoOpen = true;
      return;
    }
    closeRectMenu();
  }

  /**
   * 2026-09-09：iframe 内点击命中文本标注 → 打开编辑态工具栏（删除 + 样式 + 颜色）。
   * EPUB 下由 foliate 原生 overlayer 命中派发 show-annotation，PDF 原生层已停画（双绘根治），
   * 故在此补命中：与右键菜单同一套 textLayer 归一化坐标换算。
   * 只在「纯点击」时触发（选区折叠），拖选新文本仍走原有 create 工具栏，互不干扰。
   */
  function onIframeClick(doc: Document, e: MouseEvent) {
    if (!onAnnotClick) return;
    // 拖选 / 双击选词（都会留下选区）不触发，避免与新建标注打架
    try {
      const sel = doc.getSelection?.();
      if (sel && !sel.isCollapsed) return;
    } catch { return; }
    let tl: DOMRect | null = null;
    try { tl = (doc.querySelector(".textLayer") as HTMLElement | null)?.getBoundingClientRect() ?? null; } catch { tl = null; }
    if (!tl || !(tl.width > 0) || !(tl.height > 0)) return;
    const px = e.clientX, py = e.clientY;
    const annots = (annStore?.getByBook(bookId) || [])
      .filter((a: any) => a.bookType === "pdf" && !a.deletedAt && a.kind !== "rect" && a.pdfRects?.length)
      .sort((a: any, b: any) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    for (const a of annots) {
      for (const r of a.pdfRects as PdfRect[]) {
        const rl = tl.left + r.x * tl.width, rt = tl.top + r.y * tl.height;
        if (px >= rl && px <= rl + r.w * tl.width && py >= rt && py <= rt + r.h * tl.height) {
          const frame = doc.defaultView?.frameElement as HTMLElement | null;
          if (!frame) return;
          const fr = frame.getBoundingClientRect();
          onAnnotClick({
            annId: a.id,
            x: fr.left + px,
            y: fr.top + py,
            rect: {
              left: fr.left + rl,
              top: fr.top + rt,
              right: fr.left + rl + r.w * tl.width,
              bottom: fr.top + rt + r.h * tl.height,
            },
          });
          return;
        }
      }
    }
  }

  /** 已挂监听的 iframe 文档集合（WeakSet：文档销毁自动随 iframe 回收） */
  const ctxDocSeen = new WeakSet<Document>();
  function ensureIframeContextmenu(doc: Document) {
    if (!doc || ctxDocSeen.has(doc)) return;
    ctxDocSeen.add(doc);
    doc.addEventListener("contextmenu", (e) => onIframeContextmenu(doc, e));
    // 2026-09-09：点击命中文本标注（编辑态入口，PDF 补齐 EPUB 原生 overlayer 的能力）
    doc.addEventListener("click", (e) => onIframeClick(doc, e));
  }

  function copyMenuLink() {
    const id = menuAnnId;
    closeRectMenu();
    if (id && onRectCopyLink) onRectCopyLink(id);
  }

  async function changeRectColor(color: string) {
    const id = menuAnnId;
    closeRectMenu();
    if (!id || !color || !annStore || typeof annStore.upsert !== "function") return;
    try {
      await annStore.upsert({ id, color });
    } catch (e) {
      console.warn("[REword] 矩形标注换色失败:", e);
    }
  }

  async function deleteRectAnnotation() {
    const id = menuAnnId;
    closeRectMenu();
    if (!id || !annStore || typeof annStore.remove !== "function") return;
    try {
      await annStore.remove(id);
      // 2026-09-09 撤销：快照不再立即删——交给 ReaderView 的撤销窗口，
      // 窗口过期才真正清理（撤销成功则图片保留，避免撤销后图已丢）。
      onRectDeleted?.(id);
    } catch (e) {
      console.warn("[REword] 删除矩形标注失败:", e);
    }
  }

  function onDocMouseDown(e: MouseEvent) {
    if (!menuAnnId) return;
    const t = e.target as HTMLElement | null;
    if (t && typeof t.closest === "function" && t.closest(".pdf-rect-menu")) return;
    closeRectMenu();
  }
  function onDocKeydown(e: KeyboardEvent) {
    if (menuAnnId && e.key === "Escape") closeRectMenu();
  }

  onMount(() => {
    if (annStore && typeof annStore.subscribe === "function") {
      unsub = annStore.subscribe(() => scheduleRecompute());
    }
    // 观察 stage + reader-container 尺寸变化（zoom / 翻页换 iframe / 窗口变化都会触发）
    const stage = layerEl?.parentElement;
    const containerEl = stage?.querySelector(".reader-container") as HTMLElement | null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => scheduleRecompute());
      if (stage) ro.observe(stage);
      if (containerEl) ro.observe(containerEl);
    }
    window.addEventListener("resize", scheduleRecompute);
    window.addEventListener("scroll", scheduleRecompute, true);
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onDocKeydown, true);
    scheduleRecompute();
  });

  onDestroy(() => {
    if (unsub) unsub();
    if (ro) ro.disconnect();
    for (const t of settleTimers) clearTimeout(t);
    settleTimers = [];
    window.removeEventListener("resize", scheduleRecompute);
    window.removeEventListener("scroll", scheduleRecompute, true);
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onDocKeydown, true);
  });

  // 响应式触发：开书 / 翻开 / 翻页
  $: if (view && opened) scheduleRecompute();
  $: if (pdfCurrentPage) scheduleRecompute();
</script>

{#if opened}
  <div class="pdf-text-hl-layer" bind:this={layerEl}>
    {#each rects as r}
      <div class="pdf-text-hl-rect" style={rectCss(r)} data-ann-id={r.annId || ""}></div>
    {/each}
    {#if menuAnnId}
      <div class="pdf-rect-menu" style="left:{menuX}px;top:{menuY}px;" role="menu">
        <div class="pdf-rect-menu-colors">
          {#each WHALE_COLORS as c}
            <button class="pdf-rect-menu-swatch" type="button" title={t(c.name)} style="background:{c.value};"
              on:click={() => changeRectColor(c.value)}></button>
          {/each}
        </div>
        <button class="pdf-rect-menu-item" type="button" on:click={copyMenuLink}>{t("复制链接")}</button>
        <button class="pdf-rect-menu-item pdf-rect-menu-del" type="button" on:click={deleteRectAnnotation}>{t("删除")}</button>
      </div>
    {/if}
    <!-- 2026-09-09 撤销：删除后短期内的「撤销删除」菜单（位置沿用 menuX/menuY） -->
    {#if menuUndoOpen}
      <div class="pdf-rect-menu" style="left:{menuX}px;top:{menuY}px;" role="menu">
        <button class="pdf-rect-menu-item" type="button" on:click={runUndoDelete}>撤销删除</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .pdf-text-hl-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    /* 2026-09-09 修复：原为 6，会盖住 .reader-floating-layer（z-index:2，划词工具栏/批注卡宿主）
       ——波浪线直接穿过工具栏。降到 1：仍高于 iframe 容器（auto/0），视觉不变，
       但浮层组内所有 UI 都在标注层之上。 */
    z-index: 1;
    overflow: hidden;
  }
  .pdf-text-hl-rect {
    pointer-events: none;
  }
  /* 2026-09-09 P1.3：矩形标注右键菜单（色板 + 复制链接 + 删除）。
     盒子不再可点（避免挡划选起笔），菜单由层 contextmenu 委托命中弹出。 */
  .pdf-rect-menu {
    position: absolute;
    z-index: 12;
    pointer-events: auto;
    min-width: 112px;
    padding: 6px;
    background: var(--b3-menu, var(--b3-theme-surface, #fff));
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.1));
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    box-sizing: border-box;
  }
  .pdf-rect-menu-colors {
    display: flex;
    gap: 6px;
    padding: 2px 4px 6px;
    border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    margin-bottom: 4px;
  }
  .pdf-rect-menu-swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.15));
    border-radius: 50%;
    cursor: pointer;
  }
  .pdf-rect-menu-swatch:hover {
    transform: scale(1.15);
  }
  .pdf-rect-menu-item {
    display: block;
    width: 100%;
    padding: 5px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--b3-theme-on-surface, inherit);
    font-size: 13px;
    line-height: 1.4;
    text-align: left;
    cursor: pointer;
  }
  .pdf-rect-menu-item:hover {
    background: var(--b3-list-hover, rgba(0, 0, 0, 0.06));
  }
  .pdf-rect-menu-del {
    color: var(--b3-theme-error, #d23f31);
  }
  /* 2026-09-09 P1：矩形标注跳转定位闪烁（1.2s 三次脉冲，结束后由 JS 移除类）。
     类名由 flashRect 运行时添加，Svelte 静态分析不可见，用 :global 声明。 */
  :global(.pdf-text-hl-rect.pdf-rect-flash) {
    animation: pdf-rect-flash-anim 1.2s ease-out 1;
  }
  @keyframes pdf-rect-flash-anim {
    0%, 100% { opacity: 1; box-shadow: none; }
    25%, 75% { opacity: 0.45; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.35); }
    50% { opacity: 1; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.55); }
  }
</style>
