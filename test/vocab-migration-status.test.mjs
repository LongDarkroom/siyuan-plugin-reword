// 2026-09-11 新增：VocabBook.status / source 老数据迁移测试
// 覆盖：
//   - 老数据缺 status → 默认 'verified'（已建好的词书默认进复习）
//   - 老数据缺 source → 默认 'manual'
//   - 老数据缺 verifiedAt → 用 firstWord.created 兜底
//   - 老数据 verifiedWordCount 默认 = 当前词数
//   - 幂等（load 两次结果一致）

import { test } from "node:test";
import assert from "node:assert/strict";
import { VocabStore } from "../src/vocab/vocab-store.ts";
import { BookStatus, BookSource } from "../src/types.ts";

test("migration: 老数据缺 status → 默认 'verified'", () => {
  const s = new VocabStore();
  s.load({
    books: [
      { id: "b1", name: "B1", order: 0, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  // 加载后 ensureBookStatus 已跑
  const b = s.getBook("b1");
  assert.ok(b);
  assert.equal(b.status, BookStatus.Verified);
});

test("migration: 老数据缺 source → 默认 'manual'", () => {
  const s = new VocabStore();
  s.load({
    books: [
      { id: "b1", name: "B1", order: 0, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  assert.equal(s.getBook("b1").source, BookSource.Manual);
});

test("migration: 老数据 verifiedAt → 用 firstWord.created", () => {
  const s = new VocabStore();
  const createdISO = "2026-08-15T10:00:00.000Z";
  s.load({
    books: [
      {
        id: "b1",
        name: "B1",
        order: 0,
        themes: [{
          id: "t1",
          name: "未分类",
          order: 0,
          words: [{
            id: "w1",
            word: "apple",
            phonetic: "",
            pos: "",
            meaning: "",
            mastery: 0,
            status: "active",
            labels: [],
            created: createdISO,
            updated: createdISO,
            order: 0,
          }],
        }],
      },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  assert.equal(s.getBook("b1").verifiedAt, createdISO);
});

test("migration: 老数据无 verifiedAt 且无 firstWord → 用 epoch 0 兜底", () => {
  const s = new VocabStore();
  s.load({
    books: [
      { id: "b1", name: "B1", order: 0, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  // 空 book → fallback 到 epoch 0
  assert.equal(s.getBook("b1").verifiedAt, new Date(0).toISOString());
});

test("migration: verifiedWordCount 默认 = 当前词数", () => {
  const s = new VocabStore();
  s.load({
    books: [
      {
        id: "b1", name: "B1", order: 0,
        themes: [
          { id: "t1", name: "未分类", order: 0, words: [
            { id: "w1", word: "a", phonetic: "", pos: "", meaning: "", mastery: 0, status: "active", labels: [], created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", order: 0 },
            { id: "w2", word: "b", phonetic: "", pos: "", meaning: "", mastery: 0, status: "active", labels: [], created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", order: 1 },
            { id: "w3", word: "c", phonetic: "", pos: "", meaning: "", mastery: 0, status: "active", labels: [], created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z", order: 2 },
          ]},
        ],
      },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  assert.equal(s.getBook("b1").verifiedWordCount, 3);
});

test("migration: 已显式标 status='draft' 不被改", () => {
  const s = new VocabStore();
  s.load({
    books: [
      { id: "b1", name: "B1", order: 0, status: "draft", source: "doc-parsed", themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  // 已显式标 draft → 不被覆盖为 verified
  assert.equal(s.getBook("b1").status, "draft");
  // 但 source 缺失 → 补 manual（即使 draft 也补 source，因为 source 独立）
  assert.equal(s.getBook("b1").source, "doc-parsed"); // 已显式设置，不被覆盖
});

test("migration: 已有 status='verified' 时 verifiedAt 不被覆盖", () => {
  const s = new VocabStore();
  const existingVerifiedAt = "2026-09-10T12:00:00.000Z";
  s.load({
    books: [
      { id: "b1", name: "B1", order: 0, status: "verified", verifiedAt: existingVerifiedAt, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  assert.equal(s.getBook("b1").verifiedAt, existingVerifiedAt);
});

test("migration: 草稿本不写 verifiedAt（只 verified 才写）", () => {
  const s = new VocabStore();
  s.load({
    books: [
      { id: "b1", name: "B1", order: 0, status: "draft", themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  });
  // 草稿本不写 verifiedAt
  assert.equal(s.getBook("b1").verifiedAt, undefined);
});

test("migration: 幂等（连续 load 两次结果一致）", () => {
  const raw = {
    books: [
      { id: "b1", name: "B1", order: 0, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] },
    ],
    activeBookId: "b1",
    activeThemeId: "t1",
    reviewEvents: [],
  };
  const s1 = new VocabStore();
  s1.load(raw);
  const b1After1 = JSON.stringify(s1.getBook("b1"));
  // 重新构造一个 store,再 load
  const s2 = new VocabStore();
  s2.load(JSON.parse(JSON.stringify(s1.export())));
  const b1After2 = JSON.stringify(s2.getBook("b1"));
  assert.equal(b1After1, b1After2);
});
