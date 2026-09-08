// 2026-09-08 回归测试：标题块范围收集的「文档树序」修复
//
// 背景 bug：旧实现对同文档所有块 `ORDER BY sort ASC, id ASC`，
// 但思源 sort 只是同父级兄弟序，跨父级排序会打乱文档顺序，
// 导致选中「AI精读」标题后，向后收集把上方「词库/查单词」的内容也扫进来。
//
// 本测试用一棵嵌套文档树，验证：
//   ① orderBlocksByTree 得到的是真实视觉顺序（不是全局 sort 顺序）；
//   ② 选中 H4「AI精读」只收到它自己 + 下属 4 条，绝不卷进上方内容。

import { test } from "node:test";
import assert from "node:assert/strict";
import { orderBlocksByTree, collectHeadingRange, headingLevelOf } from "../src/ai/block-range.ts";

const ROOT = "20260908-root0000-aaaaaa";

// 文档结构（id 末 6 位即可读标签）：
//  root
//   ├─ 词库   (h2, sort0)
//   │   ├─ 标签体系 (l, sort0)
//   │   ├─ 二级分级 (l, sort1)
//   │   └─ 导入功能 (l, sort2)
//   ├─ 查单词 (h2, sort1)
//   │   └─ 单词小窗 (p, sort0)
//   └─ AI精读 (h4, sort2)
//       ├─ bullet1 (p, sort0) 无法正常使用
//       ├─ bullet2 (p, sort1) 需要优化 UI
//       ├─ bullet3 (p, sort2) 输入框中
//       └─ bullet4 (p, sort3) 优化输出框菜单
const rows = [
  { id: ROOT, parent_id: null, type: "d", subtype: "d", sort: 0, markdown: "", content: "" },
  { id: "b-ciliao", parent_id: ROOT, type: "h", subtype: "h2", sort: 0, markdown: "## 词库", content: "词库" },
  { id: "b-biaoqian", parent_id: "b-ciliao", type: "l", subtype: "", sort: 0, markdown: "标签体系", content: "标签体系" },
  { id: "b-erji", parent_id: "b-ciliao", type: "l", subtype: "", sort: 1, markdown: "二级分级", content: "二级分级" },
  { id: "b-daoru", parent_id: "b-ciliao", type: "l", subtype: "", sort: 2, markdown: "导入功能", content: "导入功能" },
  { id: "b-chazidan", parent_id: ROOT, type: "h", subtype: "h2", sort: 1, markdown: "## 查单词", content: "查单词" },
  { id: "b-danci", parent_id: "b-chazidan", type: "p", subtype: "", sort: 0, markdown: "单词小窗", content: "单词小窗" },
  { id: "b-aijingdu", parent_id: ROOT, type: "h", subtype: "h4", sort: 2, markdown: "#### AI精读", content: "AI精读" },
  { id: "b-j1", parent_id: "b-aijingdu", type: "p", subtype: "", sort: 0, markdown: "无法正常使用", content: "无法正常使用" },
  { id: "b-j2", parent_id: "b-aijingdu", type: "p", subtype: "", sort: 1, markdown: "需要优化 UI", content: "需要优化 UI" },
  { id: "b-j3", parent_id: "b-aijingdu", type: "p", subtype: "", sort: 2, markdown: "输入框中", content: "输入框中" },
  { id: "b-j4", parent_id: "b-aijingdu", type: "p", subtype: "", sort: 3, markdown: "优化输出框菜单", content: "优化输出框菜单" },
];

test("orderBlocksByTree：嵌套文档得到真实视觉顺序（非全局 sort 顺序）", () => {
  const ordered = orderBlocksByTree(rows, ROOT);
  // 文档根块(d)不进结果；其余按树序
  const ids = ordered.map((r) => r.id);
  assert.deepEqual(ids, [
    "b-ciliao", "b-biaoqian", "b-erji", "b-daoru",
    "b-chazidan", "b-danci",
    "b-aijingdu", "b-j1", "b-j2", "b-j3", "b-j4",
  ], "树序必须等于真实视觉顺序：词库→其下属→查单词→其下属→AI精读→其下属");
});

test("collectHeadingRange：选中 H4「AI精读」只收自身+下属 4 条，绝不卷进上方内容", () => {
  const ordered = orderBlocksByTree(rows, ROOT);
  const text = collectHeadingRange(ordered, "b-aijingdu", headingLevelOf("h4"), 8000);
  assert.ok(text, "应有范围正文");
  assert.match(text, /AI精读/, "标题自身应在内");
  assert.match(text, /无法正常使用/, "下属 bullet1 应在内");
  assert.match(text, /优化输出框菜单/, "下属 bullet4 应在内");
  // 关键断言：上方「词库 / 查单词」的内容不得出现在结果里（这正是原 bug 的表现）
  assert.ok(!text.includes("标签体系"), "不得包含上方「词库」下属内容");
  assert.ok(!text.includes("单词小窗"), "不得包含上方「查单词」下属内容");
  assert.ok(!text.includes("二级分级"), "不得包含上方「词库」下属内容");
});

test("collectHeadingRange：遇同级标题停止（H2 收集到下一个 H2 前）", () => {
  const ordered = orderBlocksByTree(rows, ROOT);
  const text = collectHeadingRange(ordered, "b-ciliao", headingLevelOf("h2"), 8000);
  assert.match(text, /词库/, "标题自身");
  assert.match(text, /标签体系/, "下属内容");
  assert.ok(!text.includes("查单词"), "遇下一个同级 H2(查单词)必须停止，不得收其下属");
  assert.ok(!text.includes("AI精读"), "更后面的同级 H4 也不得收");
});

test("collectHeadingRange：更低级子标题继续（H2 收集会捎带其后的 H4 子标题段）", () => {
  const ordered = orderBlocksByTree(rows, ROOT);
  // 选中「查单词」(h2)，其后紧邻的「AI精读」(h4) 是更低级标题，按规则应继续收集
  const t = collectHeadingRange(ordered, "b-chazidan", headingLevelOf("h2"), 8000);
  assert.match(t, /查单词/, "标题自身");
  assert.match(t, /单词小窗/, "下属段落收集");
  assert.match(t, /AI精读/, "其后更低级 H4 子标题应被继续收集（更低级继续规则）");
  assert.match(t, /优化输出框菜单/, "H4 段的下属也应收集到");
});
