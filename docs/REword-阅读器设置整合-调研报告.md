# REword · 阅读器设置整合 — 调研报告

> 2026-09-29 · 状态：**待拍板**（本文只做盘点与建议，未改任何代码）
> 方法：通读 `reader-settings.ts` 全部接口 + 对全部 70 个设置字段做全仓消费点统计（排除定义文件/vendor/.bak）+ 通读设置抽屉 UI 结构。

---

## 一、设置全景（现状结构）

**入口分布**：
- 阅读器设置抽屉（ReaderView.svelte，`<details>` 折叠分组 ×6 + 顶部直显区）；
- 双语翻译设置：独立 Tab（BilingualSettingsTab.svelte）；
- PDF 设置：独立组件（PdfSettings.svelte + PdfToolbar）。

**抽屉分组现状**（行号为 ReaderView.svelte）：

| 分组 | 内容 | 项数 |
|---|---|---|
| 顶部直显（非折叠） | 主题 8+自定义（fg/bg/背景图）、字号、行距、阅读模式（分页/滚动）、翻页动画、字体来源与四条字体链、覆盖出版商字体/字号、点击翻页、专注模式、lineWidth 书页边距三档 | ~18 |
| 📖 文本设置 | 字重、字距 | 2 |
| 📐 段落设置 | 段距、首行缩进 | 2 |
| 🔊 朗读设置 | （TTS 相关） | 数项 |
| 📤 笔记导出绑定 | 摘录/书图谱绑定文档（拖拽绑定）、模板 | ~6 |
| ⬜ 页面布局 | 4 边距、页宽模式（pct/fixed，今日新增）、分栏间距、页眉/页脚/进度 3 开关、进度样式、底部程序坞、参考页数、当前时间、24 小时制 | **~14** |
| ⚙ 高级设置 | 恢复 Tab 等 | 数项 |

**字段总数 ≈ 70；消费统计：无「零消费」死字段**（最低 bilingualSourceLang / bilingualProgressiveAuto / bilingualRealtimePreview / use24Hour / restoreTabsOnLaunch = 2 处，均为 UI + 逻辑各一，活着）。

---

## 二、问题诊断（为什么感觉乱）

1. **页宽三套机制并存**（历史叠加）：
   - `lineWidth`（窄/标准/宽，em 级书页边距，早期实现）；
   - `layout.widthPct`（内容宽度占窗口百分比，2026-09-25）;
   - `layout.widthMode + fixedWidthPx`（固定书页宽，今日新增）。
   三者都在控制"书页有多宽"，用户面对三处入口语义难分。
2. **页面布局组过载**（14 项混装）：页宽、边距、分栏间距、页眉脚/进度/时间/24h 状态栏类全在一组。
3. **左右边距的条件语义隐蔽**：`marginLeftPx/RightPx` 仅在「跟随思源文档边距」开启时生效——无 UI 提示时像死设置。

---

## 三、建议清单（按动作分级）

### A. 可删除 / 合并（需要拍板）

| 项 | 现状 | 建议 | 理由 |
|---|---|---|---|
| `lineWidth`（窄/标准/宽 三档） | buildStyles 里提供 body padding（ReaderView:962） | **删除，并入页宽模式**：其"书页边距"职责由 页边距设置 + 页宽模式 完整承接 | 功能与 widthPct/widthMode 完全重叠，是三套页宽机制中最旧的一套 |

### B. 建议移位/折叠（不改行为，只整理）

| 项 | 建议 |
|---|---|
| `referencePageCount`、`showCurrentTime`、`use24Hour`、`bottomBarMode` | 从「页面布局」拆出，新建「📖 状态栏」折叠子组（4 项全是页脚/程序坞展示类） |
| `bilingualDebug` | 移入双语 Tab 的高级折叠（调试项不应与阅读排版混在主抽屉） |
| `marginLeftPx / marginRightPx` | UI 上标注「仅跟随思源页边时生效」（tooltip 已有，行内补一个弱化标签） |

### C. 保留（低消费但确有功能）

`bilingualSourceLang`（翻译源语言，翻译链真实读取）、`bilingualProgressiveAuto / bilingualRealtimePreview / bilingualRetry / bilingualSkipCached`（双语行为开关）、`restoreTabsOnLaunch`、其余全部双语/PDF/笔记绑定项——**均有真实消费，不建议动**。

---

## 四、整合后的目标结构（拍板后实施）

```
阅读器设置抽屉
├─ 顶部直显：主题 / 字号 / 行距 / 阅读模式 / 翻页动画 / 字体 / 覆盖开关 / 点击翻页 / 专注模式
├─ 📖 文本设置（字重 / 字距）
├─ 📐 段落设置（段距 / 缩进）
├─ ⬜ 页面布局（页宽模式+滑块 / 上下边距 / 分栏间距 / 跟随思源页边）
├─ 📊 状态栏（新拆组：页眉 / 页脚 / 进度+样式 / 参考页数 / 当前时间 / 24h / 程序坞）
├─ 🔊 朗读设置
├─ 📤 笔记导出绑定
└─ ⚙ 高级设置（恢复 Tab 等）
双语 / PDF：维持独立 Tab
（lineWidth 删除，其数据字段保留做旧档兼容读取，UI 移除）
```

---

## 五、待拍板问题

1. `lineWidth` 三档确认删除？（删除 = UI 移除三档按钮，字段保留兼容旧档；书页边距改由「页边距 + 页宽模式」表达）
2. 「📊 状态栏」子组拆分是否照上表执行？
3. `bilingualDebug` 移到双语 Tab？
