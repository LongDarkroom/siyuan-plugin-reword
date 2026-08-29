/**
 * Apple Pencil 墨迹批注 · 工具函数
 * ----------------------------------------------------------------
 * - Catmull-Rom 样条平滑（pointer 路径 → SVG path）
 * - getCoalescedEvents 拿原始点（避免 rAF 合并丢点）
 * - 倾斜检测（> 45° 自动变荧光笔）
 * - 压力 → 粗细换算
 *
 * 不依赖：foliate / siyuan SDK
 */
import type { InkPoint } from "./types";

/** 压力 → 粗细系数（0.3-1.4 范围，模拟真实笔触）*/
export function pressureToWidthScale(pressure: number): number {
  // pressure=0 时（鼠标或非压感设备）默认 1.0
  // pressure=0.5 时 → 0.85（轻按）
  // pressure=1.0 时 → 1.4（重按）
  if (pressure <= 0) return 1.0;
  return 0.3 + pressure * 1.1;
}

/** 倾斜 > 45° 视为荧光笔模式（Apple Pencil 倾斜）*/
export function shouldUseHighlighter(tiltX: number, tiltY: number): boolean {
  const maxTilt = Math.max(Math.abs(tiltX), Math.abs(tiltY));
  return maxTilt >= 45;
}

/**
 * Catmull-Rom 样条平滑 → SVG path d
 * 输入：3+ 个点
 * 输出："M x0 y0 C x1 y1 x2 y2, x2 y2 x3 y3, ..."
 *
 * 简化版：每 3 个点用一条 cubic Bezier
 *   p1 / p2 是控制点
 *   p0 / p3 是端点（p0 是上次的 p3）
 */
export function catmullRomToBezierPath(points: InkPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  }

  // 至少 3 个点：起点 + Catmull-Rom
  const parts: string[] = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let i = 0; i < points.length - 1; i++) {
    // Catmull-Rom 4 点：p0=前一个, p1=当前, p2=下一个, p3=下下个
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || points[i + 1];
    // 控制点 = p1 + (p2 - p0) / 6, p2 - (p3 - p1) / 6
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    parts.push(
      `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    );
  }
  return parts.join(" ");
}

/** 从 PointerEvent 拿所有 coalesced 事件（原始点，不被 rAF 合并）*/
export function getCoalescedPoints(e: PointerEvent): InkPoint[] {
  const points: InkPoint[] = [];
  // getCoalescedEvents 返回事件列表（包含原始点）
  // iOS Safari 16+ 支持，desktop Chrome/Edge 完整支持
  let rawEvents: PointerEvent[] = [];
  try {
    if (typeof (e as any).getCoalescedEvents === "function") {
      rawEvents = (e as any).getCoalescedEvents() || [];
    }
  } catch {
    rawEvents = [e];
  }
  if (rawEvents.length === 0) rawEvents = [e];
  for (const ev of rawEvents) {
    points.push({
      x: ev.offsetX,
      y: ev.offsetY,
      pressure: ev.pressure || 0.5,
      t: ev.timeStamp,
      tiltX: (ev as any).tiltX || 0,
      tiltY: (ev as any).tiltY || 0,
    });
  }
  return points;
}

/** 笔刷 → SVG 属性映射 */
export function brushToSvgProps(brush: string, color: string, baseWidth: number, opacity: number, pressure: number) {
  const width = baseWidth * pressureToWidthScale(pressure);
  switch (brush) {
    case "ballpoint":
      // 圆珠笔：实线 + 圆头
      return { stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" };
    case "pencil":
      // 铅笔：略透明 + 圆头
      return { stroke: color, "stroke-width": width * 0.8, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: opacity * 0.85 };
    case "marker":
      // 马克笔：粗 + 半透明
      return { stroke: color, "stroke-width": width * 2, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: opacity * 0.7 };
    case "highlighter":
      // 荧光笔：很粗 + 极透明（multiply 混合）
      return { stroke: color, "stroke-width": width * 3, "stroke-linecap": "butt", "stroke-linejoin": "miter", opacity: opacity * 0.4, "style": "mix-blend-mode: multiply" };
    case "fountain":
      // 钢笔：细 + 圆头 + 实线
      return { stroke: color, "stroke-width": width * 0.6, "stroke-linecap": "round", "stroke-linejoin": "round" };
    default:
      return { stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" };
  }
}
