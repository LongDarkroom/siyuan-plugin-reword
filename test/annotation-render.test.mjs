import test from "node:test";
import assert from "node:assert/strict";
import { renderWhalePanel, highlightInText, applyMarkColors, renderAnnotationHTML, renderAnnotationText } from "../src/annotation/whale-renderer.ts";
import { stripIal } from "../src/annotation/annotation-render.ts";

const mk = (over = {}) => ({
  id: "id-1",
  blockId: "blk-1",
  docId: "doc-1",
  sentence: "Hello world.",
  note: "my note",
  origin: "manual",
  createdAt: "2026-08-13T10:00:00.000Z",
  updatedAt: "2026-08-13T10:00:00.000Z",
  ...over,
});

test("空数组 → 显示空状态提示", () => {
  const html = renderWhalePanel([]);
  assert.match(html, /whale-empty/);
  assert.doesNotMatch(html, /whale-card/);
});

test("含条目 → 渲染笔记化条目并携带 data-*", () => {
  const html = renderWhalePanel([mk()]);
  assert.match(html, /class="whale-notes-item"/);
  assert.match(html, /data-id="id-1"/);
  assert.match(html, /data-block="blk-1"/);
});

test("用户文本经 HTML 白名单清洗，防止 XSS（script 被移除而非转义）", () => {
  const html = renderWhalePanel([
    mk({ sentence: "a <b>bold</b> & 'quote'", note: 'drop </div> <script>x</script>' }),
  ]);
  assert.doesNotMatch(html, /<b>bold<\/b>/, "句子中的标签应被转义，不应原样出现");
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>x<\/script>/, "note 中的脚本应被移除，不渲染");
  assert.doesNotMatch(html, /&lt;script&gt;/, "兜底清洗直接移除 script（非仅转义）");
  assert.match(html, /drop/, "脚本外的正常文本保留");
});

test("来源标记：手动无 AI 徽章，AI 有 AI 徽章", () => {
  const manualHtml = renderWhalePanel([mk({ origin: "manual" })]);
  assert.doesNotMatch(manualHtml, /whale-notes-origin/);
  const aiHtml = renderWhalePanel([mk({ origin: "ai" })]);
  assert.match(aiHtml, /whale-notes-origin--ai/);
  assert.match(aiHtml, />AI<\/span>/);
});

test("分类筛选：全部计数正确", () => {
  const html = renderWhalePanel([mk(), mk({ id: "b" }), mk({ id: "c" })]);
  assert.match(html, /全部/);
  assert.equal((html.match(/class="whale-notes-item"/g) || []).length, 3);
});

test("搜索关键词过滤", () => {
  const items = [mk({ id: "a", note: "apple" }), mk({ id: "b", note: "banana" })];
  const html = renderWhalePanel(items, "all", "apple");
  assert.match(html, /apple/);
  assert.doesNotMatch(html, /banana/);
});

test("sentence 框拼接 selectedText 时长度边界保护（2026-08-14 修复：selectedText 异常长度不追加）", () => {
  // 模拟用户测试时把 OpenAI 误填为 selectedText，sentence 极短的场景
  const item = mk({
    id: "edge-1",
    sentence: "ent.",
    selectedText: "OpenAI",
    note: "OpenAI 是一家 AI 公司",
  });
  const html = renderWhalePanel([item]);
  // selectedText 长度 6 > sentence 长度 4 * 0.5 = 2 → 不追加
  assert.doesNotMatch(html, /whale-card-sel[^>]*>OpenAI</, "selectedText 过长时不应被高亮追加");
  assert.match(html, /OpenAI 是一家 AI 公司/, "note 内容应正常显示");
});

test("原文板块：selectedText 非空时只显示选中词，不显示整句（2026-08-15 修复）", () => {
  const item = mk({
    id: "edge-2",
    sentence: "Plastic degradation affect too.",
    selectedText: "future",
    note: "",
  });
  const html = renderWhalePanel([item]);
  // 纯标注（note 空）：正文区即选中词 "future"，不显示整句
  assert.match(html, /whale-notes-text--bare/, "纯标注正文为 bare");
  assert.match(html, />future</, "正文显示选中词");
  assert.doesNotMatch(html, /Plastic degradation/, "不应显示整句 sentence");
});

test("纯标注（note 空）不渲染富文本区，正文显示选中词（2026-08-15/17：只上色不写文字，视觉清爽）", () => {
  const item = mk({ id: "empty-1", sentence: "Test sentence.", selectedText: "word", note: "" });
  const html = renderWhalePanel([item]);
  // 纯标注：正文区为 bare 选中词，无独立原文行/富文本批注区
  assert.match(html, /whale-notes-text--bare/, "纯标注正文为 bare 选中词");
  assert.match(html, />word</, "bare 正文显示选中词");
  assert.doesNotMatch(html, /whale-notes-source/, "纯标注无独立原文行（正文即选中词）");
  assert.doesNotMatch(html, /点击「编辑」添加你的理解与笔记/, "纯标注不应有占位文案");
});

test("note 非空时正常渲染批注正文区", () => {
  const item = mk({ id: "full-1", note: "我的批注" });
  const html = renderWhalePanel([item]);
  assert.match(html, /class="whale-notes-text b3-typography"/, "note 非空应渲染富文本正文区");
  assert.match(html, /我的批注/, "应显示批注内容");
  assert.match(html, /whale-notes-source/, "有 note 时显示原文行");
});

test("正文在原文行上方（2026-08-14：批注作为主内容区）", () => {
  const item = mk({ id: "order-1", note: "我的批注" });
  const html = renderWhalePanel([item]);
  const noteIdx = html.indexOf("whale-notes-text");
  const sourceIdx = html.indexOf("whale-notes-source");
  assert.ok(noteIdx > 0 && sourceIdx > 0, "正文和原文行都应存在");
  assert.ok(noteIdx < sourceIdx, "正文应在原文行上方");
});

// ===== 2026-08-15 回归：sentence 提取与高亮（修复「已选原文」错位 bug）=====

test("highlightInText: sentence 含 selectedText 时在原位高亮（修复坐标系错位）", () => {
  // 场景：sentence 是整句（含选中词），selectedText 是选中词
  const html = highlightInText("全文生词标注：扫描当前中 mastery 低的词", "mastery");
  assert.match(html, /扫描当前中 <mark class="whale-card-sel">mastery<\/mark> 低的词/,
    "selectedText 应在句子原位被高亮，而不是追加到末尾");
});

test("highlightInText: 大小写不敏感匹配", () => {
  const html = highlightInText("The research shows a clear trend.", "research");
  assert.match(html, /The <mark class="whale-card-sel">research<\/mark> shows a clear trend\./);
});

test("highlightInText: sentence 不含 selectedText 时追加（兼容旧数据），超长不追加", () => {
  // 旧数据：sentence 不含 selectedText → 追加（正常长度）
  const normal = highlightInText("Plastic degradation affect too.", "future");
  assert.match(normal, /affect too\.<mark class="whale-card-sel">future<\/mark>/);
  // 异常长 selectedText（sentence 过短）→ 不追加
  const tooLong = highlightInText("ent.", "OpenAI");
  assert.doesNotMatch(tooLong, /whale-card-sel/);
});

test("highlightInText: selectedText 为空时不渲染 mark，原样转义", () => {
  const html = highlightInText("Hello <world>", "");
  assert.equal(html, "Hello &lt;world&gt;");
  assert.doesNotMatch(html, /whale-card-sel/);
});

test("批注条目渲染: 原文行只显示选中词（2026-08-15 修复：不再显示整句）", () => {
  const item = mk({
    id: "reg-1",
    sentence: "扫描当前中 mastery 低的词",
    selectedText: "mastery",
    note: "mastery 熟练度",
  });
  const html = renderWhalePanel([item]);
  // 原文行只显示选中词 "mastery"，note 正常显示
  assert.match(html, /whale-notes-source[^>]*>原文：mastery<\/span>/, "原文行应只显示选中词 mastery");
  assert.doesNotMatch(html, /扫描当前中/, "不应显示整句 sentence");
  assert.match(html, /mastery 熟练度/, "note 内容应正常显示");
});

// ===== 2026-08-15：标签区收起/展开按钮 =====

test("标签区默认展开：渲染收起按钮 + 标签 chips 行", () => {
  const labels = [{ id: "L1", name: "科技", color: "#0d9e5f" }];
  const html = renderWhalePanel([mk()], "all", "", {}, labels, false);
  assert.match(html, /class="whale-panel-tabs-wrap /, "应有 wrap 容器");
  assert.doesNotMatch(html, /whale-panel-tabs-wrap--collapsed/, "默认不折叠");
  assert.match(html, /🏷️ 标签 ▾ 收起/, "按钮文字显示『收起』");
  assert.match(html, /id="whale-tags-collapse-btn"/, "应有 collapse 按钮");
  assert.match(html, /aria-expanded="true"/, "aria-expanded=true");
});

test("标签区收起：渲染展开按钮 + 标签 chips 行隐藏", () => {
  const labels = [{ id: "L1", name: "科技", color: "#0d9e5f" }];
  const html = renderWhalePanel([mk()], "all", "", {}, labels, true);
  assert.match(html, /whale-panel-tabs-wrap--collapsed/, "折叠态有 class");
  assert.match(html, /🏷️ 标签 ▸ 展开/, "按钮文字显示『展开』");
  assert.match(html, /aria-expanded="false"/, "aria-expanded=false");
});

// ===== 2026-08-15：3 维度 sort 筛选 =====

test("sort 按钮：默认时间模式 + 降序（按钮显示「时间↓」）", () => {
  const html = renderWhalePanel([mk(), mk()]);
  assert.match(html, /data-sort-action="time"/, "应有时间按钮");
  assert.match(html, /data-sort-action="doc"/, "应有文档按钮");
  assert.match(html, /data-sort-action="style"/, "应有样式按钮");
  // 默认 desc（最新在前）+ active
  assert.match(html, /class="whale-sort-btn active" data-sort-action="time"/, "时间默认 active");
  assert.match(html, /时间↓/, "默认降序箭头");
});

test("sort 按钮：时间升序（按钮显示「时间↑」）", () => {
  const html = renderWhalePanel([mk()], "all", "", {}, [], false, "time", "asc");
  assert.match(html, /时间↑/, "升序显示向上箭头");
});

test("sort 文档模式：渲染文档下拉（含全部 + 各文档按钮）", () => {
  const items = [
    mk({ id: "a1", docId: "d1" }),
    mk({ id: "a2", docId: "d1" }),
    mk({ id: "a3", docId: "d2" }),
  ];
  const html = renderWhalePanel(items, "all", "", {}, [], false, "doc", "desc", null, [], [
    { id: "d1", name: "笔记A", count: 2 },
    { id: "d2", name: "笔记B", count: 1 },
  ]);
  assert.match(html, /id="whale-doc-filter"/, "应有文档下拉容器");
  assert.match(html, /全部文档 \(3\)/, "全部文档按钮显示总数");
  assert.match(html, /笔记A \(2\)/, "笔记A 按钮显示计数 2");
  assert.match(html, /笔记B \(1\)/, "笔记B 按钮显示计数 1");
  assert.match(html, /class="whale-sort-btn active" data-sort-action="doc"/, "文档按钮 active");
});

test("sort 文档模式：选中某文档后只显示该文档批注", () => {
  const items = [
    mk({ id: "a1", docId: "d1", sentence: "d1 内容" }),
    mk({ id: "a2", docId: "d2", sentence: "d2 内容" }),
  ];
  const html = renderWhalePanel(items, "all", "", {}, [], false, "doc", "desc", "d1", [], [
    { id: "d1", name: "笔记A", count: 1 },
    { id: "d2", name: "笔记B", count: 1 },
  ]);
  assert.match(html, /d1 内容/, "d1 批注渲染");
  assert.doesNotMatch(html, /d2 内容/, "d2 批注不渲染");
});

test("sort 样式模式：渲染样式提示 + 文档模式不渲染下拉", () => {
  const html = renderWhalePanel([mk()], "all", "", {}, [], false, "style", "desc", null, [], []);
  assert.match(html, /id="whale-style-filter-hint"/, "样式模式应有提示行");
  assert.doesNotMatch(html, /id="whale-doc-filter"/, "样式模式不应有文档下拉");
});

test("sort 样式筛选：选中样式后只显示匹配批注", () => {
  const items = [
    mk({ id: "a1", color: "#facc15", style: "wavy" }),
    mk({ id: "a2", color: "#22c55e", style: "dotted" }),
  ];
  const html = renderWhalePanel(
    items, "all", "", {}, [], false, "style", "desc", null,
    ["#facc15|wavy"], // 只选 a1 的样式
    []
  );
  assert.match(html, /data-id="a1"/, "匹配样式 a1 渲染");
  assert.doesNotMatch(html, /data-id="a2"/, "不匹配样式 a2 不渲染");
});

test("sort 按钮文案：选中文档/样式后副标显示选中项", () => {
  // 文档选中后按钮显示「📄 文档 · 笔记A」
  const htmlDoc = renderWhalePanel([mk()], "all", "", {}, [], false, "doc", "desc", "d1", [], [
    { id: "d1", name: "笔记A", count: 1 },
  ]);
  assert.match(htmlDoc, /📄 文档 · 笔记A/, "文档按钮显示选中文档名");
  // 样式选中后按钮显示「🎨 样式 · 2 种」
  const htmlStyle = renderWhalePanel([mk()], "all", "", {}, [], false, "style", "desc", null, ["#facc15|wavy", "#22c55e|dotted"], []);
  assert.match(htmlStyle, /🎨 样式 · 2 种/, "样式按钮显示选中数");
});

// ===== 2026-08-15：面包屑 + 计数 + 重置按钮 =====

test("面包屑：无筛选时不渲染", () => {
  const html = renderWhalePanel([mk()]);
  assert.doesNotMatch(html, /whale-filter-breadcrumb/, "默认态无面包屑");
  assert.doesNotMatch(html, /whale-filter-reset/, "默认态无重置按钮");
});

test("面包屑：标签筛选时显示 #标签 chip", () => {
  const labels = [{ id: "L1", name: "科技", color: "#0d9e5f" }];
  const html = renderWhalePanel([mk({ labels: ["L1"] })], "L1", "", {}, labels, false);
  assert.match(html, /whale-filter-breadcrumb/, "应有面包屑");
  assert.match(html, /data-filter-clear="label"/, "标签 chip 带 label 维度");
  assert.match(html, /#科技/, "chip 显示标签名");
});

test("面包屑：搜索 + 文档 + 样式 + 时间升序同时显示多 chip", () => {
  const html = renderWhalePanel(
    [mk()], "all", "hello", {}, [], false,
    "style", "asc", "doc-1", ["#facc15|wavy"],
    [{ id: "doc-1", name: "笔记A", count: 1 }]
  );
  assert.match(html, /data-filter-clear="search"/, "搜索 chip");
  assert.match(html, /data-filter-clear="doc"/, "文档 chip");
  assert.match(html, /data-filter-clear="style"/, "样式 chip");
  assert.match(html, /data-filter-clear="time"/, "时间 chip");
  assert.match(html, /旧→新/, "时间升序 chip 文案");
});

test("计数：有筛选时带 active class 高亮", () => {
  const labels = [{ id: "L1", name: "科技", color: "#0d9e5f" }];
  const html = renderWhalePanel([mk({ labels: ["L1"] })], "L1", "", {}, labels, false);
  assert.match(html, /whale-panel-count--active/, "有筛选时计数高亮");
});

test("计数：无筛选时无 active class", () => {
  const html = renderWhalePanel([mk()]);
  assert.doesNotMatch(html, /whale-panel-count--active/, "无筛选时计数不高亮");
});

test("重置按钮：有筛选时显示", () => {
  const html = renderWhalePanel([mk()], "all", "kw", {}, [], false);
  assert.match(html, /id="whale-filter-reset"/, "有筛选时显示重置按钮");
  assert.match(html, /重置筛选/, "按钮文案「重置筛选」");
});

// ===== 2026-08-17：笔记化分组 + 彩色高亮 =====

test("分组切换按钮：头部渲染「时间/文档」且默认时间激活", () => {
  const html = renderWhalePanel([mk()]);
  assert.match(html, /data-group-action="time"/, "应有时间分组按钮");
  assert.match(html, /data-group-action="doc"/, "应有文档分组按钮");
  assert.match(html, /class="whale-group-btn active" data-group-action="time"/, "时间默认 active");
});

test("时间分组：渲染分组标题（今天/更早）与条目", () => {
  const now = new Date().toISOString();
  const html = renderWhalePanel([mk({ id: "t1", createdAt: now }), mk({ id: "t2", createdAt: "2026-08-01T10:00:00.000Z" })]);
  assert.match(html, /class="whale-notes-group"/, "应有分组标题");
  assert.match(html, />今天 /, "今天的批注归入「今天」组");
  assert.match(html, /data-id="t1"/, "今天组含 t1");
  assert.match(html, /data-id="t2"/, "更早批注仍渲染");
});

test("文档分组：按 docId 分组，组标题显示文档名", () => {
  const items = [mk({ id: "a1", docId: "d1" }), mk({ id: "a2", docId: "d1" }), mk({ id: "b1", docId: "d2" })];
  const html = renderWhalePanel(items, "all", "", {}, [], false, "time", "desc", null, [], [
    { id: "d1", name: "笔记A", count: 2 },
    { id: "d2", name: "笔记B", count: 1 },
  ], false, "doc");
  assert.match(html, /whale-notes-group/, "文档分组应有组标题");
  assert.match(html, />笔记A /, "d1 组标题为笔记A");
  assert.match(html, />笔记B /, "d2 组标题为笔记B");
});

test("applyMarkColors: data-color 注入内联背景色（绿色高亮原样显示）", () => {
  const html = applyMarkColors('<mark data-type="textmark" data-color="#63e0a3ff">绿</mark>');
  assert.match(html, /style="background-color:#63e0a3ff"/, "应注入内联背景色");
  assert.match(html, /data-color="#63e0a3ff"/, "data-color 保留");
});

test("applyMarkColors: 已有内联样式的 mark 不重复注入", () => {
  const html = applyMarkColors('<mark style="background-color:#ff0000" data-color="#ff0000">红</mark>');
  assert.equal((html.match(/style=/g) || []).length, 1, "不应重复注入 style");
});

test("renderWhalePanel: note 含彩色高亮 HTML 时经 sanitize+注入背景色", () => {
  const item = mk({ id: "c1", note: '<mark data-color="#63e0a3ff">绿色</mark> 批注', sentence: "s" });
  const html = renderWhalePanel([item]);
  assert.match(html, /<mark data-color="#63e0a3ff"[^>]*style="background-color:#63e0a3ff">绿色<\/mark>/, "彩色高亮原样渲染");
});

// ===== Stage 3（D1/D7）：批注正文渲染链路收口 =====

test("D1：含 <table> 的 note 经 renderAnnotationHTML 仍含 table 标签（白名单补全生效）", () => {
  const table = '<table><thead><tr><th>列A</th><th>列B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
  const html = renderAnnotationHTML(table);
  assert.match(html, /<table/, "表格标签应保留");
  assert.match(html, /<th>列A<\/th>/, "表头保留");
  assert.match(html, /<td>1<\/td>/, "单元格保留");
});

test("D7：renderMd 删除后 whale-renderer 仍可正常导入与渲染（无悬空引用）", () => {
  // renderMd 已从 whale-renderer 与 annotation-render 删除；本测试在 import 阶段即验证无悬空引用
  const html = renderAnnotationHTML("plain note");
  assert.match(html, /plain note/);
});

test("sentence 分支：原文中的 Markdown 标点不被解析（D7 保持原行为）", () => {
  const html = renderAnnotationText("a *b* c **d** e", "sentence");
  assert.doesNotMatch(html, /<em>/, "不应生成 <em>");
  assert.doesNotMatch(html, /<strong>/, "不应生成 <strong>");
  assert.match(html, /\*b\*/, "星号应原样保留");
  assert.match(html, /\*\*d\*\*/, "双星号应原样保留");
});

test("note 分支（无 Lute 兜底）：富文本 HTML 走 sanitizeHtml + applyMarkColors", () => {
  const html = renderAnnotationText('<mark data-color="#63e0a3ff">绿</mark> 批注', "note");
  assert.match(html, /<mark data-color="#63e0a3ff"[^>]*style="background-color:#63e0a3ff">绿<\/mark>/, "彩色高亮原样渲染（兜底路径）");
});

// ===== 2026-08-18：裸 IAL 剥离（用户反馈：浮层/面板出现 {.: id="…" updated="…"} 属性码）=====

test("stripIal：去除裸 kramdown 属性码 {.: id=… updated=…}", () => {
  const raw = '{.: id="20260818160219-zvoegv1" updated="20260818160219"}Another technological advance';
  assert.equal(stripIal(raw), "Another technological advance");
});

test("stripIal：去除 {: …} / {.class} / {#id} 各类 IAL", () => {
  assert.equal(stripIal('text {: #foo}'), "text ");
  assert.equal(stripIal('text {.warning}'), "text ");
  assert.equal(stripIal('{#bar}text'), "text");
  assert.equal(stripIal('{: .cls #id}'), "");
});

test("stripIal：保留块引用 ((id)) 与普通花括号 {x}", () => {
  assert.equal(stripIal("见 ((20260818-xyz)) 块"), "见 ((20260818-xyz)) 块", "块引用双圆括号不动");
  assert.equal(stripIal("集合 {x} 中"), "集合 {x} 中", "非 IAL 的 {x} 不动");
});

test("stripIal：空值/无 IAL 原样返回", () => {
  assert.equal(stripIal(""), "");
  assert.equal(stripIal("普通批注文字"), "普通批注文字");
});

test("renderAnnotationText note 分支：裸 IAL 经兜底路径被剥离（2026-08-18 修复）", () => {
  const html = renderAnnotationText('{: id="x"}我的批注内容', "note");
  assert.doesNotMatch(html, /\{[:.]/, "不应残留 IAL 花括号");
  assert.match(html, /我的批注内容/, "真实批注内容保留");
});

test("renderAnnotationText sentence 分支：裸 IAL 被剥离（2026-08-18 修复）", () => {
  const html = renderAnnotationText('{: id="y"}The quick brown fox', "sentence");
  assert.doesNotMatch(html, /\{[:.]/, "不应残留 IAL 花括号");
  assert.match(html, /The quick brown fox/, "原文保留");
});

test("renderWhalePanel：note 含裸 IAL 时面板不显示属性码（2026-08-18 修复）", () => {
  const item = mk({
    id: "ial-1",
    note: '{.: id="20260818160219-zvoegv1" updated="20260818160219"}Another technological advance which is still in the experimental stage',
    sentence: "Another technological advance which is still in the experimental stage",
    selectedText: "Another",
  });
  const html = renderWhalePanel([item]);
  assert.doesNotMatch(html, /\{[:.]/, "面板 HTML 不应含裸 IAL");
  assert.match(html, /Another technological advance/, "真实批注/note 内容保留显示");
});

// ===== 2026-08-19：侧栏表格 fallback 渲染补完 =====

test("renderAnnotationText note 分支（有 Lute）：Markdown 表格渲染前开启 SetGFMTable", () => {
  const calls = [];
  const fakeLute = {
    SetGFMTable(v) { calls.push(["SetGFMTable", v]); },
    SetGFMStrikethrough(v) { calls.push(["SetGFMStrikethrough", v]); },
    SetKramdownIAL(v) { calls.push(["SetKramdownIAL", v]); },
    SetBlockRef(v) { calls.push(["SetBlockRef", v]); },
    SetMark(v) { calls.push(["SetMark", v]); },
    SetTag(v) { calls.push(["SetTag", v]); },
    SetSup(v) { calls.push(["SetSup", v]); },
    SetSub(v) { calls.push(["SetSub", v]); },
    SetSuperBlock(v) { calls.push(["SetSuperBlock", v]); },
    SetCallout(v) { calls.push(["SetCallout", v]); },
    Md2HTML(md) { return `<table class="fake-table">${md.replace(/\|/g, "|")}</table>`; },
    HTML2Md(h) { return h; },
  };
  const prev = globalThis.window;
  globalThis.window = { siyuan: { lute: fakeLute } };
  try {
    const html = renderAnnotationText("| A | B |\n|---|---|\n| 1 | 2 |", "note");
    assert.ok(calls.some(([n, v]) => n === "SetGFMTable" && v === true), "渲染前应调用 SetGFMTable(true)");
    assert.match(html, /<table/, "应输出表格 HTML");
  } finally {
    globalThis.window = prev;
  }
});

