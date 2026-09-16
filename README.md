<h1 align="center">RE word（REword）</h1>
<p align="center"><b>英语学习工作台 · 离线词典与电子书阅读器</b></p>
<p align="center">让思源笔记变身英语学习闭环：查词 → 收词 → 复习 → 精读 → 沉淀</p>

<p align="center">离线查词（支持 MDX / StarDict 自定义词库）、框选快捷键收词、SM-2 间隔复习、AI 精读与文档上下文对话；内置 EPUB / MOBI / AZW3 / FB2 / CBZ / PDF / TXT / Markdown 全格式阅读器，支持 AI 双语对照、五色高亮、手写墨迹、书签摘录回跳与书架管理。所有词典本地离线查询，学习与阅读数据全部存放在你自己的思源工作空间内。</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.7.5-blue?style=flat&logo=github&logoColor=white" alt="version 1.7.5">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat&logo=opensourceinitiative&logoColor=white" alt="license MIT">
  <img src="https://img.shields.io/badge/SiYuan-3.7.0%2B-orange?style=flat&logo=siyuan&logoColor=white" alt="SiYuan 3.7.0+">
</p>

<p align="center">
  <a href="https://github.com/LongDarkroom/siyuan-plugin-reword"><img src="https://img.shields.io/badge/项目仓库-GitHub-181717?style=flat&logo=github&logoColor=white" alt="项目仓库"></a>
  <a href="https://ld246.com/article/1787911845417"><img src="https://img.shields.io/badge/词典包获取指南-查看教程-0ea5e9?style=flat&logo=readthedocs&logoColor=white" alt="词典包获取指南"></a>
  <a href="https://space.bilibili.com/39780528"><img src="https://img.shields.io/badge/B%20站-关注我-FB7299?style=flat&logo=bilibili&logoColor=white" alt="B 站"></a>
  <img src="https://img.shields.io/badge/插件交流群-123795105-12B7F5?style=flat&logo=qq&logoColor=white" alt="插件交流群 123795105">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/更新日志-CHANGELOG-6DB33F?style=flat&logo=keepachangelog&logoColor=white" alt="更新日志"></a>
</p>

> [!TIP]
> **English** — REword is a SiYuan plugin for English learners: **offline dictionary lookup, spaced-repetition vocabulary review, AI-powered intensive reading, and a full-featured e-book reader**, all in one workspace.
>
> - **Look up & collect** — Select any English word in your notes to query offline dictionaries (MDX / StarDict), then send it to a built-in SRS review queue with one shortcut.
> - **Read & annotate** — EPUB / MOBI / AZW3 / FB2 / CBZ / PDF / TXT / Markdown reader with bilingual AI translation, highlights, handwriting ink, bookmarks and excerpt back-links into your notes.
> - **AI intensive reading** — Send selected text or a whole document tab to AI for deep, bilingual explanations.
> - **Dashboard** — A built-in workspace panel aggregates your stats: daily heatmap, review due queue, vocabulary mastery breakdown.
> - **Offline & private** — All dictionaries are queried locally; your reading data never leaves the SiYuan workspace.

---

## 最近更新

> 近期重要更新摘要，完整版本记录见 [CHANGELOG](CHANGELOG.md)。

- **待办日历**：把思源待办块变成日历——写「明天 8:00 背单词」即自动排期（截止时间存块属性，不污染正文），月 / 周 / 日视图一览；通过局域网 CalDAV 同步到手机自带日历，**到点由手机提醒**（vivo 原生日历实测可用）。本地 CalDAV 服务可在插件设置里「跟随思源启停 / 手动启停」，随思源一起开关。
- **界面全量英文化**：全插件界面支持 English，约 2200 条界面文案 100% 覆盖；首次启动可选择语言，随时切换。
- **聚合工作台**：组合栏新增工作台 Tab——统计卡（收词 / 复习 / 阅读 / 连续天数）、GitHub 风格 26 周学习热力图、到期复习 Top3、功能入口与掌握度分布，学习状况一屏尽览。
- **主区页签形态**：组合栏是家、页签是放大镜——悬停任意功能 Tab 点 ⧉ 弹出为思源主区文档页签（大空间沉浸、可与笔记并排对照），⇄ 一键收回；组合栏常驻（工作台居首），布局管理仍支持角落停靠。

## 一、英语学习

- **选中即查词** — 在任意文档中划选英文单词，一键查询离线词典，无需联网。
- **离线词典** — 支持 **MDX / StarDict** 格式，可加载你自己的词库（见下方[词典配置](#四词典配置)）。
- **生词本 + 间隔复习** — 框选后快捷键自动收词，自研 SRS 调度（SM-2 简化 + 难度/词频校准）排复习队列。
- **AI 精读** — 把选中文本交给 AI（学习 / 对话两种模式）做深度解析与双语对照。
- **文档即上下文** — 把思源文档页签拖入 AI 对话框，作为精读上下文。
- **批注体系** — 文档批注（思源文档内）与阅读批注（阅读器高亮产生）分开管理，零正文污染。
- **导出** — 批注导出 Markdown、词库导出 CSV。

## 二、电子书阅读器

### 格式与版式

- **多格式** — EPUB / MOBI / AZW3 / FB2 / CBZ / PDF / TXT / Markdown。
- **主题** — 8 套预设（杏仁黄 / 秋叶褐 / 青草绿 / 海天蓝 / 夜间 / 暗黑 / 赤金 / 默认）+ 自定义文字色、背景色、背景图，并可跟随思源主题自动切换。
- **字体** — 跟随思源 / 自定义导入 / 系统默认 / **分类字体**（衬线 · 无衬线 · 等宽三条独立字体链 + 中文字体）。
- **排版** — 字号、行距、行宽、字重、字距、段距、首行缩进、四边距、页眉页脚、进度样式。
- **阅读模式** — 分页 / 连续滚动，翻页动画（默认 / 滑动 / 卷页），专注模式（滚动时高亮当前段落）。
- **PDF 专属** — 单页 / 双页 / 书籍视图，垂直 / 水平滚动，反色，缩放档位与 ⌘/Ctrl + 滚轮连续缩放。

### 阅读辅助

- **双语对照** — 每段正文后注入 AI 译文（兄弟节点方案，零正文污染、卸载无残留；按书缓存、可整书预翻译并显示进度 / ETA）。译文左边缘与英文文本齐平，中英对照更整齐。
  - **译文版本**：直译 / 简洁版（更短、更像学习者笔记）可选。
  - **多引擎**：腾讯 / 有道 / 百度 / Microsoft / LibreTranslate + AI 兜底链（缓存 → 免费引擎 → AI）。
  - **后台运行**：点击后台运行后对话框关闭，阅读器右下角出现「翻译中 N%」浮标，点击可随时重开进度面板。
  - **单段管理**：hover 译文块可「用 AI 重译」或「删除此段译文」（按本书隐藏，重新开启双语即恢复）。
  - **缓存管理**：按书浏览 / 搜索 / 排序，支持导出译文（Markdown）、在阅读器打开、删除缓存。
- **TTS 朗读** — 连续朗读控制条，句子高亮跟随、语速调节、朗读时收词。
- **脚注浮窗** — 点击或悬停脚注直接预览内容，不跳转打断阅读。
- **目录** — 章节跳转 + 已读勾选，进度条带章节刻度。
- **全书搜索** — 关键词逐条定位。

### 标注与沉淀

- **高亮 / 批注** — 五色高亮（明黄 / 翠绿 / 青蓝 / 玫粉 / 紫罗兰）+ 下划线 / 波浪线，可写批注、打标签。
- **手写批注** — Apple Pencil / 触控墨迹标注（压感、倾斜）。
- **书签** — 🔖 一键在当前页加书签，抽屉内可跳转 / 删除，随书持久化。
- **摘录汇总** — 📑 抽屉按时间汇总本书全部摘录，可跳转原文、删除、**批量导出 Markdown**。
- **摘录回跳** — 摘录插入思源文档时自动带上 `siyuan://plugins/...` 深链，在笔记里点「回原文」即打开该书并定位到原句。
- **笔记模板** — 支持 `{{text}} {{note}} {{bookTitle}} {{author}} {{chapter}} {{cfi}} {{link}} {{date}}` 变量，可自定义发送模板与插入位置（剪贴板 / 当前文档 / 指定笔记本）。

## 三、书架与管理

- **书架** — 网格 / 列表双视图，封面、进度、阅读状态（想读 / 在读 / 读完）、评分、收藏、标签、丛书、自定义分组，搜索与多维筛选。
- **阅读统计** — 累计时长、连续阅读天数、**历史最长连续**、在读 / 读完数量、平均评分、近一年热力图（可切近 7 天 / 30 天 / 今年 / 近一年）、月度分布、Top 8 阅读时长排行。
- **知识图谱** — 按标签 / 分组 / 作者关联成图，节点大小反映标注量，带入场与选中动效。
- **OPDS** — 连接 OPDS 书库，搜索并直接下载导入书架。

## 四、词典配置

> 本插件 **不内置任何词典数据**，需要你自行准备离线词典包（MDX 或 StarDict 格式）后才能查词。

👉 详细的词典包获取与配置方式：[如何获取 / 配置 RE word 词典包](https://ld246.com/article/1787911845417)

**两种导入方式**

1. **导入对话框（推荐）** — 下载 `.mdx` 原包 → 打开词典管理 → 点「导入」→ 选择文件，插件自动写入 `dict/` 目录并建索引启用。
2. **手动放置** — 把 `.mdx`（或 StarDict 的 `.ifo` / `.idx` / `.dict` / `.dict.dz`）直接放入插件目录 `data/plugins/siyuan-plugin-reword/dict/`，然后在对话框点「刷新」重载。

> ⚠️ 版权提示：请仅使用你拥有合法授权的词典包（如公版词库、自整理词表），勿分发受版权保护的商业词典。

## 五、阅读器快捷键

| 按键 | 功能 | 按键 | 功能 |
|---|---|---|---|
| `←` / `→` | 上一页 / 下一页 | `⌘/Ctrl + B` | 添加 / 移除书签 |
| `↑` / `↓` / `Space` | 上一段 / 下一段 | `⌘/Ctrl + F` / `F3` | 搜索全书 |
| `Home` / `End` | 跳到开头 / 结尾 | `⌘/Ctrl + =` / `-` | 字号 + / −（PDF：缩放） |
| `PageUp` / `PageDown` | 翻页 | `⌘/Ctrl + 0 / 1 / 2 / 3` | PDF 缩放档位 |
| `F11` | 全屏 | `Esc` | 关闭浮窗 / 退出全屏 |

## 六、安装

思源笔记 → **集市** → 搜索 `RE word` → 安装。或手动下载 release 包解压到 `data/plugins/siyuan-plugin-reword/`。

## 七、快速上手

1. 安装插件并配置至少一个离线词典（见[词典配置](#四词典配置)）。
2. 在任意文档中划选英文单词即可查词；用快捷键把生词加入复习计划。
3. 打开书架导入电子书，边读边标注；需要深度理解时，选中段落交给 AI 精读。
4. 摘录会自动带上回跳深链，回到笔记后随时点回原文。

## 八、相关链接

- 项目仓库：<https://github.com/LongDarkroom/siyuan-plugin-reword>
- 词典包获取指南：<https://ld246.com/article/1787911845417>
- B 站：<https://space.bilibili.com/39780528>（如果需要反馈，可以在 B 站给我私信）
- 插件交流群：QQ 群 `123795105`

## 九、许可

GPL-3.0

## 十、赞赏

如果这个插件对你的英语学习有所帮助，欢迎请我喝杯咖啡 ☕

![支付宝赞赏码](https://cdn.jsdelivr.net/gh/LongDarkroom/siyuan-plugin-reword@v1.4.3/appreciate.jpg)
