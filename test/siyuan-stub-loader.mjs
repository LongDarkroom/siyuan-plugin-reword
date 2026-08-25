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
