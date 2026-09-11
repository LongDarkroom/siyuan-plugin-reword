// 2026-09-11 Step 9.3 新增：P0 端到端集成测试
// 模拟完整流程：文档解析 → 词书生成（draft） → 校验入库（verified） → 复习可用
//
// 流程：
//   1. 模拟文档内容（markdown 表格）
//   2. 调 autoParse 解析
//   3. 校验 ParsedWord[] 数量 + 字段
//   4. 新建 VocabBook（status=draft, source=doc-parsed）
//   5. 批量 addWord
//   6. getReviewableBooks() 返空（草稿本不参与）
//   7. verifyBook() → status=verified
//   8. getReviewableBooks() 返该本
//   9. 标签全局管理 6 方法（renameLabel / mergeLabels / deleteLabel）
//  10. 复习数据准备（设 due/lastReview + ensureDifficulties）

import { test } from "node:test";
import assert from "node:assert/strict";
import { autoParse, cleanParsed } from "../src/vocab/parser/index.ts";
import { VocabStore } from "../src/vocab/vocab-store.ts";
import { VocabLabelsStore } from "../src/vocab/labels-store.ts";
import { BookStatus, BookSource } from "../src/types.ts";
import { getDueQueue, nextReviewState, priorityOf } from "../src/review/scheduler.ts";

// 1. 解析文档内容
const DOC_CONTENT = `
| word | phonetic | meaning | example |
|------|----------|---------|---------|
| abandon | /əˈbændən/ | 放弃 | He abandoned his car. |
| benevolent | /bəˈnevələnt/ | 仁慈 | She is benevolent. |
| cognitive | /ˈkɒɡnətɪv/ | 认知 | Cognitive development. |
| deliberate | /dɪˈlɪbərət/ | 故意的 | A deliberate decision. |
| eloquent | /ˈeləkwənt/ | 雄辩的 | An eloquent speech. |
`.trim();

test("e2e Step A: 解析文档 → 5 个有效词", () => {
  const result = autoParse(DOC_CONTENT);
  assert.ok(result, "应识别为 table 格式");
  assert.equal(result.result.format, "table");
  assert.equal(result.result.words.length, 5);
  assert.equal(result.cleaned.rawCount, 5);
  assert.equal(result.cleaned.skipped.length, 0);
  // 字段完整
  const w = result.result.words[0];
  assert.equal(w.word, "abandon");
  assert.equal(w.phonetic, "/əˈbændən/");
  assert.equal(w.meaning, "放弃");
  assert.equal(w.example, "He abandoned his car.");
});

test("e2e Step B: 草稿词书创建 + 词批量入库", async () => {
  const result = autoParse(DOC_CONTENT);
  const s = new VocabStore();
  s.load({ books: [{ id: "default", name: "我的单词本", order: 0, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] }], activeBookId: "default", activeThemeId: "t1", reviewEvents: [] });

  // 新建草稿词书
  const book = await s.addBook("E2E 词书");
  book.status = BookStatus.Draft;
  book.source = BookSource.DocParsed;
  book.importMeta = {
    format: result.result.format,
    locator: "test-doc",
    rawCount: result.cleaned.rawCount,
    dedupedCount: result.result.words.length,
    skippedCount: result.cleaned.skipped.length,
    importedAt: new Date().toISOString(),
  };
  const theme = book.themes[0];
  for (const w of result.result.words) {
    await s.addWord(w.word, { phonetic: w.phonetic, meaning: w.meaning, example: w.example }, book.id, theme.id);
  }
  assert.equal(book.themes[0].words.length, 5);
});

test("e2e Step C: 草稿本不进 getReviewableBooks", async () => {
  const s = new VocabStore();
  s.load({ books: [{ id: "default", name: "我的单词本", order: 0, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] }], activeBookId: "default", activeThemeId: "t1", reviewEvents: [] });
  const book = await s.addBook("草稿");
  book.status = BookStatus.Draft;
  // 草稿本不参与复习：但 default 书本是 verified 应在 reviewable 里
  // 所以检查"特定草稿本不在 reviewable" 而非"reviewable.length === 0"
  const reviewable = s.getReviewableBooks();
  assert.equal(reviewable.find(b => b.id === book.id), undefined, "草稿本不应在 reviewable 列表");
  assert.equal(s.getBook(book.id).status, BookStatus.Draft);
});

test("e2e Step D: verifyBook 后进 reviewable", async () => {
  const s = new VocabStore();
  s.load({ books: [{ id: "default", name: "我的单词本", order: 0, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] }], activeBookId: "default", activeThemeId: "t1", reviewEvents: [] });
  const book = await s.addBook("待校验");
  book.status = BookStatus.Draft;
  // 校验前：该 book 不在 reviewable
  assert.equal(s.getReviewableBooks().find(b => b.id === book.id), undefined);

  const ok = await s.verifyBook(book.id);
  assert.equal(ok, true);
  // 校验后：在 reviewable
  assert.ok(s.getReviewableBooks().find(b => b.id === book.id));
  assert.equal(s.getBook(book.id).status, BookStatus.Verified);
  assert.ok(s.getBook(book.id).verifiedAt);
});

test("e2e Step E: 已校验词书可走复习流程", async () => {
  const s = new VocabStore();
  s.load({ books: [{ id: "default", name: "我的单词本", order: 0, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] }], activeBookId: "default", activeThemeId: "t1", reviewEvents: [] });
  const book = await s.addBook("可复习");
  book.status = BookStatus.Verified;
  // 入 2 个词
  await s.addWord("abandon", { meaning: "放弃" }, book.id, book.themes[0].id);
  await s.addWord("benevolent", { meaning: "仁慈" }, book.id, book.themes[0].id);

  // 复习：从 getReviewableBooks 取所有词
  const reviewableBooks = s.getReviewableBooks();
  const allWords = reviewableBooks.flatMap(b =>
    b.themes.flatMap(t => t.words)
  );
  assert.equal(allWords.length, 2);

  // 评分（nextReviewState 期望 now 是 number 毫秒时间戳）
  const now = Date.now();
  const states = allWords.map(w => nextReviewState(w, "good", now));
  for (const st of states) {
    assert.equal(st.lastGrade, "good");
    assert.equal(st.reps, 1);
  }
});

test("e2e Step F: 标签全局管理完整流程", async () => {
  const ls = new VocabLabelsStore();
  ls.load([]);
  const s = new VocabStore(undefined, ls);
  s.load({ books: [{ id: "default", name: "我的单词本", order: 0, themes: [{ id: "t1", name: "未分类", order: 0, words: [] }] }], activeBookId: "default", activeThemeId: "t1", reviewEvents: [] });

  // 加 2 个词 + 标签
  await s.addWord("a", { labels: ["高频", "难词"] });
  await s.addWord("b", { labels: ["高频"] });
  await s.addWord("c", { labels: ["易混"] });
  await ls.upsert({ name: "高频", color: "#10b981", createdAt: new Date().toISOString() });
  await ls.upsert({ name: "难词", color: "#8b5cf6", createdAt: new Date().toISOString() });
  await ls.upsert({ name: "易混", color: "#f59e0b", createdAt: new Date().toISOString() });

  // getAllLabels
  const all = s.getAllLabels();
  const map = Object.fromEntries(all.map(l => [l.name, l.wordCount]));
  assert.equal(map["高频"], 2);
  assert.equal(map["难词"], 1);
  assert.equal(map["易混"], 1);

  // renameLabel
  const r1 = await s.renameLabel("高频", "核心");
  assert.equal(r1.updated, 2);
  assert.ok(s.findRecord("a").labels.includes("核心"));
  assert.ok(ls.get("核心"), "元数据应已重命名");

  // mergeLabels: a 命中"难词"（已 rename 为核心? 不，mergeLabels 找 froms 名字）
  // rename 后：a = ["核心", "难词"]; b = ["核心"]; c = ["易混"]
  // merge froms=["难词", "易混"] → to="标签"
  // a 命中"难词" → ["核心", "标签"]
  // b 不命中
  // c 命中"易混" → ["标签"]
  const r2 = await s.mergeLabels(["难词", "易混"], "标签");
  assert.equal(r2.updated, 2, "a 命中难词 + c 命中易混 = 2");
  assert.equal(ls.get("难词"), undefined);
  assert.equal(ls.get("易混"), undefined);
  assert.deepEqual(s.findRecord("c").labels, ["标签"]);
  // 验证 a 的 labels 现在是 ["核心", "标签"]（rename 后高频→核心）
  assert.deepEqual(s.findRecord("a").labels.sort(), ["核心", "标签"].sort());

  // deleteLabel: a + c 命中（"标签"） → updated=2
  const r3 = await s.deleteLabel("标签");
  assert.equal(r3.updated, 2, "a + c 命中 标签 = 2");
  assert.equal(ls.get("标签"), undefined);
  for (const w of s.getAllWords()) {
    assert.ok(!w.labels.includes("标签"));
  }
});

test("e2e Step G: 完整工作流（用户视角）", async () => {
  // 模拟用户完整操作
  // 1. 打开插件
  // 2. 看到空词库 + "暂无词书"提示
  // 3. 拖入 markdown 表格
  // 4. 解析成功 + 预览
  // 5. 校验入库
  // 6. 看到草稿→已校验
  // 7. 打开复习面板
  // 8. 看到 N 张指标卡
  // 9. 开始复习 + 评分
  const ls = new VocabLabelsStore();
  ls.load([]);
  const s = new VocabStore(undefined, ls);
  // 初始书本（确保 load 走 valid 分支，不会触发 migrateFromLegacyDoc）
  s.load({ books: [{ id: "init", name: "初始", order: 0, themes: [{ id: "t0", name: "未分类", order: 0, words: [] }] }], activeBookId: "init", activeThemeId: "t0", reviewEvents: [] });

  // 2. 初始状态（有"初始"单词本）
  console.log("  [debug G] all books after load:", s.getBooks().map(b => ({id: b.id, name: b.name})));
  assert.equal(s.getBooks().filter(b => b.id !== "__all__").length, 1);

  // 3-4. 解析 + 预览
  const result = autoParse(DOC_CONTENT);
  assert.equal(result.result.words.length, 5);

  // 5. 入库
  const book = await s.addBook("E2E 全流程");
  book.status = BookStatus.Draft;
  book.source = BookSource.DocParsed;
  for (const w of result.result.words) {
    await s.addWord(w.word, { phonetic: w.phonetic, meaning: w.meaning }, book.id, book.themes[0].id);
  }
  assert.equal(book.themes[0].words.length, 5);
  // 草稿本不参与复习（但 init 默认书是 verified 应在 reviewable 中）
  const reviewableG = s.getReviewableBooks();
  assert.equal(reviewableG.find(b => b.id === book.id), undefined, "新建草稿本不应在 reviewable");
  assert.equal(reviewableG.find(b => b.id === "init")?.status, BookStatus.Verified, "init 是 verified 应在 reviewable");

  // 6. 校验
  await s.verifyBook(book.id);
  // init (verified) + E2E (刚 verified) = 2
  assert.equal(s.getReviewableBooks().length, 2);

  // 7. 复习面板数据
  const reviewable = s.getReviewableBooks();
  const allWords = reviewable.flatMap(b => b.themes.flatMap(t => t.words));
  // init 0 词 + E2E 5 词 = 5
  assert.equal(allWords.length, 5);

  // 8. 调度（getDueQueue / isDue 内部用 number 毫秒比较）
  const queue = getDueQueue(allWords, { limit: 20, now: Date.now() });
  // 新词都 due <= now → 应全部进队列
  assert.equal(queue.length, 5);

  // 9. 评分（nextReviewState 期望 now 是 number）
  const reviewNow = Date.now();
  for (const w of queue) {
    const st = nextReviewState(w, "good", reviewNow);
    assert.equal(st.lastGrade, "good");
    assert.ok(st.intervalDays >= 1, "good 评分后 interval 应增长");
  }
});

test("e2e Step H: 解析异常路径", () => {
  // 不识别格式
  const r1 = autoParse("random text\nthat doesn't match");
  assert.equal(r1, null);

  // 空内容
  const r2 = autoParse("");
  assert.equal(r2, null);

  // 停用词全部跳过
  const r3 = autoParse("the\na\nan");
  assert.equal(r3.result.words.length, 0, "全是停用词");
  assert.equal(r3.cleaned.skipped.length, 3);

  // 重复词去重
  const r4 = autoParse("abandon :: 放弃\nabandon :: 抛弃");
  assert.equal(r4.result.words.length, 1);
});

test("e2e Step I: priorityOf 集成", () => {
  const now = Date.now();
  // priorityOf 期望 now 是 number 毫秒时间戳
  const w = {
    id: "w1", word: "test", phonetic: "", pos: "", meaning: "", mastery: 0,
    status: "active", labels: [],
    created: new Date(now).toISOString(),
    updated: new Date(now).toISOString(),
    order: 0,
    queryCount: 5, recall: 1, reps: 0, lapse: 0,
    due: new Date(now).toISOString(), lastReview: new Date(now).toISOString(),
    intervalDays: 0, ease: 2.5, lastGrade: "good",
    difficulty: 0.5,
  };
  const p = priorityOf(w, now);
  assert.ok(typeof p === "number" && !isNaN(p), `priority 应是有效数字: got ${p}`);
  assert.ok(p >= 0, `priority 应 >= 0: got ${p}`);
  assert.ok(p <= 1.5, `priority 应 <= 1.5: got ${p}`);
});
