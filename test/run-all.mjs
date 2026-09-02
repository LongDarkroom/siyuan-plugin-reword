// 聚合测试运行器：逐个运行白名单测试文件，不因单个失败而中断，
// 最后汇总 PASS/FAIL 并退出对应状态码（有任一失败则 exit 1）。
// 用法：npm test  （等价于 node test/run-all.mjs）
// 调试单个失败文件完整日志：VERBOSE=1 npm test
import { spawn } from "node:child_process";

const NODE = process.execPath;
const LOADER = "./test/siyuan-stub-loader.mjs";

const TESTS = [
  "test/pos-toggle.test.mjs",
  "test/responsive.test.mjs",
  "test/reader-drawer-state.test.mjs",
  "test/phrase-column.test.mjs",
  "test/tts-read.test.mjs",
  "test/tts-controller-create.test.mjs",
  "test/tts-backend-fallback.test.mjs",
  "test/tts-edge-fail-graceful.test.mjs",
  "test/tts-settings-merge.test.mjs",
  "test/annotation-store.test.mjs",
  "test/annotation-store-subscribe.test.mjs",
  "test/pdf-outline.test.mjs",
  "test/pdf-phase1-ui.test.mjs",
  "test/block-mark.test.mjs",
  "test/annotation-render.test.mjs",
  "test/inline-mark.test.mjs",
  "test/ai-client.test.mjs",
  "test/ai-text.test.mjs",
  "test/ai-drag-doc-id.test.mjs",
  "test/ai-orchestrator.test.mjs",
  "test/anno-ai-dialog.test.mjs",
  "test/whale-prompt.test.mjs",
  "test/online-phonetic.test.mjs",
  "test/dict-search-index.test.mjs",
  "test/label-store.test.mjs",
  "test/whale-dialog-html.test.mjs",
  "test/whale-dialog-ai-button.test.mjs",
  "test/edit-session.test.mjs",
  "test/render-roundtrip.test.mjs",
  "test/online-dict.test.mjs",
  "test/online-cache-ttl.test.mjs",
  "test/ai-doc-ref.test.mjs",
  "test/ai-refs.test.mjs",
  "test/clean-for-ai-doc-ref.test.mjs",
  "test/get-document-content.test.mjs",
  "test/ai-settings-normalize.test.mjs",
  "test/word-preferred-defs.test.mjs",
  "test/dict-renderer-preferred.test.mjs",
  "test/preferred-pick-helper.test.mjs",
  "test/review-preferred.test.mjs",
  "test/export.test.mjs",
  "test/review-difficulty.test.mjs",
  "test/review-scheduler.test.mjs",
  "test/review-config.test.mjs",
  "test/review-data.test.mjs",
  "test/review-data-injection.test.mjs",
  "test/review-statemachine.test.mjs",
  "test/review-calibrate.test.mjs",
  "test/vocab-master-batch.test.mjs",
  "test/vocab-store.test.mjs",
  "test/ann-editor.test.mjs",
  "test/ann-block-detect.test.mjs",
  "test/table-render.test.mjs",
  "test/note-table.test.mjs",
  "test/ai-message-toolbar.test.mjs",
  "test/confirm-delete.test.mjs",
  "test/ai-render-think.test.mjs",
  "test/ai-render-incremental.test.mjs",
  "test/stream-throttle.test.mjs",
  "test/chat-trim.test.mjs",
  "test/ai-panel-resizer.test.mjs",
  "test/brand-rename.test.mjs",
  "test/vocab-highlight.test.mjs",
  "test/learning-status.test.mjs",
  "test/index-vocab-integration.test.mjs",
  "test/reader-shortcuts.test.mjs",
  "test/vocab-store-load-guard.test.mjs",
  "test/console-filter.test.mjs",
  "test/logger-perf.test.mjs",
  "test/reader-tab-diagnostic-cleanup.test.mjs",
  "test/reader-epub-style-override.test.mjs",
  "test/reader-cjk-font-stack.test.mjs",
  "test/reader-style-no-footnote-touch.test.mjs",
  "test/reader-style-priority.test.mjs",
  "test/reader-style-font-preserve.test.mjs",
  "test/reader-toc-scroll.test.mjs",
  "test/reader-fonts-host.test.mjs",
  "test/reader-view-font-blob.test.mjs",
  "test/dock-layout-persistence.test.mjs",
  "test/reader-popover-outside-click.test.mjs",
  "test/vocab-highlight-toggle.test.mjs",
  "test/reader-vocab-autohighlight.test.mjs",
  "test/reader-floating-layer.test.mjs",
  "test/reader-annotation-onestep-flow.test.mjs",
  "test/reader-book-excerpts-refresh.test.mjs",
  "test/reader-bookmarks-annots.test.mjs",
  "test/reader-sel-toolbar.test.mjs",
  "test/reader-show-annotation-rec-fallback.test.mjs",
  "test/reader-settings-4-sections.test.mjs",
  "test/reader-settings-placeholder-encoding.test.mjs",
  "test/safe-delete-annotation.test.mjs",
  "test/safe-delete-annotation-v4.test.mjs",
  "test/reader-settings-compact.test.mjs",
  "test/reader-font-size-override.test.mjs",
  "test/reader-search.test.mjs",
  "test/reader-layout.test.mjs",
  "test/reader-footnote-robust.test.mjs",
  "test/reader-toolbar-annotation.test.mjs",
  "test/reader-typo-preset.test.mjs",
  "test/bilingual-pretranslate.test.mjs",
  "test/bilingual-v2.test.mjs",
  "test/bilingual-render.test.mjs",
  "test/sqlite-translation-cache.test.mjs",
  "test/glossary.test.mjs",
  "test/cache-mode.test.mjs",
  "test/translate-providers.test.mjs",
  "test/telemetry.test.mjs",
];

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
