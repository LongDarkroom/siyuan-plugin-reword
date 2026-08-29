/**
 * PDF 缩放 Phase 1 · 测试 2: reader-shortcuts.ts 6 个 zoom action
 * ----------------------------------------------------------------
 * 覆盖：
 *  - ShortcutAction 新增 6 个：zoomIn / zoomOut / zoomReset / fitWidth / fitPage / cycleZoomPreset
 *  - READER_SHORTCUTS 注册表新增 6 项
 *  - 6 项都用 Ctrl + Cmd 修饰
 *  - 6 项分别绑定：= / - / 0 / 1 / 2 / 3
 *  - 现有 12 项保留（fontIncrease/Decrease 用同样的 = / - 但归 EPUB 字号）
 *
 * 不依赖：foliate / siyuan SDK
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const shortcutsPath = join(__dirname, "..", "src", "reader", "reader-shortcuts.ts");
const src = readFileSync(shortcutsPath, "utf-8");

test("[核心] ShortcutAction 联合类型含 6 个新 zoom action", () => {
  // 找 ShortcutAction 类型定义
  const m = src.match(/export type ShortcutAction =[\s\S]*?;/);
  assert.ok(m, "ShortcutAction 类型应存在");
  const typeBody = m[0];
  for (const action of ["zoomIn", "zoomOut", "zoomReset", "fitWidth", "fitPage", "cycleZoomPreset"]) {
    assert.ok(
      new RegExp(`\\b${action}\\b`).test(typeBody),
      `ShortcutAction 应含 ${action}`
    );
  }
});

test("[核心] READER_SHORTCUTS 注册表含 6 个 zoom 项", () => {
  // 找注册表数组
  const m = src.match(/READER_SHORTCUTS: ShortcutSpec\[\] = \[([\s\S]*?)\n\];/);
  assert.ok(m, "READER_SHORTCUTS 注册表应存在");
  const body = m[1];
  for (const action of ["zoomIn", "zoomOut", "zoomReset", "fitWidth", "fitPage", "cycleZoomPreset"]) {
    assert.ok(
      new RegExp(`action:\\s*["']${action}["']`).test(body),
      `注册表应含 action: "${action}"`
    );
  }
});

test("[绑定] 6 个 zoom 项 key 分别是 = / - / 0 / 1 / 2 / 3", () => {
  // 每项单独验证（用粗略 regex）
  const checks = [
    { action: "zoomIn", key: "=" },
    { action: "zoomOut", key: "-" },
    { action: "zoomReset", key: "0" },
    { action: "fitWidth", key: "1" },
    { action: "fitPage", key: "2" },
    { action: "cycleZoomPreset", key: "3" },
  ];
  for (const { action, key } of checks) {
    // 找单条注册项
    const re = new RegExp(`action:\\s*["']${action}["'][\\s\\S]*?key:\\s*["']${key}["']`);
    assert.ok(
      re.test(src),
      `action "${action}" 应绑定 key "${key}"`
    );
  }
});

test("[修饰键] 6 个 zoom 项都有 ctrl + cmd 修饰", () => {
  const checks = ["zoomIn", "zoomOut", "zoomReset", "fitWidth", "fitPage", "cycleZoomPreset"];
  for (const action of checks) {
    // 找单条注册项（粗略，可能跨多行）
    const re = new RegExp(`action:\\s*["']${action}["'][\\s\\S]*?ctrl:\\s*true[\\s\\S]*?cmd:\\s*true`);
    assert.ok(
      re.test(src),
      `action "${action}" 应有 ctrl: true + cmd: true 修饰键`
    );
  }
});

test("[回归] 现有 fontIncrease / fontDecrease 仍绑定 = / -", () => {
  // 注意：fontIncrease 和 zoomIn 都绑定 "="，但根据 PDF/EPUB 格式分流
  // 不冲突（同一物理键有多个 action 候选，ReaderView 内部按格式选）
  assert.ok(/action:\s*["']fontIncrease["'][\s\S]*?key:\s*["']=["']/.test(src), "fontIncrease 仍绑 =");
  assert.ok(/action:\s*["']fontDecrease["'][\s\S]*?key:\s*["']-["']/.test(src), "fontDecrease 仍绑 -");
});

test("[回归] 现有 12 项核心快捷键保留", () => {
  for (const action of [
    "prevPage", "nextPage", "prevSection", "nextSection",
    "goStart", "goEnd", "fontIncrease", "fontDecrease",
    "openSearch", "toggleBookmark", "openTTS", "openSettings",
  ]) {
    assert.ok(
      new RegExp(`action:\\s*["']${action}["']`).test(src),
      `原 12 项核心快捷键应保留：${action}`
    );
  }
});
