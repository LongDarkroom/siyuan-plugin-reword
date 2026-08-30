/**
 * 阅读器 - 分类字体模式必须预热宿主字体 blob（2026-08-30）
 * ----------------------------------------------------------------
 * 用户反馈：设置面板「衬线/无衬线/等宽/中文」字体在阅读器内容里完全无效。
 *
 * 根因：prepareHostFontBlobs 只在 fontMode === "follow-siyuan" 时执行；
 *   classified 模式同样需要把宿主网页字体（霞鹜文楷等思源插件字体）blob 化
 *   后注入 foliate iframe，否则字体栈只能靠 local() fallback，未安装到系统的
 *   网页字体完全不生效。
 *
 * 本测试走源码契约扫描，不依赖 siyuan SDK / DOM。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const readerPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const readerSrc = readFileSync(readerPath, "utf-8");

const bodyOf = (src, name) => {
  const i = src.indexOf(`function ${name}`);
  if (i < 0) return "";
  const start = src.indexOf("{\n", i);
  if (start < 0) return "";
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  return "";
};

test("prepareHostFontBlobs 允许 classified 模式预热 blob", () => {
  const fn = bodyOf(readerSrc, "prepareHostFontBlobs");
  assert.ok(fn.length > 0, "应存在 prepareHostFontBlobs 函数");
  assert.doesNotMatch(fn, /settings\.fontMode\s*!==\s*["']follow-siyuan["']\s*return/,
    "旧守卫「只许 follow-siyuan」必须移除");
  assert.match(fn, /settings\.fontMode\s*!==\s*["']follow-siyuan["']\s*&&\s*settings\.fontMode\s*!==\s*["']classified["']/,
    "新守卫应同时允许 follow-siyuan 与 classified 进入 blob 预热");
});

test("onSetFontMode 切到 classified / follow-siyuan 时触发 prepareHostFontBlobs", () => {
  const fn = bodyOf(readerSrc, "onSetFontMode");
  assert.ok(fn.length > 0, "应存在 onSetFontMode 函数");
  assert.match(fn, /key\s*===\s*["']follow-siyuan["']\s*\|\|\s*key\s*===\s*["']classified["']/,
    "应判断 key 为 follow-siyuan 或 classified");
  assert.match(fn, /await\s+prepareHostFontBlobs\(\)/,
    "切到上述两种模式时应 await prepareHostFontBlobs()");
  // 确保 prepareHostFontBlobs 在 applyStyles 之前调用（await 后再 apply）
  const idxPrepare = fn.indexOf("prepareHostFontBlobs(");
  const idxApply = fn.indexOf("applyStyles()");
  assert.ok(idxPrepare > 0 && idxApply > idxPrepare,
    "prepareHostFontBlobs 应出现在 applyStyles 之前");
});
