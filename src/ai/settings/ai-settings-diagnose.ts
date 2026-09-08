/**
 * REword · AI 设置接线诊断
 * ------------------------------------------------------------------
 * 把两类「配了没用」的缺陷变成可自动检测、可一键复制的报告：
 *
 *  1. **normalize 缺口** —— 接口/默认值/消费方三层都在，唯独持久化层漏了
 *     （前科：conciseTranslatePrompt，用户自定义后重启即回退默认）。
 *     来源 `listNormalizeGaps()`。
 *  2. **假设置项** —— UI 上标注「已接线」却没有真实消费方。
 *     来源 `collectWiringReport()`。
 *
 * 另附「规划中」清单，方便对照功能蓝图看还剩多少没做。
 */

import { listNormalizeGaps, DEFAULT_AI_SETTINGS } from "../ai-settings.ts";
import {
  SETTING_ITEMS,
  collectWiringReport,
  type SettingItem,
  type WiredState,
} from "./ai-settings-items.ts";

export interface DiagnoseReport {
  /** 生成时间（本地字符串） */
  at: string;
  /** normalize 返回对象缺失的字段键（应恒为空数组） */
  normalizeGaps: string[];
  /** 标记已接线但没有真实消费方的项 */
  unwired: { key: string; title: string; reason: string }[];
  /** 待接线（🟡）与规划中（🔵）清单 */
  pending: { key: string; title: string; wired: WiredState; consumer: string }[];
  /** 统计 */
  stats: {
    totalFields: number;
    totalItems: number;
    yes: number;
    partial: number;
    planned: number;
  };
}

/** 跑一次体检（纯本地计算，无 I/O、无 AI 调用） */
export function runDiagnose(): DiagnoseReport {
  const items: SettingItem[] = SETTING_ITEMS.filter((it) => !!it.key);
  const pending = items
    .filter((it) => it.wired !== "yes")
    .map((it) => ({
      key: it.key,
      title: it.title,
      wired: it.wired,
      consumer: it.consumer || "（未声明）",
    }));

  return {
    at: new Date().toLocaleString(),
    normalizeGaps: listNormalizeGaps(),
    unwired: collectWiringReport(),
    pending,
    stats: {
      totalFields: Object.keys(DEFAULT_AI_SETTINGS).length,
      totalItems: items.length,
      yes: items.filter((it) => it.wired === "yes").length,
      partial: items.filter((it) => it.wired === "partial").length,
      planned: items.filter((it) => it.wired === "planned").length,
    },
  };
}

/** 渲染为纯文本报告（用于弹窗展示与复制到剪贴板） */
export function formatDiagnose(r: DiagnoseReport): string {
  const L: string[] = [];
  L.push(`REword · AI 设置接线诊断  ${r.at}`);
  L.push("");
  L.push(`字段总数 ${r.stats.totalFields} · 设置项 ${r.stats.totalItems}`);
  L.push(`  🟢 已接线 ${r.stats.yes} · 🟡 待接线 ${r.stats.partial} · 🔵 规划中 ${r.stats.planned}`);
  L.push("");

  L.push("【1】normalize 缺口（应为空）");
  if (r.normalizeGaps.length === 0) {
    L.push("  ✓ 无。所有字段都能正常持久化。");
  } else {
    r.normalizeGaps.forEach((k) => L.push(`  ✗ ${k} —— 保存后重启会回退默认`));
  }
  L.push("");

  L.push("【2】假设置项（标记已接线但无真实消费方）");
  if (r.unwired.length === 0) {
    L.push("  ✓ 无。每个已接线项都有消费方。");
  } else {
    r.unwired.forEach((x) => L.push(`  ✗ ${x.title}（${x.key}）—— ${x.reason}`));
  }
  L.push("");

  const partial = r.pending.filter((p) => p.wired === "partial");
  const planned = r.pending.filter((p) => p.wired === "planned");
  L.push(`【3】待接线 🟡（${partial.length}）—— 字段与 UI 已有，消费方缺失`);
  partial.forEach((p) => L.push(`  · ${p.title}（${p.key}）→ ${p.consumer}`));
  L.push("");
  L.push(`【4】规划中 🔵（${planned.length}）—— 功能蓝图，尚未实现`);
  planned.forEach((p) => L.push(`  · ${p.title}（${p.key}）→ ${p.consumer}`));

  return L.join("\n");
}
