// AI 精读输入框 —— 思源标准空段（对齐 Copilot）测试（2026-09-03）
// ------------------------------------------------------------------
// 用户报告：拖入文档/块后「引用卡片占满一行，提示词只能在卡片内输入」。
//
// 排查结论（真回归，非 CSS bug）：
//   1) lite Protyle 的初始段落是自造占位段 —— 缺 class="p"（思源原生 inline 排版上下文）、
//      内容是 `<br>`（产生空行盒）、无 protyle-attr、data-node-id="placeholder" 非合法思源 ID。
//   2) directInsertCard 在卡片后追加 `<br data-reword-tail="1">` 作为光标锚点 ——
//      br 产生换行行盒，卡片因此独占一行，这正是「占满一行」的直接原因。
//
// 修复（对齐 Copilot 做法）：
//   · createEmptyBlock()：优先 lute.Md2BlockDOM("")，兜底手搓也补齐四件套
//     class="p" + ZWSP<wbr> + protyle-attr + 合法 node-id
//   · directInsertCard()：优先 protyle.insert() 原生路径，DOM 兜底不再插 br
//   · 空态改用思源原生 protyle-wysiwyg--empty + placeholder
//   · 卡片 × 删除命中区 20px → 16px（与 Copilot 一致）
//
// 本文件用「源码正则切片」锁定上述不变量，防止再次退化。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const src = readFileSync(join(__dirname, "..", "src", "ai", "ai-panel.ts"), "utf-8");

/** 从 `marker` 起始花括号处切出完整函数体（花括号配对，忽略字符串内的括号） */
function bodyOf(marker) {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `源码中应存在：${marker}`);
  let depth = 0;
  let begun = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") { depth++; begun = true; }
    else if (ch === "}") {
      depth--;
      if (begun && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`花括号未配对：${marker}`);
}

const createEmptyBlock = bodyOf("private createEmptyBlock(");
const newBlockId = bodyOf("private newBlockId(");
const blockHasContent = bodyOf("private blockHasContent(");
const syncNativePlaceholder = bodyOf("private syncNativePlaceholder(");
const lastEditableInner = bodyOf("private lastEditableInner(");
const directInsertCard = bodyOf("private directInsertCard(");
const ensureCaretAfterCard = bodyOf("private ensureCaretAfterCard(");

// ============ A. 标准空段四件套（Copilot 对齐） ============

test("A1: createEmptyBlock 优先用 lute.Md2BlockDOM(\"\") 生成空段", () => {
  assert.match(
    createEmptyBlock,
    /Md2BlockDOM\(\s*""\s*\)/,
    "应优先用 Protyle 自带 Lute 的 Md2BlockDOM(\"\") 生成标准空段",
  );
});

test("A2: Lute 产物缺 class=\"p\" 时补上（思源段落排版依赖它）", () => {
  assert.match(
    createEmptyBlock,
    /classList\.contains\("p"\)\s*\)\s*first\.classList\.add\("p"\)/,
    "思源段落必须带 class=\"p\"，否则块引用卡片失去 inline 排版上下文而独占一行",
  );
});

test("A3: 兜底手搓空段含 class=\"p\"", () => {
  assert.match(createEmptyBlock, /b\.className\s*=\s*"p"/, "兜底路径也要设 class=\"p\"");
});

test("A4: 兜底空段内容是 ZWSP + <wbr>（不是 <br>，避免多出空行盒）", () => {
  assert.match(createEmptyBlock, /\$\{ZWSP\}<wbr>/, "空段内容必须是 ZWSP + <wbr>");
  assert.doesNotMatch(createEmptyBlock, /<br>/, "空段内不得出现 <br>（会产生可见空行）");
});

test("A5: 兜底空段含 protyle-attr 元信息区", () => {
  assert.match(createEmptyBlock, /class="protyle-attr"\s+contenteditable="false"/, "段落结构需含 protyle-attr");
});

test("A6: newBlockId 优先 Lute.NewNodeID()（合法思源 ID）", () => {
  assert.match(newBlockId, /NewNodeID/, "应优先调用 Lute.NewNodeID() 生成合法块 ID");
  assert.match(newBlockId, /Math\.random\(\)/, "不可用时用时间戳+随机兜底");
});

test("A7: 模块级定义了 ZWSP 与 ZERO_WIDTH_RE", () => {
  assert.match(src, /const ZWSP = "\\u200b";/, "应定义 ZWSP 常量");
  assert.match(src, /const ZERO_WIDTH_RE = \/\[[^\]]*\\u200b/, "应定义零宽字符正则");
});

// ============ B. 旧占位段 / 光标锚点已彻底移除 ============

test("B1: 源码不再写入 data-reword-placeholder=\"1\" 自造占位段", () => {
  // 注释里提到旧实现是允许的，但不该再出现「写入」该属性
  assert.doesNotMatch(src, /setAttribute\(\s*["']data-reword-placeholder/, "不应再写入 data-reword-placeholder 属性");
  assert.doesNotMatch(src, /data-reword-placeholder="1"><div/, "不应再拼接自造占位段 HTML");
});

test("B2: 源码不再出现 data-reword-tail（该 br 是「卡片占一行」的直接原因）", () => {
  assert.doesNotMatch(src, /data-reword-tail/, "不应再出现 data-reword-tail 光标锚点");
});

test("B3: readInputValue 不再需要占位段救援 / br 剥除", () => {
  const read = bodyOf("private readInputValue(");
  assert.doesNotMatch(read, /data-reword-placeholder/, "readInputValue 不应再处理占位段");
  assert.doesNotMatch(read, /data-reword-tail/, "readInputValue 不应再剥除 br");
});

// ============ C. directInsertCard：原生优先 + 不插 br ============

test("C1: directInsertCard 优先走 protyle.insert()", () => {
  assert.match(directInsertCard, /this\.protyle\?\.insert\(cardHtml,\s*false\)/, "应先走原生 insert");
});

test("C2: directInsertCard 有 blockId 去重保护（防校验时序导致重复卡片）", () => {
  assert.match(directInsertCard, /CSS\.escape\(blockId\)/, "插入前后应校验同名块引用");
});

test("C3: directInsertCard 兜底路径不再插 <br>（关键：br 会让卡片独占一行）", () => {
  assert.doesNotMatch(directInsertCard, /<br\s+data-reword-tail|<br\s*\/?>/, "兜底插入不得再追加 br");
  assert.match(directInsertCard, /insertAdjacentHTML\("beforeend",\s*cardHtml\)/, "只应 inline 追加卡片本身");
});

test("C4: 兜底/原生路径都用 ensureCaretAfterCard 把光标放到卡片后", () => {
  assert.match(directInsertCard, /this\.ensureCaretAfterCard\(wysiwyg,\s*blockId\)/, "应调用 ensureCaretAfterCard 定位光标");
  assert.match(ensureCaretAfterCard, /setStartAfter\(textNode\)/, "应在卡片后的 ZWSP 节点后定位光标");
});

test("C5: lastEditableInner 跳过 protyle-attr 与代码块", () => {
  assert.match(lastEditableInner, /closest\("\.protyle-attr"\)/, "应跳过 protyle-attr 元信息区");
  assert.match(lastEditableInner, /closest\("\[data-type='NodeCodeBlock'\]"\)/, "应跳过代码块");
});

// ============ D. 空态判定：剥零宽字符 + 原生 placeholder ============

test("D1: blockHasContent 剥零宽字符后再判定（空段只有 ZWSP）", () => {
  assert.match(blockHasContent, /replace\(ZERO_WIDTH_RE,\s*""\)/, "判空前须剥除 ZWSP，否则空段被误判为有内容");
});

test("D2: blockHasContent 把块引用卡片视为内容", () => {
  assert.match(blockHasContent, /querySelector\("\[data-type='block-ref'\]"\)/, "只有引用卡也应算有内容");
});

test("D3: syncNativePlaceholder 用思源原生 protyle-wysiwyg--empty", () => {
  assert.match(syncNativePlaceholder, /protyle-wysiwyg--empty/, "应使用思源原生空态 class");
  assert.match(syncNativePlaceholder, /setAttribute\("placeholder"/, "应设置 placeholder 属性");
});

test("D4: syncNativePlaceholder 只对「唯一空段落」生效，多段一律清除", () => {
  assert.match(syncNativePlaceholder, /blocks\.length === 1 \? blocks\[0\] : null/, "只在单段时显示 placeholder");
  assert.match(syncNativePlaceholder, /classList\.remove\("protyle-wysiwyg--empty"\)/, "多段时应清除空态 class");
});

// ============ E. mountProtyle 预塞标准空段 + 删除命中区 ============

test("E1: mountProtyle 用 createEmptyBlock() 预塞空段（不再 innerHTML 手搓占位）", () => {
  const mount = bodyOf("private mountProtyle(");
  assert.match(mount, /wysiwyg\.appendChild\(this\.createEmptyBlock\(\)\)/, "应 append 标准空段");
  assert.doesNotMatch(mount, /data-reword-placeholder/, "不应再写入自造占位段");
});

test("E2: 两处 click handler 的 × 删除命中区改为 16px（与 Copilot 一致）", () => {
  const hits = src.match(/getBoundingClientRect\(\)\.right - me\.clientX <= (\d+)/g) || [];
  assert.equal(hits.length, 2, `应有 2 处 × 删除命中判定，实际 ${hits.length} 处`);
  for (const h of hits) assert.match(h, /<= 16/, "命中区应为 16px");
});

test("E3: 构建信息标注了 native-empty-block 特性（便于真机排查版本）", () => {
  assert.match(src, /native-empty-block/, "__REWORD_BUILD_INFO__.features 应标注本次改动");
});
