/**
 * Node 测试 loader：把 `siyuan` / `siyuan/kernel` 解析到本地桩（stubs/siyuan.mjs）。
 * 用法：node --experimental-loader=./test/siyuan-stub-loader.mjs --experimental-strip-types ...
 */
const STUB_URL = new URL("./stubs/siyuan.mjs", import.meta.url).href;
const API_STUB_URL = new URL("./stubs/siyuan-api-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "siyuan" || specifier === "siyuan/kernel") {
    return { url: STUB_URL, shortCircuit: true, format: "module" };
  }
  // 2026-08-23 扩展：拦截 src/siyuan/api（test 环境无 fetch / window）
  // 解析成空实现桩，让 reader-fonts.ts 等模块可被测试 import
  if (specifier === "../siyuan/api" || specifier.endsWith("/siyuan/api") || specifier === "./siyuan/api") {
    return { url: API_STUB_URL, shortCircuit: true, format: "module" };
  }
  return nextResolve(specifier, context);
}

/**
 * 2026-09-10 扩展：让测试能直接 import JSON（i18n 语言包）。
 * 生产构建由 Vite 内建支持 JSON，无需 import attributes；
 * 但原生 Node ESM 要求 `with { type: "json" }`，加了又会让部分工具链告警。
 * 故只在测试 loader 里把 .json 转成 `export default {...}` —— 生产代码零改动。
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const raw = await readFile(fileURLToPath(url), "utf8");
    // JSON.parse 一遍：既校验格式，又保证导出的是纯数据
    const source = `export default ${JSON.stringify(JSON.parse(raw))};`;
    return { format: "module", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
