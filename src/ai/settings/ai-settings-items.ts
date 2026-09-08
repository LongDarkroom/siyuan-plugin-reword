/**
 * REword · AI 精读设置项声明（唯一真源）
 * ------------------------------------------------------------------
 * 2026-09-06 第 1 批：把 index.ts 里 540 行 innerHTML + 手工 querySelector 绑定
 * 换成「声明数组 + 通用行渲染器」。加一个设置项由改 4 处（HTML / 绑定 / 读取 /
 * normalize）变为改 1 处（本文件加一条）。
 *
 * 纲领（对应方案 §3）：**没有消费方的设置项不许进面板**。
 * 每个项必须声明 `wired` 与 `consumer`：
 *  - yes     🟢 已接线：改了立即生效
 *  - partial 🟡 待接线：字段与 UI 有，消费方缺失（如 soulDocId）
 *  - planned 🔵 规划中：功能未实现，UI 正常显示但标注「暂不生效」
 *
 * `listNormalizeGaps()`（ai-settings.ts）负责校验 normalize 是否漏字段；
 * 本文件的 `collectWiringReport()` 负责校验每个项是否真有消费方。
 */

/** 设置项接线状态 */
export type WiredState =
  | "yes" // 🟢 已接线
  | "partial" // 🟡 待接线（字段/UI 有，消费方缺）
  | "planned"; // 🔵 规划中（功能未实现）

export type SettingGroupId =
  | "general"
  | "service"
  | "model"
  | "read"
  | "guard"
  | "memory"
  | "preset"
  | "export"
  | "engine";

export interface SettingGroup {
  id: SettingGroupId;
  label: string;
  /** 导航图标（2026-09-07 打磨：轻量 emoji，渲染失败只是缺字形，不影响布局） */
  icon: string;
  /** 内容区顶部的分组一句话说明（空则不渲染头部说明） */
  desc?: string;
}

/** 左侧导航。顺序即面板顺序。 */
export const SETTING_GROUPS: SettingGroup[] = [
  { id: "general", label: "通用", icon: "⚙︎", desc: "输入框、字号与界面行为" },
  { id: "service", label: "AI 服务", icon: "🔌", desc: "接口地址、密钥与模型连接" },
  { id: "read", label: "精读行为", icon: "📖", desc: "结构化精读与学习模式" },
  { id: "guard", label: "防幻觉", icon: "🛡", desc: "引用校验与编造拦截" },
  { id: "memory", label: "记忆与词库", icon: "🧠", desc: "长期记忆与词汇收存" },
  { id: "preset", label: "提示词库", icon: "✍︎", desc: "各场景使用的提示词" },
  { id: "export", label: "导出与诊断", icon: "🩺", desc: "配置备份与接线诊断" },
  { id: "engine", label: "翻译引擎", icon: "🌐", desc: "腾讯 / 有道 / 百度 / 微软 / Libre" },
];

export interface SettingItem {
  /** AiSettings 的字段名；hint / actions 类型可为空 */
  key: string;
  type:
    | "switch"
    | "text"
    | "password"
    | "textarea"
    | "number"
    | "range"
    | "select"
    | "models"
    | "actions"
    | "hint"
    | "readonly";
  group: SettingGroupId;
  title: string;
  desc?: string;
  placeholder?: string;
  /** textarea 行数 */
  rows?: number;
  /** number / range 的取值域 */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** select 选项 */
  options?: { value: string; label: string }[];
  /** 接线状态（决定徽标与提示文案） */
  wired: WiredState;
  /** 消费方证据：模块 → 函数/位置。**没有消费方的项不许进面板** */
  consumer?: string;
  /** 未接线/规划中时显示在 UI 上的原因说明 */
  todoNote?: string;
  /** 上游开关：上游为假时本项禁用 */
  requires?: string;
  /** 改了立即生效、不必等保存（如字号、输入框模式） */
  live?: boolean;
  /** actions 类型：按钮列表 */
  buttons?: { action: string; label: string; variant?: "primary" | "text" }[];
  /** hint 类型：纯说明文本 */
  text?: string;
}

export const SETTING_ITEMS: SettingItem[] = [
  // ───────────────────────── 通用 ─────────────────────────
  {
    key: "enabled",
    type: "switch",
    group: "general",
    title: "启用 AI 精读",
    desc: "关闭后顶栏与命令入口的 AI 功能不再可用",
    wired: "yes",
    consumer: "src/index.ts · 多处前置判断（1917 / 1952 / 2135…）",
    live: true,
  },
  {
    key: "fontSize",
    type: "number",
    group: "general",
    title: "消息字号",
    min: 10,
    max: 24,
    step: 1,
    unit: "px",
    wired: "yes",
    consumer: "src/ai/ai-panel.ts · 消息区 CSS 变量",
    live: true,
  },
  {
    key: "inputFontSize",
    type: "number",
    group: "general",
    title: "输入框字号",
    min: 10,
    max: 24,
    step: 1,
    unit: "px",
    wired: "yes",
    consumer: "src/ai/ai-panel.ts · 输入框 CSS 变量",
    live: true,
  },
  // 2026-09-07 T4：Protyle 输入框全面转正后，本开关不再进面板。
  //   原因：normalizeAiSettings 已统一写 true（不区分新老用户），开关即便关掉
  //   重启也会被翻回 true —— 留着就是个「看得见、说了不算」的死开关，
  //   违反本文件纲领「没有消费方的设置项不许进面板」。
  //   Protyle 构造失败 / 容器零尺寸时由 ai-panel.ts 自动降级到 contenteditable，
  //   用户无需手工切换。字段与降级路径都保留，需要恢复开关时把本条声明加回即可。
  {
    key: "sendShortcut",
    type: "select",
    group: "general",
    title: "发送快捷键",
    options: [
      { value: "mod+enter", label: "⌘/Ctrl + Enter（默认）" },
      { value: "enter", label: "Enter" },
    ],
    wired: "yes",
    consumer:
      "src/ai/ai-panel.ts · bind 内的 sendKeyListener（焦点在输入框内时拦截 Enter；" +
      "输入法组合中放行；mod+enter / enter 两种模式，触发复用 runBtn 同一条发送链路）",
    todoNote: "",
  },

  // ───────────────────────── AI 服务 ─────────────────────────
  // 2026-09-07 改动点 1/2：baseUrl / apiKey / 模型列表 / 模型参数已并入平台配置
  // （见 AiPlatformManager.svelte），由「AI 服务」组顶部的平台管理区统一编辑，
  // 不再以独立设置项出现。仅保留「连通性」动作按钮。
  {
    key: "",
    type: "actions",
    group: "service",
    title: "连通性",
    desc: "用「当前输入 + 其余已保存配置」合并后发起一次真实请求",
    wired: "yes",
    consumer: "src/index.ts · testAiConnection()",
    buttons: [{ action: "test", label: "测试连接" }],
  },

  // ───────────────────────── 精读行为 ★ ─────────────────────────
  {
    key: "promptTemplate",
    type: "textarea",
    group: "read",
    title: "精读系统提示词",
    desc: "变量：{{text}}（原文）{{title}}（标题）{{word}} {{sentence}}",
    rows: 8,
    wired: "yes",
    consumer: "src/ai/ai-orchestrator.ts · system",
  },
  {
    key: "jsonMode",
    type: "switch",
    group: "read",
    title: "结构化 JSON 输出",
    desc: "关闭则直出 Markdown",
    wired: "yes",
    consumer: "src/ai/ai-orchestrator.ts · jsonMode",
  },
  {
    key: "defaultPresetId",
    type: "select",
    group: "read",
    title: "默认精读角色",
    desc: "选定后点「✨AI 精读」直接按该角色执行，不再进自由对话",
    options: [{ value: "", label: "（无，走自由对话）" }],
    wired: "yes",
    consumer:
      "src/index.ts · getActivePreset() 未激活角色时回退 defaultPresetId（P0-4 兜底）+ " +
      "AiSettingsPanel.svelte · presetOptions 动态下拉",
    todoNote: "",
  },
  {
    key: "chunkEnabled",
    type: "switch",
    group: "read",
    title: "长文分块",
    desc: "超过阈值的长文切块逐块精读后合并，避免单次上下文超限",
    wired: "yes",
    consumer:
      "src/ai/ai-panel.ts · useLearning 分支：chunkEnabled && text>chunkChars 改走 src/ai/ai-chunk.ts" +
      " · runChunkedDeepRead（splitIntoChunks + 并发 runAiDeepRead + mergeDeepReadResults 去重）",
    todoNote: "",
  },
  {
    key: "chunkChars",
    type: "number",
    group: "read",
    title: "分块字数",
    min: 1000,
    max: 8000,
    step: 500,
    unit: "字",
    requires: "chunkEnabled",
    wired: "yes",
    consumer: "src/ai/ai-chunk.ts",
    todoNote: "",
  },
  {
    key: "chunkConcurrency",
    type: "number",
    group: "read",
    title: "分块并发",
    min: 1,
    max: 4,
    step: 1,
    requires: "chunkEnabled",
    wired: "yes",
    consumer: "src/ai/ai-chunk.ts · runChunkedDeepRead 的 mapPool 并发度（多块同时精读）",
    todoNote: "",
  },
  {
    key: "progressMode",
    type: "select",
    group: "read",
    title: "进度模式",
    desc: "「推断」按返回键名猜阶段；「真实」由编排层上报确定进度",
    options: [
      { value: "infer", label: "推断（当前行为）" },
      { value: "real", label: "真实（按分块完成数）" },
    ],
    wired: "yes",
    consumer:
      "src/ai/ai-chunk.ts · runChunkedDeepRead 每块完成即 onProgress(done,total)；" +
      "src/ai/ai-panel.ts · progressMode==='real' 时写入 loading 行 [data-role='live-count']",
    todoNote: "",
  },
  {
    key: "annotateSentences",
    type: "switch",
    group: "read",
    title: "逐句批注按钮",
    desc: "精读结果每条句子下显示「批注到原文」按钮；开启后流式结束会切换为结构化视图（markdown 视图无句级 DOM）",
    wired: "yes",
    consumer:
      "src/ai/ai-render.ts · 句子块按钮 + src/ai/ai-panel.ts · bindResult 委托 AiHost.annotateSentences",
    live: true,
  },
  {
    key: "showThinking",
    type: "switch",
    group: "read",
    title: "显示思考过程",
    desc: "流式期间展示模型的 reasoning（thinking）区",
    wired: "yes",
    consumer:
      "src/ai/ai-panel.ts · sendMessage 的 wantThinking（流式 live-think 区 + 结果气泡 <details> 两条路径）",
    live: true,
  },
  {
    key: "streamThrottleMs",
    type: "number",
    group: "read",
    title: "流式节流间隔",
    desc: "未节流时 12000 字 / 2400 帧实测耗 936ms，会卡死思源；勿设 0 除非明确知道后果",
    min: 0,
    max: 500,
    step: 10,
    unit: "ms",
    wired: "yes",
    consumer:
      "src/ai/ai-panel.ts · sendMessage 的 throttleMs（createStreamThrottle 两处：thinking 与正文）",
    live: true,
  },
  {
    key: "contextMaxChars",
    type: "number",
    group: "read",
    title: "引用正文截断",
    desc: "引用文档/块作为上下文时的字符上限",
    min: 2000,
    max: 40000,
    step: 1000,
    unit: "字",
    wired: "yes",
    consumer:
      "src/ai/ai-panel.ts · contextMaxChars() 驱动 expandRefs/expandDocRefs 的文档总量预算；" +
      "src/index.ts · fetchDocText / AiHost.getDocText 的单文档截断",
    live: true,
  },

  // ───────────────────────── 防幻觉 ★ ─────────────────────────
  {
    key: "deepReadVerify",
    type: "select",
    group: "guard",
    title: "后校验严格度",
    desc: "把 AI 返回的句子/词/引文与原文逐字比对（本地执行，零额外 AI 调用）",
    options: [
      { value: "off", label: "关" },
      { value: "warn", label: "提示（不符的条目标黄）" },
      { value: "strict", label: "严格（不符的条目不入词库）" },
    ],
    wired: "yes",
    consumer: "src/ai/ai-deepread-verify.ts · verifyDeepReadResult（runAiDeepRead 落盘前调用）",
  },
  {
    key: "citationEnabled",
    type: "switch",
    group: "guard",
    title: "引用回链渲染",
    desc: "精读结果中的引文渲染为可点击回链，跳回原文块",
    wired: "yes",
    consumer: "src/ai/ai-render.ts · renderCitation（quote 渲染为回链，ai-panel openRefInSiyuan 跳转）",
  },
  {
    key: "unknownHandling",
    type: "select",
    group: "guard",
    title: "未知项处理",
    desc: "提示词层约束模型遇到不确定内容时的行为",
    options: [
      { value: "omit", label: "省略（当前行为）" },
      { value: "mark", label: "标注「不确定」" },
    ],
    wired: "yes",
    consumer: "src/ai/ai-orchestrator.ts · runAiDeepRead（mark 时追加【不确定处理】段 + unsupported 协议字段）",
  },
  {
    key: "soulEnabled",
    type: "switch",
    group: "guard",
    title: "SOUL 记忆",
    desc: "把指定思源文档作为跨会话记忆注入系统提示词",
    wired: "yes",
    consumer:
      "src/ai/ai-soul.ts · buildSoulSection → runAiDeepRead / runAiChat 的 system 提示词" +
      "（getDocText 拉取 + stripMarkdown 去 markdown + soulMaxChars 截断 + 单条缓存）",
    todoNote: "",
  },
  {
    key: "soulDocId",
    type: "text",
    group: "guard",
    title: "SOUL 文档 ID",
    placeholder: "输入思源文档 ID",
    desc: "可用「验证」确认文档是否存在",
    requires: "soulEnabled",
    wired: "yes",
    consumer: "src/ai/ai-soul.ts · loadSoulMemory 按此 ID 经 getDocText 拉取正文",
    todoNote: "",
  },  {
    key: "soulMaxChars",
    type: "number",
    group: "guard",
    title: "SOUL 字数上限",
    desc: "防止记忆文档撑爆上下文",
    min: 500,
    max: 8000,
    step: 500,
    unit: "字",
    requires: "soulEnabled",
    wired: "yes",
    consumer: "src/ai/ai-soul.ts · loadSoulMemory 截断到该字数",
    todoNote: "",
  },
  {
    key: "",
    type: "actions",
    group: "guard",
    title: "文档校验",
    wired: "yes",
    consumer: "src/index.ts · getBlockKramdown 验证",
    buttons: [{ action: "verify-soul", label: "验证文档" }],
  },

  // ───────────────────────── 记忆与词库 ★ ─────────────────────────
  {
    key: "autoSaveVocab",
    type: "switch",
    group: "memory",
    title: "词库自动入库",
    desc: "精读结果中的重点词自动写入生词本",
    wired: "yes",
    consumer:
      "src/ai/ai-panel.ts · sendMessage 两处调用补传 opts.autoSaveVocab → src/ai/ai-orchestrator.ts · runAiDeepRead 词库写回开关（默认 true）",
  },
  {
    key: "vocabSkipKnown",
    type: "switch",
    group: "memory",
    title: "已知词跳过讲解",
    desc: "已在词库中标记为掌握的词不再重复讲解",
    wired: "yes",
    consumer: "src/ai/ai-orchestrator.ts · runAiDeepRead 已知词注入 system 的门控开关（false 时不再注入已知词段）",
  },
  {
    key: "sessionRetentionDays",
    type: "number",
    group: "memory",
    title: "会话保留天数",
    desc: "0 = 永久保留",
    min: 0,
    max: 365,
    step: 1,
    unit: "天",
    wired: "yes",
    consumer: "src/ai/ai-session-store.ts · load(data, retentionDays) 按 updatedAt 剔除过期会话",
  },
  {
    key: "sessionSaveThrottleMs",
    type: "number",
    group: "memory",
    title: "会话落盘节流",
    desc: "会话变更合并成一次写盘的等待窗口；设 0 = 不合并（每次变更立即写）",
    min: 0,
    max: 5000,
    step: 100,
    unit: "ms",
    wired: "yes",
    consumer: "src/core/persist.ts · PersistentStore.setDelay()，index.ts 每次 onChange 同步",
  },

  // ───────────────────────── 提示词库 ★ ─────────────────────────
  {
    key: "translatePrompt",
    type: "textarea",
    group: "preset",
    title: "阅读器「翻译」预置提示词",
    desc: "在阅读器选中文本点「翻译」时，此提示词会预填进 AI 精读输入框并自动发送",
    rows: 4,
    wired: "yes",
    consumer: "src/index.ts · 翻译入口",
  },
  {
    key: "conciseTranslatePrompt",
    type: "textarea",
    group: "preset",
    title: "简洁版翻译提示词",
    desc: "译文右上角「🔄 简洁版」按钮使用；留空则回退到上一项拼精简后缀",
    rows: 4,
    wired: "yes",
    consumer: "src/index.ts · 简洁版重译入口",
  },
  {
    key: "chatSystemPrompt",
    type: "readonly",
    group: "preset",
    title: "对话防跑题提示词（内置，不可编辑）",
    desc: "四层防跑题结构（唯一任务 / 严格禁止 / 输入边界 / 抗注入首尾重复）。开放编辑意味着可能被改坏，故只读展示",
    rows: 5,
    wired: "yes",
    consumer: "src/ai/ai-settings.ts · DEFAULT_AI_CHAT_SYSTEM（硬编码常量）",
  },
  {
    key: "",
    type: "hint",
    group: "preset",
    title: "角色预设管理",
    text: "精读角色的新建 / 编辑 / 排序在 AI 面板顶部「AI 角色」按钮：列表 / 搜索 / 新建 / 编辑 / 删除 / 一键激活，激活后按该角色执行精读。",
    wired: "yes",
    consumer: "src/ai/ai-panel.ts · presetsBtn → showPresetList / showPresetPanel（数据层 src/ai/ai-preset.ts）",
  },

  // ───────────────────────── 导出与诊断 ★ ─────────────────────────
  {
    key: "exportNotebookId",
    type: "select",
    group: "export",
    title: "导出笔记本",
    options: [{ value: "", label: "收集箱「待整理」" }],
    wired: "yes",
    consumer: "src/ai/ai-panel.ts · openSaveToNoteDialog()",
  },
  {
    key: "exportSavePath",
    type: "text",
    group: "export",
    title: "导出路径模板",
    placeholder: "留空则使用当前文档路径",
    desc: "支持 sprig 语法，如 /{{now | date \"2006/200601\"}}/",
    wired: "yes",
    consumer: "src/ai/ai-panel.ts · openSaveToNoteDialog()",
  },
  {
    key: "",
    type: "actions",
    group: "export",
    title: "诊断与维护",
    desc: "「接线诊断」会列出未接线项、normalize 缺口与规划项，可一键复制报告",
    wired: "yes",
    consumer: "src/ai/settings/ai-settings-diagnose.ts",
    buttons: [
      { action: "diagnose", label: "接线诊断" },
      { action: "reset", label: "重置为默认", variant: "text" },
    ],
  },

  // ───────────────────────── 翻译引擎 ─────────────────────────
  {
    key: "",
    type: "hint",
    group: "engine",
    title: "与阅读器双语设置共用同一份数据",
    text:
      "以下配置项在阅读器 → ⚙ 双语设置中同样可改，两处写入的是同一份 hiword-ai.json。" +
      "多个引擎同时启用时，命中顺序（translatePriority）在阅读器 → ⚙ 双语设置 → 显示与界面里调整；" +
      "此处不再复制一份定序 UI，避免两处都能改同一份配置。",
    wired: "yes",
    consumer: "src/reader/BilingualSettingsTab.svelte · saveAi()",
  },
  { key: "tencentEnabled", type: "switch", group: "engine", title: "启用腾讯翻译", wired: "yes", consumer: "src/translate/engine.ts · isProviderReady()" },
  { key: "tencentSecretId", type: "password", group: "engine", title: "腾讯 SecretId", requires: "tencentEnabled", wired: "yes", consumer: "src/translate/engine.ts · TencentTranslator" },
  { key: "tencentSecretKey", type: "password", group: "engine", title: "腾讯 SecretKey", requires: "tencentEnabled", wired: "yes", consumer: "src/translate/engine.ts · TencentTranslator" },
  {
    key: "tencentCharsLock",
    type: "number",
    group: "engine",
    title: "腾讯用量锁",
    desc: "达到后自动禁用腾讯引擎（免费额度 500 万字符/月）",
    min: 0,
    max: 10000000,
    step: 100000,
    unit: "字符",
    requires: "tencentEnabled",
    wired: "yes",
    consumer: "src/translate/engine.ts · isTencentLocked()",
  },
  { key: "youdaoEnabled", type: "switch", group: "engine", title: "启用有道翻译", wired: "yes", consumer: "src/translate/engine.ts · isProviderReady()" },
  { key: "youdaoAppKey", type: "password", group: "engine", title: "有道 AppKey", requires: "youdaoEnabled", wired: "yes", consumer: "src/translate/engine.ts · YoudaoTranslator" },
  { key: "youdaoAppSecret", type: "password", group: "engine", title: "有道 AppSecret", requires: "youdaoEnabled", wired: "yes", consumer: "src/translate/engine.ts · YoudaoTranslator" },
  { key: "youdaoCharsLock", type: "number", group: "engine", title: "有道用量锁", desc: "0 = 不限", min: 0, max: 10000000, step: 100000, unit: "字符", requires: "youdaoEnabled", wired: "yes", consumer: "src/translate/engine.ts" },
  { key: "baiduEnabled", type: "switch", group: "engine", title: "启用百度翻译", wired: "yes", consumer: "src/translate/engine.ts · isProviderReady()" },
  { key: "baiduAppId", type: "password", group: "engine", title: "百度 AppId", requires: "baiduEnabled", wired: "yes", consumer: "src/translate/engine.ts · BaiduTranslator" },
  { key: "baiduKey", type: "password", group: "engine", title: "百度密钥", requires: "baiduEnabled", wired: "yes", consumer: "src/translate/engine.ts · BaiduTranslator" },
  { key: "baiduCharsLock", type: "number", group: "engine", title: "百度用量锁", desc: "0 = 不限", min: 0, max: 10000000, step: 100000, unit: "字符", requires: "baiduEnabled", wired: "yes", consumer: "src/translate/engine.ts" },
  { key: "msEnabled", type: "switch", group: "engine", title: "启用微软 Translator", wired: "yes", consumer: "src/translate/engine.ts · isProviderReady()" },
  { key: "msKey", type: "password", group: "engine", title: "微软订阅 Key", requires: "msEnabled", wired: "yes", consumer: "src/translate/engine.ts · MicrosoftTranslator" },
  { key: "msRegion", type: "text", group: "engine", title: "微软区域", placeholder: "eastasia", requires: "msEnabled", wired: "yes", consumer: "src/translate/engine.ts · MicrosoftTranslator" },
  { key: "libreEnabled", type: "switch", group: "engine", title: "启用 LibreTranslate", wired: "yes", consumer: "src/translate/engine.ts · isProviderReady()" },
  { key: "libreUrl", type: "text", group: "engine", title: "LibreTranslate 地址", placeholder: "https://libretranslate.com", requires: "libreEnabled", wired: "yes", consumer: "src/translate/engine.ts · LibreTranslator" },
  {
    key: "bilingualStyle",
    type: "select",
    group: "engine",
    title: "AI 兜底翻译风格",
    options: [
      { value: "literal", label: "硬直译（默认）" },
      { value: "natural", label: "自然（允许轻微润色）" },
    ],
    wired: "yes",
    consumer: "src/index.ts · AI 兜底翻译入口",
  },
  {
    key: "trBatchSize",
    type: "number",
    group: "engine",
    title: "AI 每批段数",
    desc: "单次 API 请求合并的段落数",
    min: 1,
    max: 30,
    step: 1,
    wired: "yes",
    consumer: "src/index.ts · AI 翻译分批",
  },
  {
    key: "trTemperature",
    type: "number",
    group: "engine",
    title: "AI 翻译温度",
    desc: "覆写「模型参数」的通用温度，默认 0.1（直译低稳）",
    min: 0,
    max: 1,
    step: 0.05,
    wired: "yes",
    consumer: "src/index.ts · AI 翻译请求",
  },
  {
    key: "trConcurrency",
    type: "number",
    group: "engine",
    title: "AI 并发请求数",
    min: 1,
    max: 8,
    step: 1,
    wired: "yes",
    consumer: "src/index.ts · AI 翻译并发",
  },
  {
    key: "conciseEnabled",
    type: "switch",
    group: "engine",
    title: "段落级「🔄 简洁版」按钮",
    desc: "关闭则隐藏译文右上角的简洁版重译按钮",
    wired: "yes",
    consumer: "src/reader/ReaderView.svelte · 译文按钮",
  },
  {
    key: "aiTokenLimit",
    type: "number",
    group: "engine",
    title: "AI Token 配额上限",
    desc: "0 = 不限",
    min: 0,
    max: 100000000,
    step: 10000,
    wired: "yes",
    consumer: "src/ai/ai-settings.ts · 配额统计",
  },
  {
    key: "aiTokenAlertRatio",
    type: "number",
    group: "engine",
    title: "AI Token 告警阈值",
    min: 0,
    max: 1,
    step: 0.05,
    wired: "yes",
    consumer: "src/reader/BilingualSettingsTab.svelte · 监督中心",
  },
];

/** 按分组取设置项（保持声明顺序） */
export function itemsOfGroup(group: SettingGroupId): SettingItem[] {
  return SETTING_ITEMS.filter((it) => it.group === group);
}

/** 接线状态说明（UI 徽标文案） */
export const WIRED_LABEL: Record<WiredState, string> = {
  yes: "已接线",
  partial: "待接线",
  planned: "规划中",
};

/**
 * 翻译/引擎侧字段集合：「重置为默认」时**保留**这些，只把 AI 精读侧恢复默认。
 *
 * 2026-09-07 拍板：重置不动翻译引擎 Key（腾讯 / 有道 / 百度 / 微软 / Libre 的
 * 密钥与开关、用量计数、翻译提示词、双语风格等）。理由：这些密钥重新录入成本高，
 * 且属于「阅读器双语」链路，与 AI 精读无关——重置 AI 不该连带砸掉翻译。
 *
 * 取值方式刻意**从声明数据推导**（engine 组）而不是硬编码一长串 key：
 * 今后往「翻译引擎」组加项，自动进入保留名单，不会漏。
 * 例外的是提示词库里的两项翻译提示词（分组在 preset，语义属翻译侧），显式列出。
 */
const RESET_KEEP_EXTRA = new Set(["translatePrompt", "conciseTranslatePrompt"]);
const RESET_KEEP_KEYS = new Set<string>([
  ...SETTING_ITEMS.filter((it) => it.group === "engine" && !!it.key).map((it) => it.key),
  ...RESET_KEEP_EXTRA,
]);

/** 该字段是否属于「重置时保留」的翻译/引擎侧 */
export function isTranslateSideKey(key: string): boolean {
  return RESET_KEEP_KEYS.has(key);
}

/** 重置时被保留的字段个数（供确认弹窗显示，避免"保留了什么"全靠信任） */
export function countTranslateSideKeys(): number {
  return RESET_KEEP_KEYS.size;
}

/**
 * 接线体检：把「有 UI 无消费方（假设置项）」变成可自动检测的问题。
 *
 * 判据：wired==="yes" 却没有 consumer，或 consumer 以「待实现/待接线」开头 —— 都是
 * 名不副实的项。partial / planned 属于**已知未接线**，不计入（它们本就在 UI 上标注了）。
 *
 * 与 `listNormalizeGaps()`（normalize 漏字段）互补，一起构成面板底部的「接线诊断」。
 */
export function collectWiringReport(): { key: string; title: string; reason: string }[] {
  const out: { key: string; title: string; reason: string }[] = [];
  for (const it of SETTING_ITEMS) {
    if (!it.key) continue;
    if (it.wired !== "yes") continue;
    const c = (it.consumer || "").trim();
    if (!c) {
      out.push({ key: it.key, title: it.title, reason: "标记已接线但没有声明消费方" });
    } else if (c.startsWith("待实现") || c.startsWith("待接线")) {
      out.push({ key: it.key, title: it.title, reason: "标记已接线但消费方尚未落地" });
    }
  }
  return out;
}
