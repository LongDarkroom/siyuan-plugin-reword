// 2026-09-11 Step 9.1 新增：旧 hiword-vocab.json 真实数据迁移集成测试
// 用真实部署版的旧数据 (.bak.20260911) 加载，验证：
//   - 老数据缺 status 字段 → 全部迁为 'verified'
//   - 老数据缺 source 字段 → 全部迁为 'manual'
//   - 老数据缺 verifiedAt → 用最早词的 created 兜底
//   - byWord 反向索引正常
//   - getReviewableBooks() 全部返
//   - getAllLabels() 聚合（即使没 labelsStore 也跑）
//   - 迁移后 export() 序列化反序列化一致

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { VocabStore } from "../src/vocab/vocab-store.ts";
import { BookStatus, BookSource } from "../src/types.ts";

const BAK_PATH = "/Users/xieyue/Downloads/思源笔记/data/storage/petal/siyuan-plugin-reword/hiword-vocab.json.bak.20260911";

test.skip("真实旧数据存在性（CI 跳过：仅本地可跑）", () => {
  if (!fs.existsSync(BAK_PATH)) {
    console.log("⚠ 跳过：备份文件不存在（生产 CI 不可用）");
  }
  assert.ok(fs.existsSync(BAK_PATH), "本地应存在 .bak.20260911");
});

test("真实旧数据迁移: 加载 + 字段补全", () => {
  if (!fs.existsSync(BAK_PATH)) {
    console.log("⚠ 跳过：备份文件不存在");
    return;
  }
  const raw = JSON.parse(fs.readFileSync(BAK_PATH, "utf8"));
  const s = new VocabStore();
  s.load(raw);

  const books = s.getBooks().filter(b => b.id !== "__all__");
  assert.ok(books.length > 0, "应有书本");

  for (const b of books) {
    assert.equal(b.status, BookStatus.Verified, `${b.name} 缺 status 应迁为 verified`);
    assert.equal(b.source, BookSource.Manual, `${b.name} 缺 source 应迁为 manual`);
    if (b.status === BookStatus.Verified) {
      assert.ok(b.verifiedAt, `${b.name} 缺 verifiedAt`);
      assert.ok(!isNaN(Date.parse(b.verifiedAt)), `${b.name} verifiedAt 应可解析`);
      assert.ok(b.verifiedWordCount !== undefined, `${b.name} 缺 verifiedWordCount`);
    }
  }
});

test("真实旧数据迁移: byWord 索引 + getAllWords 一致", () => {
  if (!fs.existsSync(BAK_PATH)) {
    console.log("⚠ 跳过");
    return;
  }
  const raw = JSON.parse(fs.readFileSync(BAK_PATH, "utf8"));
  const s = new VocabStore();
  s.load(raw);

  const allWords = s.getAllWords();
  // 任意抽查 5 个词都能通过 findRecord 找到
  const samples = allWords.slice(0, 5);
  for (const w of samples) {
    const rec = s.findRecord(w.word);
    assert.ok(rec, `${w.word} 应在 byWord 索引中`);
    assert.equal(rec.word, w.word);
  }
});

test("真实旧数据迁移: getReviewableBooks 全部返", () => {
  if (!fs.existsSync(BAK_PATH)) {
    console.log("⚠ 跳过");
    return;
  }
  const raw = JSON.parse(fs.readFileSync(BAK_PATH, "utf8"));
  const s = new VocabStore();
  s.load(raw);

  const reviewable = s.getReviewableBooks();
  const all = s.getBooks().filter(b => b.id !== "__all__");
  assert.equal(reviewable.length, all.length, "老数据全 verified → 全部进 reviewable");
});

test("真实旧数据迁移: 序列化反序列化一致（幂等）", () => {
  if (!fs.existsSync(BAK_PATH)) {
    console.log("⚠ 跳过");
    return;
  }
  const raw = JSON.parse(fs.readFileSync(BAK_PATH, "utf8"));
  const s1 = new VocabStore();
  s1.load(raw);
  const exported1 = JSON.stringify(s1.export());

  // 重新构造 + load
  const s2 = new VocabStore();
  s2.load(JSON.parse(exported1));
  const exported2 = JSON.stringify(s2.export());

  // 允许 reviewEvents 末尾有 created 时间差，但结构一致
  const r1 = JSON.parse(exported1);
  const r2 = JSON.parse(exported2);
  assert.equal(r1.books.length, r2.books.length);
  for (let i = 0; i < r1.books.length; i++) {
    assert.equal(r1.books[i].status, r2.books[i].status);
    assert.equal(r1.books[i].source, r2.books[i].source);
  }
});

test("真实旧数据迁移: getAllLabels 不报错（无 labelsStore 也跑）", () => {
  if (!fs.existsSync(BAK_PATH)) {
    console.log("⚠ 跳过");
    return;
  }
  const raw = JSON.parse(fs.readFileSync(BAK_PATH, "utf8"));
  const s = new VocabStore();  // 不传 labelsStore
  s.load(raw);

  const labels = s.getAllLabels();
  assert.ok(Array.isArray(labels));
  // 老数据可能没 labels，但 getAllLabels 应该返空数组或默认色
  for (const l of labels) {
    assert.ok(l.name);
    assert.ok(typeof l.wordCount === "number");
    assert.ok(l.color);
  }
});

// ============ 旧数据硬编码 mock（CI 也能跑）==========
test("mock 旧数据 v1 (2025-Q4 之前的 schema): status/source/verifiedAt 全部缺失", () => {
  const mockOldV1 = {
    books: [
      {
        id: "bk-old1", name: "TOEFL 老词库", order: 0,
        themes: [{
          id: "th-1", name: "未分类", order: 0,
          words: [
            { id: "w1", word: "abandon", phonetic: "/x/", pos: "v.", meaning: "放弃",
              mastery: 0, status: "active", labels: ["高频"],
              created: "2025-10-01T00:00:00.000Z", updated: "2025-10-01T00:00:00.000Z", order: 0 },
            { id: "w2", word: "benevolent", phonetic: "", pos: "", meaning: "仁慈",
              mastery: 0, status: "active", labels: [],
              created: "2025-10-02T00:00:00.000Z", updated: "2025-10-02T00:00:00.000Z", order: 1 },
          ],
        }],
      },
    ],
    activeBookId: "bk-old1",
    activeThemeId: "th-1",
    reviewEvents: [],
  };
  const s = new VocabStore();
  s.load(mockOldV1);
  const b = s.getBook("bk-old1");
  assert.equal(b.status, "verified");
  assert.equal(b.source, "manual");
  assert.equal(b.verifiedAt, "2025-10-01T00:00:00.000Z");
  assert.equal(b.verifiedWordCount, 2);
});

test("mock 旧数据 v2 (2026-Q1 之前): 部分字段已存在", () => {
  const mockOldV2 = {
    books: [
      {
        id: "bk-old2", name: "CET-4", order: 0,
        status: "verified",  // 部分老数据已标 verified
        themes: [{ id: "th-1", name: "未分类", order: 0, words: [] }],
      },
    ],
    activeBookId: "bk-old2",
    activeThemeId: "th-1",
    reviewEvents: [],
  };
  const s = new VocabStore();
  s.load(mockOldV2);
  const b = s.getBook("bk-old2");
  assert.equal(b.status, "verified");
  assert.equal(b.source, "manual");
});

test("mock 旧数据 v3: 已有 source='doc-parsed' 不被覆盖", () => {
  const mockOldV3 = {
    books: [
      { id: "bk", name: "X", order: 0, status: "draft", source: "doc-parsed",
        themes: [{ id: "t", name: "未分类", order: 0, words: [] }] },
    ],
    activeBookId: "bk",
    activeThemeId: "t",
    reviewEvents: [],
  };
  const s = new VocabStore();
  s.load(mockOldV3);
  const b = s.getBook("bk");
  assert.equal(b.status, "draft");
  assert.equal(b.source, "doc-parsed");
});
