/**
 * REword · 界面多语言（i18n）核心
 * ==================================================================
 * 建立：2026-09-10（方案见 `REword多语言方案-英语优先-2026-09-10.md`）
 *
 * ## 三条设计准则
 *
 * 1. **中文原文即 key** —— `t("已复制")` 而不是 `t("copiedToClipboard")`。
 *    中文是源语言、永远写在代码里；英文只是运行时「查表替换」。
 *    ⇒ 默认中文下 `t(x) === x`，渲染结果逐字不变，
 *      现有 181 个依赖中文文案的测试文件**零返工**（这是选它而非 Copilot 式语义 key 的唯一理由）。
 *
 * 2. **缺失即回落中文** —— 未翻译 / key 写错，一律返回中文原文，
 *    绝不出现空白、key 名或 `undefined`。这是**灰度发布**的前提：可以先翻 60% 就发版。
 *
 * 3. **只有英文需要语言包** —— key 本身就是中文，所以 zh_CN **不需要加载任何文件**
 *    （`i18n/zh_CN.json` 存在的意义是与 en_US 对齐、供校验脚本与后续语言扩展使用）。
 *    运行时仅在 en_US 下查表，省一半体积，且随迁移批次增长（灰度友好）。
 *
 * ## 用法
 * ```ts
 * import { t } from "../i18n/index.ts";
 * showMessage(t("保存成功"));
 * t("已复制 {n} 项", { n: 3 });          // 中文：已复制 3 项 / 英文：Copied 3 items
 * t("关闭", { ctx: "dialog" });          // 一词多义：先查 "关闭@dialog"，查不到回落 "关闭"
 * ```
 *
 * ## 语言切换
 * 插件内**独立**切换（不跟随思源界面语言）。切换后提示**重载插件生效**——
 * 以此规避 22 个 Svelte 组件全量改造成响应式订阅（`$t`）的代价。
 */

import enUS from "../../i18n/en_US.json";

/** 支持的语言。新增语言 = 这里加一项 + i18n/<id>.json + 打包进 import 表。 */
export type Lang = "zh_CN" | "en_US";

export interface LangOption {
  id: Lang;
  /** 语言选择框里显示的文字（用该语言自身书写，无需翻译） */
  label: string;
}

export const LANG_OPTIONS: readonly LangOption[] = [
  { id: "zh_CN", label: "中文" },
  { id: "en_US", label: "English" },
];

/** 语言持久化文件名（存插件 data 目录） */
export const LANG_STORAGE_FILE = "hiword-i18n-lang.json";

/**
 * 英文查表。zh_CN 时为空对象（key 即中文，无需查表）。
 * 用 Record 断言而非让 TS 推断整张 JSON 字面量类型（2750 条会拖慢 tsc）。
 */
const EN_TABLE: Record<string, string> = enUS as Record<string, string>;

let currentLang: Lang = "zh_CN";
let activeTable: Record<string, string> = {};

/** 当前语言 */
export function getLang(): Lang {
  return currentLang;
}

/** 是否正处于英文界面（热路径上避免字符串比较的辅助） */
export function isEnglish(): boolean {
  return currentLang === "en_US";
}

/**
 * 设置当前语言（仅改内存，不落盘；落盘用 `saveLang`）。
 * 切换语言后需要**重载插件**才能让所有界面生效（见文件头注释）。
 */
export function setLang(lang: Lang): void {
  currentLang = lang === "en_US" ? "en_US" : "zh_CN";
  activeTable = currentLang === "en_US" ? EN_TABLE : {};
}

/** 取变量表（供调试 / 覆盖率统计） */
export function __getTable(): Record<string, string> {
  return activeTable;
}

/**
 * 翻译入口。
 * @param zh 中文原文（同时充当 key）
 * @param vars 可选：插值变量 `{n}` / `{name}`；或语境消歧 `{ ctx: "dialog" }`
 */
export function t(zh: string, vars?: Record<string, string | number>): string {
  let out: string;
  if (currentLang === "zh_CN") {
    out = zh;
  } else {
    // 语境消歧：先查 "关闭@dialog"，查不到再回落 "关闭"
    const ctx = vars && typeof vars.ctx === "string" ? vars.ctx : "";
    const withCtx = ctx ? `${zh}@${ctx}` : "";
    const hit = withCtx ? activeTable[withCtx] : undefined;
    out = hit ?? activeTable[zh] ?? zh;
  }
  if (!vars) return out;
  // 插值：{n} → 值。ctx 是控制键，不参与插值
  for (const k of Object.keys(vars)) {
    if (k === "ctx") continue;
    const ph = `{${k}}`;
    if (out.indexOf(ph) >= 0) out = out.split(ph).join(String(vars[k]));
  }
  return out;
}

/**
 * 该文案是否已有英文翻译（未翻译 = 运行时会回落中文）。
 * 供「翻译覆盖率」自检与校验脚本使用。
 */
export function hasTranslation(zh: string): boolean {
  return Object.prototype.hasOwnProperty.call(EN_TABLE, zh);
}

/** 英文包条目总数（覆盖率分母） */
export function translationTotal(): number {
  return Object.keys(EN_TABLE).length;
}

// ────────────────────────────── 持久化 ──────────────────────────────

export interface I18nIO {
  load: (file: string) => Promise<unknown>;
  save: (file: string, data: unknown) => Promise<void>;
}

/**
 * 启动初始化：读取已保存的语言并设置。
 * @returns 已保存的语言；**首次使用（无记录）返回 null**，由调用方弹语言选择框。
 */
export async function initI18n(io: I18nIO): Promise<Lang | null> {
  try {
    const raw = await io.load(LANG_STORAGE_FILE);
    const lang = (raw as { lang?: unknown } | null | undefined)?.lang;
    if (lang === "en_US" || lang === "zh_CN") {
      setLang(lang);
      return lang;
    }
  } catch {
    /* 读取失败按首次使用处理 */
  }
  setLang("zh_CN");
  return null;
}

/** 保存语言选择 */
export async function saveLang(io: I18nIO, lang: Lang): Promise<void> {
  setLang(lang);
  try {
    await io.save(LANG_STORAGE_FILE, { lang });
  } catch {
    /* 存不下也要让本次会话生效 */
  }
}
