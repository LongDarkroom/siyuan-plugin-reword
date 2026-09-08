import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTranslation } from "../src/translate/sanitize.ts";

test("净化：剥离「**翻译：** + 重点词组解释」解说体", () => {
  const raw = `**翻译：** 我们的罐子翻倒了。

**重点词组解释：**
- **can**：这里指“罐子、罐头盒”（也可指垃圾桶等容器）。
- **tipped over**：翻倒、倾覆。`;
  assert.equal(sanitizeTranslation(raw), "我们的罐子翻倒了。");
});

test("净化：「翻译：」无星号 + 分隔线 + 重点解释", () => {
  const raw = `翻译：

“而且我会回来的。”

重点词组解释：
- **and**：承接。
- **will be back**：将来时。`;
  assert.equal(sanitizeTranslation(raw), "而且我会回来的。");
});

test("净化：「…的中文翻译是：」提取型 + 备选说法冗余", () => {
  const raw = `“I need help.” 的中文翻译是：

**“我需要帮助。”**

也可以说“我需要帮忙。”，两者都自然通顺。`;
  assert.equal(sanitizeTranslation(raw), "我需要帮助。");
});

test("净化：（注：…）整段夹注删除", () => {
  const raw = `奥利弗知道我是侦探。

（注：本句无难词，直译即可。“detective”指“侦探”，也可译为“警探”。）`;
  assert.equal(sanitizeTranslation(raw), "奥利弗知道我是侦探。");
});

test("净化：多行块状译文合并为整洁单行", () => {
  const raw = `我需要帮助。”
奥利弗知道我是个侦探。

他知道我是个优秀的侦探。`;
  assert.equal(sanitizeTranslation(raw), "我需要帮助。” 奥利弗知道我是个侦探。 他知道我是个优秀的侦探。");
});

test("净化：相邻重复行去重", () => {
  assert.equal(sanitizeTranslation("每天晚上。\n每天晚上。\n我需要帮助。”"), "每天晚上。 我需要帮助。”");
});

test("不误伤：纯单行译文原样返回", () => {
  assert.equal(sanitizeTranslation("奥利弗知道我是个侦探。"), "奥利弗知道我是个侦探。");
});

test("不误伤：以「注意」「说明书」开头的正常译文不被截断", () => {
  assert.equal(sanitizeTranslation("注意观察那只猫。"), "注意观察那只猫。");
  assert.equal(sanitizeTranslation("说明书在抽屉里。"), "说明书在抽屉里。");
});

test("不误伤：含冒号的正常译文不被剥前缀", () => {
  assert.equal(sanitizeTranslation("他说：明天来。"), "他说：明天来。");
});

test("兜底：全解释区内容削空时回退原文，绝不返回空串", () => {
  const raw = `**重点词组解释：**
- **can**：罐子。
- **tip**：翻倒。`;
  const out = sanitizeTranslation(raw);
  assert.ok(out.length > 0, "不应返回空串");
});

test("兜底：空输入返回空串", () => {
  assert.equal(sanitizeTranslation(""), "");
  assert.equal(sanitizeTranslation("   "), "");
});

test("净化：行中「。 解释：…」内联解说截断", () => {
  assert.equal(
    sanitizeTranslation("或者鼹鼠在拿你的垃圾。 解释： mole：此处指“鼹鼠”，一种小型哺乳动物。"),
    "或者鼹鼠在拿你的垃圾。"
  );
  assert.equal(
    sanitizeTranslation("侦探工作就是香蕉皮。 解释：这里的“banana peels”是比喻用法，指陷阱。"),
    "侦探工作就是香蕉皮。"
  );
});

test("不误伤：行中「他解释：」不被截断", () => {
  assert.equal(sanitizeTranslation("他解释：事情是这样的。"), "他解释：事情是这样的。");
});

test("净化：**说明：** 区块截断", () => {
  const raw = `**翻译：**  
我读到过关于鸟类的……

**说明：**
这句话不完整。`;
  assert.equal(sanitizeTranslation(raw), "我读到过关于鸟类的……");
});
