// 注释陷阱预检（2026-09-04 P1）
//
// 拦截两类「写的时候看不出错、构建报错又完全指不到地方」的注释写法：
//
//   1) JS/TS 模板字符串内的 /* */ 注释里出现反引号。
//      反引号会提前终止模板字符串，后面的 CSS 全变成 JS 代码，vite 报的错
//      指向模板字符串开头，与真实原因相隔几百行。
//      例：const style = `... /* 用 `backtick` 举例 */ ...`
//
//   2) CSS/LESS 块注释里出现 X*/Y 形态的 */（典型是写 --b3- 与 --hw- 前缀对照时
//      顺手打成 --b3-*/--hw-）。注释在第一个 */ 就结束，后半段变成 CSS 代码，
//      LESS 编译器报的错与注释内容毫无关联。
//
// 只在构建前扫描源码，不改动任何文件。
// 用法：node scripts/check-comment-traps.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set([
  "node_modules", "dist", ".git", "cmaps", "standard_fonts",
  "dict", "books", ".workbuddy", "public",
]);
// 注意：src/reader/vendor/ 下的 vendored foliate-js 必须扫 —— 我们对其打过大量补丁，
// 本脚本要抓的那类模板字符串注释陷阱，历史上正是在那里首次出现的。

// 只扫手写源码：src/ 与 scripts/。
// 不扫根目录 —— index.js / index.css 是 copy-dist 输出的构建产物，
// 扫它们只会在产物变化后报一堆与源码无关的错。
// 不扫 vendor/ —— 第三方代码不归我们维护。
const SCAN_ROOTS = ["src", "scripts"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// 提取 Svelte 的顶层 <style> 块。
// 必须按「独占一行」配对：ReaderView.svelte 里曾出现 JS 字符串内嵌的 `<style`，
// 用 /<style[\s\S]*?<\/style>/ 非贪婪匹配会让它一路吞到文件末尾，把整段 <script>
// 当成样式来查，于是普通 JSDoc 也被误报成注释截断。
function extractStyleBlocks(src) {
  const lines = src.split("\n");
  const blocks = [];
  let start = -1;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (start < 0) {
      if (/^\s*<style[^>]*>\s*$/.test(line)) start = idx;
      continue;
    }
    if (/^\s*<\/style>\s*$/.test(line)) {
      blocks.push({ text: lines.slice(start + 1, idx).join("\n"), baseLine: start + 2 });
      start = -1;
    }
  }
  return blocks;
}

// ── 检查 1：模板字符串内的块注释是否含反引号 ────────────────────────────────
// 轻量词法扫描：只关心 反引号字符串 / 单双引号字符串 / 行注释 / 块注释 四种上下文。
// 不处理 ${} 内部（模板内表达式里写注释且带反引号的场景极罕见，代价不值）。
function scanTemplateTraps(src, file) {
  const hits = [];
  const n = src.length;
  let i = 0;
  let state = "code"; // code | line | block | sq | dq | tpl
  let commentStart = -1;
  let commentInTpl = false;
  // 模板字符串内的 ${} 需要按花括号配对回到 tpl，否则 ${`x`} 这类嵌套模板
  // 会让反引号配对整体错位，进而把普通 JSDoc 误判成「模板字符串内的注释」。
  const tplStack = [];

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (state === "block") {
      if (c === "*" && d === "/") {
        const body = src.slice(commentStart + 2, i);
        if (commentInTpl && body.includes("`")) {
          hits.push({
            file,
            line: lineOf(src, commentStart),
            why: "模板字符串内的块注释含有反引号，会提前终止模板字符串",
          });
        }
        state = commentInTpl ? "tpl" : "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (state === "line") {
      if (c === "\n") state = "code";
      i++;
      continue;
    }

    if (state === "sq" || state === "dq") {
      const q = state === "sq" ? "'" : '"';
      if (c === "\\") { i += 2; continue; }
      if (c === q || c === "\n") { state = "code"; i++; continue; }
      i++;
      continue;
    }

    if (state === "tpl") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { state = "code"; i++; continue; }
      if (c === "/" && d === "*") {
        commentStart = i;
        commentInTpl = true;
        state = "block";
        i += 2;
        continue;
      }
      if (c === "$" && d === "{") {
        tplStack.push({ depth: 0 });
        state = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // state === "code"
    if (c === "/" && d === "/") { state = "line"; i += 2; continue; }
    if (c === "/" && d === "*") { commentStart = i; commentInTpl = false; state = "block"; i += 2; continue; }
    // 正则字面量必须整段跳过。曾因 /[A-Za-z'-]/ 这类正则里的引号被当成字符串起始，
    // 状态机一路吞掉后续代码，把普通 JSDoc 误报成「模板字符串内的注释」。
    if (c === "/" && startsRegex(src, i)) { i = skipRegex(src, i); continue; }
    if (c === "'") { state = "sq"; i++; continue; }
    if (c === '"') { state = "dq"; i++; continue; }
    if (c === "`") { state = "tpl"; i++; continue; }
    if (c === "{") {
      if (tplStack.length) tplStack[tplStack.length - 1].depth++;
      i++;
      continue;
    }
    if (c === "}") {
      if (tplStack.length) {
        const top = tplStack[tplStack.length - 1];
        if (top.depth === 0) {
          tplStack.pop();
          state = "tpl";
          i++;
          continue;
        }
        top.depth--;
      }
      i++;
      continue;
    }
    i++;
  }
  return hits;
}

// `/` 是除号还是正则开头：看它前面最近的那个有效字符。
// 标识符 / 数字 / ) ] } 之后是除号；其余（= ( , : [ ! & | ? { ; 等）之后是正则。
// 例外：return / typeof / case / in / of 等关键字后面跟的是正则而非除号。
const REGEX_KEYWORDS = /\b(return|typeof|instanceof|case|in|of|new|delete|void|do|else|yield|await)$/;

function startsRegex(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const prev = src[j];
  if (!/[A-Za-z0-9_$)\]}]/.test(prev)) return true;
  return REGEX_KEYWORDS.test(src.slice(Math.max(0, j - 12), j + 1));
}

function skipRegex(src, i) {
  const n = src.length;
  let k = i + 1;
  let inClass = false;
  while (k < n) {
    const ch = src[k];
    if (ch === "\\") { k += 2; continue; }
    if (ch === "\n") break; // 正则字面量不跨行
    if (inClass) {
      if (ch === "]") inClass = false;
    } else if (ch === "[") {
      inClass = true;
    } else if (ch === "/") {
      k++;
      break;
    }
    k++;
  }
  while (k < n && /[a-z]/.test(src[k])) k++; // flags
  return k;
}

// ── 检查 2：块注释是否被内容里的 */ 提前终止 ────────────────────────────────
// 判据：注释正常结束后，到下一个 /* 之前不该再出现 */。
// 若出现，说明真正的注释边界比作者以为的更靠前，后半段已被当成代码。
function scanCommentCut(src, file, baseLine = 1) {
  const hits = [];
  const re = /\/\*[\s\S]*?\*\//g;
  let m;
  while ((m = re.exec(src))) {
    const end = m.index + m[0].length;
    const nextOpen = src.indexOf("/*", end);
    const rest = src.slice(end, nextOpen === -1 ? src.length : nextOpen);
    if (rest.includes("*/")) {
      hits.push({
        file,
        line: baseLine + lineOf(src, m.index) - 1,
        why: "块注释被内容中的 */ 提前终止，后半段会被当成样式代码",
      });
    }
  }
  return hits;
}

const files = SCAN_ROOTS.flatMap((d) => walk(join(ROOT, d)));
const hits = [];
let scanned = 0;

for (const file of files) {
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".ts")) {
    scanned++;
    hits.push(...scanTemplateTraps(readFileSync(file, "utf8"), file));
  } else if (file.endsWith(".css") || file.endsWith(".less")) {
    scanned++;
    hits.push(...scanCommentCut(readFileSync(file, "utf8"), file));
  } else if (file.endsWith(".svelte")) {
    // Svelte 的 <style> 走 LESS/CSS 解析，只对其做注释截断检查
    for (const blk of extractStyleBlocks(readFileSync(file, "utf8"))) {
      scanned++;
      hits.push(...scanCommentCut(blk.text, file, blk.baseLine));
    }
  }
}

if (hits.length) {
  console.error("[check-comment-traps] 发现 " + hits.length + " 处注释陷阱：\n");
  for (const h of hits) {
    console.error("  " + h.file + ":" + h.line);
    console.error("    → " + h.why + "\n");
  }
  console.error("修复后再构建。确认为误报可用 SKIP_TRAPS=1 跳过本检查。");
  process.exit(1);
}

console.log("[check-comment-traps] 已扫描 " + scanned + " 个源码单元，未发现注释陷阱");
