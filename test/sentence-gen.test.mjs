/**
 * 造句数据层单元测试（gen-prompt + sentence-store · 2026-09-12）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSentenceMessages,
  parseSentenceJson,
  containsWord,
  validateSentences,
  SENT_LEN_MIN,
  SENT_LEN_MAX,
} from "../src/sentence/gen-prompt.ts";
import { SentenceStore, MAX_SENTENCES_PER_WORD } from "../src/sentence/sentence-store.ts";

// ======== gen-prompt ========
test("buildSentenceMessages: 内置可控模板含五大句型与词性倾向约束", () => {
  const msgs = buildSentenceMessages("give", "v.", "给，授予", 3);
  assert.equal(msgs.length, 2);
  const sys = msgs[0].content;
  for (const t of ["SV", "SVO", "SVC", "SVOO", "SVOC", "phrase"]) assert.ok(sys.includes(t), `缺句型 ${t}`);
  assert.ok(sys.includes("SVOO"), "动词倾向应提及双宾");
  assert.ok(sys.includes("give"));
  assert.ok(sys.includes("sentences"), "要求 JSON 输出");
});

test("parseSentenceJson: 裸 JSON / ```围栏 / 前后杂文本 均可解析；非法返回 null", () => {
  const payload = '{"sentences":[{"en":"It is plain.","zh":"这很明显。"}]}';
  assert.equal(parseSentenceJson(payload)?.length, 1);
  assert.equal(parseSentenceJson("```json\n" + payload + "\n```")?.length, 1);
  assert.equal(parseSentenceJson("结果如下：" + payload + "以上。")?.length, 1);
  assert.equal(parseSentenceJson("not json"), null);
  assert.equal(parseSentenceJson(""), null);
});

test("containsWord: 词形变化宽松匹配（plainer/flying/given 命中，无关词不命中）", () => {
  assert.ok(containsWord("It was plainer than expected.", "plain"));
  assert.ok(containsWord("Birds are flying.", "fly"));
  assert.ok(containsWord("He was given a gift.", "give"));
  assert.ok(!containsWord("The dog barks.", "fly"));
});

test("validateSentences: 剥 **、长度过滤、去重、非法句型→phrase、不含目标词剔除", () => {
  const items = [
    { en: "It was **plain** to everyone in the room that day.", zh: "对每个人都很明显。", sentenceType: "SVC", tense: "一般过去时", scenario: "日常", cefr: "b1" },
    { en: "short", zh: "太短", sentenceType: "SV" }, // 长度不合规（<6 词）
    { en: "It was plain to everyone in the room that day.", zh: "重复句", sentenceType: "SV" }, // 与第 1 句剥 ** 后同 en → 去重
    { en: "The unrelated thing happened somewhere nearby today.", zh: "不含目标词", sentenceType: "SV" },
    { en: "She felt plain and tired after the long walk today.", zh: "她感到疲惫。", sentenceType: "WRONG" }, // 非法句型 → phrase
  ];
  const out = validateSentences(items, "plain");
  assert.equal(out.length, 2);
  assert.equal(out[0].en, "It was plain to everyone in the room that day."); // ** 已剥离
  assert.equal(out[0].cefr, "B1"); // 大写规整
  assert.equal(out[1].sentenceType, "phrase");
});

// ======== sentence-store ========
const mk = (word = "plain", en = "s-" + Math.random()) => ({
  word, en, zh: "中", sentenceType: "SVC", source: "ai",
});

test("store: add / listFor / keptFor / countFor", async () => {
  const st = new SentenceStore();
  st.__resetForTest();
  const a = await st.add(mk("plain", "A"));
  await st.add(mk("plain", "B"));
  await st.add(mk("table", "C"));
  await st.update(a.id, { status: "kept" });
  assert.equal(st.countFor("plain"), 2);
  assert.equal(st.keptFor("plain").length, 1);
  assert.equal(st.keptFor("TABLE").length, 0); // 大小写不敏感
});

test("store: 每词上限淘汰最旧 draft，kept/fav 永不自动删", async () => {
  const st = new SentenceStore();
  st.__resetForTest();
  const kept = await st.add(mk("w", "kept-1"));
  await st.update(kept.id, { status: "kept" });
  for (let i = 0; i < MAX_SENTENCES_PER_WORD + 3; i++) await st.add(mk("w", "x" + i));
  const list = st.listFor("w");
  assert.ok(list.length <= MAX_SENTENCES_PER_WORD);
  assert.ok(list.some((s) => s.id === kept.id), "kept 必须存活");
});

test("store: load 非法条目丢弃 + 状态/来源规整", () => {
  const st = new SentenceStore();
  st.load({
    sentences: [
      { id: "1", word: "Abc", en: "e", zh: "z", sentenceType: "SVO", source: "dict", status: "kept" },
      { id: "2", word: "x" }, // 缺 en/zh → 丢弃
      null,
      { id: "3", word: "Y", en: "e3", zh: "z3", source: "weird", status: "bad" }, // 规整 ai/draft
    ],
  });
  assert.equal(st.countFor("abc"), 1);
  assert.equal(st.countFor("y"), 1);
  const y = st.listFor("y")[0];
  assert.equal(y.source, "ai");
  assert.equal(y.status, "draft");
});

test("store: onChange 持久化回调在 load 后写入时触发", async () => {
  let calls = 0;
  const st = new SentenceStore(() => { calls++; });
  st.load({ sentences: [] });
  await st.add(mk("z", "one"));
  assert.equal(calls, 1);
  await st.remove(st.listFor("z")[0].id);
  assert.equal(calls, 2);
});
