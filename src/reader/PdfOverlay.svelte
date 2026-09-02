<!--
  PDF 界面专属浮层（2026-09-02 从 ReaderView.svelte 拆出）

  Apple Pencil 墨迹批注：SVG 渲染层 + 浮动工具栏。仅 PDF 模式挂载，
  图书模式完全不创建这两个组件（此前是 ReaderView 内联的 {#if opened && isPdfBook()}）。

  组件本身不产生包裹元素，InkLayer / InkToolbar 会直接成为 .reader-stage 的子节点，
  与原先的 DOM 结构一致，样式定位不受影响。
-->
<script lang="ts">
  import InkLayer from "./ink/InkLayer.svelte";
  import InkToolbar from "./ink/InkToolbar.svelte";

  /** 书籍是否已成功打开（ReaderView 的 opened） */
  export let opened = false;
</script>

{#if opened}
  <InkLayer pageWidth={800} pageHeight={1200} />
  <InkToolbar />
{/if}
