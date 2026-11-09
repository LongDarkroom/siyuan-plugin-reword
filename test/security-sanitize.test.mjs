// 2026-10-03 第一批安全止血：SQL 注入转义 + 词典 HTML 白名单净化
//
// 覆盖两处修复：
//   ① src/siyuan/attrs.ts 新增 sqlEscape —— getDocumentContent / getBlockByID 等
//      6 处裸拼接统一转义（SOUL 文档 ID 是自由文本框，可闭合单引号注入）。
//   ② src/dict/dict-renderer.ts 新增 sanitizeDictHtml —— StarDict 后端的 h/g 类型
//      条目是原始 HTML（stardict.ts 注释直写「HTML 不 escape」），导入第三方词典包
//      等于给代码执行；插件面板与思源主界面同源。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { sqlEscape } from "../src/siyuan/attrs.ts";
import { parseDictEntry } from "../src/dict/dict-renderer.ts";

// DOM 环境：sanitizeDictHtml 走 DOMParser 白名单路径（= 真机实际路径）。
// 无 DOM 时它会退化到正则兜底，那是另一套行为，单独在下方 fallback 用例覆盖。
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.DOMParser = dom.window.DOMParser;

// ───────────────────────── ① sqlEscape ─────────────────────────

test("SqlEscape:单引号闭合被转义，无法逃出字符串字面量", () => {
  // 典型注入串：闭合 root_id 后追加恒真条件
  const inject = "' OR '1'='1";
  assert.equal(sqlEscape(inject), "'' OR ''1''=''1");
  // 关键：注入串里的引号必须全部成对转义，不得残留裸 '
  assert.equal(sqlEscape(inject).replace(/''/g, "").includes("'"), false);
});

test("SqlEscape:注释符/分号/反斜杠原样保留（SQLite 不以反斜杠转义）", () => {
  assert.equal(sqlEscape("a'; DROP TABLE blocks;--"), "a''; DROP TABLE blocks;--");
  // 反斜杠不是 SQLite 的转义符，擅自处理反而会改变字面量语义
  assert.equal(sqlEscape("C:\\path\\to"), "C:\\path\\to");
  assert.equal(sqlEscape("100%_x"), "100%_x"); // LIKE 通配符必须原样透传
});

test("SqlEscape:空值与非法输入不产生 undefined/null 字面量", () => {
  assert.equal(sqlEscape(undefined), "");
  assert.equal(sqlEscape(null), "");
  assert.equal(sqlEscape(""), "");
  assert.equal(sqlEscape(0), "0");
});

test("SqlEscape:转义后的串在真实 SQL 语义下无法注入（语句结构不变）", () => {
  const docId = "x' UNION SELECT content FROM blocks --";
  const sql = `SELECT content FROM blocks WHERE root_id='${sqlEscape(docId)}' AND type='d'`;
  // 解析出字面量内容 = root_id=' 之后、' AND 之前的部分
  const literal = sql.slice(sql.indexOf("root_id='") + "root_id='".length, sql.indexOf("' AND"));
  // 按 SQL 语义还原：字面量内 '' 应还原为单个 '
  assert.equal(literal.replace(/''/g, "'"), docId, "字面量还原后应等于原始输入（数据无损）");
  // 关键：字面量内引号严格成对，不存在可提前闭合的位置
  assert.equal((literal.match(/''/g) || []).length * 2, (literal.match(/'/g) || []).length,
    "字面量内单引号必须严格成对");
  // 且不得出现闭合后能起新子句的结构
  assert.equal(/;\s*(UNION|SELECT|DROP)/i.test(sql.replace(/''/g, "'")), false,
    "转义后不得出现可执行的注入子句");
});

// ───────────────────── ② sanitizeDictHtml ─────────────────────
// 通过 parseDictEntry 的 cleanedHtml 出口验证（唯一收口点）

const parse = (definition) => parseDictEntry({ word: "x", definition }).html;

test("Sanitize:script 标签连内容一起丢弃", () => {
  const out = parse(`<span class="zh">安全</span><script>alert(1)</script>`);
  assert.equal(/script/i.test(out), false, "script 标签必须消失");
  assert.equal(/alert\(1\)/.test(out), false, "script 内容不能当文本留下");
  assert.equal(/安全/.test(out), true, "正常内容必须保留");
});

test("Sanitize:img 的 onerror 事件属性被剥离", () => {
  const out = parse(`<img src="x" onerror="alert(1)">`);
  assert.equal(/onerror/i.test(out), false, "on* 事件属性必须被剥");
  assert.equal(/<img/i.test(out), true, "img 标签本身可保留");
});

test("Sanitize:body 上的 onload/onclick 全被剥离", () => {
  const out = parse(`<div onclick="evil()" onmouseover="x()">文本</div>`);
  assert.equal(/onclick|onmouseover/i.test(out), false);
  assert.equal(/文本/.test(out), true);
});

test("Sanitize:style 属性被剥离（可承载 url()/expression）", () => {
  const out = parse(`<span style="background:url(javascript:alert(1))">词义</span>`);
  assert.equal(/style=/i.test(out), false, "style 属性必须被剥");
  assert.equal(/词义/.test(out), true);
});

test("Sanitize:iframe/object/embed/svg 连子树一起丢", () => {
  const out = parse(
    `<iframe src="evil.html"></iframe><object data="x"></object>` +
    `<embed src="y"><svg><script>alert(1)</script></svg>`
  );
  assert.equal(/iframe|object|embed|svg/i.test(out), false, "危险元素必须消失");
  assert.equal(/alert\(1\)/.test(out), false);
});

test("Sanitize:javascript: 协议的 href 被整属性删除", () => {
  const out = parse(`<a href="javascript:alert(1)">点我</a>`);
  assert.equal(/javascript:/i.test(out), false, "javascript: 协议必须被拦");
  assert.equal(/点我/.test(out), true, "锚文本保留");
  assert.equal(/href=/i.test(out), false, "危险 href 整个属性删除");
});

test("Sanitize:http/https 链接正常保留", () => {
  const out = parse(`<a href="https://example.com">外链</a>`);
  assert.equal(/href="https:\/\/example\.com"/.test(out), true, "正常链接应保留");
});

test("Sanitize:非白名单标签被 unwrap（保留文字，不丢内容）", () => {
  const out = parse(`<marquee>滚动文字</marquee>`);
  assert.equal(/marquee/i.test(out), false, "未知标签应被剥");
  assert.equal(/滚动文字/.test(out), true, "文字内容要留下");
});

test("Sanitize:正常词典 HTML 不受影响（不误伤排版）", () => {
  const out = parse(
    `<div class="sense"><span class="zh">苹果</span>` +
    `<div class="ex">An apple a day.</div></div>`
  );
  // 注意：cleanedHtml 后续会把 class="sense"/"zh"/"ex" 改写成 hiword-dict-* 前缀，
  // 所以这里断言的是「class 属性仍在 + 文本完整」，不是原始 class 值本身。
  assert.equal(/class="hiword-dict-sense"/.test(out), true, "sense 分区 class 保留");
  assert.equal(/class="hiword-dict-zh"/.test(out), true, "zh 分区 class 保留");
  assert.equal(/苹果/.test(out), true);
  assert.equal(/An apple a day\./.test(out), true);
});

test("Sanitize:img 的 http src 保留（词典内嵌配图不被剥成破图）", () => {
  const out = parse(`<img src="https://cdn.example.com/pic.png" alt="图">`);
  assert.equal(/src="https:\/\/cdn\.example\.com\/pic\.png"/.test(out), true, "http(s) 图片应保留");
  assert.equal(/alt="图"/.test(out), true, "alt 在属性白名单内");
});

test("Sanitize:img 的 javascript: src 被剥", () => {
  const out = parse(`<img src="javascript:alert(1)">`);
  assert.equal(/javascript:/i.test(out), false, "img src 也必须拦 javascript:");
  assert.equal(/src=/i.test(out), false);
});

test("Sanitize:空输入与纯文本不报错", () => {
  assert.equal(parse(""), "");
  assert.equal(parse("纯文本无标签"), "纯文本无标签");
});

test("Sanitize:嵌套深度不影响（深层事件属性同样被剥）", () => {
  const out = parse(`<div><div><div><span onclick="x()">深</span></div></div></div>`);
  assert.equal(/onclick/i.test(out), false, "深层 on* 也必须被剥");
  assert.equal(/深/.test(out), true);
});

// ─────────────── 无 DOM 环境的正则兜底路径 ───────────────
// 真机（Electron 渲染进程）恒有 DOM，走上面的 DOMParser 路径；此段覆盖降级分支：
// 2026-10-03 初版兜底是「整体退化为纯文本」，实测会把 class/span 排版全抹平，已修正为
// 「只剥危险构造、保留排版」。

test("Fallback(无DOM):仍剥掉 script 与 on* 事件，但保留 class 排版", () => {
  const savedDoc = globalThis.document;
  const savedParser = globalThis.DOMParser;
  // 模拟无 DOM 环境
  delete globalThis.document;
  delete globalThis.DOMParser;
  let out;
  try {
    out = parse(`<span class="zh">词义</span><script>alert(1)</script><b onclick="x()">粗</b>`);
  } finally {
    globalThis.document = savedDoc;
    globalThis.DOMParser = savedParser;
  }
  assert.equal(/script/i.test(out), false, "无 DOM 时也必须剥掉 script");
  assert.equal(/alert\(1\)/.test(out), false, "script 内容也不能当释义文本漏出");
  assert.equal(/onclick/i.test(out), false, "无 DOM 时也必须剥掉 on*");
  // 兜底只剥危险构造，class 排版必须保住（cleanedHtml 链会把 class="zh" 改写为 hiword-dict-zh）
  assert.equal(/class="hiword-dict-zh"/.test(out), true, "降级不得抹平 class 排版");
  assert.equal(/词义/.test(out) && /粗/.test(out), true, "文本内容必须保留");
});