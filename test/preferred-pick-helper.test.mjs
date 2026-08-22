// 2026-08-22 释义偏好:showPickDefinitionsDialog 收词弹窗的纯函数解析测试
import { test } from "node:test";
import assert from "node:assert/strict";

function parsePreferredSelections(allSenses, selectedIndices) {
  const out = [];
  if (!Array.isArray(allSenses) || !Array.isArray(selectedIndices)) return out;
  for (const i of selectedIndices) {
    if (typeof i !== "number" || !Number.isInteger(i)) continue;
    if (i < 0 || i >= allSenses.length) continue;
    const z = (allSenses[i]?.zh || "").trim();
    if (z.length > 0) out.push(z);
  }
  return Array.from(new Set(out));
}

const S = [
  { num: "1.", zh: "苹果", pos: "n." },
  { num: "2.", zh: "苹果树", pos: "n." },
  { num: "3.", zh: "像苹果的", pos: "adj." },
  { num: "4.", zh: "  短语 苹果派  ", pos: "" },
];

test("PickHelper:基础多选", () => {
  const sel = parsePreferredSelections(S, [0, 1]);
  assert.deepEqual(sel, ["苹果", "苹果树"]);
});

test("PickHelper:全部未选 → 空数组", () => {
  const sel = parsePreferredSelections(S, []);
  assert.deepEqual(sel, []);
});

test("PickHelper:全部选中 → 全部 zh(trim)", () => {
  const sel = parsePreferredSelections(S, [0, 1, 2, 3]);
  assert.equal(sel.length, 4);
  assert.equal(sel[3], "短语 苹果派", "trim 后应清掉前后空格");
});

test("PickHelper:索引越界静默忽略", () => {
  const sel = parsePreferredSelections(S, [0, 5, 100, -1]);
  assert.deepEqual(sel, ["苹果"]);
});

test("PickHelper:非整数索引静默忽略", () => {
  const sel = parsePreferredSelections(S, [0, 1.5, NaN, Infinity, "0"]);
  assert.deepEqual(sel, ["苹果"]);
});

test("PickHelper:重复索引去重", () => {
  const sel = parsePreferredSelections(S, [0, 0, 0, 1, 1]);
  assert.deepEqual(sel, ["苹果", "苹果树"]);
});

test("PickHelper:zh 为空字符串的 sense 自动跳过", () => {
  const sel = parsePreferredSelections(
    [{ zh: "" }, { zh: "   " }, { zh: "正常" }],
    [0, 1, 2]
  );
  assert.deepEqual(sel, ["正常"]);
});

test("PickHelper:幂等性", () => {
  const a = parsePreferredSelections(S, [3, 1, 0]);
  const b = parsePreferredSelections(S, [3, 1, 0]);
  assert.deepEqual(a, b);
});

test("PickHelper:容错 - 非数组入参", () => {
  assert.deepEqual(parsePreferredSelections(null, [0]), []);
  assert.deepEqual(parsePreferredSelections(S, null), []);
  assert.deepEqual(parsePreferredSelections(undefined, undefined), []);
});

test("PickHelper:用户改主意重选", () => {
  const first = parsePreferredSelections(S, [0, 1, 2]);
  const second = parsePreferredSelections(S, [0]);
  assert.equal(first.length, 3);
  assert.equal(second.length, 1);
  assert.notDeepEqual(first, second);
});
