// 排版预设（紧凑/舒适/舒展/绘本）常量完整性回归测试（2026-08-30）
// 锁定 READER_TYPO_PRESETS 的字段契约与合理数值范围，防止误改破坏排版预设。
import { test } from "node:test";
import assert from "node:assert/strict";
import { READER_TYPO_PRESETS, LAYOUT_PRESETS, READER_DEFAULT_SETTINGS } from "../src/reader/reader-settings.ts";

const REQUIRED = [
  "label",
  "hint",
  "lineHeight",
  "letterSpacing",
  "marginTopPx",
  "marginBottomPx",
  "marginLeftPx",
  "marginRightPx",
  "paragraphSpacing",
];

test("READER_TYPO_PRESETS 含 4 个预设且字段完整", () => {
  const keys = Object.keys(READER_TYPO_PRESETS);
  assert.deepEqual(
    [...keys].sort(),
    ["comfort", "compact", "picture", "spacious"].sort()
  );
  for (const key of keys) {
    const p = READER_TYPO_PRESETS[key];
    for (const field of REQUIRED) {
      assert.ok(field in p, `预设 ${key} 缺少字段 ${field}`);
    }
  }
});

test("READER_TYPO_PRESETS 数值在合理范围", () => {
  for (const key of Object.keys(READER_TYPO_PRESETS)) {
    const p = READER_TYPO_PRESETS[key];
    assert.ok(p.lineHeight >= 1.4 && p.lineHeight <= 2.2, `${key}.lineHeight 越界`);
    assert.ok(p.letterSpacing >= 0 && p.letterSpacing <= 8, `${key}.letterSpacing 越界`);
    assert.ok(p.paragraphSpacing >= 0 && p.paragraphSpacing <= 2, `${key}.paragraphSpacing 越界`);
    for (const m of ["marginTopPx", "marginBottomPx", "marginLeftPx", "marginRightPx"]) {
      assert.ok(p[m] >= 0 && p[m] <= 100, `${key}.${m} 越界`);
    }
  }
});

test("排版预设与边距预设（LAYOUT_PRESETS）并存不冲突", () => {
  // 边距预设是旧机制（铺满/正常/宽松/自定义），排版预设是新增更全的维度；两者 key 不同。
  const typoKeys = Object.keys(READER_TYPO_PRESETS);
  const layoutKeys = Object.keys(LAYOUT_PRESETS);
  assert.ok(layoutKeys.includes("fill") && layoutKeys.includes("normal"), "边距预设应保持原样");
  assert.equal(typoKeys.filter((k) => layoutKeys.includes(k)).length, 0, "两套预设 key 不应重叠");
});

test("默认开启「重启后恢复阅读 Tab」", () => {
  // 思源不会自动恢复自定义插件 Tab；该开关默认开，避免用户重启后阅读 Tab 丢失。
  assert.equal(READER_DEFAULT_SETTINGS.layout.restoreTabsOnLaunch, true, "restoreTabsOnLaunch 默认应为 true");
});
