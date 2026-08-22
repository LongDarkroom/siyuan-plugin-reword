/**
 * D10 渲染往返（kramdown → 思源富文本 HTML）结构等价验证（2026-08-18）。
 *
 * 约束：SiYuan Lute 是浏览器全局 `window.Lute`，node 测试环境无真实 Lute。
 * 本文件注入一个【最小 Lute 桩】，覆盖 D10 六类样本（表格 / 代码块 / 行内公式 / 块公式 /
 * callout / 块引用 / 超级块 / 列表 / 标题）的 kramdown→HTML 转换，验证：
 *   1. 批注渲染层（renderAnnotationText / renderAnnotationHTML）确实路由到 Lute；
 *   2. Lute 输出被原样嵌入并保留结构标签（table / code / math / block-ref /
 *      super-block / callout / ul-ol / h1）；
 *   3. applyMarkColors 等后处理在 Lute 输出之后执行。
 *
 * 真实 SiYuan Lute 的等价性在真机验证（roadmap #176），此处为 CI 级冒烟测试。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderAnnotationText, renderAnnotationHTML } from "../src/annotation/whale-renderer.ts";

// ---- 最小 Lute 桩（仅覆盖 D10 样本子集，输出形状对齐真实 SiYuan Lute）----
class FakeLute {
  Md2HTML(md) {
    let h = md || "";
    // 块公式 $$...$$
    h = h.replace(/\$\$([\s\S]+?)\$\$/g, (_m, c) => `<div class="katex" data-type="math-block">${c.trim()}</div>`);
    // 行内公式 $...$
    h = h.replace(/(^|[^$])\$([^$\n]+?)\$/g, (_m, p, c) => `${p}<span class="katex" data-type="math-inline">${c}</span>`);
    // 代码块 ```lang ... ```
    h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => `<pre><code class="language-${lang || "plain"}">${code.replace(/\n$/, "")}</code></pre>`);
    // 块引用 ((id))
    h = h.replace(/\(\(([^)]+)\)\)/g, (_m, id) => `<span data-type="block-ref" data-id="${id}">${id}</span>`);
    // 超级块 {{{
    h = h.replace(/\{\{\{\n([\s\S]*?)\n\}\}\}/g, (_m, c) => `<div data-type="super-block">${c}</div>`);
    // callout ::: type ... :::
    h = h.replace(/:::\s*(\w+)?\n([\s\S]*?)\n:::/g, (_m, _t, c) => `<div data-type="blockquote" class="b3-callout">${c}</div>`);
    // 表格
    h = h.replace(/(?:^\|.*\|\n?)+/gm, (block) => {
      const rows = block.trim().split("\n").filter((r) => r.includes("|"));
      const cells = (r) => r.split("|").slice(1, -1).map((s) => s.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      return `<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead>` +
        `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    });
    // 标题
    h = h.replace(/^# (.*)$/gm, "<h1>$1</h1>");
    // 无序列表
    h = h.replace(/(?:^- (.*)\n?)+/gm, (block) =>
      `<ul>${block.trim().split("\n").map((l) => `<li>${l.replace(/^- /, "")}</li>`).join("")}</ul>`);
    // 有序列表
    h = h.replace(/(?:^\d+\. (.*)\n?)+/gm, (block) =>
      `<ol>${block.trim().split("\n").map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("")}</ol>`);
    return h;
  }
  HTML2Md(html) { return html; }
  Md2BlockDOM(md) { return md; }
  BlockDOM2Md(d) { return d; }
}

// 注入桩：getLute() 会 return new window.Lute()
globalThis.window = { Lute: FakeLute };

const CASES = [
  { name: "表格", kd: "| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n", expect: [/^<table/, /<th>列A<\/th>/, /<td>1<\/td>/] },
  { name: "代码块", kd: "```js\nconst a=1;\n```\n", expect: [/^<pre>/, /<code class="language-js">/] },
  { name: "行内公式", kd: "能量 $E=mc^2$ 公式", expect: [/data-type="math-inline"/, /E=mc\^2/] },
  { name: "块公式", kd: "$$\n\\int x\\,dx\n$$\n", expect: [/data-type="math-block"/] },
  { name: "callout", kd: "::: info\n注意点\n:::\n", expect: [/data-type="blockquote"/, /b3-callout/] },
  { name: "块引用", kd: "见 ((20260101-abcdef))", expect: [/data-type="block-ref"/, /data-id="20260101-abcdef"/] },
  { name: "超级块", kd: "{{{\n内容A\n}}}\n", expect: [/data-type="super-block"/] },
  { name: "无序列表", kd: "- 项一\n- 项二\n", expect: [/^<ul>/, /<li>项一<\/li>/] },
  { name: "有序列表", kd: "1. 第一\n2. 第二\n", expect: [/^<ol>/, /<li>第一<\/li>/] },
  { name: "标题", kd: "# 一级标题\n", expect: [/^<h1>一级标题<\/h1>/] },
];

for (const c of CASES) {
  test(`D10 往返：note「${c.name}」经 Lute 渲染保留结构标签`, () => {
    const out = renderAnnotationText(c.kd, "note");
    for (const re of c.expect) assert.match(out, re, `缺少预期结构：${re}`);
  });
}

test("D10：renderAnnotationHTML 同样路由到 Lute（表格样例）", () => {
  const out = renderAnnotationHTML("| H1 | H2 |\n| --- | --- |\n| a | b |\n");
  assert.match(out, /<table/);
  assert.match(out, /<th>H1<\/th>/);
});

test("D10：Lute 输出经 applyMarkColors 后处理（data-color 注入内联背景色）", () => {
  // 注入带 data-color 的 mark，验证后处理在 Lute 之后生效
  const fakeWithColor = class extends FakeLute {
    Md2HTML(md) { return `<mark data-color="#22c55e">重点</mark>`; }
  };
  globalThis.window = { Lute: fakeWithColor };
  const out = renderAnnotationText("随便", "note");
  assert.match(out, /style="background-color:#22c55e"/);
  // 还原桩
  globalThis.window = { Lute: FakeLute };
});
