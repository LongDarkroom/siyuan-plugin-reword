<script lang="ts">
  /**
   * Apple Pencil 墨迹批注 · SVG 渲染层
   * ---------------------------------------------------------------
   * 浮动在 PDF 上方的 SVG 画布，所有笔触渲染为 <path> 元素
   * - currentPageStrokes：已完成的笔触
   * - activeStroke：正在绘制的笔触（实时更新）
   *
   * 位置：固定在 reader-stage 容器内，覆盖整个 PDF 区域
   * pointer-events: none（让事件穿透到 foliate iframe）
   *
   * 不依赖：foliate / siyuan SDK
   */
  import { currentPageStrokes, activeStroke, inkState } from "./store";
  import { brushToSvgProps } from "./utils";

  export let pageWidth: number = 800;
  export let pageHeight: number = 1200;

  // 所有笔触（已完成 + 进行中）
  $: allStrokes = [...$currentPageStrokes, ...($activeStroke ? [$activeStroke] : [])];
</script>

<svg
  class="ink-layer"
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 {pageWidth} {pageHeight}"
  width="100%"
  height="100%"
  preserveAspectRatio="xMidYMid meet"
  style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5"
>
  {#each allStrokes as stroke (stroke.id)}
    {#if stroke.brush !== "eraser"}
      <path
        d={stroke.path}
        fill="none"
        {...brushToSvgProps(stroke.brush, stroke.color, stroke.baseWidth, stroke.opacity, 1)}
      />
    {/if}
  {/each}
</svg>

<style>
  .ink-layer {
    /* 浮动在 PDF 之上，不拦截 pointer events（让 foliate iframe 接收） */
    pointer-events: none;
  }
</style>
