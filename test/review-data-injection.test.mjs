// 5.1 补强测试：可观测 API + AWL 词表扩展
// 覆盖：
//   - isFrequencyDataInjected / isAwlDataInjected 在未注入/已注入时的正确性
//   - getReviewDataStatus 返回值与 corpusSize / frequencySource 的推断
//   - isReviewDataReady 在两个维度都注入后才返回 true
//   - AWL_WORDS_UNIQUE 去重（避免子表重复词族污染）
//   - 注入 Sublist 1 学术词后,awlFactor 命中 = 1

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setFrequencyData,
  setAwlData,
  isFrequencyDataInjected,
  isAwlDataInjected,
  __resetInjectedDataForTest,
  computeDifficulty,
} from "../src/review/difficulty.ts";
import {
  initReviewData,
  getReviewDataStatus,
  isReviewDataReady,
  __resetReviewDataForTest,
} from "../src/review/review-data.ts";
import { setReviewConfig } from "../src/review/config.ts";
import { AWL_WORDS_UNIQUE, AWL_WORDS } from "../src/review/data/awl.ts";

test("5.1 注入前:isAwlDataInjected/isFrequencyDataInjected 都为 false", () => {
  __resetInjectedDataForTest();
  assert.equal(isAwlDataInjected(), false);
  assert.equal(isFrequencyDataInjected(), false);
});

test("5.1 注入 AWL 后:isAwlDataInjected=true,未注入词频", () => {
  __resetInjectedDataForTest();
  setAwlData(new Set(["analyse", "approach"]));
  assert.equal(isAwlDataInjected(), true);
  assert.equal(isFrequencyDataInjected(), false);
});

test("5.1 注入词频后:isFrequencyDataInjected=true", () => {
  __resetInjectedDataForTest();
  setFrequencyData(new Map([["hello", 100]]));
  assert.equal(isFrequencyDataInjected(), true);
});

test("5.1 initReviewData 后:getReviewDataStatus 报告 full 词频 + awl=true", () => {
  __resetInjectedDataForTest();
  __resetReviewDataForTest();
  initReviewData();
  const s = getReviewDataStatus();
  assert.equal(s.awl, true, "awl 应已注入");
  assert.equal(s.frequency, true, "词频应已注入");
  // 全量词频 ≈ 5 万,corpusSize 应与 FREQUENCY_FULL_COUNT 一致
  assert.ok(s.corpusSize >= 1000, `corpusSize 应为全量规模,实际 ${s.corpusSize}`);
  assert.equal(s.frequencySource, "full", "应识别为 full 词频源");
  assert.equal(isReviewDataReady(), true);
});

test("5.1 注入回退种子后:frequencySource 应识别为 seed", () => {
  __resetInjectedDataForTest();
  __resetReviewDataForTest();
  // 显式重置 corpusSize（前面测试副作用会把全量规模留下）
  setReviewConfig({ frequencyCorpusSize: 0 });
  setAwlData(new Set(["analyse"]));
  setFrequencyData(new Map(Array.from({ length: 100 }, (_, i) => [`w${i}`, i + 1])));
  const s = getReviewDataStatus();
  assert.equal(s.frequency, true);
  assert.equal(s.frequencySource, "seed", "100 词以下应识别为 seed 源");
});

test("5.1 注入失败回退:none 源", () => {
  __resetInjectedDataForTest();
  const s = getReviewDataStatus();
  assert.equal(s.frequency, false);
  assert.equal(s.frequencySource, "none");
  assert.equal(isReviewDataReady(), false);
});

test("5.1 AWL_WORDS 扩到 Sublist 1~3 完整版:词族数 ≥ 150 且去重", () => {
  assert.ok(AWL_WORDS.length >= 150, `AWL_WORDS 至少 150 词,实际 ${AWL_WORDS.length}`);
  // UNIQUE 应等于 LEN(去重后)
  assert.equal(AWL_WORDS_UNIQUE.length, new Set(AWL_WORDS.map((w) => w.toLowerCase())).size);
  // Sublist 1 关键学术词必须命中
  for (const must of ["analyse", "approach", "evidence", "research", "theory", "significant"]) {
    assert.ok(AWL_WORDS_UNIQUE.includes(must), `Sublist 1 必含: ${must}`);
  }
  // Sublist 3 抽检
  for (const must of ["adequate", "component", "demonstrate", "implement", "hypothesis"]) {
    assert.ok(AWL_WORDS_UNIQUE.includes(must), `Sublist 3 必含: ${must}`);
  }
});

test("5.1 扩词后:awlFactor 命中常用学术词 = 1", () => {
  __resetInjectedDataForTest();
  setAwlData(new Set(AWL_WORDS_UNIQUE));
  const d = computeDifficulty("analyse");
  // awlScore=1,rarity=0.5(无词频),length=0,poly=0.3
  assert.equal(d.awlScore, 1, "analyse 应命中 AWL");
  const d2 = computeDifficulty("banana");
  assert.equal(d2.awlScore, 0, "banana 不在 AWL 中");
});

test("5.1 注入失败:awl 表大小为 0 仍能保持 rarity/length 维度可用", () => {
  __resetInjectedDataForTest();
  // 仅注入词频,awl 保持 null
  setFrequencyData(new Map([["cat", 5]]));
  const d = computeDifficulty("cat");
  assert.equal(d.awlScore, 0, "awl 未注入时=0");
  // rarity 用 corpusSize 归一化(默认 20000)
  assert.ok(d.rarity >= 0 && d.rarity <= 1);
  assert.ok(d.difficulty >= 0 && d.difficulty <= 1);
});
