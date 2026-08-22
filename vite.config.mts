import { defineConfig } from "vite";
import { resolve } from "path";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  base: "./",
  plugins: [svelte()],
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    minify: "esbuild",
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["cjs"],
      fileName: () => "index.js",
      cssFileName: "index",
    },
    rollupOptions: {
      // siyuan 与 node 内置模块（js-mdict 依赖 node:fs/node:zlib/node:assert）保持外部，
      // 运行时由 SiYuan(Electron) 提供；js-mdict 自身逻辑则打包进 index.js。
      external: [
        "siyuan",
        "node:fs",
        "node:path",
        "node:zlib",
        "node:assert",
        "node:os",
        "fs",
        "path",
        "zlib",
        "assert",
        "os",
      ],
      output: {
        // 禁用代码分割，将所有代码（含 Svelte 运行时）打包到单个 index.js，兼容 cjs 格式
        inlineDynamicImports: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@cp": resolve(__dirname, "src/copilot-src"),
    },
  },
  publicDir: "public",
});
