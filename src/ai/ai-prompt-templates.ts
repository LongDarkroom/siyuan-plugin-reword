/**
 * REword · AI 提示词模板数据层
 * ------------------------------------------------------------------
 * 对标 copilot 的「提示词」预设列表：用户可事先写好多条提示词模板，
 * 在输入框底部点击逗号图标弹出列表，选中即覆盖本次会话的系统提示词。
 *
 * 纯数据层：不依赖 SiYuan SDK，可单测。持久化经 onChange 回调由
 * index.ts 用 PersistentStore 落盘（hiword-ai-prompts.json）。
 */

import { getLogger } from "../core/logger.ts";

function genId(): string {
  return `tp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 单条提示词模板 */
export interface AiPromptTemplate {
  id: string;
  name: string;
  content: string;
}

/** 持久化结构 */
export interface AiPromptTemplateStoreData {
  templates: AiPromptTemplate[];
}

export function normalizeTemplate(raw: any, fallbackId?: string): AiPromptTemplate {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    id: typeof r.id === "string" && r.id ? r.id : fallbackId || genId(),
    name: typeof r.name === "string" ? r.name : "未命名提示词",
    content: typeof r.content === "string" ? r.content : "",
  };
}

/** 默认提示词模板（英语学习场景，含 REword 占位符） */
export function buildDefaultTemplates(): AiPromptTemplate[] {
  return [
    normalizeTemplate({
      id: genId(),
      name: "英语文章精读",
      content:
        "你是英语学习助手。请精读以下英文，讲解重点词汇（音标/词性/语境释义）与句子结构，并给出中文翻译。",
    }),
    normalizeTemplate({
      id: genId(),
      name: "生词解析",
      content:
        "请解析文本中的生词，按 JSON 输出 words[]（word/phonetic/pos/meaning/context）与 sentences[]（sentence/structure/translation）。",
    }),
  ];
}

export class PromptTemplateStore {
  private data: AiPromptTemplateStoreData = { templates: [] };
  private onChange?: () => void | Promise<void>;

  constructor(onChange?: () => void | Promise<void>) {
    this.onChange = onChange;
  }

  load(raw: unknown): void {
    const templates = Array.isArray((raw as any)?.templates)
      ? (raw as any).templates.map((t: any) => normalizeTemplate(t))
      : [];
    if (!templates.length) {
      this.data = { templates: buildDefaultTemplates() };
    } else {
      this.data = { templates };
    }
  }

  export(): AiPromptTemplateStoreData {
    return JSON.parse(JSON.stringify(this.data));
  }

  list(): AiPromptTemplate[] {
    return this.data.templates;
  }

  get(id: string): AiPromptTemplate | undefined {
    return this.data.templates.find((t) => t.id === id);
  }

  async upsert(input: Partial<AiPromptTemplate> & { name: string }): Promise<AiPromptTemplate> {
    const existing = input.id ? this.get(input.id) : undefined;
    const tpl = normalizeTemplate({ ...(existing || {}), ...input }, existing?.id);
    if (existing) {
      const idx = this.data.templates.findIndex((t) => t.id === existing.id);
      this.data.templates[idx] = tpl;
    } else {
      this.data.templates.push(tpl);
    }
    await this.persist();
    return tpl;
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.data.templates.findIndex((t) => t.id === id);
    if (idx < 0) return false;
    this.data.templates.splice(idx, 1);
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    if (this.onChange) {
      try {
        await this.onChange();
      } catch (e) {
        getLogger().warn("[REword] 提示词模板持久化失败:", { error: e });
      }
    }
  }
}
