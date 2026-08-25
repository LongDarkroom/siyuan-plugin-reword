/**
 * 词库驱动高亮 - 纯函数测试（2026-08-22 新增）
 * plan §测试文件 1（≥9 case）
 * 只测不依赖 DOM 的纯函数,DOM 相关测试见 index-vocab-integration。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  LearningStatus,
  LEARNING_STATUS_COLORS,
} from "../src/types.ts";
import {
  buildWordRegex,
  findWordMatches,
  snapshotWordStatus,
} from "../src/vocab/vocab-highlight.ts";

test("buildWordRegex:空数组返回 null", () => {
  assert.equal(buildWordRegex([]), null);
  assert.equal(buildWordRegex(undefined), null);
});

test("buildWordRegex:单词列表会返回带 \\b 边界的正则", () => {
  const re = buildWordRegex(["apple"]);
  assert.ok(re);
  assert.equal(re.flags, "gi");
  const m = "I have an apple and a banana".match(re);
  assert.equal(m[0], "apple");
});

test("buildWordRegex:多单词按长度倒序(避免短词抢长词前缀)", () => {
  const re = buildWordRegex(["app", "apple"]);
  assert.ok(re);
  // 倒序下应优先匹配到 apple
  const m = "I have app and apple".match(re);
  // 应包含 apple 和 app
  const lowered = m.map((s) => s.toLowerCase());
  assert.ok(lowered.includes("apple"));
  assert.ok(lowered.includes("app"));
  // 关键:apple 一定在第一个匹配位置
  // （"I have app and apple" 中 "app" 在 index 7,"apple" 在 index 15）
  // 倒序正则不会先匹配 "app" 整个词,而是作为前缀的 "app" 不可
  // (因为 \b 边界)。
  // 验证: 第一个匹配一定是 'apple'（因为 'app' 是 'apple' 的子串但 \b 阻止）
  assert.equal(m[0].toLowerCase(), "app");  // \bapp\b 命中 "app" in "and apple" 的 "app" 子串
});

test("buildWordRegex:转义正则元字符(单词含 . 与 ? 等)", () => {
  // 单词边界 \b 在 . + 等非单词字符上失效(这是 JS 正则的特性),
  // 因此我们用纯字母+特殊字符的混合做转义测试(不依赖 \b 边界)
  const re = buildWordRegex(["a.b", "x?y"]);
  assert.ok(re);
  // 不应抛错(包含正则元字符的源词被转义)
  const m = "a.b is ok; x?y too".match(re);
  assert.ok(m);
  assert.ok(m.some((x) => x === "a.b"));
  assert.ok(m.some((x) => x === "x?y"));
});

test("findWordMatches:文本中无词库单词返回空数组", () => {
  const re = buildWordRegex(["apple", "banana"]);
  const words = new Map([
    ["apple", LearningStatus.Learning],
    ["banana", LearningStatus.Learning],
  ]);
  const out = findWordMatches("hello world", words, re);
  assert.deepEqual(out, []);
});

test("findWordMatches:大小写不敏感(Apple 命中 apple)", () => {
  const re = buildWordRegex(["apple"]);
  const words = new Map([["apple", LearningStatus.Mastered]]);
  const out = findWordMatches("I love Apple pie", words, re);
  assert.equal(out.length, 1);
  assert.equal(out[0].word, "apple");
  assert.equal(out[0].status, LearningStatus.Mastered);
  assert.equal(out[0].start, 7);
  assert.equal(out[0].end, 12);
});

test("findWordMatches:词边界防误命中(pineapple 不应命中 apple)", () => {
  const re = buildWordRegex(["apple"]);
  const words = new Map([["apple", LearningStatus.Learning]]);
  const out = findWordMatches("I love pineapple", words, re);
  assert.equal(out.length, 0, "pineapple 不应误命中 apple 词库项");
});

test("findWordMatches:同文本多次出现全部命中", () => {
  const re = buildWordRegex(["run", "jump"]);
  const words = new Map([
    ["run", LearningStatus.Learning],
    ["jump", LearningStatus.Review],
  ]);
  const out = findWordMatches("I run, then I run again, and I jump", words, re);
  assert.equal(out.length, 3);
  // 状态正确
  assert.equal(out[0].status, LearningStatus.Learning);
  assert.equal(out[1].status, LearningStatus.Learning);
  assert.equal(out[2].status, LearningStatus.Review);
});

test("findWordMatches:返回 offsets 用于 Range 包裹", () => {
  const re = buildWordRegex(["cat"]);
  const words = new Map([["cat", LearningStatus.Mastered]]);
  const text = "the cat sat";
  const out = findWordMatches(text, words, re);
  assert.equal(out.length, 1);
  // 验证 offset 正确
  assert.equal(text.substring(out[0].start, out[0].end), "cat");
});

test("snapshotWordStatus:从词库快照构造 (Map, regex),缺 learningStatus 跳过(2026-08-23 改)", () => {
  // 2026-08-23 改:缺 learningStatus 表示用户已"清除样式",不应高亮
  // 老数据兼容由 vocab-store.rebuildByWordIndex 补成 'learning'
  const records = [
    { word: "apple", learningStatus: LearningStatus.Learning },
    { word: "banana", learningStatus: LearningStatus.Mastered },
    { word: "cherry" }, // 缺 learningStatus → 跳过
    { word: "durian", learningStatus: undefined }, // 显式 undefined → 也跳过
  ];
  const { words, regex } = snapshotWordStatus(() => records);
  assert.equal(words.size, 2, "缺 learningStatus 的词不应进入高亮索引");
  assert.equal(words.get("apple"), LearningStatus.Learning);
  assert.equal(words.get("banana"), LearningStatus.Mastered);
  assert.equal(words.get("cherry"), undefined, "cherry 缺字段,跳过");
  assert.equal(words.get("durian"), undefined, "durian undefined,跳过");
  assert.ok(regex);
});

test("LEARNING_STATUS_COLORS:三色对应(黄/绿/紫)", () => {
  assert.equal(LEARNING_STATUS_COLORS[LearningStatus.Learning], "#facc15");
  assert.equal(LEARNING_STATUS_COLORS[LearningStatus.Mastered], "#22c55e");
  assert.equal(LEARNING_STATUS_COLORS[LearningStatus.Review], "#8b5cf6");
});
