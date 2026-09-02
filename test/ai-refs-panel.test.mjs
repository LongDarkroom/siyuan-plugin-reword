// 2026-09-02 B 组：ai-panel 引用附件接线的集成测试（直接 import 生产代码）
//
// 为什么需要这个文件：test/ai-refs.test.mjs 只覆盖纯函数层，而 B 组真正的风险在
// 「面板侧接线」——registerRef / ensureRef（去重+LRU）/ expandRefs（单步查表）。
// 这一层过去零覆盖，只能靠镜像副本自欺欺人。
//
// 前置条件：ai-panel.ts 的构造函数不能用 TS 参数属性
// （`constructor(private host: AiHost)`），否则 node --experimental-strip-types
// 在 strip-only 模式下解析失败 → 整个模块无法被测试 import。已改为普通字段赋值。

import { test } from "node:test";
import assert from "node:assert/strict";
import { AiPanel } from "../src/ai/ai-panel.ts";
import { refPlaceholderOf, MAX_BLOCK_TOTAL, MAX_DOC_TOTAL } from "../src/ai/ai-refs.ts";

const BLOCK_ID = "20260813120000-zzzzzz";
const BLOCK_ID_2 = "20260813120000-yyyyyy";
const DOC_ID = "20260813120000-aaaaaa";
const DOC_ID_2 = "20260813120000-bbbbbb";

/**
 * 最小 AiHost 替身：只实现引用链路真正会调的两个方法，并统计调用次数。
 * 其余方法用 Proxy 兜成 no-op，避免接口变动导致测试大面积失效。
 *
 * 槽位守卫：块/文档两组 fixture 严格分开。若某个 id 被用「另一边」的 fetcher 取，
 * 直接抛错而不是静默返回 null —— 否则写测试时把文档正文误传进 block 槽位，
 * 只会看到「body undefined」这种看不出根因的失败。
 */
function makeHost(blockBodies = {}, docBodies = {}) {
  const calls = { block: [], doc: [] };
  const base = {
    fetchBlockText: async (id) => {
      if (id in docBodies) {
        throw new Error(`槽位错位：id=${id} 属于 docBodies，却走 fetchBlockText`);
      }
      calls.block.push(id);
      return blockBodies[id] ?? null;
    },
    fetchDocText: async (id) => {
      if (id in blockBodies) {
        throw new Error(`槽位错位：id=${id} 属于 blockBodies，却走 fetchDocText`);
      }
      calls.doc.push(id);
      return docBodies[id] ?? null;
    },
  };
  const host = new Proxy(base, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return () => null; // 未实现的宿主能力一律 no-op
    },
  });
  return { host, calls };
}

function makePanel(blockBodies = {}, docBodies = {}) {
  const { host, calls } = makeHost(blockBodies, docBodies);
  const panel = new AiPanel(host);
  return { panel, calls };
}

// ── registerRef / refTitleOf ───────────────────────────────────────

test("Panel:登记附件后可直接取标题，无需网络", async () => {
  const { panel, calls } = makePanel();
  panel.registerRef({ kind: "block", id: BLOCK_ID, title: "正文前六字" });
  assert.equal(panel.refTitleOf(BLOCK_ID), "正文前六字");
  assert.equal(calls.block.length, 0);
});

test("Panel:未登记 id 的标题兜底为「块 xxxxxx…」", () => {
  const { panel } = makePanel();
  assert.equal(panel.refTitleOf(BLOCK_ID), "块 zzzzzz…");
});

test("Panel:registerRef 合并——正文优先，后登记的空 body 不覆盖已有正文", () => {
  const { panel } = makePanel();
  panel.registerRef({ kind: "block", id: BLOCK_ID, title: "标题", body: "完整正文" });
  panel.registerRef({ kind: "block", id: BLOCK_ID, title: "新标题" });
  assert.equal(panel.peekRefBody(BLOCK_ID), "完整正文");
  assert.equal(panel.refTitleOf(BLOCK_ID), "新标题");
});

// ── ensureRef：缓存 / 去重 / 按 kind 选 fetcher ────────────────────

test("Panel:ensureRef 缓存命中不再请求", async () => {
  const { panel, calls } = makePanel({ [BLOCK_ID]: "块正文" });
  await panel.ensureRef(BLOCK_ID, "block");
  await panel.ensureRef(BLOCK_ID, "block");
  assert.equal(calls.block.length, 1, "同一 id 第二次应走缓存");
});

test("Panel:ensureRef 并发调用共享 in-flight Promise（预取与发送只请求一次）", async () => {
  const { panel, calls } = makePanel({}, { [DOC_ID]: "文档正文" });
  panel.registerRef({ kind: "doc", id: DOC_ID, title: "📄 文档 aaaaaa" });
  // 模拟「拖入预取」与「发送展开」并发
  const [a, b, c] = await Promise.all([
    panel.ensureRef(DOC_ID, "doc"),
    panel.ensureRef(DOC_ID, "doc"),
    panel.ensureRef(DOC_ID, "doc"),
  ]);
  assert.equal(calls.doc.length, 1, "三个并发只应触发一次 fetch");
  assert.equal(a?.body, "文档正文");
  assert.equal(b?.body, "文档正文");
  assert.equal(c?.body, "文档正文");
});

test("Panel:kind=doc 走 fetchDocText，kind=block 走 fetchBlockText，绝不串行", async () => {
  const { panel, calls } = makePanel({ [BLOCK_ID]: "块正文" }, { [DOC_ID]: "文档正文" });
  await panel.ensureRef(DOC_ID, "doc");
  await panel.ensureRef(BLOCK_ID, "block");
  assert.deepEqual(calls.doc, [DOC_ID]);
  assert.deepEqual(calls.block, [BLOCK_ID]);
});

test("Panel:未登记 id 默认按 block 处理（兼容手输占位符）", async () => {
  const { panel, calls } = makePanel({ [BLOCK_ID]: "块正文" });
  await panel.expandRefs(`前缀 ${refPlaceholderOf(BLOCK_ID)}`);
  assert.deepEqual(calls.block, [BLOCK_ID]);
  assert.equal(calls.doc.length, 0);
});

test("Panel:取正文失败不做负缓存，下次仍重试", async () => {
  const { panel, calls } = makePanel();
  const a = await panel.ensureRef(BLOCK_ID, "block");
  const b = await panel.ensureRef(BLOCK_ID, "block");
  assert.equal(a?.status, "failed");
  assert.equal(calls.block.length, 2, "失败应允许重试，不做负缓存");
  assert.equal(b?.status, "failed");
});

// ── expandRefs：单步查表 ────────────────────────────────────────────

test("Panel:expandRefs 把块占位符替换为正文（零字符串往返）", async () => {
  const { panel } = makePanel({ [BLOCK_ID]: "这是块正文" });
  const out = await panel.expandRefs(`请解释：${refPlaceholderOf(BLOCK_ID)}`);
  assert.match(out, /请解释：/);
  assert.match(out, /这是块正文/);
  assert.ok(!out.includes("@@REWORD_REF_"), "占位符必须被消费掉");
  assert.ok(!out.includes("(("), "不得残留 kramdown 引用语法");
});

test("Panel:expandRefs 文档占位符带 ## 📄 文档 标题", async () => {
  const { panel } = makePanel({}, { [DOC_ID]: "整篇正文" });
  panel.registerRef({ kind: "doc", id: DOC_ID, title: "📄 文档 aaaaaa" });
  const out = await panel.expandRefs(refPlaceholderOf(DOC_ID));
  assert.match(out, /## 📄 文档 aaaaaa/);
  assert.match(out, /整篇正文/);
  assert.ok(!out.includes("@@REWORD_REF_"));
});

test("Panel:expandRefs 无占位符时原样返回、零请求", async () => {
  const { panel, calls } = makePanel();
  const md = "普通问题,没有引用";
  assert.equal(await panel.expandRefs(md), md);
  assert.equal(calls.block.length + calls.doc.length, 0);
});

test("Panel:块正文拉取失败 → 退化为锚文本，绝不把占位符原文发给 AI", async () => {
  const { panel } = makePanel();
  panel.registerRef({ kind: "block", id: BLOCK_ID, title: "锚文本" });
  const out = await panel.expandRefs(refPlaceholderOf(BLOCK_ID));
  assert.ok(!out.includes("@@REWORD_REF_"), "占位符绝不能漏给 AI");
  assert.match(out, /锚文本/);
});

test("Panel:文档拉取失败 → 给 AI 明确降级提示而非静默删除", async () => {
  const { panel } = makePanel();
  panel.registerRef({ kind: "doc", id: DOC_ID, title: "📄 文档 aaaaaa" });
  const out = await panel.expandRefs(refPlaceholderOf(DOC_ID));
  assert.match(out, /文档 aaaaaa 内容暂不可用/);
  assert.ok(!out.includes("@@REWORD_REF_"));
});

test("Panel:块总量超 8000 → 后续块退化为锚文本", async () => {
  const big = "x".repeat(5000);
  const { panel } = makePanel({
    [BLOCK_ID]: big,
    [BLOCK_ID_2]: big,
  });
  panel.registerRef({ kind: "block", id: BLOCK_ID, title: "第一块" });
  panel.registerRef({ kind: "block", id: BLOCK_ID_2, title: "第二块" });
  const out = await panel.expandRefs(
    `${refPlaceholderOf(BLOCK_ID)} 与 ${refPlaceholderOf(BLOCK_ID_2)}`
  );
  // 第一块在预算内 → 给全文；第二块会把块总量顶过 8000 → 退化为它的锚文本「第二块」
  assert.ok(out.includes(big), "预算内的块应给全文");
  assert.match(out, /第二块/, "超限的块应退化为其锚文本");
  assert.ok(!out.includes("第一块"), "未退化的块不需要回退成锚文本");
  assert.ok(out.length < MAX_BLOCK_TOTAL + 200);
  assert.ok(!out.includes("@@REWORD_REF_"));
});

test("Panel:文档总量超 12000 → 后者只保留标题", async () => {
  const big = "y".repeat(9000);
  const { panel } = makePanel({}, { [DOC_ID]: big, [DOC_ID_2]: big });
  panel.registerRef({ kind: "doc", id: DOC_ID, title: "📄 文档 aaaaaa" });
  panel.registerRef({ kind: "doc", id: DOC_ID_2, title: "📄 文档 bbbbbb" });
  const out = await panel.expandRefs(
    `${refPlaceholderOf(DOC_ID)} 与 ${refPlaceholderOf(DOC_ID_2)}`
  );
  assert.match(out, /## 📄 文档 aaaaaa/);
  assert.match(out, /## 📄 文档 bbbbbb/, "超限文档仍保留标题，让 AI 知道引用过");
  assert.ok(out.length < MAX_DOC_TOTAL + 200);
});

test("Panel:混合块 + 文档一次展开，各自走各自的 fetcher", async () => {
  const { panel, calls } = makePanel({ [BLOCK_ID]: "块正文" }, { [DOC_ID]: "文档正文" });
  panel.registerRef({ kind: "doc", id: DOC_ID, title: "📄 文档 aaaaaa" });
  const out = await panel.expandRefs(
    `${refPlaceholderOf(BLOCK_ID)} 然后 ${refPlaceholderOf(DOC_ID)}`
  );
  assert.deepEqual(calls.doc, [DOC_ID]);
  assert.deepEqual(calls.block, [BLOCK_ID]);
  assert.match(out, /块正文/);
  assert.match(out, /## 📄 文档 aaaaaa/);
  assert.match(out, /文档正文/);
});

// ── 兜底路径：((id 'anchor')) ──────────────────────────────────────

test("Panel:expandBlockRefs 兜底处理历史会话的 ((id 'anchor'))", async () => {
  const { panel } = makePanel({ [BLOCK_ID]: "历史块正文" });
  const out = await panel.expandBlockRefs(`死马当活马 ((${BLOCK_ID} '锚'))`);
  assert.match(out, /历史块正文/);
  assert.ok(!out.includes("(("));
});

test("Panel:expandDocRefs 兜底处理 ((docId '📄 文档 x'))", async () => {
  const { panel } = makePanel({}, { [DOC_ID]: "历史文档正文" });
  const out = await panel.expandDocRefs(`((${DOC_ID} '📄 文档 aaaaaa'))`);
  assert.match(out, /## 📄 文档 aaaaaa/);
  assert.match(out, /历史文档正文/);
});

test("Panel:兜底路径不误伤——文档引用不会被 expandBlockRefs 抢走", async () => {
  const { panel, calls } = makePanel({ [DOC_ID]: "当作块正文" }, { [DOC_ID]: "真正的文档正文" });
  const out = await panel.expandBlockRefs(`((${DOC_ID} '📄 文档 aaaaaa'))`);
  assert.equal(calls.block.length, 0, "文档锚必须由 expandDocRefs 处理");
  assert.equal(out, `((${DOC_ID} '📄 文档 aaaaaa'))`, "expandBlockRefs 应原样放过");
});

test("Panel:looksLikeRefId 挡住 ((a+b)) 这类伪引用，不发无谓请求", async () => {
  const { panel, calls } = makePanel();
  const out = await panel.expandBlockRefs("公式 ((a+b)) 不是引用");
  assert.equal(calls.block.length, 0);
  assert.match(out, /\(\(a\+b\)\)/, "普通文本应原样保留");
});

// ── LRU ────────────────────────────────────────────────────────────

test("Panel:文档正文缓存单独限 50 条（正文体积远大于块）", async () => {
  const { panel } = makePanel();
  for (let i = 0; i < 60; i++) {
    const id = `2026081312000${i}-docdoc0`;
    panel.registerRef({ kind: "doc", id, title: "📄 文档 x", body: "正文".repeat(10) });
  }
  let docs = 0;
  for (const att of panel.attachments.values()) {
    if (att.kind === "doc" && att.body) docs++;
  }
  assert.ok(docs <= 50, `文档正文缓存应 ≤50 条，实际 ${docs}`);
});

test("Panel:附件总数限 200 条", () => {
  const { panel } = makePanel();
  for (let i = 0; i < 260; i++) {
    panel.registerRef({ kind: "block", id: `2026081312000${i}-blkblk0`, title: "t" });
  }
  assert.ok(panel.attachments.size <= 200, `附件应 ≤200 条，实际 ${panel.attachments.size}`);
});
