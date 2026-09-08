// 聚合测试运行器：逐个运行测试文件，不因单个失败而中断，
// 最后汇总 PASS/FAIL 并退出对应状态码（有任一失败则 exit 1）。
// 用法：npm test  （等价于 node test/run-all.mjs）
// 调试单个失败文件完整日志：VERBOSE=1 npm test
//
// 2026-09-04 P1：白名单改为自动发现。
// 此前是 108 条硬编码白名单，而 test/ 下实有 151 个 .test.mjs —— 43 个文件
// （集中在 pdf / ink / bookshelf 等近期改动最密的模块）从未被执行过，
// 且白名单双向失真：文件删了条目还在（恒定 ERR_MODULE_NOT_FOUND）、
// 文件新增了却没进白名单（静默漏测，测了也白测）。
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NODE = process.execPath;
const LOADER = "./test/siyuan-stub-loader.mjs";
const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)));

// 需要长期跳过的文件放这里，必须附原因与日期。
// 为空是正常的 —— 宁可让它失败暴露出来，也不要静默漏测。
const SKIP = new Set([
  // 例："test/foo.test.mjs", // 2026-09-04 原因为 xxx
]);

const TESTS = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => "test/" + f)
  .filter((f) => !SKIP.has(f))
  .sort();


function run(file) {
  return new Promise((resolve) => {
    const child = spawn(NODE, [
      "--experimental-loader=" + LOADER,
      "--experimental-strip-types",
      file,
    ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ file, code, out }));
  });
}

function countNotOk(out) {
  return (out.match(/^not ok/gm) || []).length;
}

async function main() {
  const failed = [];
  const verbose = !!process.env.VERBOSE;
  let i = 0;
  for (const f of TESTS) {
    i++;
    const r = await run(f);
    const ok = r.code === 0;
    if (!ok) failed.push(r);
    const tag = ok ? "PASS" : "FAIL";
    const extra = ok ? "" : " (exit=" + r.code + ", notOk=" + countNotOk(r.out) + ")";
    console.log("[" + tag + "] " + String(i).padStart(3, "0") + "/" + TESTS.length + " " + f + extra);
  }
  const passCount = TESTS.length - failed.length;
  console.log("");
  console.log("=== SUMMARY ===");
  console.log("passed  : " + passCount + "/" + TESTS.length);
  console.log("failed  : " + failed.length);
  if (failed.length) {
    console.log("failed files:");
    for (const r of failed) {
      console.log("  - " + r.file + " (exit=" + r.code + ", notOk=" + countNotOk(r.out) + ")");
    }
    if (verbose) {
      console.log("");
      console.log("=== VERBOSE OUTPUT OF FAILURES ===");
      for (const r of failed) {
        console.log("\n----- " + r.file + " -----");
        console.log(r.out);
      }
    } else {
      console.log("(set VERBOSE=1 to dump full logs of failing files)");
    }
    process.exitCode = 1;
  } else {
    console.log("ALL GREEN");
    process.exitCode = 0;
  }
}

main();
