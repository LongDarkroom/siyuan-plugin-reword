/**
 * difficulty.ts 单元测试（自研 SRS 难度维度）
 * 纯函数，无 DOM / 思源依赖，可独立运行。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lengthFactor,
  polysemyFactor,
  rarityFactor,
  awlFactor,
  computeDifficulty,
  setFrequencyData,
  setAwlData,
} from "../src/review/difficulty.ts";

test("lengthFactor: 3 字母及以下为 0，13 字母及以上为 1", () => {
  assert.equal(lengthFactor("cat"), 0); // 3
  assert.equal(lengthFactor("dog"), 0); // 3
  assert.equal(lengthFactor("hello"), 0.2); // 5 -> (5-3)/10
  assert.equal(lengthFactor("antidisestablishment"), 1); // 20 -> clamp 1
});

test("lengthFactor: 忽略非字母字符", () => {
  assert.equal(lengthFactor("don't"), 0.1); // d,o,n,t = 4 -> (4-3)/10
  assert.equal(lengthFactor("a.b.c"), 0); // a,b,c = 3 -> 0
  assert.equal(lengthFactor("co-operate"), 0.6); // 9 字母 -> (9-3)/10
});

test("polysemyFactor: 缺/非正回退中性 0.3，8 义项记满", () => {
  assert.equal(polysemyFactor(undefined), 0.3);
  assert.equal(polysemyFactor(0), 0.3);
  assert.equal(polysemyFactor(-3), 0.3);
  assert.equal(polysemyFactor(4), 0.5); // 4/8
  assert.equal(polysemyFactor(8), 1);
  assert.equal(polysemyFactor(20), 1); // clamp
});

test("rarityFactor: 按排名归一化，无数据回退中性 0.5", () => {
  assert.equal(rarityFactor("word", 0), 0);
  assert.equal(rarityFactor("word", 10000), 0.5);
  assert.equal(rarityFactor("word", 20000), 1);
  assert.equal(rarityFactor("word", 50000), 1); // clamp
  assert.equal(rarityFactor("word"), 0.5); // 无 rank 无表
});

test("rarityFactor: 注入词频表后生效", () => {
  setFrequencyData(new Map([["apple", 100], ["zebra", 19000]]));
  assert.equal(rarityFactor("apple"), 100 / 20000); // 0.005
  assert.equal(rarityFactor("zebra"), 19000 / 20000); // 0.95
  assert.equal(rarityFactor("unknown"), 0.5); // 表中无 -> 中性
});

test("awlFactor: 命中 1，否则 0；无数据回退 0", () => {
  assert.equal(awlFactor("analysis", true), 1);
  assert.equal(awlFactor("cat", false), 0);
  assert.equal(awlFactor("cat"), 0); // 无表无 flag
});

test("awlFactor: 注入 AWL 表后生效", () => {
  setAwlData(new Set(["analysis", "theory"]));
  assert.equal(awlFactor("analysis"), 1);
  assert.equal(awlFactor("theory"), 1);
  assert.equal(awlFactor("cat"), 0);
});

test("computeDifficulty: 默认中性（rarity 0.5, awl 0, poly 0.3）", () => {
  const r = computeDifficulty("cat"); // length 0
  assert.equal(r.rarity, 0.5);
  assert.equal(r.lengthFactor, 0);
  assert.equal(r.awlScore, 0);
  assert.equal(r.polysemy, 0.3);
  assert.equal(r.difficulty, 0.235); // 0.35*0.5 + 0.2*0.2*0 + ... = 0.175 + 0.06
});

test("computeDifficulty: 全维度注入", () => {
  const r = computeDifficulty("hello", {
    senseCount: 8,
    frequencyRank: 10000,
    awlHit: true,
  });
  // length 5 -> 0.2; rarity 0.5; awl 1; poly 1
  // 0.35*0.5 + 0.25*0.2 + 0.2*1 + 0.2*1 = 0.175 + 0.05 + 0.2 + 0.2 = 0.625
  assert.equal(r.lengthFactor, 0.2);
  assert.equal(r.rarity, 0.5);
  assert.equal(r.awlScore, 1);
  assert.equal(r.polysemy, 1);
  assert.equal(r.difficulty, 0.625);
});
