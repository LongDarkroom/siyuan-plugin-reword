<script lang="ts">
  import { createButton, type ButtonOptions, type ControlHandle } from "../controls.ts";

  export let label = "";
  export let icon = "";
  export let variant: ButtonOptions["variant"] = "secondary";
  export let disabled = false;
  export let title = "";
  export let onClick: (e: MouseEvent) => void = () => {};

  function mount(node: HTMLElement) {
    let handle: ControlHandle = createButton({
      label,
      icon,
      variant,
      disabled,
      title,
      onClick: (e) => onClick(e),
    });
    node.appendChild(handle.root);
    return {
      update(p: { label: string; icon: string; variant: ButtonOptions["variant"]; disabled: boolean; title: string }) {
        handle.dispose();
        handle.root.remove();
        handle = createButton({
          label: p.label,
          icon: p.icon,
          variant: p.variant,
          disabled: p.disabled,
          title: p.title,
          onClick: (e) => onClick(e),
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

<span use:mount={{ label, icon, variant, disabled, title }}></span>
