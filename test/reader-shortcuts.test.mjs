// 阅读器 - 快捷键测试
// ----------------------------------------------------------------
// 覆盖：
// - READER_SHORTCUTS 注册表完整性（≥ 12 项 + 4 修饰键类型）
// - matchShortcut() 键位匹配（含 Mac/Win 差异 + 输入框跳过）
// - detectConflicts() 与思源全局快捷键冲突检测
// - getHintLines() 输出格式
// - ShortcutController 生命周期（start/stop + handler dispatch + conflict skip）
// 不依赖：annotation / vocab / ai / dict（reader 内部独立）

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  READER_SHORTCUTS,
  NO_MODIFIER_SHORTCUTS,
  matchShortcut,
  detectConflicts,
  getHintLines,
  ShortcutController,
} from "../src/reader/reader-shortcuts.ts";

/** 构造一个 Node.js 兼容的 KeyboardEvent 形状（不依赖浏览器全局 KeyboardEvent） */
function mkKeydown({ key, ctrlKey = false, metaKey = false, shiftKey = false, altKey = false, target = null }) {
  return { key, ctrlKey, metaKey, shiftKey, altKey, target, preventDefault() {} };
}

test("READER_SHORTCUTS 注册表含 15 项（≥ 12）", () => {
  assert.ok(READER_SHORTCUTS.length >= 12, `only ${READER_SHORTCUTS.length} shortcuts`);
});

test("READER_SHORTCUTS 含必需动作：prevPage/nextPage/font/font/openSearch/toggleBookmark/openTTS/openSettings/toggleTheme/toggleFullscreen", () => {
  const actions = new Set(READER_SHORTCUTS.map((s) => s.action));
  for (const required of [
    "prevPage", "nextPage",
    "fontIncrease", "fontDecrease",
    "openSearch", "toggleBookmark", "openTTS", "openSettings",
    "toggleTheme", "toggleFullscreen",
  ]) {
    assert.ok(actions.has(required), `missing action: ${required}`);
  }
});

test("NO_MODIFIER_SHORTCUTS 含 ? 和 Escape", () => {
  const keys = new Set(NO_MODIFIER_SHORTCUTS.map((s) => s.key));
  assert.ok(keys.has("?"), "missing ?");
  assert.ok(keys.has("Escape"), "missing Escape");
});

test("matchShortcut: 简单键（无修饰）匹配正确", () => {
  assert.equal(matchShortcut(mkKeydown({ key: "ArrowLeft" }), false), "prevPage");
  assert.equal(matchShortcut(mkKeydown({ key: "ArrowRight" }), false), "nextPage");
  assert.equal(matchShortcut(mkKeydown({ key: "F11" }), false), "toggleFullscreen");
});

test("matchShortcut: Ctrl+F 在 Win 上匹配 openSearch", () => {
  assert.equal(matchShortcut(mkKeydown({ key: "f", ctrlKey: true }), false), "openSearch");
});

test("matchShortcut: Cmd+F 在 Mac 上匹配 openSearch", () => {
  assert.equal(matchShortcut(mkKeydown({ key: "f", metaKey: true }), true), "openSearch");
});

test("matchShortcut: Ctrl+Shift+L 匹配 toggleTheme", () => {
  assert.equal(matchShortcut(mkKeydown({ key: "l", ctrlKey: true, shiftKey: true }), false), "toggleTheme");
});

test("matchShortcut: 无修饰键时输入框内不触发（target=INPUT 跳过）", () => {
  const fakeTarget = { tagName: "INPUT", isContentEditable: false };
  const e = mkKeydown({ key: "ArrowLeft", target: fakeTarget });
  assert.equal(matchShortcut(e, false), null);
});

test("matchShortcut: 无匹配时返回 null", () => {
  assert.equal(matchShortcut(mkKeydown({ key: "z" }), false), null);
});

test("detectConflicts: 与思源保留的 Ctrl+F 冲突", () => {
  const conflicts = detectConflicts([{ ctrl: true, key: "f" }]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].action, "openSearch");
});

test("detectConflicts: 多条保留键可一次性检测", () => {
  const conflicts = detectConflicts([
    { ctrl: true, key: "f" },
    { ctrl: true, key: "b" },
    { ctrl: true, key: "s" },
  ]);
  assert.equal(conflicts.length, 3);
  assert.deepEqual(conflicts.map((c) => c.action).sort(), ["openSearch", "openSettings", "toggleBookmark"]);
});

test("detectConflicts: 不冲突时返回空数组", () => {
  const conflicts = detectConflicts([{ ctrl: true, key: "g" }]);
  assert.equal(conflicts.length, 0);
});

test("getHintLines: 输出含 keys + label 字段", () => {
  const lines = getHintLines();
  assert.ok(lines.length >= 12);
  for (const line of lines) {
    assert.ok(typeof line.keys === "string");
    assert.ok(typeof line.label === "string");
  }
  // 含 F11
  assert.ok(lines.some((l) => l.keys === "F11"));
});

test("ShortcutController: 注册 handler + start 后 keydown 触发", () => {
  const root = {
    addEventListener: (event, handler) => { root._handler = handler; },
    removeEventListener: () => { root._handler = null; },
    hasAttribute: () => false,
    setAttribute: () => {},
  };
  const ctrl = new ShortcutController(root, false, []);
  let called = 0;
  ctrl.on("nextPage", () => { called++; });
  ctrl.start();
  root._handler(mkKeydown({ key: "ArrowRight" }));
  assert.equal(called, 1, "nextPage should fire once");
  ctrl.stop();
});

test("ShortcutController: conflict action 被跳过", () => {
  const root = {
    addEventListener: (event, handler) => { root._handler = handler; },
    removeEventListener: () => { root._handler = null; },
    hasAttribute: () => false,
    setAttribute: () => {},
  };
  const ctrl = new ShortcutController(root, false, [{ ctrl: true, key: "f" }]);
  let called = 0;
  ctrl.on("openSearch", () => { called++; });
  ctrl.start();
  root._handler(mkKeydown({ key: "f", ctrlKey: true }));
  assert.equal(called, 0, "openSearch should NOT fire when conflict");
  ctrl.stop();
});

test("ShortcutController: getConflicts 返回冲突 action 列表", () => {
  const root = {
    addEventListener: () => {},
    removeEventListener: () => {},
    hasAttribute: () => false,
    setAttribute: () => {},
  };
  const ctrl = new ShortcutController(root, false, [
    { ctrl: true, key: "f" },
    { ctrl: true, key: "b" },
  ]);
  const conflicts = ctrl.getConflicts();
  assert.equal(conflicts.length, 2);
  assert.ok(conflicts.includes("openSearch"));
  assert.ok(conflicts.includes("toggleBookmark"));
});

test("ShortcutController: stop 后不再触发", () => {
  const root = {
    addEventListener: (event, handler) => { root._handler = handler; },
    removeEventListener: () => { root._handler = null; },
    hasAttribute: () => false,
    setAttribute: () => {},
  };
  const ctrl = new ShortcutController(root, false, []);
  let called = 0;
  ctrl.on("nextPage", () => { called++; });
  ctrl.start();
  ctrl.stop();
  if (root._handler) {
    root._handler(mkKeydown({ key: "ArrowRight" }));
  }
  assert.equal(called, 0, "after stop should not fire");
});
