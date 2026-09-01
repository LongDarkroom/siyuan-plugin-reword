<script lang="ts">
  // L2 复合组件：分节容器（标题 + 说明 + 内容插槽）。
  // 结构见 src/ui/components.ts 的 createSection；设置面板 / 面板区块分组复用。
  export let title = "";
  export let hint = "";
  export let className = "";
</script>

<div class="rw-section {className}">
  {#if title || hint}
    <div class="rw-section-header">
      {#if title}<div class="rw-section-title">{title}</div>{/if}
      {#if hint}<div class="rw-section-hint">{hint}</div>{/if}
    </div>
  {/if}
  <div class="rw-section-body"><slot /></div>
</div>
