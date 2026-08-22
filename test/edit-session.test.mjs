import test from "node:test";
import assert from "node:assert/strict";
import {
  requestEditSession, releaseEditSession, hasActiveSession, currentEditSession,
} from "../src/annotation/edit-session.ts";

/** 测试间重置：模块是带状态单例，需在每例开始前清空，避免相互污染 */
function reset() {
  releaseEditSession("panel");
  releaseEditSession("dialog");
  releaseEditSession("popover");
}

test("D6/D8：requestEditSession('panel') 首次申请成功", () => {
  reset();
  assert.equal(requestEditSession("panel"), true);
  assert.equal(currentEditSession(), "panel");
  assert.equal(hasActiveSession(), true);
});

test("D6/D8：持有 panel 会话时，再申请 dialog 被拒（并发互斥）", () => {
  reset();
  assert.equal(requestEditSession("panel"), true);
  // 不同 scope 申请 → 失败
  assert.equal(requestEditSession("dialog"), false);
  assert.equal(requestEditSession("popover"), false);
  // 自身查询（exclude）不算「其它会话」
  assert.equal(hasActiveSession("panel"), false);
  assert.equal(hasActiveSession("dialog"), true);
});

test("D6/D8：释放 panel 后，dialog 可获", () => {
  reset();
  assert.equal(requestEditSession("panel"), true);
  releaseEditSession("panel");
  assert.equal(currentEditSession(), null);
  assert.equal(hasActiveSession(), false);
  // 释放后另一 scope 可申请
  assert.equal(requestEditSession("dialog"), true);
  assert.equal(currentEditSession(), "dialog");
});

test("D6/D8：releaseEditSession 仅当 scope 为当前持有者才生效（防误清）", () => {
  reset();
  assert.equal(requestEditSession("panel"), true);
  // 用错误的 scope 释放 → 不应清除 panel 会话
  releaseEditSession("dialog");
  assert.equal(currentEditSession(), "panel");
  // 用正确 scope 释放 → 清除
  releaseEditSession("panel");
  assert.equal(currentEditSession(), null);
});

test("D6/D8：并发互斥不依赖 DOM（node 环境无 window 可直接运行）", () => {
  reset();
  // 不抛错、不依赖 window.Lute / document
  assert.equal(requestEditSession("popover"), true);
  assert.equal(typeof currentEditSession(), "string");
  releaseEditSession("popover");
  assert.equal(currentEditSession(), null);
});

test("D6/D8：重复申请同一 scope（已持有）返回 false", () => {
  reset();
  assert.equal(requestEditSession("dialog"), true);
  assert.equal(requestEditSession("dialog"), false);
  releaseEditSession("dialog");
});
