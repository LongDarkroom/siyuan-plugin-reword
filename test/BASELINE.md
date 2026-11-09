# 测试基线快照

> 生成时间：2026-10-06 21:31:24（阶段 0 收尾：红灯修复 + 冒烟测试补齐）
> 用途：REword 阅读器独立插件化切分**前后对比**，区分「新引入的回归」与「本来就坏的」。
> 命令：`npm test`（耗时约 3 分 35 秒）

## 当前状态：全绿

```
passed  : 194/194
failed  : 0
ALL GREEN
```

测试构成：194 个文件 = 189 个原有（全绿）+ 5 个新增冒烟测试。

## 新增冒烟测试（阶段 0，39 条真实调用断言）

| 文件 | 条数 | 守护场景 |
|---|---|---|
| `smoke-annotation-store.test.mjs` | 7 | **bridge 核心契约**：批注 upsert 幂等 / getByBook 按 bookId 隔离 / isReading / BookType 筛选 / remove 一致性 / onChange 触发 |
| `smoke-bookshelf-store.test.mjs` | 8 | 书架 load+排序、saveProgress 状态自动流转、addReadingTime 日期分桶、分组 CRUD、removeBook、坏条隔离、load 幂等 |
| `smoke-reader-mode.test.mjs` | 5 | 格式判定入口分流：isPdfFormat / resolveReaderMode / isBookFormat / bookTypeFromFormat / matchBookType |
| `smoke-reader-stats.test.mjs` | 11 | mergeDayMap 跨书合并、总量、连续天数（断签 / 今天未读从昨天起算）、空输入不崩、fmtDuration、heatColor |
| `smoke-ink-persistence.test.mjs` | 8 | 墨迹（跨插件共用数据）：存储键名、rev 结构、往返一致、undefined/null 容错、部分损坏保留好条目、rev 不匹配兼容 |

## ⚠️ 测试 loader 已解锁参数属性模块（重要）

`--experimental-strip-types` 是 strip-only，不支持 TS 参数属性
`constructor(private x: T)`，原本会让 10 个 `src/` 文件无法被 import ——
其中 4 个是阅读器核心：`bookshelf-store` / `reader-settings` / `reader-dock` / `book-primer`。
这正是仓库既有测试只能「grep 源码 + 正则断言」的原因，也是 9 个红灯的根源。

已在 `test/siyuan-stub-loader.mjs` 的 `load()` 加 `lowerTsParameterProperties()` 等价改写，
**生产代码零改动**。现在这些模块可直接 import 做行为测试。

> 切分后新插件务必沿用同一套 loader，否则新插件测试会重蹈「只能 grep 源码」覆辙。

## 构建体积基线

| 项 | 字节 | 说明 |
|---|---|---|
| `dist/index.js` | 2,862,525 | 全部代码 + Svelte 运行时单文件 |
| `dist/style.css` | 506,811 | |

`npm run build` 实测通过：265 modules，4.99 秒，EXIT=0，产物字节数与基线一致。

### 静态资源（切分时必须一起搬走，约 6.2 MB）

| 资源 | 体积 | 归属 |
|---|---|---|
| `pdf.worker.mjs` | 3.1 MB | 新插件 |
| `cmaps/` | 1.6 MB | 新插件 |
| `standard_fonts/` | 800 KB | 新插件 |
| `sql-wasm.wasm` | 660 KB | 新插件（查词） |
| `sql.js-umd.js` | 45 KB | 新插件 |

均由 `scripts/copy-dist.mjs` 拷到插件根目录。漏搬会导致「PDF 打不开 / 词典查不了」且报错难定位。

## 历史：切分前曾有 9 个红灯（已全部修复）

修复前：`180/189`，9 个失败。

| 测试文件 | 根因 |
|---|---|
| `pdf-zoom-toolbar.test.mjs` | 断言写 `title="缩小"`，代码已改 `title={t("缩小（⌘/Ctrl + -）")}`（i18n + 快捷键后缀）；宽松 `[\s\S]*?` 还会误匹配 `export let` 声明区 |
| `reader-epub-style-override.test.mjs` | `p span{font-family:inherit}` 已废弃；padding 改三段式；`fontFaceCss` 不再是输出首段（别名映射前置且用紧凑格式） |
| `reader-style-font-preserve.test.mjs` | 「system 模式无 @font-face」过时（新增 CJK 泛型字体族别名映射，全 local()）；`assert.equal` 被 `"RW Digit Fix"` 前缀打破 |
| `reader-style-priority.test.mjs` | 同上数字字体前缀；`p` 规则注释含 `line-height` 被误判；`paragraphLayoutStyles` 未 import |
| `reader-layout.test.mjs` | 断言旧版四边独立 px（已改 `${side}` 百分比换算）；`label` 已包 `t()` 且新增 `widthPct` |
| `reader-settings-4-sections.test.mjs` | B5 padding 同上；C5 写死 6 个分组（新增「📊 状态栏」） |
| `reader-style-no-footnote-touch.test.mjs` | 断言 CSS 不含 `<img`，但函数注释里就写着 `<img class="height-1em">` 说明文字 |
| `reader-settings-compact.test.mjs` | 写死 6 个分组（实际 7） |
| `tts-backend-fallback.test.mjs` | 真实行为变更：2026-09-16 起 `engine=system` 的 fallback 改为有道在线（Windows 离线语音无声兜底） |

> 共同根因：全是「源码文本断言 / 硬编码期望」跟不上代码演进，生产代码本身正确且更完善。修法一律改测试断言。

## 切分期间的对比用法

与「194/194 全绿」对比：**出现任何失败即为切分引入的回归**（基线已无历史噪音）。

## 单文件调试

```bash
cd /Users/xieyue/Downloads/思源笔记/data/plugins/siyuan-plugin-reword
npm test                                          # 全量
VERBOSE=1 npm test                                # 打印失败文件完整日志
node --experimental-loader=./test/siyuan-stub-loader.mjs \
     --experimental-strip-types test/smoke-bookshelf-store.test.mjs   # 单跑
```
