/**
 * DocumentLoader（R0 地基 · Readest 蓝本）
 * ---------------------------------------------------------------
 * 对齐 Readest libs/document.ts 的 DocumentLoader：开书唯一路由入口。
 * 任意内容源 → 魔数/扩展名检测 → 分派已注册适配器 → 产出归一化 BookDoc。
 *
 * R1 落地：通过适配器层收敛「按格式打开 + 抽取 BookDoc」，
 * 但不再由本类创建 view / 挂监听（时序敏感，仍由 openBook 控制），
 * 只暴露两个行为等价的方法：
 *   - openView(view, source)：把内容打开到指定 view（等价于旧 view.open）
 *   - buildBookDoc(source, view)：从已打开 view 抽取 BookDoc（等价于旧 toc/sections 抽取）
 *
 * 引入 ./adapters 触发自注册，确保 registry 在使用前已就绪。
 */
import "./adapters/index.ts";
import {
  createAdapter,
  detectContentType,
  type BookSource,
  type ContentType,
} from "./content-adapter.ts";
import type { BookDoc } from "./book-doc.ts";

export interface LoadedModel {
  book: BookDoc;
  format: ContentType;
}

export class DocumentLoader {
  /** 把内容源打开到【已挂载的】foliate view（时序由调用方控制）。 */
  static async openView(view: any, source: BookSource): Promise<void> {
    const format = detectContentType(source.name, source.bytes);
    const adapter = createAdapter(format);
    await adapter.openView(view, source);
  }

  /** 从已打开的 view 抽取归一化 BookDoc（含目录 / 分节 / PDF 大纲 / 总页数）。 */
  static async buildBookDoc(source: BookSource, view: any): Promise<LoadedModel> {
    const format = detectContentType(source.name, source.bytes);
    const adapter = createAdapter(format);
    const book = await adapter.buildBookDoc(source, view);
    return { book, format };
  }
}
