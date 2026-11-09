# REword 阅读器字体兼容 —— Readest 方案调研与落地设计

> 2026-09-29 · 依据 Readest 开源源码（apps/readest-app/src/styles/fonts.ts、utils/font.ts、utils/style.ts、services/constants.ts、services/transformers/*）逐文件调研。
> 背景：数字宽度问题（0.6em 字形）已修复；本文把「字体兼容」一次补齐到位。

---

## 一、Readest 的字体兼容设计全景（7 项）

### 1. 中文泛型字体族别名映射 ⭐（中书最大痛点）
书里常写 `font-family: "Kaiti"` / `"FangSong"` / `"Heiti"`，但系统里字体叫 `楷体` / `SimHei` / `华文楷体`——名字对不上 → 整段回落默认字体。
Readest 的做法：注入 4 条**别名 @font-face**，把泛型名映射到 local() 系统候选链 + 在线字体兜底：

```
@font-face { font-family: "Kaiti";
  src: local("Kai"), local("KaiTi"), local("AR PL UKai"), local("LXGW WenKai GB Screen"), url(在线woff2) … }
```

覆盖：**FangSong**（仿宋：Fang Song/FangSong/Noto Serif CJK…）、**Kaiti**（楷：Kai/KaiTi/AR PL UKai/霞鹜屏显…）、**Heiti**（黑：SimHei/文泉驿正黑/思源黑体…）、**XiHeiti**（细黑：苹方/微软雅黑/雅黑…）。

### 2. 三链 CSS 变量 + 零特异性覆盖开关 ⭐⭐（覆盖/尊重的优雅解法）
```css
html { --serif: "用户衬线", …CJK预设…, "MiSans L3", serif; --sans-serif: …; --monospace: …; }
/* 关闭「覆盖书籍字体」：零特异性 —— 书的任何 font-family 都赢 */
:where(html) { font-family: var(--serif); }
/* 开启：全局强制，但用 revert 保留书内局部字体 */
html body { font-family: var(--serif) !important; }
body *:not(pre, code, kbd) { font-family: revert !important; }
```
**revert 的精妙**：书对标题/引用单独声明的 font-family 在元素自己的规则里仍然生效（revert 回到作者级联），只有「没写 font-family 的元素」被压平到正文栈——既全局统一又不毁书内设计。
每条链尾必带 generic（serif/sans-serif/monospace）；全链再垫 `MiSans L3` 兜底。

### 3. code 字体独立通道
`pre/code/kbd` 单独一条规则（关=零特异性让书的代码字体赢；开=!important），并排除出 revert 范围；`font-variant-ligatures: none`（防连字破坏代码对齐）。

### 4. 老式 HTML 字号标签映射
`font[size="1".."7"]` → 按 min/font-size 比例映射（旧书兼容）。

### 5. 内置 Web 字体库（可选挂载）
- Latin（Google Fonts）：Bitter、Literata、Merriweather、Open Sans、Roboto(Slab)、Vollkorn、PT Sans/Serif、Fira Code；
- CJK（**仅 CJK 环境才挂载**，省流量）：霞鹜文楷屏显 GB/TC、Noto Sans SC/TC、Noto Serif JP、MiSans L3、自托管辉文明朝/金华老宋/思源宋/关楷清华。
- 预设列表与 web 字体严格一致（选了没装的字体自动走 web 版）。

### 6. 自定义字体导入的元数据解析 ⭐
导入 TTF/OTF 时**直接解析字体二进制表**：name 表（按用户语言优先级取真实 family 名，含 Typographic Family）、OS/2（usWeightClass→CSS weight）、fvar（可变字体识别）、fsSelection+风格名（italic/oblique 推断）。生成的 @font-face 带 font-weight/font-style/variable 标记 → 多字重字体家族正确渲染。

### 7. 书内样式重写（构建期 transformer，逐章 HTML）
- 居中保护：`text-align:center`+`text-indent:0` 同块 → 都加 ！important（防插件规则压掉居中标题）；
- nowrap 裁剪：`white-space:nowrap` 无 overflow → 补 `overflow: clip`；
- `page-break-after:always` 补 margin；duokan-bleed 出血页兼容；固定版式全部跳过；
- **语言 transformer**：按内容检测语言给 `<html>` 补 `lang/dir`（RTL 由内容检测决定，不盲信元数据——正是我们踩过的 RTL 误标问题的另一条思路）。

---

## 二、REword 现状对照

| 能力 | Readest | REword 现状 | 差距 |
|---|---|---|---|
| 中文字体族别名 | ✅ 4 条 @font-face | ❌ 无（书内写 Kaiti 等名字直接回落正文栈） | **缺** |
| 覆盖开关姿势 | ✅ :where 零特异性 + revert | ⚠️ publisherFontOverrideStyles 用高特异性 !important 全压 | 部分缺 |
| code 独立链 | ✅ | ⚠️ 有等宽链变量，无独立覆盖通道 | 部分 |
| font[size] 映射 | ✅ | ❌ | 缺 |
| Web 字体库 | ✅（云端挂载） | ❌（本机 local + 自定义导入） | 需拍板 |
| 导入字体元数据解析 | ✅ 解析二进制 | ⚠️ 只取文件名 | **缺** |
| 数字字形修复 | —（不用文楷所以无此问题） | ✅ 已做（RW Digit Fix） | 已完成 |
| 书语言→默认排版 | ✅ | ⚠️ 有书类型（book/pdf）分档，无语言检测 | 可选 |
| RTL 内容检测 | ✅ language transformer | ⚠️ 手工修书 + 元数据信任 | 可选 |

---

## 三、落地设计（分三档，待拍板）

### P0 一次到位（纯 CSS/小改，无新依赖）
1. **中文字体族别名 @font-face**（新 `cjkAliasFontFaces()`）：仿 Readest 覆盖 `Kaiti/KaiTi/FangSong/FangSong_GB2312/SimHei/Heiti/SimSun/STKaiti/STSong/STFangsong/XiHeiti` 等书内高频名 → local() 候选链（楷体/华文楷体/霞鹜文楷、仿宋、黑体、宋体、苹方/雅黑）。挂进 buildReaderStyles 的 fontCss 段。**不做在线兜底**（离线优先；本机没有就回落正文栈，无害）。
2. **覆盖开关改造**：`publisherFontOverrideStyles` 改为 Readest 双态——关：`:where(html){font-family:var(正文链)}` 零特异性；开：`html body !important` + `body *:not(pre,code,kbd){font-family:revert!important}`（保留书内局部字体，压平继承混乱）。
3. **code 通道**：`pre/code/kbd` 独立规则接 `--reword-monospace` 链 + `font-variant-ligatures:none`，并从 revert 排除中。
4. **font[size] 映射**：7 档直接抄。

### P1（中等工作量，直接受益）
5. **导入字体元数据解析**：移植 parseFontInfo（纯 DataView 代码，无依赖），REword 自定义字体获得真实 family/weight/style/variable → @font-face 正确标注多字重。

### P2（需拍板，有代价）
6. **内置 Web 字体库**：思源插件是离线环境，Google/自托管 CDN 方案不适用；要内置就得打包字体文件进插件（中文字体全量 8-15MB/款，需子集化），**建议暂缓**——现有「本机字体 + 自定义导入」已够用。
7. **RTL/语言内容检测**：✅ 已落地（2026-09-29）——paginator `getDirection` 内容检测兜底（RTL 字符占比 >30% 且全书无方向声明时判定并补写 dir）+ 键盘翻页按当前节方向联动（view.js / view-light.js 双副本）。与《原子习惯》误标修复互补：误标尊重声明、漏标内容兜底。

---

## 四、验收清单（P0 落地后）
- [ ] 找一本 `font-family:"Kaiti"` 的中文书 → 楷体正确命中（开发者工具确认 computed font-family 命中别名链）；
- [ ] 关闭「覆盖出版商字体」→ 书内嵌字体生效；开启 → 正文统一但书内标题/引用的局部字体仍保留（revert）；
- [ ] 代码块用等宽链、连字关闭；老式 font[size=5] 段落字号正确；
- [ ] 数字宽度修复（上一轮）不回归；《斜杠青年》2007 紧凑。
