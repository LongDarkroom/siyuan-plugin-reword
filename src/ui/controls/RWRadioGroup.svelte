<script lang="ts">
  import { createRadioGroup, type RadioOption, type ControlHandle } from "../controls.ts";

  export let name = "";
  export let options: RadioOption[] = [];
  export let value = "";
  export let disabled = false;
  export let onChange: (value: string) => void = () => {};

  function mount(node: HTMLElement) {
    let handle: ControlHandle = createRadioGroup({
      name,
      options,
      value,
      disabled,
      onChange: (v) => onChange(v),
    });
    node.appendChild(handle.root);
    return {
      update(p: { name: string; options: RadioOption[]; value: string; disabled: boolean }) {
        handle.dispose();
        handle.root.remove();
        handle = createRadioGroup({
          name: p.name,
          options: p.options,
          value: p.value,
          disabled: p.disabled,
          onChange: (v) => onChange(v),
        });
        node.appendChild(handle.root);
      },
      destroy() {
        handle.dispose();
        handle.root.remove();
      },
    };
  }
</script>

<span use:mount={{ name, options, value, disabled }}></span>
