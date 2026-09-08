/**
 * 第 5 批 · 发送快捷键匹配纯函数回归（2026-09-06）。
 * 覆盖 matchSendShortcut：两种模式 + 输入法组合放行。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { matchSendShortcut } from "../src/ai/ai-panel.ts";

const K = (over) => ({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false, keyCode: 0, ...over });

test("mod+enter：Cmd/Ctrl+Enter 发送", () => {
  assert.equal(matchSendShortcut(K({ metaKey: true }), "mod+enter"), true);
  assert.equal(matchSendShortcut(K({ ctrlKey: true }), "mod+enter"), true);
});

test("mod+enter：裸 Enter / Shift+Enter / 其它键 不发送", () => {
  assert.equal(matchSendShortcut(K({}), "mod+enter"), false, "裸 Enter 应留给换行");
  assert.equal(matchSendShortcut(K({ shiftKey: true }), "mod+enter"), false, "仅 Shift+Enter 不发送");
  assert.equal(matchSendShortcut(K({ key: "a" }), "mod+enter"), false);
});

test("enter：裸 Enter 发送", () => {
  assert.equal(matchSendShortcut(K({}), "enter"), true);
});

test("enter：Shift/Cmd/Ctrl+Enter 不发送", () => {
  assert.equal(matchSendShortcut(K({ shiftKey: true }), "enter"), false, "Shift+Enter 留给换行");
  assert.equal(matchSendShortcut(K({ metaKey: true }), "enter"), false);
  assert.equal(matchSendShortcut(K({ ctrlKey: true }), "enter"), false);
});

test("输入法组合中（isComposing / keyCode 229）一律不发送", () => {
  assert.equal(matchSendShortcut(K({ metaKey: true, isComposing: true }), "mod+enter"), false);
  assert.equal(matchSendShortcut(K({ isComposing: true }), "enter"), false);
  assert.equal(matchSendShortcut(K({ keyCode: 229 }), "enter"), false);
  assert.equal(matchSendShortcut(K({ keyCode: 229, metaKey: true }), "mod+enter"), false);
});
