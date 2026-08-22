import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { confirmDelete } from "../src/annotation/whale-confirm.ts";

// confirmDelete 使用全局 document，测试环境需注入 JSDOM
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.document = dom.window.document;

function fire(el, type) {
  assert.ok(el, `元素应存在：${type}`);
  el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
}

test("confirmDelete：点击「删除」→ resolve true 且弹窗移除", async () => {
  const p = confirmDelete("确定删除这条批注？");
  const ov = document.querySelector(".whale-dlg-overlay");
  assert.ok(ov, "确认弹窗应已挂载");
  assert.ok(ov.querySelector("#wc-ok"), "应含删除按钮 #wc-ok");
  fire(ov.querySelector("#wc-ok"), "click");
  const r = await p;
  assert.equal(r, true, "点删除应 resolve(true)");
  assert.equal(document.querySelector(".whale-dlg-overlay"), null, "弹窗应已销毁");
});

test("confirmDelete：点击底部「取消」→ resolve false", async () => {
  const p = confirmDelete("确定删除这条批注？");
  fire(document.querySelector("#wc-cancel2"), "click");
  assert.equal(await p, false);
});

test("confirmDelete：点右上角 ✕ → resolve false", async () => {
  const p = confirmDelete("x");
  fire(document.querySelector("#wc-cancel"), "click");
  assert.equal(await p, false);
});

test("confirmDelete：按 ESC → resolve false", async () => {
  const p = confirmDelete("x");
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(await p, false);
});

test("confirmDelete：点击遮罩（mousedown on overlay）→ resolve false", async () => {
  const p = confirmDelete("x");
  const ov = document.querySelector(".whale-dlg-overlay");
  fire(ov, "mousedown");
  assert.equal(await p, false);
});

test("confirmDelete：二次确认仅一个实例，文案正确转义", async () => {
  const p = confirmDelete("确认<b>删除</b>？");
  const body = document.querySelector(".whale-confirm-body");
  assert.ok(body, "应含确认文案容器");
  // 文案经 escapeHtml，<b> 不应被解析为标签
  assert.equal(body.querySelector("b"), null, "文案应转义，不注入真实标签");
  // 转义后 <b> 应作为字面文本保留，而非被解析成元素：确认<b>删除</b>？
  assert.ok(body.textContent.includes("<b>删除</b>"), "文案应保留为转义文本 <b>删除</b>");
  fire(document.querySelector("#wc-cancel2"), "click");
  assert.equal(await p, false);
});
