/**
 * 内容适配器契约 + 注册表（R0 地基 · Readest 蓝本）
 * ---------------------------------------------------------------
 * 对齐 Readest DocumentLoader 范式：检测格式 → 分派适配器 → 产出 BookDoc。
 * 每个内容类型一个适配器；基础层只认本契约，不认 foliate / pdf.js。
 *
 * R0 仅契约 + 注册表 + 魔数检测（纯函数）；具体适配器 R1 落地：
 *   现有 books 延伸收进 EpubAdapter、pdf 延伸收进 PdfAdapter、漫画立薄壳。
 * 精简说明：metadata / toc / 分页信息全部由 open() 返回的 BookDoc 承载，
 * 适配器不再暴露冗余 getter（Readest 同构：open 一次拿全）。
 */
import type { BookDoc } from "./book-doc.ts";

export type ContentType = "epub" | "pdf" | "comic" | "text" | "other";

/** 打开书的输入源（R1 由书架 / 阅读入口装配） */
export interface BookSource {
  bookId: string;
  /** 文件名（含扩展名，用于类型检测） */
  name: string;
  /** 文件二进制（从思源资产 / 用户导入读取后填充；魔数检测用） */
  bytes?: Uint8Array;
  /** 已有 File 对象（与 bytes 二选一） */
  file?: File;
  /** 书名（纯文本适配器 makeTextBook 需要，用于兜底标题） */
  title?: string;
}

/** 特性能力开关（漫画类 supports("text")=false → 双语自动跳过） */
export type FeatureFlag = "text" | "selection" | "webtoon";

export interface ContentAdapter {
  readonly type: ContentType;
  /**
   * 把内容打开到【已挂载的】foliate view 上（不创建 view、不挂监听、不应用样式）。
   * 时序由调用方（openBook）控制：view 创建 → setupAnnotationLayer → 挂监听 → 调本方法。
   * 行为等价于旧 openBook 内联的 view.open(file) / view.open(makeTextBook(...))。
   */
  openView(view: any, source: BookSource): Promise<void>;
  /**
   * 给定已打开的 view，产出归一化 BookDoc（目录 / 分节 / PDF 大纲 / 总页数）。
   * 不负责打开，调用方在 view.open 之后调用。
   */
  buildBookDoc(source: BookSource, view: any): Promise<BookDoc> | BookDoc;
  supports(feature: FeatureFlag): boolean;
}

type AdapterCtor = new () => ContentAdapter;

const registry = new Map<ContentType, AdapterCtor>();

/** 注册适配器（R1 各适配器模块加载时自注册） */
export function registerAdapter(type: ContentType, ctor: AdapterCtor): void {
  registry.set(type, ctor);
}

export function createAdapter(type: ContentType): ContentAdapter {
  const Ctor = registry.get(type);
  if (!Ctor) throw new Error(`[REword] 未注册的内容适配器: ${type}`);
  return new Ctor();
}

/** ZIP 容器判定（对齐 Readest：前 3 字节 PK + 本地头/中央目录/空档标记） */
function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

/** PDF 魔数 "%PDF-" */
function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d
  );
}

/**
 * 类型检测：魔数优先、扩展名兜底（对齐 Readest 多层检测策略）。
 * ZIP 容器内 EPUB / CBZ 按扩展名区分；无扩展名 ZIP 默认按 EPUB（Readest 同策略）。
 */
export function detectContentType(name: string, bytes?: Uint8Array): ContentType {
  const lower = (name || "").toLowerCase();
  if (bytes && looksLikePdf(bytes)) return "pdf";
  if (bytes && looksLikeZip(bytes)) {
    if (lower.endsWith(".cbz")) return "comic";
    return "epub";
  }
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".cbz")) return "comic";
  if (/\.(epub|mobi|azw3|fb2)$/.test(lower)) return "epub";
  if (/\.(txt|md|markdown)$/.test(lower)) return "text";
  return "other";
}
