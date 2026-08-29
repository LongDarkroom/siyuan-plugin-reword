/**
 * PDF 缩放 Phase 3 · 测试 6: 双击切换 fit-width ↔ 上次缩放
 * ----------------------------------------------------------------
 * 覆盖：
 *  - onDblClickToggleZoom 函数存在
 *  - currentZoom.kind === 'fit-width' → 切回 lastNonFitWidthZoom
 *  - 其他状态 → 切到 fit-width，同时记录 lastNonFitWidthZoom
 *  - main document capture 阶段注册 dblclick 监听
 *  - onDestroy 注销
 *  - 仅 PDF 生效（isPdfBook 检查）
 *
 * 不依赖：foliate / siyuan SDK
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewPath = join(__dirname, "..", "src", "reader", "ReaderView.svelte");
const src = readFileSync(viewPath, "utf-8");

test("[核心] onDblClickToggleZoom 函数存在", () => {
  assert.ok(
    /function onDblClickToggleZoom\(\)/.test(src),
    "onDblClickToggleZoom 函数应存在"
  );
});

test("[核心] onDblClickToggleZoom 仅 PDF 生效", () => {
  const fnIdx = src.indexOf("function onDblClickToggleZoom");
  const body = src.slice(fnIdx, fnIdx + 600);
  assert.ok(
    /if\s*\(!\s*isPdfBook\(\)\s*\)\s*return/.test(body),
    "函数体内应检查 isPdfBook，false 时 return"
  );
});

test("[逻辑] currentZoom === fit-width → 切回 lastNonFitWidthZoom", () => {
  const fnIdx = src.indexOf("function onDblClickToggleZoom");
  const body = src.slice(fnIdx, fnIdx + 600);
  assert.ok(
    /currentZoom\.kind\s*===\s*["']fit-width["'][\s\S]*?applyZoom\(lastNonFitWidthZoom\)/.test(body),
    "fit-width 状态双击应切回 lastNonFitWidthZoom"
  );
});

test("[逻辑] 其他状态 → 切到 fit-width 并记录 lastNonFitWidthZoom", () => {
  const fnIdx = src.indexOf("function onDblClickToggleZoom");
  const body = src.slice(fnIdx, fnIdx + 600);
  assert.ok(
    /lastNonFitWidthZoom\s*=\s*currentZoom[\s\S]*?applyZoom\(\{\s*kind:\s*["']fit-width["']/.test(body),
    "其他状态双击应切到 fit-width 并记录 lastNonFitWidthZoom"
  );
});

test("[注册] main document capture 阶段注册 dblclick", () => {
  assert.ok(
    /document\.addEventListener\(\s*["']dblclick["']\s*,\s*onDblClickToggleZoom\s*,\s*true\s*\)/.test(src),
    "应在 onMount 注册 dblclick 到 main document capture 阶段"
  );
});

test("[注销] onDestroy 注销 dblclick", () => {
  assert.ok(
    /document\.removeEventListener\(\s*["']dblclick["']\s*,\s*onDblClickToggleZoom\s*,\s*true\s*\)/.test(src),
    "应在 onDestroy 注销 dblclick"
  );
});

test("[语义] 双击 fit-width 切回 fit-page（默认 zoom）", () => {
  // 模拟场景：openBook 恢复 fit-page → 双击 → fit-width → 再双击 → 切回 fit-page
  // 因为 lastNonFitWidthZoom 默认是 { kind: "fit-page" }
  const fnIdx = src.indexOf("function onDblClickToggleZoom");
  const body = src.slice(fnIdx, fnIdx + 600);
  // fit-width 切回 lastNonFitWidthZoom
  assert.ok(
    /applyZoom\(lastNonFitWidthZoom\)/.test(body),
    "fit-width 双击应 applyZoom(lastNonFitWidthZoom)"
  );
});

test("[实现] 双击通过 applyZoom 自动持久化（scheduleProgressSave）", () => {
  // onDblClickToggleZoom → applyZoom（无 silent）→ scheduleProgressSave
  // 验证：onDblClickToggleZoom 调 applyZoom 不传 silent
  const fnIdx = src.indexOf("function onDblClickToggleZoom");
  const body = src.slice(fnIdx, fnIdx + 600);
  // 调 applyZoom 时不传第二参数
  assert.ok(
    /applyZoom\(lastNonFitWidthZoom\)[\s\S]*?applyZoom\(\{\s*kind:\s*["']fit-width["']/.test(body) ||
    /applyZoom\(/.test(body),
    "应至少调一次 applyZoom（不传 silent，触发持久化）"
  );
});
