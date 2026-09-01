<script lang="ts">
  // L2 复合组件：列表行。结构见 src/ui/components.ts 的 createListItem。
  import { createEventDispatcher } from "svelte";
  export let primary = "";
  export let secondary = "";
  export let icon = "";
  export let selected = false;
  export let disabled = false;
  export let className = "";

  const dispatch = createEventDispatcher();
  function handleClick(e: MouseEvent) {
    if (disabled) return;
    dispatch("click", e);
    dispatch("select");
  }
  function handleKey(e: KeyboardEvent) {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).click();
    }
  }
</script>

<div
  class="rw-list-item {selected ? 'rw-list-item--selected' : ''} {disabled ? 'rw-list-item--disabled' : ''} {className}"
  role={disabled ? undefined : "button"}
  tabindex={disabled ? undefined : 0}
  on:click={handleClick}
  on:keydown={handleKey}
>
  {#if icon}<span class="rw-list-item-icon">{icon}</span>{/if}
  <div class="rw-list-item-text">
    <div class="rw-list-item-primary">{primary}</div>
    {#if secondary}<div class="rw-list-item-secondary">{secondary}</div>{/if}
  </div>
  <div class="rw-list-item-trailing"><slot name="trailing" /></div>
</div>
