/**
 * 生成 / 更新 i18n 语言包的 **key 清单**（幂等，可反复运行）。
 *
 * 用法：node --experimental-strip-types scripts/gen-i18n-keys.mjs
 *
 * 设计要点（对应方案 §2）：
 * · 中文原文即 key —— 本脚本从源码里把「界面文案」抓出来，写成 zh_CN.json 的键；
 *   zh_CN 的 value 就等于 key 本身（中文界面不需要查表）。
 * · **未翻译的 key 绝不写进 en_US.json**。空串会渲染成空白（比显示中文更糟），
 *   缺 key 则回落到中文原文 —— 这是灰度发布的前提。
 * · 已存在的英文翻译**原样保留**，脚本只做新增 key 的补录与孤儿 key 的报告。
 *
 * 数据源：
 *   1. src/ai/settings/ai-settings-items.ts（SETTING_GROUPS + SETTING_ITEMS，声明式数据）
 *   2. 本文件内的 EXTRA 手写清单（Svelte 模板里的硬编码文案、i18n 模块自身文案）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const I18N_DIR = path.join(ROOT, "i18n");
const ITEMS_FILE = path.join(ROOT, "src/ai/settings/ai-settings-items.ts");

/** 集市元数据键，不属于界面文案，但必须在两个语言包里都存在 */
const META_KEYS = ["displayName", "description"];

/**
 * 手写补充清单：Svelte 模板 / TS 里散落的硬编码界面文案。
 * 每迁移一个模块，把它的文案加进来，再跑一次本脚本。
 */
const EXTRA = [
  // —— AiSettingRow.svelte ——
  "待接线",
  "规划中",
  "从剪贴板导入",
  "隐藏",
  "显示",
  "密钥仅保存在本机思源笔记数据目录，不会上传到任何服务器；分享配置或截图时请注意外泄。",
  // —— i18n 模块自身（语言选择 / 切换）——
  "选择界面语言",
  "REword 界面语言",
  "选择 REword 插件的界面显示语言，之后可在设置中随时切换。",
  "界面语言已切换，重载插件后生效。",
];

/** 从设置项声明文件里抓所有可翻译字段 */
async function collectFromSettingItems() {
  const mod = await import(pathToFileURL(ITEMS_FILE).href);
  const out = new Set();
  for (const g of mod.SETTING_GROUPS || []) {
    if (typeof g.label === "string" && g.label.trim()) out.add(g.label.trim());
    if (typeof g.desc === "string" && g.desc.trim()) out.add(g.desc.trim());
  }
  for (const it of mod.SETTING_ITEMS || []) {
    for (const f of ["title", "desc", "text", "placeholder", "todoNote"]) {
      const v = it[f];
      if (typeof v === "string" && v.trim()) out.add(v.trim());
    }
    for (const o of it.options || []) {
      if (o && typeof o.label === "string" && o.label.trim()) out.add(o.label.trim());
    }
    for (const b of it.buttons || []) {
      if (b && typeof b.label === "string" && b.label.trim()) out.add(b.label.trim());
    }
  }
  return out;
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

/** 稳定排序：中文按 code point，避免每次运行都 diff 一大片 */
function sortedKeys(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

async function main() {
  const keys = await collectFromSettingItems();
  for (const k of EXTRA) keys.add(k);

  fs.mkdirSync(I18N_DIR, { recursive: true });

  // ── zh_CN：key 集合的全量真源（value = 中文原文 = key）──
  const zhPath = path.join(I18N_DIR, "zh_CN.json");
  const zhOld = readJson(zhPath);
  const zh = {};
  for (const k of META_KEYS) zh[k] = zhOld[k] ?? (k === "displayName" ? "RE word" : "");
  for (const k of keys) zh[k] = k;
  const zhSorted = sortedKeys(zh);
  fs.writeFileSync(zhPath, JSON.stringify(zhSorted, null, 2) + "\n", "utf8");

  // ── en_US：只保留「已翻译」的（未翻译 = 缺 key = 回落中文）──
  const enPath = path.join(I18N_DIR, "en_US.json");
  const enOld = readJson(enPath);
  const en = {};
  let kept = 0;
  let orphan = [];
  for (const k of Object.keys(enOld)) {
    if (META_KEYS.includes(k)) {
      en[k] = enOld[k]; // 元数据始终保留
      continue;
    }
    if (keys.has(k)) {
      if (typeof enOld[k] === "string" && enOld[k].trim() && enOld[k] !== k) {
        en[k] = enOld[k];
        kept += 1;
      }
      // 空串 / 等于中文 = 视为未翻译，丢弃 → 回落中文
    } else {
      orphan.push(k);
    }
  }
  // 中性词（URL、专有名词、纯符号）不需要翻译，直接对齐，保证两包 key 集合一致
  const CJK = /[一-鿿]/;
  for (const k of keys) {
    if (!CJK.test(k)) en[k] = k;
  }
  const enSorted = sortedKeys(en);
  fs.writeFileSync(enPath, JSON.stringify(enSorted, null, 2) + "\n", "utf8");

  const total = keys.size;
  const done = Object.keys(en).filter((k) => !META_KEYS.includes(k)).length;
  console.log(`[i18n] 界面文案 key 总数: ${total}`);
  console.log(`[i18n] zh_CN.json 已写入: ${Object.keys(zhSorted).length} 条（含 2 条集市元数据）`);
  console.log(`[i18n] en_US.json 已翻译: ${done} / ${total}（${total ? Math.round((done / total) * 100) : 0}%）`);
  console.log(`[i18n] 沿用旧翻译: ${kept} 条`);
  if (orphan.length) console.log(`[i18n] ⚠️ 孤儿 key（源码已无此文案）: ${orphan.length} → ${orphan.slice(0, 10).join(" / ")}`);
}

main().catch((e) => {
  console.error("[i18n] 生成失败:", e);
  process.exit(1);
});
