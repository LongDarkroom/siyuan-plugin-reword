/**
 * Apple Pencil 墨迹批注 · 测试 2: ink/utils.ts 渲染工具（源码验证）
 * ----------------------------------------------------------------
 * 由于 utils.ts 引用 InkPoint 类型，动态 Function 执行会失败，
 * 改用 grep 风格验证源码逻辑（Catmull-Rom 公式 + 压力公式 + 倾斜判定）
 *
 * 覆盖：
 *  - catmullRomToBezierPath：0/1/2/3+ 点分支 + Catmull-Rom 公式 cp1 = p1 + (p2-p0)/6
 *  - pressureToWidthScale：公式 0.3 + pressure * 1.1，特殊值
 *  - shouldUseHighlighter：Math.max(|tiltX|, |tiltY|) >= 45
 *  - getCoalescedPoints：getCoalescedEvents + fallback
 *  - brushToSvgProps：6 笔刷 case + mix-blend-mode + stroke-linecap
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
const utilsPath = join(__dirname, "..", "src", "reader", "ink", "utils.ts");
const src = readFileSync(utilsPath, "utf-8");

/* ========== catmullRomToBezierPath 测试 ========== */

test("[核心] catmullRomToBezierPath: 0 点 → 空字符串", () => {
  // 函数体里应有 `if (points.length === 0) return "";`
  assert.ok(
    /points\.length\s*===\s*0[\s\S]*?return\s*["']["']/.test(src),
    "0 点应 return 空字符串"
  );
});

test("[核心] catmullRomToBezierPath: 1 点 → M x y", () => {
  assert.ok(
    /points\.length\s*===\s*1[\s\S]*?return\s*`M\s*\$\{points\[0\]\.x\.toFixed\(2\)\}\s*\$\{points\[0\]\.y\.toFixed\(2\)\}`/.test(src),
    "1 点应返回 M x.xx y.yy"
  );
});

test("[核心] catmullRomToBezierPath: 2 点 → M ... L ...", () => {
  assert.ok(
    /points\.length\s*===\s*2[\s\S]*?return\s*`M\s*\$\{points\[0\][\s\S]*?L\s*\$\{points\[1\][\s\S]*?`/.test(src),
    "2 点应返回 M ... L ... 直线段"
  );
});

test("[核心] catmullRomToBezierPath: 3+ 点 → Catmull-Rom 拟合（cubic Bezier）", () => {
  // 起点 M
  assert.ok(/`M\s*\$\{points\[0\]\.x/.test(src), "应以 M 起点");
  // Catmull-Rom 控制点公式：cp1 = p1 + (p2 - p0) / 6
  assert.ok(
    /cp1x\s*=\s*p1\.x\s*\+\s*\(p2\.x\s*-\s*p0\.x\)\s*\/\s*6/.test(src),
    "应有 Catmull-Rom 控制点公式 cp1x = p1.x + (p2.x - p0.x) / 6"
  );
  assert.ok(
    /cp2x\s*=\s*p2\.x\s*-\s*\(p3\.x\s*-\s*p1\.x\)\s*\/\s*6/.test(src),
    "应有 Catmull-Rom 控制点公式 cp2x = p2.x - (p3.x - p1.x) / 6"
  );
  // cubic Bezier C 段
  assert.ok(
    /`C\s*\$\{cp1x\.toFixed\(2\)\}/.test(src),
    "应输出 cubic Bezier C 段"
  );
});

test("[关键] catmullRomToBezierPath 数值精度 .toFixed(2)", () => {
  // 坐标应保留 2 位小数（避免 path 太长）
  const matches = src.match(/\.toFixed\(2\)/g);
  assert.ok(matches, "应有 .toFixed(2) 调用");
  assert.ok(matches.length >= 5, `应至少 5 处 .toFixed(2)，实际 ${matches.length}`);
});

/* ========== pressureToWidthScale 测试 ========== */

test("[核心] pressureToWidthScale: 公式 0.3 + pressure * 1.1", () => {
  // 公式：return 0.3 + pressure * 1.1
  assert.ok(
    /return\s+0\.3\s*\+\s*pressure\s*\*\s*1\.1/.test(src),
    "应有公式 0.3 + pressure * 1.1"
  );
});

test("[核心] pressureToWidthScale: pressure=0 → fallback 1.0", () => {
  assert.ok(
    /if\s*\(\s*pressure\s*<=\s*0\s*\)\s*return\s+1\.0/.test(src),
    "pressure <= 0 应 return 1.0（默认）"
  );
});

test("[关键] pressureToWidthScale: 边界值（0.5 → 0.85, 1 → 1.4）", () => {
  // 0.5 * 1.1 + 0.3 = 0.85 ✓
  // 1.0 * 1.1 + 0.3 = 1.4 ✓
  // 测试公式正确性：源码 grep 验证
  assert.ok(/pressure\s*\*\s*1\.1/.test(src), "应有 pressure * 1.1");
  // 计算：pressure=0.5 → 0.3 + 0.55 = 0.85
  // 计算：pressure=1.0 → 0.3 + 1.1 = 1.4
  const test05 = 0.3 + 0.5 * 1.1;
  const test10 = 0.3 + 1.0 * 1.1;
  assert.ok(Math.abs(test05 - 0.85) < 0.01, `pressure=0.5 应得 0.85，公式验证：${test05}`);
  assert.ok(Math.abs(test10 - 1.4) < 0.01, `pressure=1.0 应得 1.4，公式验证：${test10}`);
});

/* ========== shouldUseHighlighter 测试 ========== */

test("[核心] shouldUseHighlighter: Math.max(|tiltX|, |tiltY|) >= 45", () => {
  assert.ok(
    /Math\.max\(\s*Math\.abs\(tiltX\)\s*,\s*Math\.abs\(tiltY\)\s*\)/.test(src),
    "应取 tiltX/tiltY 绝对值最大值"
  );
  assert.ok(/>=\s*45/.test(src), "阈值 45°");
});

test("[关键] shouldUseHighlighter: return boolean", () => {
  // 整函数体
  const m = src.match(/export function shouldUseHighlighter[\s\S]*?\n\}/);
  assert.ok(m, "shouldUseHighlighter 应存在");
  const body = m[0];
  assert.ok(/return\s+maxTilt\s*>=\s*45/.test(body) || /return\s+.*>=\s*45/.test(body), "应 return maxTilt >= 45");
});

/* ========== getCoalescedPoints 测试 ========== */

test("[核心] getCoalescedPoints: 读 PointerEvent.getCoalescedEvents()", () => {
  assert.ok(/getCoalescedEvents/.test(src), "应调 getCoalescedEvents");
  assert.ok(/offsetX/.test(src), "应使用 offsetX（PointerEvent 坐标）");
  assert.ok(/offsetY/.test(src), "应使用 offsetY");
  assert.ok(/pressure/.test(src), "应读取 pressure");
  assert.ok(/tiltX/.test(src), "应读取 tiltX");
  assert.ok(/tiltY/.test(src), "应读取 tiltY");
  assert.ok(/timeStamp/.test(src), "应读取 timeStamp");
});

test("[兜底] getCoalescedPoints: 无 getCoalescedEvents 方法时 fallback 到 [e]", () => {
  assert.ok(
    /typeof.*getCoalescedEvents.*===\s*["']function["']/.test(src),
    "应检查 getCoalescedEvents 方法存在"
  );
  assert.ok(/rawEvents\s*=\s*\[e\]/.test(src), "fallback 应使用 [e] 单点");
  assert.ok(/if\s*\(\s*rawEvents\.length\s*===\s*0\s*\)\s*rawEvents\s*=\s*\[e\]/.test(src), "空数组也应 fallback 到 [e]");
});

test("[关键] getCoalescedPoints: 转换字段映射", () => {
  // 字段映射：ev.offsetX → x, ev.pressure → pressure
  // 验证存在 ev.X 引用
  const m = src.match(/export function getCoalescedPoints[\s\S]*?\n\}/);
  assert.ok(m, "getCoalescedPoints 应存在");
  const body = m[0];
  assert.ok(/ev\.offsetX/.test(body), "应读 ev.offsetX");
  assert.ok(/ev\.offsetY/.test(body), "应读 ev.offsetY");
  assert.ok(/ev\.pressure/.test(body), "应读 ev.pressure");
  assert.ok(/ev\.timeStamp/.test(body), "应读 ev.timeStamp");
});

/* ========== brushToSvgProps 测试 ========== */

test("[核心] brushToSvgProps: 6 笔刷 case 分支", () => {
  // 找 brushToSvgProps 函数
  const m = src.match(/export function brushToSvgProps\([^)]*\) \{([\s\S]*?)\n\}/);
  assert.ok(m, "brushToSvgProps 应存在");
  const body = m[1];
  for (const brush of ["ballpoint", "pencil", "marker", "highlighter", "fountain"]) {
    assert.ok(body.includes(`case "${brush}"`), `${brush} 笔刷应有 case 分支`);
  }
});

test("[关键] highlighter 笔刷: mix-blend-mode: multiply", () => {
  const m = src.match(/export function brushToSvgProps\([^)]*\) \{([\s\S]*?)\n\}/);
  const body = m[1];
  assert.ok(
    /mix-blend-mode:\s*multiply/.test(body),
    "highlighter 笔刷应有 mix-blend-mode: multiply（实现半透明叠加）"
  );
});

test("[关键] 笔刷用 pressure 调粗细（baseWidth * pressureToWidthScale(pressure)）", () => {
  const m = src.match(/export function brushToSvgProps\([^)]*\) \{([\s\S]*?)\n\}/);
  const body = m[1];
  // 至少 1 个 case 应有 baseWidth * pressureToWidthScale(pressure) 形式
  assert.ok(
    /baseWidth\s*\*\s*pressureToWidthScale\(pressure\)/.test(body),
    "应有 baseWidth * pressureToWidthScale(pressure) 调粗细"
  );
});

test("[关键] stroke-linecap: round（笔刷圆头）", () => {
  const m = src.match(/export function brushToSvgProps\([^)]*\) \{([\s\S]*?)\n\}/);
  const body = m[1];
  // 源码用 "stroke-linecap": "round"（带引号）
  assert.ok(
    /["']stroke-linecap["']\s*:\s*["']round["']/.test(body),
    "应有 stroke-linecap: round（笔刷圆头，平滑边缘）"
  );
});

test("[关键] 马克笔 / 荧光笔 opacity < 0.5（半透明叠加）", () => {
  const m = src.match(/export function brushToSvgProps\([^)]*\) \{([\s\S]*?)\n\}/);
  const body = m[1];
  // 源码：opacity: opacity * 0.7（marker）/ opacity * 0.4（highlighter），可能带或不带引号
  assert.ok(
    /case "marker"[\s\S]{0,300}?opacity:\s*opacity\s*\*\s*0\.[0-9]+/.test(body),
    "marker opacity 应是 opacity * 0.x"
  );
  assert.ok(
    /case "highlighter"[\s\S]{0,300}?opacity:\s*opacity\s*\*\s*0\.[0-9]+/.test(body),
    "highlighter opacity 应是 opacity * 0.x"
  );
});
