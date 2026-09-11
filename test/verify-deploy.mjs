// 部署版 marker 验证（2026-09-07 词海切换 + 2026-09-11 P0 词库/复习强化）
import fs from "node:fs";
const s = fs.readFileSync("/Users/xieyue/Downloads/思源笔记/data/plugins/siyuan-plugin-reword/index.js", "utf8");
const checks = {
  // ===== 词海切换（2026-09-07）=====
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
  // ===== 墨迹持久化 PR1+PR2（2026-08-22）=====
  "PR1 墨迹持久化已就绪": (s.match(/墨迹持久化已就绪/g) || []).length,
  "PR2 墨迹 · p": (s.match(/墨迹 · p/g) || []).length,
  // ===== PDF 选中（2026-09-08）=====
  "cMapPacked:!0": (s.match(/cMapPacked:!0/g) || []).length,
  "disableCombineTextItems:!1（保持 false）": (s.match(/disableCombineTextItems:!1/g) || []).length,
  // ===== P0 词库+复习强化（2026-09-11）=====
  "BookStatus.Draft 常量": (s.match(/Draft:"draft"/g) || []).length,
  "BookSource.Manual 常量": (s.match(/Manual:"manual"/g) || []).length,
  "VocabBookImportMeta 类型": (s.match(/VocabBookImportMeta/g) || []).length,
  "VocabLabel 类型": (s.match(/VocabLabel/g) || []).length,
  "ensureBookStatus 方法": (s.match(/ensureBookStatus/g) || []).length,
  "verifyBook 方法": (s.match(/verifyBook/g) || []).length,
  "getReviewableBooks 方法": (s.match(/getReviewableBooks/g) || []).length,
  "getAllLabels 方法": (s.match(/getAllLabels/g) || []).length,
  "renameLabel 方法": (s.match(/renameLabel/g) || []).length,
  "mergeLabels 方法": (s.match(/mergeLabels/g) || []).length,
  "deleteLabel 方法": (s.match(/deleteLabel/g) || []).length,
  "5 种 parser 入口 (autoParse)": (s.match(/autoParse/g) || []).length,
  "ParserFormat 类型": (s.match(/ParserFormat/g) || []).length,
  "cleanParsed 函数": (s.match(/cleanParsed/g) || []).length,
  "ImportDialog 类": (s.match(/ImportDialog/g) || []).length,
  "草稿 banner CSS (hiword-vb-draft-banner)": (s.match(/hiword-vb-draft-banner/g) || []).length,
  "复习草稿提示 CSS (hiword-rp-draft-notice)": (s.match(/hiword-rp-draft-notice/g) || []).length,
  "复习第 5 指标 CSS (hiword-rp-metric--draft)": (s.match(/hiword-rp-metric--draft/g) || []).length,
  "草稿 option CSS (hiword-vb-book-draft)": (s.match(/hiword-vb-book-draft/g) || []).length,
};
for (const [k, v] of Object.entries(checks)) console.log("  " + v + "x  " + k);
console.log("\nsize:", s.length, "bytes");
