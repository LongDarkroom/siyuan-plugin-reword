// 阅读器 - 设置 placeholder 编码测试（2026-08-24 新增）
// ----------------------------------------------------------------
// 用户反馈：点击设置按钮后弹窗没有显示。
// 根因：placeholder="可用变量：{{bookTitle}}..." 里的 {{xxx}} 被 Svelte parser
// 解析为 mustache 表达式，但 bookTitle 等变量未定义 → 编译期 warning 触发，
// Svelte 静默剔除该段模板 → reader-settings 内容丢失。
//
// 修复：把 placeholder 里的 {{xxx}} 用 HTML 实体 &#123;&#123; 编码，避免
// 被 Svelte 误识别为 mustache 表达式。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewPath = join(__dirname, "..", "src/reader/ReaderView.svelte");
const viewSrc = readFileSync(viewPath, "utf-8");

test("placeholder 字符串不含未编码的 {{xxx}}（避免 Svelte mustache 误识别）", () => {
  // 找所有 placeholder="..." 字符串
  const placeholders = viewSrc.match(/placeholder="[^"]*"/g) ?? [];
  assert.ok(placeholders.length >= 1, "ReaderView 应有至少 1 个 placeholder");
  for (const p of placeholders) {
    // 占位符里不能含 {{xxx}} 这种 Svelte mustache 模式（会触发编译期未定义变量警告）
    // 允许 &#123;&#123; 编码形式（不匹配下面的正则）
    assert.doesNotMatch(
      p,
      /\{\{\w+\}\}/,
      `placeholder 含未编码的 mustache 表达式：${p}（用 &#123;&#123; 编码）`
    );
  }
});

test("linkFormat textarea 的 placeholder 已用 HTML 实体编码变量", () => {
  // 提取 linkFormat 周围的 placeholder
  const m = viewSrc.match(/value=\{settings\.note\.linkFormat\}[\s\S]*?placeholder="([^"]+)"/);
  assert.ok(m, "应找到 linkFormat textarea 及其 placeholder");
  // placeholder 文本应含 &#123;&#123; 编码的变量（不依赖运行时解码）
  assert.match(m[1], /&#123;&#123;bookTitle&#125;&#125;/, "placeholder 应含编码的 bookTitle 变量");
  assert.match(m[1], /&#123;&#123;date&#125;&#125;/, "placeholder 应含编码的 date 变量");
});
