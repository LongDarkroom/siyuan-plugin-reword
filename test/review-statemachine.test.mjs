/**
 * 状态机 Archived/Ignored 单元测试（自研 SRS 的毕业/忽略转移）
 * 通过 VocabStore 验证：archive / ignore / reactivate 改变 status，
 * 并同步影响复习候选队列与 getWordsByStatus；ensureDifficulties 回填难度。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { VocabStore } from "../src/vocab/vocab-store.ts";
import { WordStatus } from "../src/types.ts";

function newStore() {
  const store = new VocabStore(() => {});
  store.load(null); // 触发默认单词本 + 未分类主题
  return store;
}

test("状态机：archive / ignore / reactivate 改变 status 并同步复习候选", async () => {
  const store = newStore();
  const { added, record } = await store.addWord("apple", { meaning: "苹果" });
  assert.equal(added, true);
  assert.equal(record.status, WordStatus.Active);
  assert.equal(store.getReviewCandidates().length, 1);

  await store.archiveWord("apple");
  assert.equal(store.findRecord("apple").status, WordStatus.Archived);
  assert.equal(store.getReviewCandidates().length, 0, "归档后移出复习队列");
  assert.equal(store.getWordsByStatus(WordStatus.Archived).length, 1);

  await store.ignoreWord("apple");
  assert.equal(store.findRecord("apple").status, WordStatus.Ignored);
  assert.equal(store.getWordsByStatus(WordStatus.Ignored).length, 1);

  await store.reactivateWord("apple");
  assert.equal(store.findRecord("apple").status, WordStatus.Active);
  assert.equal(store.getReviewCandidates().length, 1, "恢复后回到复习队列");
});

test("ensureDifficulties: 为缺难度字段的旧词补算并写入", async () => {
  const store = newStore();
  await store.addWord("banana");
  const rec = store.findRecord("banana");
  // 模拟升级前旧词库：无 difficulty（addWord 已算，这里人为清空）
  rec.difficulty = undefined;
  const n = await store.ensureDifficulties();
  assert.equal(n, 1);
  assert.equal(typeof store.findRecord("banana").difficulty, "number");
});

test("addWord 收词时即缓存 difficulty 与 senseCount", async () => {
  const store = newStore();
  await store.addWord("elephant", { senseCount: 6 });
  const rec = store.findRecord("elephant");
  assert.equal(rec.senseCount, 6);
  assert.equal(typeof rec.difficulty, "number");
});
