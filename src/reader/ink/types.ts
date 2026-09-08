/**
 * Apple Pencil 墨迹批注 · 数据类型
 * ----------------------------------------------------------------
 * 5 种笔刷 + 5 色 + 5 线型 = 25 组合 + 6 预设 + 橡皮
 * 沿用批注模块 (annotation-store) 的 WHALE_COLORS 5 色调色板
 *
 * 笔触模型：每个 InkStroke 是连续的 pointer 路径（Catmull-Rom 拟合后）
 * 存储：SVG path 的 d 属性（d="M x0 y0 Q x1 y1 x2 y2 ..."）
 *
 * 不依赖：foliate / siyuan SDK
 */

/** 笔刷类型（5 种 + 橡皮） */
export type InkBrush = "ballpoint" | "pencil" | "marker" | "highlighter" | "fountain" | "eraser";

/** 5 色调色板（2026-09-04 统一：与批注模块 WHALE_COLORS 严格一致，勿单方面增删） */
export const INK_COLORS = [
  "#facc15", // 明黄 (默认)
  "#22c55e", // 翠绿
  "#06b6d4", // 青蓝
  "#ec4899", // 玫粉
  "#8b5cf6", // 紫罗兰
] as const;
export type InkColor = typeof INK_COLORS[number];

/** 5 种线型（沿用批注模块 ANNOTATION_STYLES） */
export const INK_STYLES = ["solid", "dashed", "double", "wavy", "underline"] as const;
export type InkStyle = typeof INK_STYLES[number];

/** 单个笔触点（PointerEvent 原始数据 + 拟合后 SVG 坐标） */
export interface InkPoint {
  /** 视口 X 坐标（PDF.js canvas 坐标系） */
  x: number;
  /** 视口 Y 坐标 */
  y: number;
  /** 压力 0-1（Apple Pencil / 触屏）*/
  pressure: number;
  /** 时间戳 ms（用于笔速估算）*/
  t: number;
  /** 倾斜 X 角度 -90~90（Apple Pencil）*/
  tiltX: number;
  /** 倾斜 Y 角度 -90~90（Apple Pencil）*/
  tiltY: number;
}

/** 一个完整笔触（一次 pointerdown → pointermove* → pointerup）*/
export interface InkStroke {
  id: string;
  brush: InkBrush;
  color: InkColor;
  style: InkStyle;
  /** 基础粗细（px），实际粗细 = baseWidth * pressure */
  baseWidth: number;
  /** 不透明度 0-1 */
  opacity: number;
  /** 原始 pointer 路径（拟合前）*/
  points: InkPoint[];
  /** 拟合后的 SVG path d 字符串（Catmull-Rom 平滑后）*/
  path: string;
  /** 创建时间 */
  createdAt: number;
  /** PDF 上下文：哪一页 / 哪本书（用于持久化）*/
  bookId: string;
  pageIndex: number;
}

/** 6 预设笔刷组合（沿用批注模块的 6 预设 + 高亮器） */
export const INK_PRESETS: Array<{
  name: string;
  brush: InkBrush;
  color: InkColor;
  style: InkStyle;
  baseWidth: number;
  opacity: number;
}> = [
  { name: "中性笔 · 黄", brush: "ballpoint", color: "#facc15", style: "solid", baseWidth: 2, opacity: 1 },
  { name: "铅笔 · 青", brush: "pencil", color: "#06b6d4", style: "solid", baseWidth: 1.5, opacity: 0.85 },
  { name: "马克笔 · 粉", brush: "marker", color: "#ec4899", style: "solid", baseWidth: 6, opacity: 0.7 },
  { name: "荧光笔 · 黄", brush: "highlighter", color: "#facc15", style: "solid", baseWidth: 12, opacity: 0.35 },
  { name: "钢笔 · 紫", brush: "fountain", color: "#8b5cf6", style: "solid", baseWidth: 1.2, opacity: 1 },
  { name: "下划线 · 红", brush: "fountain", color: "#ec4899", style: "underline", baseWidth: 1, opacity: 0.8 },
];

/** 当前墨迹模式（关闭 / 笔刷 / 橡皮）*/
export type InkMode = "off" | "draw" | "erase";

/** 模式状态 */
export interface InkState {
  mode: InkMode;
  brush: InkBrush;
  color: InkColor;
  style: InkStyle;
  baseWidth: number;
  opacity: number;
}
