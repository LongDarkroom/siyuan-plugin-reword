/**
 * Node 测试 loader：把 `siyuan` / `siyuan/kernel` 解析到本地桩（stubs/siyuan.mjs）。
 * 用法：node --experimental-loader=./test/siyuan-stub-loader.mjs --experimental-strip-types ...
 */
const STUB_URL = new URL("./stubs/siyuan.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "siyuan" || specifier === "siyuan/kernel") {
    return { url: STUB_URL, shortCircuit: true, format: "module" };
  }
  return nextResolve(specifier, context);
}
