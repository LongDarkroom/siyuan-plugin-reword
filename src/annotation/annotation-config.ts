import { logSwallow } from "../core/safe.ts";
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

/** 合法线型（与 annotation-store 的 AnnotationStyle 一致，内联避免循环 import） */
const VALID_STYLES = ["highlight", "solid", "wavy"];

/** 归一化线型：旧线型（dashed/double → solid，dotted → wavy）或脏值 → 合法值；无法识别返回 undefined。
 *  2026-08-30：用于清洗从历史配置文件读出的 lastStyle（用户可能残留被删掉的线型）。 */
function normalizeStyle(raw: unknown): AnnotationStyle | undefined {
  const s = String(raw ?? "").trim();
  if ((VALID_STYLES as string[]).includes(s)) return s as AnnotationStyle;
  if (s === "dashed" || s === "double") return "solid";
  if (s === "dotted") return "wavy";
  return undefined;
}

export interface AnnotationConfig {
  /** 新建批注默认颜色（hex） */
  defaultColor: string;
  /** 新建批注默认线型 */
  defaultStyle: AnnotationStyle;
  /** 用户调色板（hex 数组），供设置面板与创建工具栏共用 */
  palette: string[];
  /** 标签预设（每行/逗号分隔的语义标签） */
  tagPresets: string[];
  /* ---- 2026-08-30「上次使用样式」记忆（微信读书式一键高亮） ----
   * 点「标注」时直接用这两个值创建，无需每次展开样式条重选样式/颜色。
   * 与 defaultStyle/defaultColor 的区别：那两个是「用户配置的新建默认」（首次或重置时用），
   * 这两个是「最近一次实际用过」的样式，优先级更高；为空则回退到那两个。
   * 每次真正落库的高亮/批注都会覆写，跨会话、跨 Tab 生效（模块级单例）。 */
  lastStyle?: AnnotationStyle;
  lastColor?: string;
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
        // 2026-08-30：上次样式来自用户历史文件，可能是被删掉的旧线型（dashed/double/dotted）
        // 或任意脏值 → 归一化为 3 种合法样式，非法则丢弃（回退到用户默认）。
        lastStyle: normalizeStyle(data.lastStyle),
        lastColor: typeof data.lastColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(data.lastColor.trim())
          ? data.lastColor.trim()
          : undefined,
      };
    }
  } catch (__swallowErr) { logSwallow(__swallowErr, "annotation-config.ts · loadAnnotationConfig", "debug"); }
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

/* ================= 上次使用样式（2026-08-30，微信读书式一键高亮） =================
 * 点「标注」直接用上次样式创建；样式条仅在用户主动点 ▼ 时才展开改样式。
 * 写入走 300ms 防抖：用户在样式条里连续点颜色/样式会产生高频写入，
 * 防抖后只在停手时落盘一次，避免拖慢 UI。
 */

/** 上次使用的高亮线型（无历史 → 回退用户配置的默认线型） */
export function getLastAnnotationStyle(): AnnotationStyle {
  return current.lastStyle || getDefaultAnnotationStyle();
}

/** 上次使用的高亮颜色（无历史 → 回退用户配置的默认颜色） */
export function getLastAnnotationColor(): string {
  return current.lastColor || getDefaultAnnotationColor();
}

const LAST_STYLE_SAVE_MS = 300;
let lastStyleSaveTimer: any = null;

/**
 * 记录本次实际使用的样式（供下次「标注」一键复用），防抖落盘。
 * 只接受合法线型；非法值直接忽略，不污染记忆。
 */
export function setLastAnnotationStyle(style: AnnotationStyle, color: string): void {
  const s = normalizeStyle(style);
  if (!s) return;
  const c = String(color ?? "").trim();
  if (!/^#[0-9a-fA-F]{3,8}$/.test(c)) return;
  current = { ...current, lastStyle: s, lastColor: c };
  if (lastStyleSaveTimer) clearTimeout(lastStyleSaveTimer);
  lastStyleSaveTimer = setTimeout(() => {
    lastStyleSaveTimer = null;
    persist();
  }, LAST_STYLE_SAVE_MS);
}
