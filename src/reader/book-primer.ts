/**
 * 本书前提上下文（Book Primer）存储
 * ------------------------------------------------------------------
 * 2026-08-28 v1.3.0 新增。
 *
 * 背景：AI 批量翻译是无状态的——每次只看到当前这批发过去的段落，
 * 不知道前文已把 "Sludge" 译成「斯拉奇（狗名）」，于是后文又翻成「烂泥」。
 * 解法：让用户为每本书手写一份「前提上下文」（人物对照 / 背景 / 译法要求），
 * 翻译时拼进 prompt 前缀，使专有名词全书一致。
 *
 * 设计取舍（相比「AI 自动提取术语表」）：
 *  - 零额外 token：不需要任何提取调用；
 *  - 零误判风险：AI 提取一旦出错会把错误术语写进缓存，后续全跟着错且难发现；
 *  - 用户完全可控，且比自动提取更准（一句话就能定死一个译法）。
 *
 * 存储：Kramdown 原文（不是渲染后的 HTML）。
 *  - 发给 AI 用 Markdown 原文比 HTML 省 60%+ token，且模型完全理解 Markdown；
 *  - Lute 只服务于「编辑预览」，不参与存储与传输。
 *
 * 铁律：
 *  - 构造函数**禁止**使用 TS 参数属性（`constructor(private x)`）——
 *    Node `--experimental-strip-types` strip-only 模式不支持，会让整个测试文件崩溃；
 *  - 本文件不 import 任何 plugin 业务模块，避免循环引用（与 annotation/lute.ts 同款约定）。
 */

/** 单本书的前提上下文 */
export interface BookPrimerEntry {
  /** 书名快照（便于管理界面显示；可为空） */
  title?: string;
  /** 前提上下文正文（Kramdown 原文） */
  primer: string;
  /** 最后更新时间戳（毫秒） */
  updatedAt: number;
}

/** 全部书籍的上下文映射：bookId → 条目 */
export type BookPrimerMap = Record<string, BookPrimerEntry>;

/** 持久化键（插件数据目录内） */
export const BOOK_PRIMER_KEY = "book-primers.json";

/** 防抖写盘间隔（毫秒） */
const SAVE_DEBOUNCE_MS = 600;

/**
 * 粗略估算文本的 token 数（用于 UI 提示，非精确计费）。
 * 经验值：CJK 字符 ≈ 1 token/字；西文 ≈ 1 token/4 字符（≈0.75 token/词）。
 * 上下文通常中英混排，此处按混合规则估算，误差在可接受范围内。
 */
export function estimateTokens(text: string): number {
  const s = text || "";
  if (!s) return 0;
  // 统计 CJK（含中日韩统一表意文字、假名、谚文）
  const cjkMatches = s.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g);
  const cjk = cjkMatches ? cjkMatches.length : 0;
  const other = s.length - cjk;
  return Math.ceil(cjk * 1 + other / 4);
}

/** 上下文长度建议阈值（超出后 UI 转警告色，提示成本上升） */
export const PRIMER_WARN_CHARS = 1500;

export class BookPrimerStore {
  private data: BookPrimerMap = {};
  private plugin: any;
  private saveTimer: any = null;

  /** 注意：显式字段赋值，不可用参数属性（strip-only 不兼容） */
  constructor(plugin: any) {
    this.plugin = plugin;
  }

  /** 从插件数据加载索引；失败或空则初始化为空表 */
  async load(): Promise<void> {
    try {
      const raw = await this.plugin?.loadData?.(BOOK_PRIMER_KEY);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        this.data = raw as BookPrimerMap;
      } else if (typeof raw === "string" && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.data = parsed;
      } else {
        this.data = {};
      }
    } catch {
      this.data = {};
    }
  }

  /** 取某本书的上下文正文（未设置返回空串） */
  get(bookId: string): string {
    if (!bookId) return "";
    const e = this.data[bookId];
    return e?.primer || "";
  }

  /** 取某本书的完整条目（便于 UI 显示更新时间等） */
  getEntry(bookId: string): BookPrimerEntry | undefined {
    return bookId ? this.data[bookId] : undefined;
  }

  /** 全部条目快照（UI 列表 / 导出用） */
  all(): BookPrimerMap {
    return { ...this.data };
  }

  /**
   * 写入某本书的上下文并防抖落盘。
   * @param primer Kramdown 原文；传空串等同于删除条目（避免留空壳）
   */
  async set(bookId: string, primer: string, title?: string): Promise<void> {
    if (!bookId) return;
    const text = (primer || "").trim();
    if (!text) {
      await this.remove(bookId);
      return;
    }
    const prev = this.data[bookId];
    this.data[bookId] = {
      title: title || prev?.title || "",
      primer: text,
      updatedAt: Date.now(),
    };
    this.scheduleSave();
  }

  /** 删除某本书的上下文 */
  async remove(bookId: string): Promise<void> {
    if (!bookId || !this.data[bookId]) return;
    delete this.data[bookId];
    this.scheduleSave();
  }

  /** 清空全部上下文 */
  async clearAll(): Promise<void> {
    this.data = {};
    this.scheduleSave();
  }

  /** 防抖落盘（编辑期间高频调用不会反复写文件） */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush().catch(() => {
        /* 写盘失败静默：内存数据仍生效，下次编辑会重试 */
      });
    }, SAVE_DEBOUNCE_MS);
  }

  /** 立即落盘（关闭面板 / 卸载前调用，防丢数据） */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      await this.plugin?.saveData?.(BOOK_PRIMER_KEY, this.data);
    } catch {
      /* ignore */
    }
  }
}
