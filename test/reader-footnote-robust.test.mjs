/**
 * 脚注功能健壮性（2026-08-29 修复）
 * ----------------------------------------------------------------
 * 用户反馈《人间词话》等中文 EPUB 点击脚注标号后气泡只显示「脚注」标题、内容为空，
 * 并需要点击空白处关闭。本测试纯源码文本校验：
 *
 *  A. footnote.ts 抽取健壮性
 *     - findFootnoteElement 同时查 id / name / id$ 后缀
 *     - parseXhtml + XML 解析回退
 *     - pickFootnoteContainer：id 打在锚点上时上溯父块级元素
 *     - sanitizeFootnoteElement：移除返回锚点、清除隐藏样式
 *     - prepareFootnoteHtml 兜底纯文本输出
 *     - extractFootnote 在 html 为空时返回 null（降级跳转，不展示空气泡）
 *
 *  B. ReaderView.svelte 点击外部关闭
 *     - onFootnoteOutsidePointerDown 函数存在
 *     - 忽略气泡内部点击（footnoteEl.contains）
 *     - 忽略脚注引用锚点（isFootnoteRef）
 *     - attachContentDoc 通过 trackDocListener 挂 pointerdown capture
 *     - onMount 在 document 上挂 pointerdown capture
 *     - onDestroy 对称注销
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..", "src");

const fnSrc = readFileSync(join(root, "reader", "footnote.ts"), "utf-8");
const viewSrc = readFileSync(join(root, "reader", "ReaderView.svelte"), "utf-8");

function bodyOf(src, name) {
  // 优先匹配函数定义，避免 name 作为调用出现在其它函数体内而被误抓
  const defPattern = new RegExp(`(?:async )?function ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s\\S]*?\\{`);
  let idx = src.search(defPattern);
  if (idx < 0) idx = src.indexOf(name);
  if (idx < 0) return null;
  let open = -1;
  for (let i = idx; i < src.length - 1; i++) {
    if (src[i] === "{" && (src[i + 1] === "\n" || src[i + 1] === "\r")) {
      open = i;
      break;
    }
  }
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/* ================= A. footnote.ts 抽取健壮性 ================= */

test("[A1] findFootnoteElement 同时查 id / name / id$ 后缀", () => {
  const b = bodyOf(fnSrc, "function findFootnoteElement");
  assert.ok(b, "应存在 findFootnoteElement");
  assert.match(b, /getElementById\(hash\)/, "应查 id");
  assert.match(b, /\[name="\$\{cssEscape\(hash\)\}"\]/, "应查 name");
  assert.match(b, /\[id\$="\$\{cssEscape\(hash\)\}"\]/, "应查 id 后缀");
});

test("[A2] parseXhtml + XML 解析回退", () => {
  assert.match(fnSrc, /function parseXhtml\(xhtml: string\): Document/, "应存在 parseXhtml");
  const extract = bodyOf(fnSrc, "export async function extractFootnote");
  assert.ok(extract, "应取到 extractFootnote 函数体");
  assert.match(extract, /parseXhtml\(xhtml\)/, "extractFootnote 应使用 parseXhtml");
  assert.match(extract, /application\/xhtml\+xml/, "应在 text/html 失败时回退 XML 解析");
  assert.match(extract, /findFootnoteElement\(xmlDoc, hash\)/, "XML 回退后应继续使用 findFootnoteElement");
});

test("[A3] pickFootnoteContainer 处理 id 打在锚点上的情况", () => {
  const b = bodyOf(fnSrc, "function pickFootnoteContainer");
  assert.ok(b, "应存在 pickFootnoteContainer");
  assert.match(b, /tag === 'a'/, "应识别目标元素是 <a>");
  assert.match(b, /el\.parentElement/, "应尝试取父元素");
  assert.match(b, /parentText\.length > anchorText\.length \+ 2/, "父元素文字明显多于锚点文字时上溯");
});

test("[A4] sanitizeFootnoteElement 移除返回锚点并强制可见", () => {
  const b = bodyOf(fnSrc, "function sanitizeFootnoteElement");
  assert.ok(b, "应存在 sanitizeFootnoteElement");
  assert.match(b, /isBacklinkAnchor\(a\)/, "应调用 isBacklinkAnchor 识别并移除返回锚点");
  assert.ok(b.includes('display\\s*:\\s*none|visibility\\s*:\\s*hidden|opacity\\s*:\\s*0'), "应处理常见隐藏样式");
  // 强制可见在 cleanHiddenStyle 里实现
  assert.ok(fnSrc.includes('display:block; visibility:visible; opacity:1;'), "应强制元素可见");
});

test("[A5] isBacklinkAnchor 覆盖常见返回文本", () => {
  const b = bodyOf(fnSrc, "function isBacklinkAnchor");
  assert.ok(b, "应存在 isBacklinkAnchor");
  assert.match(b, /href\.startsWith\('#'\)/, "只处理页内锚点");
  assert.ok(b.includes("↩←↑▲⇧返回return"), "应覆盖返回符号/文字");
});

test("[A6] prepareFootnoteHtml 有空内容兜底", () => {
  const b = bodyOf(fnSrc, "function prepareFootnoteHtml");
  assert.ok(b, "应存在 prepareFootnoteHtml");
  assert.match(b, /pickFootnoteContainer\(el\)/, "应先挑选容器");
  assert.match(b, /sanitizeFootnoteElement\(clone\)/, "应清理克隆元素");
  assert.match(b, /looksEmpty\(clone\)/, "清理后仍为空应兜底");
  assert.match(b, /escapeHtml\(text\)/, "兜底应转义纯文本");
});

test("[A7] extractFootnote 空 html 返回 null 避免展示空气泡", () => {
  const b = bodyOf(fnSrc, "export async function extractFootnote");
  assert.ok(b, "应取到 extractFootnote 函数体");
  assert.match(b, /if \(!html\) return \{ html: null, type \}/, "空 html 应返回 null");
});

/* ================= B. ReaderView.svelte 点击外部关闭 ================= */

test("[B1] onFootnoteOutsidePointerDown 函数存在且逻辑正确", () => {
  const b = bodyOf(viewSrc, "function onFootnoteOutsidePointerDown");
  assert.ok(b, "应存在 onFootnoteOutsidePointerDown");
  assert.match(b, /if \(!showFootnote\) return/, "未显示时直接返回");
  assert.match(b, /footnoteEl\.contains\(target\)/, "应忽略气泡内部点击");
  assert.match(b, /isFootnoteRef\(a\)/, "应忽略脚注引用锚点");
  assert.match(b, /closeFootnote\(\)/, "其他情况应关闭气泡");
});

test("[B2] 内容文档挂 pointerdown capture 监听外部点击", () => {
  const attach = bodyOf(viewSrc, "function attachContentDoc");
  assert.ok(attach, "应取到 attachContentDoc 函数体");
  assert.match(attach, /trackDocListener\(doc, "pointerdown", onFootnoteOutsidePointerDown/, "应在内容文档注册 pointerdown");
  assert.match(attach, /true\s*\)/, "应使用 capture 阶段");
});

test("[B3] onMount 在 document 注册 pointerdown，onDestroy 对称注销", () => {
  const mount = bodyOf(viewSrc, "onMount(() => {");
  // 源码中有两个 onDestroy(() => {，第一个在靠前的 reactive 清理，主 onDestroy 在底部且含 unsubSettings
  const destroyIdx = viewSrc.indexOf("onDestroy(() => {");
  const destroyStart = viewSrc.indexOf("onDestroy(() => {", destroyIdx + 1);
  assert.ok(destroyStart > 0, "应存在主 onDestroy");
  let destroyEnd = destroyStart;
  let depth = 0;
  for (let i = destroyStart; i < viewSrc.length; i++) {
    if (viewSrc[i] === "{") depth++;
    else if (viewSrc[i] === "}") {
      depth--;
      if (depth === 0) { destroyEnd = i + 1; break; }
    }
  }
  const destroy = viewSrc.slice(destroyStart, destroyEnd);
  assert.ok(mount, "应取到 onMount 函数体");
  assert.ok(destroy.includes("unsubSettings"), "应取到主 onDestroy 函数体");
  assert.match(mount, /document\.addEventListener\("pointerdown", onFootnoteOutsidePointerDown/, "onMount 应注册");
  assert.match(mount, /true\s*\)/, "onMount 注册应使用 capture");
  assert.match(destroy, /document\.removeEventListener\("pointerdown", onFootnoteOutsidePointerDown/, "onDestroy 应注销");
});
