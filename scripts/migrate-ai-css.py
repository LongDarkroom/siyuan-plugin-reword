#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 AI 精读面板 + AI 设置面板 的 CSS 从「混合 --hw-* + 硬编码深色回退」统一迁移为
Copilot 纯 --b3-theme-* 设计令牌体系，并对齐 Copilot 关键尺寸。
严格排除 Copilot 原生 .cp-* 块（7080-7536），不改动它。
"""
import io

PATH = "/Users/xieyue/Downloads/思源笔记/data/plugins/siyuan-plugin-reword/src/index.less"

with open(PATH, "r", encoding="utf-8") as f:
    lines = f.readlines()

# 区块边界（1-indexed 行号）
AI_START = 3314   # /* ============ AI 精读面板（Copilot 聊天式设计） ============ */
SET_END = 7536    # AI 精读·模型下拉段结束前（Copilot 块 .cp-* 起始 7080，需排除）
CP_START = 7080   # /* ===================== Copilot 聊天（照抄自 copilot 插件）===================== */

# 要处理的行范围：AI_START .. CP_START-1（即 [3313 .. 7079] 0-indexed）
lo = AI_START - 1
hi = CP_START - 1  # 不含 CP_START

# 替换规则：最具体优先
REPL = [
    # --- 先修 2 处真实 CSS 语法错误（var(--hw-border)ba(...) 非法）---
    ("var(--hw-border)ba(255,255,255,0.08)", "var(--b3-theme-divider)"),
    ("var(--hw-border)ba(255,255,255,0.12)", "var(--b3-theme-divider)"),

    # --- 自定义 --hw-* 变量 → --b3-theme-* 令牌 ---
    ("var(--hw-hover-bg)", "var(--b3-theme-background-hover)"),
    ("var(--hw-accent)", "var(--b3-theme-primary)"),
    ("var(--hw-danger)", "var(--b3-theme-error)"),
    ("var(--hw-surface-3)", "var(--b3-theme-surface-lighter, var(--b3-theme-surface))"),
    ("var(--hw-border-strong)", "var(--b3-theme-divider)"),
    ("var(--hw-border)", "var(--b3-theme-divider)"),
    ("var(--hw-text-2)", "var(--b3-theme-on-surface-light, #999)"),

    # --- 设置面板专用 --hw-*（面板底/卡片底/文字/浅主色）---
    ("var(--hw-surface-2)", "var(--b3-theme-surface)"),
    ("var(--hw-surface)", "var(--b3-theme-background)"),
    ("var(--hw-text)", "var(--b3-theme-on-background)"),
    ("var(--hw-accent-lite)", "var(--b3-theme-primary-lighter, rgba(80,120,255,.12))"),

    # --- 漏网的深色边框回退 ---
    ("var(--b3-border-color, rgba(255,255,255,0.15))", "var(--b3-theme-divider)"),

    # --- 深色-only 边框回退 → --b3-theme-divider ---
    ("var(--b3-border-color, rgba(255,255,255,0.08))", "var(--b3-theme-divider)"),
    ("var(--b3-border-color, rgba(255,255,255,0.12))", "var(--b3-theme-divider)"),
    ("var(--b3-border-color, rgba(255,255,255,0.06))", "var(--b3-theme-divider)"),
    ("var(--b3-border-color, rgba(255,255,255,0.22))", "var(--b3-theme-divider)"),
    ("var(--b3-border-color, rgba(255,255,255,0.1))", "var(--b3-theme-divider)"),
    ("var(--b3-border-color, rgba(128,128,128,0.25))", "var(--b3-theme-divider)"),

    # --- 硬编码背景回退 ---
    ("var(--b3-theme-background, #1a1a1a)", "var(--b3-theme-background)"),
    ("var(--b3-theme-background, var(--b3-theme-on-background, #1e1e1e))", "var(--b3-theme-background)"),
    ("var(--b3-theme-surface, #fff)", "var(--b3-theme-surface)"),
    ("var(--b3-theme-surface, rgba(255,255,255,0.02))", "var(--b3-theme-surface)"),
    ("var(--b3-theme-surface, #2a2a2a)", "var(--b3-theme-surface)"),

    # --- 主文字回退 ---
    ("var(--b3-theme-on-background, var(--b3-border-color, #eee))", "var(--b3-theme-on-background)"),
    ("var(--b3-theme-on-background, var(--b3-border-color, #ddd))", "var(--b3-theme-on-background)"),
    ("var(--b3-theme-on-background, var(--b3-border-color, #1e1e1e))", "var(--b3-theme-on-background)"),

    # --- 次文字回退 ---
    ("var(--b3-theme-on-surface-light, var(--b3-theme-on-surface, #666))", "var(--b3-theme-on-surface-light, #999)"),
    ("var(--b3-theme-on-surface-light, var(--b3-theme-on-surface, #555))", "var(--b3-theme-on-surface-light, #999)"),
    ("var(--b3-theme-on-surface-light, var(--b3-theme-on-surface-light, #888))", "var(--b3-theme-on-surface-light, #999)"),
    ("var(--b3-theme-on-surface-light, var(--b3-theme-on-surface-light, #999))", "var(--b3-theme-on-surface-light, #999)"),
    ("var(--b3-theme-on-surface-light, #888)", "var(--b3-theme-on-surface-light, #999)"),
    ("var(--b3-theme-on-surface-light, #777)", "var(--b3-theme-on-surface-light, #999)"),
    ("var(--b3-theme-on-surface-light, #bbb)", "var(--b3-theme-on-surface-light, #999)"),

    # --- 表面文字回退 ---
    ("var(--b3-theme-on-surface, var(--b3-theme-on-surface-light, #bbb))", "var(--b3-theme-on-surface)"),
    ("var(--b3-theme-on-surface, #666)", "var(--b3-theme-on-surface)"),
    ("var(--b3-theme-on-surface, #bbb)", "var(--b3-theme-on-surface)"),

    # --- 主色衍生 ---
    ("var(--b3-theme-primary-light, #6b9fff)", "var(--b3-theme-primary)"),
    ("var(--b3-theme-primary-lightest, #e6f0ff)", "var(--b3-theme-primary-lighter, rgba(80,120,255,.12))"),

    # --- 硬编码主色 rgba → color-mix（跟随主题主色）---
    ("rgba(79,110,247,0.06)", "color-mix(in srgb, var(--b3-theme-primary) 6%, transparent)"),
    ("rgba(79,110,247,0.08)", "color-mix(in srgb, var(--b3-theme-primary) 8%, transparent)"),
    ("rgba(79,110,247,0.12)", "color-mix(in srgb, var(--b3-theme-primary) 12%, transparent)"),
    ("rgba(79,110,247,0.15)", "color-mix(in srgb, var(--b3-theme-primary) 15%, transparent)"),
    ("rgba(79,110,247,0.2)", "color-mix(in srgb, var(--b3-theme-primary) 18%, transparent)"),
    ("rgba(79,110,247,0.3)", "color-mix(in srgb, var(--b3-theme-primary) 28%, transparent)"),
    ("rgba(79,110,247,0.35)", "color-mix(in srgb, var(--b3-theme-primary) 35%, transparent)"),
    ("rgba(66,133,244,0.2)", "color-mix(in srgb, var(--b3-theme-primary) 18%, transparent)"),
    ("rgba(66,133,244,0.25)", "color-mix(in srgb, var(--b3-theme-primary) 25%, transparent)"),
    ("rgba(180,200,255,0.9)", "var(--b3-theme-primary-lighter, rgba(80,120,255,.12))"),
]

# 尺寸对齐（Copilot 值）
SIZES = [
    # header padding 8px 12px -> 8px 10px
    ("  padding: 8px 12px;\n", "  padding: 8px 10px;\n"),
    # 消息头像 30px 方角 -> 28px 圆形
    ("  width: 30px;\n  height: 30px;\n  border-radius: 8px;\n  background: linear-gradient(135deg, var(--b3-theme-primary, var(--hw-accent)), color-mix(in srgb, var(--b3-theme-primary, var(--hw-accent)) 68%, #000));",
     "  width: 28px;\n  height: 28px;\n  border-radius: 50%;\n  background: var(--b3-theme-primary);"),
    # 用户头像渐变 -> 跟随 secondary（Copilot 用 --b3-theme-secondary）
    ("  background: linear-gradient(135deg, var(--b3-theme-primary, #6b8bf9), color-mix(in srgb, var(--b3-theme-primary, #6b8bf9) 72%, #fff));",
     "  background: var(--b3-theme-secondary, #6b7785);"),
]

stats = {old: 0 for old, _ in REPL}
size_stats = [0] * len(SIZES)

for i in range(lo, hi + 1):
    line = lines[i]
    for idx, (old, new) in enumerate(REPL):
        if old in line:
            cnt = line.count(old)
            line = line.replace(old, new)
            stats[old] += cnt
    for sidx, (old, new) in enumerate(SIZES):
        if old in line:
            cnt = line.count(old)
            line = line.replace(old, new)
            size_stats[sidx] += cnt
    lines[i] = line

with open(PATH, "w", encoding="utf-8") as f:
    f.writelines(lines)

print("=== 变量/回退替换统计 ===")
for old, c in stats.items():
    if c:
        print(f"  {c:3d}x  {old!r}")
print("\n=== 尺寸对齐统计 ===")
for (old, new), c in zip(SIZES, size_stats):
    if c:
        print(f"  {c:3d}x  {old.strip()!r} -> {new.strip()!r}")
print("\n完成。处理行范围:", AI_START, "..", CP_START - 1)
