// 构建前置检查（2026-09-04 P0）
// 1) 清理 git 僵尸锁
// 2) 跑注释陷阱预检
//
// 关于僵尸锁：本环境（~/Downloads 受 TCC 保护，.git/* 带 com.apple.provenance xattr）
// 下 git 自己 unlink 不掉自己的锁，任何一条 git 命令跑完都可能遗留一个 0 字节
// index.lock，下次写操作就撞锁。判据：无进程占用 且 长时间未变动 = 僵尸锁，可安全删除。
//
// 本脚本只做文件删除，不执行任何 git 命令。
// 用法：node scripts/prebuild.mjs
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GIT = join(ROOT, ".git");
const STALE_MS = 60 * 1000; // 超过 60 秒未变动才判为僵尸

function collectLocks() {
  const found = [];
  if (!existsSync(GIT)) return found;
  const fixed = [
    ".git/index.lock",
    ".git/HEAD.lock",
    ".git/packed-refs.lock",
    ".git/ORIG_HEAD.lock",
    ".git/MERGE_HEAD.lock",
  ];
  for (const rel of fixed) {
    if (existsSync(join(ROOT, rel))) found.push(rel);
  }
  // refs/ 下的锁名随分支而变，需递归
  const refsDir = join(GIT, "refs");
  if (existsSync(refsDir)) {
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".lock")) found.push(p.slice(ROOT.length + 1));
      }
    };
    walk(refsDir);
  }
  return found;
}

function heldByProcess(abs) {
  try {
    const out = execFileSync("lsof", [abs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    // lsof 不存在，或无输出（未占用）都走这里 —— 交给 mtime 判据兜底
    return false;
  }
}

function clearStaleLocks() {
  const locks = collectLocks();
  if (!locks.length) {
    console.log("[prebuild] git 锁：无");
    return 0;
  }
  let cleared = 0;
  for (const rel of locks) {
    const abs = join(ROOT, rel);
    const ageMs = Date.now() - statSync(abs).mtimeMs;
    if (heldByProcess(abs)) {
      console.warn("[prebuild] 跳过（有进程占用）：" + rel);
      continue;
    }
    if (ageMs < STALE_MS) {
      console.warn("[prebuild] 跳过（" + Math.round(ageMs / 1000) + "s 前刚变动，可能正在使用）：" + rel);
      continue;
    }
    rmSync(abs, { force: true });
    cleared++;
    console.log("[prebuild] 已清理僵尸锁：" + rel);
  }
  return cleared;
}

const cleared = clearStaleLocks();
if (cleared) console.log("[prebuild] 共清理 " + cleared + " 个僵尸锁");

if (process.env.SKIP_TRAPS === "1") {
  console.log("[prebuild] 已跳过注释陷阱预检（SKIP_TRAPS=1）");
  process.exit(0);
}

const r = spawnSync(process.execPath, [join(ROOT, "scripts", "check-comment-traps.mjs")], {
  stdio: "inherit",
  cwd: ROOT,
});
process.exit(r.status ?? 0);
