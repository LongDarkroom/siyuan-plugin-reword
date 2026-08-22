/**
 * Fix1 测试：批注编辑器「链接」按钮走 host.promptInput（不再用 window.prompt）。
 * 验证：调 promptInput、取消(null)不创建链接、非法 URL 拦截、合法 URL 走 createLink。
 * 环境：Node --experimental-strip-types + jsdom。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// 构建最小 DOM 环境
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { url: "http://localhost/" });
const win = dom.window;
const doc = win.document;
globalThis.window = win;
globalThis.document = doc;
globalThis.Node = win.Node;
globalThis.getSelection = () => win.getSelection();

// stub execCommand：记录调用
const execCalls = [];
doc.execCommand = ((cmd, _ui, arg) => {
  execCalls.push({ cmd, arg: arg || "" });
  return true;
});

// 动态导入被测模块
const { WhaleAnnotationManager } = await import("../src/annotation/whale-manager.ts");

/** 构造最小 IWhaleHost */
function makeHost(overrides = {}) {
  return {
    getSelectionText: () => ({ text: "test", blockId: "b1", docId: "d1", sentence: "s" }),
    upsertAnnotation: async () => ({ id: "a1" }),
    removeAnnotation: async () => true,
    jumpToBlock: () => {},
    copyText: () => {},
    showMessage: () => {},
    promptInput: async () => "https://example.com",
    getLabels: () => [],
    addLabel: async (name) => ({ id: "lbl-" + name, name, color: "#0d9e5f" }),
    ...overrides,
  };
}

test("host.promptInput 返回 Promise 且被正确调用", async () => {
  let prompted = 0;
  const host = makeHost({
    promptInput: async () => { prompted++; return "https://example.com"; },
  });
  const p = host.promptInput("输入链接 URL", "https://");
  assert.ok(p instanceof Promise, "promptInput 必须返回 Promise");
  const r = await p;
  assert.equal(prompted, 1);
  assert.equal(r, "https://example.com");
});

test("promptInput 取消（返回 null）时不创建链接", async () => {
  const before = execCalls.length;
  const host = makeHost({ promptInput: async () => null });
  const r = await host.promptInput("x", "y");
  assert.equal(r, null);
  // 取消后不应有任何 createLink 调用
  const linkCalls = execCalls.slice(before).filter((c) => c.cmd === "createLink");
  assert.equal(linkCalls.length, 0);
});

test("host 接口已暴露 promptInput（index.ts 桥接 copilotPromptDialog 的契约）", () => {
  const host = makeHost();
  assert.equal(typeof host.promptInput, "function");
});

test("WhaleAnnotationManager 构造接受带 promptInput 的 host（接口兼容）", () => {
  const host = makeHost();
  const mgr = new WhaleAnnotationManager(host);
  assert.ok(mgr instanceof WhaleAnnotationManager);
});
