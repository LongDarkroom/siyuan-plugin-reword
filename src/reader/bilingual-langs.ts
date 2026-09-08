/**
 * 双语翻译 · 语言选项共享常量（2026-09-05 设置 UI 统一）
 * ------------------------------------------------------------------
 * 此前源/目标语言下拉在三处各自硬编码且选项集不一致：
 *   - BilingualSettingsTab.svelte 整书 Tab（源 7 种 / 目标 9 种）
 *   - ReaderView.svelte 整书预翻译弹窗（目标仅 5 种）
 * 统一收口到本文件，两处同源渲染。
 *
 * 目标语言全集与各引擎实测支持对齐：腾讯 tmt / 百度 / 有道 / 微软对下述
 * 语言码均原生支持（直接透传或简单映射），AI 兜底全支持。
 */

/** 源语言选项（value 与 engines 侧语言码一致；auto = 引擎自动检测） */
export const SOURCE_LANG_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "en", label: "英语（默认）" },
  { value: "auto", label: "自动检测" },
  { value: "ja", label: "日语" },
  { value: "fr", label: "法语" },
  { value: "de", label: "德语" },
  { value: "ko", label: "韩语" },
  { value: "ru", label: "俄语" },
];

/** 目标语言选项（value 为各家引擎通用的语言码） */
export const TARGET_LANG_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "zh", label: "中文（简体）" },
  { value: "zh-Hant", label: "中文（繁体）" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
  { value: "fr", label: "法语" },
  { value: "de", label: "德语" },
  { value: "es", label: "西班牙语" },
  { value: "ru", label: "俄语" },
];
