/**
 * REword · AI 预设数据层
 * ------------------------------------------------------------------
 * 对标 copilot 的「预设」概念：一组可命名的配置快照（上下文消息数、
 * 温度、临时系统提示词等），并扩展 REword 特色开关（autoCollectWords /
 * autoAnnotateSentences），让 AI 精读结果可一键批量入库词库 + 写入批注。
 *
 * 纯数据层：不依赖 SiYuan SDK，可单测。持久化经注入的 onChange 回调
 * 由 index.ts 用 PersistentStore 落盘（hiword-ai-presets.json）。
 */

import { getLogger } from "../core/logger.ts";

function genId(): string {
  return `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 单个 AI 预设 */
export interface AiPreset {
  id: string;
  name: string;
  /** 输出形态：learning = 结构化精读（约束自由对话，联动词库/批注）；chat = 自由对话 */
  templateType: "learning" | "chat";
  /** 上下文消息数（-1 = 无限制） */
  contextMessages: number;
  /** 温度 0~2 */
  temperature: number;
  /** false = 使用全局设置温度 */
  temperatureEnabled: boolean;
  /** 临时系统提示词（覆盖全局 promptTemplate；空 = 用全局） */
  systemPrompt: string;
  /** REword 特色：AI 结果是否可批量入库词库 */
  autoCollectWords: boolean;
  /** REword 特色：AI 结果是否可批量写入批注 */
  autoAnnotateSentences: boolean;
}

/** 预设持久化结构 */
export interface AiPresetStoreData {
  presets: AiPreset[];
  activeId: string;
}

export function normalizePreset(raw: any, fallbackId?: string): AiPreset {
  const r = raw && typeof raw === "object" ? raw : {};
  const ctx = typeof r.contextMessages === "number" ? r.contextMessages : -1;
  const temp = typeof r.temperature === "number" ? r.temperature : 0.3;
  const tt = r.templateType === "chat" ? "chat" : "learning";
  return {
    id: typeof r.id === "string" && r.id ? r.id : fallbackId || genId(),
    name: typeof r.name === "string" ? r.name : "未命名预设",
    templateType: tt,
    contextMessages: Math.max(-1, Math.min(100, Math.round(ctx))),
    temperature: Math.max(0, Math.min(2, temp)),
    temperatureEnabled: !!r.temperatureEnabled,
    systemPrompt: typeof r.systemPrompt === "string" ? r.systemPrompt : "",
    autoCollectWords: !!r.autoCollectWords,
    autoAnnotateSentences: !!r.autoAnnotateSentences,
  };
}

/** 默认预设：REword 英语生词精读（开箱即用，learning 型，约束自由对话为结构化精读） */
export function buildDefaultPresets(): AiPreset[] {
  const p = normalizePreset({
    id: genId(),
    name: "英语生词精读",
    templateType: "learning",
    contextMessages: -1,
    temperature: 0.3,
    temperatureEnabled: false,
    systemPrompt: "",
    autoCollectWords: true,
    autoAnnotateSentences: true,
  });
  return [p];
}

export class AiPresetStore {
  private data: AiPresetStoreData = { presets: [], activeId: "" };
  private onChange?: () => void | Promise<void>;

  constructor(onChange?: () => void | Promise<void>) {
    this.onChange = onChange;
  }

  /** 从持久化 JSON 水合；空/非法时留空（不自动播种默认预设，2026-08-16 调整） */
  load(raw: unknown): void {
    const presets = Array.isArray((raw as any)?.presets)
      ? (raw as any).presets.map((p: any) => normalizePreset(p))
      : [];
    const activeId =
      typeof (raw as any)?.activeId === "string" ? (raw as any).activeId : "";

    // 空库即空：无预设 = 自由对话（无模板约束）；不再自动播种默认预设
    this.data = {
      presets,
      activeId: presets.some((p: AiPreset) => p.id === activeId) ? activeId : "",
    };
  }

  export(): AiPresetStoreData {
    return JSON.parse(JSON.stringify(this.data));
  }

  list(): AiPreset[] {
    return this.data.presets;
  }

  get(id: string): AiPreset | undefined {
    return this.data.presets.find((p) => p.id === id);
  }

  getActive(): AiPreset | undefined {
    return this.data.presets.find((p) => p.id === this.data.activeId);
  }

  /** 新增或更新（按 id）；返回该预设 */
  async upsert(input: Partial<AiPreset> & { name: string }): Promise<AiPreset> {
    const existing = input.id ? this.get(input.id) : undefined;
    const preset = normalizePreset(
      { ...(existing || {}), ...input },
      existing?.id
    );
    if (existing) {
      const idx = this.data.presets.findIndex((p) => p.id === existing.id);
      this.data.presets[idx] = preset;
    } else {
      this.data.presets.push(preset);
    }
    await this.persist();
    return preset;
  }

  async setActive(id: string): Promise<void> {
    if (this.data.presets.some((p) => p.id === id)) {
      this.data.activeId = id;
      await this.persist();
    }
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.data.presets.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.data.presets.splice(idx, 1);
    if (this.data.activeId === id) {
      this.data.activeId = this.data.presets[0]?.id || "";
    }
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    if (this.onChange) {
      try {
        await this.onChange();
      } catch (e) {
        getLogger().warn("[REword] 预设持久化失败:", { error: e });
      }
    }
  }
}
