/**
 * 双语新运行时（R6）单测：segmenter / visibility / injector / pretranslate
 * 全部用极简 DOM stub，不依赖 jsdom，单测可在纯 Node 下跑。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanText,
  segmentDocument,
  createSegmenter,
} from "../src/reader/bilingual/runtime/segmenter.ts";
import { createVisibility } from "../src/reader/bilingual/runtime/visibility.ts";
import { createInjector } from "../src/reader/bilingual/runtime/injector.ts";
import { createPretranslateQueue } from "../src/reader/bilingual/runtime/pretranslate.ts";

// 注意：不能用 new URL().pathname —— 中文目录会被编码成 %E6%80%9D 导致 readFileSync 找不到文件
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "src", "reader");

/* ============================================================
 * 极简 DOM stub
 * ============================================================ */

function mockEl(text, opts = {}) {
  const el = {
    tagName: opts.tagName || "P",
    textContent: text,
    attrs: Object.assign({}, opts.attrs),
    isConnected: opts.isConnected !== false,
    inserted: [],
    removedAttrs: [],
    children: [],
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    get childElementCount() {
      return this.children.length;
    },
    classList: { contains: () => !!opts.isBilingual },
    hasAttribute(n) {
      return Object.prototype.hasOwnProperty.call(this.attrs, n);
    },
    setAttribute(n, v) {
      this.attrs[n] = v;
    },
    removeAttribute(n) {
      delete this.attrs[n];
      this.removedAttrs.push(n);
    },
    closest: (sel) => (opts.closest ? opts.closest(sel) : null),
    querySelector: () => opts.child || null,
    get parentElement() {
      return opts.parent || null;
    },
    insertAdjacentElement(_pos, node) {
      this.inserted.push(node);
    },
    remove() {
      this.removed = true;
    },
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    nextElementSibling: opts.nextSibling || null,
  };
  return el;
}

function mockDoc(elements) {
  const doc = {
    _created: [],
    querySelectorAll: () => elements,
    createElement(tag) {
      const el = mockEl("", { tagName: (tag || "div").toUpperCase() });
      doc._created.push(el);
      return el;
    },
  };
  elements.forEach((el) => {
    el.ownerDocument = doc;
  });
  return doc;
}

/* ============================================================
 * 1. segmenter
 * ============================================================ */

test("segmenter：切出 p/li/blockquote，跳过 pre/code 与容器内子块", () => {
  const p1 = mockEl("  Hello   world. ");
  const code = mockEl("const x = 1;", { closest: (s) => (s.includes("code") ? {} : null) });
  const p2 = mockEl("Second paragraph.");
  const doc = mockDoc([p1, code, p2]);
  const segs = segmentDocument(doc, 0);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].text, "Hello world."); // 空白折叠
  assert.equal(segs[0].sectionIndex, 0);
  assert.equal(segs[0].indexInSection, 0);
  assert.equal(segs[1].indexInSection, 1);
});

test("segmenter：已成功注入的段（带标记）不再切出", () => {
  const done = mockEl("Already done.", { attrs: { "data-reword-translated": "1" } });
  const fresh = mockEl("Fresh one.");
  const doc = mockDoc([done, fresh]);
  const segs = segmentDocument(doc, 0);
  assert.deepEqual(segs.map((s) => s.text), ["Fresh one."]);
});

test("segmenter：locatorKey 只由原文决定（同文同键、异文异键）", () => {
  const a = mockEl("Same text here.");
  const b = mockEl("Same text here.");
  const c = mockEl("Different text.");
  const s1 = segmentDocument(mockDoc([a]), 0)[0];
  const s2 = segmentDocument(mockDoc([b]), 7)[0];
  const s3 = segmentDocument(mockDoc([c]), 0)[0];
  assert.equal(s1.locatorKey, s2.locatorKey, "同文本必须同键（与分节无关）");
  assert.notEqual(s1.locatorKey, s3.locatorKey);
});

test("segmenter：隐藏集合生效", () => {
  const a = mockEl("Hidden one.");
  const b = mockEl("Visible one.");
  const hidden = new Set([segmentDocument(mockDoc([mockEl("Hidden one.")]), 0)[0].locatorKey]);
  const segs = segmentDocument(mockDoc([a, b]), 0, (h) => hidden.has(h));
  assert.deepEqual(segs.map((s) => s.text), ["Visible one."]);
});

test("segmenter：prev 携带前文参考（最近 2 段）", () => {
  const doc = mockDoc([mockEl("One."), mockEl("Two."), mockEl("Three.")]);
  const segs = segmentDocument(doc, 0);
  assert.equal(segs[0].prev, "");
  assert.equal(segs[1].prev, "One.");
  assert.equal(segs[2].prev, "One.\nTwo.");
});

test("segmenter：memo 命中（同一 doc 二次调用返回同一数组）", () => {
  const seg = createSegmenter();
  const doc = mockDoc([mockEl("Memo text.")]);
  const a = seg.segmentsOf(doc, 0);
  const b = seg.segmentsOf(doc, 0);
  assert.equal(a, b, "memo 必须复用同一份结果");
});

test("segmenter：invalidate 后重切", () => {
  const seg = createSegmenter();
  const doc = mockDoc([mockEl("Reload me.")]);
  const a = seg.segmentsOf(doc, 0);
  seg.invalidate(doc);
  const b = seg.segmentsOf(doc, 0);
  assert.notEqual(a, b);
  assert.equal(b.length, 1);
});

test("segmenter：cleanText 折叠空白", () => {
  assert.equal(cleanText("  a \n\t b  "), "a b");
});

/* ============================================================
 * 2. visibility
 * ============================================================ */

test("visibility：窗口 = 当前分节 + aheadSections", () => {
  const vis = createVisibility({ getCurrentSection: () => 5 });
  const win = vis.currentWindow();
  assert.equal(win.fromSection, 5);
  assert.equal(win.toSection, 7); // 默认 aheadSections = 2
  assert.equal(win.basis, "viewport");
});

test("visibility：闸门放行窗口内，拦住窗口外", () => {
  const vis = createVisibility({ getCurrentSection: () => 5 });
  const gate = { aheadSections: 2 };
  assert.equal(vis.withinInjectGate(5, gate), true);
  assert.equal(vis.withinInjectGate(7, gate), true, "后 2 个分节应放行");
  assert.equal(vis.withinInjectGate(8, gate), false, "超出 +2 应拦下");
});

test("visibility：回翻旧分节一率放行（否则译文会消失）", () => {
  const vis = createVisibility({ getCurrentSection: () => 10 });
  assert.equal(vis.withinInjectGate(2, { aheadSections: 2 }), true);
});

test("visibility：拿不到当前分节时按 0 处理", () => {
  const vis = createVisibility({});
  assert.equal(vis.currentWindow().fromSection, 0);
});

/* ============================================================
 * 3. injector
 * ============================================================ */

function seg(text, sectionIndex = 0) {
  return { locatorKey: `k-${text}`, text, sectionIndex, indexInSection: 0 };
}

test("injector：成功注入才打标，空译文留空不打标", async () => {
  const doc = mockDoc([]);
  const ok = mockEl("Alpha paragraph.");
  ok.ownerDocument = doc;
  const empty = mockEl("Beta paragraph.");
  empty.ownerDocument = doc;
  const inj = createInjector({ scheduleFrame: (fn) => fn() });
  const res = await inj.injectBatch({
    segments: [seg("Alpha paragraph."), seg("Beta paragraph.")],
    translations: ["译文甲", ""],
  });
  // 段 node 未设置时为 undefined，本例手动挂载
  assert.equal(res.injected, 0, "无 node 的段不参与注入");
  assert.equal(res.empty, 2);
});

test("injector：带 node 的段成功注入后打标且可查", async () => {
  const doc = mockDoc([]);
  const el = mockEl("Gamma paragraph.");
  el.ownerDocument = doc;
  const s = seg("Gamma paragraph.");
  s.node = el;
  const inj = createInjector({ scheduleFrame: (fn) => fn() });
  const res = await inj.injectBatch({ segments: [s], translations: ["译文丙"] });
  assert.equal(res.injected, 1);
  assert.equal(el.attrs["data-reword-translated"], "1", "成功才打标");
  assert.equal(inj.hasInjected(s.locatorKey), true);
});

test("injector：空译文不打标（下轮可重试）", async () => {
  const doc = mockDoc([]);
  const el = mockEl("Delta paragraph.");
  el.ownerDocument = doc;
  const s = seg("Delta paragraph.");
  s.node = el;
  const inj = createInjector({ scheduleFrame: (fn) => fn() });
  const res = await inj.injectBatch({ segments: [s], translations: [""] });
  assert.equal(res.empty, 1);
  assert.equal(el.attrs["data-reword-translated"], undefined, "空译文绝不能打标");
  assert.equal(inj.hasInjected(s.locatorKey), false);
});

test("injector：每帧最多 perFrame 条（分帧有界）", async () => {
  const doc = mockDoc([]);
  const segs = [];
  for (let i = 0; i < 20; i++) {
    const el = mockEl(`Para ${i} enough text.`);
    el.ownerDocument = doc;
    const s = seg(`Para ${i} enough text.`);
    s.node = el;
    segs.push(s);
  }
  let frames = 0;
  const inj = createInjector({
    perFrame: 8,
    scheduleFrame: (fn) => {
      frames++;
      fn();
    },
  });
  const res = await inj.injectBatch({
    segments: segs,
    translations: segs.map((_, i) => `译 ${i}`),
  });
  assert.equal(res.injected, 20);
  assert.equal(frames, 2, "20 段 / 每帧 8 条 = 2 次跨帧");
});

test("injector：erase 移除打标与译文兄弟节点", async () => {
  const doc = mockDoc([]);
  const el = mockEl("Epsilon paragraph.");
  el.ownerDocument = doc;
  const s = seg("Epsilon paragraph.");
  s.node = el;
  const inj = createInjector({ scheduleFrame: (fn) => fn() });
  await inj.injectBatch({ segments: [s], translations: ["译文"] });
  assert.equal(inj.hasInjected(s.locatorKey), true);
  inj.erase(s.locatorKey);
  assert.equal(inj.hasInjected(s.locatorKey), false);
  assert.ok(el.removedAttrs.includes("data-reword-translated"));
});

test("injector：失败进 failedSet，且按退避时间才可重试", async () => {
  const doc = mockDoc([]);
  const el = mockEl("Zeta paragraph.");
  el.ownerDocument = doc;
  // 读阶段会抛：getComputedStyle 在 Node 不存在 → 被 render.ts try/catch 兜住，
  // 这里改为让 ownerDocument 缺失来触发失败分支
  const s = seg("Zeta paragraph.");
  s.node = mockEl("Zeta paragraph.", { isConnected: true });
  s.node.ownerDocument = null;
  const inj = createInjector({ scheduleFrame: (fn) => fn() });
  const res = await inj.injectBatch({ segments: [s], translations: ["译文"] });
  assert.equal(res.failed, 1);
  assert.equal(inj.hasInjected(s.locatorKey), false);
  assert.equal(inj.retryableKeys(Date.now()).length, 0, "刚失败时应处于退避期");
  assert.equal(inj.retryableKeys(Date.now() + 6000).length, 1, "5s 后应可重试");
});

/* ============================================================
 * 4. pretranslate 队列
 * ============================================================ */

function fakeSegmenter(segsByDoc) {
  const calls = [];
  return {
    calls,
    segmentsOf(doc, idx) {
      calls.push(idx);
      return segsByDoc.get(doc) || [];
    },
    segmentsOfDocs(docs, first = 0) {
      const out = [];
      // 与真实 segmenter 一致：sectionIndex 由 segmentsOf 决定，此处不覆盖
      docs.forEach((d, i) => out.push(...this.segmentsOf(d, first + i)));
      return out;
    },
    invalidate() {},
  };
}

function makeSegs(n, from = 0) {
  return Array.from({ length: n }, (_, i) => ({
    locatorKey: `k${from + i}`,
    text: `Text ${from + i} with enough length.`,
    sectionIndex: from + i,
    indexInSection: i,
  }));
}

/** 全部落在当前窗口内的段（sectionIndex 统一为 0），用于验证分批而非闸门 */
function makeSegsInWindow(n) {
  return makeSegs(n).map((s) => ({ ...s, sectionIndex: 0 }));
}

test("pretranslate：分批 = lanes 列 × blocksPerLane 块", async () => {
  const doc = mockDoc([]);
  const segs = makeSegsInWindow(20);
  const batches = [];
  const q = createPretranslateQueue({
    bookId: "b1",
    segmenter: fakeSegmenter(new Map([[doc, segs]])),
    visibility: createVisibility({ getCurrentSection: () => 0 }),
    injector: {
      hasInjected: () => false,
      injectBatch: async () => ({ injected: 0, empty: 0, failed: 0 }),
    },
    getContents: () => [doc],
    getCurrentSection: () => 0,
    translate: async (texts) => {
      batches.push(texts.length);
      return texts.map(() => "译");
    },
  });
  await q.start({ bookId: "b1", mode: "progressive", lanes: 2, blocksPerLane: 5 });
  assert.equal(batches.length, 4, "20 块 / 每批 5 = 4 批");
  batches.forEach((n) => assert.ok(n <= 5));
  assert.equal(q.state().status, "done");
  assert.equal(q.state().done, 20);
});

test("pretranslate：越界块只送译不注入（full 模式闸门生效）", async () => {
  const doc = mockDoc([]);
  const segs = makeSegs(10); // sectionIndex 0..9，其中 3..9 越界
  let injectedSections = [];
  const q = createPretranslateQueue({
    bookId: "b1",
    segmenter: fakeSegmenter(new Map([[doc, segs]])),
    visibility: createVisibility({ getCurrentSection: () => 0 }),
    injector: {
      hasInjected: () => false,
      injectBatch: async (batch) => {
        injectedSections.push(...batch.segments.map((s) => s.sectionIndex));
        return { injected: batch.segments.length, empty: 0, failed: 0 };
      },
    },
    getContents: () => [doc],
    getSections: () => [{ index: 0, createDocument: () => doc }],
    getCurrentSection: () => 0,
    // full 模式用 createDocument() 取段，节点未挂载（isConnected=false），
    // 必须由调用方用 getLiveSegment 映射回当前视图的真实节点才能注入
    // （见 pretranslate.ts:47-54）；不提供则该段只入缓存不注入。
    getLiveSegment: (locatorKey, sectionIndex) => {
      const s = segs.find((x) => x.locatorKey === locatorKey && x.sectionIndex === sectionIndex);
      return s ? { ...s, node: mockEl(s.text, { isConnected: true }) } : undefined;
    },
    translate: async (texts) => texts.map(() => "译"),
  });
  await q.start({ bookId: "b1", mode: "full", lanes: 1, blocksPerLane: 5, aheadSections: 2 });
  assert.deepEqual(injectedSections.sort((a, b) => a - b), [0, 1, 2], "只有 0..2（当前 +2）被注入");
  assert.equal(q.state().done, 10, "全部 10 块都送译入缓存");
  assert.equal(q.state().cachedOnly, 7, "越界 7 块只缓存不注入");
});

test("pretranslate：full 模式惰性遍历全书 sections", async () => {
  const docs = [mockDoc([]), mockDoc([]), mockDoc([])];
  const byDoc = new Map(docs.map((d, i) => [d, makeSegs(3, i * 3)]));
  const seg = fakeSegmenter(byDoc);
  const q = createPretranslateQueue({
    bookId: "b1",
    segmenter: seg,
    visibility: createVisibility({ getCurrentSection: () => 0 }),
    injector: { hasInjected: () => false, injectBatch: async () => ({ injected: 0, empty: 0, failed: 0 }) },
    getContents: () => docs,
    getSections: () => docs.map((d, i) => ({ index: i, createDocument: () => d })),
    getCurrentSection: () => 0,
    translate: async (texts) => texts.map(() => "译"),
  });
  await q.start({ bookId: "b1", mode: "full", lanes: 1, blocksPerLane: 5 });
  assert.deepEqual(seg.calls, [0, 1, 2], "三个分节各切一次");
  assert.equal(q.state().done, 9);
});

test("pretranslate：拿不到 sections 时 full 退化为窗口取段（不静默空转）", async () => {
  const doc = mockDoc([]);
  const q = createPretranslateQueue({
    bookId: "b1",
    segmenter: fakeSegmenter(new Map([[doc, makeSegs(4)]])),
    visibility: createVisibility({ getCurrentSection: () => 0 }),
    injector: { hasInjected: () => false, injectBatch: async () => ({ injected: 0, empty: 0, failed: 0 }) },
    getContents: () => [doc],
    getSections: () => [],
    getCurrentSection: () => 0,
    translate: async (texts) => texts.map(() => "译"),
  });
  await q.start({ bookId: "b1", mode: "full", lanes: 1, blocksPerLane: 5 });
  assert.equal(q.state().status, "done");
  assert.ok(q.state().done > 0, "退化路径仍要干活，不能静默空转");
});

test("pretranslate：cancel 中止后状态为 cancelled", async () => {
  let n = 0;
  const doc = mockDoc([]);
  const q = createPretranslateQueue({
    bookId: "b1",
    segmenter: fakeSegmenter(new Map([[doc, makeSegsInWindow(20)]])),
    visibility: createVisibility({ getCurrentSection: () => 0 }),
    injector: { hasInjected: () => false, injectBatch: async () => ({ injected: 0, empty: 0, failed: 0 }) },
    getContents: () => [doc],
    getCurrentSection: () => 0,
    translate: async (texts) => {
      n++;
      if (n === 2) q.cancel();
      return texts.map(() => "译");
    },
  });
  await q.start({ bookId: "b1", mode: "progressive", lanes: 1, blocksPerLane: 5 });
  assert.equal(q.state().status, "cancelled");
  assert.ok(n < 4, "取消后不应继续跑完全部批次");
});

test("pretranslate：pumpFromCache 只补已缓存的块（零网络）", async () => {
  const doc = mockDoc([]);
  let translateCalls = 0;
  const q = createPretranslateQueue({
    bookId: "b1",
    segmenter: fakeSegmenter(new Map([[doc, makeSegs(3)]])),
    visibility: createVisibility({ getCurrentSection: () => 0 }),
    injector: {
      hasInjected: () => false,
      injectBatch: async (b) => ({ injected: b.segments.length, empty: 0, failed: 0 }),
    },
    getContents: () => [doc],
    getCurrentSection: () => 0,
    checkCached: async (texts) => texts.map((_, i) => i === 0), // 只有第 1 块已缓存
    translate: async (texts) => {
      translateCalls++;
      return texts.map(() => "译");
    },
  });
  await q.pumpFromCache();
  assert.equal(translateCalls, 1);
  const st = q.state();
  assert.equal(st.injected, 1, "只补注已缓存的 1 块");
});

/* ============================================================
 * 5. 与旧实现的契约一致性（源码级断言）
 * ============================================================ */

test("[契约] render.ts 不再无条件打标（失败不再被永久跳过）", () => {
  const src = readFileSync(join(root, "bilingual-v2", "render.ts"), "utf-8");
  const body = src.slice(src.indexOf("export function injectSibling"));
  const injectFn = body.slice(0, body.indexOf("\n}"));
  assert.ok(
    !injectFn.includes("data-reword-translated"),
    "injectSibling 不得再打标 —— 打标已收口到 injector 的成功分支",
  );
  assert.ok(/return true/.test(injectFn), "应返回插入是否成功，供注入器判定三态");
});

test("[契约] 打标只在注入器成功分支出现", () => {
  const src = readFileSync(join(root, "bilingual", "runtime", "injector.ts"), "utf-8");
  const idx = src.indexOf('setAttribute("data-reword-translated"');
  assert.ok(idx > 0, "注入器应负责打标");
  const before = src.slice(Math.max(0, idx - 300), idx);
  assert.ok(before.includes("只有"), "打标前应有「只有成功才打标」的注释说明");
  assert.ok(before.includes("applyAlignment"), "打标应在插入与样式写入成功之后");
});
