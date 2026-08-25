/**
 * AI 精读面板 chevron 一键收展 单测（2026-08-22 新增）
 * plan §4 + §测试文件 3
 * 由于 AI 面板初始化逻辑深度耦合 DOM/window 对象,不在测试环境跑,
 * 这里用源码扫描方式验证：
 *  - 模板里有 #hiword-ai-resizer-toggle 按钮
 *  - 源码有 localStorage["reword-ai-footer-collapsed"] 读写
 *  - chevron 切到 ▴/▾ 文本切换
 *  - applyCollapsedState 写在 ai-panel.ts 内(原 binding 在 onLayout 块)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("AI 精读面板模板：含 chevron 按钮 #hiword-ai-resizer-toggle", async () => {
  const src = await readFile("src/ai/ai-panel.ts", "utf8");
  // 模板：resizer 内部包含 toggle button(plan §4.1)
  assert.match(
    src,
    /id="hiword-ai-resizer"[\s\S]*?id="hiword-ai-resizer-toggle"[\s\S]*?>▾</,
    "模板应在 resizer 内放置 toggle 按钮,默认 ▾"
  );
  assert.match(
    src,
    /id="hiword-ai-resizer-toggle"[^>]*aria-label="收起输入区"/,
    "应设默认 aria-label「收起输入区」"
  );
});

test("AI 精读面板：chevron 收展状态持久化(读 reword-ai-footer-collapsed)", async () => {
  const src = await readFile("src/ai/ai-panel.ts", "utf8");
  assert.match(
    src,
    /localStorage\.getItem\(COLLAPSE_KEY\)/,
    "应从 COLLAPSE_KEY 读取收起态"
  );
  assert.match(
    src,
    /localStorage\.setItem\(COLLAPSE_KEY/,
    "应把收起态写回 localStorage"
  );
  // 关键 key 名
  assert.match(
    src,
    /reword-ai-footer-collapsed/,
    "key 应为 reword-ai-footer-collapsed"
  );
});

test("AI 精读面板：chevron 收起/展开文本切换(▴/▾)", async () => {
  const src = await readFile("src/ai/ai-panel.ts", "utf8");
  // 找到 applyCollapsedState 函数体
  const fnMatch = src.match(/const applyCollapsedState[\s\S]*?\n    \};/);
  assert.ok(fnMatch, "应能找到 applyCollapsedState 函数");
  assert.match(fnMatch[0], /▴/, "收起态应切到 ▴");
  assert.match(fnMatch[0], /▾/, "展开态应切到 ▾");
  assert.match(fnMatch[0], /hiword-ai-panel--collapsed/, "应切换 --collapsed class");
  assert.match(fnMatch[0], /aria-label/, "应切换 aria-label");
});

test("AI 精读面板：拖拽结束 onResizeEnd 在收起态不写 height(避免 0 覆盖)", async () => {
  const src = await readFile("src/ai/ai-panel.ts", "utf8");
  // onResizeEnd 函数体
  const fnMatch = src.match(/const onResizeEnd = \(\) => \{[\s\S]*?\n    \};/);
  assert.ok(fnMatch, "应能找到 onResizeEnd 函数");
  assert.match(
    fnMatch[0],
    /if\s*\(\s*!isCollapsed\s*\)[\s\S]*?localStorage\.setItem\(FOOTER_H_KEY/,
    "拖拽结束应在非收起态才写 FOOTER_H_KEY"
  );
});

test("AI 精读面板：chevron 点击 stopPropagation 不触发 resizer 拖拽", async () => {
  const src = await readFile("src/ai/ai-panel.ts", "utf8");
  // toggleBtn click 监听
  assert.match(
    src,
    /toggleBtn\?\.addEventListener\("click"[\s\S]*?e\.stopPropagation/,
    "toggleBtn click 应 e.stopPropagation,避免触发 resizer 的 pointerdown"
  );
});
