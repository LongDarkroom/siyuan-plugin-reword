// 阅读器 Tab 化诊断代码清理测试（2026-08-23 修复"大量报错"问题）
// ----------------------------------------------------------------
// 覆盖：
// - reader-tab.ts 源码不含 "window.alert"（诊断弹窗已清）
// - reader-tab.ts 源码不含 "document.body.append"（红底 div 已清）
// - reader-tab.ts 源码不含 console.error（针对 "[REword]" 日志，普通日志已转 console.log）
// - reader-tab.ts 仍然保留 openBookTab 核心逻辑（register + openBookTab + dispose）
// 不依赖：annotation / vocab / ai / dict

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const READER_TAB_PATH = resolve(REPO_ROOT, "src/reader/reader-tab.ts");

function readReaderTab() {
  return readFileSync(READER_TAB_PATH, "utf-8");
}

test("reader-tab.ts 源码不含 'window.alert'（诊断弹窗已清）", () => {
  const src = readReaderTab();
  assert.equal(src.includes("window.alert"), false,
    "reader-tab.ts 仍含 window.alert 诊断代码,应删除");
});

test("reader-tab.ts 源码不含 'document.body.append'（红底 div 已清）", () => {
  const src = readReaderTab();
  assert.equal(src.includes("document.body.append"), false,
    "reader-tab.ts 仍含 document.body.append 红底 div 诊断,应删除");
});

test("reader-tab.ts 源码不含 'console.error'（普通日志已转 console.log）", () => {
  const src = readReaderTab();
  assert.equal(src.includes("console.error"), false,
    "reader-tab.ts 仍用 console.error 记普通日志,应改为 console.log");
});

test("reader-tab.ts 仍含 openBookTab 核心方法（未误删功能）", () => {
  const src = readReaderTab();
  // 关键 API 仍存在(register / openBookTab / dispose)
  assert.ok(src.includes("register"), "应保留 register() 方法");
  assert.ok(src.includes("openBookTab"), "应保留 openBookTab() 方法");
  assert.ok(src.includes("dispose"), "应保留 dispose() 方法");
  // openTab 调用仍存在
  assert.ok(src.includes("await openTab"), "应保留 openTab 调用");
  // 关键方法 console.log 保留
  assert.ok(src.includes("console.log"), "应保留 console.log 日志");
});

test("reader-tab.ts 行数在合理区间（粗略防膨胀护栏）", () => {
  // 2026-08-31 调整：原断言 <175 行，但该文件是 props 桥接层，
  // 功能增长（含 Phase 3 术语表等）后已达 ~390 行。
  // 行数本身不是质量指标——把「文件短」当目标会阻碍正常开发（每次加功能都要
  // 被迫拆文件）。这里只保留「防止无限膨胀」的粗略护栏，上限放宽到 600 行。
  const src = readReaderTab();
  const lineCount = src.split("\n").length;
  assert.ok(lineCount < 600, `reader-tab.ts 已达 ${lineCount} 行(>600)，桥接层过度膨胀，建议拆分`);
  assert.ok(lineCount > 100, `reader-tab.ts 只有 ${lineCount} 行(<100)，可能误删功能`);
});
