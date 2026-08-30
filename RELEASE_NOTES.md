# RE word 词汇助手 v1.4.0 发布说明

> SiYuan（思源笔记）插件：离线词典查词 + 词库复习 + AI 精读 + EPUB/PDF 阅读器，面向英语阅读与词汇积累。

## 本次更新重点：TTS 朗读 + 移动端适配 + PDF 阅读与缩放

> 这是自 v1.3.3 以来最大的一次功能更新，涵盖四大方向：
> **TTS 连续朗读**（参考 Readest）、**移动端基础适配**（iPad/iPhone/Android）、
> **PDF 阅读支持**（导入/打开/翻页/目录/缩放）、以及**阅读器白屏修复**。

---

### 1. TTS 连续朗读（新增）

- 工具栏新增 **🔊 朗读按钮**，支持连续朗读当前页面文本。
- **三后端可选**：
  - **Edge TTS（推荐）**：微软在线语音合成，音质自然、免费、支持中英文混合，
    内置多种发音人（ Xiaoyi / Yunxi / Jenny 等），WebSocket 流式播放。
  - **系统 TTS**：调用操作系统内置语音合成（macOS/iOS/Windows 均可用）。
  - **有道 TTS**：有道翻译接口（需配置 API）。
- **交互设计**：
  - 播放中按 `Space` = 暂停/继续；停止时按 `Space` = 翻页。
  - 自动高亮当前朗读句子（临时 `<span>` 标记，停止即卸载，零正文污染）。
  - 支持调节语速（0.5x–2.0x）。
- 设置位置：阅读器 → ⚙ 设置 → **TTS 朗读**

### 2. 移动端适配 Phase 0–1（新增）

- **Phase 0（基础设施）**：
  - `plugin.json` 新增 `mobile` / `browser-mobile` 前端声明——此前插件在移动端根本不加载。
  - 新建 `src/core/env.ts` 统一环境检测：`isMobile()` / `isTouchDevice()` / `isIOS()` / `isAndroid()` / `getDeviceClass()`。
  - 全插件判断移动端必须走此工具模块，禁止手写 `getFrontend().endsWith('mobile')`。
- **Phase 1（触摸导航核心体验）**：
  - 阅读器支持**触摸翻页**（左半屏下一页 / 右半屏上一页）。
  - 支持**触控板双指捏合缩放**（实时调整字号）。
  - 触摸选择文本（长按选词 + 拖动扩展选区）。
  - 双击/双指轻触翻页。

> 后续 Phase 2–6（取词触屏化 / Apple Pencil 标注 / TTS 移动端 / 设置响应式 / 平台差异）规划中。

### 3. PDF 阅读支持（新增）

- **基础能力打通**：PDF 导入书架（显示封面+元数据）、打开阅读、翻页、目录导航、进度记忆。
- **⌘/Ctrl + 滚轮缩放**（macOS 原生语义）：
  - 分页模式与滚动（scrolled）模式**均支持**缩放（两种模式的缩放公式不同，已分别适配）。
  - 以光标为锚点缩放（放大后画面不"跳走"）；滚动模式锚定视口顶部更稳。
  - **触控板双指捏合**自动走同一路径（macOS 合成为 `ctrlKey` wheel）。
  - **Mac Mouse Fix 侧边键兼容**：若侧边键映射为 Ctrl+滚轮，直接可用。
  - 手感优化：rAF 累积节流（每帧只缩放一次）+ 单事件幅度截断 + 灵敏度调优（约 ±10%/格）。
- **缩放工具栏**：放大 / 缩小 / 重置 / 适应宽度 / 适应页面 / 百分比显示。
- 发布包已包含 `pdf.worker.mjs`（PDF.js 运行时依赖），集市安装后桌面端 PDF 解析正常。

### 4. 阅读器白屏修复（重要 Bug 修复）

- **现象**：REword 阅读 Tab 整页白屏，工具栏在但内容区不渲染，无错误提示。
- **根因**：`ReaderView.svelte` 中 `inkStrokes` / `currentPageStrokes` 两个 Svelte store **漏了 import**。
  - Svelte 4 编译 `$store` 时在组件实例化**顶部**注入 `component_subscribe`（立即求值实参）
    → 漏 import 即 `ReferenceError` → **整棵子树不渲染** → 白屏。
  - 崩在 `onMount` 之前，try/catch 无机会执行 → **无任何错误提示**。
  - ⚠️ `tsc --noEmit` 查不到此问题（tsc 只检查 `.ts`，不检查 Svelte 的 `$store` 编译产物）。
- **修复**：补全 import；同时修了一个**隐藏更深的缩放 bug**：
  - foliate 最终缩放 = `zoom` × (`scale-factor` / 100)，旧代码把同一个值**同时写进两个属性**
  → 实际缩放 = scale²（显示 200% 实际 400%）；且切回 fit 模式时 scale-factor 残留不复位。
  - 现在分页模式只写 `zoom`、滚动模式只写 `scale-factor`，互不干扰。

### 5. 其他改进

- **赞助渠道**：新增爱发电链接（设置面板「插件 → 赞助渠道」可查看）。
- **稳定性**：延续 v1.3.3 的可观测性改造，空捕获登记覆盖全库。
- **测试**：新增 PDF 相关测试 20+ 条（缩放/移动端/触摸/worker/书架），全量 112 个测试文件基线 97 pass / 15 fail（失败项均为预存，零回归）。

---

## v1.4.3 — README 末尾新增赞赏码图片（版本号推进）

- 仅新增 README 赞赏码图片（`appreciate.jpg`）与版本号推进，无功能改动。

---

## v1.4.4 — 双语翻译透明化 + 单段补救 + Windows 词典加载加固 + 缓存去重

### 新增：双语翻译"透明化"（来源可见 + 单段补救）

- **来源徽标**：每段译文后显示来源标签（缓存 / AI / 微软 / LibreTranslate / 已修正 / 失败），按来源着色，可在设置中开关「显示来源徽标」。
- **失败可见**：翻译失败的段落明确标记，可一键重试；重试仍失败保留原文不污染。
- **单段补救**（悬浮工具栏 / 行内操作）：
  - **重译**：对当前段重新请求翻译。
  - **修正**：直接编辑译文并提交，写入「用户修正库」，来源徽标显示「已修正」，优先级高于 AI 缓存。
  - **隐藏**：隐藏某段译文（同时清掉该段缓存与修正），满足纯净阅读。
  - **删除**：删除该段修正记录。
- **用户修正库独立**：修正数据按 `hash(text)` 一源一修正，独立于 AI 翻译缓存，`clear()` 缓存时不被误删。

### 新增：段落级"重新翻译为简洁版"

- 在每段译文右上角放一个 **🔄 简洁版** 按钮（hover 时显形），点击后用更简短的口语化中文重译该段；再点还原默认译文。
- **缓存隔离**：default / concise 各自独立池，下次翻页回来直接秒出，不重复请求。
- **并发安全**：相同原文 in-flight 只跑一次（用户连点不重复请求）。
- **失败回退**：AI 返回空 / 抛错时原译文保留，按钮文案与 `data-mode` 不切换。
- **可扩展**：缓存层已按 mode 路由，未来可加 `literal` / `literary` 等风格。

### 修复：Windows 集市安装后词典全部 MISSING

- 根因：`isPluginRoot` 只认 `package.json` 作为插件身份证明，但 SiYuan 集市发布包只含 `plugin.json`（思源官方契约），导致 Windows 集市安装用户所有候选路径第一关就被卡掉，兜底到 `electron.asar/renderer`，dict 路径全部拼错。
- 修复：身份证明改为 **plugin.json 优先 + package.json 兜底**双证据；额外增加 **asar 路径守卫**（`/electron\.asar/i` 大小写不敏感过滤），词典加载入口对 asar / 空路径直接返回清晰中文报错，不再把 asar 当 MDX 包解析；便携版 `workspace.json` 探测路径拓宽。
- 新增 15 个单测覆盖 4 个维度（plugin.json / package.json / dict 目录 / 内置词典）的所有组合。
- 之前按"临时方案"手动补了 `package.json` 的用户升级后无需清理（双命中仍正常）。

### 修复：同一本书多份缓存翻译 / 点双语仍重译

- 根因：旧 `bookId` 为 `b${Date.now()}${random}` 随机生成，删书重导 / 换入口即生成新 id，导致缓存对不上、看似"重译"，并积累多份孤儿缓存。
- 修复：新增 `book-fingerprint.ts` **内容指纹**（基于 identifier / title+author / size / format 的 FNV-1a），同实体书永远同 id；`importBook` 改用指纹 id + 指纹级去重；`cache.ts` 新增 `cleanOrphanCaches`，双语缓存面板新增「清理无效缓存」按钮，一键回收历史孤儿缓存。

### 内部

- 新增 `src/core/plugin-path.ts` 纯函数模块，`isPluginRootWithFs(dir, pluginName, fsOps?)` 可注入 mock fs 测全部组合。
- `src/translate/cache.ts` 新增 `TranslationMode` 路由，hash salt 拼 mode，同段多版本互不污染；旧版单 mode JSON 自动回填到 `{default, concise}` 形态；修正库 `fix*` 接口按 `hash(text)` 一源一修正。
- `src/reader/bilingual.ts` 重构译文 div：内含 `<span class="reword-bilingual-text">` + 来源徽标 + 兄弟节点按钮；doc 级事件委托，`__rewordConciseBound` flag 防重绑；`onViewLoad` 重绑以兼容 foliate 翻页重建 Document。
- `src/reader/reader-style.ts` 新增来源徽标与简洁版按钮样式，prefers-color-scheme 深色主题自动适配。

### 测试

- 新增 `test/bilingual-concise.test.mjs`（18 条）+ `test/resolve-plugin-path.test.mjs`（15 条）+ `test/bilingual-rescue.test.mjs`（8 条）+ `test/book-fingerprint.test.mjs`（8 条）；现有 `translate-ai-batch` / `bilingual-pretranslate` 等全部回归通过。
- 全量基线：1900+ 测试 0 失败，0 type error。

---

## 功能概览（历史积累）

- **离线词典查词**：基于 MDX / StarDict 离线词典（NCECD、ECD2 等），无需联网，支持词形还原。
- **悬浮取词（Option + 悬停）**：阅读器中按住 Option 悬停英文单词弹出富词卡。
- **划词工具栏**：选中文本后一键「词典 / 翻译 / 朗读 / 批注 / 复制 / 发送 AI」。
- **词卡「加入词库」★**：一键收藏 / 移出词库，支持复习。
- **AI 精读面板**：学习 / 对话双模式，支持拖入思源文档页签作上下文。
- **EPUB / PDF 阅读器**：标注 / 批注（零正文污染）、目录、书签、双语对照、字体控制。
- **TTS 朗读**（v1.4.0）：Edge TTS / 系统 TTS / 有道 TTS，连续朗读 + 句子高亮。
- **移动端适配**（v1.4.0）：触摸翻页 / 捏合缩放 / 触摸选词（Phase 0–1 完成）。
- **分类字体系统**：衬线 / 无衬线 / 等宽三条独立字体链。
- **本书前提上下文**：为每本书写背景资料注入 AI 提示词，专有名词一致。
- **翻译缓存**：按书落盘、可调预取、按页统计、支持多书切换。
- **PDF 缩放**（v1.4.0）：⌘/Ctrl+滚轮 / 触控板捏合 / Mac Mouse Fix 侧边键，分页/滚动双模式。

## 安装

1. 在 SiYuan 集市搜索 `RE word` 或 `siyuan-plugin-reword` 安装 / 更新；
2. 或下载本 Release 的 `package.zip`，在「设置 → 集市 → 已下载 → 导入」中手动安装。

## 配置建议

- **词典**：插件设置中导入 MDX / StarDict 原包。
- **AI 精读**：「AI 设置」中填入 API Key 与模型。
- **TTS 朗读**：推荐 Edge TTS（免费、音质好），在 TTS 设置中选择发音人与语速。
- **PDF 缩放**：macOS 上按住 ⌘ + 滚轮（或触控板双指捏合）即可缩放。
- **双语阅读**：建议填写「本书上下文」，翻译一致性明显提升。

## 技术栈

TypeScript + Svelte + SiYuan API + foliate-js（EPUB/PDF 渲染）+ PDF.js。

## 许可证

GPL-3.0
