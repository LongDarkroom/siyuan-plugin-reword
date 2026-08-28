/**
 * 静默捕获登记 codemod（2026-08-28）
 * ------------------------------------------------------------------
 * 背景：全库体检发现约 100 处「catch 后仅跟一句注释」的空捕获，异常被完全
 * 吞掉——不弹提示、不写日志，线上出问题时没有任何信号。
 *
 * 本脚本把这类空捕获改造为 core/safe.ts 的 logSwallow() 登记调用。
 *
 * 设计原则（零行为变更）：
 *  - 只重写 catch 的花括号内部，绝不触碰 try 体与后续控制流；
 *  - 仍保持「吞掉异常、继续执行」的原语义，仅补记一条运行日志；
 *  - 幂等：已含 logSwallow / reportError / getLogger 的 catch 会被跳过，可反复执行。
 *
 * 分级启发式：
 *  - error：持久化落盘失败（函数名以 save / persist / flush 开头）→ 用户数据丢失风险
 *  - warn ：用户可感知的功能失效（词典加载、复制、词库增删）
 *  - debug：其余预期内容错（JSON 解析试探、localStorage 降级等）
 *
 * 用法：node scripts/wire-silent-catch.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DRY = process.argv.includes("--dry");

/** 匹配「catch 后仅跟注释」的空捕获：catch { /*...*\/ } 或 catch (e) { /*...*\/ } */
const CATCH_RE = /catch\s*(\(([^)]*)\))?\s*\{\s*((?:\/\*[\s\S]*?\*\/\s*)+)\}/g;

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|svelte)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** 控制流关键字：回溯时若捕获到这些，说明这条不是函数声明，应继续往上找 */
const CTRL_NAMES = new Set([
  "if", "for", "while", "switch", "catch", "else", "try", "do",
  "return", "function", "typeof", "new", "await", "case",
]);

/** 向上回溯最近的包围函数名，用于生成可读性标签 */
function enclosingName(src, idx) {
  const before = src.slice(Math.max(0, idx - 1200), idx);
  const lines = before.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes("(")) continue;
    const cands = [
      line.match(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/),
      line.match(/(?:^|[\s=}])(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)(?:\s*:\s*[^{;=]+)?\s*\{/),
      line.match(/([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?\([^)]*\)\s*=>/),
    ];
    for (const m of cands) {
      if (m && m[1] && !CTRL_NAMES.has(m[1])) return m[1];
    }
  }
  return null;
}

/**
 * 取该 catch 对应的 try 语句原文（如 try { await this.saveData("x.json", y); }）。
 * 当拿不到函数名时用它做标签——try 语句本身就说清了「什么操作失败了」，
 * 信息量远高于 "if" / "for" 这类控制流关键字。
 */
function tryStatementContext(src, catchOffset) {
  const before = src.slice(0, catchOffset);
  const ti = before.lastIndexOf("try");
  if (ti < 0) return null;
  const braceOpen = src.indexOf("{", ti);
  if (braceOpen < 0 || braceOpen > catchOffset) return null;
  let depth = 0;
  for (let i = braceOpen; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(ti, i + 1);
    }
  }
  return null;
}

/** 折叠空白并截断，便于放进单行标签 */
function squeeze(s, max = 64) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/**
 * 级别判定：函数名 + try 语句原文一起参与匹配（try 原文常含 saveData / clipboard 等关键线索）
 */
function levelFor(fnName, hay) {
  const n = (fnName || "").toLowerCase();
  const h = (hay || "").toLowerCase();
  const both = n + " " + h;
  // 落盘失败 = 用户数据丢失
  if (/^(save|persist|flush)/.test(n) || /save\w*data|remove\w*data/.test(both)) return "error";
  // 用户可感知的功能失效
  if (/loaddict|loadbook|copy|addword|removeword|addlabel|add|remove|delete/.test(n)) return "warn";
  if (/clipboard|writetext|execcommand/.test(h)) return "warn";
  return "debug";
}

/** 在最后一条顶层 import 之后插入（兼容多行 import） */
function insertImport(src, importLine) {
  const lines = src.split("\n");
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\}?\s*from\s+["'][^"']+["'];?\s*$/.test(l) || /^import\s+["'][^"']+["'];?\s*$/.test(l)) {
      last = i;
    }
  }
  if (last >= 0) lines.splice(last + 1, 0, importLine);
  else lines.unshift(importLine);
  return lines.join("\n");
}

/** Svelte：插到 <script> 开标签之后 */
function insertImportSvelte(src, importLine) {
  const m = src.match(/<script[^>]*>/);
  if (!m) return src;
  const idx = src.indexOf(m[0]) + m[0].length;
  return src.slice(0, idx) + "\n  " + importLine + src.slice(idx);
}

/**
 * 排除目录：src/core 是可观测层自身（logger / safe / disposable / console-filter）。
 * 给它装 logSwallow 会造成递归——logSwallow 内部调 getLogger()，若 logger 自己抛错
 * 就会在"记录异常"的过程中再次抛异常。可观测层不能给自己装可观测。
 */
const EXCLUDE_DIRS = [path.join(SRC, "core")];

const files = walk(SRC).filter(
  (f) => !EXCLUDE_DIRS.some((d) => f === d || f.startsWith(d + path.sep))
);
let total = 0;
const byLevel = { debug: 0, warn: 0, error: 0 };
const perFile = [];

for (const file of files) {
  let src = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  let count = 0;

  const out = src.replace(CATCH_RE, (m, _g1, binding, comments, offset, full) => {
    // 幂等：已改造过的跳过
    if (/logSwallow|reportError|getLogger/.test(m)) return m;
    count++;
    const bind = (binding || "").trim() || "__swallowErr";
    const fn = enclosingName(full, offset);
    const tryCtx = tryStatementContext(full, offset);
    const cmt = comments.replace(/\/\*|\*\/|\s+/g, " ").trim().slice(0, 40);
    const base = rel.split("/").pop();
    // 标签优先级：真实函数名 > try 语句原文 > 原注释
    const ctx = fn || (tryCtx ? squeeze(tryCtx) : cmt);
    const label = `${base} · ${ctx}`;
    const level = levelFor(fn, tryCtx || cmt);
    byLevel[level]++;
    return `catch (${bind}) { logSwallow(${bind}, ${JSON.stringify(label)}, "${level}"); }`;
  });

  if (!count) continue;
  src = out;

  const relImport = path
    .relative(path.dirname(file), path.join(SRC, "core", "safe.ts"))
    .split(path.sep)
    .join("/");
  const importPath = relImport.startsWith(".") ? relImport : "./" + relImport;
  const importLine = `import { logSwallow } from "${importPath}";`;

  // 已有 safe.ts 引入则合并进原 import，避免重复 import 语句
  const SAFE_RE = /import\s*\{([^}]*)\}\s*from\s*"([^"]*core\/safe\.ts)"/;
  if (SAFE_RE.test(src)) {
    const m = src.match(SAFE_RE);
    if (!/logSwallow/.test(m[1])) {
      const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      names.push("logSwallow");
      src = src.replace(SAFE_RE, `import { ${names.join(", ")} } from "${m[2]}"`);
    }
  } else {
    src = file.endsWith(".svelte")
      ? insertImportSvelte(src, importLine)
      : insertImport(src, importLine);
  }

  if (!DRY) fs.writeFileSync(file, src);
  total += count;
  perFile.push(`  ${rel}  (${count})`);
}

console.log(`静默捕获登记完成：共改造 ${total} 处`);
console.log(`  级别分布  debug=${byLevel.debug}  warn=${byLevel.warn}  error=${byLevel.error}`);
console.log("  涉及文件：");
console.log(perFile.join("\n"));
if (DRY) console.log("\n[--dry 模式：未写入磁盘]");
