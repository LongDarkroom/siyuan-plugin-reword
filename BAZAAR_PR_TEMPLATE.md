# 上架 SiYuan 集市（bazaar）PR 模板

> 本文件仅用于你向 `siyuan-note/bazaar` 提 PR 时参考，不是插件仓库内容。

## 第 1 步：在本插件仓库发 GitHub Release

1. 确保代码已 push 到 `https://github.com/LongDarkroom/siyuan-plugin-reword`（main 分支，含本次提交）。
2. 本地已生成 `package.zip`（`npm run make`）。
3. 在 GitHub 新建 Release：
   - **Tag**：`v1.0.0`（必须与 `plugin.json` 的 `version` 完全一致）
   - **Title**：`v1.0.0`
   - **附件**：上传 `package.zip`
   - **Description**：可直接复制 `RELEASE_NOTES.md` 内容

## 第 2 步：Fork 并提 PR 到索引库

1. Fork `https://github.com/siyuan-note/bazaar`
2. 编辑仓库根目录的 **`plugins.txt`**（每行一条 `owner/repo`）
3. 在末尾新增一行：

```
LongDarkroom/siyuan-plugin-reword
```

4. 开 PR 到 `siyuan-note/bazaar` 的 `main` 分支。

### PR 标题建议

```
添加插件：RE word 词汇助手（siyuan-plugin-reword）
```

### PR 描述建议

```
## 插件信息
- 名称：RE word 词汇助手
- 仓库：LongDarkroom/siyuan-plugin-reword
- 版本：v1.0.0
- 最低思源版本：3.7.0
- 前端：desktop / browser-desktop

## 功能简介
离线词典查词（自建 MDX/StarDict）、Option 悬浮取词、词库复习、AI 精读（学习/对话双模式，支持拖入思源文档作上下文）、阅读 Tab ⌘E 最近文档、标注高亮。

## 合规性说明
- 插件仅读写自身私有目录（data/plugins/siyuan-plugin-reword/ 下子目录），不触碰用户笔记数据，符合集市文件读写规范。
- 图标 160×160（≤20KB）、预览图 1024×768（≤200KB）已就位。
- package.zip 体积约 638KB，远低于 10MB 建议上限。
```

## 第 3 步：等待

- PR Check 自动校验（Release 存在、必需文件齐全、metadata 完整）通过 + 维护者 review 合并后，集市索引数分钟内更新。
- 后续更新：仅需在本插件仓库发新 Release（升 version + 重新 make），集市每小时自动拉取。
