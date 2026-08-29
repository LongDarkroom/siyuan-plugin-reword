/**
 * Apple Pencil 墨迹批注 · 测试 1: ink/types.ts 数据类型
 * ----------------------------------------------------------------
 * 覆盖：
 *  - InkBrush 6 种（ballpoint/pencil/marker/highlighter/fountain/eraser）
 *  - INK_COLORS 7 色（黄绿蓝粉橙紫灰）
 *  - INK_STYLES 5 种（solid/dashed/double/wavy/underline）
 *  - INK_PRESETS 6 预设
 *  - InkState / InkPoint / InkStroke / InkMode 类型
 *  - InkBrush / InkColor / InkStyle 联合类型
 *
 * 不依赖：foliate / siyuan SDK
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const typesPath = join(__dirname, "..", "src", "reader", "ink", "types.ts");
const src = readFileSync(typesPath, "utf-8");

test("[核心] InkBrush 6 种类型", () => {
  assert.ok(
    /export type InkBrush\s*=\s*["']ballpoint["']\s*\|\s*["']pencil["']\s*\|\s*["']marker["']\s*\|\s*["']highlighter["']\s*\|\s*["']fountain["']\s*\|\s*["']eraser["']/.test(src),
    "应有 6 种笔刷（球珠/铅笔/马克笔/荧光笔/钢笔/橡皮）"
  );
});

test("[核心] INK_COLORS 7 色（黄绿蓝粉橙紫灰）", () => {
  // INK_COLORS 数组应包含 7 个 hex 颜色
  const m = src.match(/export const INK_COLORS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  assert.ok(m, "INK_COLORS 应存在");
  const colors = m[1].match(/#[0-9a-fA-F]{6}/g);
  assert.ok(colors, "应包含 hex 颜色");
  assert.equal(colors.length, 7, `应有 7 色，实际 ${colors.length}`);
  // 检查关键颜色
  assert.ok(colors.includes("#facc15"), "应含黄色 #facc15");
  assert.ok(colors.includes("#22c55e"), "应含绿色 #22c55e");
  assert.ok(colors.includes("#3b82f6"), "应含蓝色 #3b82f6");
  assert.ok(colors.includes("#ec4899"), "应含粉色 #ec4899");
  assert.ok(colors.includes("#f97316"), "应含橙色 #f97316");
  assert.ok(colors.includes("#a855f7"), "应含紫色 #a855f7");
  assert.ok(colors.includes("#6b7280"), "应含灰色 #6b7280");
});

test("[核心] INK_STYLES 5 种线型", () => {
  assert.ok(
    /export const INK_STYLES\s*=\s*\[["']solid["']\s*,\s*["']dashed["']\s*,\s*["']double["']\s*,\s*["']wavy["']\s*,\s*["']underline["']\]\s*as const/.test(src),
    "应有 5 种线型（solid/dashed/double/wavy/underline）"
  );
});

test("[核心] InkMode 3 种模式", () => {
  assert.ok(
    /export type InkMode\s*=\s*["']off["']\s*\|\s*["']draw["']\s*\|\s*["']erase["']/.test(src),
    "应有 3 种墨迹模式（off / draw / erase）"
  );
});

test("[核心] InkPoint 接口（pressure + tiltX/Y + timeStamp）", () => {
  assert.ok(/export interface InkPoint \{/.test(src), "InkPoint interface 应存在");
  const body = src.match(/export interface InkPoint \{([\s\S]*?)\}/);
  assert.ok(body);
  const fields = body[1];
  assert.ok(/x:\s*number/.test(fields), "应有 x 字段");
  assert.ok(/y:\s*number/.test(fields), "应有 y 字段");
  assert.ok(/pressure:\s*number/.test(fields), "应有 pressure 字段（压感）");
  assert.ok(/t:\s*number/.test(fields), "应有 t 字段（时间戳）");
  assert.ok(/tiltX:\s*number/.test(fields), "应有 tiltX 字段（Apple Pencil 倾斜 X）");
  assert.ok(/tiltY:\s*number/.test(fields), "应有 tiltY 字段（Apple Pencil 倾斜 Y）");
});

test("[核心] InkStroke 接口（bookId + pageIndex 隔离）", () => {
  assert.ok(/export interface InkStroke \{/.test(src), "InkStroke interface 应存在");
  const body = src.match(/export interface InkStroke \{([\s\S]*?)\}/);
  assert.ok(body);
  const fields = body[1];
  // 关键字段
  assert.ok(/id:\s*string/.test(fields), "应有 id 字段");
  assert.ok(/brush:\s*InkBrush/.test(fields), "应有 brush 字段");
  assert.ok(/color:\s*InkColor/.test(fields), "应有 color 字段");
  assert.ok(/points:\s*InkPoint\[\]/.test(fields), "应有 points 字段");
  assert.ok(/path:\s*string/.test(fields), "应有 path 字段（SVG d）");
  assert.ok(/bookId:\s*string/.test(fields), "应有 bookId 字段（按书隔离）");
  assert.ok(/pageIndex:\s*number/.test(fields), "应有 pageIndex 字段（按页隔离）");
});

test("[核心] INK_PRESETS 6 预设（沿用鲸鱼批注 + 荧光笔）", () => {
  const m = src.match(/export const INK_PRESETS[\s\S]*?=\s*\[([\s\S]*?)\];\s*\n/);
  assert.ok(m, "INK_PRESETS 应存在");
  const items = m[1].match(/brush:/g);
  assert.ok(items, "应包含 brush 字段");
  assert.equal(items.length, 6, `应有 6 预设，实际 ${items.length}`);
  // 关键预设：荧光笔
  assert.ok(/highlighter/.test(m[1]), "应有荧光笔预设");
  assert.ok(/ballpoint/.test(m[1]), "应有圆珠笔预设");
});

test("[核心] InkColor / InkStyle 是联合类型", () => {
  assert.ok(/export type InkColor\s*=\s*typeof INK_COLORS\[/.test(src), "InkColor 派生自 INK_COLORS");
  assert.ok(/export type InkStyle\s*=\s*typeof INK_STYLES\[/.test(src), "InkStyle 派生自 INK_STYLES");
});

test("[核心] InkState 模式状态（mode/brush/color/style/baseWidth/opacity）", () => {
  assert.ok(/export interface InkState \{/.test(src), "InkState interface 应存在");
  const body = src.match(/export interface InkState \{([\s\S]*?)\}/)[1];
  assert.ok(/mode:\s*InkMode/.test(body), "应有 mode 字段");
  assert.ok(/brush:\s*InkBrush/.test(body), "应有 brush 字段");
  assert.ok(/color:\s*InkColor/.test(body), "应有 color 字段");
  assert.ok(/style:\s*InkStyle/.test(body), "应有 style 字段");
  assert.ok(/baseWidth:\s*number/.test(body), "应有 baseWidth 字段（基础粗细）");
  assert.ok(/opacity:\s*number/.test(body), "应有 opacity 字段");
});

test("[类型推导] INK_COLORS 数组有 6 个有效 hex 颜色（与上面 7 个区分：这里是 7 个）", () => {
  const m = src.match(/export const INK_COLORS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  const colors = m[1].match(/#[0-9a-fA-F]{6}/g);
  // 7 个（包含注释里出现的颜色） - 只要都是 hex 就行
  const unique = new Set(colors);
  assert.ok(unique.size >= 6, `应有至少 6 种独立颜色，实际 ${unique.size}`);
});
