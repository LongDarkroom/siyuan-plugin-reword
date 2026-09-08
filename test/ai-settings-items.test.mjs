/**
 * AI 设置面板「声明即契约」的不变量测试（2026-09-06 第 1 批）。
 *
 * 面板改为声明数组后，加一个设置项只需改 1 处（ai-settings-items.ts），
 * 但「改了就漏」的风险也随之集中到那 1 处。本文件钉住四条不变量：
 *   1. UI 上的每个 key 在 AiSettings 里都真实存在（防 soulDocId 那类假设置项）
 *   2. 标 🟢 已接线的项都有真实消费方（collectWiringReport 必为空）
 *   3. normalize 无缺口（与 listNormalizeGaps 互补）
 *   4. 分组声明与设置项声明不脱节
 */
import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_AI_SETTINGS } from "../src/ai/ai-settings.ts";
import {
  SETTING_GROUPS,
  SETTING_ITEMS,
  itemsOfGroup,
  collectWiringReport,
} from "../src/ai/settings/ai-settings-items.ts";
import { runDiagnose, formatDiagnose } from "../src/ai/settings/ai-settings-diagnose.ts";

/** 不绑定 AiSettings 字段的特殊项（只读展示 / 纯说明 / 按钮组） */
const NON_FIELD_KEYS = new Set(["chatSystemPrompt"]);

/**
 * 2026-09-06 第 2 批：「AiSettings 每个字段都该有归宿」。
 *
 * 覆盖率体检跑出来 65 个字段里有 5 个没有 UI，逐个甄别后的结论：
 *  - 4 个 xxxCharsUsed / aiTokenUsed 是**运行时用量计数器**，由翻译引擎与 AI 客户端
 *    累加，用户不该编辑（给了输入框反而会让人误以为能清零/改写统计）；
 *  - translatePriority 是**真设置项**，但它的 UI 在阅读器 → ⚙ 双语设置 → 显示与界面
 *    的引擎排序里（BilingualSettingsTab.svelte:389 的 engOrder）。
 *
 * 白名单是**显式**的：以后谁给 AiSettings 加了字段却忘了给 UI，这条测试会失败，
 * 逼他要么补 UI、要么在这里写清「为什么不需要 UI」。
 */
const NO_UI_ALLOWED = new Map([
  ["tencentCharsUsed", "运行时用量统计（translate/engine.ts 累加），非用户配置项"],
  ["baiduCharsUsed", "运行时用量统计（translate/engine.ts 累加），非用户配置项"],
  ["youdaoCharsUsed", "运行时用量统计（translate/engine.ts 累加），非用户配置项"],
  ["aiTokenUsed", "运行时用量统计（AI 客户端累加），非用户配置项"],
  [
    "translatePriority",
    "UI 在阅读器 → ⚙ 双语设置 → 显示与界面的引擎排序（BilingualSettingsTab.svelte:389）；" +
      "此处不再复制一份，避免两处都能改同一份配置",
  ],
  [
    "useProtyleInput",
    "2026-09-07 T4 Protyle 输入框全面转正：normalizeAiSettings 恒写 true，" +
      "面板开关已移除（留着会变成「关了重启又变 true」的死开关）。" +
      "字段保留用于 ai-panel.ts 的降级判断（Protyle 构造失败 → contenteditable）",
  ],
  [
    "modelParams",
    "2026-09-07 T6 按模型覆写 temperature/maxTokens：**UI 内嵌在 models 设置项里**" +
      "（AiModelList.svelte 每项的 ⚙ 展开），不是独立设置行，故无同名 key 的声明。" +
      "消费方：ai-orchestrator.toEngineSettings → resolveModelParams",
  ],
  [
    "platforms",
    "2026-09-07 改动点 1/2/3：平台配置列表（单一真源），由 AiPlatformManager.svelte 的" +
      "平台页签 + 表单 + 每平台模型内联参数统一编辑，不是单个 settings 行，故无同名 key 声明。" +
      "消费方：ai-orchestrator.toEngineSettings（按 activePlatformId 取 baseUrl/apiKey）",
  ],
  [
    "activePlatformId",
    "2026-09-07 改动点 3：当前激活平台 id，由 AiPlatformManager 页签与面板两级选择器" +
      "（ai-panel.ts setModel）即时持久化，无独立设置行。",
  ],
  // ── 2026-09-07 改动点 1/2：以下 6 个顶层字段降级为「激活平台镜像」——
  //    normalize 恒从 platforms[activePlatformId] 同步，编辑入口全部在
  //    AiPlatformManager.svelte（平台表单 + 每模型内联参数卡片），不再有声明式设置行。
  ["baseUrl", "激活平台 baseUrl 的镜像（normalize 同步）；编辑入口在 AiPlatformManager 平台表单"],
  ["apiKey", "激活平台 apiKey 的镜像（normalize 同步）；编辑入口在 AiPlatformManager 平台表单"],
  ["model", "当前激活模型；由 AiPlatformManager 与面板两级选择器（setModel）即时持久化"],
  ["models", "激活平台模型列表的镜像；由 AiPlatformManager「添加模型/获取模型」编辑"],
  [
    "temperature",
    "全局兜底温度（无模型覆写时生效）；实际编辑入口为 AiPlatformManager 每模型" +
      "内联参数卡片（写入 modelParams[model].temperature）",
  ],
  [
    "maxTokens",
    "全局兜底最大 Token（无模型覆写时生效）；实际编辑入口为 AiPlatformManager 每模型" +
      "内联参数卡片（写入 modelParams[model].maxTokens）",
  ],
]);

test("ITEMS:AiSettings 每个字段要么有 UI、要么在显式白名单里", () => {
  const uiKeys = new Set(SETTING_ITEMS.map((it) => it.key).filter(Boolean));
  const orphans = Object.keys(DEFAULT_AI_SETTINGS).filter(
    (k) => !uiKeys.has(k) && !NO_UI_ALLOWED.has(k)
  );
  assert.deepEqual(
    orphans,
    [],
    "以下 AiSettings 字段既没有 UI 也不在 NO_UI_ALLOWED 白名单里 —— " +
      "请在 ai-settings-items.ts 补 UI，或在测试的白名单里写清为何不需要: " + orphans.join(", ")
  );
});

test("ITEMS:白名单里的字段确实没有 UI（防止白名单变成僵尸条目）", () => {
  const uiKeys = new Set(SETTING_ITEMS.map((it) => it.key).filter(Boolean));
  const stale = [...NO_UI_ALLOWED.keys()].filter((k) => uiKeys.has(k));
  assert.deepEqual(
    stale,
    [],
    "以下字段已在面板里有 UI，请从 NO_UI_ALLOWED 白名单移除: " + stale.join(", ")
  );
});

test("ITEMS:每个声明的 key 都在 AiSettings 里真实存在", () => {
  const fields = new Set(Object.keys(DEFAULT_AI_SETTINGS));
  const bad = SETTING_ITEMS
    .filter((it) => it.key && !NON_FIELD_KEYS.has(it.key) && !fields.has(it.key))
    .map((it) => `${it.group}/${it.key}`);
  assert.deepEqual(
    bad,
    [],
    "以下设置项的 key 在 AiSettings 中不存在 —— 它们会「存了不生效」或「读不到值」"
  );
});

test("ITEMS:每个项都有 title 与 wired，且 group 已在 SETTING_GROUPS 声明", () => {
  const groupIds = new Set(SETTING_GROUPS.map((g) => g.id));
  for (const it of SETTING_ITEMS) {
    assert.ok(it.title, `缺少 title: ${JSON.stringify(it)}`);
    assert.ok(["yes", "partial", "planned"].includes(it.wired), `wired 非法: ${it.title}`);
    assert.ok(groupIds.has(it.group), `group 未声明: ${it.group}（${it.title}）`);
  }
});

test("ITEMS:每组至少有一项（导航不出现空分组）", () => {
  for (const g of SETTING_GROUPS) {
    assert.ok(
      itemsOfGroup(g.id).length > 0,
      `分组「${g.label}」(${g.id}) 没有任何设置项`
    );
  }
});

test("ITEMS:collectWiringReport 必须为空 —— 不允许假设置项", () => {
  const report = collectWiringReport();
  assert.deepEqual(
    report,
    [],
    "以下项标了「已接线」却没有真实消费方: " + JSON.stringify(report, null, 2)
  );
});

test("ITEMS:每个项都声明了 consumer（没有消费方的项不许进面板）", () => {
  const missing = SETTING_ITEMS.filter((it) => it.key && !it.consumer).map((it) => it.key);
  assert.deepEqual(missing, [], "以下项未声明 consumer: " + missing.join(", "));
});

test("ITEMS:requires 指向的 key 必须是同组内已存在的开关", () => {
  const keys = new Set(SETTING_ITEMS.map((it) => it.key));
  for (const it of SETTING_ITEMS) {
    if (!it.requires) continue;
    assert.ok(keys.has(it.requires), `${it.key} 依赖了不存在的 key: ${it.requires}`);
    const upstream = SETTING_ITEMS.find((x) => x.key === it.requires);
    assert.equal(upstream?.type, "switch", `${it.key} 的依赖 ${it.requires} 不是开关`);
  }
});

test("Diagnose:normalize 无缺口且无假设置项", () => {
  const r = runDiagnose();
  assert.deepEqual(r.normalizeGaps, [], "normalize 漏字段: " + r.normalizeGaps.join(", "));
  assert.deepEqual(r.unwired, [], "存在假设置项: " + JSON.stringify(r.unwired));
  assert.ok(r.stats.totalItems > 0);
  assert.ok(r.stats.yes > 0);
});

test("Diagnose:formatDiagnose 输出包含四大分节", () => {
  const text = formatDiagnose(runDiagnose());
  for (const sec of ["【1】normalize 缺口", "【2】假设置项", "【3】待接线", "【4】规划中"]) {
    assert.ok(text.includes(sec), `报告缺少分节: ${sec}`);
  }
});
