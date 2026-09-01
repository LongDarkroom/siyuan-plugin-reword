<script lang="ts">
  import { createSelect, type SelectOption, type ControlHandle } from "../controls.ts";

  export let options: SelectOption[] = [];
  export let value = "";
  export let disabled = false;
  export let onChange: (value: string) => void = () => {};

  function mount(node: HTMLElement) {
    let handle: ControlHandle = createSelect({
      options,
      value,
      disabled,
      onChange: (v) => onChange(v),
    });
    node.appendChild(handle.root);
    return {
      update(p: { options: SelectOption[]; value: string; disabled: boolean }) {
        handle.dispose();
        handle.root.remove();
        handle = createSelect({
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

<span use:mount={{ options, value, disabled }}></span>
