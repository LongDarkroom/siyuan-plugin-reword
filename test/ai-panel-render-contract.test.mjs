// P0 · AI 面板 render() 行为契约快照（bind() 巨型闭包重构的安全网）
// ---------------------------------------------------------------------------
// 为什么需要这个文件：bind()（L2624-4463，1840 行）此前零测试覆盖，而 P1「render 幂等化」
// 是架构级改动——它要改变「每次 refreshActivePanel 都整体重建 DOM + 重跑 bind」的行为。
// 没有运行时快照，这类回归只能靠真机发现（check/build/lint 全都兜不住）。
//
// 关键设计：断言的是**契约**（render 之后的可观察状态），而非实现细节（重建次数 / 内部
// 调用次数）。这样改造前后都应当通过——改造前是基线，改造后是安全网。
// 若后续某条断言失败，说明改造破坏了对外契约，不是「测试该改」。
//
// 环境：jsdom（已在 devDependencies，无新增依赖）。
// 注意 jsdom 的 addEventListener({signal}) 只认 jsdom 自己的 AbortSignal，
// 故 AbortController/AbortSignal 必须取自 dom.window，不能用 Node 全局。

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { AiPanel } from "../src/ai/ai-panel.ts";
import { DEFAULT_AI_SETTINGS } from "../src/ai/ai-settings.ts";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.com/" });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.Event = dom.window.Event;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.localStorage = dom.window.localStorage;
globalThis.AbortController = dom.window.AbortController;
globalThis.AbortSignal = dom.window.AbortSignal;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
if (!globalThis.matchMedia) {
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

/** 渲染后必须存在的关键元素（缺任一即面板不可用） */
const KEY_IDS = [
  "hiword-ai-run",      // 精读/停止 主按钮
  "hiword-ai-send",     // 发送按钮
  "hiword-ai-messages", // 消息容器
  "hiword-ai-protyle",  // 输入框挂载点
  "hiword-ai-status",   // 状态行
  "hiword-ai-body",     // 滚动主体
  "hiword-ai-token-ring", // 上下文用量环
];

/**
 * 最小 AiHost 替身：只需喂给 render 真正会读的 getAiSettings。
 * 其余能力用 Proxy 兜成 no-op，避免接口变动导致测试大面积失效。
 */
function makeHost() {
  return new Proxy(
    { getAiSettings: () => DEFAULT_AI_SETTINGS },
    { get: (t, p) => (p in t ? t[p] : () => null) }
  );
}

/** 建一个带 #hiword-dock-content 的 dock 宿主（render 找不到它会静默 return） */
function makeDock() {
  const dockEl = document.createElement("div");
  dockEl.innerHTML = '<div id="hiword-dock-content"></div>';
  document.body.appendChild(dockEl);
  return dockEl;
}

function makePanel() {
  return new AiPanel(makeHost());
}

const count = (root, sel) => root.querySelectorAll(sel).length;

// ── 1. 结构契约：render 之后关键元素齐备 ────────────────────────────

test("render 之后关键元素齐备且各 1 个", () => {
  const dockEl = makeDock();
  makePanel().render(dockEl);
  for (const id of KEY_IDS) {
    assert.equal(count(dockEl, `#${id}`), 1, `#${id} 应恰好存在 1 个`);
  }
});

// ── 2. 幂等契约：重复 render 不产生重复 DOM ─────────────────────────
// P1 之前靠 innerHTML 覆盖实现；P1 之后靠「不重建」实现。
// 两种实现对本断言的结果一致 —— 这正是「契约」而非「实现细节」的意义。

test("重复 render 3 次，关键元素不重复累积", () => {
  const dockEl = makeDock();
  const panel = makePanel();
  panel.render(dockEl);
  panel.render(dockEl);
  panel.render(dockEl);
  for (const id of KEY_IDS) {
    assert.equal(count(dockEl, `#${id}`), 1, `#${id} 重复 render 后仍应只有 1 个`);
  }
});

// ── 3. 泄漏契约：挂 body 的游离弹层不累积 ───────────────────────────
// bind() 里每次都会 createElement 并挂到 body：tokenModal(L2725) / sessionModal(L2845)。
// 它们不随 contentEl.innerHTML 清除，改造前靠 render 开头 L558-564 手工 remove 兜底。

test("重复 render 不会让 body 上的弹层累积", () => {
  const dockEl = makeDock();
  const panel = makePanel();
  panel.render(dockEl);
  panel.render(dockEl);
  panel.render(dockEl);
  assert.ok(
    count(document.body, ".hiword-ai-token-modal-host") <= 1,
    "token 弹层不应累积（改造前靠手工清理，改造后不再重复创建）"
  );
  assert.ok(
    count(document.body, ".hiword-ai-session-modal") <= 1,
    "会话弹层不应累积"
  );
});

// ── 4. 引用契约：contentEl 指向 dock 内的内容容器 ────────────────────

test("render 把 contentEl 绑定到 #hiword-dock-content", () => {
  const dockEl = makeDock();
  const panel = makePanel();
  panel.render(dockEl);
  assert.equal(
    panel.contentEl,
    dockEl.querySelector("#hiword-dock-content"),
    "contentEl 应指向 dock 内的内容容器，否则后续所有操作都会落空"
  );
});

// ── 5. 数据契约：设置项真实渲染进 DOM ────────────────────────────────

test("模型名渲染进 #hiword-ai-model-current", () => {
  const dockEl = makeDock();
  makePanel().render(dockEl);
  const cur = dockEl.querySelector(".hiword-ai-model-current");
  assert.ok(cur, "应存在模型名容器");
  // DEFAULT_AI_SETTINGS.model 为空串时渲染为空属正常；只验证「读到了设置而非抛错」
  assert.equal(typeof cur.textContent, "string");
});

// ── 6. 初始态契约：新面板消息区为空 ──────────────────────────────────

test("render 之后消息容器初始为空", () => {
  const dockEl = makeDock();
  makePanel().render(dockEl);
  const msgs = dockEl.querySelector("#hiword-ai-messages");
  assert.equal(msgs.children.length, 0, "新面板不应凭空出现历史消息");
});

// ── 7. P1 收益钉子：这些断言在幂等化之前会失败 ──────────────────────
// 与上面 1-6 不同，这两条断言的是**改造后的新行为**，用来钉住收益本身，
// 防止将来有人改回「每次全量重建」而无人察觉。

test("P1 幂等：重复 render 复用同一 DOM 节点，不重建", () => {
  const dockEl = makeDock();
  const panel = makePanel();
  panel.render(dockEl);
  const first = dockEl.querySelector("#hiword-ai-messages");
  panel.render(dockEl);
  const second = dockEl.querySelector("#hiword-ai-messages");
  assert.equal(
    first, second,
    "重复 render 应复用同一 DOM 节点（改造前每次 innerHTML 重建会产生新节点）"
  );
});

test("P1 幂等：dock 宿主变更时仍完整重建", () => {
  const dockA = makeDock();
  const dockB = makeDock();
  const panel = makePanel();
  panel.render(dockA);
  const inA = dockA.querySelector("#hiword-ai-messages");
  panel.render(dockB);
  const inB = dockB.querySelector("#hiword-ai-messages");
  assert.ok(inB, "换到新 dock 宿主后应完成构建（面板移入独立 Dock 的真实场景）");
  assert.notEqual(inB, inA, "新宿主上必须是新构建的节点");
});
