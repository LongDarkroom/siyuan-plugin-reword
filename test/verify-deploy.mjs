// 部署版 marker 验证（2026-09-07 词海切换）
import fs from "node:fs";
const s = fs.readFileSync("/Users/xieyue/Downloads/思源笔记/data/plugins/siyuan-plugin-reword/index.js", "utf8");
const checks = {
  "新 URL 词海 (corp.dict.cn)": (s.match(/corp\.dict\.cn\/search\?q=/g) || []).length,
  "source:haici（期望 ≥1）": (s.match(/source:["']haici["']/g) || []).length,
  "source:eudic 残留（期望 0）": (s.match(/source:["']eudic["']/g) || []).length,
  "新字段 inflections": (s.match(/inflections/g) || []).length,
  "新字段 synonyms": (s.match(/synonyms/g) || []).length,
  "新字段 antonyms": (s.match(/antonyms/g) || []).length,
  "CSS class hiword-dict-section": (s.match(/hiword-dict-section/g) || []).length,
  "CSS class hiword-dict-chip": (s.match(/hiword-dict-chip/g) || []).length,
  "CSS class hiword-dict-inflections": (s.match(/hiword-dict-inflections/g) || []).length,
  "data-action=lookup-word（近反义 chip）": (s.match(/lookup-word/g) || []).length,
  "徽标 海词": (s.match(/在线词典（海词）/g) || []).length,
  "徽标 欧路（期望 0）": (s.match(/在线词典（欧路）/g) || []).length,
  "PR1 墨迹持久化已就绪": (s.match(/墨迹持久化已就绪/g) || []).length,
  "PR2 墨迹 · p": (s.match(/墨迹 · p/g) || []).length,
  "cMapPacked:!0": (s.match(/cMapPacked:!0/g) || []).length,
  "disableCombineTextItems:!1（保持 false）": (s.match(/disableCombineTextItems:!1/g) || []).length,
};
for (const [k, v] of Object.entries(checks)) console.log("  " + v + "x  " + k);
console.log("\nsize:", s.length, "bytes");
