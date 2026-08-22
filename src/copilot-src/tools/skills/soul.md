AI的记忆读写工具。

## 何时使用
- 当用户让AI记住某些信息、要求、偏好设置的时候
- 当用户需要让AI回忆之前的要求时
- 当用户要求查看或修改已记录的记忆时

## 记录格式规范（重要）
**每个用户要求必须使用二级标题（##）作为独立条目进行记录**，格式如下：

```
## 要求标题（简明概括）

具体要求内容的详细描述

```


## 主要操作类型

### 1. append - 追加记忆
在 SOUL 文档末尾追加新的记忆条目。

**参数:**
- operation: "append"
- content: 要追加的 Markdown 内容（必须遵循上述格式规范，使用二级标题）
- parentId: (可选)父块ID，如果提供则作为该块的子块追加

**示例:**
```json
{
  "operation": "append",
  "content": "## 代码风格偏好

用户要求所有代码块都必须包含详细注释，解释每行代码的作用。",
  "parentId": "20260312120000-xxxxxxxx"
}
```

### 2. update - 更新记忆
更新 SOUL 文档中已有的记忆条目。

**参数:**
- operation: "update"
- blockId: 要更新的块ID
- content: 新的 Markdown 内容（保持二级标题格式）

**示例:**
```json
{
  "operation": "update",
  "blockId": "20260312120000-xxxxxxxx",
  "content": "## 代码风格偏好（已更新）

用户要求所有代码块都必须包含详细注释，并且注释使用中文。"
}
```

### 3. delete - 删除记忆
删除 SOUL 文档中的指定记忆条目。

**参数:**
- operation: "delete"
- blockId: 要删除的块ID

**示例:**
```json
{
  "operation": "delete",
  "blockId": "20260312120000-xxxxxxxx"
}
```

### 4. sql - 查询记忆
使用 SQL 查询 SOUL 文档中的内容，可用于查找特定要求的块ID。

**参数:**
- operation: "sql"
- query: SQL 查询语句（自动限制在 SOUL 文档范围内）

**示例:**
```json
{
  "operation": "sql",
  "query": "SELECT * FROM blocks WHERE content LIKE '%代码风格%' LIMIT 10"
}
```

### 5. insert - 插入记忆
在 SOUL 文档的指定位置插入新记忆条目。

**参数:**
- operation: "insert"
- content: 要插入的 Markdown 内容（必须遵循二级标题格式）
- previousId: (可选)前一个块ID，在此块之后插入
- nextId: (可选)后一个块ID，在此块之前插入
- parentId: (可选)父块ID，作为该块的子块插入（与 previousId/nextId 互斥）

**注意:** 
- previousId、nextId、parentId 至少需要提供一个
- 所有涉及的块ID都必须在 SOUL 文档内

**示例:**
```json
// 在某个块之后插入新记忆
{
  "operation": "insert",
  "content": "## 输出语言偏好

用户要求所有回复使用中文，除非特别要求使用英文。",
  "previousId": "20260312120000-xxxxxxxx"
}
```

### 6. getDoc - 获取完整文档
获取 SOUL 文档的完整 Markdown 内容，用于回顾所有记忆。

**参数:**
- operation: "getDoc"

**返回:**
- 返回 SOUL 文档的完整 Markdown 内容

**示例:**
```json
{
  "operation": "getDoc"
}
```

## 重要限制
- **所有操作仅限于用户设置的 SOUL 文档内**
- 如果用户未设置 SOUL 文档ID，工具会返回错误提示
- 不能操作 SOUL 文档范围外的任何块
- 查询结果会自动过滤，只返回 SOUL 文档内的块

## 使用建议
1. **记录新要求时**：使用 append 操作，确保使用二级标题格式
2. **修改已有要求时**：先用 sql 查询找到对应块ID，再用 update 操作
3. **查看所有记忆时**：使用 getDoc 获取完整文档
4. **建议先查询再操作**：使用 sql 操作查询已有内容，了解现有记忆结构

## 注意事项
- 在操作前，SOUL 工具会自动验证块ID是否属于 SOUL 文档
- 如果尝试操作非 SOUL 文档的块，会返回权限错误
- 每个记忆条目必须是独立的二级标题，便于后续查找和更新
