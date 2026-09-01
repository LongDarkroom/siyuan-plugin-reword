<script lang="ts">
  import { createSlider, type ControlHandle } from "../controls.ts";

  export let min = 0;
  export let max = 100;
  export let step = 1;
  export let value = 0;
  export let label = "";
  export let disabled = false;
  export let onChange: (value: number) => void = () => {};

  function mount(node: HTMLElement) {
    const handle: ControlHandle = createSlider({
      min,
      max,
      step,
      value,
      label,
      disabled,
      onChange: (v) => onChange(v),
    });
    node.appendChild(handle.root);
    return {
      update(p: { min: number; max: number; step: number; value: number; label: string; disabled: boolean }) {
        const el = handle.input as HTMLInputElement;
        if (p.value !== parseFloat(el.value)) el.value = String(p.value);
        if (p.min !== parseFloat(el.min)) el.min = String(p.min);
        if (p.max !== parseFloat(el.max)) el.max = String(p.max);
        if (p.step !== parseFloat(el.step)) el.step = String(p.step);
        if (p.label !== label) {
          const lbl = el.previousElementSibling;
          if (lbl) lbl.textContent = p.label;
        }
        el.disabled = p.disabled;
      },
      destroy() {
        handle.dispose();
        handle.root.remove();
      },
    };
  }
</script>

<span use:mount={{ min, max, step, value, label, disabled }}></span>
