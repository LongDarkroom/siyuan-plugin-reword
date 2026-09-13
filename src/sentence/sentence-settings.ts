/**
 * REword · 造句设置（2026-09-12 新增 · 复习面板「AI 造句」独立配置）
 * ------------------------------------------------------------------
 * 为什么必须独立成一层（而不是塞进 AiSettings）：
 *   1. `AiSettings.systemPrompt` / `promptTemplate` / `translatePrompt` / `temperature`
 *      与「AI 精读 + 自由对话」共用同一份配置对象，经 normalizeAiSettings / AI 面板
 *      saveAll 全量回写；任何造句侧的改动都会外溢到精读与自由对话。
 *   2. 造句的输出契约是固定 JSON schema（见 gen-prompt.ts 头注释），与精读的自由
 *      文本契约本质不同，混在一份配置里必然互相污染。
 *   ⇒ 本模块持有**只属于造句链路**的配置，持久化在独立文件
 *     `hiword-sentence-settings.json`，由 index.ts 显式注入 SentenceEngine，
 *     对 AI 精读 / 自由对话零读零写。
 *
 * 数据现状（决定了字段设计，勿凭想象改）：
 *   - 离线词典引擎（dict-engine.ts）**不提供例句**（grep '例句|example' 命中 0）；
 *     例句只来自在线海词（online-dict.ts 的 OnlineDictResult.examples）。
 *     因此「选择哪本词典的例句」在当前数据层 = 在线例句开关 + 例句词性筛选；
 *     离线侧能做的是「首选本地词典」（供释义 / 词性反查回填，不影响例句来源）。
 *   - 「默认词典源（离线 / 在线）」的唯一真源是 OnlineSettings.popupSource
 *     （hiword-online.json），本模块**不重复持有**，避免两把尺子。
 *
 * 零 DOM / 零思源运行时依赖，可被 node:test 直接覆盖。
 */

/** 恢复默认时使用的常量（同时是 prompt 侧的唯一真源） */
export const SENT_SET_N_MIN = 1;
export const SENT_SET_N_MAX = 5;
export const SENT_SET_N_DEFAULT = 3;

export interface SentenceSettings {
  // —————————————— 例句来源 ——————————————
  /** 2026-09-12 总开关：允许 AI 参与造句（关闭后 AI 完全不调用，仅词典例句生效） */
  aiGenEnabled: boolean;
  /** 使用在线词典（海词）自带例句作为首选来源（source=dict） */
  useOnlineExamples: boolean;
  /** 词典例句不足时用 AI 补缺（关闭则只入库词典例句；仅在 aiGenEnabled 下生效） */
  aiFillEnabled: boolean;
  /** 例句词性筛选：只采纳命中的词性分组（空数组 = 不过滤） */
  examplePosFilter: string[];
  /** 首选本地词典 id（释义 / 词性反查回填；空 = 用当前激活词典） */
  preferredDictId: string;

  // —————————————— AI 造句提示词与参数 ——————————————
  /** 每词目标句数 */
  sentenceCount: number;
  /** 场景候选（拼进 prompt 的 scenario 枚举） */
  scenarios: string[];
  /** 句子长度合规区间（词数），同时用于 prompt 约束与入库校验 */
  lenMin: number;
  lenMax: number;
  /** 附加「词性 → 句型倾向」学科提示 */
  posBias: boolean;
  /** 要求目标词用 ** 包裹加粗（仅影响 prompt；入库时会剥掉） */
  markWord: boolean;
  /** 追加到内置 system prompt 末尾的补充要求（空 = 不加） */
  extraPrompt: string;
  /** 覆盖内置 system prompt（空 = 用内置常量） */
  systemPrompt: string;
  /** 覆盖内置 user 提示模板，支持 {word} / {n} 占位（空 = 用内置常量） */
  userPrompt: string;
  /** 造句专用 temperature（与 AI 精读 / 自由对话的 temperature 完全隔离） */
  temperature: number;

  // —————————————— 限流与配额 ——————————————
  /** 单词冷却小时数（0 = 不冷却） */
  cooldownHours: number;
  /** 每日生成词数上限（0 = 不限） */
  dailyLimit: number;
  /** 串行队列词间隔毫秒（0 = 不等待） */
  queueIntervalMs: number;
}

export const DEFAULT_SENTENCE_SETTINGS: SentenceSettings = {
  aiGenEnabled: true,
  useOnlineExamples: true,
  aiFillEnabled: true,
  examplePosFilter: [],
  preferredDictId: "",

  sentenceCount: SENT_SET_N_DEFAULT,
  scenarios: ["日常", "学术"],
  lenMin: 6,
  lenMax: 24,
  posBias: true,
  markWord: true,
  extraPrompt: "",
  systemPrompt: "",
  userPrompt: "",
  temperature: 0.7,

  cooldownHours: 24,
  dailyLimit: 10,
  queueIntervalMs: 5_000,
};

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

/** 字符串数组清洗：去空白 / 去重（保序）/ 截断长度 */
function cleanList(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = String(x ?? "").trim();
    if (!s || out.includes(s)) continue;
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * 归一化任意来源（磁盘 JSON / 用户输入）为合法配置。
 * 缺失字段回落默认值，越界值夹断，类型不符直接丢弃该字段。
 */
export function normalizeSentenceSettings(raw: unknown): SentenceSettings {
  const d = DEFAULT_SENTENCE_SETTINGS;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
  const num = (v: unknown, fb: number) => (typeof v === "number" ? v : fb);
  const str = (v: unknown, fb: string) => (typeof v === "string" ? v : fb);

  // 长度区间：反了就整体回落默认（单边夹断会得到非法区间）
  let lenMin = clamp(num(r.lenMin, d.lenMin), 3, 20, d.lenMin);
  let lenMax = clamp(num(r.lenMax, d.lenMax), 6, 60, d.lenMax);
  if (lenMin >= lenMax) {
    lenMin = d.lenMin;
    lenMax = d.lenMax;
  }

  const scenarios = cleanList(r.scenarios, 8);

  return {
    aiGenEnabled: bool(r.aiGenEnabled, d.aiGenEnabled),
    useOnlineExamples: bool(r.useOnlineExamples, d.useOnlineExamples),
    aiFillEnabled: bool(r.aiFillEnabled, d.aiFillEnabled),
    examplePosFilter: cleanList(r.examplePosFilter, 12),
    preferredDictId: str(r.preferredDictId, d.preferredDictId).trim(),

    sentenceCount: Math.round(clamp(num(r.sentenceCount, d.sentenceCount), SENT_SET_N_MIN, SENT_SET_N_MAX, d.sentenceCount)),
    scenarios: scenarios.length ? scenarios : [...d.scenarios],
    lenMin,
    lenMax,
    posBias: bool(r.posBias, d.posBias),
    markWord: bool(r.markWord, d.markWord),
    extraPrompt: str(r.extraPrompt, d.extraPrompt),
    systemPrompt: str(r.systemPrompt, d.systemPrompt),
    userPrompt: str(r.userPrompt, d.userPrompt),
    temperature: clamp(num(r.temperature, d.temperature), 0, 2, d.temperature),

    cooldownHours: clamp(num(r.cooldownHours, d.cooldownHours), 0, 24 * 30, d.cooldownHours),
    dailyLimit: Math.round(clamp(num(r.dailyLimit, d.dailyLimit), 0, 500, d.dailyLimit)),
    queueIntervalMs: Math.round(clamp(num(r.queueIntervalMs, d.queueIntervalMs), 0, 60_000, d.queueIntervalMs)),
  };
}

/**
 * 渲染 user 提示模板；空模板回落内置文案。
 * 只做占位符替换，不做任何 i18n / DOM 处理（输入是 AI 提示词，不是界面文案）。
 */
export function renderSentenceUserPrompt(tpl: string, word: string, n: number): string {
  const t = (tpl || "").trim();
  if (!t) return `请为单词 ${word} 生成 ${n} 个例句。`;
  return t.replace(/\{word\}/g, word).replace(/\{n\}/g, String(n));
}

let current: SentenceSettings = { ...DEFAULT_SENTENCE_SETTINGS };

export function getSentenceSettings(): SentenceSettings {
  return current;
}

/** 用部分覆盖合并当前配置（浅合并；数组整体替换，与 UI 语义一致） */
export function setSentenceSettings(patch: Partial<SentenceSettings>): SentenceSettings {
  current = normalizeSentenceSettings({ ...current, ...patch });
  return current;
}

export function resetSentenceSettings(): SentenceSettings {
  current = { ...DEFAULT_SENTENCE_SETTINGS };
  return current;
}

/** 从磁盘数据装载（非法值自动归一） */
export function loadSentenceSettings(raw: unknown): SentenceSettings {
  current = normalizeSentenceSettings(raw);
  return current;
}
