/**
 * AI 设置「接线」不变量测试（2026-09-06 第 3 批 · 暴露）。
 *
 * 背景：面板把 7 个 🟡 待接线项露出来了，但这些项的消费方此前是**硬编码常量**。
 * 第 3 批把它们改成读取设置。这类改动有个特点——改完看不出错，漏改也看不出错，
 * 只有用户改了设置没反应时才会暴露。所以这里用源码切片把「接线」钉死：
 * 一旦有人把 `throttleMs` 改回 `100`、把 `docTotalCap` 改回 `MAX_DOC_TOTAL`，
 * 测试立刻失败。
 *
 * 与 `ai-settings-items.test.mjs` 的分工：
 *   - items 那条管「面板声明 vs AiSettings 字段」（数据层）
 *   - 本文件管「消费方是否真去读设置」（代码层）
 * 两者互补，合起来才构成「设置项 → 消费方」的完整契约。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const panelSrc = readFileSync(join(here, "../src/ai/ai-panel.ts"), "utf8");
const indexSrc = readFileSync(join(here, "../src/index.ts"), "utf8");

/**
 * 从 marker 起做花括号配对，切出方法体。
 * 注意：只适用于「方法体不含未配对花括号的字符串/模板串」的场景；
 * ai-panel.ts 里有大量 HTML 模板串，其中含 `${...}`，但花括号本身是配对的，故可行。
 */
function bodyOf(src, marker) {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `源码中应存在：${marker}`);
  let depth = 0;
  let begun = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") { depth++; begun = true; }
    else if (ch === "}") {
      depth--;
      if (begun && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`花括号未配对：${marker}`);
}

// ───────────────────────── 1. contextMaxChars ─────────────────────────

test("接线:contextMaxChars() 读取设置，缺失时回退 MAX_DOC_TOTAL", () => {
  const body = bodyOf(panelSrc, "private contextMaxChars(");
  assert.match(body, /getAiSettings\(\)\?\.contextMaxChars/, "应读取 AiSettings.contextMaxChars");
  assert.match(body, /MAX_DOC_TOTAL/, "缺失时应回退到常量 MAX_DOC_TOTAL");
  assert.match(body, /Number\.isFinite/, "应防御非有限数（脏值不该让整个展开逻辑崩）");
});

test("接线:expandRefs 用 docTotalCap 而非直接比 MAX_DOC_TOTAL", () => {
  const body = bodyOf(panelSrc, "private async expandRefs(");
  assert.match(body, /const docTotalCap = this\.contextMaxChars\(\);/, "应先读取上限到本地常量");
  assert.doesNotMatch(
    body,
    />\s*MAX_DOC_TOTAL/,
    "不应再用 MAX_DOC_TOTAL 直接比较 —— 那样设置项就失效了"
  );
});

test("接线:expandDocRefs 用 docTotalCap 而非直接比 MAX_DOC_TOTAL", () => {
  const body = bodyOf(panelSrc, "private async expandDocRefs(");
  assert.match(body, /const docTotalCap = this\.contextMaxChars\(\);/, "应先读取上限到本地常量");
  assert.doesNotMatch(
    body,
    />\s*MAX_DOC_TOTAL/,
    "不应再用 MAX_DOC_TOTAL 直接比较 —— 那样设置项就失效了"
  );
});

test("接线:index.ts 两处文档正文拉取都传入 contextMaxChars", () => {
  // 动态 import 的那处（fetchDocText）
  assert.match(
    indexSrc,
    /getDocText\(docId, this\.aiSettings\.contextMaxChars\)/,
    "fetchDocText 应把设置的上限传给 getDocText"
  );
  // AiHost.getDocText 实现（转发给 ai-doc-search）
  assert.match(
    indexSrc,
    /getAiDocText\(docId, this\.aiSettings\.contextMaxChars\)/,
    "AiHost.getDocText 应把设置的上限传给 getAiDocText"
  );
  // 硬编码 12000 不该再出现在调用处（ai-doc-search.ts 里的默认值仍保留，那是兜底）
  assert.doesNotMatch(
    indexSrc,
    /getAiDocText\(docId,\s*12000\)/,
    "调用处不应再硬编码 12000"
  );
});

// ───────────────────── 取设置必须防御 host 返回 null ─────────────────────

test("接线:取设置必须能扛住 host.getAiSettings() 返回 null", () => {
  // 2026-09-06 真实回归：第一版写成 this.host.getAiSettings().contextMaxChars，
  // 而 test/ai-refs-panel.test.mjs 的 AiHost stub 不实现 getAiSettings()（返回 null），
  // 直接让 9 条用例以 "Cannot read properties of null" 崩掉。
  // 生产环境 host 恒返回 aiSettings，但纯逻辑路径不该因取不到设置而崩 ——
  // 取不到就退化为常量，这才是「设置项失效」与「功能崩溃」的区别。
  const ctxBody = bodyOf(panelSrc, "private contextMaxChars(");
  assert.match(ctxBody, /getAiSettings\(\)\?\./, "contextMaxChars 必须用可选链取设置");

  const idx = panelSrc.indexOf("const throttleMs =");
  assert.notEqual(idx, -1, "应定义 throttleMs");
  assert.match(
    panelSrc.slice(idx, idx + 320),
    /aiSet\?\.streamThrottleMs/,
    "throttleMs 必须用可选链取设置"
  );

  const wtIdx = panelSrc.indexOf("const wantThinking =");
  assert.notEqual(wtIdx, -1, "应定义 wantThinking");
  assert.match(
    panelSrc.slice(wtIdx, wtIdx + 120),
    /aiSet\?\.showThinking/,
    "wantThinking 必须用可选链取设置"
  );
});

// ───────────────────────── 2. streamThrottleMs ─────────────────────────

test("接线:流式节流两处都读 throttleMs，不再硬编码 100", () => {
  // 整个发送方法体很大，直接全文找即可（节流器创建点唯一）
  assert.match(
    panelSrc,
    /createStreamThrottle\(renderThinking, throttleMs\)/,
    "thinking 节流应读设置"
  );
  assert.match(
    panelSrc,
    /createStreamThrottle\(renderLive, throttleMs\)/,
    "正文节流应读设置"
  );
  assert.doesNotMatch(
    panelSrc,
    /createStreamThrottle\([^,]+,\s*100\)/,
    "不应再有硬编码 100 的节流器创建"
  );
});

test("接线:throttleMs 的取值做了脏值防御（0 合法：表示不节流）", () => {
  const idx = panelSrc.indexOf("const throttleMs =");
  assert.notEqual(idx, -1, "应定义 throttleMs");
  const seg = panelSrc.slice(idx, idx + 320);
  assert.match(seg, /aiSet\.streamThrottleMs/, "应读取 AiSettings.streamThrottleMs");
  assert.match(seg, /streamThrottleMs >= 0/, "0 必须合法（设置项允诺 0 = 不节流）");
  assert.match(seg, /:\s*100/, "脏值/缺失时回退 100（与 stream-throttle.ts 默认一致）");
});

// ───────────────────────── 3. showThinking ─────────────────────────

test("接线:wantThinking 读取设置且默认放行（缺省 true）", () => {
  const idx = panelSrc.indexOf("const wantThinking =");
  assert.notEqual(idx, -1, "应定义 wantThinking");
  const seg = panelSrc.slice(idx, idx + 120);
  assert.match(seg, /aiSet\?\.showThinking/, "应读取 AiSettings.showThinking");
  // `!== false` 而非 `=== true` —— 老配置没有该字段时应视为开启，保持旧行为
  assert.match(seg, /!== false/, "缺省（字段不存在）应视为开启，避免老用户行为突变");
});

test("接线:思考过程的两条渲染路径都判 wantThinking", () => {
  // ① 流式期间的 live-think 区
  const renderThinking = bodyOf(panelSrc, "const renderThinking = () =>");
  assert.match(renderThinking, /!wantThinking/, "关闭时不应展开 live-think 区");
  // ② 结果气泡内联的 <details>（两条路径缺一，关了开关还是会显示）
  assert.match(
    panelSrc,
    /this\.liveThinkingText && wantThinking/,
    "结果气泡内的 details 也应受同一开关控制"
  );
});
