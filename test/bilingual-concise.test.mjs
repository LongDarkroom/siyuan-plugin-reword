/**
 * 段落级"重新翻译为简洁版"（2026-08-30 v1.4.3）测试
 * 覆盖：
 *   - cache.ts：多 mode 路由（default vs concise 不冲突）、旧版单 mode 自动迁移
 *   - bilingual.ts：
 *     · 按钮 DOM 结构（span + button sibling，data-mode / data-action / data-translation-mark）
 *     · 端到端：点击按钮 → 切到 concise → 翻译替换 + data-mode + 按钮文案 + class
 *     · 端到端：再点 → 切回 default（不调 AI，直接走翻译缓存或重新拉）
 *     · 并发控制：同 in-flight key 二次点击短路
 *     · AI 失败 / 返回空：原译文保留、按钮恢复
 *     · 事件委托：__rewordBilingualBound flag 防止重复绑定
 *     · onViewLoad 重绑（foliate 翻页重建 Document 场景）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TranslationCache } from "../src/translate/cache.ts";
import { createBilingual } from "../src/reader/bilingual.ts";

/* ==================== 工具 ==================== */

function makeDoc(html) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  return dom.window.document;
}

function makeStubPlugin() {
  const store = new Map();
  return {
    async loadData(p) { return store.get(p); },
    async saveData(p, v) { store.set(p, v); },
  };
}

/** 共享测试 fixtures：每个 test 自建 doc + opts，避免状态串扰 */
function setup(optsOver = {}) {
  const doc = makeDoc("<p>第一段</p><p>第二段</p><p>第三段</p>");
  let calls = 0;
  let lastTexts = [];
  let lastExtra;
  const callsLog = [];
  const handle = createBilingual({
    bookId: "book-c1",
    getContents: () => [doc],
    translateBatch: async (texts, _f, _t, _b, _ctx, _meta, extra) => {
      calls++;
      callsLog.push({ texts: [...texts], extra });
      lastTexts = texts;
      lastExtra = extra;
      // 约定：传入 "CONCISE:" 前缀 → 返回 "简:"，否则返回 "译:"
      return texts.map((x) => (extra && extra.mode === "concise" ? "简:" + x : "译:" + x));
    },
    from: "auto",
    to: "zh",
    bookMeta: () => ({ title: "测试书", author: "某作者", language: "en" }),
    ...optsOver,
  });
  return { doc, handle, calls: () => calls, lastTexts: () => lastTexts, lastExtra: () => lastExtra, callsLog };
}

/** 模拟一次「开双语 → 注入 → 眼前屏 div 都生成」的流程 */
async function bootstrapOneSegment(handle, doc) {
  handle.setEnabled(true);
  // wait for injectAll async + initial translation
  await new Promise((r) => setTimeout(r, 30));
  return doc.querySelector(".reword-bilingual");
}

/* ==================== cache.ts：mode 路由 ==================== */

test("cache: default 与 concise 同段不冲突（独立缓存区）", async () => {
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin, () => "salt-v1");
  await c.setBatch("b1", [["hello", "译:hello"]], "default");
  await c.setBatch("b1", [["hello", "简:hello"]], "concise");

  const rd = await c.getBatch("b1", ["hello"], "default");
  const rc = await c.getBatch("b1", ["hello"], "concise");
  assert.equal(rd.hits[0], "译:hello", "default 走默认译文");
  assert.equal(rc.hits[0], "简:hello", "concise 走简洁译文");
});

test("cache: 同段重写 default 译文不污染 concise（反之亦然）", async () => {
  const plugin = makeStubPlugin();
  const c = new TranslationCache(plugin, () => "salt-v1");
  await c.setBatch("b1", [["hi", "旧直译"]], "default");
  await c.setBatch("b1", [["hi", "旧简译"]], "concise");
  // 重写 default
  await c.setBatch("b1", [["hi", "新直译"]], "default");
  const rd = await c.getBatch("b1", ["hi"], "default");
  const rc = await c.getBatch("b1", ["hi"], "concise");
  assert.equal(rd.hits[0], "新直译");
  assert.equal(rc.hits[0], "旧简译", "改 default 不应影响 concise");
});

test("cache: 旧版单 mode JSON 自动回填到 {default, concise} 形态", async () => {
  const plugin = makeStubPlugin();
  // 落盘旧版数据
  await plugin.saveData("translations/legacy.json", { abc123: "旧译文" });
  const c = new TranslationCache(plugin);
  const m = await c.load("legacy");
  assert.equal(m.default.abc123, "旧译文");
  assert.deepEqual(m.concise, {}, "concise 默认为空对象");
  // default / concise 查询 "anything"：旧版 hash 是 abc123，与 anything 的 hash 不同
  //  → 两边都 miss（但回填结构正确，迁移生效）
  const rd = await c.getBatch("legacy", ["anything"], "default");
  const rc = await c.getBatch("legacy", ["anything"], "concise");
  assert.equal(rd.misses.length, 1);
  assert.equal(rc.misses.length, 1);
  // 验证迁移确实生效：用旧版 hash 路径的 key 直接访问 default map
  assert.equal(m.default.abc123, "旧译文");
  assert.deepEqual(m.concise, {});
});

test("cache: 显式 setBatch(mode=default) 落盘多 mode 形态，下次 load 仍可读", async () => {
  const plugin = makeStubPlugin();
  const c1 = new TranslationCache(plugin, () => "s");
  await c1.setBatch("b1", [["a", "译:a"]], "default");
  await c1.setBatch("b1", [["a", "简:a"]], "concise");
  // 等防抖落盘
  await new Promise((r) => setTimeout(r, 600));
  const c2 = new TranslationCache(plugin, () => "s");
  const rd = await c2.getBatch("b1", ["a"], "default");
  const rc = await c2.getBatch("b1", ["a"], "concise");
  assert.equal(rd.hits[0], "译:a");
  assert.equal(rc.hits[0], "简:a");
});

test("cache: 不同 salt 时 default/concise 都不命中（与原文 hash 解耦）", async () => {
  const plugin = makeStubPlugin();
  const c1 = new TranslationCache(plugin, () => "s1");
  await c1.setBatch("b1", [["hello", "译:hello"]], "default");
  await c1.setBatch("b1", [["hello", "简:hello"]], "concise");

  const c2 = new TranslationCache(plugin, () => "s2");
  const rd = await c2.getBatch("b1", ["hello"], "default");
  const rc = await c2.getBatch("b1", ["hello"], "concise");
  assert.equal(rd.hits[0], undefined);
  assert.equal(rc.hits[0], undefined);
});

/* ==================== bilingual.ts：按钮 DOM 结构 ==================== */

test("bilingual: 注入的 .reword-bilingual 包含 span 译文 + 按钮组（重译/修正/简洁版/隐藏）", async () => {
  const { doc, handle } = setup();
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  const div = doc.querySelector(".reword-bilingual");
  assert.ok(div, "应有译文块");
  // 结构：div > [span.reword-bilingual-text, (badge?), .reword-bilingual-actions > buttons]
  const span = div.querySelector(":scope > span.reword-bilingual-text");
  assert.ok(span, "应包含 .reword-bilingual-text span");
  const actions = div.querySelector(":scope > .reword-bilingual-actions");
  assert.ok(actions, "应包含 .reword-bilingual-actions 按钮组");
  const conciseBtn = actions.querySelector('button.reword-bilingual-action[data-action="concise"]');
  assert.ok(conciseBtn, "按钮组应包含简洁版按钮");
  // 按钮是 actions 的子节点（不是 div 直接子，避免污染 CFI）
  assert.equal(conciseBtn.parentElement, actions);
  // 简化：默认含 重译/修正/简洁版/隐藏 四个操作按钮
  const actionsAll = actions.querySelectorAll("button.reword-bilingual-action");
  assert.equal(actionsAll.length, 4, "应有 重译/修正/简洁版/隐藏 四个操作按钮");
  // div 默认 mode=default
  assert.equal(div.getAttribute("data-mode"), "default");
  // div.position = relative（按钮组 absolute 定位锚点）
  assert.match(div.getAttribute("style") || "", /position:\s*relative/i);
});

test("bilingual: data-translation-mark 在 div 上 → 排除 foliate text-walker", async () => {
  const { doc, handle } = setup();
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  const div = doc.querySelector(".reword-bilingual");
  assert.equal(div.getAttribute("data-translation-mark"), "1");
  // 按钮本身不带 data-translation-mark（它是按钮，foliate 也不会 walk 按钮）
  const btn = div.querySelector('button.reword-bilingual-action[data-action="concise"]');
  assert.equal(btn.hasAttribute("data-translation-mark"), false);
});

/* ==================== bilingual.ts：端到端 retranslate ==================== */

test("bilingual: 端到端 default→concise，替换文本 + 切 data-mode + 按钮文案 + class", async () => {
  const { doc, handle, callsLog } = setup();
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  // 初始注入：第一次调用（injectAll）→ mode=default
  const initCalls = callsLog.length;
  assert.ok(initCalls >= 1, "应有初次 injectAll 调用");

  const div = doc.querySelector(".reword-bilingual");
  const span = div.querySelector(".reword-bilingual-text");
  const btn = div.querySelector('button.reword-bilingual-action[data-action="concise"]');
  assert.equal(span.textContent, "译:第一段");

  // 点击按钮 → 切到 concise
  const ok = await handle.retranslateConcise(div);
  assert.equal(ok, true);
  assert.equal(span.textContent, "简:第一段", "译文替换为简洁版");
  assert.equal(div.getAttribute("data-mode"), "concise");
  assert.equal(btn.textContent, "↩ 原版", "按钮文案切换为「还原」");
  assert.equal(btn.getAttribute("title"), "还原为默认译文");
  assert.ok(btn.classList.contains("reword-bilingual-mode-concise"), "按钮加 mode-concise class");

  // 重新翻译调用记录：mode 必须是 "concise"
  const conciseCall = callsLog.find((c) => c.extra && c.extra.mode === "concise");
  assert.ok(conciseCall, "应有一次 mode=concise 的 translateBatch 调用");
  assert.deepEqual(conciseCall.texts, ["第一段"], "只送了原段落文本");
});

test("bilingual: 端到端 concise→default 还原（按钮再次点击）", async () => {
  const { doc, handle } = setup();
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  const div = doc.querySelector(".reword-bilingual");
  const span = div.querySelector(".reword-bilingual-text");

  await handle.retranslateConcise(div);
  assert.equal(span.textContent, "简:第一段");
  assert.equal(div.getAttribute("data-mode"), "concise");

  // 再点一次：concise → default
  const ok = await handle.retranslateConcise(div);
  assert.equal(ok, true);
  assert.equal(span.textContent, "译:第一段", "还原为默认译文");
  assert.equal(div.getAttribute("data-mode"), "default");
  const btn = div.querySelector('button.reword-bilingual-action[data-action="concise"]');
  assert.equal(btn.textContent, "🔄 简洁版", "按钮文案恢复为「简洁版」");
  assert.equal(btn.getAttribute("title"), "重新翻译为简洁版");
  assert.equal(btn.classList.contains("reword-bilingual-mode-concise"), false, "移除 mode-concise class");
});

test("bilingual: 默认 mode 时调用 retranslateConcise 使用 mode='concise'", async () => {
  const { doc, handle, callsLog } = setup();
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  const div = doc.querySelector(".reword-bilingual");
  await handle.retranslateConcise(div);
  const last = callsLog[callsLog.length - 1];
  assert.equal(last.extra.mode, "concise");
});

test("bilingual: 段中无原文（空段落）→ retranslateConcise 返回 false，不调 AI", async () => {
  const doc = makeDoc("<p></p>");
  let called = false;
  const handle = createBilingual({
    bookId: "b2",
    getContents: () => [doc],
    translateBatch: async () => { called = true; return [""]; },
    from: "auto",
    to: "zh",
  });
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  // 注入后 div 的 parentElement 是 <p>，但 <p> 没其他子节点 → originalText 为空
  const div = doc.querySelector(".reword-bilingual");
  if (div) {
    const ok = await handle.retranslateConcise(div);
    assert.equal(ok, false);
  }
  assert.equal(called, false, "无原文时不应调 AI");
});

/* ==================== bilingual.ts：AI 失败/空保留原译文 ==================== */

test("bilingual: AI 返回空字符串 → 原译文保留，data-mode 不变", async () => {
  const doc = makeDoc("<p>原文段</p>");
  const handle = createBilingual({
    bookId: "b3",
    getContents: () => [doc],
    translateBatch: async (texts, _f, _t, _b, _c, _m, extra) => {
      if (extra && extra.mode === "concise") return [""]; // concise 模式返回空
      return ["译:" + texts[0]];
    },
    from: "auto",
    to: "zh",
  });
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  const div = doc.querySelector(".reword-bilingual");
  const span = div.querySelector(".reword-bilingual-text");
  assert.equal(span.textContent, "译:原文段");
  const ok = await handle.retranslateConcise(div);
  assert.equal(ok, false, "AI 返回空时 retranslate 返回 false");
  assert.equal(span.textContent, "译:原文段", "原译文保留");
  assert.equal(div.getAttribute("data-mode"), "default", "data-mode 不应被切换");
});

test("bilingual: AI 抛错 → 原译文保留", async () => {
  const doc = makeDoc("<p>Boom段</p>");
  const handle = createBilingual({
    bookId: "b4",
    getContents: () => [doc],
    translateBatch: async (texts, _f, _t, _b, _c, _m, extra) => {
      if (extra && extra.mode === "concise") throw new Error("AI 挂了");
      return ["译:" + texts[0]];
    },
    from: "auto",
    to: "zh",
  });
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  const div = doc.querySelector(".reword-bilingual");
  const span = div.querySelector(".reword-bilingual-text");
  const ok = await handle.retranslateConcise(div);
  assert.equal(ok, false);
  assert.equal(span.textContent, "译:Boom段", "AI 抛错时原译文保留");
  assert.equal(div.getAttribute("data-mode"), "default");
});

/* ==================== bilingual.ts：并发控制 ==================== */

test("bilingual: 同 in-flight key（相同原文）并发点击 → 第二次短路返回 false", async () => {
  const doc = makeDoc("<p>同段</p>");
  let inflight = 0;
  let maxInflight = 0;
  let resolveBlock;
  const blockPromise = new Promise((r) => { resolveBlock = r; });
  const handle = createBilingual({
    bookId: "b5",
    getContents: () => [doc],
    translateBatch: async (texts, _f, _t, _b, _c, _m, extra) => {
      if (extra && extra.mode === "concise") {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await blockPromise;
        inflight--;
        return ["简:" + texts[0]];
      }
      return ["译:" + texts[0]];
    },
    from: "auto",
    to: "zh",
  });
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  const div = doc.querySelector(".reword-bilingual");
  // 第一次点击：进入 in-flight
  const p1 = handle.retranslateConcise(div);
  // 立即第二次点击：应被 in-flight 拦截
  const r2 = await handle.retranslateConcise(div);
  assert.equal(r2, false, "in-flight 中再次点击应短路返回 false");
  // 放行
  resolveBlock();
  const r1 = await p1;
  assert.equal(r1, true);
  assert.ok(maxInflight <= 1, "翻译函数只应被并发调用 1 次");
});

/* ==================== bilingual.ts：事件委托 ==================== */

test("bilingual: __rewordBilingualBound flag 防止重复绑定（连续 setEnabled）", async () => {
  const { doc, handle } = setup();
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  // doc 已有 __rewordBilingualBound 标志
  assert.equal(doc.__rewordBilingualBound, true);
  // 多次调 onViewLoad 不应重复 addEventListener（不会抛错，可通过同 flag 验证）
  handle.onViewLoad();
  handle.onViewLoad();
  assert.equal(doc.__rewordBilingualBound, true);
});

test("bilingual: onViewLoad 后点击 button 仍能触发 retranslate（事件委托复用）", async () => {
  const { doc, handle, callsLog } = setup();
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  // 模拟 foliate 翻页 → 重绑
  handle.onViewLoad();
  const div = doc.querySelector(".reword-bilingual");
  const btn = div.querySelector('button.reword-bilingual-action[data-action="concise"]');
  // 触发 click 事件
  btn.click();
  await new Promise((r) => setTimeout(r, 30));
  const conciseCall = callsLog.find((c) => c.extra && c.extra.mode === "concise");
  assert.ok(conciseCall, "click 事件应触发 concise 翻译");
});

test("bilingual: 点击非 button 区域不触发 retranslate", async () => {
  const { doc, handle, callsLog } = setup();
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  const div = doc.querySelector(".reword-bilingual");
  const span = div.querySelector(".reword-bilingual-text");
  const before = callsLog.length;
  span.click();
  await new Promise((r) => setTimeout(r, 20));
  const after = callsLog.length;
  assert.equal(after, before, "点击 span 不应触发新翻译");
});

/* ==================== bilingual.ts：handle 集成 ==================== */

test("bilingual: setEnabled(false) 后 retranslateConcise 不应改 DOM", async () => {
  const { doc, handle } = setup();
  handle.setEnabled(true);
  await new Promise((r) => setTimeout(r, 30));
  const div = doc.querySelector(".reword-bilingual");
  const span = div.querySelector(".reword-bilingual-text");
  handle.setEnabled(false);
  // 关闭后仍调用 retranslateConcise（罕见但 API 应安全）—— 节点 isConnected 检查不阻止
  // 但调用不会修改已被 removeAll 的节点（removeAll 直接 remove .reword-bilingual）
  const after = handle.retranslateConcise(div);
  // 节点已被 removeAll 移除（div.parentNode 应为 null 或不在原 <p> 内）
  await after;
  assert.notEqual(span.textContent, "简:第一段", "关闭双语后译文不应被覆盖");
});
