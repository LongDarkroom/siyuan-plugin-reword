/**
 * LearningStatus 常量测试（2026-08-22 新增,plan §测试文件 2,≥3 case）
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  LearningStatus,
  LEARNING_STATUS_COLORS,
  LEARNING_STATUS_LABELS,
} from "../src/types.ts";

test("LearningStatus:三态值正确(learning/mastered/review)", () => {
  assert.equal(LearningStatus.Learning, "learning");
  assert.equal(LearningStatus.Mastered, "mastered");
  assert.equal(LearningStatus.Review, "review");
  // 三态值必须互不重复
  const values = new Set(Object.values(LearningStatus));
  assert.equal(values.size, 3, "LearningStatus 应该有 3 个不同值");
});

test("LEARNING_STATUS_COLORS:三色对应(黄/绿/紫)", () => {
  assert.equal(LEARNING_STATUS_COLORS[LearningStatus.Learning], "#facc15", "黄 #facc15");
  assert.equal(LEARNING_STATUS_COLORS[LearningStatus.Mastered], "#22c55e", "绿 #22c55e");
  assert.equal(LEARNING_STATUS_COLORS[LearningStatus.Review], "#8b5cf6", "紫 #8b5cf6");
  // 三个 key 都要有映射
  for (const s of Object.values(LearningStatus)) {
    assert.ok(LEARNING_STATUS_COLORS[s], `状态 ${s} 缺颜色映射`);
  }
});

test("LEARNING_STATUS_LABELS:中文文案(未掌握/已掌握/需复习)", () => {
  assert.equal(LEARNING_STATUS_LABELS[LearningStatus.Learning], "未掌握");
  assert.equal(LEARNING_STATUS_LABELS[LearningStatus.Mastered], "已掌握");
  assert.equal(LEARNING_STATUS_LABELS[LearningStatus.Review], "需复习");
  for (const s of Object.values(LearningStatus)) {
    assert.ok(LEARNING_STATUS_LABELS[s], `状态 ${s} 缺文案`);
  }
});
