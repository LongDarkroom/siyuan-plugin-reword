/**
 * i18n 语言包体检（2026-09-10）。
 *
 * 用法：node scripts/check-i18n.mjs
 *
 * 检查项：
 *   ❌ 孤儿 key —— en_US 里有、zh_CN 里没有（源码文案已改/已删，英文残留）
 *   ❌ 空值     —— en_US 里 value 为空串（渲染出来是空白，比显示中文更糟）
 *   ❌ 恒等值   —— en_US 的 value 与中文 key 相同且含中文（等于没翻译，属误录）
 *   ⚠️ 未翻译   —— zh_CN 有、en_US 没有。**这不算失败**：缺 key 会回落中文，
 *                  正是灰度发布所依赖的行为，这里只报告覆盖率。
 *
 * 退出码：有 ❌ 为 1，否则 0。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const I18N_DIR = path.join(ROOT, "i18n");
const CJK = /[一-鿿]/;

function read(name) {
  const p = path.join(I18N_DIR, name);
  if (!fs.existsSync(p)) {
    console.error(`[i18n] 缺少语言包: ${name}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`[i18n] ${name} 解析失败: ${e.message}`);
    process.exit(1);
  }
}

const zh = read("zh_CN.json");
const en = read("en_US.json");
const zhKeys = Object.keys(zh);
const enKeys = Object.keys(en);

const errors = [];
const orphan = enKeys.filter((k) => !(k in zh));
const empty = enKeys.filter((k) => typeof en[k] !== "string" || !en[k].trim());
const identical = enKeys.filter((k) => CJK.test(k) && en[k] === k);

if (orphan.length) errors.push(`孤儿 key ${orphan.length} 个 → ${orphan.slice(0, 8).join(" / ")}`);
if (empty.length) errors.push(`空值 ${empty.length} 个 → ${empty.slice(0, 8).join(" / ")}`);
if (identical.length) errors.push(`恒等未译 ${identical.length} 个 → ${identical.slice(0, 8).join(" / ")}`);

// 未翻译 = zh_CN 有、en_US 无（中性词不算，它们无需翻译）
const missing = zhKeys.filter((k) => !(k in en) && CJK.test(k));
const translatable = zhKeys.filter((k) => CJK.test(k));
const done = translatable.length - missing.length;
const pct = translatable.length ? Math.round((done / translatable.length) * 100) : 100;

console.log(`[i18n] zh_CN 条目: ${zhKeys.length}`);
console.log(`[i18n] en_US 条目: ${enKeys.length}`);
console.log(`[i18n] 需翻译: ${translatable.length}（中性词 ${zhKeys.length - translatable.length} 条免翻）`);
console.log(`[i18n] 已翻译: ${done} / ${translatable.length}（${pct}%）`);
if (missing.length) {
  console.log(`[i18n] 未翻译 ${missing.length} 条（运行时回落中文，灰度允许）:`);
  for (const k of missing.slice(0, 15)) console.log(`         · ${k}`);
  if (missing.length > 15) console.log(`         … 另 ${missing.length - 15} 条`);
}

if (errors.length) {
  for (const e of errors) console.error(`[i18n] ❌ ${e}`);
  process.exit(1);
}
console.log("[i18n] ✅ 语言包体检通过");
