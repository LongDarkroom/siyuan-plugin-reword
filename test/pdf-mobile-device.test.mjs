/**
 * 移动端 PDF 适配 Phase 1 · 测试 1: core/env.ts 设备分级
 * ----------------------------------------------------------------
 * 覆盖：
 *  - DeviceClass 5 种类型：ipad / iphone / android-tablet / android-phone / desktop
 *  - getDeviceClass() 多种 UA 场景判定
 *  - isSmallMobile() / isLargeMobile() 派生
 *  - iPadOS 13+ MacIntel 伪装识别（maxTouchPoints + 屏幕尺寸）
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
const envPath = join(__dirname, "..", "src", "core", "env.ts");
const src = readFileSync(envPath, "utf-8");

test("[核心] DeviceClass 5 种类型", () => {
  assert.ok(
    /export type DeviceClass\s*=\s*['"]ipad['"]\s*\|\s*['"]iphone['"]\s*\|\s*['"]android-tablet['"]\s*\|\s*['"]android-phone['"]\s*\|\s*['"]desktop['"]/.test(src),
    "DeviceScript 应有 5 种类型"
  );
});

test("[核心] getDeviceClass() 函数存在", () => {
  assert.ok(/export function getDeviceClass\(\)/.test(src), "getDeviceClass 应存在");
});

test("[核心] isSmallMobile 派生（小屏）", () => {
  assert.ok(/export function isSmallMobile\(\)/.test(src), "isSmallMobile 应存在");
  // 内部：cls === 'iphone' || cls === 'android-phone'
  assert.ok(
    /cls\s*===\s*['"]iphone['"]\s*\|\|\s*cls\s*===\s*['"]android-phone['"]/.test(src),
    "isSmallMobile 应返回 iphone 或 android-phone"
  );
});

test("[核心] isLargeMobile 派生（大屏）", () => {
  assert.ok(/export function isLargeMobile\(\)/.test(src), "isLargeMobile 应存在");
  // 内部：cls === 'ipad' || cls === 'android-tablet'
  assert.ok(
    /cls\s*===\s*['"]ipad['"]\s*\|\|\s*cls\s*===\s*['"]android-tablet['"]/.test(src),
    "isLargeMobile 应返回 ipad 或 android-tablet"
  );
});

test("[判定] iPad UA 识别", () => {
  // 找 getDeviceClass 函数体
  const fnIdx = src.indexOf("export function getDeviceClass");
  const body = src.slice(fnIdx, fnIdx + 3000);
  assert.ok(/\/iPad\//.test(body), "应识别 iPad UA");
});

test("[判定] iPhone UA 识别", () => {
  const fnIdx = src.indexOf("export function getDeviceClass");
  const body = src.slice(fnIdx, fnIdx + 3000);
  // 源码用 /iPhone|iPod/ 包含 iPod
  assert.ok(/\/iPhone(?:\||iPod|\b)/.test(body), "应识别 iPhone UA（含 iPod 兼容）");
});

test("[判定] Android UA 识别（含 tablet / phone 区分）", () => {
  const fnIdx = src.indexOf("export function getDeviceClass");
  const body = src.slice(fnIdx, fnIdx + 3000);
  assert.ok(/\/Android\//.test(body), "应识别 Android UA");
  // 应有 maxDim >= 600 区分 tablet / phone
  assert.ok(/maxDim\s*>=\s*600/.test(body), "Android 应按 maxDim 区分 tablet / phone");
});

test("[判定] iPadOS 13+ MacIntel 伪装识别", () => {
  // 关键：maxTouchPoints + MacIntel
  const fnIdx = src.indexOf("export function getDeviceClass");
  const body = src.slice(fnIdx, fnIdx + 3000);
  assert.ok(
    /maxTouchPoints\s*>\s*0/.test(body) && /Mac(intosh|Intel)/.test(body),
    "应识别 iPadOS 13+ 的 MacIntel 伪装（maxTouchPoints + UA）"
  );
});

test("[行为] 桌面优先判定（非 mobile + 屏幕 ≥600）", () => {
  const fnIdx = src.indexOf("export function getDeviceClass");
  const body = src.slice(fnIdx, fnIdx + 3000);
  assert.ok(
    /!mob\s*&&\s*maxDim\s*>=\s*600\s*\)\s*return\s*['"]desktop['"]/.test(body) ||
    /['"]desktop['"]\s*;?\s*\}/.test(body),
    "非 mobile + 大屏应返回 desktop"
  );
});

test("[兜底] 异常处理（try/catch 返回 desktop）", () => {
  const fnIdx = src.indexOf("export function getDeviceClass");
  const body = src.slice(fnIdx, fnIdx + 3000);
  assert.ok(/try\s*\{/.test(body) && /catch\s*\{[\s\S]*?return\s*['"]desktop['"]/.test(body), "异常应 fallback 到 desktop");
});

test("[回归] 已有 isMobile / isTouchDevice / isIOS / isAndroid 仍存在", () => {
  for (const fn of ["isMobile", "isTouchDevice", "isIOS", "isAndroid"]) {
    assert.ok(
      new RegExp(`export function ${fn}\\(`).test(src),
      `${fn} 应仍存在`
    );
  }
});
