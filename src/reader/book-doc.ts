/**
 * 统一文档模型 BookDoc（R0 地基 · Readest 蓝本）
 * ---------------------------------------------------------------
 * 对齐 Readest 的 BookDoc（types/book.ts）：所有内容类型（EPUB / PDF /
 * 漫画 / TXT）解析后都收敛到这一个模型；特性层（双语 / 标注 / 词典）
 * 只认它，绝不 import foliate / pdf.js。
 *
 * R0 仅定义契约与纯函数，不接入现有开书链路（无行为变更）；
 * R1 由各 ContentAdapter 产出并接管（见阅读器翻新计划）。
 */

/** 稳定块定位：段落级可译文本块的跨重渲染定位 + 与翻译缓存同源的哈希 */
export interface BlockLocator {
  bookId: string;
  /** foliate CFI（重渲染/缩放不变）；无 CFI 的格式（纯文本等）留空串 */
  cfi: string;
  /** 与 TranslationCache.hashText(text, mode) 同源的文本哈希（即缓存键） */
  textHash: string;
  /** 全书唯一键：注入 / 隐藏 / 脏标记统一用它（消除双哈希分裂） */
  locatorKey: string;
}

/** 构造定位器。textHash 必须取自 TranslationCache.hashText —— 定位键与缓存键单源 */
export function makeLocator(bookId: string, cfi: string, textHash: string): BlockLocator {
  return { bookId, cfi, textHash, locatorKey: `${bookId}::${textHash}` };
}

/** 单节（对齐 foliate section 接口：createDocument 生成渲染 DOM） */
export interface SectionItem {
  index: number;
  /** 生成该节 DOM（渲染与文本枚举共用） */
  createDocument(): Promise<Document> | Document;
  /** 字符数（分页 / 进度参考，可空） */
  size?: number;
  linear?: "yes" | "no";
  /** 该节的可译文本块（双语/标注/词典共用；图片类返回 []） */
  enumerateTextBlocks?(): BlockLocator[];
}

export interface BookMetadata {
  title?: string;
  author?: string;
  language?: string;
  cover?: string;
}

export interface TocItem {
  title: string;
  href: string;
  level: number;
}

/** 版式：reflowable 流式（EPUB/TXT）；pre-paginated 固定版式（PDF/漫画图片） */
export type BookRendition = "reflowable" | "pre-paginated";

/** 归一化文档模型：所有格式解析后的统一产物 */
export interface BookDoc {
  bookId: string;
  metadata: BookMetadata;
  sections: SectionItem[];
  rendition: BookRendition;
  toc: TocItem[];
  /** PDF 总页数（仅 PDF 有值；EPUB/文本无）；供工具栏「第 N/T 页」显示 */
  pdfTotalPages?: number;
}
