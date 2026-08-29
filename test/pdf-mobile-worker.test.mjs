/**
 * 移动端 PDF 适配 Phase 1 · 测试 2: PDF.js worker 弱设备兑底
 * ----------------------------------------------------------------
 * 覆盖：
 *  - bookshelf-store.ts: 弱设备判断（mobile UA / iOS / < 4 核）
 *  - 弱设备 workerSrc = ''（主线程）
 *  - 桌面/强设备 workerSrc = /plugins/<name>/pdf.worker.mjs
 *  - foliate-js/pdf.js 同样应用弱设备判断
 *  - 两处都用同样的判断逻辑
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
const storePath = join(__dirname, "..", "src", "reader", "bookshelf-store.ts");
const pdfPath = join(__dirname, "..", "src", "reader", "vendor", "foliate-js", "pdf.js");
const storeSrc = readFileSync(storePath, "utf-8");
const pdfSrc = readFileSync(pdfPath, "utf-8");

test("[核心] bookshelf-store.ts 弱设备判断函数存在", () => {
  // 弱设备判断应该在 workerSrc 设置块内
  const isWeakDeviceMatch = storeSrc.match(/isWeakDevice[\s\S]*?return\s+isMob\s*\|\|[\s\S]*?cores\s*<\s*4/);
  assert.ok(isWeakDeviceMatch, "bookshelf-store.ts 弱设备判断逻辑应存在");
});

test("[核心] 弱设备 workerSrc = '' 主线程模式", () => {
  // 找 isWeakDevice 块后应有 workerSrc = ''
  const weakIdx = storeSrc.indexOf("if (isWeakDevice)");
  assert.ok(weakIdx > 0, "应有 if (isWeakDevice) 分支");
  const block = storeSrc.slice(weakIdx, weakIdx + 500);
  assert.ok(
    /workerSrc\s*=\s*['"]['"]/.test(block),
    "弱设备应设 workerSrc = '' 走主线程"
  );
});

test("[核心] 强设备 workerSrc = /plugins/<name>/pdf.worker.mjs", () => {
  // else 分支
  const weakIdx = storeSrc.indexOf("if (isWeakDevice)");
  const elseBlock = storeSrc.slice(weakIdx, weakIdx + 1000);
  assert.ok(
    /\/plugins\/siyuan-plugin-reword\/pdf\.worker\.mjs/.test(elseBlock),
    "强设备应设 workerSrc = /plugins/siyuan-plugin-reword/pdf.worker.mjs"
  );
});

test("[核心] 弱设备判断用 navigator.hardwareConcurrency < 4", () => {
  const isWeakDeviceMatch = storeSrc.match(/isWeakDevice[\s\S]*?return\s+isMob\s*\|\|[\s\S]*?cores\s*<\s*4/);
  assert.ok(isWeakDeviceMatch, "应检查 hardwareConcurrency < 4");
});

test("[核心] 弱设备判断用 UA 包含 iOS", () => {
  const isWeakDeviceMatch = storeSrc.match(/isWeakDevice[\s\S]*?return\s+isMob\s*\|\|[\s\S]*?isIOS\s*\|\|/);
  assert.ok(isWeakDeviceMatch, "应检查 isIOS（包含 iPad / iPhone / iPod）");
});

test("[核心] foliate-js/pdf.js 同样有弱设备判断", () => {
  // 找 _rewordIsWeakDevice IIFE
  assert.ok(
    /_rewordIsWeakDevice/.test(pdfSrc),
    "foliate-js/pdf.js 应该有 _rewordIsWeakDevice 弱设备判断"
  );
});

test("[核心] foliate-js/pdf.js 弱设备 workerSrc = ''", () => {
  // 找 _rewordIsWeakDevice 的**使用处**（赋值给 workerSrc），不是定义处（IIFE）
  // 源码：pdfjsLib.GlobalWorkerOptions.workerSrc = _rewordIsWeakDevice
  //     ? ''  // 弱设备：fake worker（主线程跑）
  //     : (...)
  // 找第 2 次出现（使用处）
  const firstIdx = pdfSrc.indexOf("_rewordIsWeakDevice");
  assert.ok(firstIdx > 0, "应有 _rewordIsWeakDevice 定义");
  const useIdx = pdfSrc.indexOf("_rewordIsWeakDevice", firstIdx + 1);
  assert.ok(useIdx > 0, "应有 _rewordIsWeakDevice 使用处（赋值给 workerSrc）");
  const after = pdfSrc.slice(useIdx, useIdx + 400);
  // 弱设备分支应设空字符串（单引号或双引号）
  assert.ok(
    /_rewordIsWeakDevice[\s\S]{0,100}?\?\s*['"]['"]/.test(after),
    "弱设备三元应设 workerSrc = ''（空字符串）"
  );
  // 同时检查有 ? 三元运算
  assert.ok(/\?/.test(after.slice(0, 50)), "三元 ? 应在使用处附近");
});

test("[核心] foliate-js/pdf.js 桌面 workerSrc = /plugins/<name>/pdf.worker.mjs", () => {
  // 强设备分支（_rewordOrigin ? /plugins/.../pdf.worker.mjs : ./pdf.worker.mjs）
  assert.ok(
    /\/plugins\/\$\{_rewordPluginName\}\/pdf\.worker\.mjs/.test(pdfSrc) ||
    /\/plugins\/siyuan-plugin-reword\/pdf\.worker\.mjs/.test(pdfSrc),
    "强设备 workerSrc 应指向 /plugins/siyuan-plugin-reword/pdf.worker.mjs"
  );
});

test("[一致性] bookshelf-store 和 foliate-js/pdf.js 弱设备判断逻辑一致", () => {
  // 两者都应包含 hardwareConcurrency / isIOS 判断
  assert.ok(/hardwareConcurrency/.test(storeSrc), "bookshelf-store 应有 hardwareConcurrency");
  assert.ok(/hardwareConcurrency/.test(pdfSrc), "foliate-js/pdf.js 应有 hardwareConcurrency");
  assert.ok(/isIOS|iPad|iPhone/.test(storeSrc), "bookshelf-store 应有 iOS 检查");
  assert.ok(/isIOS|iPad|iPhone/.test(pdfSrc), "foliate-js/pdf.js 应有 iOS 检查");
});

test("[注释] 两处都有 [REword patch 2026-08-29] 标记", () => {
  // 注释可能在 IIFE 函数上方
  assert.ok(/\[REword patch 2026-08-29\]/.test(storeSrc), "bookshelf-store 应有 REword patch 注释");
  assert.ok(/\[REword patch 2026-08-29\]/.test(pdfSrc), "foliate-js/pdf.js 应有 REword patch 注释");
  // 弱设备文字可能在注释中
  assert.ok(/弱设备/.test(storeSrc) || /弱设备/.test(pdfSrc), "应至少一处提到'弱设备'");
});
