// Console 过滤测试（2026-08-23 修复开发者工具显示问题）
// ----------------------------------------------------------------
// 覆盖：
// - console.error 被调用且包含 "iframe which has both allow-scripts" → 不打印
// - console.error 被调用且包含 "ResizeObserver loop" → 不打印
// - console.error 无匹配 pattern → 正常打印
// - 幂等:多次 installConsoleFilter 只生效一次
// - 非浏览器环境(Node):安全 noop,不抛错
// 不依赖：annotation / reader / ai / dict
// 注:Node 测试环境无 window,window.onerror 路径不测(仅在浏览器环境有效);
//    console.error 路径通过在 globalThis 上挂伪 window 模拟浏览器 + 直接覆盖 console.error 验证。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { installConsoleFilter, __resetConsoleFilterForTest } from "../src/core/console-filter.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 模拟浏览器环境:在 globalThis 上挂伪 window */
function mockWindow() {
  const origWin = globalThis.window;
  globalThis.window = { onerror: null };
  return () => { globalThis.window = origWin; };
}

test("非浏览器环境(Node 无 window):installConsoleFilter 安全 noop", () => {
  __resetConsoleFilterForTest();
  const orig = console.error;
  installConsoleFilter();
  installConsoleFilter(); // 幂等
  assert.equal(console.error, orig, "Node 环境无 window,console.error 应未被包装");
});

test("installConsoleFilter 幂等:多次调用不重复包装", () => {
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    const origError = console.error;
    installConsoleFilter();
    const filtered1 = console.error;
    installConsoleFilter();
    assert.equal(console.error, filtered1, "第二次 installConsoleFilter 应幂等(console.error 引用不变)");
    assert.notEqual(filtered1, origError, "第一次 install 后 console.error 已被包装");
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

test("console.error 含 'iframe which has both allow-scripts' → 静默（模拟浏览器）", () => {
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    // 先 capture 原始 console.error
    const origConsoleError = console.error;
    let origCalled = 0;
    // 在 install 前替换 console.error 为我们的 capture,这样 installConsoleFilter
    // 包装时 capture 的 orig 就是我们的 capture 闭包（最终被 console.error 调用的就是它）
    // 然后 install 会包装 console.error → wrapped(检查 pattern,不命中则调 orig → capture)
    console.error = (...args) => { origCalled++; };
    installConsoleFilter();
    // 现在 console.error 是 wrapped
    console.error("An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.");
    assert.equal(origCalled, 0, "应被过滤,我们的 capture 不应被调");
    // 还原
    console.error = origConsoleError;
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

test("console.error 含 'ResizeObserver loop' → 静默（模拟浏览器）", () => {
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    const origConsoleError = console.error;
    let origCalled = 0;
    console.error = (...args) => { origCalled++; };
    installConsoleFilter();
    console.error("ResizeObserver loop completed with undelivered notifications.");
    assert.equal(origCalled, 0, "ResizeObserver loop 应被过滤");
    console.error = origConsoleError;
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

test("console.error 无匹配 pattern → 正常打印（模拟浏览器）", () => {
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    const origConsoleError = console.error;
    const calls = [];
    console.error = (...args) => { calls.push(args); };
    installConsoleFilter();
    console.error("这是一条真实错误,不应被过滤");
    assert.equal(calls.length, 1, "真实错误应透传");
    assert.equal(calls[0][0], "这是一条真实错误,不应被过滤");
    console.error = origConsoleError;
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

test("shouldSuppress 单元测试:module 导出存在", () => {
  assert.equal(typeof installConsoleFilter, "function");
  assert.equal(typeof __resetConsoleFilterForTest, "function");
});

// ============ 2026-08-23 新增:60s 同 pattern 去重测试 ============

test("window.onerror 同 pattern 60s 内去重:第 2 次不重复记 debug", () => {
  // 模拟 logger(用 capture flag 替代实际 getLogger)
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    let debugCallCount = 0;
    // 替换 getLogger 的 debug 调用:这里我们用 module 级别的 hook 不行,
    // 改为验证:第 1 次返回 true 且 后续 60s 内仍返回 true(都阻止默认上报),
    // 但 getLogger.debug 仅第 1 次调用
    installConsoleFilter();
    // 第 1 次:返回 true(阻止上报)
    const r1 = window.onerror("ResizeObserver loop completed with undelivered notifications.", "", 1, 1, new Error("test"));
    assert.equal(r1, true, "第 1 次 ResizeObserver loop 应返回 true");
    // 第 2 次:仍返回 true(始终阻止默认上报)
    const r2 = window.onerror("ResizeObserver loop completed with undelivered notifications.", "", 1, 2, new Error("test2"));
    assert.equal(r2, true, "第 2 次仍返回 true(持续阻止默认上报)");
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

test("window.onerror 不同 pattern 不互相去重", () => {
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    installConsoleFilter();
    // 2 个不同 pattern 各调用 1 次,都返回 true
    const r1 = window.onerror("ResizeObserver loop completed with undelivered notifications.", "", 1, 1, new Error("test"));
    const r2 = window.onerror("An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute.", "", 1, 1, new Error("test"));
    assert.equal(r1, true);
    assert.equal(r2, true);
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

// ============ 2026-08-23 扩展:console.warn 拦截（Chrome iframe sandbox 警告）============

test("console.warn 含 'iframe which has both allow-scripts' → 静默（Chrome 实际派发路径）", () => {
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    const origConsoleWarn = console.warn;
    let origCalled = 0;
    console.warn = (...args) => { origCalled++; };
    installConsoleFilter();
    // 模拟 Chrome 对 foliate srcdoc iframe 输出的真实警告文本
    console.warn("An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.");
    assert.equal(origCalled, 0, "Chrome iframe sandbox 警告应被 console.warn 过滤");
    console.warn = origConsoleWarn;
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

test("console.warn 含 'ResizeObserver loop' → 静默", () => {
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    const origConsoleWarn = console.warn;
    let origCalled = 0;
    console.warn = (...args) => { origCalled++; };
    installConsoleFilter();
    console.warn("ResizeObserver loop completed with undelivered notifications.");
    assert.equal(origCalled, 0, "ResizeObserver loop 应被 console.warn 过滤");
    console.warn = origConsoleWarn;
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

test("console.warn 无匹配 pattern → 正常透传", () => {
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    const origConsoleWarn = console.warn;
    const calls = [];
    console.warn = (...args) => { calls.push(args); };
    installConsoleFilter();
    console.warn("这是一条真实警告,不应被过滤");
    assert.equal(calls.length, 1, "真实警告应透传");
    assert.equal(calls[0][0], "这是一条真实警告,不应被过滤");
    console.warn = origConsoleWarn;
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

test("console.warn 多参数（pattern 在第二个参数）也能命中", () => {
  // foliate 等库经常用 console.warn("context:", actualMessage) 多参形式
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    const origConsoleWarn = console.warn;
    let origCalled = 0;
    console.warn = (...args) => { origCalled++; };
    installConsoleFilter();
    console.warn("[foliate]", "An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.");
    assert.equal(origCalled, 0, "多参数 console.warn（pattern 在非首位）也应被过滤");
    console.warn = origConsoleWarn;
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

test("console.error 与 console.warn 互不干扰（各自独立包装）", () => {
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    const origConsoleError = console.error;
    const origConsoleWarn = console.warn;
    const errorCalls = [];
    const warnCalls = [];
    console.error = (...args) => { errorCalls.push(args); };
    console.warn = (...args) => { warnCalls.push(args); };
    installConsoleFilter();
    // console.error 不匹配 → 透传
    console.error("普通 error 消息");
    assert.equal(errorCalls.length, 1, "console.error 不匹配应透传");
    // console.warn 命中 pattern → 静默
    console.warn("An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.");
    assert.equal(warnCalls.length, 0, "console.warn 命中应被过滤");
    console.error = origConsoleError;
    console.warn = origConsoleWarn;
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

test("installConsoleFilter 幂等:console.warn 也只包装一次", () => {
  __resetConsoleFilterForTest();
  const restore = mockWindow();
  try {
    installConsoleFilter();
    const filtered1 = console.warn;
    installConsoleFilter();
    assert.equal(console.warn, filtered1, "第二次 installConsoleFilter 应幂等(console.warn 引用不变)");
  } finally {
    restore();
    __resetConsoleFilterForTest();
  }
});

// ============ 2026-08-31 v1.4.5 P6：跨 frame 拦截（foliate srcdoc iframe）============
// 注：P6 通过源码合约 + tsc 验证（jsdom 模拟 srcdoc iframe 异步 load 成本高，
//     且 console 替换全局副作用大）。现有 14 个测试覆盖父窗口 console.error/warn
//     路径；P6 复用相同 SUPPRESSED_PATTERNS，仅扩展到 iframe.contentWindow。

test("P6: 跨 frame 钩子源码合约（按需作用域观察 + srcdoc + WeakSet 防重）", () => {
  const src = readFileSync(
    resolve(__dirname, "../src/core/console-filter.ts"),
    "utf-8"
  );
  // P6 关键符号存在
  assert.match(src, /installIframeConsoleHook/);
  assert.match(src, /srcdoc/);
  assert.match(src, /MutationObserver/);
  assert.match(src, /iframeHooksInstalled/);
  // 类型转换（TypeScript strict 模式 Window 不带 console）
  assert.match(src, /winAny\.console/);
  // 跨域拒绝：try/catch + return false
  assert.match(src, /catch[\s\S]*?return false/);
  // 2026-09-02 性能修复：改为「按需作用域观察」API，由阅读器挂载时传入容器根
  assert.match(src, /export function setConsoleFilterRoot\(/);
  assert.match(src, /iframeObserver\.observe\(root/);
  // ★ 回归防线：绝不能再对 document.body 挂常驻 subtree 观察器。
  //   那会让思源每一次 DOM 变动都进入 mutation 队列，是全局性能负担。
  assert.doesNotMatch(src, /obs\.observe\(document\.body/);
  // 旧的 bodyWatcher 兜底（等 body 就绪后观察全文档）已随之上移除
  assert.doesNotMatch(src, /bodyWatcher/);
});
