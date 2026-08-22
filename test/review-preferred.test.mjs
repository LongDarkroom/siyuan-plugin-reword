// 2026-08-22 释义偏好:复习卡片 renderCard 首选 sense 逻辑测试
import { test } from "node:test";
import assert from "node:assert/strict";

function renderReviewMeaning(rec, opts) {
  const preferred = rec.preferredDefinitions || [];
  const hasPreferred = preferred.length > 0;
  const showAll = opts && opts.showAllMeaning === true;
  const usePreferred = hasPreferred && !showAll;
  const allSenses = opts && opts.allSenses ? opts.allSenses : [];
  const allMeaningHtml = allSenses.length
    ? allSenses.map((s, i) => `<div class="hiword-review__sense"><span class="hiword-review__sense-num">${i + 1}.</span>${escapeHtml(s)}</div>`).join("")
    : escapeHtml(rec.meaning || "（暂无释义）");
  const preferredMeaningHtml = hasPreferred
    ? preferred.map((z) => `<div class="hiword-review__sense hiword-review__sense--preferred">⭐ ${escapeHtml(z)}</div>`).join("")
    : "";
  const meaningHtml = usePreferred ? preferredMeaningHtml : allMeaningHtml;
  const prefHint = hasPreferred
    ? `<div class="hiword-review__pref-hint">
         <span class="hiword-review__pref-info">⭐ 已应用偏好 (${preferred.length} / ${rec.senseCount || preferred.length})</span>
         <a class="hiword-review__pref-toggle" data-action="review-toggle-all">${showAll ? "只看 ⭐ 偏好" : "📚 显示全部释义"}</a>
       </div>`
    : "";
  return { meaningHtml, prefHint, usingPreferred: usePreferred };
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const REC = {
  word: "apple",
  meaning: "苹果 苹果树 像苹果的",
  preferredDefinitions: ["苹果", "像苹果的"],
  senseCount: 3,
};

test("ReviewPref:有 preferredDefinitions 时默认只显示首选", () => {
  const r = renderReviewMeaning(REC, { allSenses: ["苹果", "苹果树", "像苹果的"] });
  assert.equal(r.usingPreferred, true);
  assert.ok(r.meaningHtml.includes("hiword-review__sense--preferred"));
  assert.ok(!r.meaningHtml.includes("苹果树"), "非偏好 sense 不应在首选视图里");
  assert.match(r.meaningHtml, /⭐ 苹果/);
  assert.match(r.meaningHtml, /⭐ 像苹果的/);
});

test("ReviewPref:有 preferredDefinitions 时显式 showAllMeaning=true → 显示全部", () => {
  const r = renderReviewMeaning(REC, {
    allSenses: ["苹果", "苹果树", "像苹果的"],
    showAllMeaning: true,
  });
  assert.equal(r.usingPreferred, false);
  assert.ok(r.meaningHtml.includes("苹果树"), "切换到显示全部时,非偏好 sense 也要在");
  assert.ok(!r.meaningHtml.includes("hiword-review__sense--preferred"));
});

test("ReviewPref:无 preferredDefinitions 时 → fallback 到 meaning(无 prefHint)", () => {
  const rec = { ...REC, preferredDefinitions: [] };
  const r = renderReviewMeaning(rec, { allSenses: ["苹果"] });
  assert.equal(r.usingPreferred, false);
  assert.equal(r.prefHint, "");
  assert.ok(r.meaningHtml.includes("苹果"));
});

test("ReviewPref:有 preferredDefinitions 但 allSenses 为空 → 仍 usePreferred", () => {
  const r = renderReviewMeaning(REC, { allSenses: [] });
  assert.equal(r.usingPreferred, true);
  assert.ok(r.meaningHtml.includes("hiword-review__sense--preferred"));
});

test("ReviewPref:提示行显示已应用偏好 (N/M) 格式", () => {
  const r = renderReviewMeaning(REC, { allSenses: ["苹果", "苹果树", "像苹果的"] });
  assert.match(r.prefHint, /⭐ 已应用偏好 \(2 \/ 3\)/);
  assert.match(r.prefHint, /data-action="review-toggle-all"/);
});

test("ReviewPref:提示行 toggle 文案随 showAll 切换", () => {
  const r1 = renderReviewMeaning(REC, { allSenses: ["苹果", "苹果树", "像苹果的"] });
  const r2 = renderReviewMeaning(REC, { allSenses: ["苹果", "苹果树", "像苹果的"], showAllMeaning: true });
  assert.match(r1.prefHint, /📚 显示全部释义/);
  assert.match(r2.prefHint, /只看 ⭐ 偏好/);
});

test("ReviewPref:preferredDefinitions 长度 0 时与 undefined 行为一致", () => {
  const rec1 = { ...REC, preferredDefinitions: [] };
  const rec2 = { ...REC };
  delete rec2.preferredDefinitions;
  const r1 = renderReviewMeaning(rec1, { allSenses: ["苹果"] });
  const r2 = renderReviewMeaning(rec2, { allSenses: ["苹果"] });
  assert.deepEqual(r1, r2);
});

test("ReviewPref:老数据兼容 - 整条 meaning 字符串也能 fallback 渲染", () => {
  const r = renderReviewMeaning({ word: "x", meaning: "老释义" }, {});
  assert.equal(r.usingPreferred, false);
  assert.match(r.meaningHtml, /老释义/);
});
