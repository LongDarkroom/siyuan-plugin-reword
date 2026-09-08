/**
 * REword · 平台预设（2026-09-07 T8 建，同日 R1 升级为磁贴网格数据源）
 * ------------------------------------------------------------------
 * 目的：新用户配 AI 服务时最容易卡在「baseUrl 填什么 / 模型叫什么」。
 * 这里内置常见 OpenAI 兼容平台的地址与代表性模型清单，选平台即填，
 * 模型列表仍可增删 / 从 /models 拉取（平台清单只是起点，不是约束）。
 *
 * 原则（对齐「只保留基础需求」）：
 *  - 只存 baseUrl + models，不存 key（Key 永远用户自己填）；
 *  - 模型清单保持短（2~4 个代表性型号），避免误导为「全部可用」；
 *  - 模型名/地址会随服务商演进，这里只收经过验证的稳定形态。
 *
 * R1 分组（磁贴网格三个 Tab）：
 *  - official  主流官方：各家自有的 OpenAI 兼容端点
 *  - aggregate 聚合平台：一个 Key 逛多家模型
 *  - local     本地部署：本机/局域网推理服务，通常无需 Key
 *
 * ⚠️ 不收 Anthropic：其 Messages API 与 OpenAI /v1/chat/completions 协议不同，
 * 直填地址必失败，等于造一个「有 UI 无功能」项。走转换网关（OneAPI/NewAPI 等）
 * 的用户请用「自定义」手填地址——网关 URL 不定，不设磁贴。
 */

export type PlatformGroup = "official" | "aggregate" | "local";

export interface PlatformPreset {
  id: string;
  name: string;
  /** OpenAI 兼容基础地址（可含 /v1，buildChatUrl 会归一化） */
  baseUrl: string;
  /** 代表性模型（追加进用户现有列表，去重不覆盖） */
  models: string[];
  /** 需要用户自备 Key 的提示（本地服务不需要） */
  note?: string;
  /** R1：磁贴网格分组 */
  group: PlatformGroup;
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  // ── 主流官方 ──────────────────────────────────────────────
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    group: "official",
  },
  {
    id: "qwen",
    name: "阿里通义 Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-max"],
    group: "official",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4-plus"],
    group: "official",
  },
  {
    id: "moonshot",
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-32k", "moonshot-v1-128k"],
    group: "official",
  },
  {
    id: "doubao",
    name: "豆包（火山方舟）",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: [],
    note: "方舟用推理接入点 ID 当模型名（ep-开头），建议连上后点「获取模型」拉取",
    group: "official",
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    models: ["abab6.5s-chat"],
    group: "official",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini"],
    group: "official",
  },
  // ── 聚合平台 ──────────────────────────────────────────────
  {
    id: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V3"],
    group: "aggregate",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [],
    note: "模型很多，建议连上后点「获取模型」拉取",
    group: "aggregate",
  },
  // ── 本地部署 ──────────────────────────────────────────────
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: [],
    note: "本地服务无需 API Key，模型以本机已 pull 的为准",
    group: "local",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    models: [],
    note: "先在 LM Studio 里启动本地服务（Developer → Start Server）",
    group: "local",
  },
  {
    id: "localai",
    name: "LocalAI",
    baseUrl: "http://127.0.0.1:8080/v1",
    models: [],
    note: "模型名以 LocalAI 已部署的为准",
    group: "local",
  },
];

/** R1：磁贴网格 Tab 的固定顺序与文案 */
export const PLATFORM_GROUPS: { id: PlatformGroup; label: string }[] = [
  { id: "official", label: "主流官方" },
  { id: "aggregate", label: "聚合平台" },
  { id: "local", label: "本地部署" },
];
