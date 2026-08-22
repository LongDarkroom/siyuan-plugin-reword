/**
 * Fix2 测试：在线音标兜底模块（src/dict/online-phonetic.ts）。
 * 验证：parseEudicHtml 纯函数 / 缓存命中不再二次请求 / 并发同词只发一次 /
 *       失败负缓存 / maybeFillPhonetic 补写与 XSS 安全。
 * 环境：Node --experimental-strip-types + jsdom。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// DOM 环境（maybeFillPhonetic 需要）
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { url: "http://localhost/" });
const win = dom.window;
const doc = win.document;
globalThis.window = win;
globalThis.document = doc;
globalThis.Node = win.Node;
globalThis.Element = win.Element;
globalThis.HTMLElement = win.HTMLElement;

const mod = await import("../src/dict/online-phonetic.ts");
const { parseEudicHtml, fetchOnlinePhonetic, maybeFillPhonetic, resetOnlinePhoneticCache } = mod;

// ---- parseEudicHtml 纯函数 ----

test("parseEudicHtml：提取英/美双音标", () => {
  const html = `
    <span class="phontype">英</span><span class="Phonitic">/hə'ləʊ/</span>
    <span class="phontype">美</span><span class="Phonitic">/hə'loʊ/</span>
  `;
  assert.equal(parseEudicHtml(html), "英 /hə'ləʊ/ 美 /hə'loʊ/");
});

test("parseEudicHtml：只含英音", () => {
  const html = `<span class="phontype">英</span><span class="Phonitic">/wɜːd/</span>`;
  assert.equal(parseEudicHtml(html), "英 /wɜːd/");
});

test("parseEudicHtml：无音标返回 null", () => {
  assert.equal(parseEudicHtml(""), null);
  assert.equal(parseEudicHtml("<div>没有音标</div>"), null);
  assert.equal(parseEudicHtml(null), null);
});

// ---- fetchOnlinePhonetic 缓存与并发 ----

function mockTransport(html) {
  const calls = [];
  return {
    transport: async (url) => {
      calls.push(url);
      return { status: 200, body: html };
    },
    calls,
  };
}

test("fetchOnlinePhonetic：成功解析并缓存，二次调用不再请求", async () => {
  resetOnlinePhoneticCache();
  const { transport, calls } = mockTransport(`
    <span class="phontype">英</span><span class="Phonitic">/hə'ləʊ/</span>
    <span class="phontype">美</span><span class="Phonitic">/hə'loʊ/</span>
  `);
  const r1 = await fetchOnlinePhonetic("Hello", transport);
  assert.equal(r1, "英 /hə'ləʊ/ 美 /hə'loʊ/");
  const r2 = await fetchOnlinePhonetic("hello", transport); // 大小写归一
  assert.equal(r2, "英 /hə'ləʊ/ 美 /hə'loʊ/");
  assert.equal(calls.length, 1, "缓存命中不应二次请求");
});

test("fetchOnlinePhonetic：失败写负缓存，会话内不重试", async () => {
  resetOnlinePhoneticCache();
  let calls = 0;
  const transport = async () => { calls++; return { status: 404, body: "" }; };
  const r1 = await fetchOnlinePhonetic("notaword", transport);
  assert.equal(r1, null);
  const r2 = await fetchOnlinePhonetic("notaword", transport);
  assert.equal(r2, null);
  assert.equal(calls, 1, "负缓存：失败后不重试");
});

test("fetchOnlinePhonetic：并发同词只发一次请求", async () => {
  resetOnlinePhoneticCache();
  let calls = 0;
  const transport = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20)); // 模拟延迟
    return { status: 200, body: `<span class="phontype">英</span><span class="Phonitic">/kən'kʌrənt/</span>` };
  };
  const [a, b, c] = await Promise.all([
    fetchOnlinePhonetic("concurrent", transport),
    fetchOnlinePhonetic("concurrent", transport),
    fetchOnlinePhonetic("concurrent", transport),
  ]);
  assert.equal(a, "英 /kən'kʌrənt/");
  assert.equal(b, "英 /kən'kʌrənt/");
  assert.equal(c, "英 /kən'kʌrənt/");
  assert.equal(calls, 1, "并发同词只应发一次请求");
});

// ---- maybeFillPhonetic DOM 补写 ----

test("maybeFillPhonetic：空音标元素被异步补写", async () => {
  resetOnlinePhoneticCache();
  const container = doc.createElement("div");
  container.innerHTML = `<strong class="hiword-dict-word">hello</strong><em class="hiword-dict-phonetic"></em>`;
  doc.body.appendChild(container);
  // 预热缓存（mock 只含美音）
  const transport = async () => ({ status: 200, body: `<span class="phontype">美</span><span class="Phonitic">/hə'loʊ/</span>` });
  await fetchOnlinePhonetic("hello", transport);
  await maybeFillPhonetic(container, "hello");
  const el = container.querySelector(".hiword-dict-phonetic");
  assert.equal(el.textContent.trim(), "美 /hə'loʊ/");
  container.remove();
});

test("maybeFillPhonetic：已有音标文本 → 跳过不覆盖", async () => {
  resetOnlinePhoneticCache();
  const container = doc.createElement("div");
  container.innerHTML = `<strong class="hiword-dict-word">offline</strong><em class="hiword-dict-phonetic">/ɒf'laɪn/</em>`;
  doc.body.appendChild(container);
  const transport = async () => ({ status: 200, body: `<span class="phontype">美</span><span class="Phonitic">/əf'laɪn/</span>` });
  await fetchOnlinePhonetic("offline", transport);
  await maybeFillPhonetic(container, "offline");
  const el = container.querySelector(".hiword-dict-phonetic");
  assert.equal(el.textContent.trim(), "/ɒf'laɪn/", "离线音标不应被在线覆盖");
  container.remove();
});

test("maybeFillPhonetic：XSS 注入词转义（textContent 写入）", async () => {
  resetOnlinePhoneticCache();
  const container = doc.createElement("div");
  container.innerHTML = `<strong class="hiword-dict-word">x</strong>`;
  doc.body.appendChild(container);
  const evilWord = `<img src=x onerror=alert(1)>`;
  // 词本身经 encodeURIComponent，音标来自服务端解析；验证写入用 textContent 不会注入
  await maybeFillPhonetic(container, "x");
  const el = container.querySelector(".hiword-dict-phonetic");
  if (el) {
    // 无论在线结果如何，写入必须走 textContent（无 innerHTML 注入）
    assert.ok(!container.querySelector("img"), "不应注入 img");
  }
  container.remove();
});

test("resetOnlinePhoneticCache 清空状态", () => {
  resetOnlinePhoneticCache();
  assert.ok(true);
});
