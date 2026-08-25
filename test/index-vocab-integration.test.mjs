/**
 * 词库高亮与 index.ts 集成源码扫描测试（2026-08-22 新增,plan §测试文件 4,≥7 case）
 * 与 ann-preview.test 同类套路,验证关键源码结构,避免 DOM 依赖。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("vocab-highlight 模块存在且导出 4 个核心纯函数", async () => {
  const src = await readFile("src/vocab/vocab-highlight.ts", "utf8");
  assert.match(src, /export function buildWordRegex/);
  assert.match(src, /export function findWordMatches/);
  assert.match(src, /export function clearVocabMarks/);
  assert.match(src, /export function applyVocabMarks/);
});

test("vocab-highlight 模块:IntersectionObserver rootMargin 配置为 320px 0px", async () => {
  const src = await readFile("src/vocab/vocab-highlight.ts", "utf8");
  assert.match(src, /rootMargin:\s*"320px 0px"/);
});

test("vocab-highlight:applyVocabMarks 用 wrappedPositions Set 防双重包裹", async () => {
  const src = await readFile("src/vocab/vocab-highlight.ts", "utf8");
  assert.match(src, /wrappedPositions\.add/);
  assert.match(src, /if \(wrappedPositions\.has\(m\.start\)\) continue/);
});

test("vocab-highlight:applyVocabMarks substring 校验偏移合法性", async () => {
  const src = await readFile("src/vocab/vocab-highlight.ts", "utf8");
  // 偏移失效时跳过该 match
  assert.match(
    src,
    /fullText\.substring\(m\.start, m\.end\)\.toLowerCase\(\) === m\.word/,
    "应用 wrap 前应 substring 校验"
  );
});

test("index.ts:onSwitchProtyle 切换文档时启动 vocab highlighter (setTimeout 350ms+)", async () => {
  const src = await readFile("src/index.ts", "utf8");
  // 找 onSwitchProtyle 函数
  const fnMatch = src.match(/private onSwitchProtyle = \(e: CustomEvent\): void => \{[\s\S]*?\n  \};/);
  assert.ok(fnMatch, "应能找到 onSwitchProtyle");
  assert.match(fnMatch[0], /getVocabHighlighter/);
  assert.match(fnMatch[0], /hl\.start\(wysiwyg\)/);
  assert.match(fnMatch[0], /hl\.refreshAll\(\)/);
  // 360ms 延迟(与 ann-mark 280ms 错开避免主线程争抢)
  assert.match(fnMatch[0], /setTimeout[\s\S]*?360/);
});

test("index.ts:renderVocabWordRows 包含 4 个 status chip 按钮(未掌握/已掌握/需复习/✕清除)+ ▾ 收起按钮", async () => {
  const src = await readFile("src/index.ts", "utf8");
  // 找 renderVocabStatusBar 函数
  const fnMatch = src.match(/private renderVocabStatusBar\([\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, "应能找到 renderVocabStatusBar");
  // 4 颗 chip 的标签
  assert.match(fnMatch[0], /未掌握/);
  assert.match(fnMatch[0], /已掌握/);
  assert.match(fnMatch[0], /需复习/);
  assert.match(fnMatch[0], /✕/, "应有 ✕ 清除样式 chip");
  assert.match(fnMatch[0], /清除样式/, "✕ chip 应有 title 提示");
  // 4 颗 chip 共用 action
  assert.match(fnMatch[0], /vocab-status-set/);
  // 3 个状态常量
  assert.match(fnMatch[0], /LearningStatus\.Learning/);
  assert.match(fnMatch[0], /LearningStatus\.Mastered/);
  assert.match(fnMatch[0], /LearningStatus\.Review/);
  // data-status 是动态绑定 + 收起按钮
  assert.match(fnMatch[0], /data-status="\$\{dataStatus\}"/);
  assert.match(fnMatch[0], /vocab-status-collapse/, "应有收起按钮的 action");
  assert.match(fnMatch[0], /hiword-vb-status-bar--collapsed/, "应支持 collapsed 状态");
});

test("index.ts:vocab-status-collapse 按单词独立切换展开(2026-08-23 改:不重渲染 + 互不影响)", async () => {
  const src = await readFile("src/index.ts", "utf8");
  // 字段:应是 Set<string> 而非 boolean
  assert.match(src, /vocabStatusBarExpandedWords:\s*Set<string>/);
  assert.doesNotMatch(src, /vocabStatusBarCollapsed:\s*boolean/, "不应再用全局 boolean 字段");
  // click 委托里应有 vocab-status-collapse 分支
  assert.match(src, /action === "vocab-status-collapse"/);
  // 应操作 Set(添加/删除 word)
  assert.match(src, /vocabStatusBarExpandedWords\.add\(word\)/);
  assert.match(src, /vocabStatusBarExpandedWords\.delete\(word\)/);
  // 持久化到 localStorage(新 key)
  assert.match(src, /localStorage\.setItem\(\s*"reword-vocab-status-expanded"/);
  // 块定义
  const collapseBlock = src.match(/} else if \(action === "vocab-status-collapse"\) \{[\s\S]*?\n      \}/);
  assert.ok(collapseBlock, "应能找到 vocab-status-collapse 分支");
  // 不能调用 renderVocabPanel
  assert.doesNotMatch(
    collapseBlock[0],
    /this\.renderVocabPanel\(dockElement\)/,
    "不能调用 renderVocabPanel(性能反模式)"
  );
  // 关键:只切**该单词的** bar(querySelector 一个 bar),不是 querySelectorAll 全部
  assert.match(
    collapseBlock[0],
    /querySelector\(\s*`\.hiword-vb-status-bar\[data-status-bar-word/,
    "应只查该单词的 bar(querySelector,不是 querySelectorAll)"
  );
  assert.doesNotMatch(
    collapseBlock[0],
    /querySelectorAll\(\s*"\.hiword-vb-status-bar"\)/,
    "不能遍历全部 bar(互不影响是核心需求)"
  );
  assert.match(collapseBlock[0], /classList\.toggle\("hiword-vb-status-bar--collapsed"/, "应 toggle collapsed class");
});

test("index.ts:onload 阶段从 localStorage 恢复 vocabStatusBarExpandedWords (Set)", async () => {
  const src = await readFile("src/index.ts", "utf8");
  assert.match(src, /localStorage\.getItem\(\s*"reword-vocab-status-expanded"/);
  assert.match(src, /JSON\.parse\(raw\)/);
  assert.match(src, /new Set\(arr\.filter/);
});

test("index.ts:renderVocabStatusBar 按单词独立判断 collapsed(默认收起)", async () => {
  const src = await readFile("src/index.ts", "utf8");
  const fnMatch = src.match(/private renderVocabStatusBar\([\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, "应能找到 renderVocabStatusBar");
  // 字段访问改为 .has(w.word)
  assert.match(fnMatch[0], /vocabStatusBarExpandedWords\.has\(w\.word\)/);
  // data-status-bar-word 标识用于 click 时精确定位
  assert.match(fnMatch[0], /data-status-bar-word="\$\{word\}"/);
  // 默认 collapsed = !isExpanded
  assert.match(fnMatch[0], /const collapsed = !isExpanded/);
});

test("index.ts:vocab-status-set 也走轻量更新(2026-08-23 改:不重渲染)", async () => {
  const src = await readFile("src/index.ts", "utf8");
  const setBlock = src.match(/} else if \(action === "vocab-status-set"[\s\S]*?\n      \}/);
  assert.ok(setBlock, "应能找到 vocab-status-set 分支");
  // 不能调用 renderVocabPanel
  assert.doesNotMatch(
    setBlock[0],
    /this\.renderVocabPanel\(dockElement\)/,
    "vocab-status-set 也不能重渲染面板"
  );
  // 应局部刷新:querySelectorAll 找该行 chip,逐个 toggle active
  assert.match(setBlock[0], /querySelectorAll\("\.hiword-vb-status-chip"\)/, "应遍历该行 chip 切 active");
  assert.match(setBlock[0], /classList\.toggle\("active"/, "应 toggle active class");
});

test("index.ts:onload 阶段从 localStorage 恢复 vocabStatusBarExpandedWords (Set)", async () => {
  const src = await readFile("src/index.ts", "utf8");
  assert.match(src, /localStorage\.getItem\(\s*"reword-vocab-status-expanded"/);
  assert.match(src, /JSON\.parse\(raw\)/);
  assert.match(src, /new Set\(arr\.filter/);
});

test("index.ts:setLearningStatus 接受 null = 清除样式(2026-08-23 改)", async () => {
  const storeSrc = await readFile("src/vocab/vocab-store.ts", "utf8");
  // setLearningStatus 签名应接受 null | undefined
  const fnMatch = storeSrc.match(/async setLearningStatus\([\s\S]*?return true;\n  \}/);
  assert.ok(fnMatch, "应能找到 setLearningStatus");
  assert.match(fnMatch[0], /status:\s*LearningStatusType\s*\|\s*null\s*\|\s*undefined/);
  // 清除走 delete 而非赋空串
  assert.match(fnMatch[0], /delete entry\.record\.learningStatus/);
});

test("index.ts:data-action='vocab-status-set' 事件分发调用 setLearningStatus", async () => {
  const src = await readFile("src/index.ts", "utf8");
  // 找词库面板 click 委托里的 vocab-status-set 分支
  assert.match(src, /action === "vocab-status-set"/);
  // 2026-08-23 改:支持空字符串(清除样式),arg 是 null | LearningStatus
  assert.match(src, /this\.vocabStore\.setLearningStatus\(word, arg\)/);
});

test("index.ts:click .hiword-vocab-mark 跳转词库面板(disable Alt+hover)", async () => {
  const src = await readFile("src/index.ts", "utf8");
  // 在 initHoverLookup 末尾附近加了 click 监听(capture 阶段)
  assert.match(
    src,
    /closest\("\.hiword-vocab-mark"\)/,
    "应通过 closest('.hiword-vocab-mark') 找到高亮 span"
  );
  assert.match(
    src,
    /focusFeatureDock\("vocab"\)/,
    "应跳转到 vocab 面板"
  );
  assert.match(src, /scrollVocabPanelToWord/);
});

test("index.ts:scrollVocabPanelToWord:找不到目标时 showMessage 提示", async () => {
  const src = await readFile("src/index.ts", "utf8");
  const fnMatch = src.match(/private scrollVocabPanelToWord\(word: string\): void \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, "应能找到 scrollVocabPanelToWord");
  assert.match(fnMatch[0], /showMessage\(`「\$\{word\}」不在当前词本/);
  assert.match(fnMatch[0], /scrollIntoView/);
  assert.match(fnMatch[0], /whale-card--flash/);
});

test("index.ts:VocabStore 注入到 vocab-highlight 单例(单向依赖,无循环)", async () => {
  const idxSrc = await readFile("src/index.ts", "utf8");
  const hlSrc = await readFile("src/vocab/vocab-highlight.ts", "utf8");
  // index.ts 调用 configureVocabHighlightDeps
  assert.match(
    idxSrc,
    /configureVocabHighlightDeps\(\{[\s\S]*?getAllWords:[\s\S]*?onLearningStatusChange/
  );
  // vocab-highlight.ts 定义并被 configure 调用
  assert.match(hlSrc, /export function configureVocabHighlightDeps/);
  // 避免循环依赖:vocab-highlight 不应 import vocab-store
  assert.doesNotMatch(
    hlSrc,
    /from\s+["']\.\/vocab-store/,
    "vocab-highlight 不应 import vocab-store(避免循环依赖,通过注入式 deps 解决)"
  );
});
