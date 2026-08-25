/**
 * 品牌改名静态扫描测试（2026-08-22 新增,plan §测试文件 4）
 * 扫描 src/ 所有 .ts/.less 文件,确保不再出现"鲸鱼"字样(用户可见文本/注释/日志/AI 提示词),
 * CSS 类名/whale-* 标识符不在扫描范围(plan §5.0 明确不改)。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function listSrcFiles(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === "data") continue;
      await listSrcFiles(full, acc);
    } else if (/\.(ts|less|svelte)$/.test(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

test("品牌改名：src/ 全部源码中不应再出现「鲸鱼」字样(2026-08-22 改名)", async () => {
  const files = await listSrcFiles("src");
  const offenders = [];
  for (const f of files) {
    const src = await readFile(f, "utf8");
    if (src.includes("鲸鱼")) {
      offenders.push(f);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `以下文件仍含「鲸鱼」字样,应改为「微阅」:\n  ${offenders.join("\n  ")}`
  );
});

test("品牌改名：src/ 全部源码应至少出现「微阅批注」或「微阅」(改名生效)", async () => {
  const files = await listSrcFiles("src");
  let total = 0;
  for (const f of files) {
    const src = await readFile(f, "utf8");
    if (src.includes("微阅批注") || src.includes("微阅")) total++;
  }
  assert.ok(total >= 5, `改名后应至少有 5 个文件含「微阅」字样,实际 ${total}`);
});

test("品牌改名：whale-manager.ts dialog title 已是「微阅批注」", async () => {
  const src = await readFile("src/annotation/whale-manager.ts", "utf8");
  assert.match(
    src,
    /class="whale-dlg-title">微阅批注</,
    "dialog title 应为「微阅批注」"
  );
});

test("品牌改名：anno-ai-dialog.ts 系统提示词已含「微阅批注」", async () => {
  const src = await readFile("src/ai/anno-ai-dialog.ts", "utf8");
  assert.match(
    src,
    /ANNO_AI_SYSTEM_PROMPT[\s\S]*?微阅批注/,
    "系统提示词应含「微阅批注」"
  );
});

test("品牌改名：index.ts dock tab 文字已是「微阅批注」", async () => {
  const src = await readFile("src/index.ts", "utf8");
  assert.match(
    src,
    /data-tab="annotations">微阅批注</,
    "dock tab 文字应为「微阅批注」"
  );
});

test("品牌改名：whale-renderer.ts 侧边栏标题已是「微阅批注汇总」", async () => {
  const src = await readFile("src/annotation/whale-renderer.ts", "utf8");
  assert.match(
    src,
    /whale-panel-title">微阅批注汇总</,
    "侧边栏标题应为「微阅批注汇总」"
  );
});
