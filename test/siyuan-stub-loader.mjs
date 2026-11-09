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

  // 2026-10-06 扩展：TS「参数属性」降级。
  // 背景：`--experimental-strip-types` 是 strip-only（只擦类型、不做语法降级），
  //   不支持 `constructor(private plugin: any) {}` 这种把修饰符写进参数列表的简写，
  //   遇到会直接抛 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX。
  //   src/ 下有 10 个文件用它（bookshelf-store / reader-settings / reader-dock /
  //   book-primer / ai-panel / dock-manager …），其中 4 个正是阅读器核心 ——
  //   这意味着这些模块此前**无法被行为测试 import**，只能退而 grep 源码文本。
  //   阅读器独立插件化切分前需要给它们加真实行为测试，故在此做等价改写。
  //   仅改写这一种语法，其余 TS 仍交给 strip-types；生产构建走 Vite，不受影响。
  if (url.endsWith(".ts") || url.endsWith(".mts")) {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const raw = await readFile(fileURLToPath(url), "utf8");
    const lowered = lowerTsParameterProperties(raw);
    if (lowered !== null) {
      return { format: "module-typescript", source: lowered, shortCircuit: true };
    }
  }
  return nextLoad(url, context);
}

/**
 * 把 `constructor(private readonly x: T, y: U)` 改写成等价的普通赋值形式。
 * 返回 null 表示该文件无需改写（调用方走原有 nextLoad 链路）。
 *
 * 改写示例：
 *   输入：constructor(private plugin: any, readonly n: number) { super(); this.n = n; }
 *   输出：constructor(plugin, n) { super(); this.plugin = plugin; this.n = n; }
 *
 * 覆盖要点：
 *  - 修饰符组合：private / public / protected / readonly（可叠加，如 `private readonly x`）
 *  - 默认值与可选标记：`x?: T` / `x: T = 1`
 *  - 参数属性上的装饰器（本仓库未用，遇到则放弃改写、交回原生报错，不静默吞掉）
 */
function lowerTsParameterProperties(source) {
  // 保守：文件里必须真的出现 constructor( 且带修饰符才动手
  if (!/constructor\s*\([^)]*\b(private|public|protected|readonly)\b/.test(source)) {
    return null;
  }

  let changed = false;
  // 只处理 class 体内的 constructor(...) 形参列表（逐个匹配，避开方法调用）
  const out = source.replace(
    /constructor\s*\(([\s\S]*?)\)\s*\{/g,
    (whole, params) => {
      // 形参里出现装饰器（@foo）则不处理本段，避免破坏语义
      if (params.includes("@")) return whole;
      // 逐个逗号切分（不含默认值里的逗号/泛型逗号——本仓库构造函数简单，够用）
      const parts = splitTopLevelParams(params);
      const assigns = [];
      const kept = [];
      for (const p of parts) {
        const m = p.match(
          /^\s*((?:(?:private|public|protected|readonly)\s+)+)([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*([\s\S]+)$/,
        );
        if (m) {
          changed = true;
          const name = m[2];
          // 去掉修饰符与类型标注，保留默认值（`x: T = 1` → `x = 1`）
          const rest = p.slice(m.index + m[0].length).trim();
          kept.push(rest ? `${name} = ${rest}` : name);
          assigns.push(`this.${name} = ${name};`);
        } else {
          kept.push(p);
        }
      }
      if (!assigns.length) return whole;
      return `constructor(${kept.join(", ")}) { ${assigns.join(" ")}`;
    },
  );
  return changed ? out : null;
}

/** 按顶层逗号切分形参（跳过 <> {} [] 内的逗号与字符串） */
function splitTopLevelParams(params) {
  const res = [];
  let depth = 0;
  let buf = "";
  let quote = null;
  for (let i = 0; i < params.length; i++) {
    const ch = params[i];
    if (quote) {
      buf += ch;
      if (ch === quote && params[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      buf += ch;
      continue;
    }
    if ("<{([" .includes(ch)) depth++;
    else if (">})]".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      res.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) res.push(buf);
  return res;
}
