/**
 * 提示词管理
 * ------------------------------------------------------------------
 * 对应需求 6 左下角第三项：以「逗号」分隔呈现预设提示词，点击即直接调用。
 *  - 内置若干默认提示词（总结 / 翻译 / 润色 / 提问）。
 *  - 用户可自定义，持久化于 copilot-prompts.json（逗号分隔字符串）。
 *
 * 存储形态：用逗号分隔的字符串（如 "总结,翻译,润色"）映射到 PromptItem，
 * 每个 label 即插入到输入框的指令文本。若需更丰富的「标题/内容」分离，
 * 后续可扩展为 [label::content] 形式。
 */
import type { PromptItem } from "../types.ts";

/** 默认提示词（逗号分隔的展示词，点击即把该词作为指令插入输入框） */
export const DEFAULT_PROMPTS_RAW = "总结要点,翻译成英文,翻译成中文,润色改写,列出行动项,解释概念,换个角度分析,生成提纲";

/** 内置更丰富的「内容映射」：点击展示词时插入的实际指令 */
export const DEFAULT_PROMPT_CONTENT: Record<string, string> = {
  总结要点: "请用要点形式总结上面内容的核心信息。",
  翻译成英文: "请将上面的内容翻译成英文，保持原意与语气。",
  翻译成中文: "请将上面的内容翻译成中文，语言自然通顺。",
  润色改写: "请在不改变原意的前提下，润色并改写上面的内容，使其更流畅专业。",
  列出行动项: "请从上面的内容中提取所有可执行的行动项，并给出建议的优先级。",
  解释概念: "请解释上面提到的关键概念，用通俗的语言和例子说明。",
  换个角度分析: "请换一个视角或立场，重新分析上面的内容，指出被忽略的方面。",
  生成提纲: "请基于上面的内容，生成一个结构化提纲。",
};

/**
 * 将逗号分隔字符串解析为 PromptItem 列表。
 * 同时支持内置内容映射；若某标签无内置内容，则内容等于标签本身。
 */
export function parsePrompts(raw: string): PromptItem[] {
  const parts = (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const items: PromptItem[] = [];
  for (const label of parts) {
    if (seen.has(label)) continue;
    seen.add(label);
    items.push({
      id: "p_" + label,
      label,
      content: DEFAULT_PROMPT_CONTENT[label] ?? label,
    });
  }
  return items;
}

/** 将 PromptItem 列表序列化回逗号分隔字符串 */
export function serializePrompts(items: PromptItem[]): string {
  return items.map((p) => p.label).join(",");
}
