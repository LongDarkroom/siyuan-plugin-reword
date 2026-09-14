import { defineConfig } from "vite";
import { resolve } from "path";
import { readFileSync } from "fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// 构建期从 plugin.json 读取版本号，注入为 __REWORD_VERSION__。
// 为什么不用 package.json / 也不硬编码：plugin.json 是思源集市认的清单（唯一真源），
// 设置面板「关于」页此前硬编码 v0.1.0，版本一路涨到 1.7.3 仍显示 0.1.0。
// 走 define 注入后，发版只改 plugin.json 一处，面板自动跟随，不会再漂移。
const PLUGIN_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(resolve(__dirname, "plugin.json"), "utf8")).version || "";
  } catch {
    return "";
  }
})();

export default defineConfig({
  base: "./",
  plugins: [svelte()],
  // 构建期注入真实时间戳，供 `window.__REWORD_BUILD_INFO__.buildTime` 在 DevTools 里
  // 判断「当前加载的是不是最新产物」。此前该值是源码里硬编码的常量，永远不变，
  // 反而会误导排查（以为加载了新包其实是旧的）。
  define: {
    __REWORD_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __REWORD_VERSION__: JSON.stringify(PLUGIN_VERSION),
  },
  build: {
    target: "esnext",
    outDir: "dist",
    // 2026-09-04 P0：改为 false —— 不再清空 dist。
    // 原因：清空动作会触发批量文件删除保护（dist 内文件数远超阈值），导致构建被拦截。
    // 安全性：本工程开启 inlineDynamicImports，产物恒为 index.js + style.css 两个固定文件名，
    // 不存在「改入口后旧 chunk 残留」的风险，覆盖写即等于全量刷新。
    emptyOutDir: false,
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
        "node:child_process",
        "node:net",
        "fs",
        "path",
        "zlib",
        "assert",
        "os",
        // 2026-09-14：本地 CalDAV 服务管家（radicale-service.ts）用它们起停进程 / 探端口。
        // 思源加载插件时注入的是完整 Node require，运行时由 Electron 提供。
        "child_process",
        "net",
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
    },
  },
  publicDir: "public",
});
