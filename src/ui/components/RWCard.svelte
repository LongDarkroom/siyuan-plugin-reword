<script lang="ts">
  // L2 复合组件：玻璃浮动面板。直接套 .rw-card 类（结构见 src/ui/components.ts），
  // 内容走 <slot/>。variant=light 用于浅色上下文（如墨迹工具栏）。
  export let variant: "dark" | "light" = "dark";
  export let className = "";
  export let role = "";
  export let ariaLabel = "";
</script>

<div
  class="rw-card {variant === 'light' ? 'rw-card--light' : ''} {className}"
  {role}
  aria-label={ariaLabel || undefined}
  {...$$restProps}
>
  <slot />
</div>
