/**
 * i18n 核心契约测试（2026-09-10 建立）。
 *
 * 钉死四条契约 —— 这四条是整个多语言方案的地基，任何一条被破都会导致
 * 「英文界面出现空白 / key 原文 / 中文串味」：
 *   1. 默认中文下 t(x) === x（迁移前后渲染结果**逐字不变**）
 *   2. 英文下命中语言包
 *   3. 未翻译 / 写错 key 一律回落中文（灰度发布的前提，绝不空白）
 *   4. 插值与语境消歧
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  t,
  setLang,
  getLang,
  isEnglish,
  hasTranslation,
  translationTotal,
} from "../src/i18n/index.ts";

/** 每个用例结束都回到中文，避免污染其它用例（i18n 是模块级单例） */
function useChinese() {
  setLang("zh_CN");
}

test("i18n: 默认中文下 t() 原样返回（迁移零视觉回归）", () => {
  useChinese();
  assert.equal(getLang(), "zh_CN");
  assert.equal(isEnglish(), false);
  assert.equal(t("保存成功"), "保存成功");
  assert.equal(t("已复制 {n} 项", { n: 3 }), "已复制 3 项");
  // 未收录的文案也原样返回
  assert.equal(t("一句根本不存在于语言包里的话"), "一句根本不存在于语言包里的话");
});

test("i18n: 英文下命中语言包", () => {
  setLang("en_US");
  try {
    assert.equal(isEnglish(), true);
    // 这两条是 i18n/en_US.json 里必定存在的（由 gen-i18n-keys.mjs 从设置项抓出）
    assert.equal(t("通用"), "General");
    assert.equal(t("防幻觉"), "Hallucination Guard");
  } finally {
    useChinese();
  }
});

test("i18n: 未翻译 / 未知 key 回落中文，绝不空白", () => {
  setLang("en_US");
  try {
    const missing = "【绝对不存在的文案 absolute-non-existent-key】";
    assert.equal(t(missing), missing, "未命中必须回落中文原文");
    assert.notEqual(t(missing), "");
    assert.notEqual(t(missing), undefined);
    // 语言包里确实有英文条目（保证上面两条断言是「真查表」而非「全回落」）
    assert.ok(translationTotal() > 100, `英文包条目数应 >100，实际 ${translationTotal()}`);
    assert.equal(hasTranslation("通用"), true);
    assert.equal(hasTranslation(missing), false);
  } finally {
    useChinese();
  }
});

test("i18n: 插值在两种语言下都生效", () => {
  useChinese();
  assert.equal(t("已复制 {n} 项", { n: 12 }), "已复制 12 项");
  assert.equal(t("共 {a} / {b}", { a: 1, b: 2 }), "共 1 / 2");
  setLang("en_US");
  try {
    // 未翻译的文案：中文占位符同样要被替换，不能留下 {n} 给用户看
    assert.equal(t("已复制 {n} 项", { n: 12 }), "已复制 12 项");
  } finally {
    useChinese();
  }
});

test("i18n: ctx 语境消歧（先查 原文@ctx，查不到回落原文）", () => {
  setLang("en_US");
  try {
    // 语言包里没有「关闭@dialog」，应回落「关闭」的译法（有）或中文原文（无）
    const withCtx = t("关闭", { ctx: "dialog" });
    assert.ok(typeof withCtx === "string" && withCtx.length > 0);
    assert.ok(!withCtx.includes("{ctx}"), "ctx 是控制键，不能被插进文案里");
  } finally {
    useChinese();
  }
});

test("i18n: 非法语言值被收敛为 zh_CN", () => {
  setLang("fr_FR");
  assert.equal(getLang(), "zh_CN");
  useChinese();
});
