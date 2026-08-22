/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module "*.svelte" {
    import type { SvelteComponent } from "svelte";
    export default SvelteComponent;
}
