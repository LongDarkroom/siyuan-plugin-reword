# NCECD 词典「命中率 90%」攻坚优化方案

> 适用对象：`siyuan-plugin-reword`（REword 插件）内置词典「新世纪英汉大词典(全量)」`dict/ncecd.mdx`（368,430 词条）
> 方案性质：**严格基于现有代码**的可落地路线图。所有瓶颈均经 1000 词条实测诊断定位，收益排序有数据支撑。
> 前置成果：解析模板已具备四类词条分诊（`detectEntryKind`）、词组/互见专用渲染、`note` 回退、`@@@LINK` 重定向跟随、例句窗口 `>=` 修复——三轮 ×200 QA 已 0 问题。

---

## 执行状态更新（2026-08-14 · P1 + P2 核心已落地）

> 用户场景确认：**阅读为主 + 兼顾写作**。字段优先级 = 中文释义 > 词性 > 短语/搭配 > 音标；90% 分层验收。

### 已完成改动（文件：`src/dict/dict-engine.ts`、`src/dict/dict-renderer.ts`、`src/index.ts`、`src/index.less`、`scripts/sample_dict_qa.mjs`、`scripts/diagnose_hitrate.mjs`）

| 项 | 改动 |
| --- | --- |
| **P1-1 互见跟随补中文** | 引擎 `lookupInDict` 增加 `followCrossrefZh`：crossref 词条跟随目标词（深度≤2 + seen 防循环）注入 `entry.resolvedZh`；义项级引用（`bay¹,9`）与循环互见（`alpha wave = alpha rhythm`）不编造、跳过；支持**姓氏简写**目标（`Barozzi, Giacomo = Vignola` → 词头实为 `Vignola, Giacomo Barozzi da`，按「目标词+逗号」前缀回退）。渲染层 `renderCrossrefEntryCard(def, resolvedZh)` 展示。 |
| **P1-2 义项不截断** | `renderDictCard` 折叠态 4 条 + 义项数 >4 时渲染「查看全部 N 个义项」按钮（`data-action="toggle-senses"`）与隐藏全量列表；`index.ts` 新增分支；`index.less` 新增样式。 |
| **P1-3 QA 口径分诊** | `sample_dict_qa.mjs` 新增「内容可渲染率」（按类型分诊：standard=有 sense/note，phrase=主词组提取成功，crossref=目标提取成功）+「原始 sense 口径」双列；互见中文校验（含循环/义项级引用豁免）。 |
| **P1-4 变形词词性继承** | `extractSenses` note 形如「mushy 的比较级 / acquit的过去式和过去分词」时，经 `lookupWordMeta` 查原词继承词性（保守：仅匹配「的+语法形态词」，带缓存）。 |
| **P2-1 短语/习语词性** | 纯词组词条主卡加 `phr.` 徽标（暖棕区分）；习语/短语义项区已有 `phr.` 归并；`POS_LABELS` 增 `phr.`/`affix.`。 |
| **P2-2 多音标** | `parseDictEntry` 改为 `matchAll` 提取全部 `<pron>` 去重后以 ` / ` 连接。 |

### 实测结果（`node scripts/diagnose_hitrate.mjs 1000`，种子 20260913，对照方案 §0 基线）

| 分层指标 | 基线 | P1 后 | 目标 | 状态 |
| --- | --- | --- | --- | --- |
| 全词表中文可用率 | 85.6% | **98.4%** | ≥92% | ✅ |
| 纯单词中文可用率 | 85.3% | **98.1%** | ≥90% | ✅ |
| 词性可见率 | 85.0%(class) | **98.3%** | ≥92% | ✅ |
| 内容可渲染率（分诊口径） | 81.5%(原始) | **99.9%** | ≥95% | ✅ |
| 纯单词音标 | 97.3% | 97.3% | ≥95% | ✅（未动） |
| 三轮 ×200 QA 问题数 | 0 | **0** | 0 | ✅ |

> 口径说明：中文可用 = zh 原始 + 互见跟随 + note 回退；词性可见 = class + phr. + 互见 + 变形继承。两项均按「用户查词时能否看到」统计。
> 验证命令：`node scripts/diagnose_hitrate.mjs 1000` 与 `node scripts/sample_dict_qa.mjs {1,2,3} 200`（全部 0 问题）。

### 三项可用率验收（2026-08-14 · 三轮 ×200 词对，读写双场景阈值）

| 轮次 | 中文可用率 ≥92% | 词性可见率 ≥92% | 短语/搭配可用率 ≥85% | 问题数 |
| --- | --- | --- | --- | --- |
| R1 | 98.5% ✅ | 100.0% ✅ | 100.0% ✅（48/48，See 引用型 2 跳过） | 0 |
| R2 | 99.0% ✅ | 99.0% ✅ | 97.8% ✅（45/46，See 引用型 4 跳过） | 0 |
| R3 | 98.5% ✅ | 99.5% ✅ | 97.9% ✅（47/48，See 引用型 1 跳过） | 0 |

> 短语/搭配口径：词条含搭配/习语区块时须渲染出「英文 + 中文」才计命中（写作需看到搭配中文与例句）；
> 习语区（idiom/phr_s）的 `<span class="dodo_phrase_sense">短语</span>` + `<span class="zh">` 计入可用；
> 纯 "See xxx" 引用型习语（如 a pig in a poke = See pig）自身无中文，属数据属性（同互见），从分母剔除。
> UI 侧已按「简洁醒目」优化：中文释义 16px/600 为整卡最醒目元素、卡片间距收紧 8px、例句层级 13/12.5px、
> 「查看全部义项」按钮改主色浅底、互见补回中文 14px 加重、phr. 徽标暖棕区分；QA 预览 HTML 顶部带三项指标验收横幅。

### 下一步（未执行，待确认）
- **P3 音标补全已落地（2026-08-14）**：见下方「P3 执行状态与结论」。
- **P3 收尾**：全词表音标 73.5% → 76~78%（见下，纯离线数据的天花板）。若坚持全词表 ≥85%，需 P4 在线发音兜底（按需查询有道/FreeDictionary IPA，超时静默降级）。
- **P4 在线兜底**：默认不做，仅长尾未收录词/短语发音需要时评估。

### P3 执行状态与结论（2026-08-14）

**改动**：
- 新增 `scripts/build_phon_extra.mjs`：从 CMU Pronouncing Dictionary（公有领域，`/tmp/cmudict.dict`，135,166 词条）生成补全表。ARPABET→IPA（重音标按"音节起始"定位，`G IH1 Z M OW2 → /ˈɡɪzmˌoʊ/`）；人名条目取逗号前姓氏匹配（`Montessori, Maria → montessori`）、去标点归一（`pent-up → pentup`）。
- 产物 `dict/phon_extra.json`：**61,997 条 / 1.7MB**（运行时磁盘加载，不进入 bundle）。
- `src/dict/dict-engine.ts`：词典加载成功后从同目录读 `phon_extra.json` 建 Map（失败静默降级），导出 `getExtraPhonetic(word)`。
- `src/dict/dict-renderer.ts`：`parseDictEntry` 无 `<pron>` 时回退 `getExtraPhonetic(word)`（键小写）。

**实测（1000 词诊断，种子 20260913）**：

| 分层 | P3 前 | P3 后 | 说明 |
| --- | --- | --- | --- |
| 全词表音标 | 73.5% | **76.2%** | +2.7pp |
| 纯单词 | 97.3% | 97.1% | 已近数据上限 |
| 人名/地名/词缀（other） | 20.5% | **72.2%** | 主要收益层 |
| 剩余缺口 238/1000 | — | — | **短语 213（89.5%）** + 词缀 18 + 罕见词 7 |

**结论（重要）**：剩余缺口 89.5% 是**纯短语/模板词条**（`to regret doing sth`、`government bonds`、`king of the castle`），**任何离线音标源（CMU/Wiktionary 均不含短语发音）都无法覆盖**。因此：
- 「全词表音标 ≥85%」用纯离线数据**不可达**（短语层约占全词表 21%，天然无音标）；
- 建议验收线改为：**纯单词 ≥95%（97.1% ✅）+ 专名/词缀层 ≥70%（72.2% ✅）+ 全词表 76~78%**；
- 若必须全词表 ≥85%，唯一路径是 P4 在线发音兜底（按需、超时 3s、失败静默）。

**回退**：删除 `dict/phon_extra.json` 即完全还原（引擎加载失败自动降级为空表）。

---

## 0. 结论先行：90% 必须「分层定义」，不能用一个数字一刀切

### 0.1 为什么单指标 90% 不科学（实测数据）

对 1000 词条做「命中 / 数据缺失 / 解析缺口」三分诊断（种子 `20260814+99`，可复现）：

| 指标 | 当前命中 | 数据缺失(不可修) | 解析缺口(可修) |
| --- | --- | --- | --- |
| 音标 `<pron>` | **73.5%** | 26.5%（人名/地名/词组/词缀/互见本无音标） | **0.0%** |
| 词性 `class` | 85.0% | 4.2%（习语/短语区本不标词性） | 10.8%（无 class 的短语/专名词条） |
| 义项 `sense` | 81.5% | 0.1% | 18.4%（词组/互见无 sense 结构，但内容已被专用路径覆盖） |
| 中文释义 `zh` | 85.6% | 0.1% | 14.3%（互见/词缀型 113 条 + 变形说明型 34 条） |

**关键发现**：音标的解析缺口是 **0%**——现有 `/<pron[^>]*>/` 正则已 100% 捕获所有数据中的音标。26.5% 的缺口全部是**数据属性**（专名、词组、词缀不收录音标）。**在纯代码层面，音标命中率的天花板就是 73.5%**，除非引入外部音标数据源。

### 0.2 分层命中率实测（这是正确设定 90% 目标的方式）

| 分层 | 样本 | 音标 | 中文 | 说明 |
| --- | --- | --- | --- | --- |
| **纯单词**（字母/连字符） | 839/1200 | **97.3%** ✅ | 85.3% | 用户查词主力场景，音标已远超 90% |
| **短语词条**（含空格） | 279/1200 | — | **95.0%** ✅ | 中文已达标 |
| 其他（人名/地名/词缀） | 361/1200 | 20.5% | — | 数据属性，音标无法在代码层补齐 |

> **结论**：真正的攻坚目标应定义为 **「纯单词中文释义 ≥ 90%」（当前 85.3%，互见跟随可 +7~8pt）** 与 **「全词表中文 ≥ 90%」（当前 85.6%）**。音标在纯单词层已 97.3% 达标；全词表音标若也要 90%，必须走外部数据源（第 5 阶段，高成本）。

---

## 1. 现状诊断方法（如何定位瓶颈）

> 以下三步可直接复制执行，产出与本方案 §0 相同的诊断数据。

### 1.1 三步诊断法

**Step A — 三分诊断脚本**（命中/数据缺失/解析缺口）
```bash
node -e '
const {MDX}=require("js-mdict");
const mdx=new MDX("dict/ncecd.mdx");
// ...（见 qa-reports 同款逻辑：1000 词条，对 phon/pos/sense/zh 各统计 ok/noData/parseMiss）
'
```
输出判读：`parseMiss > 0` 说明有解析缺口（值得修）；`noData` 占大头说明是数据属性（修代码无用）。

**Step B — 分层诊断**（纯单词 vs 短语 vs 其他）
```js
const isSimpleWord=/^[a-z][a-z-]{1,19}$/i.test(w);   // 纯单词
const isPhrase=/^[a-z].*\s/.test(w);                  // 含空格=短语
```
用途：判定 90% 目标该在哪个分层上设定、用户主场景是否已达标。

**Step C — 结构化抽取结果比对**
```bash
node scripts/sample_dict_qa.mjs 1 200   # 已有脚本，输出 qa-reports/dict_qa_round1_report.md
```
逐词看 `report.json` 中 `issues` 与 `senses` 字段，确认剩余问题属于哪一类（数据属性 or 逻辑缺陷）。

### 1.2 已定位的 4 个真实瓶颈（按收益排序）

| # | 瓶颈 | 位置 | 当前缺口 | 可修复性 |
| --- | --- | --- | --- | --- |
| B1 | **互见/词缀词条无中文**（`tackey = tacky²` 等 113/1000） | `extractCrossrefEntry` / `parseDictEntry` | 中文 +11.3% | ✅ **71% 可跟随目标词取到中文**（实测 80/113） |
| B2 | **义项截断**：`renderSensesList(entry.definition, 4)` 只渲染前 4 个 sense，长词条（27 义项）大量义项不进 UI | `renderDictCard` L889 | 义项展示 -30%+ | ✅ 展开策略优化 |
| B3 | **QA 统计口径未按类型分诊**：词组/互见词条无 sense 被计为"缺义项"，虚低 18.4% | `scripts/sample_dict_qa.mjs` | 误报 | ✅ 改口径即 +18.4% 真实覆盖 |
| B4 | **词性缺失**：无 class 的短语/专名词条 108/1000 | `extractSenses` `isPhrasalAt` 只覆盖 idiom/phr_s | 词性 +10.8% | ⚠️ 部分可修（启发式标注） |

---

## 2. 分阶段优化路线图（低成本高收益 → 高成本）

```
阶段1（低成本·立竿见影）→ 阶段2（中成本·+5pt）→ 阶段3（数据增强·跨入90%）→ 阶段4（高成本·兜底）
   B1+B2+B3            B4 + 多音标 + 实体清理           外部音标源/词典融合            LLM/在线兜底
   ≈ +7~8pt 中文        ≈ +10pt 词性                       ≈ +10pt 全词表音标
```

| 阶段 | 成本 | 预期收益 | 核心改动 |
| --- | --- | --- | --- |
| **P1 低垂果实** | 低（纯代码，1~2h） | 中文 85.6%→**93%+**；义项真实覆盖 81.5%→**100%**（口径修正后） | 互见跟随取中文、义项展开、QA 口径分诊 |
| **P2 结构化补强** | 中（3~5h） | 词性 85%→**90%+**；多音标 | 无 class 词性启发式、多 `<pron>` 提取、词性表扩充 |
| **P3 数据增强** | 中高（需新数据文件） | 全词表音标 73.5%→**85%+**；中文 93%→**95%+** | 内置英文音标/中文释义映射表（打包进插件） |
| **P4 兜底链路** | 高（网络依赖） | 长尾 100%（含未收录词） | 在线词典 API、LLM 释义、多词典融合 |

---

## 3. 分步实施细节（可直接对照代码执行）

### 阶段 P1：低垂果实（建议本阶段立即执行）

#### P1-1 【B1·核心】互见/词缀词条跟随目标词补中文

**问题**：`tackey` → `= tacky²`、`ichthyo-` → `= ichthyo-`、`usucaption` → `= usucapion`，互见条目只有英文目标、无中文。实测 113/1000 条，**71%（80 条）目标词可查到中文**（如 `usucaption → usucapion → 时效取得`）。

**改动点**：`src/dict/dict-renderer.ts`
1. `extractCrossrefEntry` 返回值增加 `resolvedZh` 字段：
   ```ts
   // 在返回前尝试跟随目标词查中文（需要拿到 DictSource —— 函数签名需加参）
   // 方案 A（推荐）：在 index.ts 查词层完成 —— lookup 时若 entry 是 crossref 且无 zh，调用引擎二次 lookup 目标词取其 zh
   ```
2. **推荐落点**：`src/dict/dict-engine.ts` 的 `lookup` 链（L313）——返回前做一次"互见解析"：
   ```ts
   // 伪代码：lookup(word) → entry 命中且 definition 是互见/词缀型（=/also）→
   //   解析出目标词 → lookupInDict(src, target) → 若目标有 <span class="zh"> → 注入 entry.resolvedZh
   ```
3. `renderCrossrefEntryCard` 展示 `resolvedZh`（已有 `.hiword-dict-crossref-zh` 样式，直接复用）。

**验收**：抽查 `tackey / usucaption / sulfurating / zealotisms` → 互见卡显示中文；`bay laurel = bay¹,9`（目标为义项级引用）不崩溃、无中文不强行编造。

#### P1-2 【B2】义项不截断：长词条全部义项可展开

**问题**：`renderDictCard` L889 调 `renderSensesList(entry.definition, 4)`，`extractSenses` 内部 `out.length < max` 截断。`legging` 27 个义项只显示 4 个，"命中率"虚低。

**改动点**：
1. `renderDictCard`：改为「默认 4 条 + 更多按钮」：
   ```ts
   const sensesHtml = renderSensesList(entry.definition, 4);          // 折叠态
   const sensesHtmlFull = renderSensesList(entry.definition, 99);     // 展开态（<div class="hiword-dict-senses-full" hidden>）
   // 义项数 >4 时追加 <button data-action="toggle-senses">查看全部 N 个义项 ▾</button>
   ```
2. `index.ts` `handleDockClick` 增加 `toggle-senses` 分支（参照现有 `toggle-pos` 模式，L1487 附近）。
3. `index.less`：`.hiword-dict-senses-full` 展开动画（可选）。

**验收**：查 `legging / reaching / bangs` → 折叠 4 条，点击展开全部 27 条；展开后词性分组仍正确。

#### P1-3 【B3】QA 统计口径按词条类型分诊（消除虚低误报）

**问题**：当前 `senseCount===0` 的**词组/互见词条**被计为"缺义项"（18.4%），但它们的**内容已被专用渲染路径完整覆盖**——这是统计口径错误，不是解析缺陷。

**改动点**：`scripts/sample_dict_qa.mjs`
```ts
// 命中定义改为"内容可渲染率"：
//   standard → 有 sense 或有 note 回退 = 命中
//   phrase   → extractPhraseEntry 非空 = 命中
//   crossref → extractCrossrefEntry 非空 = 命中
// 报告新增：senseCoverage（按类型加权）与 rawSenseRate（原始口径）双列对比
```

**验收**：重跑三轮 → 义项"真实覆盖"从 81.5% → ~100%，报告同时展示两列口径供决策。

#### P1-4 【B1b】变形说明型已有 note 回退，补"词性回填"

**问题**：`mushier → mushy 的比较级`、`galaxies → galaxy 的复数形式` —— 有 note 但无词性。这些词条是变形词，词性应继承原词。

**改动点**：`extractSenses` 的 `note` 分支后追加启发式：
```ts
// note 形如 "xxx 的过去式/复数/比较级" 时，查原文是否有 class 词性可继承
// 实现：解析 note 中的目标词 → 用引擎 lookup → 取其首个 class 作为本义项 pos
```
（依赖 P1-1 的引擎二次查找能力，可合并实现。）

---

### 阶段 P2：结构化补强

#### P2-1 【B4】无 class 词条的词性启发式标注

**问题**：`to regret doing sth / Mount Kirkpatrick / government bonds` 等 108/1000 无 class。其中短语词条（`to xxx`）应标 `phr.`；专名（人名/地名）应标 `n.`。

**改动点**：`src/dict/dict-renderer.ts` `extractSenses`
```ts
// 扩展现有 isPhrasalAt 判定：
//   1) 词头/词条以 "to " 开头 或 含 maybe_phrase → pos = "phr."
//   2) 词头含 "，"/", "（人名）或 大写地名 → pos = "n."
//   3) <span class="class">prefix/suffix</span> → pos = "affix."（词缀，UI 用灰色徽标）
```
同时 `POS_LABELS` 增加 `"phr.": "短语"`、`"affix.": "词缀"`。

**验收**：`to beg the question → phr.`、`Mount Kirkpatrick → n.`、`ichthyo- → affix.`。

#### P2-2 多音标提取（美音/英音区分）

**问题**：`/<pron[^>]*>(.*?)<\/pron>/`（L828）只取**第一个** `<pron>`，`procrastinate` 的 `/prəʊˈkræstɪˌneɪt; prə-/` 多音标未拆分。

**改动点**：
```ts
// parseDictEntry 改为 matchAll：
const prons = [...definition.matchAll(/<pron[^>]*>([\s\S]*?)<\/pron>/gi)]
  .map(m => stripHtmlTags(m[1]).trim())
  .filter(Boolean);
// 若 prons.length>1 或含 ";" → 拆分为主音标 + 变体
// 渲染：主音标加粗，变体浅灰小字（🇬🇧 /…/ · 🇺🇸 /…/）
```

**验收**：`procrastinate / tomato / either` 显示双音标；单音标词无回归。

#### P2-3 词条词性继承（P1-4 的规模化）

对**变形词条**（note 型）批量继承原词词性，降低"无词性"占比到 3% 以下。

---

### 阶段 P3：数据增强（跨入 90% 的关键）

#### P3-1 内置「英文音标补全表」（打包进插件，纯本地）

**问题**：全词表音标 73.5%，缺口全在人名/地名/词缀（数据属性）。要让**全词表音标 ≥ 90%**，必须引入外部音标数据。

**方案**：
1. 从开源数据（CMU Pronouncing Dictionary / wordfreq 音标表）生成 `dict/phon_extra.json`：`{ "stalingrad": "/ˈstɑːlɪŋɡræd/", ... }`，覆盖人名/地名/专名。
2. `parseDictEntry` 音标缺失时查该表：
   ```ts
   const phonetic = pronMatch ? ... : (PHON_EXTRA[word] ?? "");
   ```
3. 构建时（vite）把 json 打进 bundle（~100KB gzip，可接受）。

**预期**：全词表音标 73.5% → 85%+（覆盖主要专名后）。

#### P3-2 中文释义补全表（长尾）

对 B1 仍无法跟随的 33 条（`bay laurel = bay¹,9` 义项级引用）+ 变形说明型，用脚本从词典自身交叉引用批量提取，生成 `dict/zh_extra.json` 兜底。

#### P3-3 词表级缓存层（性能）

`lookupInDict` 增加 LRU 缓存（`Map<string, DictEntry>`，容量 2000），互见跟随会产生**二次查询**，缓存避免重复解析。

---

### 阶段 P4：兜底链路（高成本，按需启用）

| 方案 | 成本 | 收益 | 风险 |
| --- | --- | --- | --- |
| 在线词典 API（如 FreeDictionary/有道） | 需网络 + API key | 未收录词 100% 覆盖 | 网络延迟、限流、合规 |
| LLM 释义兜底 | 高（token 成本） | 任意词长尾 | 时延、幻觉释义 |
| 多词典融合（导入 StarDict/MDX） | 中 | 跨词典互补 | 需用户手动导入 |

> 建议：P4 仅在 P1~P3 完成后按需评估，默认不做。

---

## 4. 阈值设定与 90% 逼近验证

### 4.1 分层验收阈值（建议直接采用）

| 分层指标 | 当前实测 | P1 后 | P2 后 | P3 后 | 目标 |
| --- | --- | --- | --- | --- | --- |
| 纯单词音标 | 97.3% | — | — | — | ≥95% ✅ |
| **全词表中文释义** | 85.6% | 93%+ | 94%+ | 95%+ | **≥90%** |
| **纯单词中文释义** | 85.3% | 93%+ | 94%+ | 95%+ | **≥90%** |
| 全词表词性 | 85.0% | 87%+ | 90%+ | 91%+ | ≥90% |
| 义项内容覆盖（分诊口径） | 81.5%(原始) | ~100% | — | — | ≥95% |
| 全词表音标 | 73.5% | — | — | 85%+ | ≥85%※ |

> ※ 全词表音标 90% 需要 P3 数据增强 + P4 兜底双重投入；**在纯单词分层已达标的前提下，建议以「纯单词 95% + 全词表 85%」为音标验收线**，避免过度投入。

### 4.2 逼近 90% 的验证闭环

```bash
# 每完成一个 P 阶段，跑一遍完整验证：
npx tsc --noEmit                          # 类型零错误
npm run build                             # 构建产物落盘
node scripts/sample_dict_qa.mjs 1 200     # 三轮 ×200 回归
node scripts/sample_dict_qa.mjs 2 200
node scripts/sample_dict_qa.mjs 3 200
# 看 qa-reports/dict_qa_round{N}_report.md 的"词条类型分布"与"命中率统计"
```

**达标判定**：
- 中文/词性：三轮均值 ≥ 阈值即为达标；
- 义项覆盖：分诊口径 ≥95% 且原始口径不再被引用（用正确口径）；
- 每轮固定种子 → 前后对比可比对（同一批 200 词，逐词 diff 看修复影响）。

### 4.3 回归保护

- `@@@LINK` 重定向、例句窗口 `>=`、note 回退、四类分诊为既有能力，任何新改动不得破坏（QA 脚本已有断言）；
- 每阶段后跑三轮 QA，问题数必须保持 0；
- 新加数据文件（phon_extra.json 等）放 `dict/` 并纳入构建，缺失时静默降级（`?? ""`）。

---

## 5. 潜在风险与回退策略

| 风险 | 概率 | 影响 | 缓解/回退 |
| --- | --- | --- | --- |
| **互见跟随产生无限递归**（`a = b`、`b = a`） | 中 | 死循环 | `resolveMdxRedirect` 已有深度≤3 保护；跟随中文时同样限制 2 跳 + 访问集合去重 |
| **义项级引用**（`bay¹,9` 带义项号）解析失败 | 高 | 取不到中文 | 目标词含 `,数字` 时先剥离义项号再查；仍无则**留空不编造**（已有 `?? ""` 习惯） |
| **多音标拆分破坏单音标显示** | 低 | UI 回归 | 拆分逻辑仅在多音标/含 `;` 时启用，单音标路径不变 |
| **P3 数据文件版权/体积** | 中 | 合规/体积 | 用 CMU PD 数据（公有领域）；json 压缩后 <150KB；可做成可选下载而非内置 |
| **P4 在线 API 限流/网络** | 高 | 体验差 | 默认关闭，仅手动启用；超时 3s + 缓存 + 失败静默降级 |
| **词性启发式误标**（把名词标成 phr.） | 中 | 展示错误 | 启发式只作用于**无 class 且明确特征**（`to ` 前缀/含逗号人名）；不确定就不标 |
| **QA 口径修改后数字虚高** | 低 | 误判达标 | 报告同时保留原始口径与分诊口径双列，人工可核对 |

**通用回退**：所有改动集中在 `src/dict/dict-renderer.ts`、`src/dict/dict-engine.ts`、`scripts/sample_dict_qa.mjs` 三个文件；备份目录 `plugins/_reword_copilot_backup_*` 保留旧版，回退 = 恢复备份 + `npm run build`。

---

## 6. 执行顺序建议（可直接照做）

```bash
# 第 1 步（立即，低风险）—— P1-1 互见跟随补中文
#   改 dict-engine.ts lookup 链 + renderCrossrefEntryCard 展示 resolvedZh

# 第 2 步 —— P1-3 QA 口径分诊（先修度量衡，再谈提升）
#   改 scripts/sample_dict_qa.mjs，跑三轮确认"真实覆盖"数字

# 第 3 步 —— P1-2 义项展开
#   改 renderDictCard + index.ts toggle-senses + index.less

# 第 4 步 —— P1-4 变形词词性继承 + P2-1 词性启发式
#   改 extractSenses，POS_LABELS 加 phr./affix.

# 第 5 步 —— P2-2 多音标
#   改 parseDictEntry matchAll

# 第 6 步 —— P3 数据增强（评估后决定是否做）
#   生成 phon_extra.json / zh_extra.json + LRU 缓存

# 每一步之后：tsc + build + 三轮 QA，问题数保持 0，命中率逐阶段核验 §4.1 阈值表
```

> 预计 P1 完成后即可达成「全词表中文 ≥ 90%、纯单词音标 ≥ 95%」——即**用户主场景 90% 目标**；P2 补齐词性；P3 仅在全词表音标也有硬性 90% 需求时投入。
