/**
 * review-data 数据接入层测试（自研 SRS 的「数据获取接口」落地）
 * 验证：initReviewData 真正把 AWL 学术词表与【全量真实词频表】注入 difficulty 模块。
 * 注意：本文件独立进程运行；initReviewData 会改写模块级配置（frequencyCorpusSize 同步为表长）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initReviewData } from "../src/review/review-data.ts";
import { rarityFactor, awlFactor, computeDifficulty } from "../src/review/difficulty.ts";
import { getReviewConfig } from "../src/review/config.ts";
import { FREQUENCY_FULL_COUNT } from "../src/review/data/frequency-full.ts";

test("initReviewData 注入 AWL 学术词表", () => {
  initReviewData();
  assert.equal(awlFactor("analysis"), 1); // AWL 词
  assert.equal(awlFactor("theory"), 1); // AWL 词
  assert.equal(awlFactor("cat"), 0); // 非 AWL
  assert.equal(awlFactor("the"), 0); // 非 AWL
});

test("initReviewData 注入全量真实词频表（rarity 维度有料）", () => {
  initReviewData();
  // 全量表已加载：归一化规模应为表长（≈49644），而非旧的 20000 种子规模
  assert.equal(getReviewConfig().frequencyCorpusSize, FREQUENCY_FULL_COUNT);
  // "the" 是最高频词之一（rank≈3），rarity 极小
  assert.ok(rarityFactor("the") < 0.01, `the 的 rarity 应极小，实际=${rarityFactor("the")}`);
  // 越稀有 rarity 越大；serendipity 远稀有于 the（不在表→中性 0.5，或在表→高位）
  assert.ok(rarityFactor("serendipity") > rarityFactor("the"));
});

test("computeDifficulty 现在吃到 awl + 全量词频（多维度合成）", () => {
  initReviewData();
  const r = computeDifficulty("analysis", { senseCount: 4 });
  assert.equal(r.awlScore, 1);
  assert.ok(r.difficulty > 0.2, "命中 AWL 应显著抬高难度");
  // 最高频词 the 的难度应明显低于生僻学术词
  const rt = computeDifficulty("the", { senseCount: 1 });
  assert.ok(rt.difficulty < r.difficulty, "高频词难度应低于学术生僻词");
});
