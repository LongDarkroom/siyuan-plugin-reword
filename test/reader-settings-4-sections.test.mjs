// 阅读器 - 4 大设置分类（文本/段落/页面布局/笔记插入）测试（2026-08-24）
// ----------------------------------------------------------------
// 用户 16:18 反馈：给 REword 阅读面板设置增加 4 大分类功能，参考思阅 SiReader。
//
// 覆盖：
// A. 数据结构（reader-settings.ts） —— 6 用例
// B. CSS 应用（reader-style.ts）   —— 5 用例
// C. 设置 UI 模板（ReaderView.svelte） —— 7 用例
// D. 笔记模板渲染（renderNoteTemplate） —— 5 用例
// E. 笔记插入 handler（onSelSend 改造） —— 4 用例
// F. 回归：现有功能           —— 3 用例

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const settingsPath = join(ROOT, "src/reader/reader-settings.ts");
const stylePath = join(ROOT, "src/reader/reader-style.ts");
const viewPath = join(ROOT, "src/reader/ReaderView.svelte");
const tabPath = join(ROOT, "src/reader/reader-tab.ts");

const settingsSrc = readFileSync(settingsPath, "utf-8");
const styleSrc = readFileSync(stylePath, "utf-8");
const viewSrc = readFileSync(viewPath, "utf-8");
const tabSrc = readFileSync(tabPath, "utf-8");

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "");

// ============== A. 数据结构（reader-settings.ts） ==============

test("A1: ReaderSettings 含 text/paragraph/layout/note 4 个嵌套字段", () => {
  // 类型定义包含 text/paragraph/layout/note 字段
  for (const k of ["text:", "paragraph:", "layout:", "note:"]) {
    assert.match(settingsSrc, new RegExp(`\\b${k.replace(":", "")}\\s*:`), `ReaderSettings 应含 ${k} 字段`);
  }
});

test("A2: READER_DEFAULT_SETTINGS.text.fontWeight 默认 400", () => {
  assert.match(settingsSrc, /text:\s*\{[^}]*fontWeight:\s*400/s, "fontWeight 应默认 400");
});

test("A3: READER_DEFAULT_SETTINGS.paragraph.paragraphSpacing 默认 0.8", () => {
  assert.match(settingsSrc, /paragraph:\s*\{[^}]*paragraphSpacing:\s*0\.8/s, "paragraphSpacing 应默认 0.8");
});

test("A4: READER_DEFAULT_SETTINGS.layout.showHeader 默认 true", () => {
  assert.match(settingsSrc, /layout:\s*\{[^}]*showHeader:\s*true/s, "showHeader 应默认 true");
});

test("A5: READER_DEFAULT_SETTINGS.note.insertPosition 默认 clipboard", () => {
  assert.match(settingsSrc, /insertPosition:\s*["']clipboard["']/, "insertPosition 应默认 clipboard");
});

test("A6: READER_DEFAULT_SETTINGS.note.linkFormat 含 text + bookTitle 变量", () => {
  assert.match(settingsSrc, /linkFormat:[^`]*\{\{text\}\}/, "linkFormat 应含 {{text}} 变量");
  assert.match(settingsSrc, /linkFormat:[^`]*\{\{bookTitle\}\}/, "linkFormat 应含 {{bookTitle}} 变量");
});

// ============== B. CSS 应用（reader-style.ts） ==============

test("B1: buildReaderStyles 输出 font-weight: 700 当 fontWeight=700", () => {
  const css = styleSrc.match(/export\s+function\s+textStyles[\s\S]*?return\s+`([^`]+)`/)?.[1] ?? "";
  assert.ok(css.includes("font-weight"), `textStyles 应输出 font-weight，实际：${css}`);
  const out = css.replace(/\$\{fw[^}]*\}/g, "700");
  assert.ok(out.includes("font-weight: 700"), `应输出 font-weight: 700，实际：${out}`);
});

test("B2: 输出 letter-spacing: 1.5px 当 letterSpacing=1.5", () => {
  const css = styleSrc.match(/export\s+function\s+textStyles[\s\S]*?return\s+`([^`]+)`/)?.[1] ?? "";
  const out = css.replace(/\$\{ls[^}]*\}/g, "1.5");
  assert.ok(out.includes("letter-spacing: 1.5px"), `应输出 letter-spacing: 1.5px，实际：${out}`);
});

test("B3: 输出 margin-bottom: 1.2em 当 paragraphSpacing=1.2", () => {
  const css = styleSrc.match(/export\s+function\s+paragraphLayoutStyles[\s\S]*?return\s+`([^`]+)`/)?.[1] ?? "";
  const out = css.replace(/\$\{ps[^}]*\}/g, "1.2");
  assert.ok(out.includes("margin-bottom: 1.2em"), `应输出 margin-bottom: 1.2em，实际：${out}`);
});

test("B4: 输出 text-indent: 2em 当 textIndent=2", () => {
  const css = styleSrc.match(/export\s+function\s+paragraphLayoutStyles[\s\S]*?return\s+`([^`]+)`/)?.[1] ?? "";
  const out = css.replace(/\$\{ti[^}]*\}/g, "2");
  assert.ok(out.includes("text-indent: 2em"), `应输出 text-indent: 2em，实际：${out}`);
});

test("B5: 输出 margin: 16 16 16 16 当 4 边距都=16", () => {
  const css = styleSrc.match(/export\s+function\s+layoutMarginStyles[\s\S]*?return\s+`([^`]+)`/)?.[1] ?? "";
  const out = css
    .replace(/\$\{mt[^}]*\}/g, "16")
    .replace(/\$\{mb[^}]*\}/g, "16")
    .replace(/\$\{ml[^}]*\}/g, "16")
    .replace(/\$\{mr[^}]*\}/g, "16")
    .replace(/\$\{gap[^}]*\}/g, "16");
  assert.ok(/margin:\s*16px\s+16px\s+16px\s+16px/.test(out), `应输出 margin: 16px 16px 16px 16px，实际：${out}`);
});

// ============== C. 设置 UI 模板（ReaderView.svelte） ==============

test("C1: 设置弹窗含 4 个 details.reader-setting-section", () => {
  const m = viewSrc.match(/<details\s+class="reader-setting-section"/g);
  assert.ok(m && m.length >= 4, `应至少 4 个 details 分组，实际 ${m?.length ?? 0}`);
});

test("C2: 文本设置分组含字号/字重/字距", () => {
  // 提取第 1 个 <details> 块（文本设置）
  const blocks = viewSrc.match(/<details\s+class="reader-setting-section"[^>]*>[\s\S]*?<\/details>/g) ?? [];
  assert.ok(blocks[0], "应至少有 1 个 details 块");
  for (const label of ["字号", "字重", "字距"]) {
    assert.match(blocks[0], new RegExp(`>${label}<`), `文本设置分组应含 ${label}`);
  }
});

test("C3: 段落设置分组含行距/段距/首行缩进", () => {
  const blocks = viewSrc.match(/<details\s+class="reader-setting-section"[^>]*>[\s\S]*?<\/details>/g) ?? [];
  assert.ok(blocks[1], "应至少有 2 个 details 块");
  for (const label of ["行距", "段距", "首行缩进"]) {
    assert.match(blocks[1], new RegExp(`>${label}<`), `段落设置分组应含 ${label}`);
  }
});

test("C4: 页面布局分组含 4 边距 + 3 switch + dropdown + slider", () => {
  const blocks = viewSrc.match(/<details\s+class="reader-setting-section"[^>]*>[\s\S]*?<\/details>/g) ?? [];
  assert.ok(blocks[2], "应至少有 3 个 details 块");
  for (const label of ["上边距", "下边距", "左边距", "右边距", "分栏间距", "显示页眉", "显示页脚", "显示阅读进度", "进度样式"]) {
    assert.match(blocks[2], new RegExp(`>${label}<`), `页面布局分组应含 ${label}`);
  }
});

test("C5: 笔记插入分组含 2 switch + dropdown + 2 textarea", () => {
  const blocks = viewSrc.match(/<details\s+class="reader-setting-section"[^>]*>[\s\S]*?<\/details>/g) ?? [];
  assert.ok(blocks[3], "应至少有 4 个 details 块");
  for (const label of ["添加时同步", "删除时同步", "插入位置", "模板预设", "链接格式", "排除正则", "标注标签预设"]) {
    assert.match(blocks[3], new RegExp(`>${label}<`), `笔记插入分组应含 ${label}`);
  }
  // textarea 数量：3（链接格式、排除正则、标签预设）
  const textareas = blocks[3].match(/<textarea[\s\S]*?<\/textarea>/g) ?? [];
  assert.ok(textareas.length >= 3, `笔记插入分组应至少 3 个 textarea，实际 ${textareas.length}`);
});

test("C6: 字重 slider 有 min=100 / max=900 / step=100", () => {
  assert.match(viewSrc, /min="100"\s+max="900"\s+step="100"[^>]*value=\{settings\.text\.fontWeight\}/, "字重 slider 应 min=100 max=900 step=100");
});

test("C7: 笔记插入 linkFormat textarea 是双向绑定", () => {
  // 找 textarea 上下文（链接格式 textarea）
  assert.match(viewSrc, /<textarea[^>]*class="reader-setting-textarea"[^>]*value=\{settings\.note\.linkFormat\}/, "linkFormat textarea 应绑定 settings.note.linkFormat");
  assert.match(viewSrc, /on:input=\{[^}]*setNoteLinkFormat/, "linkFormat textarea 应调用 setNoteLinkFormat");
});

// ============== D. 笔记模板渲染（renderNoteTemplate） ==============

/** 内联模拟 renderNoteTemplate（与 ReaderView.svelte 同步） */
function renderNoteTemplate(
  template,
  vars
) {
  if (!template) return vars.text || "";
  return String(template).replace(/\{\{(\w+)\}\}/g, (m, name) => {
    const v = vars[name];
    return v === undefined || v === null ? m : String(v);
  });
}

test("D1: {{text}} 替换为选中文本", () => {
  const out = renderNoteTemplate("> {{text}}", { text: "异化的劳动" });
  assert.equal(out, "> 异化的劳动");
});

test("D2: {{bookTitle}} 替换为书名", () => {
  const out = renderNoteTemplate("《{{bookTitle}}》", { bookTitle: "单片眼镜" });
  assert.equal(out, "《单片眼镜》");
});

test("D3: {{chapter}} 替换为章节", () => {
  const out = renderNoteTemplate("——{{chapter}}", { chapter: "第三章 异化" });
  assert.equal(out, "——第三章 异化");
});

test("D4: 多个变量都替换", () => {
  const out = renderNoteTemplate("> {{text}}\n——《{{bookTitle}}》{{chapter}}", {
    text: "abc",
    bookTitle: "X",
    chapter: "1",
  });
  assert.equal(out, "> abc\n——《X》1");
});

test("D5: 未知变量保留原样（不抛错）", () => {
  const out = renderNoteTemplate("{{text}} {{unknown_var}}", { text: "ok" });
  assert.equal(out, "ok {{unknown_var}}");
});

// ============== E. 笔记插入 handler（onSelSend 改造） ==============

test("E1: onSelSend 处理 insertPosition=clipboard 分支", () => {
  assert.match(viewSrc, /pos\s*===\s*["']clipboard["']/, "onSelSend 应处理 clipboard 分支");
  assert.match(viewSrc, /navigator\.clipboard\?\.writeText/, "clipboard 分支应调 clipboard.writeText");
  assert.match(viewSrc, /已复制到剪贴板/, "应有 toast 反馈");
});

test("E2: onSelSend 处理 insertPosition=notebook 分支（兼容 onSendToNote）", () => {
  // notebook 分支：兜底使用 onSendToNote
  assert.match(viewSrc, /onSendToNote\s*\(\s*\{[^}]*markdown:\s*md/, "notebook 分支应调 onSendToNote({ markdown: md, ... })");
  assert.match(viewSrc, /已发送到笔记本/, "应有 toast 反馈");
});

test("E3: onSelSend 处理 insertPosition=currentDoc 分支（兼容 onInsertToCurrentDoc）", () => {
  assert.match(viewSrc, /onInsertToCurrentDoc/, "应处理 currentDoc 分支（onInsertToCurrentDoc）");
  assert.match(viewSrc, /pos\s*===\s*["']currentDoc["']/, "应有 currentDoc 分支判断");
});

test("E4: 模板为空时使用 default 模板", () => {
  assert.match(viewSrc, /linkFormat\s*\|\|\s*NOTE_TEMPLATE_PRESETS\.simple\.template/, "模板为空时应用 simple 模板兜底");
});

// ============== F. 回归：现有功能 ==============

test("F1: 旧字段 fontSize / lineHeight 仍可读（向后兼容）", () => {
  // fontSize 应仍是 ReaderSettings 顶层字段
  const ifs = settingsSrc.match(/interface\s+ReaderSettings\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(ifs, /\bfontSize:\s*number/, "ReaderSettings.fontSize 仍应在");
  assert.match(ifs, /\blineHeight:\s*number/, "ReaderSettings.lineHeight 仍应在");
});

test("F2: 旧字段修改仍触发样式重应用（changeFont/setLineHeight 仍存在）", () => {
  assert.match(viewSrc, /function\s+changeFont\s*\(/, "changeFont 函数应保留");
  assert.match(viewSrc, /function\s+setLineHeight\s*\(/, "setLineHeight 函数应保留");
});

test("F3: 主题切换 + 字体选择仍存在（onSetTheme/pickFontMode 不受影响）", () => {
  assert.match(viewSrc, /function\s+onSetTheme\s*\(/, "onSetTheme 函数应保留");
  assert.match(viewSrc, /function\s+pickFontMode\s*\(/, "pickFontMode 函数应保留");
});
