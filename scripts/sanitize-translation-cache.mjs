#!/usr/bin/env node
/**
 * 一次性迁移：清洗翻译缓存里的「AI 解说体」脏译文（2026-09-05）
 * ------------------------------------------------------------------
 * 背景：早期 AI 引擎返回的 "**翻译：** …\n\n**重点词组解释：**…" 整段被原样入缓存，
 * 加上历史分段粒度变更遗留的多行块状译文，导致双语渲染杂乱。
 * 运行时已加读写两侧净化（src/translate/sanitize.ts），本脚本负责把
 * 磁盘上已有的 translations/*.json 全部规整一遍。
 *
 * 行为：
 *   1. 先把整个 translations 目录备份到 outputs/translation-cache-backup-<时间戳>/
 *   2. 对每个 <bookId>.json 的 default / concise 两个池逐条 sanitize
 *   3. 有变化的文件写回；统计并打印
 *
 * 用法：node --experimental-strip-types scripts/sanitize-translation-cache.mjs [翻译目录]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, cpSync, mkdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { sanitizeTranslation } from "../src/translate/sanitize.ts";

const DEFAULT_DIR = "/Users/xieyue/Downloads/思源笔记/data/storage/petal/siyuan-plugin-reword/translations";
const dir = resolve(process.argv[2] || DEFAULT_DIR);
const OUT_ROOT = "/Users/xieyue/WorkBuddy/思源英语插件/outputs";

if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error("目录不存在:", dir);
  process.exit(1);
}

// 1) 备份（零删除原则：只复制，不动原目录）
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const backupDir = join(OUT_ROOT, `translation-cache-backup-${stamp}`);
mkdirSync(OUT_ROOT, { recursive: true });
cpSync(dir, backupDir, { recursive: true });
console.log("已备份 →", backupDir);

// 2) 逐文件清洗
const files = readdirSync(dir).filter(
  (n) => n.endsWith(".json") && !n.endsWith(".meta.json") && !n.endsWith(".fix.json") && n !== "_index.json"
);
let totalEntries = 0, totalChanged = 0, filesChanged = 0;
for (const name of files) {
  const p = join(dir, name);
  let data;
  try {
    data = JSON.parse(readFileSync(p, "utf-8"));
  } catch (e) {
    console.warn("跳过（解析失败）:", name, String(e).slice(0, 80));
    continue;
  }
  // 兼容旧版单池形态：顶层就是 hash→tr
  const pools =
    data && typeof data === "object" && (data.default || data.concise) && typeof data.default === "object"
      ? ["default", "concise"]
      : [null];
  let fileChanged = 0, fileCount = 0;
  for (const pool of pools) {
    const map = pool ? data[pool] : data;
    if (!map || typeof map !== "object") continue;
    for (const k of Object.keys(map)) {
      const v = map[k];
      if (typeof v !== "string" || !v) continue;
      fileCount++;
      const nv = sanitizeTranslation(v);
      if (nv !== v) {
        map[k] = nv;
        fileChanged++;
      }
    }
  }
  totalEntries += fileCount;
  totalChanged += fileChanged;
  if (fileChanged > 0) {
    filesChanged++;
    writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
    console.log(`  ${basename(name)}: ${fileChanged}/${fileCount} 条清洗`);
  }
}
console.log(`\n完成：扫描 ${files.length} 个文件 / ${totalEntries} 条，清洗 ${totalChanged} 条（${filesChanged} 个文件写回）`);
