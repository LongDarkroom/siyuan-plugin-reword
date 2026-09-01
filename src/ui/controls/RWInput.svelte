<script lang="ts">
  import { createTextInput, type ControlHandle } from "../controls.ts";

  export let value = "";
  export let placeholder = "";
  export let type = "text";
  export let disabled = false;
  export let onInput: (value: string) => void = () => {};
  export let onEnter: (value: string) => void = () => {};

  function mount(node: HTMLElement) {
    const handle: ControlHandle = createTextInput({
      value,
      placeholder,
      type,
      disabled,
      onInput: (v) => onInput(v),
      onEnter: (v) => onEnter(v),
    });
    node.appendChild(handle.root);
    return {
      update(p: { value: string; placeholder: string; type: string; disabled: boolean }) {
        const el = handle.input as HTMLInputElement;
        if (p.value !== el.value) el.value = p.value;
        if (p.placeholder !== el.placeholder) el.placeholder = p.placeholder;
        if (p.type !== el.type) el.type = p.type;
        el.disabled = p.disabled;
      },
      destroy() {
        handle.dispose();
        handle.root.remove();
      },
    };
  }
</script>

<span use:mount={{ value, placeholder, type, disabled }}></span>
