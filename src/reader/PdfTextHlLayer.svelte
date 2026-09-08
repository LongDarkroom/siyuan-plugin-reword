<!--
  PDF 文本标注自建覆盖层（P1，2026-09-04）

  在 foliate PDF 文本层之上叠绝对定位矩形，按 page + 归一化坐标（0-1，相对当前页 iframe 框）存储，
  翻页 / 缩放 / 滚动时按当前页 iframe 框重映射回屏幕坐标，不写 PDF 本体。

  设计要点：
   - 视觉为单一真源：ReaderView 的 saveHighlight / onNoteSave 在 PDF 下已短路 foliate 原生
     addAnnotation，所有 PDF 文本高亮/下划线/波浪线只由本层绘制，避免双重绘制。
   - 仅 PDF 模式挂载（与 PdfOverlay 同处 {if readerMode === "pdf"}）。
   - pointer-events:none：不拦截划词 / 点击，选区与 foliate 原生交互照常工作。
   - 重绘触发：annStore.subscribe（数据变更）+ ResizeObserver（缩放/翻页换 iframe）
     + window resize/scroll + 响应式 prop（view/opened/pdfCurrentPage）。
-->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { getAnnotationStore } from "../annotation/store-singleton";
  import { type PdfRect, DEFAULT_ANNOTATION_COLOR } from "../annotation/annotation-store.ts";

  /** 当前书籍 id（批注按 bookId 隔离） */
  export let bookId: string = "";
  /** foliate view 实例（开书后注入；未注入时本层不绘制） */
  export let view: any = null;
  /** 阅读器是否打开（关书后清空） */
  export let opened: boolean = false;
  /** 当前 PDF 页码（1-based），仅作响应式重绘触发（翻页） */
  export let pdfCurrentPage: number = 0;

  type DrawRect = {
    left: number;
    top: number;
    width: number;
    height: number;
    color: string;
    style: string;
  };

  let layerEl: HTMLDivElement;
  let rects: DrawRect[] = [];

  let annStore: any = null;
  try { annStore = getAnnotationStore(); } catch { annStore = null; }

  let rafId: number | null = null;
  function scheduleRecompute() {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      recompute();
    });
  }

  function recompute() {
    if (!annStore || !bookId || !view || !layerEl) { rects = []; return; }
    const renderer = view.renderer;
    if (!renderer || typeof renderer.getContents !== "function") { rects = []; return; }
    let contents: any[] = [];
    try { contents = renderer.getContents() || []; } catch { rects = []; return; }
    if (!contents.length) { rects = []; return; }

    const layerRect = layerEl.getBoundingClientRect();
    const annots = (annStore.getByBook(bookId) || []).filter(
      (a: any) => a.bookType === "pdf" && !a.deletedAt && a.pdfRects && a.pdfRects.length
    );
    if (!annots.length) { rects = []; return; }

    const out: DrawRect[] = [];
    for (const c of contents) {
      const doc = c.doc;
      const frame = doc?.defaultView?.frameElement as HTMLElement | null;
      if (!frame) continue;
      const fr = frame.getBoundingClientRect();
      if (fr.width <= 0 || fr.height <= 0) continue;
      const p = (c.index ?? 0) + 1;
      for (const a of annots) {
        if (a.page !== p) continue;
        for (const r of a.pdfRects as PdfRect[]) {
          if (r.page !== p) continue;
          const left = (fr.left - layerRect.left) + r.x * fr.width;
          const top = (fr.top - layerRect.top) + r.y * fr.height;
          const width = r.w * fr.width;
          const height = r.h * fr.height;
          out.push({ left, top, width, height, color: a.color || "#06b6d4", style: a.style || "highlight" });
        }
      }
    }
    rects = out;
  }

  function rectCss(r: DrawRect): string {
    const color = r.color || "#06b6d4";
    if (r.style === "highlight") {
      // 背景半透明高亮（8 位 hex 第 4 组 = 透明度 ~13%）
      return `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:${color}22;border-radius:2px;box-sizing:border-box;`;
    }
    // 直线段 / 波浪线：沿矩形底部画一条线（wavy 用 dotted 近似，solid 用实线）
    const border = r.style === "wavy" ? "dotted" : "solid";
    return `position:absolute;left:${r.left}px;top:${r.top + r.height - 2}px;width:${r.width}px;height:0;border-bottom:2px ${border} ${color};box-sizing:border-box;`;
  }

  let unsub: (() => void) | null = null;
  let ro: ResizeObserver | null = null;

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
    scheduleRecompute();
  });

  onDestroy(() => {
    if (unsub) unsub();
    if (ro) ro.disconnect();
    window.removeEventListener("resize", scheduleRecompute);
    window.removeEventListener("scroll", scheduleRecompute, true);
  });

  // 响应式触发：开书 / 翻开 / 翻页
  $: if (view && opened) scheduleRecompute();
  $: if (pdfCurrentPage) scheduleRecompute();
</script>

{#if opened}
  <div class="pdf-text-hl-layer" bind:this={layerEl}>
    {#each rects as r}
      <div class="pdf-text-hl-rect" style={rectCss(r)}></div>
    {/each}
  </div>
{/if}

<style>
  .pdf-text-hl-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 6;
    overflow: hidden;
  }
  .pdf-text-hl-rect {
    pointer-events: none;
  }
</style>
