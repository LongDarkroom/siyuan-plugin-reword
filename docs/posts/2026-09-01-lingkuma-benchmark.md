# LingKuma × RE word 对比分析

> 调研日期:2026-09-01
> LingKuma 版本:1.0.3(本地路径 `/Users/xieyue/Downloads/LingKuma-1.0.0`)
> RE word 版本:v1.5.2

---

## 1. 项目本质

| 维度 | **LingKuma** | **RE word** |
|---|---|---|
| 类型 | 浏览器扩展(Chrome MV3) | 思源笔记插件 |
| 形态 | 装进浏览器,在任意网页上工作 | 装进思源,只在思源内工作 |
| 平台 | Chrome / Edge / Firefox + iOS/Android App + Web | 思源桌面 + 思源移动(部分) |
| 数据存储 | chrome.storage.local + IndexedDB(Dexie)+ 可选 WebDAV/自建 server | 思源 saveData(JSON)+ 思源 SQLite(归档模式) |
| 目标场景 | 任意网页划词查词、YouTube 字幕、EPUB/PDF 网页阅读器 | 思源内置阅读器 + 思源 doc 选词 |
| 用户数 | Chrome 商店已上架(评分 4.x) | 思源集市 |

**最核心的差异**:LingKuma 是「网页寄生」型(无宿主),RE word 是「宿主嵌入」型(寄生在思源里)。LingKuma 自由度更高但要解决通用网页适配;RE word 范围更窄但可以深度集成思源能力(块属性、SQL 查询、笔记图谱)。

---

## 2. 核心功能重叠

| 功能 | LingKuma | RE word |
|---|---|---|
| 划词查词(高亮 + tooltip) | ✅ `a2_hightlight.js` 2916 行 | ✅ `inline-mark.ts` + `annotation-visual.ts` |
| AI 翻译(整句) | ✅ `a3_aiFragen.js` 1368 行 | ✅ `src/translate/` + `ai/orchestrator` |
| 单词本 + 复习 | ✅ `a1_loadKnowWords.js` 已知词;有更重的复习系统 | ✅ `src/review/scheduler.ts` 自研 SM-2 |
| 卡片 / 例句 / 笔记 | ✅ 单词卡片 + 例句记录 + 个人笔记 | ✅ 单词卡片 + 块属性 + 鲸鱼批注 |
| 词频高亮(熟/生词双色) | ✅ 蓝 = 生,黄 = 熟 | ❌ 没做 |
| Bionic Reading(粗体首字母加速阅读) | ✅ 整段渲染 | ❌ 没做(可加) |
| 液体玻璃效果(液态滚动条) | ✅ `options/liquid-group/` | ❌ 没做 |
| 双语对照 | ⚠️ 部分(只对选中词做) | ✅ 整段双语挂译文 |
| 译文缓存 + 多端同步 | ✅ WebDAV / 自建 server | ✅ mem + JSON + 思源 SQLite(译文归档) |
| 离线词典(MDX/StarDict) | ⚠️ 依赖外部 API 为主 | ✅ `js-mdict` + 自带 7 万词频 |
| 批量翻译(整本书) | ⚠️ 没做(只对选中段落) | ✅ 整书预翻译 + 跳页续传 |
| WebDAV 同步 | ✅ 一等公民,默认同步方案 | ❌ 没做(用思源云同步间接实现) |
| 浏览器原生 TTS | ✅ 用 chrome.tts API | ✅ 同样用 Web Speech API |

---

## 3. 架构差异(关键)

### LingKuma:Content Script 注入任意网页

```
[浏览器任意网页]
   ↓ content_script 注入
[a2_hightlight.js · 在页面 DOM 上叠加]
   ↓ chrome.runtime.sendMessage
[background.js · 持久状态 + 缓存]
   ↓ chrome.runtime.sendMessage
[popup / sidebar / options · 三个独立面板]
   ↓ chrome.storage.local
[数据持久化]
   ↓ (可选)WebDAV
[云端]
```

**关键难点**:处理任意网页的 DOM 变化(他们用 MutationObserver 监听,2.9k 行的高亮代码全是踩坑)。所以需要:
- 虚拟 DOM 协调层(他们用 `highlightManager` 对象做)
- 防抖/防重入
- 撤销/重做
- 跨域(YouTube 字幕要解析特殊协议)

### RE word:宿主深度集成

```
[思源笔记主进程]
   ↓ 注册 dock / 命令
[index.ts · 插件主入口]
   ↓ onload 初始化
[BookshelfView + ReaderView · 浮在思源里的 Svelte]
   ↓ foliate-js iframe / 思源块属性
[数据:saveData / 思源 SQL]
```

**关键难点**:foliate-js iframe 跨域消息、批注零污染方案 C、块属性性能、CFI 定位等。

---

## 4. 值得借鉴的 8 个点(按优先级)

### ⭐⭐⭐ 高优先(用户能直接感知的)

#### ① **词频高亮双色**(LingKuma `a2_hightlight.js`)
**现象**:LingKuma 把页面所有生词自动标蓝、熟词自动标黄,用户**不用先选词**就能看见「哪几个词我不认识」。

**RE word 现状**:要划词才会触发高亮,无法"扫一眼看自己哪些词不熟"。

**借鉴方案**:
```
开书 → 后台扫词 → 在 foliate-js 的段落 DOM 上叠加 <span class="known-word"> 或 <span class="unknown-word">
- 蓝色 = 词库里没有的(生词)
- 黄色 = 词库有但未完全掌握的(半熟)
- 无色 = 词库里已掌握的
- hover → tooltip 显示单词 + 音标 + 释义
```

**实施成本**:1-2 天(需要 foliate-js iframe 跨域通信、词频数据复用)

**收益**:阅读效率大幅提升,英语学习闭环更紧

---

#### ② **Bionic Reading**(粗体首字母)
**现象**:LingKuma 把每个单词的前几个字母加粗,眼睛扫读时大脑自动补全,阅读速度提升 30-50%(硅谷研究)。

**RE word 现状**:纯文本渲染,无视觉辅助。

**借鉴方案**:
```javascript
// 每个段落渲染前处理
function bionic(text) {
  return text.split(/\b/).map((word, i) => {
    if (/^\w+$/.test(word) && word.length > 3) {
      const boldLen = Math.ceil(word.length * 0.4);
      return `<b>${word.slice(0, boldLen)}</b>${word.slice(boldLen)}`;
    }
    return word;
  }).join('');
}
```

**实施成本**:0.5 天(纯前端 CSS/SVG 渲染,无 AI 调用)

**收益**:英文阅读速度明显提升,设置面板加个开关

---

#### ③ **WebDAV 同步**(LingKuma 一等公民)
**现象**:LingKuma 默认支持 WebDAV,数据真正属于用户,跨设备 1 分钟同步。

**RE word 现状**:用思源 saveData(JSON)存,跨设备走思源云同步间接带过去,但**译文归档是默认关的**——所以跨设备体验不完整。

**借鉴方案**:
```
设置 → 译文同步 → 三个选项:
  ○ 思源云同步(当前间接方案,需开译文归档)
  ● WebDAV 直连(nextcloud / 坚果云 / 自建)
  ○ 完全本地(隐私优先,跨设备靠手动 export/import)
```

**实施成本**:2-3 天(WebDAV 库选择 + 加密传输 + 冲突合并)

**收益**:无云依赖、数据主权明确、迁移方便

---

### ⭐⭐ 中优先(架构/性能层)

#### ④ **高亮数据结构 / 撤销重做**
LingKuma 的 `highlightManager` 内部用一套类 DOM 协调层,支持:
- 单次操作可撤销(undoStack)
- 跨 iframe/页面同步
- 局部刷新避免全页面重绘

**RE word 现状**:批注每次 upsert 全量 reconcile,无撤销栈。

**借鉴点**:ReaderView 加一个轻量 undo/redo(只对批注改动),体验感大提升。

**实施成本**:1 天

---

#### ⑤ **Liquid Glass 滚动条**
LingKuma `options/liquid-group/index.js` 实现了 100% 跟手的液态玻璃滚动条(惯性 + 物理回弹)。

**RE word 现状**:标准 CSS 滚动,无特殊效果。

**借鉴点**:设置面板的 chip 滚动条 / 书架侧栏的标签条,可以加这个效果,瞬间 macOS 质感。

**实施成本**:0.5 天

**收益**:视觉品质从「能用」到「漂亮」

---

#### ⑥ **多语言界面(i18n)**
LingKuma 有 10 种语言切换:zh_CN / zh_TW / en / de / es / fr / it / ja / ko / pt / ru。

**RE word 现状**:硬编码中文。

**借鉴点**:虽然思源插件用户大多中文,但 EN/JA 切换能拓宽海外用户。**不必做满 10 种,先做 EN + 简中**就够。

**实施成本**:2-3 天(全量字符串提取 + 翻译)

**优先级**:低(思源集市用户本来就接受中文)

---

### ⭐ 低优先(锦上添花)

#### ⑦ **AI 推荐笔记**(LingKuma `a3_aiFragen.js`)
LingKuma 单词卡片上自动生成"AI 推荐笔记"——句法分析 / 文化梗 / 同义词辨析。`a3_aiFragen.js` 1368 行。

**RE word 现状**:AI 精读 dock 可以做类似事,但入口深、流程长。

**借鉴点**:单词卡片的"AI 笔记"按钮 → 一键调用 AI 生成"这个词为什么在这里用 / 有没有歧义"。

**实施成本**:1-2 天(API 已有,只需 UI 入口)

---

#### ⑧ **YouTube 字幕增强**(LingKuma 独有)
LingKuma 解析 YouTube 视频字幕,叠加 AI 翻译,做成"看视频也能学"。

**RE word 现状**:无视频场景。

**借鉴点**:**不适配**。RE word 是阅读插件,视频是另一个赛道。除非未来做"听书 / 看视频记笔记",否则别碰。

---

## 5. **RE word 已经超越 LingKuma 的地方**

| 能力 | 说明 |
|---|---|
| **整本书双语对照** | LingKuma 只对选中词做翻译;RE word 自动给整段挂译文,这是**杀手级差异** |
| **多引擎路由** | 腾讯/DeepL/OpenAI/Claude 6 引擎,自动选优 |
| **离线词典** | MDX/StarDict 真正离线;LingKuma 几乎全靠在线 API |
| **自研 SRS 复习** | SM-2 简化 + 校准;LingKuma 复习系统较轻 |
| **思源深度集成** | 块属性、SQL 查询、笔记图谱、摘录回跳;LingKuma 是浏览器扩展,无法做这些 |
| **跨设备靠宿主** | 思源云同步 + 译文归档,体验比 WebDAV 更无缝 |
| **离线可读** | 无网也能读已缓存书;LingKuma 无网几乎什么都做不了 |

**结论**:RE word 在「**读**」这个垂直场景上,深度远超 LingKuma。LingKuma 在「**查**」和「**任意场景**」上更广。两者不是替代关系,但 LingKuma 的「**扫词自动染色**」+「**Bionic Reading**」是真的好功能,值得搬过来。

---

## 6. 我的建议(分 3 阶段)

### Phase A(本周末,2 天)
- [ ] Bionic Reading 设置开关 + 全书渲染
- [ ] 词频自动高亮(蓝/黄/无)+ hover tooltip

### Phase B(下版本,1 周)
- [ ] 撤销/重做栈(只针对批注)
- [ ] 液体玻璃滚动条(设置面板 chip 滚动)
- [ ] 单词卡片"AI 推荐笔记"按钮

### Phase C(可选,看用户反馈)
- [ ] WebDAV 同步(把"译文归档"升级为"自定义 WebDAV 端点")
- [ ] i18n 简中/EN 双语

### 不做
- ❌ YouTube 字幕(场景不匹配)
- ❌ 浏览器扩展化(宿主已固定,扩展化会丢思源集成优势)
- ❌ 移动 App(超出个人开发者能力,用户用思源移动版即可)

---

## 7. 一句话总结

> **LingKuma 是「在网页上学英语」的全能选手;RE word 是「在思源里读英文原版书」的专家。**
> 借鉴 LingKuma 的**视觉增强类**功能(Bionic / 词频染色 / 液体玻璃)能补 RE word 在「扫读 / 速读」上的短板;
> 但**整书双语 / 多引擎 / 离线词典 / 思源集成**这些核心壁垒,LingKuma 没有,RE word 不需要学。

如果一定要选一个最值得搬的功能:**词频自动高亮**(用户无需操作就能在书里看见自己的生词),这是「让眼睛参与学习」的关键设计,也是 LingKuma 最被用户称赞的功能。
