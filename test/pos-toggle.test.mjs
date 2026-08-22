import { test } from "node:test";
import assert from "node:assert/strict";
import { togglePosCollapsed } from "../src/dict/pos-toggle.ts";
import { renderVocabDetailSenses } from "../src/dict/dict-renderer.ts";

// 模拟一段 NCECD（新世纪英汉大词典）原始释义：n. / adj. 两个词性分区
const SAMPLE_DEF = `
<span class="class">n.</span>
<div class="sense"><b class="num">1</b><span class="zh">顺从的；听话的</span></div>
<div class="sense"><b class="num">2</b><span class="zh">温顺的；容易驯服的</span></div>
<span class="class">adj.</span>
<div class="sense"><b class="num">1</b><span class="zh">顺从的；服从的</span></div>
`;

/**
 * 最小 DOM 桩：只实现 togglePosCollapsed 依赖的 classList 行为，
 * 不依赖 jsdom，验证「折叠状态 ↔ open 高亮」的切换逻辑。
 */
class ClassList {
  constructor(initial = []) {
    this._s = new Set(initial);
  }
  add(...cs) { cs.forEach((c) => this._s.add(c)); }
  remove(...cs) { cs.forEach((c) => this._s.delete(c)); }
  contains(c) { return this._s.has(c); }
  toggle(c, force) {
    if (force === undefined) {
      if (this._s.has(c)) { this._s.delete(c); return false; }
      this._s.add(c); return true;
    }
    if (force) { this._s.add(c); return true; }
    this._s.delete(c); return false;
  }
}

class FakeEl {
  constructor() {
    this.classList = new ClassList();
    this._chip = null;
  }
  // 仅在查询词性框时返回一个带 classList 的桩元素
  querySelector(sel) {
    if (sel.includes("hiword-vb-pos-toggle")) {
      if (!this._chip) {
        this._chip = new FakeEl();
        this._chip.classList = new ClassList(["hiword-vb-pos-toggle", "hiword-vb-pos-open"]);
      }
      return this._chip;
    }
    return null;
  }
}

test("togglePosCollapsed: 首次点击收起，并移除 open 高亮", () => {
  const block = new FakeEl();
  block.classList.add("hiword-vb-pos-block");

  const r1 = togglePosCollapsed(block);

  assert.equal(r1, true, "首次应返回已收起 true");
  assert.ok(block.classList.contains("hiword-vb-pos-collapsed"), "block 应被加上 collapsed 类");
  assert.ok(!block._chip.classList.contains("hiword-vb-pos-open"), "收起后 open 高亮应移除");
});

test("togglePosCollapsed: 再次点击展开，恢复 open 高亮", () => {
  const block = new FakeEl();
  block.classList.add("hiword-vb-pos-block");
  const r1 = togglePosCollapsed(block);
  assert.equal(r1, true);

  const r2 = togglePosCollapsed(block);

  assert.equal(r2, false, "再次点击应返回已展开 false");
  assert.ok(!block.classList.contains("hiword-vb-pos-collapsed"), "block 应移除 collapsed 类");
  assert.ok(block._chip.classList.contains("hiword-vb-pos-open"), "展开后 open 高亮应恢复");
});

test("togglePosCollapsed: 无词性框时仅切换 block 状态且不报错", () => {
  const block = new FakeEl();
  block.classList.add("hiword-vb-pos-block");
  // 让 querySelector 永远返回 null（模拟找不到 chip）
  block.querySelector = () => null;

  const r1 = togglePosCollapsed(block);
  assert.equal(r1, true);
  assert.ok(block.classList.contains("hiword-vb-pos-collapsed"));
});

test("renderVocabDetailSenses: 详情页按词性渲染出可点击的词性框", () => {
  const html = renderVocabDetailSenses(SAMPLE_DEF);

  assert.ok(html.includes('class="hiword-vb-detail-posgroups"'), "应包裹在分组容器中");
  // 关键断言：必须渲染出带 data-action=toggle-pos 的可点击词性框（修复前详情页只有不可点的 .hiword-dict-sense-pos 标签）
  assert.ok(html.includes('data-action="toggle-pos"'), "应渲染出可点击的词性框（data-action=toggle-pos）");
  assert.ok(html.includes('class="hiword-vb-pos-block"'), "应存在词性区块容器");
  assert.ok(html.includes('class="hiword-vb-pos-body"'), "应存在可折叠的内容区");

  const toggleCount = (html.match(/data-action="toggle-pos"/g) || []).length;
  const blockCount = (html.match(/class="hiword-vb-pos-block"/g) || []).length;
  assert.ok(toggleCount >= 2, "至少应有两个词性（n./adj.）的可点击框，实际: " + toggleCount);
  assert.equal(toggleCount, blockCount, "每个词性区块都应对应一个可点击词性框");
});

test("renderVocabDetailSenses: 默认全部展开（不带 collapsed 类）", () => {
  const html = renderVocabDetailSenses(SAMPLE_DEF);
  assert.ok(!html.includes("hiword-vb-pos-collapsed"), "默认不应有 collapsed 类，保证一眼看全");
  assert.ok(html.includes("hiword-vb-pos-open"), "默认应带 open 高亮");
});
