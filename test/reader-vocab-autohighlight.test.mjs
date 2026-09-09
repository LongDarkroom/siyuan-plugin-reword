// 词库面板"自动高亮词库单词"开关集成测试 —— 2026-09-04 功能下线后的清理版
// ----------------------------------------------------------------
// 【重要】原「文档内自动高亮词库单词」功能已整体下线（2026-09-04），src 侧证据：
//   - src/index.less:2112-2115：.hiword-vb-autohighlight-row /
//     .hiword-vb-autohighlight-label / .hiword-vb-switch / .hiword-vb-switch-graph
//     等样式全部删除（源文件与 v1.6.1 部署版 index.css 同步清理）
//   - src/index.ts:443-446：vocabAutoHighlight 仅保留 false 占位字段，
//     loadVocabAutoHighlight 恒返回 false
//   - src/index.ts:3531：面板模板中该开关已移除，仅留移除说明注释
//   - src/index.ts:3571：开关 change 事件监听已移除
//   - src/index.ts:4272：setVocabAutoHighlight 退化为 no-op
//   - 全仓已无 localStorage["hiword-vocab-autohighlight"] 读写
// 因此原始 15 条断言（4 个 CSS 类 / 面板渲染 / change 绑定 / localStorage
// 读写 / switch 视觉细节）全部删除——断言目标对象已不存在。
// 其中 2 条此前是「假通过」，一并删除：
//   - "不依赖 b3-switch 等外部类"：:checked 规则清零后循环空转，恒真
//   - "渲染开关文本「文档内自动高亮词库单词」"：只匹配到 index.ts:3531 的移除注释
// 仅保留 1 条仍然成立的断言：hl.start() 后紧跟 hl.setEnabled(vocabAutoHighlight)
// （index.ts:989 / 11650，高亮器启动后同步开关态的残留接线，功能下线后仍在）。
// 不依赖：foliate / siyuan SDK
// 测试方式：grep 源码（避免 parse 整个 Svelte 编译产物）

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const indexTsPath = join(__dirname, "..", "src", "index.ts");

const ts = readFileSync(indexTsPath, "utf-8");

test("index.ts 在 hl.start(wysiwyg) 后立即调 hl.setEnabled(vocabAutoHighlight)", () => {
  // 验证两处（onload + onSwitchProtyle）
  const re = /hl\.start\s*\(\s*wysiwyg\s*\)\s*;[\s\S]{0,200}?hl\.setEnabled\s*\(\s*this\.vocabAutoHighlight\s*\)/g;
  const matches = [...ts.matchAll(re)];
  assert.ok(matches.length >= 2, `should have ≥2 start+setEnabled sequences (onload + onSwitchProtyle), got ${matches.length}`);
});
