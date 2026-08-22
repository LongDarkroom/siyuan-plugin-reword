在本地 Python 解释器中运行 Python 代码并返回执行结果。

## 何时使用
- 需要使用 Python 进行数据分析、科学计算
- 需要使用 Python 的丰富标准库和第三方库
- 需要进行文件操作、文本处理、正则表达式
- 需要使用 NumPy、Pandas 等数据处理库（如果已安装）
- JavaScript 难以完成的复杂计算或算法

## 可用功能
- Python 标准库（math, json, re, datetime, collections, itertools 等）
- print() 输出会捕获并显示
- 将结果赋值给 _result 变量可以返回结果值
- **自动安装依赖**：如果代码导入的第三方库未安装，会自动尝试 pip 安装

## 注意事项
- 需要先设置 Python 解释器路径（在设置中配置）
- 代码执行超时时间为 30 秒，pip 安装超时为 120 秒
- **不要在顶层使用 return 语句**，Python 脚本中 return 只能在函数内使用
- 如需返回结果，请将结果赋值给 _result 变量
- 无法访问网络（除非使用特定工具）
- 无法访问思源笔记 API（请使用专用工具）
- 每次执行都是独立的环境，变量不会保留
- 自动安装仅尝试一次，如果安装后仍失败则返回错误

## 使用示例

```python
# 数学计算
run_python({
  code: "import math; _result = math.sqrt(16) + math.pow(2, 3)"
})

# 列表推导式
run_python({
  code: "_result = [x**2 for x in range(1, 6) if x % 2 == 0]"
})

# 字符串处理
run_python({
  code: "text = 'Hello World'; _result = '-'.join(text.upper().split())"
})

# 日期处理
run_python({
  code: "from datetime import datetime, timedelta; _result = (datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')"
})

# JSON 处理
run_python({
  code: "import json; data = {'a': 1, 'b': 2}; _result = json.dumps(data, indent=2)"
})

# 正则表达式
run_python({
  code: "import re; text = 'Contact us at test@example.com'; _result = re.findall(r'[w.-]+@[w.-]+', text)"
})
```

## 返回值
返回代码执行的结果（_result 变量的值）
