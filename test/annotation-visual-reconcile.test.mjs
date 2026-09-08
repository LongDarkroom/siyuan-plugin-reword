import { test } from "node:test";
import assert from "node:assert/strict";
import { missingDrawItems, cfiMatch } from "../src/reader/annotation-visual.ts";

/* ============ R3 刷新单通道：missingDrawItems 补绘判定（纯函数） ============ */

const items = [
  { id: "a", cfi: "epubcfi(/6/4!/4/2)" },
  { id: "b", cfi: "epubcfi(/6/6!/4/4)" },
  { id: "c", cfi: "epubcfi(/6/8!/4/6)" },
];

test("missingDrawItems：全部未绘制 → 全部返回", () => {
  const out = missingDrawItems(items, () => false);
  assert.deepEqual(out.map((x) => x.id), ["a", "b", "c"]);
});

test("missingDrawItems：全部已绘制 → 空数组", () => {
  const out = missingDrawItems(items, () => true);
  assert.deepEqual(out, []);
});

test("missingDrawItems：部分缺失 → 只返回缺失条目", () => {
  const drawn = new Set([items[0].cfi]);
  const out = missingDrawItems(items, (cfi) => drawn.has(cfi));
  assert.deepEqual(out.map((x) => x.id), ["b", "c"]);
});

test("missingDrawItems：无 cfi 的条目一律跳过（不参与补绘判定）", () => {
  const mixed = [{ id: "x", cfi: "" }, { id: "y", cfi: undefined }, { id: "z", cfi: "epubcfi(/6/2)" }];
  const out = missingDrawItems(mixed, () => false);
  assert.deepEqual(out.map((x) => x.id), ["z"]);
});

test("missingDrawItems：hasKey 抛错 → 视为未绘制（保守补绘，不静默丢条目）", () => {
  const out = missingDrawItems(items, () => { throw new Error("boom"); });
  assert.deepEqual(out.map((x) => x.id), ["a", "b", "c"]);
});

test("missingDrawItems：与 cfiMatch 组合可做宽松匹配（epubcfi() 包装差异不误判）", () => {
  // foliate 内部存储的 key 可能缺右括号（normCfi 只剥 epubcfi( 前缀与尾部 )）；
  // 用 cfiMatch 作为 hasKey 时，缺右括号形态不应被误判为缺失
  const drawnCfi = "epubcfi(/6/4!/4/2"; // 缺右括号的宽松形态
  const out = missingDrawItems(items, (cfi) => cfiMatch(cfi, drawnCfi));
  assert.deepEqual(out.map((x) => x.id), ["b", "c"]);
});

test("missingDrawItems：不修改输入数组（纯函数）", () => {
  const snapshot = JSON.stringify(items);
  missingDrawItems(items, () => false);
  assert.equal(JSON.stringify(items), snapshot);
});
