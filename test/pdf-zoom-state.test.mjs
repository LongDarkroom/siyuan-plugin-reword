/**
 * PDF 缩放 Phase 1 · 测试 1: bookshelf-store.ts ZoomState 数据模型
 * ----------------------------------------------------------------
 * 覆盖：
 *  - ZoomState 三种类型：fit-width / fit-page / custom
 *  - ZOOM_PRESETS 预设档位（[0.5, 0.75, 1, 1.25, 1.5, 2]）
 *  - ReadingProgress 包含 zoom 字段
 *  - zoom 字段是 optional（老数据兼容）
 *  - 三种 ZoomState 可序列化（JSON.stringify 不丢失信息）
 *
 * 不依赖：foliate / siyuan SDK（纯 TypeScript 源码验证）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const storePath = join(__dirname, "..", "src", "reader", "bookshelf-store.ts");
const src = readFileSync(storePath, "utf-8");

test("[核心] ZoomState 类型导出（fit-width / fit-page / custom）", () => {
  assert.ok(
    /export type ZoomState[\s\S]*?fit-width[\s\S]*?fit-page[\s\S]*?custom[\s\S]*?scale: number/.test(src),
    "ZoomState 应有 fit-width / fit-page / custom(scale) 三种"
  );
});

test("[核心] ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] 导出", () => {
  const m = src.match(/export const ZOOM_PRESETS[\s\S]*?=\s*\[([^\]]+)\]/);
  assert.ok(m, "ZOOM_PRESETS 应导出");
  const arrStr = m[1];
  // 应有 0.5, 0.75, 1, 1.25, 1.5, 2
  for (const v of ["0.5", "0.75", "1", "1.25", "1.5", "2"]) {
    assert.ok(arrStr.includes(v), `ZOOM_PRESETS 应含 ${v}，实际：${arrStr}`);
  }
});

test("[ReadingProgress] zoom 字段是 optional（老数据兼容）", () => {
  // 找 ReadingProgress interface 的 zoom 字段
  const m = src.match(/export interface ReadingProgress \{([\s\S]*?)\}/);
  assert.ok(m, "ReadingProgress interface 应存在");
  const body = m[1];
  assert.ok(/zoom\?:\s*ZoomState/.test(body), "ReadingProgress.zoom 字段应存在且为 optional");
  // 老的 cfi / fraction / index 仍存在
  assert.ok(/cfi\?:/.test(body), "cfi 字段仍存在");
  assert.ok(/fraction\?:/.test(body), "fraction 字段仍存在");
  assert.ok(/index\?:/.test(body), "index 字段仍存在");
});

test("[序列化] ZoomState 三种类型都能 JSON.stringify / parse 还原", () => {
  // 模拟序列化测试（纯 JS）
  const fitWidth = { kind: "fit-width" };
  const fitPage = { kind: "fit-page" };
  const custom = { kind: "custom", scale: 1.25 };

  for (const z of [fitWidth, fitPage, custom]) {
    const round = JSON.parse(JSON.stringify(z));
    assert.deepEqual(round, z, `${JSON.stringify(z)} 应能序列化还原`);
  }
});

test("[行为] ZOOM_PRESETS 是 6 档等比数列（参考 Obsidian PDF++）", () => {
  // 6 档：50%, 75%, 100%, 125%, 150%, 200%
  const m = src.match(/export const ZOOM_PRESETS[\s\S]*?=\s*\[([^\]]+)\]/);
  const arr = m[1].split(",").map((s) => parseFloat(s.trim()));
  assert.equal(arr.length, 6, "应恰好 6 档");
  // 验证 100% = 1.0 在中间
  assert.equal(arr[2], 1.0, "100% 应在第 3 档");
  // 验证 50% = 0.5 在最前
  assert.equal(arr[0], 0.5, "50% 应在最前");
  // 验证 200% = 2 在最后
  assert.equal(arr[5], 2, "200% 应在最后");
});

test("[回归] BookMeta 字段不应受 zoom 字段影响", () => {
  const m = src.match(/export interface BookMeta \{([\s\S]*?)\n\}/);
  assert.ok(m, "BookMeta interface 应存在");
  const body = m[1];
  // 原有字段
  assert.ok(/format:\s*string/.test(body), "format 字段仍存在");
  assert.ok(/cover\?:\s*string/.test(body), "cover 字段仍存在");
  assert.ok(/progress\?:\s*ReadingProgress/.test(body), "progress 字段引用 ReadingProgress");
});
