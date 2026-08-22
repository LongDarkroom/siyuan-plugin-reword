/**
 * 行内批注高亮单元测试（inline-mark.ts）。
 * 用 JSDOM 提供真实 DOM API 验证包裹逻辑。
 */
import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { JSDOM } from "jsdom";

// 注入 JSDOM 环境（必须在 import 源码之前）
const jsdom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const win = jsdom.window;
// 注入全局 DOM（绕过类型系统，直接赋值）
Object.defineProperty(globalThis, "document", { value: win.document, writable: true });
Object.defineProperty(globalThis, "Text", { value: win.Text, writable: true });
Object.defineProperty(globalThis, "Node", { value: win.Node, writable: true });
Object.defineProperty(globalThis, "NodeFilter", { value: win.NodeFilter, writable: true });
Object.defineProperty(globalThis, "Range", { value: win.Range, writable: true });

// 动态导入源码模块（用 file:// 绝对路径避免解析问题）
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const mod = await import(join(__dirname, "../src/annotation/inline-mark.ts"));
const clearInlineMarks = mod.clearInlineMarks;
const applyInlineMarks = mod.applyInlineMarks;

describe("行内批注高亮 (inline-mark)", () => {
  test("clearInlineMarks: 移除 span 并保留文本", () => {
    const container = win.document.createElement("div");
    container.innerHTML = "Hello <span class=\"hiword-ann-inline\" data-ann-id=\"a1\">world</span> foo";
    clearInlineMarks(container);

    assert.equal(container.textContent, "Hello world foo");
    assert.equal(container.querySelectorAll(".hiword-ann-inline").length, 0);
    // span 应被替换为纯文本子节点
    assert.ok(!container.innerHTML.includes("<span"));
  });

  test("applyInlineMarks: 精确包裹选中文本", () => {
    const block = win.document.createElement("div");
    block.dataset.nodeId = "block-1";
    block.textContent = "Parents are concerned about television programs for children.";

    applyInlineMarks(block, [
      { selectedText: "Parents are concerned", sentence: "Parents are concerned about...", id: "ann-1", color: "#0d9e5f" },
    ]);

    // 应有 hiword-ann-inline span
    const spans = block.querySelectorAll(".hiword-ann-inline");
    assert.equal(spans.length, 1, "应生成 1 个高亮 span");
    assert.equal(spans[0].dataset.annId, "ann-1");
    // span 内包含选中文字
    assert.ok(spans[0].textContent?.includes("Parents are concerned"));
    // P0.5 防污染：颜色只写 data 属性，绝不写内联 style（避免 DOM 序列化进 .sy 时残留样式）
    assert.equal(spans[0].getAttribute("style"), null, "span 不得携带内联 style");
    assert.equal(spans[0].dataset.annColor, "#0d9e5f");
    // 2026-08-14 新增：scope 缺省 word（背景高亮模式）
    assert.equal(spans[0].dataset.annScope, "word");
  });

  test("applyInlineMarks: sentence 作用域写 data-ann-scope=sentence", () => {
    const block = win.document.createElement("div");
    block.dataset.nodeId = "block-scope";
    block.textContent = "He insisted that she come to the party.";

    applyInlineMarks(block, [
      { selectedText: "He insisted that she come", sentence: "He insisted that she come to the party.", id: "ann-s", scope: "sentence" },
    ]);

    const spans = block.querySelectorAll(".hiword-ann-inline");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].dataset.annScope, "sentence", "句子作用域应写 sentence");
    assert.equal(spans[0].getAttribute("style"), null, "sentence 模式同样不得写内联 style");
  });

  test("applyInlineMarks: scope 变化触发重建（不再保留旧 span）", () => {
    const block = win.document.createElement("div");
    block.dataset.nodeId = "block-rebuild";
    block.textContent = "The research shows a clear trend.";

    applyInlineMarks(block, [
      { selectedText: "research", sentence: "The research shows...", id: "ann-r", scope: "word" },
    ]);
    let span = block.querySelector(".hiword-ann-inline");
    assert.equal(span.dataset.annScope, "word");

    // 同 id 但 scope 改为 sentence → 应重建（span 引用变化）
    applyInlineMarks(block, [
      { selectedText: "research", sentence: "The research shows...", id: "ann-r", scope: "sentence" },
    ]);
    span = block.querySelector(".hiword-ann-inline");
    assert.equal(block.querySelectorAll(".hiword-ann-inline").length, 1, "重建后仍只有 1 个 span");
    assert.equal(span.dataset.annScope, "sentence", "scope 变化应触发重建");
  });

  test("applyInlineMarks: 无匹配文本时不包裹", () => {
    const block = win.document.createElement("div");
    block.dataset.nodeId = "block-2";
    block.textContent = "Hello world";

    const count = applyInlineMarks(block, [
      { selectedText: "nonexistent text", sentence: "nonexistent", id: "ann-x" },
    ]);

    assert.equal(count, 0, "不匹配时应返回 0");
    assert.equal(block.querySelectorAll(".hiword-ann-inline").length, 0);
  });

  test("applyInlineMarks: 先清除旧标记再施加新标记（幂等安全）", () => {
    const block = win.document.createElement("div");
    block.dataset.nodeId = "block-3";
    block.textContent = "Children in the United States are exposed to many influences.";

    // 第 1 次施加
    applyInlineMarks(block, [
      { selectedText: "Children in the United States", sentence: "...", id: "ann-a" },
    ]);
    assert.equal(block.querySelectorAll(".hiword-ann-inline").length, 1);

    // 第 2 次施加同一位置（应先清后加，不重复嵌套）
    applyInlineMarks(block, [
      { selectedText: "Children in the United States", sentence: "...", id: "ann-a" },
    ]);
    // 仍然只有 1 层 span（不会 <span><span> 嵌套）
    const spans = block.querySelectorAll(".hiword-ann-inline");
    assert.equal(spans.length, 1);
    // 内部不应再有嵌套的 hiword-ann-inline
    assert.equal(spans[0].querySelectorAll(".hiword-ann-inline").length, 0);
  });

  // 2026-08-22 修复 3.1 回归测试：行内高亮偏移鲁棒性
  // 旧版仅校验 substring 文本匹配,忽略 searchFrom 光标,导致同文本多批注在偏移半失效场景下
  // 产生嵌套 span / 双重 data-ann-id。

  test("applyInlineMarks [3.1 修复]:同文本多批注 + 部分偏移失效 → 不重复包裹", () => {
    // 场景:ann 1 的偏移 6-11 已失效(文本 'world' 被改成 'WORLD'),
    //       ann 2 的偏移 18-23 仍指向剩余的 'world'
    // 旧版:ann 1 回退 indexOf 找到 18 包了,ann 2 走自洽偏移也指向 18,产生嵌套
    // 新版:ann 2 的偏移虽自洽但 < searchFrom(23),视为失效,indexOf("world", 23) = -1 → 跳过
    const block = win.document.createElement("div");
    block.dataset.nodeId = "block-stale-offset";
    // 第一个 world 改成 WORLD,模拟文本被部分编辑
    // 'Hello WORLD hello world' 长度 23,第二个 'world' 在 [18, 23)
    block.textContent = "Hello WORLD hello world";

    applyInlineMarks(block, [
      // ann 1 偏移 6-11 在新文本里读到 "WORLD" ≠ "world",自洽校验失败
      { selectedText: "world", sentence: "Hello WORLD hello world", id: "ann-1", start: 6, end: 11, color: "#0d9e5f" },
      // ann 2 偏移 18-23 仍指向第二个 "world",自洽校验通过但 < searchFrom
      { selectedText: "world", sentence: "Hello WORLD hello world", id: "ann-2", start: 18, end: 23, color: "#ec4899" },
    ]);

    const spans = block.querySelectorAll(".hiword-ann-inline");
    // 期望:1 个 span(ann-1 通过 indexOf 找到 18 包了),ann-2 被跳过(同位置已覆盖)
    assert.equal(spans.length, 1, "不应嵌套:ann-1 包了唯一 'world',ann-2 跳过");
    assert.equal(spans[0].dataset.annId, "ann-1", "span 应归属先处理的 ann-1");
    assert.equal(spans[0].getAttribute("style"), null, "仍不应写内联 style");
  });

  test("applyInlineMarks [3.1 修复]:同词多处出现时,两个不同 annId 各自定位正确", () => {
    // 正常场景:两个 "cat" 分别在 offset 4 和 offset 31,两个 ann 偏移都自洽
    // 验证修复没破坏正常路径
    const block = win.document.createElement("div");
    block.dataset.nodeId = "block-multi-cat";
    block.textContent = "The cat sat. Then the cat purred.";

    applyInlineMarks(block, [
      { selectedText: "cat", sentence: "The cat sat.", id: "ann-cat1", start: 4, end: 7, color: "#0d9e5f" },
      { selectedText: "cat", sentence: "Then the cat purred.", id: "ann-cat2", start: 22, end: 25, color: "#ec4899" },
    ]);

    const spans = block.querySelectorAll(".hiword-ann-inline");
    assert.equal(spans.length, 2, "两处 cat 应分别被 1 个 span 包裹");
    // 检查顺序和内容
    const sorted = Array.from(spans).sort((a, b) => (a.dataset.annId || "").localeCompare(b.dataset.annId || ""));
    assert.equal(sorted[0].dataset.annId, "ann-cat1");
    assert.equal(sorted[0].textContent, "cat");
    assert.equal(sorted[0].dataset.annColor, "#0d9e5f");
    assert.equal(sorted[1].dataset.annId, "ann-cat2");
    assert.equal(sorted[1].textContent, "cat");
    assert.equal(sorted[1].dataset.annColor, "#ec4899");
  });

  test("applyInlineMarks [3.1 修复]:偏移自洽且 >= searchFrom 时优先用偏移(回归原行为)", () => {
    // 边界:偏移既自洽又 >= searchFrom(常规路径)→ 用偏移,不回退 indexOf
    const block = win.document.createElement("div");
    block.dataset.nodeId = "block-offset-ok";
    block.textContent = "alpha BETA gamma";

    // 故意让 searchFrom 已经 > 0(模拟前面已处理过别的批注),但 ann 偏移仍合法
    // 验证:用偏移定位 BETA,不退到从 searchFrom 找
    applyInlineMarks(
      block,
      [{ selectedText: "BETA", sentence: "alpha BETA gamma", id: "ann-b", start: 6, end: 10, color: "#06b6d4" }],
      "hiword-ann-inline"
    );
    // 先前没有批注 → searchFrom = 0 → ann.start=6 >= 0 → 用偏移
    const spans = block.querySelectorAll(".hiword-ann-inline");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].textContent, "BETA");
    assert.equal(spans[0].dataset.annId, "ann-b");
  });
});
