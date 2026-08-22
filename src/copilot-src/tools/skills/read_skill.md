获取指定自定义 Skill 的完整执行指令和工作流文档。
        
## 何时使用
- 当发现有符合当前任务的自定义 Skill 且需要读取其详细执行步骤时调用。
- 只有在系统提示词的 "=== 自定义 Skill ===" 列表中列出的 Skill 才可以被读取。
- 支持读取 Skill 文件夹内的子文件（例如传入 "skillId/subfolder/file.md"）。
- 如果 Skill 使用思源块作为内容，本工具会自动把 skill.md 中保存的块 ID 展开为对应的 Markdown 内容。

## 参数
- skillId: 要读取的 Skill 的标识符，或是 Skill 文件夹下某个子文件的相对路径（如 "my-skill" 或 "my-skill/references/guide.md"）
