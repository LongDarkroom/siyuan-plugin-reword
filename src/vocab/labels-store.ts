/**
 * 全局标签元数据独立存储（2026-09-11 新增）
 * ------------------------------------------------------------------
 * 设计与 VocabStore 解耦：
 *  - VocabStore 管理 WordRecord.labels: string[]（实际数据，每个词自己一份）
 *  - VocabLabelsStore 管理 VocabLabel（color/description/createdAt 元数据，按 name 索引）
 *  - 持久化：hiword-vocab-labels.json（独立文件，不污染 hiword-vocab.json）
 *
 * 为什么不把 color 等放 WordRecord.labels：
 *  - 词上只存名字（string[]），保持 WordRecord 紧凑
 *  - color 改一次全网生效，存词上会冗余
 *  - 不同词对同一 label 的"显示色"应该一致
 *
 * 6 个全局操作（VocabStore 上）：
 *  - getAllLabels()          聚合（按 name 去重 + 元数据合并 + wordCount 实时计算）
 *  - getWordsByLabel(label)  按 label 筛所有词
 *  - renameLabel(from, to)   全局重命名（同时改词的 labels 数组 + 元数据）
 *  - mergeLabels([froms],to) 合并 N 个标签到 1 个
 *  - deleteLabel(label)      全局删除（词的 labels 数组去掉 + 元数据删除）
 *
 * 零 DOM / 思源依赖，可独立单测。
 */

import { getLogger } from "../core/logger.ts";
import type { VocabLabel } from "../types.ts";

/** 持久化 key（思源 saveData 第二参数） */
export const LABELS_STORAGE_KEY = "hiword-vocab-labels.json";

/** 默认标签色（无元数据时 fallback） */
export const DEFAULT_LABEL_COLOR = "#6b7280";

/**
 * 全局标签元数据 store
 * 与 VocabStore 平行：两者职责清晰，互不耦合
 */
export class VocabLabelsStore {
  private labels = new Map<string, VocabLabel>();
  private onChange?: () => void | Promise<void>;
  /** 2026-09-11 加载守卫：与 VocabStore.loaded 同款（防初始化竞态） */
  private loaded = false;

  constructor(onChange?: () => void | Promise<void>) {
    this.onChange = onChange;
  }

  /** 从持久化 JSON 水合；不存在或格式错时建空 */
  load(raw: unknown): void {
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (this.isValidLabel(item)) {
          this.labels.set(item.name, item);
        } else {
          getLogger().warn("[REword][labels] 跳过非法 label 项");
        }
      }
    }
    this.loaded = true;
  }

  /** 序列化（写盘） */
  export(): VocabLabel[] {
    return Array.from(this.labels.values());
  }

  /** 调试用：返回当前元数据 map 大小 */
  __size(): number {
    return this.labels.size;
  }

  /** 调试用：loaded 守卫（与 VocabStore.__isLoaded 配套） */
  __isLoaded(): boolean {
    return this.loaded;
  }

  /** 取单个标签元数据 */
  get(name: string): VocabLabel | undefined {
    return this.labels.get(name);
  }

  /** 列出所有元数据（无 wordCount；调用方用 getAllLabels 聚合） */
  list(): VocabLabel[] {
    return Array.from(this.labels.values());
  }

  /**
   * 取标签的显示色（无元数据时返回默认色）
   * 给 UI 层用：避免每次查 get() + 判空
   */
  getColor(name: string): string {
    return this.labels.get(name)?.color ?? DEFAULT_LABEL_COLOR;
  }

  /** 新增/更新元数据（仅改元数据，不动词的 labels 数组） */
  async upsert(label: VocabLabel): Promise<void> {
    this.labels.set(label.name, label);
    await this.persist();
  }

  /** 删除元数据（仅元数据；词的 labels 数组由 VocabStore.deleteLabel 同步去） */
  async delete(name: string): Promise<boolean> {
    const ok = this.labels.delete(name);
    if (ok) await this.persist();
    return ok;
  }

  /**
   * 重命名元数据（from → to）
   * 注意：词的 labels 数组里的字符串同步由 VocabStore.renameLabel 负责（先元数据后词数组）
   * 元数据重命名后 color/description/createdAt 保留
   */
  async rename(from: string, to: string): Promise<boolean> {
    const entry = this.labels.get(from);
    if (!entry) return false;
    if (this.labels.has(to)) return false; // 目标已存在，让上层决定如何合并
    this.labels.delete(from);
    this.labels.set(to, { ...entry, name: to });
    await this.persist();
    return true;
  }

  /** 浅校验：name/color/createdAt 必填 */
  private isValidLabel(item: unknown): item is VocabLabel {
    if (!item || typeof item !== "object") return false;
    const l = item as VocabLabel;
    return (
      typeof l.name === "string" &&
      l.name.length > 0 &&
      typeof l.color === "string" &&
      typeof l.createdAt === "string"
    );
  }

  private async persist(): Promise<void> {
    if (!this.loaded) return;
    if (this.onChange) {
      try {
        await this.onChange();
      } catch (e) {
        getLogger().warn("[REword][labels] 持久化失败:", { error: e });
      }
    }
  }
}
