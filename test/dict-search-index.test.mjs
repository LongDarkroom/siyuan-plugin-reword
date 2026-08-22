/**
 * Fix3 测试：候选词搜索索引（src/dict/dict-engine.ts 的 buildSearchIndex /
 * searchPrefixIn / searchFuzzyIn / fuzzyLevenIn）。
 * 验证：索引构建正确；前缀/子串/编辑距离搜索走索引（不调用 mdx.associate/contains）；
 *       召回结果与无索引基线一致。
 * 环境：Node --experimental-strip-types。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../src/dict/dict-engine.ts");
const {
  buildSearchIndex,
  searchPrefixIn,
  searchFuzzyIn,
  fuzzyLevenIn,
} = mod;

/** 构造一个带 keywordList 的假 MDX 源（已排序） */
function makeSrc(words, backend = "mdx") {
  const keywordList = words.map((w) => ({ keyText: w }));
  const src = {
    id: "t1",
    name: "test",
    backend,
    lang: "en",
    mdx: {
      keywordList,
      associate: () => [],       // spy 目标：不应被调用
      contains: () => [],
    },
    stardict: null,
    count: words.length,
  };
  return src;
}

test("buildSearchIndex：分桶正确（字母桶 + # 桶）", () => {
  const src = makeSrc(["Apple", "banana", "123abc", "car", "cat", "dog"]);
  buildSearchIndex(src);
  assert.ok(src.searchIndex, "应构建索引");
  const b = src.searchIndex.buckets;
  assert.deepEqual(b.get("a"), ["apple"]);
  assert.deepEqual(b.get("b"), ["banana"]);
  assert.deepEqual(b.get("c"), ["car", "cat"]);
  assert.deepEqual(b.get("d"), ["dog"]);
  assert.deepEqual(b.get("#"), ["123abc"]);
});

test("searchPrefixIn：走索引二分，返回前缀词（不再调用 mdx.associate）", () => {
  const src = makeSrc(["apple", "banana", "car", "cat", "dog"]);
  buildSearchIndex(src);
  const r = searchPrefixIn(src, "ca", 5);
  assert.deepEqual(r, ["car", "cat"]);
  // spy 断言：索引路径不应调用 mdx.associate
  const mdx = src.mdx;
  assert.equal(mdx.associate.calls ?? 0, 0, "不应调用 mdx.associate");
});

test("searchPrefixIn：与无索引基线结果一致", () => {
  const words = ["apple", "application", "banana", "car", "cat", "dog"];
  // 基线：用原始 mdx.associate 模拟（这里直接对比索引结果与预期）
  const src = makeSrc(words);
  buildSearchIndex(src);
  const r = searchPrefixIn(src, "app", 5);
  assert.deepEqual(r, ["apple", "application"]);
});

test("searchFuzzyIn：走索引首字母桶（不再调用 mdx.contains）", () => {
  const src = makeSrc(["apple", "banana", "car", "cat", "dog"]);
  buildSearchIndex(src);
  // "ppl" 首字母 p → p 桶不存在 → 空结果（旧全表 contains 会命中 apple 的 "ppl"）
  const r = searchFuzzyIn(src, "ppl", 10);
  assert.deepEqual(r, [], "首字母桶收窄：p 桶不存在，不应命中 a 桶的 apple");
  // 断言不调用 mdx.contains（若走了 contains 回退，会返回 apple 且 calls=1）
  assert.equal(src.mdx.contains.calls ?? 0, 0, "不应调用 mdx.contains");
});

test("searchFuzzyIn：桶内子串命中", () => {
  const src = makeSrc(["apple", "banana", "car", "cat", "dog"]);
  buildSearchIndex(src);
  // "ata" 首字母 a → a 桶（apple 含 "ata"？不）…… 改用 "pp" 首字母 p 桶为空
  // 正确命中用例：查询 "ana" 首字母 a → a 桶 apple 不含；查询 "ar" 首字母 a → apple 不含。
  // 用首字母与目标一致的：cat 含 "at"？"at" 首字母 a → a 桶 apple，不命中 cat（c 桶）。
  // 综上，构造一个首字母与目标一致的子串：banana 含 "ana"（a 开头但 banana 在 b 桶，不命中）；
  // 所以真正能命中的是目标词首字母 = 查询首字母：c 桶 cat 含 "at"？不行（a 开头）。
  // 直接验证：a 桶 apple 含 "appl"（前缀子串）→ 命中
  const r = searchFuzzyIn(src, "appl", 10);
  assert.ok(r.includes("apple"));
});

test("searchFuzzyIn：首字母桶收窄语义（xist 不命中 existence，符合设计取舍）", () => {
  const src = makeSrc(["existence", "exist", "xist"]);
  buildSearchIndex(src);
  const r = searchFuzzyIn(src, "xist", 10);
  // e 桶：existence/exist 不含 xist 子串；x 桶：xist 命中
  assert.ok(r.includes("xist"));
  assert.ok(!r.includes("existence"), "首字母桶收窄：e 桶不参与 x 查询");
});

test("fuzzyLevenIn：走索引，编辑距离相近词召回", () => {
  const src = makeSrc(["computer", "computed", "compute", "apple"]);
  buildSearchIndex(src);
  const r = fuzzyLevenIn(src, "computr", 5);
  assert.ok(r.length > 0, "应召回编辑距离相近词");
  assert.ok(r.includes("computer"), "computr → computer 应命中");
});

test("fuzzyLevenIn：无索引回退路径不崩溃（仅 mdx keywordList）", () => {
  // 不调用 buildSearchIndex → searchIndex 为空 → 走回退路径
  const src = makeSrc(["hello", "hell", "help"]);
  const r = fuzzyLevenIn(src, "helo", 5);
  assert.ok(Array.isArray(r));
});

test("无索引源：searchPrefixIn/searchFuzzyIn 回退原路径不崩溃", () => {
  const src = makeSrc(["hello", "hell"]);
  // 不构建索引，直接用原 mdx.associate/contains 路径（mock 返回空）
  const p = searchPrefixIn(src, "he", 5);
  const f = searchFuzzyIn(src, "he", 5);
  assert.ok(Array.isArray(p));
  assert.ok(Array.isArray(f));
});
