<script lang="ts">
  export let label = "";
  export let hint = "";
</script>

<div class="rw-field">
  {#if label}<label class="rw-field-label">{label}</label>{/if}
  <div class="rw-field-control"><slot /></div>
  {#if hint}<div class="rw-field-hint">{hint}</div>{/if}
</div>
