/**
 * 标注默认配置（持久化）
 * ------------------------------------------------------------------
 * 把原先硬编码的 DEFAULT_ANNOTATION_COLOR / DEFAULT_ANNOTATION_STYLE、
 * WHALE_COLORS 调色板、标签预设，提升为「用户可在设置面板里改」的配置。
 *
 * 设计要点：
 *  - 持久化在 hiword-annotation-config.json，与批注数据(annotations)、
 *    阅读设置(reader-settings) 互不耦合。
 *  - 仅 type-only 引用 annotation-store 的 AnnotationStyle（运行期不反向依赖，
 *    避免循环 import 的 TDZ 问题）；调色板默认值在此内联，不读 WHALE_COLORS。
 *  - 提供 getDefaultAnnotationColor / getDefaultAnnotationStyle / getAnnotationPalette
 *    供创建批注、设置 UI 统一读取「用户当前默认」。
 *  - 加载/保存由插件 onload 时 initAnnotationConfig(plugin) + loadAnnotationConfig() 驱动。
 */

import type { AnnotationStyle } from "./annotation-store.ts";

/** 默认 5 色调色板（与 WHALE_COLORS 一致，内联避免循环依赖） */
const DEFAULT_PALETTE = ["#facc15", "#22c55e", "#06b6d4", "#ec4899", "#8b5cf6"];

const DEFAULT_TAG_PRESETS = ["未分组", "生词", "句法", "文化", "逻辑"];

export interface AnnotationConfig {
  /** 新建批注默认颜色（hex） */
  defaultColor: string;
  /** 新建批注默认线型 */
  defaultStyle: AnnotationStyle;
  /** 用户调色板（hex 数组），供设置面板与创建工具栏共用 */
  palette: string[];
  /** 标签预设（每行/逗号分隔的语义标签） */
  tagPresets: string[];
}

const STORAGE_KEY = "hiword-annotation-config.json";

const DEFAULTS: AnnotationConfig = {
  defaultColor: "#06b6d4", // 青蓝
  defaultStyle: "highlight",
  palette: [...DEFAULT_PALETTE],
  tagPresets: [...DEFAULT_TAG_PRESETS],
};

let current: AnnotationConfig = { ...DEFAULTS };
let plugin: any = null;
let loaded = false;

/** 由插件 onload 调用，注入 plugin 引用 */
export function initAnnotationConfig(p: any): void {
  plugin = p;
}

/** 加载持久化配置（幂等）。未加载过则合并默认值；已加载则直接返回当前值。 */
export async function loadAnnotationConfig(): Promise<AnnotationConfig> {
  if (loaded) return getAnnotationConfig();
  try {
    const data = (await plugin?.loadData(STORAGE_KEY)) as Partial<AnnotationConfig> | null | undefined;
    if (data && typeof data === "object") {
      current = {
        ...DEFAULTS,
        ...data,
        palette: Array.isArray(data.palette) && data.palette.length ? data.palette : [...DEFAULT_PALETTE],
        tagPresets: Array.isArray(data.tagPresets) && data.tagPresets.length ? data.tagPresets : [...DEFAULT_TAG_PRESETS],
      };
    }
  } catch {
    /* 使用默认 */
  }
  loaded = true;
  return getAnnotationConfig();
}

function persist(): void {
  plugin?.saveData(STORAGE_KEY, current).catch(() => {});
}

/** 读取当前完整配置（副本） */
export function getAnnotationConfig(): AnnotationConfig {
  return { ...current, palette: [...current.palette], tagPresets: [...current.tagPresets] };
}

/** 部分更新并立即落盘 */
export function setAnnotationConfig(patch: Partial<AnnotationConfig>): AnnotationConfig {
  current = {
    ...current,
    ...patch,
    palette: patch.palette && patch.palette.length ? [...patch.palette] : current.palette,
    tagPresets: patch.tagPresets && patch.tagPresets.length ? [...patch.tagPresets] : current.tagPresets,
  };
  persist();
  return getAnnotationConfig();
}

/** 新建批注的默认颜色（用户配置优先，回退内置青蓝） */
export function getDefaultAnnotationColor(): string {
  return current.defaultColor || DEFAULTS.defaultColor;
}

/** 新建批注的默认线型 */
export function getDefaultAnnotationStyle(): AnnotationStyle {
  return current.defaultStyle || DEFAULTS.defaultStyle;
}

/** 当前调色板（副本） */
export function getAnnotationPalette(): string[] {
  return current.palette && current.palette.length ? [...current.palette] : [...DEFAULT_PALETTE];
}

/** 当前标签预设（副本） */
export function getAnnotationTagPresets(): string[] {
  return current.tagPresets && current.tagPresets.length ? [...current.tagPresets] : [...DEFAULT_TAG_PRESETS];
}
