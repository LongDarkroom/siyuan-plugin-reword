/**
 * 分类标签库（2026-08-14 新增；2026-08-15 拆分为词库标签 / 批注标签两个独立实例）
 * ------------------------------------------------------------------
 * 替代旧的流程标签（doubt/todo/important/favorite）：
 *  - 自定义主题标签（#科技 #环保 #医学 #法律 #经济 等），可增删改
 *  - 同一套 LabelStore 逻辑被实例化两次：词库标签持久化 hiword-vocab-labels.json、
 *    批注标签持久化 hiword-annotation-labels.json，二者 id 命名空间各自独立
 *  - 自动配色（10 色板轮转，删除的标签色可复用）
 *
 * 本模块不依赖 SiYuan SDK，可在 Node 下直接单测。
 */

import { getLogger } from "../core/logger.ts";

/** 一个分类标签 */
export interface AnnotationLabel {
  id: string;         // 如 "tech"（id 即名称 key；显示时加 #）
  name: string;       // 显示名：科技
  color: string;      // 自动分配（LABEL_COLORS 轮转）
  createdAt: string;  // 创建时间（ISO）
}

/** 持久化结构 */
export interface LabelStoreData {
  labels: AnnotationLabel[];
}

/** 自动配色色板（10 色，轮转复用） */
export const LABEL_COLORS = [
  "#0d9e5f", "#e6a23c", "#db3f84", "#5b6ee1", "#17a2b8",
  "#f06543", "#8b5cf6", "#6c757d", "#2f9e8f", "#b26b3a",
];

/** 预置标签（仅空库播种时写入；用户删除后不复活）
 *  主题分类：科技/环保/医学/法律/经济/教育/文化/生活/情感/职场（10）
 *  流程分类：重点/困难/待办/行程（4）—— 替代旧的 ANNOTATION_CATEGORIES 硬编码
 *  旧 category 字段在 annotation-store migrateLegacyCategoriesToLabels 中自动迁移到 labels
 */
export const DEFAULT_LABELS = [
  "科技", "环保", "医学", "法律", "经济",
  "教育", "文化", "生活", "情感", "职场",
  "重点", "困难", "待办", "行程",
];

function genId(name: string): string {
  // 用拼音/名称无法可靠生成，直接用时间戳+随机；名称本身作显示
  return "lbl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 颜色名归一（# 前导小写） */
function normColor(c: string): string {
  return c.startsWith("#") ? c.toLowerCase() : c;
}

/**
 * 分类标签存储。纯内存逻辑 + 可选 onChange 持久化钩子。
 */
export class LabelStore {
  private labels = new Map<string, AnnotationLabel>(); // id -> label
  private onChange?: () => void | Promise<void>;

  constructor(onChange?: () => void | Promise<void>) {
    this.onChange = onChange;
  }

  /** 从持久化数据载入；空库播种预置标签 */
  load(raw: unknown): void {
    this.labels.clear();
    const list = Array.isArray((raw as LabelStoreData)?.labels)
      ? (raw as LabelStoreData).labels
      : [];
    for (const it of list) {
      if (it && typeof it.id === "string" && typeof it.name === "string") {
        this.labels.set(it.id, {
          id: it.id,
          name: it.name,
          color: typeof it.color === "string" ? it.color : this.nextColor(),
          createdAt: typeof it.createdAt === "string" ? it.createdAt : nowIso(),
        });
      }
    }
    // 空库播种预置标签（用户删除后不再播种：labels.size 非 0 即跳过）
    if (this.labels.size === 0) {
      for (const name of DEFAULT_LABELS) {
        this.labels.set(genId(name), {
          id: genId(name),
          name,
          color: this.nextColor(),
          createdAt: nowIso(),
        });
      }
    }
  }

  /** 导出为可持久化结构 */
  toJSON(): LabelStoreData {
    return { labels: [...this.labels.values()] };
  }

  /** 全部标签（按创建顺序） */
  getAll(): AnnotationLabel[] {
    return [...this.labels.values()];
  }

  get(id: string): AnnotationLabel | undefined {
    return this.labels.get(id);
  }

  /** id -> color 映射（渲染用；未知 id 省略） */
  colorMap(): Record<string, string> {
    const m: Record<string, string> = {};
    for (const l of this.labels.values()) m[l.id] = l.color;
    return m;
  }

  /** 新增标签：去重（同名忽略大小写）→ 自动取色；返回最终对象 */
  add(name: string): AnnotationLabel {
    const n = (name || "").trim();
    if (!n) throw new Error("标签名称不能为空");
    // 去重：同名（忽略大小写）返回已有
    for (const l of this.labels.values()) {
      if (l.name.toLowerCase() === n.toLowerCase()) return l;
    }
    const created: AnnotationLabel = {
      id: genId(n),
      name: n,
      color: this.nextColor(),
      createdAt: nowIso(),
    };
    this.labels.set(created.id, created);
    void this.persist();
    return created;
  }

  /** 重命名标签 */
  rename(id: string, name: string): void {
    const l = this.labels.get(id);
    if (!l) return;
    const n = (name || "").trim();
    if (!n) return;
    // 去重保护
    for (const other of this.labels.values()) {
      if (other.id !== id && other.name.toLowerCase() === n.toLowerCase()) return;
    }
    l.name = n;
    void this.persist();
  }

  /** 删除标签：只删定义，不扫已标注数据（批注/词条中残留 id 显示为灰色） */
  remove(id: string): void {
    this.labels.delete(id);
    void this.persist();
  }

  /** 循环更换标签颜色（从 LABEL_COLORS 轮转，2026-08-15 新增） */
  cycleColor(id: string): string {
    const l = this.labels.get(id);
    if (!l) return "";
    const idx = LABEL_COLORS.indexOf(l.color);
    const next = LABEL_COLORS[(idx + 1 + LABEL_COLORS.length) % LABEL_COLORS.length];
    l.color = next;
    void this.persist();
    return next;
  }

  /** 标签数量 */
  get size(): number {
    return this.labels.size;
  }

  /** 自动取色：按现有标签数轮转 LABEL_COLORS（删除的标签色自动复用） */
  private nextColor(): string {
    return LABEL_COLORS[this.labels.size % LABEL_COLORS.length];
  }

  private async persist(): Promise<void> {
    if (this.onChange) {
      try {
        await this.onChange();
      } catch (e) {
        getLogger().warn("[REword] 标签持久化失败:", { error: e });
      }
    }
  }
}

// 保留 normColor 导出（供外部颜色归一，如确有需要）
export { normColor };
