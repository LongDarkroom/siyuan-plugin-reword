import { logSwallow } from "../core/safe.ts";
/**
 * 术语表（2026-08-31 Phase 3）
 * ------------------------------------------------------------------
 * 解决「专有名词前后不一致」：与「前文上下文 ctxBefore」配合，是提升一致性的
 * 另一半手段——前文靠模型自己推断，术语表则是硬性约束。
 *
 * 两条应用路径（都做，互为补充）：
 *  ① 译前注入 prompt：把术语表拼成提示块，要求模型遵守（对 LLM 有效）
 *  ② 译后字符串替换：模型没遵守时兜底，把译文里残留的原文术语换成指定译法
 *     （主要处理 AI 漏译 / 术语应保留原文的场景）
 *
 * 版本与缓存失效：
 *  任何词条变更都会 version++。上层把 version 并入翻译缓存的 salt，
 *  于是改术语表后相关译文自然查不到旧缓存 → 触发重译。
 *  version 从 0 开始，**只有 version > 0 时才并入 salt**，
 *  保证「从未用过术语表」的用户缓存完全不受影响。
 *
 * 依赖：无外部网络，纯插件本地数据（glossary.json）。
 */

export interface GlossaryTerm {
  /** 原文术语 */
  src: string;
  /** 指定译法（可与 src 相同，表示「不译、保留原文」） */
  dst: string;
  /** 是否区分大小写（默认否） */
  caseSensitive?: boolean;
  /** 备注（仅给用户看，不进 prompt） */
  note?: string;
}

export interface GlossaryData {
  /** 词条变更计数；并入缓存 salt 使旧译文失效 */
  version: number;
  terms: GlossaryTerm[];
}

/** 单本术语表过大既拖慢译后替换，也会把 prompt 撑爆 */
export const MAX_GLOSSARY_TERMS = 500;
/** 注入 prompt 的术语条数上限（超出只取前 N 条，避免 token 暴涨） */
export const MAX_PROMPT_TERMS = 120;

export const GLOSSARY_STORAGE_KEY = "glossary.json";

function escapeRegExp(s: string): string {
  return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CompiledTerm {
  re: RegExp;
  dst: string;
}

export class GlossaryStore {
  private data: GlossaryData = { version: 0, terms: [] };
  private saveFn: (d: GlossaryData) => void;
  /** 预编译正则，避免每段译文都重新构造 */
  private compiled: CompiledTerm[] = [];
  private compiledDirty = true;

  constructor(saveFn: (d: GlossaryData) => void) {
    this.saveFn = saveFn;
  }

  /** 从插件数据加载。格式异常时回退空表，不影响翻译主流程 */
  async load(loader: (k: string) => Promise<any>): Promise<void> {
    try {
      const raw = await loader(GLOSSARY_STORAGE_KEY);
      if (raw && typeof raw === "object" && Array.isArray((raw as GlossaryData).terms)) {
        const d = raw as GlossaryData;
        this.data = {
          version: Number.isFinite(d.version) ? Number(d.version) : 0,
          terms: d.terms
            .filter((t) => t && typeof t.src === "string" && t.src.trim())
            .slice(0, MAX_GLOSSARY_TERMS),
        };
        this.compiledDirty = true;
      }
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "glossary.ts · load", "debug");
    }
  }

  get version(): number {
    return this.data.version;
  }

  get terms(): GlossaryTerm[] {
    return this.data.terms;
  }

  /** 是否为空（为空时上层应跳过 prompt 注入与 salt 变更） */
  isEmpty(): boolean {
    return !this.data.terms.length;
  }

  private persist(): void {
    this.data.version += 1;
    this.compiledDirty = true;
    try {
      this.saveFn(this.data);
    } catch (__swallowErr) {
      logSwallow(__swallowErr, "glossary.ts · persist", "debug");
    }
  }

  add(term: GlossaryTerm): void {
    if (!term?.src?.trim()) return;
    if (this.data.terms.length >= MAX_GLOSSARY_TERMS) return;
    this.data.terms.push({
      src: term.src.trim(),
      dst: (term.dst ?? "").trim(),
      ...(term.caseSensitive ? { caseSensitive: true } : {}),
      ...(term.note ? { note: term.note } : {}),
    });
    this.persist();
  }

  removeAt(index: number): void {
    if (index < 0 || index >= this.data.terms.length) return;
    this.data.terms.splice(index, 1);
    this.persist();
  }

  updateAt(index: number, term: GlossaryTerm): void {
    if (index < 0 || index >= this.data.terms.length) return;
    if (!term?.src?.trim()) return;
    this.data.terms[index] = {
      src: term.src.trim(),
      dst: (term.dst ?? "").trim(),
      ...(term.caseSensitive ? { caseSensitive: true } : {}),
      ...(term.note ? { note: term.note } : {}),
    };
    this.persist();
  }

  /** 整体替换（导入场景） */
  replaceAll(terms: GlossaryTerm[]): void {
    this.data.terms = (terms || [])
      .filter((t) => t && typeof t.src === "string" && t.src.trim())
      .slice(0, MAX_GLOSSARY_TERMS)
      .map((t) => ({
        src: t.src.trim(),
        dst: (t.dst ?? "").trim(),
        ...(t.caseSensitive ? { caseSensitive: true } : {}),
        ...(t.note ? { note: t.note } : {}),
      }));
    this.persist();
  }

  clear(): void {
    if (!this.data.terms.length) return;
    this.data.terms = [];
    this.persist();
  }

  /**
   * 生成注入 prompt 的术语块。
   * 空表返回空串（上层据此跳过，不浪费 token）。
   */
  toPromptBlock(): string {
    const list = this.data.terms.filter((t) => t.src && t.dst);
    if (!list.length) return "";
    const shown = list.slice(0, MAX_PROMPT_TERMS);
    const lines = shown.map((t) => `- ${t.src} → ${t.dst}`);
    let block = `【术语表（以下术语必须严格按指定译法翻译，不得自行发挥）】\n${lines.join("\n")}`;
    if (list.length > shown.length) {
      block += `\n（另有 ${list.length - shown.length} 条术语未列出，请对同类专有名词保持前后一致的译法）`;
    }
    return block;
  }

  private ensureCompiled(): void {
    if (!this.compiledDirty) return;
    this.compiled = this.data.terms
      .filter((t) => t.src && t.dst)
      .map((t) => ({
        re: new RegExp(escapeRegExp(t.src), t.caseSensitive ? "g" : "gi"),
        dst: t.dst,
      }));
    this.compiledDirty = false;
  }

  /**
   * 译后兜底替换：把译文里残留的原文术语换成指定译法。
   *
   * 说明：这只处理「译文中仍出现原文术语」的情况（AI 漏译，或术语本就该保留原文）。
   * 如果 AI 把术语译成了别的中文，这里匹配不到——那种情况靠译前 prompt 约束。
   *
   * 幂等：若 src === dst（保留原文），替换后文本不变。
   */
  apply(text: string): string {
    if (!text || !this.data.terms.length) return text;
    this.ensureCompiled();
    if (!this.compiled.length) return text;
    let out = text;
    for (const c of this.compiled) {
      out = out.replace(c.re, c.dst);
    }
    return out;
  }
}
