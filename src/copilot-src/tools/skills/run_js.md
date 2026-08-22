在浏览器环境中运行 JavaScript 代码并返回执行结果。需要进行复杂的计算或数据处理，或处理其他工具返回的输出时使用。支持通过 tool_input 参数直接运行其他工具，并将工具执行结果作为 input 传入 JavaScript 代码处理，可以大大节省token。


## 可用 API
代码在浏览器环境中运行，可以使用：
- 所有 JavaScript 内置对象（Math, Date, JSON, Array, Object 等）
- console.log() 用于调试（输出会包含在结果中）
- 返回最终结果使用 return 语句
- window 对象，用于访问当前思源/浏览器环境
- **input 变量：当使用 tool_input 时，工具执行结果会作为 input 变量传入（字符串类型）**

## tool_input 参数说明
tool_input 允许你在 run_js 内部直接调用其他工具，将工具的执行结果转为字符串后作为 input 变量传入 JavaScript 代码。

**支持的 tool_input 类型：**
- `sql`: 执行 SQL 查询，参数为 { query: "SQL语句" }
- `get_block_content`: 获取块内容，参数为 { id: "块ID", format: "markdown" | "kramdown" }
- `fetch`: 获取网页内容，参数为 { url: "网址", useWebView?: boolean }
- `get_doc_tree`: 获取文档树，参数为 { notebook: "笔记本ID", path?: "/" }

**注意：**
- 如果同时提供 tool_input 和 input，tool_input 的执行结果会覆盖 input
- 工具执行结果会被 JSON.stringify 转为字符串传入 input

## 注意事项
- 代码必须使用 return 语句返回结果
- **支持使用 async/await 进行异步操作**
- 可以通过 window 访问浏览器环境和思源环境能力；优先使用专用工具完成常规思源操作
- 代码在沙箱中运行，超时时间为 5 秒

## 使用示例

### 基本使用（无输入）
```javascript
// 计算数学表达式
run_js({
  code: "return Math.sqrt(16) + Math.pow(2, 3);"
})

// 处理文本
run_js({
  code: "const text = 'Hello World'; return text.toUpperCase().split(' ').join('-');"
})
```

### 使用 tool_input 直接处理其他工具的输出（推荐用于大数据量处理）

**示例 1：处理 SQL 查询结果，只返回统计信息**
```javascript
// 查询大量数据，但在 JS 中处理只返回统计结果，避免大量数据返回给 AI
run_js({
  code: "const data = JSON.parse(input); return { count: data.length, firstId: data[0]?.id, lastId: data[data.length-1]?.id };",
  tool_input: {
    tool: "sql",
    params: { query: "SELECT * FROM blocks WHERE type='d' LIMIT 1000" }
  }
})
// 只返回统计信息，而不是 1000 条完整记录
```

**示例 2：获取块内容并提取特定信息**
```javascript
run_js({
  code: "const lines = input.split('\n'); const titles = lines.filter(l => l.startsWith('#')); return '包含 ' + titles.length + ' 个标题';",
  tool_input: {
    tool: "get_block_content",
    params: { id: "20210104091228-d0rzbmm", format: "markdown" }
  }
})
```

**示例 3：获取文档树并统计结构信息**
```javascript
run_js({
  code: "const tree = JSON.parse(input); function countDocs(nodes) { return nodes.reduce((sum, n) => sum + 1 + (n.children ? countDocs(n.children) : 0), 0); } return { docCount: countDocs(tree), topLevel: tree.map(n => n.name) };",
  tool_input: {
    tool: "get_doc_tree",
    params: { notebook: "20210808180117-6v0mkxr", path: "/" }
  }
})
```


```

## 返回值
返回代码执行的结果（必须是 return 语句返回的值）
