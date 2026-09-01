<script lang="ts">
  import { createCheckbox, type ControlHandle } from "../controls.ts";

  export let label = "";
  export let checked = false;
  export let disabled = false;
  export let onChange: (checked: boolean) => void = () => {};

  function mount(node: HTMLElement) {
    let handle: ControlHandle = createCheckbox({
      label,
      checked,
      disabled,
      onChange: (c) => onChange(c),
    });
    node.appendChild(handle.root);
    return {
      update(p: { label: string; checked: boolean; disabled: boolean }) {
        handle.dispose();
        handle.root.remove();
        handle = createCheckbox({
          label: p.label,
          checked: p.checked,
          disabled: p.disabled,
          onChange: (c) => onChange(c),
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

<span use:mount={{ label, checked, disabled }}></span>
