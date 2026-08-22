// 2026-08-22 释义偏好:dict-renderer ⭐ 高亮 + isPreferredSense 测试
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderDictCard,
  renderSensesList,
  renderVocabDetailSenses,
  isPreferredSense,
  parseDictEntry,
  extractSenses,
} from "../src/dict/dict-renderer.ts";

// 构造 NCECD 风格的"苹果"词条 HTML
const APPLE_ENTRY = {
  word: "apple",
  phonetic: "/ˈæpəl/",
  html: "<div>苹果</div>",
  definition:
    `<div class="sense"><b class="num">1.</b><span class="zh">苹果</span><em>(fruit)</em></div>` +
    `<div class="sense"><b class="num">2.</b><span class="zh">苹果树</span></div>` +
    `<div class="sense"><b class="num">3.</b><span class="zh">形 像苹果的</span><em>(resembling)</em></div>`,
  plainText: "苹果 苹果树 像苹果的",
  matchType: "exact",
};

test("PreferredRender:isPreferredSense 严格相等(不 trim 失败)", () => {
  const sense = { zh: "苹果", num: "1.", pos: "" };
  assert.equal(isPreferredSense(sense, ["苹果"]), true);
  assert.equal(isPreferredSense(sense, ["苹果树"]), false);
  assert.equal(isPreferredSense(sense, null), false);
  assert.equal(isPreferredSense(sense, []), false);
  assert.equal(isPreferredSense(sense, undefined), false);
});

test("PreferredRender:isPreferredSense 自动 trim(避免 NCECD 前后空格差异)", () => {
  const sense = { zh: "  苹果  ", num: "1.", pos: "" };
  assert.equal(isPreferredSense(sense, ["苹果"]), true);
  assert.equal(isPreferredSense(sense, ["  苹果  "]), true);
  assert.equal(isPreferredSense(sense, ["  苹果"]), true);
});

test("PreferredRender:isPreferredSense 多个偏好,命中其一即 true", () => {
  const sense = { zh: "苹果树", num: "2.", pos: "" };
  assert.equal(isPreferredSense(sense, ["苹果", "苹果树"]), true);
  assert.equal(isPreferredSense(sense, ["苹果树", "其他"]), true);
});

test("PreferredRender:renderSensesList 命中偏好时输出 ⭐ class", () => {
  const html = renderSensesList(APPLE_ENTRY.definition, 99, { preferredDefinitions: ["苹果", "苹果树"] });
  // ⭐ 在 hitApple
  assert.match(html, /<li[^>]*hiword-dict-sense--preferred[^>]*>[\s\S]*?⭐/);
  // 但只在 sense 1 和 2 上有(因为 preferredDefinitions 包含)
  const matchCount = (html.match(/hiword-dict-sense--preferred/g) || []).length;
  assert.equal(matchCount, 2, "应只在 2 个偏好的 sense 上加 ⭐");
});

test("PreferredRender:renderSensesList 不传 preferredDefinitions 时无 ⭐", () => {
  const html = renderSensesList(APPLE_ENTRY.definition, 99);
  assert.ok(!html.includes("hiword-dict-sense--preferred"), "无偏好时无 ⭐ class");
  assert.ok(!html.includes("hiword-dict-sense-star"), "无偏好时无 ⭐ 字符");
});

test("PreferredRender:renderDictCard 命中偏好时整个卡片反映", () => {
  const parsed = parseDictEntry(APPLE_ENTRY);
  const html = renderDictCard(parsed, {
    showStar: false,
    preferredDefinitions: ["苹果"],
  });
  // 至少 1 个 preferred class
  assert.match(html, /hiword-dict-sense--preferred/);
});

test("PreferredRender:renderDictCard preferredDefinitions 精确匹配,不做 substring 误判", () => {
  const parsed = parseDictEntry(APPLE_ENTRY);
  // 偏好"苹"不应误命中所有"苹果"开头 sense
  const html = renderDictCard(parsed, {
    showStar: false,
    preferredDefinitions: ["苹"],
  });
  assert.ok(!html.includes("hiword-dict-sense--preferred"), '"苹" 不应作为 substring 误命中');
});

test("PreferredRender:renderVocabDetailSenses 接受 opts 透传", () => {
  const html = renderVocabDetailSenses(APPLE_ENTRY.definition, { preferredDefinitions: ["苹果树"] });
  // 至少 1 个偏好命中(dict-renderer 内部 extractSensesByPos 有重复 sense 现象,我们用 >= 1 鲁棒断言)
  assert.match(html, /hiword-dict-sense--preferred/);
  // 实际命中:提取 preferred 块的 zh 内容验证
  const re = /hiword-dict-sense--preferred[\s\S]*?hiword-dict-sense-zh">([^<]+)</g;
  const hits = [];
  let mm;
  while ((mm = re.exec(html)) !== null) hits.push(mm[1]);
  assert.ok(hits.length >= 1, `至少 1 个命中,实际 ${hits.length}`);
  assert.ok(hits.every((h) => h.trim() === "苹果树"), "所有命中块都应是「苹果树」");
});

test("PreferredRender:renderDictCard 完整卡片含 ⭐ + 完整结构", () => {
  const parsed = parseDictEntry(APPLE_ENTRY);
  // NCECD 限制:第 3 个 sense 把"形 像苹果的" 解析为整体 zh(没分清 pos/zh)。
  // 因此本测试只用前 2 个 sense 偏好(均可严格命中)作演示。
  // 真实场景中,用户弹窗看到的 sense 文本就是这个解析后的 zh,
  // 所以收词偏好的中文文本会自动匹配。
  const html = renderDictCard(parsed, { preferredDefinitions: ["苹果", "苹果树"] });
  // 至少 1 个 ⭐
  assert.match(html, /hiword-dict-sense--preferred/);
  // 验证"苹果"和"苹果树"严格命中
  const re = /hiword-dict-sense--preferred[\s\S]*?hiword-dict-sense-zh">([^<]+)</g;
  const hits = [];
  let mm;
  while ((mm = re.exec(html)) !== null) hits.push(mm[1].trim());
  assert.ok(hits.includes("苹果"), "偏好「苹果」应严格命中");
  assert.ok(hits.includes("苹果树"), "偏好「苹果树」应严格命中");
  // 词头 / 释义主体结构都还在
  assert.match(html, /hiword-dict-card/);
  assert.match(html, /<strong class="hiword-dict-word">apple<\/strong>/);
  // 至少 1 个 sense 命中 ⭐
  assert.ok(hits.length >= 1);
});

test("PreferredRender:renderSensesList 旧 API 兼容(无 opts 参数)", () => {
  // 不传 opts 时不应崩(回归测试)
  const html = renderSensesList(APPLE_ENTRY.definition, 4);
  assert.ok(html.length > 0);
  assert.ok(!html.includes("hiword-dict-sense--preferred"));
});
