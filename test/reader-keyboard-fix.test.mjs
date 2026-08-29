/**
 * 阅读器键盘方向键修复 · 测试
 * ----------------------------------------------------------------
 * 用户反馈（2026-08-29）：用几次方向键翻页后有时键盘会失效
 *
 * 根因：方向键 keydown 监听器只绑在 iframe contentDocument，
 *       焦点漂移到工具栏/批注/搜索框后 iframe doc 收不到 keydown。
 *
 * 修复：在 main document capture 阶段注册 onGlobalKey，
 *       统一处理方向键 / PageUp/Down / Home/End / Space / F3 / Cmd+F。
 *       onDestroy 注销。跳过 input/textarea/contenteditable。
 *       iframe 内 onKeyDown 加 stopPropagation 防止重复翻页。
 *
 * 不依赖：foliate / siyuan SDK
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const src = readFileSync(
  join(__dirname, "..", "src", "reader", "ReaderView.svelte"),
  "utf-8"
);

test("[核心] 顶层 div 不再用 Svelte on:keydown（避免重复触发）", () => {
  // 修复前：<div class="reader-view" on:keydown={onGlobalKey}>
  // 修复后：capture 阶段在 main document 注册，模板上不再需要
  assert.ok(
    !/class="reader-view"[^>]*on:keydown\s*=\s*\{\s*onGlobalKey/.test(src),
    "顶层 div 不应再用 Svelte 模板 on:keydown={onGlobalKey}（会与 capture 阶段重复）"
  );
  // 但 reader-view div 仍存在
  assert.ok(/class="reader-view"/.test(src), "reader-view div 仍应存在");
});

test("[核心] onMount 在 main document 注册 capture 阶段 keydown", () => {
  // 应该有 document.addEventListener("keydown", onGlobalKey, true)
  const m = src.match(/document\.addEventListener\(\s*["']keydown["']\s*,\s*onGlobalKey\s*,\s*true\s*\)/);
  assert.ok(m, "应在 onMount 调 document.addEventListener('keydown', onGlobalKey, true) 注册 capture 阶段监听");
});

test("[核心] onDestroy 注销 main document capture 阶段 keydown", () => {
  // 应该有 document.removeEventListener("keydown", onGlobalKey, true)
  const m = src.match(/document\.removeEventListener\(\s*["']keydown["']\s*,\s*onGlobalKey\s*,\s*true\s*\)/);
  assert.ok(m, "应在 onDestroy 调 document.removeEventListener 注销");
});

test("[核心] onGlobalKey 加方向键 / PageUp/PageDown / Home/End / Space 处理", () => {
  // 找 onGlobalKey 函数体（可能有重复定义，看第二个是 onMount 注册时引用的）
  // 简化为：在 src 里能找到 onGlobalKey 函数体里所有这些键的处理
  const handlers = ["ArrowRight", "ArrowLeft", "PageDown", "PageUp", "Home", "End", "F3", '" "'];
  for (const k of handlers) {
    // 找 onGlobalKey 函数体（粗略）
    const globalKeyIdx = src.indexOf("function onGlobalKey");
    assert.ok(globalKeyIdx > 0, "onGlobalKey 函数应存在");
    // 取 onGlobalKey 函数体（5000 字符够用）
    const body = src.slice(globalKeyIdx, globalKeyIdx + 5000);
    assert.ok(
      body.includes(k) || new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(body),
      `onGlobalKey 函数体应处理 ${k} 键`
    );
  }
});

test("[关键] onGlobalKey 跳过输入控件（保留原生行为）", () => {
  // 找 onGlobalKey 函数体
  const globalKeyIdx = src.indexOf("function onGlobalKey");
  const body = src.slice(globalKeyIdx, globalKeyIdx + 2000);
  // 应跳过 INPUT / TEXTAREA / contenteditable
  assert.ok(/INPUT/.test(body), "onGlobalKey 应跳过 INPUT 元素");
  assert.ok(/TEXTAREA/.test(body), "onGlobalKey 应跳过 TEXTAREA 元素");
  assert.ok(/isContentEditable/.test(body), "onGlobalKey 应跳过 contenteditable 元素");
});

test("[关键] iframe doc 内 onKeyDown 加 stopPropagation 防止重复翻页", () => {
  // 找 iframe doc 的 onKeyDown 函数体
  const keyDownIdx = src.indexOf("const onKeyDown = (e: KeyboardEvent) => {");
  assert.ok(keyDownIdx > 0, "iframe doc onKeyDown 函数应存在");
  // 取函数体
  let depth = 0;
  let bodyEnd = -1;
  for (let i = keyDownIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  assert.ok(bodyEnd > 0, "应能找到 onKeyDown 函数体");
  const body = src.slice(keyDownIdx, bodyEnd);
  // 检查关键键都有 e.stopPropagation()
  for (const k of ['k === "PageDown"', 'k === "PageUp"', 'k === "ArrowRight"', 'k === "ArrowLeft"', 'k === "Home"', 'k === "End"']) {
    if (body.includes(k)) {
      // 找到这个 if 块，检查附近有 stopPropagation
      const idx = body.indexOf(k);
      const slice = body.slice(idx, idx + 300);
      assert.ok(
        /e\.stopPropagation/.test(slice),
        `${k} 块应调 e.stopPropagation() 防止重复翻页`
      );
    }
  }
});

test("[行为] onGlobalKey 在 offsetParent=null（非激活 Tab）时不响应", () => {
  const globalKeyIdx = src.indexOf("function onGlobalKey");
  const body = src.slice(globalKeyIdx, globalKeyIdx + 500);
  assert.ok(
    /offsetParent\s*===\s*null/.test(body),
    "onGlobalKey 应检查 container.offsetParent === null"
  );
});

test("[兜底] onGlobalKey 调 view 方法用 optional chaining 避免 null 崩溃", () => {
  const globalKeyIdx = src.indexOf("function onGlobalKey");
  const body = src.slice(globalKeyIdx, globalKeyIdx + 3000);
  // 应有 view?.goLeft?.() / view?.goRight?.() 等 optional chaining
  assert.ok(/view\?\.goLeft\?/.test(body), "应使用 view?.goLeft?.() 避免 null 崩溃");
  assert.ok(/view\?\.goRight\?/.test(body), "应使用 view?.goRight?.()");
  assert.ok(/view\?\.goToTextStart\?/.test(body), "应使用 view?.goToTextStart?.()");
  assert.ok(/view\?\.goTo\?/.test(body), "应使用 view?.goTo?.()");
});
