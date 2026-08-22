/**
 * 批注（高亮标注）数据层 —— 方案 C
 * ------------------------------------------------------------------
 * 设计哲学：
 *  - 批注数据完全独立于思源正文，存储在插件侧 `hiword-annotations.json`，
 *    正文文本节点永远不被修改，因此「删除插件后零正文污染」。
 *  - 仅在块（block）层面打标记（class），不做 WYSIWYG 文本注入，避免光标/撤销风险。
 *  - 数据模型从第一天起就内建 AI 联动字段（origin / ai），为 #25 预留。
 *
 * 本模块**不依赖 SiYuan SDK**，可在 Node 下直接单测（upsert 去重 / 列表排序等）。
 */

import { getLogger } from "../core/logger.ts";
import { htmlToMd } from "./lute.ts";
import { stripIal } from "./annotation-render.ts";

/** 批注来源 */
export type AnnotationOrigin = "manual" | "ai";

/** 批注作用域：word=单词背景高亮；sentence=句子线型格式；both=背景高亮+下划线叠加（2026-08-15 新增） */
export type AnnotationScope = "word" | "sentence" | "both";

/**
 * 下划线样式 —— 鲸鱼风格 5 种线型 × 7 色 = 35 组合
 *  solid   = 一般笔记 / 默认（单实线）
 *  wavy    = 生词 / 不认识（波浪线，醒目）
 *  dashed  = 似懂非懂 / 模糊（虚线，提示需确认）
 *  double  = 已掌握 / 重点（双实线，强调）
 *  dotted  = 待复习 / 提醒（点线，轻量提示）
 */
export type AnnotationStyle = "solid" | "wavy" | "dashed" | "double" | "dotted";

/** 内置下划线样式定义（5 种线型） */
export const ANNOTATION_STYLES: Record<AnnotationStyle, { label: string; css: string; hint: string; icon: string }> = {
  solid:  { label: "单实线", css: "solid", hint: "一般笔记", icon: "━" },
  wavy:   { label: "波浪线", css: "wavy", hint: "生词 / 不认识", icon: "﹏" },
  dashed: { label: "虚线",   css: "dashed", hint: "似懂非懂", icon: "┄" },
  double: { label: "双实线", css: "double", hint: "已掌握 / 重点", icon: "═" },
  dotted: { label: "点线",   css: "dotted", hint: "待复习 / 提醒", icon: "┉" },
};

/** 鲸鱼风格 7 色调色板 */
export const WHALE_COLORS = [
  { name: "石板灰", value: "#9ca3af", hex: "#9ca3af" },  // 0: 灰
  { name: "明黄",   value: "#facc15", hex: "#facc15" },  // 1: 黄
  { name: "翠绿",   value: "#22c55e", hex: "#22c55e" },  // 2: 绿
  { name: "青蓝",   value: "#06b6d4", hex: "#06b6d4" },  // 3: 青
  { name: "玫粉",   value: "#ec4899", hex: "#ec4899" },  // 4: 粉
  { name: "橙色",   value: "#f97316", hex: "#f97316" },  // 5: 橙
  { name: "紫罗兰", value: "#8b5cf6", hex: "#8b5cf6" },  // 6: 紫
] as const;

/**
 * 6 套预设快捷样式 —— 英语学习场景映射（规范方案三）
 * 解决「样式滥用导致界面杂乱」：日常批注只从这 6 套里选，
 * 颜色 + 线型被绑定为一个语义组合，避免 7×5=35 种任意混搭。
 */
export interface WhalePreset {
  key: string;
  name: string;          // 预设名（如「生词突击」）
  color: string;         // 颜色 value（WHALE_COLORS 之一）
  style: AnnotationStyle;// 线型
  colorName: string;     // 颜色中文名
  styleName: string;     // 线型中文名
  scene: string;         // 适用场景说明
  intensity: "极强" | "中强" | "中等" | "温和"; // 视觉强度
  icon: string;          // 预览图标
  /**
   * 标注方式分组（2026-08-15 新增）—— 按学习场景归为 3 大类，
   * 弹窗头部「高亮/线段/标签」大类按钮与快捷样式 chips 分组渲染共用：
   *  - highlight：单词级（背景高亮）
   *  - line：句子级（线型下划线）
   *  - label：语义标签（文化/背景知识类，弱视觉）
   */
  group: "highlight" | "line" | "label";
}

/** 6 套预设（按视觉强度降序，弹窗 / 面板共用） */
export const WHALE_PRESETS: WhalePreset[] = [
  {
    key: "new-word", name: "生词突击",
    color: "#facc15", style: "wavy", colorName: "明黄", styleName: "波浪",
    scene: "完全不认识的单词，需查词典+记音标", intensity: "极强", icon: "﹏",
    group: "highlight",
  },
  {
    key: "fuzzy", name: "模糊待定",
    color: "#22c55e", style: "dotted", colorName: "翠绿", styleName: "点线",
    scene: "见过但不确定意思，下次阅读时优先确认", intensity: "中强", icon: "┉",
    group: "highlight",
  },
  {
    key: "syntax", name: "句法核心",
    color: "#f97316", style: "double", colorName: "橙色", styleName: "双实",
    scene: "从句/倒装/虚拟语气等语法结构，写作可仿", intensity: "中等", icon: "═",
    group: "line",
  },
  {
    key: "trap", name: "易错预警",
    color: "#ec4899", style: "dashed", colorName: "玫粉", styleName: "虚线",
    scene: "形近词/时态混淆/介词搭配错误", intensity: "中强", icon: "┄",
    group: "line",
  },
  {
    key: "culture", name: "文化注释",
    color: "#06b6d4", style: "solid", colorName: "青蓝", styleName: "实线",
    scene: "背景知识/作者意图/文化典故", intensity: "温和", icon: "━",
    group: "label",
  },
  {
    key: "logic", name: "逻辑脉络",
    color: "#8b5cf6", style: "double", colorName: "紫罗兰", styleName: "双实",
    scene: "段落论点/论证关系/文章结构", intensity: "中等", icon: "═",
    group: "line",
  },
];

/** 根据 key 查找预设（找不到返回 undefined） */
export function findPreset(key: string): WhalePreset | undefined {
  return WHALE_PRESETS.find((p) => p.key === key);
}

/** 根据 color+style 匹配预设（找不到返回 undefined） */
export function matchPreset(color?: string, style?: string): WhalePreset | undefined {
  if (!color || !style) return undefined;
  return WHALE_PRESETS.find((p) => p.color === color && p.style === style);
}

/** 批注分类（2026-08-14 弃用：硬编码 chips 已移除；保留类型仅用于兼容旧数据字段） */
export type AnnotationCategory = "important" | "hard" | "todo" | "schedule";

/** 语义化标签 —— 2026-08-14 移除流程标签（doubt/todo/important/favorite），
    改为分类标签体系（label-store.ts，可自定义 #科技 #环保 等）。 */

/** AI 生成批注的附属信息（预留 AI 联动，#25 使用） */
export interface AnnotationAiMeta {
  model?: string;      // 生成所用模型（如 gpt-4o / claude-3.5）
  content?: string;    // AI 原始返回内容（可长于 note，含推理/备选）
  createdAt?: string;  // AI 生成时间（ISO）
  prompt?: string;     // 实际使用的 prompt 模板（调试 / 追溯）
}

/** 一条批注 */
export interface AnnotationItem {
  id: string;            // 唯一 ID
  blockId: string;       // 所属块 ID（思源 data-node-id）
  docId: string;         // 所属文档根 ID（root_id），便于跳转与聚合
  sentence: string;      // 批注锚定的上下文句子（只读展示，不改正文）
  selectedText: string;  // 用户实际选中的精确文本（用于行内高亮定位）
  start?: number;        // 选中文本在块 textContent 中的起始偏移（2026-08-17：用于稳定定位）
  end?: number;          // 选中文本在块 textContent 中的结束偏移
  note: string;          // 批注正文（用户书写或 AI 生成）
                         // 【存储格式 D9 2026-08-18】统一为 Kramdown（思源原生，含块引用/标签/公式）；
                         // 历史 HTML 仅在加载/写入时经归一化转 Kramdown，不再持久化 HTML。
                         // 【纯标注语义 2026-08-15】note === ""（空字符串）表示「纯颜色标注」：
                         // 只上色/画线/打标签，无文字注释。渲染层据此隐藏「批注」区、弹窗提供「仅标注」快捷保存。
  noteFormat?: "html" | "kramdown"; // 历史兼容：load 时嗅探补默认；新写入一律 "kramdown"
  version?: number;      // note 归一化/修改版本号，便于乐观锁与迁移追踪
  origin: AnnotationOrigin; // 来源：手动 / AI
  color?: string;        // 批注颜色（背景高亮色；取值见 WHALE_COLORS，默认 #06b6d4 青）
  style?: AnnotationStyle; // 下划线样式（默认 solid）
  scope?: AnnotationScope; // 作用域：word=背景高亮；sentence=线型格式；both=背景+下划线叠加（默认 word）
  lineColor?: string;    // 下划线颜色（2026-08-15 新增：与背景色 color 独立，缺省 = color）
  tags?: string[];       // 旧流程标签（doubt/todo/important/favorite，已废弃保留兼容）
  labels?: string[];     // 分类标签 id 数组（label-store.ts，#科技 #环保 等）
  category?: AnnotationCategory; // 分类（important/hard/todo/schedule）
  createdAt: string;     // 创建时间（ISO）
  updatedAt: string;     // 更新时间（ISO）
  ai?: AnnotationAiMeta; // 仅 origin==="ai" 或曾用 AI 时存在
}

/** 持久化结构 */
export interface AnnotationStoreData {
  annotations: AnnotationItem[];
}

/** 新增 / 更新批注的输入（缺省字段由 store 补全） */
export interface AnnotationInput {
  blockId: string;
  docId: string;
  sentence: string;
  selectedText: string;  // 用户实际选中的精确文本
  start?: number;        // 选中文本在块 textContent 中的起始偏移（2026-08-17）
  end?: number;          // 选中文本在块 textContent 中的结束偏移
  note: string;
  origin?: AnnotationOrigin;
  color?: string;        // 批注颜色（背景高亮色，WHALE_COLORS）
  style?: AnnotationStyle; // 下划线样式
  scope?: AnnotationScope; // 作用域：word=高亮 / sentence=线型 / both=叠加（默认 word）
  lineColor?: string;    // 下划线颜色（2026-08-15 新增，缺省 = color）
  tags?: string[];       // 旧流程标签（保留兼容）
  labels?: string[];     // 分类标签 id 数组
  category?: AnnotationCategory; // 分类
  ai?: AnnotationAiMeta;
  id?: string;           // 更新已有批注时传入
  noteFormat?: "html" | "kramdown"; // 预留（写入时由 store 强制置 kramdown）
  version?: number;      // 预留（写入时由 store 递增）
  expectedUpdatedAt?: string; // 乐观锁：若与库中 updatedAt 不一致则抛 ConflictError
}

/** 检测 note 是否含 HTML 标签（用于格式嗅探） */
const HTML_TAG_RE = /<[a-z][\s\S]*>/i;

/** 载入时嗅探 note 格式：含 HTML 标签视为旧 "html"，否则 "kramdown" */
function detectNoteFormat(note: string): "html" | "kramdown" {
  if (!note) return "kramdown";
  return HTML_TAG_RE.test(note) ? "html" : "kramdown";
}

/**
 * 归一化为 Kramdown（D9）：含 HTML 标签时经 Lute HTML2Md 转换；否则原样返回。
 * 转换失败保留原值，不抛错。
 */
function normalizeNoteToKramdown(note: string): string {
  if (!note || !HTML_TAG_RE.test(note)) return note;
  try { return htmlToMd(note); } catch { return note; }
}

/** 乐观锁冲突错误（upsert 传入 expectedUpdatedAt 且不一致时抛出） */
export class ConflictError extends Error {
  readonly annId: string;
  constructor(annId: string) {
    super(`批注 ${annId} 已被其他编辑会话修改，保存冲突`);
    this.name = "ConflictError";
    this.annId = annId;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function genId(): string {
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "ann-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/**
 * 去重键：同一块内、同一句子、同一选中文本视为同一条批注。
 * 2026-08-17 修复：旧键仅 (blockId, sentence)，导致同一句内给多个不同词分别批注时
 * 后者覆盖前者（数据丢失 + 仅一条高亮）。现纳入 selectedText，使「一句多词」各自独立。
 * upsert 时按此键覆盖而非新增，避免重复批注。
 */
export function annotationKey(blockId: string, sentence: string, selectedText = ""): string {
  return `${blockId}::${sentence}::${selectedText}`;
}

/**
 * 批注存储。纯内存逻辑 + 可选 onChange 持久化钩子。
 * 插件侧负责：onload 时 load(raw) 载入，onChange 时 saveData 落盘。
 */
export class AnnotationStore {
  private items = new Map<string, AnnotationItem>();
  private byKey = new Map<string, string>(); // annotationKey -> id
  private onChange?: () => void | Promise<void>;

  constructor(onChange?: () => void | Promise<void>) {
    this.onChange = onChange;
  }

  /** 从持久化数据载入（容错：非法 / 旧结构不抛错，仅收集有效项） */
  load(raw: any): void {
    this.items.clear();
    this.byKey.clear();
    const list = Array.isArray(raw?.annotations) ? raw.annotations : [];
    for (const it of list) {
      if (it && typeof it.id === "string" && typeof it.blockId === "string") {
        const item = it as AnnotationItem;
        const normalized: AnnotationItem = {
          ...item,
          noteFormat: item.noteFormat ?? detectNoteFormat(item.note),
          version: item.version ?? 0,
        };
        this.items.set(normalized.id, normalized);
        this.byKey.set(annotationKey(normalized.blockId, normalized.sentence || "", normalized.selectedText || ""), normalized.id);
      }
    }
  }

  /**
   * 旧数据归一化（D3，2026-08-18）：把 noteFormat!=="kramdown" 的批注一次性转为 Kramdown。
   * html2md 由调用方注入（通常传 `lute.htmlToMd`）；无 Lute 时注入空操作降级函数即可。
   * 单项失败 catch 后保留原值并计入 failed，整体不抛。
   * @returns { total, converted, failed }
   */
  async migrate(opts: { html2md: (html: string) => string }): Promise<{ total: number; converted: number; failed: number }> {
    let converted = 0, failed = 0;
    const all = [...this.items.values()];
    for (const it of all) {
      if (it.noteFormat === "kramdown") continue;
      const raw = it.note || "";
      if (!raw) {
        // 纯标注空 note：直接置目标格式，无需转换
        it.noteFormat = "kramdown";
        it.version = (it.version ?? 0) + 1;
        continue;
      }
      try {
        const md = opts.html2md(raw);
        if (md !== raw) converted++;
        it.note = md;
        it.noteFormat = "kramdown";
        it.version = (it.version ?? 0) + 1;
      } catch (e) {
        failed++;
        getLogger().warn(`[REword-Store] 批注迁移失败，保留原值 id=${it.id}`, { error: e });
      }
    }
    if (converted > 0 || failed > 0) await this.emit();
    return { total: all.length, converted, failed };
  }

  /**
   * 存量数据清洗（2026-08-18）：剥离所有批注 note/sentence/selectedText 中混入的裸 kramdown IAL
   * （`{.: id="…" updated="…"}` / `{: …}` / `{.class}` / `{#id}` 等），避免历史数据在浮层 / 面板
   * 里显示成「ID 码」。
   *  - 纯函数式清洗，无 Lute 依赖，可在 Node 单测；
   *  - 仅当内容变化时才 bump 版本并 emit 落盘，避免无谓写入；
   *  - 同时重建去重索引（sentence/selectedText 变化会影响 byKey）。
   * @returns 被清理的条数
   */
  async cleanIal(): Promise<number> {
    let cleaned = 0;
    for (const it of this.items.values()) {
      const n = stripIal(it.note || "");
      const s = stripIal(it.sentence || "");
      const sel = stripIal(it.selectedText || "");
      let changed = false;
      if (n !== (it.note || "")) { it.note = n; changed = true; }
      if (s !== (it.sentence || "")) { it.sentence = s; changed = true; }
      if (sel !== (it.selectedText || "")) { it.selectedText = sel; changed = true; }
      if (changed) { it.version = (it.version ?? 0) + 1; cleaned++; }
    }
    if (cleaned > 0) {
      this.reindexKeys();
      await this.emit();
    }
    return cleaned;
  }

  /** 导出为可持久化结构 */
  toJSON(): AnnotationStoreData {
    return { annotations: [...this.items.values()] };
  }

  /** 全部批注（按 createdAt 倒序，供面板展示） */
  getAll(): AnnotationItem[] {
    return [...this.items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): AnnotationItem | undefined {
    return this.items.get(id);
  }

  /** 某块下的全部批注（供块级标记 #23） */
  getByBlock(blockId: string): AnnotationItem[] {
    return [...this.items.values()].filter((a) => a.blockId === blockId);
  }

  /** 是否已对某块的某句子 + 选中文本做过批注 */
  exists(blockId: string, sentence: string, selectedText = ""): boolean {
    return this.byKey.has(annotationKey(blockId, sentence, selectedText));
  }

  /** 某块下是否有任意批注（供标记判断） */
  hasBlock(blockId: string): boolean {
    return this.getByBlock(blockId).length > 0;
  }

  /** 全部被批注的块 ID 集合（供 #23 一次性打标） */
  annotatedBlockIds(): string[] {
    return [...new Set([...this.items.values()].map((a) => a.blockId))];
  }

  /**
   * 新增或更新一条批注（核心 upsert）。
   *  - 传入 id 且存在：按 id 更新 note/ai，刷新 updatedAt（createdAt 不变）。
   *  - 否则按 (blockId, sentence) 去重：已存在则覆盖 note（保留原 createdAt）。
   *  - 否则新增，生成 id 与 createdAt。
   * 返回最终落库的批注对象。
   */
  async upsert(input: AnnotationInput): Promise<AnnotationItem> {
    const ts = nowIso();
    // 2026-08-18：落库前先剥 IAL，防止块导出的 `{.: id="…" updated="…"}` 等属性码被写进 note/sentence/selectedText
    const cleanNote = stripIal(input.note ?? "");
    const cleanSentence = stripIal(input.sentence ?? "");
    const cleanSelected = stripIal(input.selectedText ?? "");

    // 1) 显式按 id 更新
    if (input.id && this.items.has(input.id)) {
      const prev = this.items.get(input.id)!;
      if (input.expectedUpdatedAt !== undefined && prev.updatedAt !== input.expectedUpdatedAt) {
        throw new ConflictError(prev.id);
      }
      const note = normalizeNoteToKramdown(cleanNote);
      const updated: AnnotationItem = {
        ...prev,
        blockId: input.blockId || prev.blockId,
        docId: input.docId || prev.docId,
        sentence: input.sentence !== undefined ? cleanSentence : prev.sentence,
        selectedText: cleanSelected || prev.selectedText,
        start: input.start ?? prev.start,
        end: input.end ?? prev.end,
        note,
        noteFormat: "kramdown",
        version: (prev.version ?? 0) + 1,
        origin: input.origin || prev.origin,
        color: input.color || prev.color,
        style: input.style || prev.style,
        scope: input.scope ?? prev.scope,
        lineColor: input.lineColor || prev.lineColor || input.color || prev.color,
        tags: input.tags ?? prev.tags,
        labels: input.labels ?? prev.labels,
        category: input.category ?? prev.category,
        ai: input.ai ? { ...prev.ai, ...input.ai } : prev.ai,
        updatedAt: ts,
      };
      this.items.set(updated.id, updated);
      this.reindexKeys();
      await this.emit();
      return updated;
    }

    // 2) 按 (blockId, sentence, selectedText) 去重覆盖（2026-08-17：纳入 selectedText）
    const key = annotationKey(input.blockId, cleanSentence, cleanSelected);
    const existingId = this.byKey.get(key);
    if (existingId && this.items.has(existingId)) {
      const prev = this.items.get(existingId)!;
      if (input.expectedUpdatedAt !== undefined && prev.updatedAt !== input.expectedUpdatedAt) {
        throw new ConflictError(prev.id);
      }
      const note = normalizeNoteToKramdown(cleanNote);
      const updated: AnnotationItem = {
        ...prev,
        note,
        noteFormat: "kramdown",
        version: (prev.version ?? 0) + 1,
        start: input.start ?? prev.start,
        end: input.end ?? prev.end,
        origin: input.origin || prev.origin,
        color: input.color || prev.color,
        style: input.style || prev.style,
        scope: input.scope ?? prev.scope,
        lineColor: input.lineColor || prev.lineColor || input.color || prev.color,
        tags: input.tags ?? prev.tags,
        labels: input.labels ?? prev.labels,
        category: input.category ?? prev.category,
        ai: input.ai ? { ...prev.ai, ...input.ai } : prev.ai,
        updatedAt: ts,
      };
      this.items.set(updated.id, updated);
      await this.emit();
      return updated;
    }

    // 3) 新增
    const note = normalizeNoteToKramdown(cleanNote);
    const created: AnnotationItem = {
      id: input.id || genId(),
      blockId: input.blockId,
      docId: input.docId,
      sentence: cleanSentence,
      selectedText: cleanSelected,
      start: input.start,
      end: input.end,
      note,
      noteFormat: "kramdown",
      version: 1,
      origin: input.origin || "manual",
      color: input.color || WHALE_COLORS[3].value, // 默认青色
      style: input.style,
      scope: input.scope ?? "word", // 默认单词模式（背景高亮）
      lineColor: input.lineColor || input.color || WHALE_COLORS[3].value,
      tags: input.tags || [],
      labels: input.labels || [],
      category: input.category,
      createdAt: ts,
      updatedAt: ts,
      ai: input.origin === "ai" ? (input.ai || {}) : input.ai,
    };
    this.items.set(created.id, created);
    this.byKey.set(key, created.id);
    await this.emit();
    return created;
  }

  /** 删除批注，返回是否真的删除成功 */
  async remove(id: string): Promise<boolean> {
    const it = this.items.get(id);
    if (!it) return false;
    this.items.delete(id);
    this.byKey.delete(annotationKey(it.blockId, it.sentence || "", it.selectedText || ""));
    await this.emit();
    return true;
  }

  /** 清空全部批注（2026-08-17 修复 footer「清空全部」死按钮）：一次性清空并落盘 */
  async clearAll(): Promise<number> {
    const count = this.items.size;
    if (count === 0) return 0;
    this.items.clear();
    this.byKey.clear();
    await this.emit();
    return count;
  }

  /**
   * 回收孤儿批注：来源块已不存在（被删除/移动）的批注从存储中清除。
   * blockExists 由调用方注入（如 SiYuan 文档 DOM 或 /api/query 校验），
   * 保持存储层与外部环境解耦、可单测。
   * @returns 被回收的条数
   */
  async pruneOrphans(blockExists: (blockId: string) => boolean): Promise<number> {
    const orphans = [...this.items.values()].filter((a) => !blockExists(a.blockId));
    if (orphans.length === 0) return 0;
    for (const o of orphans) {
      this.items.delete(o.id);
      this.byKey.delete(annotationKey(o.blockId, o.sentence || "", o.selectedText || ""));
    }
    await this.emit();
    return orphans.length;
  }

  /** 统计批注条数 */
  get size(): number {
    return this.items.size;
  }

  /**
   * 2026-08-14 改造：将旧硬编码 category 字段与旧 tags 字段（doubt/todo/important/favorite）
   * 统一迁移到 labels 体系。返回被改动的批注数。
   *
   * @param nameResolver category（如 "important"）→ 中文标签名（如 "重点"）的映射函数；
   *                    若返回 null/undefined 跳过该 category
   * @param labelNameToId  labelStore 当前所有标签的 name → id 映射
   *
   * 用法（在 index.ts 启动后调一次）：
   *   const map = { important: "重点", hard: "困难", todo: "待办", schedule: "行程" };
   *   const tagsMap = { doubt: "存疑", todo: "待办", important: "重点", favorite: "爱心" };
   *   await annotationStore.migrateLegacyCategoriesToLabels(
   *     (cat) => map[cat] || null,
   *     (name) => labelStore.getAll().find(l => l.name === name)?.id
   *   );
   */
  async migrateLegacyCategoriesToLabels(
    nameResolver: (cat: AnnotationCategory) => string | null,
    labelNameToId: (name: string) => string | undefined
  ): Promise<number> {
    let changed = 0;
    for (const [id, ann] of this.items) {
      const set = new Set(ann.labels || []);
      let touched = false;
      // 1) 旧 category → labels
      if (ann.category) {
        const targetName = nameResolver(ann.category as AnnotationCategory);
        if (targetName) {
          const labelId = labelNameToId(targetName);
          if (labelId && !set.has(labelId)) { set.add(labelId); touched = true; }
        }
      }
      // 2) 旧 tags 字段（流程标签） → 对应 labels
      const tagsMap: Record<string, string> = { doubt: "存疑", todo: "待办", important: "重点", favorite: "爱心" };
      for (const oldTag of ann.tags || []) {
        const targetName = tagsMap[oldTag];
        if (targetName) {
          const labelId = labelNameToId(targetName);
          if (labelId && !set.has(labelId)) { set.add(labelId); touched = true; }
        }
      }
      if (touched) {
        // 用 upsert 写回（按 id 更新），保留其它字段
        await this.upsert({ id: ann.id, blockId: ann.blockId, docId: ann.docId, sentence: ann.sentence, selectedText: ann.selectedText || "", note: ann.note, labels: [...set] });
        changed++;
      }
    }
    if (changed > 0) getLogger().info(`[REword] 旧 category/tags → labels 迁移完成（${changed} 条）`);
    return changed;
  }

  private reindexKeys(): void {
    this.byKey.clear();
    for (const it of this.items.values()) {
      this.byKey.set(annotationKey(it.blockId, it.sentence || "", it.selectedText || ""), it.id);
    }
  }

  private async emit(): Promise<void> {
    if (this.onChange) {
      try {
        await this.onChange();
      } catch (e) {
        getLogger().warn("[REword] annotation onChange 失败:", { error: e });
      }
    }
  }
}
