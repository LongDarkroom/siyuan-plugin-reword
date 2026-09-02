// 2026-09-02 B 组：AI 引用附件契约层测试
// 直接 import 生产源码 src/ai/ai-refs.ts（非镜像副本），锁定 B 组的核心不变式：
//   1. 占位符只是 ID 指针，不做任何语法还原（旧链路要还原成 ((id 'anchor')) 再正则匹配）
//   2. 三种引用形态（占位符 / kramdown / 残留 HTML）统一为 RefMarker，按位置升序且互不重叠
//   3. 文档引用靠锚前缀「📄 文档 」识别，短码取 id 去连字符后 6 位
//   4. 体积上限：块单块 8000、块总量 8000、文档总量 12000

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  refPlaceholderOf,
  shortRefId,
  docAnchorOf,
  docHeaderOf,
  docUnavailableNotice,
  isDocAnchor,
  looksLikeRefId,
  htmlRefAnchorToText,
  scanRefPlaceholders,
  scanRefMarkers,
  applyRefEdits,
  blockRefBodyText,
  DOC_ANCHOR_PREFIX,
  MAX_BLOCK_BODY,
  MAX_BLOCK_TOTAL,
  MAX_DOC_TOTAL,
} from "../src/ai/ai-refs.ts";

const BLOCK_ID = "20260813120000-zzzzzz";
const DOC_ID = "20260813120000-aaaaaa";

// ── 1. 基础构造 ────────────────────────────────────────────────────

test("Refs:refPlaceholderOf 生成 @@REWORD_REF_<id>@@", () => {
  assert.equal(refPlaceholderOf(BLOCK_ID), `@@REWORD_REF_${BLOCK_ID}@@`);
});

test("Refs:shortRefId 去掉连字符取末 6 位", () => {
  assert.equal(shortRefId(DOC_ID), "aaaaaa");
  assert.equal(shortRefId("20260813120000-xy12ab"), "xy12ab");
  assert.equal(shortRefId(""), "");
});

test("Refs:docAnchorOf = 「📄 文档 」+ 6 位短码", () => {
  assert.equal(docAnchorOf(DOC_ID), "📄 文档 aaaaaa");
  assert.equal(docAnchorOf(DOC_ID), DOC_ANCHOR_PREFIX + "aaaaaa");
});

test("Refs:docHeaderOf 输出 Markdown 二级标题（前后各一空行）", () => {
  assert.equal(docHeaderOf(DOC_ID), "\n\n## 📄 文档 aaaaaa\n\n");
});

test("Refs:isDocAnchor 只认「📄 文档 」前缀，绝不误判普通块锚", () => {
  assert.equal(isDocAnchor("📄 文档 aaaaaa"), true);
  assert.equal(isDocAnchor("hello world"), false);
  assert.equal(isDocAnchor(""), false);
  assert.equal(isDocAnchor(undefined), false);
  assert.equal(isDocAnchor(null), false);
});

test("Refs:docUnavailableNotice 带短码且含降级说明", () => {
  const notice = docUnavailableNotice(DOC_ID);
  assert.match(notice, /文档 aaaaaa 内容暂不可用/);
  assert.match(notice, /重新拖入或粘贴正文/);
});

test("Refs:looksLikeRefId 挡住数学式等伪引用（兜底正则 ((...)) 会误命中）", () => {
  assert.equal(looksLikeRefId(BLOCK_ID), true);
  assert.equal(looksLikeRefId(DOC_ID), true);
  assert.equal(looksLikeRefId("a+b"), false);
  assert.equal(looksLikeRefId("2026"), false);
  assert.equal(looksLikeRefId(""), false);
  assert.equal(looksLikeRefId(undefined), false);
});

test("Refs:htmlRefAnchorToText 去标签、换行转空格、去首尾空白", () => {
  assert.equal(htmlRefAnchorToText("<em>hello</em>\nworld "), "hello world");
  assert.equal(htmlRefAnchorToText(undefined), "");
});

// ── 2. 占位符扫描（B 组主路径）────────────────────────────────────

test("Refs:scanRefPlaceholders 定位占位符的起止区间", () => {
  const text = `前缀 ${refPlaceholderOf(BLOCK_ID)} 后缀`;
  const marks = scanRefPlaceholders(text);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].id, BLOCK_ID);
  assert.equal(text.slice(marks[0].from, marks[0].to), refPlaceholderOf(BLOCK_ID));
});

test("Refs:scanRefPlaceholders 同一 id 重复出现会被逐个登记", () => {
  const text = `${refPlaceholderOf(BLOCK_ID)}+${refPlaceholderOf(BLOCK_ID)}`;
  assert.equal(scanRefPlaceholders(text).length, 2);
});

test("Refs:scanRefPlaceholders 忽略短 id / 无占位符 / 空串", () => {
  assert.equal(scanRefPlaceholders("@@REWORD_REF_abc@@").length, 0);
  assert.equal(scanRefPlaceholders("普通 markdown 内容").length, 0);
  assert.equal(scanRefPlaceholders("").length, 0);
});

test("Refs:列表块占位符不被任何语法字符截断（旧链路的 P0 bug）", () => {
  // 旧链路把占位符还原成 ((id '27. 泄漏文本…')) 时会被 Lute 二次解析截断；
  // B 组占位符原样穿过序列化，扫描器必须完整识别含点号/花括号的 id 上下文
  const text = `27. ${refPlaceholderOf(BLOCK_ID)} {style}`;
  const marks = scanRefPlaceholders(text);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].id, BLOCK_ID);
});

// ── 3. 三形态统一扫描 ──────────────────────────────────────────────

test("Refs:scanRefMarkers 同时识别占位符与 ((id 'anchor'))", () => {
  const text = `${refPlaceholderOf(BLOCK_ID)} 与 ((${DOC_ID} '📄 文档 aaaaaa'))`;
  const marks = scanRefMarkers(text);
  assert.equal(marks.length, 2);
  assert.equal(marks[0].form, "placeholder");
  assert.equal(marks[1].form, "kramdown");
  assert.equal(marks[1].anchor, "📄 文档 aaaaaa");
});

test("Refs:scanRefMarkers 兼容缺闭合单引号的泄漏形态 ((id 'anchor))", () => {
  const marks = scanRefMarkers(`((${BLOCK_ID} 'anchor))`);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].id, BLOCK_ID);
  assert.equal(marks[0].anchor, "anchor");
});

test("Refs:scanRefMarkers 识别残留 <span data-type=block-ref> 并抽纯文本锚", () => {
  const html = `<span data-type="block-ref" data-id="${BLOCK_ID}" data-subtype="s">hello</span>`;
  const marks = scanRefMarkers(html);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].form, "html");
  assert.equal(marks[0].id, BLOCK_ID);
  assert.equal(marks[0].anchor, "hello");
});

test("Refs:scanRefMarkers 结果按位置升序且互不重叠", () => {
  const text =
    `<span data-type="block-ref" data-id="${BLOCK_ID}">a</span>` +
    ` 中间 ${refPlaceholderOf(DOC_ID)} 尾部 ((${BLOCK_ID} 'x'))`;
  const marks = scanRefMarkers(text);
  assert.ok(marks.length >= 2);
  for (let i = 1; i < marks.length; i++) {
    assert.ok(marks[i].from >= marks[i - 1].to, "相邻标记不得重叠");
  }
});

test("Refs:scanRefMarkers 空串 / 无引用 → 空数组", () => {
  assert.deepEqual(scanRefMarkers(""), []);
  assert.deepEqual(scanRefMarkers("纯文本内容,没有引用"), []);
});

// ── 4. 替换应用 ────────────────────────────────────────────────────

test("Refs:applyRefEdits 按区间替换（输入乱序也会排序）", () => {
  const text = "AB";
  const out = applyRefEdits(text, [
    { from: 1, to: 2, text: "Y" },
    { from: 0, to: 1, text: "X" },
  ]);
  assert.equal(out, "XY");
});

test("Refs:applyRefEdits 跳过重叠区间，避免重复插入", () => {
  const out = applyRefEdits("ABCD", [
    { from: 0, to: 3, text: "X" },
    { from: 1, to: 2, text: "Y" },
  ]);
  assert.equal(out, "XD");
});

test("Refs:applyRefEdits 压缩连续空行并 trim", () => {
  const text = refPlaceholderOf(BLOCK_ID);
  const out = applyRefEdits(text, [{ from: 0, to: text.length, text: "\n\nbody\n\n" }]);
  assert.equal(out, "body");
});

test("Refs:applyRefEdits 无 edit 时原样返回", () => {
  assert.equal(applyRefEdits("原文", []), "原文");
});

// ── 5. 块正文包装与体积上限 ────────────────────────────────────────

test("Refs:blockRefBodyText 正文可用 → 前后各包一个空行", () => {
  assert.equal(blockRefBodyText("hello"), "\n\nhello\n\n");
});

test("Refs:blockRefBodyText 正文超限（>8000）→ 退化为锚文本", () => {
  const huge = "x".repeat(MAX_BLOCK_BODY + 1);
  assert.equal(blockRefBodyText(huge, "锚"), "\n\n锚\n\n");
});

test("Refs:blockRefBodyText 正文缺失 → 退化为锚文本；无锚则移除引用", () => {
  assert.equal(blockRefBodyText("", "锚"), "\n\n锚\n\n");
  assert.equal(blockRefBodyText(undefined, "锚"), "\n\n锚\n\n");
  assert.equal(blockRefBodyText("", ""), "");
});

// ── 6. 常量契约（改动需同步评估上下文爆炸风险）────────────────────

test("Refs:体积上限常量保持旧实测值", () => {
  assert.equal(MAX_BLOCK_BODY, 8000);
  assert.equal(MAX_BLOCK_TOTAL, 8000);
  assert.equal(MAX_DOC_TOTAL, 12000);
});

// ── 7. 端到端：占位符 → 扫描 → 替换（B 组单步展开的形状）─────────

test("Refs:端到端 占位符 → 查表替换（块）", () => {
  const text = `请解释：${refPlaceholderOf(BLOCK_ID)}`;
  const marks = scanRefPlaceholders(text);
  const edits = marks.map((m) => ({ from: m.from, to: m.to, text: blockRefBodyText("block body") }));
  // 正文前后各留一个空行（仅 2 个换行，不会被 \n{4,} 折叠），末尾 trim
  assert.equal(applyRefEdits(text, edits), "请解释：\n\nblock body");
});

test("Refs:端到端 占位符 → 查表替换（文档，含 ## 标题）", () => {
  const text = refPlaceholderOf(DOC_ID);
  const marks = scanRefPlaceholders(text);
  const edits = marks.map((m) => ({ from: m.from, to: m.to, text: docHeaderOf(m.id) + "doc body" }));
  assert.equal(applyRefEdits(text, edits), "## 📄 文档 aaaaaa\n\ndoc body");
});
