<!--
  PDF 界面专属工具栏（2026-09-02 从 ReaderView.svelte 拆出）

  只负责「缩放档位 + 页码跳转」两组控件，不含图书模式的双语按钮。
  所有交互通过回调 prop 交给 ReaderView 处理，组件自身不持有 foliate 视图状态，
  便于 ReaderView 按 readerMode 在两套界面之间自由切换。

  注意：本组件在 iPhone 模式下也会渲染（缩放/翻页是 PDF 的刚需），
  而图书工具栏 BookToolbar 则受 isIphoneMode 门控。
-->
<script lang="ts">
  export let zoomLabel = "";
  export let pdfCurrentPage = 0;
  export let pdfTotalPages = 0;
  export let onZoomIn: () => void = () => {};
  export let onZoomOut: () => void = () => {};
  export let onFitWidth: () => void = () => {};
  export let onFitPage: () => void = () => {};
  export let onGoPage: (page: number) => void = () => {};
  export let onPageInputKeydown: (e: KeyboardEvent) => void = () => {};
  export let onPageInputChange: (e: Event) => void = () => {};
</script>

<!-- PDF 缩放工具栏 -->
<span class="reader-zoom-group" title="PDF 缩放：⌘/Ctrl + 滚轮（或触控板捏合）连续缩放；⌘/Ctrl + 1 / 2 / = / - 快捷档位；页面内双击切换适应宽度">
  <button
    class="reader-btn reader-zoom-btn"
    title="缩小（⌘/Ctrl + -）"
    on:click={onZoomOut}
  >−</button>
  <span class="reader-zoom-label">{zoomLabel}</span>
  <button
    class="reader-btn reader-zoom-btn"
    title="放大（⌘/Ctrl + =）"
    on:click={onZoomIn}
  >+</button>
  <button
    class="reader-btn reader-zoom-btn"
    title="适应宽度（⌘/Ctrl + 1）"
    on:click={onFitWidth}
  >↔</button>
  <button
    class="reader-btn reader-zoom-btn"
    title="适应整页（⌘/Ctrl + 2）"
    on:click={onFitPage}
  >⊡</button>
</span>

<!-- PDF「第 N/T 页」+ 跳转输入框（对齐 Obsidian PDF++ Go to page） -->
<span class="reader-page-group" title="PDF 页码跳转：←/→ 翻页，数字框内回车跳转">
  <button
    class="reader-btn reader-page-btn"
    title="上一页（←）"
    disabled={!pdfTotalPages}
    on:click={() => onGoPage(Math.max(1, pdfCurrentPage - 1))}
  >‹</button>
  <span class="reader-page-label">
    <input
      class="reader-page-input"
      type="number"
      min="1"
      max={pdfTotalPages || undefined}
      placeholder="?"
      value={pdfCurrentPage || ""}
      disabled={!pdfTotalPages}
      on:keydown={onPageInputKeydown}
      on:change={onPageInputChange}
    />
    <span class="reader-page-sep">/</span>
    <span class="reader-page-total">{pdfTotalPages || "?"}</span>
  </span>
  <button
    class="reader-btn reader-page-btn"
    title="下一页（→）"
    disabled={!pdfTotalPages}
    on:click={() => onGoPage(Math.min(pdfTotalPages, pdfCurrentPage + 1))}
  >›</button>
</span>
